// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  nearestRankPercentile,
  rankedRetrievalMetrics,
  RetrievalEvaluationResultSchema,
  RetrievalGoldenCaseSchema,
  RetrievalGoldenSuiteSchema,
  scoreRetrievalCase,
  summarizeRetrievalScores,
  type RetrievalEvaluationResult,
  type RetrievalGoldenCase,
} from "@/lib/knowledge/retrieval-quality";

const textCase: RetrievalGoldenCase = {
  id: "text-layout-hierarchy",
  mode: "TEXT_TO_TEXT",
  expectation: "ANSWERABLE",
  expectedSourceCoursePackId: "layout-design",
  expectedLegacyPlacementCoursePackId: "layout-design",
  coursePackVersion: "1",
  query: { coursePackId: "layout-design", text: "标题和正文都很抢，先改哪里？" },
  targets: {
    nodes: [
      { id: "layout-primary", relevance: 3, required: true },
      { id: "layout-secondary", relevance: 1, required: true },
    ],
    assets: [],
    regions: [],
    expectedParentLocators: [],
    forbiddenNodeIds: ["wrong-course"],
    forbiddenAssetPaths: [],
  },
  tags: ["paraphrase"],
};

function resultFor(
  testCase: RetrievalGoldenCase,
  overrides: Partial<RetrievalEvaluationResult> = {},
): RetrievalEvaluationResult {
  return {
    caseId: testCase.id,
    status: "SUCCESS",
    channel: "HYBRID",
    hits: [{ kind: "NODE", key: "layout-primary", rank: 1 }],
    parentLocators: [],
    latencyMs: 10,
    degradedFrom: null,
    degradationSucceeded: null,
    ...overrides,
  };
}

