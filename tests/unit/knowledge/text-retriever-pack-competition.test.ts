// @vitest-environment node

import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  PackCompetitionDiagnosticsV2Schema,
  type PackCompetitionDiagnosticsV2,
} from "@/lib/knowledge/pack-competition-v2";
import { startTextSidecar } from "@/lib/knowledge/text-retriever-client";
import {
  createGuardedTextRetriever,
  SELF_HOSTED_TEXT_MODEL,
  type TextIndexIdentity,
} from "@/lib/knowledge/text-retriever";

const index: TextIndexIdentity = {
  corpusBundleHash: "a".repeat(64),
  indexBundleHash: "b".repeat(64),
  indexVersionId: "bge-small-zh-v1-5-fixture",
  modelId: SELF_HOSTED_TEXT_MODEL.id,
  modelRevision: SELF_HOSTED_TEXT_MODEL.revision,
};

const hit = {
  representationId: "text-rep-fixture",
  nodeId: "node-fixture",
  objectId: "layout-fixture",
  coursePackId: "layout-design" as const,
  rank: 1,
  score: 0.82,
  sourceKind: "NODE" as const,
  nodeKind: "TEXT" as const,
  role: "ACTION" as const,
  contentHash: "c".repeat(64),
};

const layoutWinner = {
  coursePackId: "layout-design" as const,
  objectCount: 2,
  objectId: "layout-fixture",
  representationId: "text-rep-fixture",
  nodeId: "node-fixture",
  score: 0.82,
};

const brandWinner = {
  coursePackId: "brand-vi-design" as const,
  objectCount: 1,
  objectId: "brand-fixture",
  representationId: "brand-rep-fixture",
  nodeId: "brand-node-fixture",
  score: 0.91,
};

function validPackCompetition(): PackCompetitionDiagnosticsV2 {
  return PackCompetitionDiagnosticsV2Schema.parse({
    schemaVersion: 1,
    scoreMetric: "COSINE_SIMILARITY",
    objectDeduplication: "BEST_REPRESENTATION_PER_OBJECT",
    packWinnerSelection: "BEST_OBJECT_PER_PACK",
    globalWinnerSelection: "BEST_PACK_WINNER",
    sourceScope: { coursePackId: "layout-design" },
    scoredRepresentationCount: 5,
    deduplicatedObjectCount: 3,
    perPackWinners: [brandWinner, layoutWinner],
    globalWinner: brandWinner,
    scopedWinner: layoutWinner,
    globalToScopedMargin: brandWinner.score - layoutWinner.score,
  });
}

function successResponse(diagnostics: unknown) {
  return {
    status: "SUCCESS",
    reason: null,
    hits: [hit],
    index,
    timing: { inferenceMs: 2, totalMs: 2 },
    diagnostics,
  };
}

function fixtureArgs(behavior: string) {
  return [
    path.join(process.cwd(), "tests", "fixtures", "text-sidecar.mjs"),
    Buffer.from(JSON.stringify(index)).toString("base64url"),
    behavior,
  ];
}

function allowedTargets() {
  return new Map([
    [hit.nodeId, {
      objectId: hit.objectId,
      coursePackId: hit.coursePackId,
    }],
    ["layout-node-second", {
      objectId: "layout-fixture-second",
      coursePackId: "layout-design",
    }],
    [brandWinner.nodeId, {
      objectId: brandWinner.objectId,
      coursePackId: brandWinner.coursePackId,
    }],
  ]);
}

