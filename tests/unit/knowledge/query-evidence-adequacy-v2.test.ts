import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2,
  QueryEvidenceAdequacyTraceV2Schema,
  applyQueryEvidenceAdequacyV2,
  createQueryEvidenceAdequacyRuntimeV2,
  sha256StableJsonV2,
  type QueryEvidenceAdequacyRuntimeV2,
} from "@/lib/knowledge/query-evidence-adequacy-v2";
import type {
  EvidenceExpansionV2,
  EvidenceNodeV2,
} from "@/lib/knowledge/evidence-bundle-v2";
import {
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
  type KnowledgeNodeV2,
  type KnowledgeObjectV2,
} from "@/lib/knowledge/knowledge-object-v2";
import type { FusedCandidateV2 } from "@/lib/knowledge/rank-fusion-v2";
import { createRetrievalQueryV2 } from "@/lib/knowledge/retrieval-query-v2";

const HASH = "a".repeat(64);

let corpus: KnowledgeCorpusBundleV2;
let runtime: QueryEvidenceAdequacyRuntimeV2;

function textualNodeText(node: KnowledgeNodeV2) {
  switch (node.kind) {
    case "DOCUMENT":
    case "SECTION":
      return node.title;
    case "TEXT":
      return node.text;
    case "TABLE":
      return node.plainText;
    case "IMAGE":
    case "REGION":
      throw new Error("expected textual fixture node");
  }
}

function owner(nodeId: string) {
  for (const object of corpus.objects) {
    const node = object.nodes.find(({ id }) => id === nodeId);
    if (node) return { object, node };
  }
  throw new Error(`fixture node missing:${nodeId}`);
}

function seed(
  object: KnowledgeObjectV2,
  node: KnowledgeNodeV2,
  fusedRank: number,
): FusedCandidateV2 {
  return {
    candidateId: node.id,
    objectId: object.id,
    fusedRank,
    fusionScore: 2 / (60 + fusedRank),
    channelTraces: [
      {
        channel: "LEXICAL",
        rank: fusedRank,
        contribution: 1 / (60 + fusedRank),
        rawScore: 20 - fusedRank,
        representationId: null,
        nodeId: node.id,
        assetId: null,
        region: null,
      },
      {
        channel: "TEXT_VECTOR",
        rank: fusedRank,
        contribution: 1 / (60 + fusedRank),
        rawScore: 0.8 - fusedRank / 100,
        representationId: null,
        nodeId: node.id,
        assetId: null,
        region: null,
      },
    ],
  };
}

function primary(
  object: KnowledgeObjectV2,
  node: KnowledgeNodeV2,
): EvidenceNodeV2 {
  return {
    nodeId: node.id,
    objectId: object.id,
    kind: node.kind,
    relation: "PRIMARY",
    seedCandidateId: node.id,
    parentNodeId: node.parentId,
    sourceId: object.id,
    sourceCoursePack: object.sourceCoursePack,
    excerpt: textualNodeText(node),
    assetId: null,
  };
}

function fixture(
  question: string,
  nodeIds: readonly string[],
): {
  query: ReturnType<typeof createRetrievalQueryV2>;
  seeds: FusedCandidateV2[];
  expansion: EvidenceExpansionV2;
  retrievalAttestation: {
    lexicalResultHash: string;
    textVectorResultHash: string;
    objectRankingHash: string;
    objectConsensusTraceHash: string;
    finalSeedsHash: string;
  };
} {
  const owners = nodeIds.map(owner);
  const coursePack = owners[0]!.object.sourceCoursePack;
  expect(owners.every(({ object }) =>
    object.sourceCoursePack.id === coursePack.id)).toBe(true);
  const seeds = owners.map(({ object, node }, index) =>
    seed(object, node, index + 1));
  return {
    query: createRetrievalQueryV2({
      mode: "TEXT_TO_TEXT",
      text: question,
      scope: {
        corpusBundleHash: corpus.bundleHash,
        sourceCoursePack: coursePack,
      },
    }),
    seeds,
    expansion: {
      nodes: owners.map(({ object, node }) => primary(object, node)),
      assets: [],
      regions: [],
      sources: [],
    },
    retrievalAttestation: {
      lexicalResultHash: "1".repeat(64),
      textVectorResultHash: "2".repeat(64),
      objectRankingHash: "3".repeat(64),
      objectConsensusTraceHash: "4".repeat(64),
      finalSeedsHash: sha256StableJsonV2(seeds),
    },
  };
}

const COLOR_NODE =
  "node-c47c16dcdfb64efd63e35406bb4a7e05158773409d14776384905bf44cbf6b73";