describe("retrieval quality contracts", () => {
  it("enforces the input required by each retrieval mode", () => {
    expect(() => RetrievalGoldenSuiteSchema.parse({
      schemaVersion: 1,
      suiteVersion: "2026-07-28.1",
      corpusSnapshot: {
        commit: "a".repeat(40),
        knowledgeTree: "b".repeat(40),
        coursesTree: "c".repeat(40),
        runtimeKnowledgeCount: 116,
        generatedKnowledgeCount: 82,
        baselineKnowledgeCount: 34,
        knowledgeCorpusSha256: "d".repeat(64),
        sourceDocumentCount: 82,
        sourceCorpusSha256: "e".repeat(64),
        assetCount: 156,
        assetManifest: "data/manifests/course-png-sha256.v1.json",
        assetManifestSha256: "f".repeat(64),
      },
      cases: [{
        ...textCase,
        id: "invalid-image-case",
        mode: "IMAGE_TO_IMAGE",
        query: { coursePackId: "layout-design", text: "缺少图片" },
      }],
    })).toThrow();
  });

  it("calculates deterministic recall, reciprocal rank, and graded nDCG", () => {
    const metrics = rankedRetrievalMetrics(
      textCase.targets.nodes.map(({ id, relevance, required }) => ({
        key: id,
        relevance,
        required,
      })),
      ["unrelated", "layout-primary", "layout-secondary"],
    );

    expect(metrics).toMatchObject({
      recallAt1: 0,
      recallAt3: 1,
      recallAt5: 1,
      mrr: 0.5,
      precisionAt5: 0.4,
    });
    expect(metrics.ndcgAt5).toBeGreaterThan(0.6);
    expect(metrics.ndcgAt5).toBeLessThan(1);
  });

  it("requires negative mode to declare NO_ANSWER", () => {
    expect(() => RetrievalGoldenCaseSchema.parse({
      ...textCase,
      mode: "NEGATIVE",
      expectation: "ANSWERABLE",
    })).toThrow(/NEGATIVE/);
  });

  it("separates query scope from expected source ground truth", () => {
    expect(() => RetrievalGoldenCaseSchema.parse({
      ...textCase,
      query: {
        text: textCase.query.text,
      },
    })).toThrow();
    expect(() => RetrievalGoldenCaseSchema.parse({
      ...textCase,
      expectation: "NO_ANSWER",
      expectedSourceCoursePackId: "layout-design",
      expectedLegacyPlacementCoursePackId: null,
      targets: {
        nodes: [],
        assets: [],
        regions: [],
        expectedParentLocators: [],
        forbiddenNodeIds: [],
        forbiddenAssetPaths: [],
      },
    })).toThrow(/expected source/);
    expect(() => RetrievalGoldenCaseSchema.parse({
      ...textCase,
      expectation: "NO_ANSWER",
      expectedSourceCoursePackId: null,
      expectedLegacyPlacementCoursePackId: "layout-design",
      targets: {
        nodes: [],
        assets: [],
        regions: [],
        expectedParentLocators: [],
        forbiddenNodeIds: [],
        forbiddenAssetPaths: [],
      },
    })).toThrow(/legacy placement/);
    expect(RetrievalGoldenCaseSchema.parse({
      ...textCase,
      mode: "NEGATIVE",
      expectation: "NO_ANSWER",
      expectedSourceCoursePackId: null,
      expectedLegacyPlacementCoursePackId: null,
      targets: {
        nodes: [],
        assets: [],
        regions: [],
        expectedParentLocators: [],
        forbiddenNodeIds: [],
        forbiddenAssetPaths: [],
      },
    }).query.coursePackId).toBe("layout-design");
  });

  it("rejects positive targets that overlap forbidden targets", () => {
    expect(() => RetrievalGoldenCaseSchema.parse({
      ...textCase,
      targets: {
        ...textCase.targets,
        forbiddenNodeIds: ["layout-primary"],
      },
    })).toThrow(/forbidden/);

    expect(() => RetrievalGoldenCaseSchema.parse({
      ...textCase,
      mode: "TEXT_TO_IMAGE",
      targets: {
        ...textCase.targets,
        nodes: [],
        assets: [{
          path: "assets/layout-design/poster.png",
          sha256: "a".repeat(64),
          relevance: 3,
          required: true,
        }],
        forbiddenNodeIds: [],
        forbiddenAssetPaths: ["assets/layout-design/poster.png"],
      },
    })).toThrow(/forbidden/);
  });

  it("keeps normalized regions entirely inside the image", () => {
    expect(() => RetrievalGoldenCaseSchema.parse({
      ...textCase,
      targets: {
        ...textCase.targets,
        regions: [{
          assetPath: "assets/layout-design/poster.png",
          bbox: [0.8, 0.2, 0.3, 0.4],
          coordinateSpace: "NORMALIZED",
          relevance: 3,
          required: true,
        }],
      },
    })).toThrow(/bounding boxes/);
  });

  it("accepts only strict data/courses markdown parent locators", () => {
    for (const parentLocator of [
      "courses/layout-design/source.md",
      "data/courses/../secret.md",
      "data/courses/layout-design/./source.md",
      "data/courses/layout-design/source.png",
      "data/courses//source.md",
    ]) {
      expect(() => RetrievalEvaluationResultSchema.parse(resultFor(textCase, {
        parentLocators: [parentLocator],
      }))).toThrow();
    }

    expect(RetrievalEvaluationResultSchema.parse(resultFor(textCase, {
      parentLocators: ["data/courses/layout-design/source.md"],
    })).parentLocators).toEqual(["data/courses/layout-design/source.md"]);
  });

  it("treats rank as authoritative and requires contiguous ranks within each kind", () => {
    const reversed = RetrievalEvaluationResultSchema.parse(resultFor(textCase, {
      hits: [
        { kind: "NODE", key: "layout-secondary", rank: 2 },
        { kind: "NODE", key: "layout-primary", rank: 1 },
        { kind: "ASSET", key: "assets/layout-design/second.png", rank: 2 },
        { kind: "ASSET", key: "assets/layout-design/first.png", rank: 1 },
      ],
    }));
    expect(scoreRetrievalCase(textCase, reversed).nodeMetrics?.mrr).toBe(1);

    for (const ranks of [[1, 1], [1, 3], [2, 3]]) {
      expect(() => RetrievalEvaluationResultSchema.parse(resultFor(textCase, {
        hits: ranks.map((rank, index) => ({
          kind: "NODE" as const,
          key: `node-${index}`,
          rank,
        })),
      }))).toThrow(/ranks/);
    }
  });

  it("requires degradation metadata to be paired", () => {
    expect(() => RetrievalEvaluationResultSchema.parse(resultFor(textCase, {
      degradedFrom: "HYBRID",
      degradationSucceeded: null,
    }))).toThrow(/degradation/);
    expect(() => RetrievalEvaluationResultSchema.parse(resultFor(textCase, {
      degradedFrom: null,
      degradationSucceeded: true,
    }))).toThrow(/degradation/);
  });

  it("keeps unsupported cases separate from empty and failed retrievals", () => {
    const unsupported: RetrievalEvaluationResult = {
      caseId: textCase.id,
      status: "UNSUPPORTED",
      channel: "CAPTION_LEXICAL",
      unsupportedReason: "INPUT_MODALITY_UNSUPPORTED",
      hits: [],
      parentLocators: [],
      latencyMs: 0.5,
      degradedFrom: null,
      degradationSucceeded: null,
    };
    const scored = scoreRetrievalCase(textCase, unsupported);
    const summary = summarizeRetrievalScores([scored]);

    expect(scored.primaryMetrics).toBeNull();
    expect(summary.overall).toMatchObject({
      attempted: 1,
      evaluated: 0,
      unsupported: 1,
      errors: 0,
    });
  });

  it("uses nearest-rank percentiles", () => {
    expect(nearestRankPercentile([1, 5, 2, 9], 0.5)).toBe(2);
    expect(nearestRankPercentile([1, 5, 2, 9], 0.95)).toBe(9);
  });

  it("does not let empty or unsupported outcomes hide partial hits", () => {
    expect(() => RetrievalEvaluationResultSchema.parse({
      caseId: textCase.id,
      status: "EMPTY",
      channel: "LEXICAL",
      hits: [{ kind: "NODE", key: "partial-hit", rank: 1 }],
      parentLocators: [],
      latencyMs: 1,
      degradedFrom: null,
      degradationSucceeded: null,
    })).toThrow();
    expect(() => RetrievalEvaluationResultSchema.parse({
      caseId: textCase.id,
      status: "EMPTY",
      channel: "LEXICAL",
      hits: [],
      parentLocators: ["data/courses/layout-design/source.md"],
      latencyMs: 1,
      degradedFrom: null,
      degradationSucceeded: null,
    })).toThrow(/parent locators/);
  });

  it("scores image-text evidence only when node, asset, and parent all pass", () => {
    const combinedCase: RetrievalGoldenCase = {
      ...textCase,
      id: "combined-layout-evidence",
      mode: "IMAGE_TEXT_TO_EVIDENCE",
      query: {
        coursePackId: "layout-design",
        text: "这张海报看着乱，问题到底在哪？",
        assetPath: "assets/layout-design/query.png",
        excludeSelfAsset: true,
        excludeAssetPaths: ["assets/layout-design/query.png"],
      },
      targets: {
        nodes: [{ id: "layout-primary", relevance: 3, required: true }],
        assets: [{
          path: "assets/layout-design/evidence.png",
          sha256: "a".repeat(64),
          relevance: 3,
          required: true,
        }],
        regions: [],
        expectedParentLocators: ["data/courses/layout-design/source.md"],
        forbiddenNodeIds: [],
        forbiddenAssetPaths: [],
      },
    };
    const withoutParent = scoreRetrievalCase(combinedCase, resultFor(combinedCase, {
      hits: [
        { kind: "NODE", key: "layout-primary", rank: 1 },
        { kind: "ASSET", key: "assets/layout-design/evidence.png", rank: 1 },
      ],
    }));
    const complete = scoreRetrievalCase(combinedCase, resultFor(combinedCase, {
      hits: [
        { kind: "NODE", key: "layout-primary", rank: 1 },
        { kind: "ASSET", key: "assets/layout-design/evidence.png", rank: 1 },
      ],
      parentLocators: ["data/courses/layout-design/source.md"],
    }));

    expect(withoutParent.combinedEvidencePass).toBe(false);
    expect(complete.combinedEvidencePass).toBe(true);
    expect(summarizeRetrievalScores([complete]).overall).toMatchObject({
      nodePrecisionAt5: 0.2,
      assetPrecisionAt5: 0.2,
      parentCoverage: 1,
      combinedEvidencePassRate: 1,
    });
  });

  it("scores required visual regions by asset, coordinate space, rank, and IoU", () => {
    const regionCase: RetrievalGoldenCase = {
      ...textCase,
      id: "text-image-region",
      mode: "TEXT_TO_IMAGE",
      targets: {
        ...textCase.targets,
        nodes: [],
        assets: [{
          path: "assets/layout-design/evidence.png",
          sha256: "a".repeat(64),
          relevance: 3,
          required: true,
        }],
        regions: [{
          assetPath: "assets/layout-design/evidence.png",
          bbox: [0.1, 0.2, 0.4, 0.5],
          coordinateSpace: "NORMALIZED",
          relevance: 3,
          required: true,
        }],
        forbiddenNodeIds: [],
      },
    };
    const matched = scoreRetrievalCase(regionCase, resultFor(regionCase, {
      hits: [{
        kind: "ASSET",
        key: "assets/layout-design/evidence.png",
        rank: 1,
        region: {
          bbox: [0.12, 0.22, 0.38, 0.48],
          coordinateSpace: "NORMALIZED",
          origin: "INDEXED_REGION",
        },
      }],
    }));
    const wrongSpace = scoreRetrievalCase(regionCase, resultFor(regionCase, {
      hits: [{
        kind: "ASSET",
        key: "assets/layout-design/evidence.png",
        rank: 1,
        region: {
          bbox: [10, 20, 40, 50],
          coordinateSpace: "PIXELS",
          origin: "INDEXED_REGION",
        },
      }],
    }));

    expect(matched.regionRecallAt5).toBe(1);
    expect(wrongSpace.regionRecallAt5).toBe(0);
    expect(summarizeRetrievalScores([matched]).overall.regionRecallAt5).toBe(1);
  });

  it("summarizes by source course and course-mode with component metrics and rates", () => {
    const timeoutScore = scoreRetrievalCase(textCase, resultFor(textCase, {
      status: "TIMEOUT",
      hits: [],
      latencyMs: 50,
    }));
    const degradedScore = scoreRetrievalCase({
      ...textCase,
      id: "text-layout-degraded",
    }, resultFor({
      ...textCase,
      id: "text-layout-degraded",
    }, {
      caseId: "text-layout-degraded",
      degradedFrom: "SEMANTIC",
      degradationSucceeded: true,
    }));
    const errorCase: RetrievalGoldenCase = {
      ...textCase,
      id: "text-brand-error",
      expectedSourceCoursePackId: "brand-vi-design",
      expectedLegacyPlacementCoursePackId: "brand-vi-design",
      query: {
        ...textCase.query,
        coursePackId: "brand-vi-design",
      },
    };
    const errorScore = scoreRetrievalCase(errorCase, resultFor(errorCase, {
      status: "ERROR",
      hits: [],
    }));
    const summary = summarizeRetrievalScores([timeoutScore, degradedScore, errorScore]);

    expect(degradedScore.queryCoursePackId).toBe("layout-design");
    expect(summary.overall).toMatchObject({
      timeoutRate: 0.333333,
      errorRate: 0.333333,
      degradationSuccessRate: 1,
      nodePrecisionAt5: 0.2,
      assetPrecisionAt5: null,
    });
    expect(summary.byQueryCoursePack["layout-design"].attempted).toBe(2);
    expect(summary.byExpectedSourceCoursePack["brand-vi-design"].attempted).toBe(1);
    expect(
      summary.byQueryCoursePackAndMode["layout-design"].TEXT_TO_TEXT.attempted,
    ).toBe(2);
    expect(
      summary.byQueryCoursePackAndMode["layout-design"].TEXT_TO_IMAGE.attempted,
    ).toBe(0);
  });
});
