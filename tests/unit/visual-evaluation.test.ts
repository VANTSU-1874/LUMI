// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { verifyKnowledgeCorpusBundleV2 } from "@/lib/knowledge/knowledge-object-v2";
import {
  RetrievalEvaluationResultSchema,
  RetrievalGoldenSuiteSchema,
} from "@/lib/knowledge/retrieval-quality";
import {
  buildVisualEvaluationBindings,
  composeTextualVisualFallback,
  composeVisualEvaluationResult,
  visualQueryForCase,
} from "@/lib/knowledge/visual-evaluation";
import type { VisualRetrievalResponse } from "@/lib/knowledge/visual-retriever";
import { evaluateVisualRetriever } from "@/scripts/evaluate-visual-retrieval";
import {
  loadLegacyKnowledgeCorpusV2,
} from "../helpers/knowledge-v2-generation-fixtures";

const workspaceRoot = process.cwd();
const suite = RetrievalGoldenSuiteSchema.parse(JSON.parse(
  readFileSync(
    path.join(workspaceRoot, "tests", "retrieval-quality", "golden-suite.json"),
    "utf8",
  ),
));
const bundle = verifyKnowledgeCorpusBundleV2(
  loadLegacyKnowledgeCorpusV2(),
);
const bindings = buildVisualEvaluationBindings(bundle);
const identity = {
  corpusBundleHash: bundle.bundleHash,
  indexBundleHash: "b".repeat(64),
  indexVersionId: "fixture-v1",
  modelId: "fixture/model",
  modelRevision: "c".repeat(40),
};

function caseById(caseId: string) {
  const testCase = suite.cases.find(({ id }) => id === caseId);
  if (!testCase) throw new Error(`fixture case missing: ${caseId}`);
  return testCase;
}

describe("visual evaluation adapter", () => {
  it("maps the verified V2 corpus to 156 opaque, singly-owned assets", () => {
    expect(bindings.byAssetId.size).toBe(156);
    expect(bindings.byAssetPath.size).toBe(156);
    expect([...bindings.byAssetId.keys()].every((id) => id.startsWith("asset-"))).toBe(true);
  });

  it("builds retriever queries without leaking targets, parents, or expected course fields", () => {
    const testCase = caseById("visual-evidence-poster-45");
    const query = visualQueryForCase(testCase, bindings);
    const serialized = JSON.stringify(query);

    expect(query).toMatchObject({
      mode: "IMAGE_TEXT_TO_IMAGE",
      coursePackId: "layout-design",
    });
    expect(serialized).not.toContain("expectedSourceCoursePackId");
    expect(serialized).not.toContain("expectedLegacyPlacementCoursePackId");
    expect(serialized).not.toContain("\"targets\"");
    for (const forbiddenGroundTruth of [
      ...testCase.targets.nodes.map(({ id }) => id),
      ...testCase.targets.assets.map(({ path: assetPath }) => assetPath),
      ...testCase.targets.expectedParentLocators,
      testCase.expectedLegacyPlacementCoursePackId!,
    ]) {
      expect(serialized).not.toContain(forbiddenGroundTruth);
    }
  });

  it("composes asset, node, parent, region, and immutable provenance outside the sidecar", () => {
    const testCase = caseById("visual-evidence-poster-45");
    const target = bindings.byAssetPath.get(testCase.targets.assets[0]!.path)!;
    const response: VisualRetrievalResponse = {
      status: "SUCCESS",
      reason: null,
      hits: [{
        assetId: target.assetId,
        rank: 1,
        score: 0.75,
        region: {
          coordinateSpace: "NORMALIZED",
          x: 0.04,
          y: 0.2,
          width: 0.45,
          height: 0.39,
          origin: "INDEXED_REGION",
        },
        representationId: "fixture-target",
      }],
      index: identity,
      timing: { queueMs: 1, inferenceMs: 5, totalMs: 6 },
    };

    expect(composeVisualEvaluationResult(testCase, response, bindings)).toMatchObject({
      caseId: testCase.id,
      status: "SUCCESS",
      channel: "VISUAL",
      hits: [
        {
          kind: "ASSET",
          key: testCase.targets.assets[0]!.path,
          rank: 1,
          region: {
            coordinateSpace: "NORMALIZED",
            origin: "INDEXED_REGION",
          },
        },
        { kind: "NODE", key: testCase.targets.nodes[0]!.id, rank: 1 },
      ],
      parentLocators: testCase.targets.expectedParentLocators,
    });
    expect(response.index).toEqual(identity);
  });

  it("fails closed for pure images and only permits lexical fallback with query text", () => {
    const pureImage = caseById("visual-image-poster-33-to-35");
    const multimodal = caseById("visual-evidence-poster-45");
    const fallback = RetrievalEvaluationResultSchema.parse({
      caseId: multimodal.id,
      status: "SUCCESS",
      channel: "LEXICAL",
      hits: [{ kind: "NODE", key: multimodal.targets.nodes[0]!.id, rank: 1 }],
      parentLocators: multimodal.targets.expectedParentLocators,
      latencyMs: 2,
      degradedFrom: null,
      degradationSucceeded: null,
    });

    expect(() => composeTextualVisualFallback(pureImage, {
      ...fallback,
      caseId: pureImage.id,
    })).toThrow(/PURE_IMAGE_FALLBACK_FORBIDDEN/);
    expect(composeTextualVisualFallback(multimodal, fallback)).toMatchObject({
      degradedFrom: "VISUAL",
      degradationSucceeded: true,
    });
  });

  it("keeps pure-image failures visible while degrading every text-bearing visual case", async () => {
    const currentBundle = verifyKnowledgeCorpusBundleV2(JSON.parse(
      readFileSync(
        path.join(
          workspaceRoot,
          "data/knowledge-v2/knowledge-corpus.v2.json",
        ),
        "utf8",
      ),
    ));
    const capabilities = {
      textToImage: true,
      imageToImage: true,
      imageTextToImage: true,
      normalizedRegions: true,
    };
    const report = await evaluateVisualRetriever({
      workspaceRoot,
      suitePath: path.join(
        workspaceRoot,
        "tests/retrieval-quality/generations/d1d399c1/golden-suite.json",
      ),
      retriever: {
        capabilities: () => ({ ...capabilities }),
        async retrieve() {
          return {
            status: "ERROR",
            reason: "PROVIDER_UNAVAILABLE",
            hits: [],
            index: null,
            timing: { queueMs: 0, inferenceMs: 0, totalMs: 1 },
          };
        },
      },
      expectedIndex: {
        ...identity,
        corpusBundleHash: currentBundle.bundleHash,
      },
      capabilities,
    });

    const pureImageCases = suite.cases.filter(({ mode }) => mode === "IMAGE_TO_IMAGE");
    for (const { id: caseId } of pureImageCases) {
      expect(report.results.find((result) => result.caseId === caseId)).toMatchObject({
        status: "ERROR",
        degradedFrom: null,
      });
    }
    const textBearingVisualCases = suite.cases.filter(
      ({ mode, query }) =>
        ["TEXT_TO_IMAGE", "IMAGE_TEXT_TO_EVIDENCE"].includes(mode)
        && Boolean(query.text),
    );
    for (const { id: caseId } of textBearingVisualCases) {
      expect(report.results.find((result) => result.caseId === caseId)).toMatchObject({
        degradedFrom: "VISUAL",
        degradationSucceeded: true,
      });
    }
    expect(report.sources).toMatchObject({
      serviceDatabase: "NOT_USED",
      groundTruthSentToRetriever: false,
    });
  });
});