const PROTOTYPE_NODE =
  "node-ae28344edb636665f60a76952b2500d4bb603aa257098c564fb111071946a335";
const GRID_DOCUMENT_NODE =
  "node-b1b6998cf3b266d3d384111c89c75ec2097b00a39bbae4b72af591376e0a8969";

beforeAll(async () => {
  corpus = verifyKnowledgeCorpusBundleV2(JSON.parse(await readFile(
    path.join(
      process.cwd(),
      "data",
      "knowledge-v2",
      "knowledge-corpus.v2.json",
    ),
    "utf8",
  )));
  runtime = createQueryEvidenceAdequacyRuntimeV2({
    corpus,
    context: {
      normalizerConfigHash: HASH,
      rrfConfigHash: "b".repeat(64),
      acceptancePolicyHash: "c".repeat(64),
      objectConsensusConfigHash: "d".repeat(64),
      lexicalConfigHash: "e".repeat(64),
      textProviderIndexBundleHash: "f".repeat(64),
      textModelId: "fixture-bge",
      textModelRevision: "9".repeat(40),
    },
  });
});

describe("query evidence adequacy v2", () => {
  it("binds policy and corpus-derived feature identities", () => {
    expect(runtime.identity).toMatchObject({
      corpusBundleHash: corpus.bundleHash,
      queryEvidenceAdequacyPolicyHash:
        DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2.configHash,
    });
    expect(
      runtime.identity.queryAnchorCorpusStatsHash,
    ).toMatch(/^[0-9a-f]{64}$/);

    expect(() => createQueryEvidenceAdequacyRuntimeV2({
      corpus,
      context: {
        normalizerConfigHash: HASH,
        rrfConfigHash: "b".repeat(64),
        acceptancePolicyHash: "c".repeat(64),
        objectConsensusConfigHash: "d".repeat(64),
        lexicalConfigHash: "e".repeat(64),
        textProviderIndexBundleHash: "f".repeat(64),
        textModelId: "fixture-bge",
        textModelRevision: "9".repeat(40),
      },
      policy: {
        ...DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2,
        actionClasses: {
          ...DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2.actionClasses,
          CREATE: [
            ...DEFAULT_QUERY_EVIDENCE_ADEQUACY_POLICY_V2
              .actionClasses.CREATE,
            "产品例外",
          ],
        },
      },
    })).toThrow("QUERY_EVIDENCE_ADEQUACY_POLICY_HASH_MISMATCH");
  });

  it("keeps every seed byte-for-byte when one primary supports the action and object", () => {
    const input = fixture("请检查辨色能力。", [COLOR_NODE]);
    const result = applyQueryEvidenceAdequacyV2({
      runtime,
      ...input,
    });

    expect(result.trace).toMatchObject({
      decision: "KEEP",
      reason: "ALL_OBLIGATIONS_SUPPORTED",
      unsupportedObligationCount: 0,
    });
    expect(result.seeds).toStrictEqual(input.seeds);
    expect(result.expansion).toStrictEqual(input.expansion);
    expect(result.trace.obligations).toEqual([
      expect.objectContaining({
        kind: "OPERATION_OBJECT",
        normalizedText: "辨色能力",
        actionClass: "INSPECT",
        supportedPrimaryNodeIds: [COLOR_NODE],
      }),
    ]);
  });

  it("clears all seeds and expansion when a high-confidence obligation is unsupported", () => {
    const input = fixture("请检查网格断点。", [COLOR_NODE]);
    const result = applyQueryEvidenceAdequacyV2({
      runtime,
      ...input,
    });

    expect(result.trace).toMatchObject({
      decision: "EMPTY",
      reason: "UNSUPPORTED_EXPLICIT_OBLIGATION",
      unsupportedObligationCount: 1,
    });
    expect(result.seeds).toEqual([]);
    expect(result.expansion).toEqual({
      nodes: [],
      assets: [],
      regions: [],
      sources: [],
    });
    expect(result.trace.preGateSeeds).toStrictEqual(input.seeds);
    expect(result.trace.postGateSeeds).toEqual([]);
  });

  it("keeps ambiguous two-sided action extraction instead of guessing", () => {
    const input = fixture(
      "辨色能力检查视觉语言。",
      [COLOR_NODE],
    );
    const result = applyQueryEvidenceAdequacyV2({
      runtime,
      ...input,
    });

    expect(result.trace).toMatchObject({
      decision: "KEEP",
      reason: "AMBIGUOUS_EXTRACTION",
      ambiguousExtraction: true,
    });
    expect(result.seeds).toStrictEqual(input.seeds);
  });

  it("binds a repeated object phrase to the action-local occurrence", () => {
    const input = fixture(
      "请设置辨色能力，再检查辨色能力。",
      [COLOR_NODE],
    );
    const result = applyQueryEvidenceAdequacyV2({
      runtime,
      ...input,
    });
    const configure = result.trace.obligations.find(
      ({ actionClass }) => actionClass === "CONFIGURE",
    );
    const inspect = result.trace.obligations.find(
      ({ actionClass }) => actionClass === "INSPECT",
    );

    expect(configure?.normalizedText).toBe("辨色能力");
    expect(inspect?.normalizedText).toBe("辨色能力");
    expect(configure?.start).toBeLessThan(inspect?.start ?? 0);
  });

  it("allows separate complete quoted obligations to be supported by separate primaries", () => {
    const input = fixture(
      "“辨色能力”和“观察结果”分别是什么意思？",
      [COLOR_NODE, PROTOTYPE_NODE],
    );
    const result = applyQueryEvidenceAdequacyV2({
      runtime,
      ...input,
    });

    expect(result.trace.decision).toBe("KEEP");
    expect(result.trace.obligations).toEqual([
      expect.objectContaining({
        kind: "QUOTED_TERM",
        normalizedText: "辨色能力",
        supportedPrimaryNodeIds: [COLOR_NODE],
      }),
      expect.objectContaining({
        kind: "QUOTED_TERM",
        normalizedText: "观察结果",
        supportedPrimaryNodeIds: [PROTOTYPE_NODE],
      }),
    ]);
  });

  it("does not splice an action from one primary and its object from another", () => {
    const input = fixture(
      "请检查网格。",
      [COLOR_NODE, GRID_DOCUMENT_NODE],
    );
    const result = applyQueryEvidenceAdequacyV2({
      runtime,
      ...input,
    });

    expect(result.trace).toMatchObject({
      decision: "EMPTY",
      reason: "UNSUPPORTED_EXPLICIT_OBLIGATION",
    });
    expect(result.trace.obligations).toEqual([
      expect.objectContaining({
        kind: "OPERATION_OBJECT",
        normalizedText: "网格",
        supportedPrimaryNodeIds: [],
      }),
    ]);
  });

  it("accepts an authenticated DOCUMENT primary and uses only its visible text", () => {
    const input = fixture("“网格”是什么意思？", [
      GRID_DOCUMENT_NODE,
    ]);
    const result = applyQueryEvidenceAdequacyV2({
      runtime,
      ...input,
    });

    expect(result.trace).toMatchObject({
      decision: "KEEP",
      primaryBindings: [
        expect.objectContaining({
          nodeId: GRID_DOCUMENT_NODE,
          nodeKind: "DOCUMENT",
        }),
      ],
    });
  });

  it("rejects different unsupported products by the same evidence rule, not a product exception", () => {
    for (const question of [
      "CSS Grid 怎么设置？",
      "Rhino Loft 怎么设置？",
    ]) {
      const input = fixture(question, [COLOR_NODE]);
      const result = applyQueryEvidenceAdequacyV2({
        runtime,
        ...input,
      });
      expect(result.trace).toMatchObject({
        decision: "EMPTY",
        reason: "UNSUPPORTED_EXPLICIT_OBLIGATION",
      });
      expect(result.trace.obligations.some(
        ({ kind }) => kind === "LATIN_TECHNICAL",
      )).toBe(true);
    }
  });

  it("throws an integrity error for a forged or truncated primary excerpt", () => {
    const input = fixture("请检查辨色能力。", [COLOR_NODE]);
    input.expansion.nodes[0]!.excerpt = "伪造证据";

    expect(() => applyQueryEvidenceAdequacyV2({
      runtime,
      ...input,
    })).toThrow("QUERY_EVIDENCE_ADEQUACY_PRIMARY_EXCERPT_INVALID");
  });

  it("recomputes complete seed hashes and rejects trace tampering", () => {
    const input = fixture("请检查辨色能力。", [COLOR_NODE]);
    const result = applyQueryEvidenceAdequacyV2({
      runtime,
      ...input,
    });
    const tampered = structuredClone(result.trace);
    tampered.postGateSeeds[0]!.fusionScore += 1;

    expect(() =>
      QueryEvidenceAdequacyTraceV2Schema.parse(tampered)
    ).toThrow();
  });

  it("honors an already-aborted request before doing adequacy work", () => {
    const input = fixture("请检查辨色能力。", [COLOR_NODE]);
    const controller = new AbortController();
    controller.abort(new Error("test abort"));

    expect(() => applyQueryEvidenceAdequacyV2({
      runtime,
      ...input,
      signal: controller.signal,
    })).toThrow("test abort");
  });
});
