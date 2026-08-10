// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
} from "../../lib/knowledge/knowledge-object-v2";
import {
  isT45EligibleNode,
  t45CapabilityFingerprint,
} from "../../tools/mixed-retrieval/t45-capability-authoring";
import {
  assertKnowledgeV2EvaluationGeneration,
  CURRENT_KNOWLEDGE_V2_GENERATION,
  LEGACY_KNOWLEDGE_V2_GENERATION,
  loadLegacyKnowledgeCorpusV2,
} from "../helpers/knowledge-v2-generation-fixtures";

const workspaceRoot = process.cwd();
const closureRoot = path.join(
  workspaceRoot,
  "tests",
  "retrieval-quality",
  "generations",
  "d1d399c1",
);

// Parsed JSON is intentionally inspected as a generic frozen artifact.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRecord = Record<string, any>;

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(name: string) {
  return JSON.parse(
    await readFile(path.join(closureRoot, name), "utf8"),
  ) as JsonRecord;
}

function nodeIds(value: unknown, result = new Set<string>()) {
  if (typeof value === "string" && /^node-[0-9a-f]{64}$/.test(value)) {
    result.add(value);
  } else if (Array.isArray(value)) {
    for (const child of value) nodeIds(child, result);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) nodeIds(child, result);
  }
  return result;
}

function artifactBundleHash(value: JsonRecord) {
  return value.corpusBundleHash
    ?? value.corpusSnapshot?.bundleHash;
}

function computedSeal(value: JsonRecord, field: string) {
  const unhashed = { ...value };
  delete unhashed[field];
  return sha256StableJsonV2(unhashed);
}

describe("K10 Knowledge V2 versioned evaluation closure", () => {
  it("preserves the historical corpus and rejects cross-generation mixing", () => {
    const legacy = verifyKnowledgeCorpusBundleV2(
      loadLegacyKnowledgeCorpusV2(),
    );
    expect(legacy.bundleHash)
      .toBe(LEGACY_KNOWLEDGE_V2_GENERATION.bundleHash);
    expect(legacy.objects.flatMap(({ nodes }) => nodes))
      .toHaveLength(LEGACY_KNOWLEDGE_V2_GENERATION.nodeCount);

    expect(() => assertKnowledgeV2EvaluationGeneration(
      CURRENT_KNOWLEDGE_V2_GENERATION.bundleHash,
      LEGACY_KNOWLEDGE_V2_GENERATION.bundleHash,
    )).toThrow(
      "KNOWLEDGE_V2_EVALUATION_GENERATION_MIX_FORBIDDEN",
    );
    expect(() => assertKnowledgeV2EvaluationGeneration(
      LEGACY_KNOWLEDGE_V2_GENERATION.bundleHash,
      CURRENT_KNOWLEDGE_V2_GENERATION.bundleHash,
    )).toThrow(
      "KNOWLEDGE_V2_EVALUATION_GENERATION_MIX_FORBIDDEN",
    );
  });

  it("matches every manifest hash and binds every closure artifact to d1d399", async () => {
    const manifest = await readJson("manifest.json");
    expect(manifest.generationId).toBe("knowledge-v2-d1d399c1");
    expect(manifest.corpus).toMatchObject(
      CURRENT_KNOWLEDGE_V2_GENERATION,
    );
    expect(manifest.historicalBaseline).toMatchObject({
      bundleHash: LEGACY_KNOWLEDGE_V2_GENERATION.bundleHash,
      nodeCount: LEGACY_KNOWLEDGE_V2_GENERATION.nodeCount,
      relationCount: LEGACY_KNOWLEDGE_V2_GENERATION.relationCount,
      policy: "PRESERVE_BYTE_IDENTICAL_NO_MIXING",
    });

    for (const [name, expected] of Object.entries(
      manifest.files as Record<
        string,
        { bytes: number; sha256: string }
      >,
    )) {
      const bytes = await readFile(path.join(closureRoot, name));
      expect(bytes.byteLength, name).toBe(expected.bytes);
      expect(sha256(bytes), name).toBe(expected.sha256);
      const artifact = JSON.parse(bytes.toString("utf8")) as JsonRecord;
      const bundleHash = artifactBundleHash(artifact);
      if (bundleHash) {
        assertKnowledgeV2EvaluationGeneration(
          CURRENT_KNOWLEDGE_V2_GENERATION.bundleHash,
          bundleHash,
        );
      }
    }
  });

  it("seals current qrels/runtime/inventory and resolves all node anchors", async () => {
    const corpus = verifyKnowledgeCorpusBundleV2(JSON.parse(
      await readFile(
        path.join(
          workspaceRoot,
          "data",
          "knowledge-v2",
          "knowledge-corpus.v2.json",
        ),
        "utf8",
      ),
    ));
    expect(corpus.bundleHash)
      .toBe(CURRENT_KNOWLEDGE_V2_GENERATION.bundleHash);
    expect(corpus.objects.flatMap(({ nodes }) => nodes))
      .toHaveLength(CURRENT_KNOWLEDGE_V2_GENERATION.nodeCount);
    const nodes = new Set(
      corpus.objects.flatMap(({ nodes: objectNodes }) =>
        objectNodes.map(({ id }) => id)),
    );

    const manifest = await readJson("manifest.json");
    for (const name of Object.keys(manifest.files as JsonRecord)) {
      const artifact = await readJson(name);
      if (artifact.inventoryHash) {
        expect(artifact.inventoryHash, name)
          .toBe(computedSeal(artifact, "inventoryHash"));
      }
      if (artifact.suiteHash) {
        expect(artifact.suiteHash, name)
          .toBe(computedSeal(artifact, "suiteHash"));
      }
      for (const nodeId of nodeIds(artifact)) {
        expect(nodes.has(nodeId), `${name}:${nodeId}`).toBe(true);
      }
    }
  });

  it("recomputes all T45 object fingerprints and includes both new ACTION nodes", async () => {
    const corpus = verifyKnowledgeCorpusBundleV2(JSON.parse(
      await readFile(
        path.join(
          workspaceRoot,
          "data",
          "knowledge-v2",
          "knowledge-corpus.v2.json",
        ),
        "utf8",
      ),
    ));
    const inventory = await readJson("t45-capability-inventory.json");
    const byId = new Map<string, JsonRecord>(
      inventory.objects.map((entry: JsonRecord) => [
        entry.objectId as string,
        entry,
      ] as const),
    );
    for (const object of corpus.objects) {
      const entry = byId.get(object.id) as JsonRecord | undefined;
      expect(entry, object.id).toBeDefined();
      expect(entry?.objectContentHash, object.id).toBe(object.contentHash);
      expect(entry?.capabilityFingerprint, object.id)
        .toBe(t45CapabilityFingerprint(object));
      expect(entry?.eligibleNodeIds, object.id).toEqual(
        object.nodes
          .filter(isT45EligibleNode)
          .map(({ id }) => id)
          .sort(),
      );
    }
    expect(byId.get("layout-001-grid-and-hierarchy")?.eligibleNodeIds)
      .toContain(
        "node-5e25bccaeb2e46d7df1fb51c031698a39d15d2569e4a5b7924a4cf7d8741d013",
      );
    expect(byId.get("layout-002-type-hierarchy-and-whitespace")?.eligibleNodeIds)
      .toContain(
        "node-6fa785c4d2c75782d3a7eae97c186e653b8167c93020a439aec8fb95a8405610",
      );
  });
});