describe("text pack competition diagnostics", () => {
  it("strictly validates stable per-pack, global, scoped, and margin invariants", () => {
    const valid = validPackCompetition();
    expect(valid.perPackWinners.map(({ coursePackId }) => coursePackId)).toEqual([
      "brand-vi-design",
      "layout-design",
    ]);
    expect(valid.globalWinner).toEqual(brandWinner);
    expect(valid.scopedWinner).toEqual(layoutWinner);
    expect(valid.globalToScopedMargin).toBeCloseTo(0.09);

    expect(PackCompetitionDiagnosticsV2Schema.safeParse({
      ...valid,
      globalToScopedMargin: 0.08,
    }).success).toBe(false);
    expect(PackCompetitionDiagnosticsV2Schema.safeParse({
      ...valid,
      perPackWinners: [layoutWinner, brandWinner],
    }).success).toBe(false);
    expect(PackCompetitionDiagnosticsV2Schema.safeParse({
      ...valid,
      unexpected: true,
    }).success).toBe(false);
    expect(PackCompetitionDiagnosticsV2Schema.safeParse({
      ...valid,
      scoreMetric: "LEXICAL_NORMALIZED_SCORE",
      perPackWinners: valid.perPackWinners.map((winner) => ({
        ...winner,
        representationId: null,
      })),
      globalWinner: valid.globalWinner
        ? { ...valid.globalWinner, representationId: null }
        : null,
      scopedWinner: valid.scopedWinner
        ? { ...valid.scopedWinner, representationId: null }
        : null,
    }).success).toBe(true);
  });

  it("keeps valid main hits while malformed diagnostics fail open as INVALID", async () => {
    const transport = vi.fn(async () => successResponse({
      packCompetition: {
        ...validPackCompetition(),
        unexpected: true,
      },
    }));
    const retriever = createGuardedTextRetriever({
      expectedIndex: index,
      allowedTargets: allowedTargets(),
      transport,
    });

    await expect(retriever.retrieve({
      text: "版面层级怎么调？",
      coursePackId: "layout-design",
    }, {
      topK: 5,
      timeoutMs: 500,
    })).resolves.toMatchObject({
      status: "SUCCESS",
      hits: [hit],
      diagnostics: {
        status: "INVALID",
        reason: "SCHEMA_INVALID",
        packCompetition: null,
      },
    });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("invalidates schema-valid diagnostics that claim an unknown corpus owner", async () => {
    const valid = validPackCompetition();
    const wrongBrand = {
      ...brandWinner,
      objectId: "brand-unknown",
    };
    const transport = vi.fn(async () => successResponse({
      packCompetition: {
        ...valid,
        perPackWinners: [wrongBrand, layoutWinner],
        globalWinner: wrongBrand,
      },
    }));
    const retriever = createGuardedTextRetriever({
      expectedIndex: index,
      allowedTargets: allowedTargets(),
      transport,
    });

    const response = await retriever.retrieve({
      text: "版面层级怎么调？",
      coursePackId: "layout-design",
    }, {
      topK: 5,
      timeoutMs: 500,
    });
    expect(response).toMatchObject({
      status: "SUCCESS",
      hits: [hit],
      diagnostics: {
        status: "INVALID",
        reason: "SCHEMA_INVALID",
        packCompetition: null,
      },
    });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("passes valid and invalid sidecar diagnostics through one request without poisoning hits", async () => {
    for (const behavior of ["success", "invalid-diagnostics"]) {
      const handle = await startTextSidecar({
        executable: process.execPath,
        args: fixtureArgs(behavior),
        cwd: process.cwd(),
        expectedIndex: index,
        allowedTargets: new Map([
          [hit.nodeId, {
            objectId: hit.objectId,
            coursePackId: hit.coursePackId,
          }],
        ]),
        startupTimeoutMs: 2_000,
      });
      try {
        const response = await handle.retriever.retrieve({
          text: "这个版面先改哪里？",
          coursePackId: "layout-design",
        }, {
          topK: 5,
          timeoutMs: 500,
        });
        expect(response.status).toBe("SUCCESS");
        expect(response.hits).toHaveLength(1);
        expect(response.diagnostics.status).toBe(
          behavior === "success" ? "AVAILABLE" : "INVALID",
        );
      } finally {
        await handle.dispose();
      }
    }
  });

  it("uses one Python score vector, preserves scoped representation hits, and deduplicates objects only for pack winners", () => {
    const script = String.raw`
import importlib.util
import json
from pathlib import Path

module_path = Path.cwd() / "tools" / "text-retrieval" / "text_retrieval.py"
spec = importlib.util.spec_from_file_location("lumi_text_retrieval", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Scalar:
    def __init__(self, value):
        self.value = value
    def item(self):
        return self.value

class Query:
    def to(self, _device):
        return self

class Encoder:
    def encode(self, _texts, query):
        assert query is True
        return [Query()]

class Embeddings:
    device = "cpu"
    def __init__(self, scores):
        self.scores = scores
        self.matmul_count = 0
    def __matmul__(self, _query):
        self.matmul_count += 1
        return [Scalar(score) for score in self.scores]

def entry(rep, node, obj, pack):
    return {
        "representationId": rep,
        "nodeId": node,
        "objectId": obj,
        "coursePackId": pack,
        "sourceKind": "NODE",
        "nodeKind": "TEXT",
        "role": "ACTION",
        "contentHash": "c" * 64,
    }

loaded = module.LoadedIndex.__new__(module.LoadedIndex)
loaded.encoder = Encoder()
loaded.entries = [
    entry("layout-a-high", "layout-node-a-high", "layout-object-a", "layout-design"),
    entry("layout-a-low", "layout-node-a-low", "layout-object-a", "layout-design"),
    entry("layout-b", "layout-node-b", "layout-object-b", "layout-design"),
    entry("brand-a-high", "brand-node-a-high", "brand-object-a", "brand-vi-design"),
    entry("brand-a-low", "brand-node-a-low", "brand-object-a", "brand-vi-design"),
]
loaded.embeddings = Embeddings([0.95, 0.70, 0.90, 0.92, 0.60])
hits, diagnostics, _ = loaded.search("fixture", "brand-vi-design", 10)
print(json.dumps({
    "hits": hits,
    "diagnostics": diagnostics,
    "matmulCount": loaded.embeddings.matmul_count,
}, separators=(",", ":")))
`;
    const raw = execFileSync("python", ["-c", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 10_000,
    });
    const output = JSON.parse(raw) as {
      hits: Array<{ representationId: string; rank: number }>;
      diagnostics: unknown;
      matmulCount: number;
    };
    const diagnostics = PackCompetitionDiagnosticsV2Schema.parse(output.diagnostics);

    expect(output.matmulCount).toBe(1);
    expect(output.hits.map(({ representationId, rank }) => ({ representationId, rank })))
      .toEqual([
        { representationId: "brand-a-high", rank: 1 },
        { representationId: "brand-a-low", rank: 2 },
      ]);
    expect(diagnostics.deduplicatedObjectCount).toBe(3);
    expect(diagnostics.perPackWinners).toMatchObject([
      {
        coursePackId: "brand-vi-design",
        objectCount: 1,
        representationId: "brand-a-high",
      },
      {
        coursePackId: "layout-design",
        objectCount: 2,
        representationId: "layout-a-high",
      },
    ]);
    expect(diagnostics.globalWinner?.coursePackId).toBe("layout-design");
    expect(diagnostics.scopedWinner?.coursePackId).toBe("brand-vi-design");
    expect(diagnostics.globalToScopedMargin).toBeCloseTo(0.03);
  });
});
