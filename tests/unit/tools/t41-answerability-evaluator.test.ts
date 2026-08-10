// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { RetrievalQueryV2 } from "../../../lib/knowledge/retrieval-query-v2";
import {
  T41_ANSWERABILITY_GATE_THRESHOLDS,
  T41_RUNTIME_QUERY_KEYS,
  evaluateT41Answerability,
  scoreT41AnswerabilityCase,
  type T41ProviderObservation,
  type T41ProviderStatus,
  type T41RuntimeIdentity,
} from "../../../tools/mixed-retrieval/t41-answerability-evaluator";
import {
  T41AnswerabilityCaseSchema,
  loadT41AnswerabilitySuite,
} from "../../../tools/mixed-retrieval/t41-answerability-loader";

const CORPUS_HASH = "a".repeat(64);
const ACTIVE_INDEX_HASH = "b".repeat(64);
const CONFIG_HASH = "c".repeat(64);
const PAYLOAD_HASH = "d".repeat(64);
const TEXT_INDEX_HASH = "e".repeat(64);
const VISUAL_INDEX_HASH = "f".repeat(64);

const DEV_PATH = join(
  process.cwd(),
  "tests",
  "retrieval-quality",
  "t41-answerability-dev.json",
);

function loadDev() {
  return loadT41AnswerabilitySuite(readFileSync(DEV_PATH), {
    expectedSplit: "DEV",
  });
}

function runtimeIdentity(
  activeIndexBundleHash = ACTIVE_INDEX_HASH,
): T41RuntimeIdentity {
  return {
    runtimeKind: "EVIDENCE_BUNDLE_V2",
    bundleSchemaVersion: 2,
    corpusBundleHash: CORPUS_HASH,
    activeIndexBundleHash,
    relationConfigHash: "5".repeat(64),
    normalizerConfigHash: "6".repeat(64),
    rrfConfigHash: "7".repeat(64),
    capabilityEntityManifestHash: "1".repeat(64),
    packCompetitionPolicyHash: "2".repeat(64),
    packCompetitionCalibrationHash: "3".repeat(64),
    lexicalPackCompetitionAlgorithmHash: "8".repeat(64),
    textPackCompetitionAlgorithmHash: "9".repeat(64),
    acceptancePolicyHash: "4".repeat(64),
    channels: [
      {
        channel: "LEXICAL",
        identity: {
          activeIndexBundleHash,
          providerIndexBundleHash: null,
          indexVersionId: "lexical-v1",
          modelId: null,
          modelRevision: null,
          configHash: CONFIG_HASH,
          payloadHashes: [PAYLOAD_HASH],
        },
      },
      {
        channel: "TEXT_VECTOR",
        identity: {
          activeIndexBundleHash,
          providerIndexBundleHash: TEXT_INDEX_HASH,
          indexVersionId: "text-vector-v1",
          modelId: "example/text-model",
          modelRevision: "immutable-text-revision",
          configHash: CONFIG_HASH,
          payloadHashes: [PAYLOAD_HASH],
        },
      },
      {
        channel: "VISUAL_VECTOR",
        identity: {
          activeIndexBundleHash,
          providerIndexBundleHash: VISUAL_INDEX_HASH,
          indexVersionId: "visual-vector-v1",
          modelId: "example/visual-model",
          modelRevision: "immutable-visual-revision",
          configHash: CONFIG_HASH,
          payloadHashes: [PAYLOAD_HASH],
        },
      },
    ],
  };
}

function observation(
  status: T41ProviderStatus,
  objectIds: string[],
  identity = runtimeIdentity(),
): T41ProviderObservation {
  return {
    status,
    objectIds,
    identity,
    latencyMs: 5,
  };
}

describe("T4.1 answerability evaluator", () => {
  it("passes the DEV oracle while sending only RetrievalQueryV2 to provider", async () => {
    const loaded = loadDev();
    const oracle = new Map(
      loaded.suite.cases.map((testCase) => [
        `${testCase.coursePackId}\u0000${testCase.question}`,
        testCase.expectation === "ANSWERABLE"
          ? observation("SUCCESS", [testCase.targetObjectIds[0]])
          : observation("EMPTY", []),
      ]),
    );

    const retrieve = vi.fn(async (query: Readonly<RetrievalQueryV2>) => {
      expect(Object.isFrozen(query)).toBe(true);
      expect(Object.isFrozen(query.scope)).toBe(true);
      expect(Object.isFrozen(query.scope.sourceCoursePack)).toBe(true);
      expect(Object.keys(query).sort()).toEqual(
        [...T41_RUNTIME_QUERY_KEYS].sort(),
      );
      expect(Object.hasOwn(query, "category")).toBe(false);
      expect(Object.hasOwn(query, "expectation")).toBe(false);
      expect(Object.hasOwn(query, "familyId")).toBe(false);
      expect(Object.hasOwn(query, "reasonClass")).toBe(false);
      expect(Object.hasOwn(query, "targetObjectIds")).toBe(false);

      const coursePackId = query.scope.sourceCoursePack?.id;
      const result = oracle.get(
        `${coursePackId}\u0000${query.originalText}`,
      );
      if (!result) throw new Error("unexpected query");
      return result;
    });

    const report = await evaluateT41Answerability({
      loadedSuite: loaded,
      corpusBundleHash: CORPUS_HASH,
      provider: { retrieve },
      generatedAt: "2026-07-28T00:00:00.000Z",
    });

    expect(report.reportPassed).toBe(true);
    expect(report.aggregates.overall).toMatchObject({
      total: 60,
      passed: 60,
      failed: 0,
      passRate: 1,
    });
    expect(report.aggregates.overall.answerable).toMatchObject({
      total: 20,
      passed: 20,
    });
    expect(report.aggregates.overall.noAnswer).toMatchObject({
      total: 40,
      passed: 40,
    });
    expect(report.aggregates.bySplit.DEV?.total).toBe(60);
    expect(report.aggregates.bySplit.HELDOUT).toBeNull();
    expect(
      Object.values(report.aggregates.byPack).map(({ total }) => total),
    ).toEqual([12, 12, 12, 12, 12]);
    expect(report.aggregates.byCategory.ANSWERABLE_CONTROL.total).toBe(20);
    expect(
      report.aggregates.byCategory.EXTERNAL_VERIFICATION_REQUIRED.total,
    ).toBe(10);
    expect(report.cases).toHaveLength(60);
    expect(report.gates).toMatchObject({
      passed: true,
      qualityPassed: true,
      runtimeIntegrityPassed: true,
    });
    expect(report.gates.results).toHaveLength(17);
    expect(
      report.gates.results.find(
        ({ gateId }) => gateId === "quality-dev-no-answer",
      ),
    ).toMatchObject({
      observed: 40,
      required: 36,
      denominator: 40,
      passed: true,
    });
    expect(report.identityAudit).toMatchObject({
      consistentAcrossCases: true,
      corpusBundleHashMatchesQuery: true,
      uniqueIdentityCount: 1,
      violations: [],
    });
    expect(report.leakageAudit).toMatchObject({
      passed: true,
      providerCallArgumentCount: 1,
      groundTruthSentToProvider: false,
      categorySentToProvider: false,
      caseMetadataSentToProvider: false,
      questionsIncludedInReport: false,
      violations: [],
    });
    expect(retrieve).toHaveBeenCalledTimes(60);
    expect(retrieve.mock.calls.every((call) => call.length === 1)).toBe(true);
    expect(JSON.stringify(report)).not.toContain(
      loaded.suite.cases[0].question,
    );
  });

  it("uses the preregistered DEV gates rather than requiring 60/60", async () => {
    const loaded = loadDev();
    const failedNoAnswerIds = new Set<string>();
    const packsWithFailure = new Set<string>();
    for (const testCase of loaded.suite.cases) {
      if (
        failedNoAnswerIds.size < 4 &&
        testCase.expectation === "NO_ANSWER" &&
        testCase.category !== "EXTERNAL_VERIFICATION_REQUIRED" &&
        !packsWithFailure.has(testCase.coursePackId)
      ) {
        failedNoAnswerIds.add(testCase.id);
        packsWithFailure.add(testCase.coursePackId);
      }
    }
    const failedAnswerableId = loaded.suite.cases.find(
      (testCase) => testCase.expectation === "ANSWERABLE",
    )!.id;
    const byQuestion = new Map(
      loaded.suite.cases.map((testCase) => [
        testCase.question,
        testCase,
      ]),
    );

    const report = await evaluateT41Answerability({
      loadedSuite: loaded,
      corpusBundleHash: CORPUS_HASH,
      provider: {
        async retrieve(query) {
          const testCase = byQuestion.get(query.originalText ?? "")!;
          if (failedNoAnswerIds.has(testCase.id)) {
            return observation("SUCCESS", ["wrong-object"]);
          }
          if (testCase.id === failedAnswerableId) {
            return observation("EMPTY", []);
          }
          return testCase.expectation === "ANSWERABLE"
            ? observation("SUCCESS", [testCase.targetObjectIds[0]])
            : observation("EMPTY", []);
        },
      },
      generatedAt: "2026-07-28T00:00:00.000Z",
    });

    expect(failedNoAnswerIds.size).toBe(4);
    expect(report.aggregates.overall.failed).toBe(5);
    expect(report.reportPassed).toBe(true);
    expect(report.gates.qualityPassed).toBe(true);
    expect(
      report.gates.results.find(
        ({ gateId }) => gateId === "quality-dev-no-answer",
      ),
    ).toMatchObject({ observed: 36, required: 36, passed: true });
    expect(
      report.gates.results.find(
        ({ gateId }) => gateId === "quality-dev-answerable",
      ),
    ).toMatchObject({ observed: 19, required: 19, passed: true });
    expect(
      report.gates.results.find(
        ({ gateId }) =>
          gateId === "quality-dev-external-verification",
      ),
    ).toMatchObject({ observed: 10, required: 10, passed: true });
  });

  it("freezes the HELDOUT thresholds without loading or evaluating HELDOUT", () => {
    expect(T41_ANSWERABILITY_GATE_THRESHOLDS.HELDOUT).toEqual({
      noAnswer: { required: 18, total: 20 },
      answerable: { required: 9, total: 10 },
      perPackNoAnswer: { required: 3, total: 4 },
      perPackAnswerable: { required: 2, total: 2 },
      externalVerification: { required: 5, total: 5 },
    });
  });

  it("implements asymmetric scoring exactly", () => {
    const answerable = T41AnswerabilityCaseSchema.parse({
      id: "t41-dev-score-answerable",
      category: "ANSWERABLE_CONTROL",
      familyId: "dev-score-answerable",
      coursePackId: "general-design",
      question: "可回答测试问题",
      expectation: "ANSWERABLE",
      targetObjectIds: ["target-object"],
      reasonClass: "TARGET_OBJECT_PRESENT",
    });
    const noAnswer = T41AnswerabilityCaseSchema.parse({
      id: "t41-dev-score-no-answer",
      category: "PRODUCT_SCOPE_CORPUS_GAP",
      familyId: "dev-score-no-answer",
      coursePackId: "general-design",
      question: "不可回答测试问题",
      expectation: "NO_ANSWER",
      targetObjectIds: [],
      reasonClass: "OBJECT_NOT_IN_CORPUS",
    });

    expect(
      scoreT41AnswerabilityCase(
        answerable,
        observation("SUCCESS", ["target-object"]),
      ),
    ).toMatchObject({ pass: true, outcome: "ANSWERABLE_TARGET_HIT" });
    expect(
      scoreT41AnswerabilityCase(
        answerable,
        observation("DEGRADED", ["target-object"]),
      ),
    ).toMatchObject({ pass: true, outcome: "ANSWERABLE_TARGET_HIT" });
    expect(
      scoreT41AnswerabilityCase(
        answerable,
        observation("SUCCESS", ["wrong-object"]),
      ),
    ).toMatchObject({ pass: false, outcome: "ANSWERABLE_TARGET_MISS" });
    expect(
      scoreT41AnswerabilityCase(noAnswer, observation("EMPTY", [])),
    ).toMatchObject({ pass: true, outcome: "NO_ANSWER_EMPTY" });
    expect(
      scoreT41AnswerabilityCase(noAnswer, observation("UNSUPPORTED", [])),
    ).toMatchObject({
      pass: false,
      outcome: "NO_ANSWER_EXPECTED_EMPTY_STATUS",
    });
    expect(
      scoreT41AnswerabilityCase(
        noAnswer,
        observation("SUCCESS", ["some-object"]),
      ),
    ).toMatchObject({
      pass: false,
      outcome: "NO_ANSWER_EXPECTED_EMPTY_STATUS",
    });
  });

  it("fails the report when runtime identity drifts across cases", async () => {
    const loaded = loadDev();
    const firstQuestion = loaded.suite.cases[0].question;
    const answerByQuestion = new Map(
      loaded.suite.cases.map((testCase) => [
        testCase.question,
        testCase.expectation === "ANSWERABLE"
          ? observation("SUCCESS", [testCase.targetObjectIds[0]])
          : observation("EMPTY", []),
      ]),
    );

    const report = await evaluateT41Answerability({
      loadedSuite: loaded,
      corpusBundleHash: CORPUS_HASH,
      provider: {
        async retrieve(query) {
          const baseObservation = answerByQuestion.get(
            query.originalText ?? "",
          )!;
          const identity =
            query.originalText === firstQuestion
              ? runtimeIdentity("1".repeat(64))
              : runtimeIdentity();
          return observation(
            baseObservation.status,
            baseObservation.objectIds,
            identity,
          );
        },
      },
      generatedAt: "2026-07-28T00:00:00.000Z",
    });

    expect(report.aggregates.overall.failed).toBe(0);
    expect(report.reportPassed).toBe(false);
    expect(report.identityAudit.consistentAcrossCases).toBe(false);
    expect(report.identityAudit.uniqueIdentityCount).toBe(2);
    expect(report.identityAudit.violations).toContain(
      "expected one runtime identity, observed 2",
    );
  });

  it("fails the runtime gate on any ERROR or TIMEOUT even if quality thresholds pass", async () => {
    const loaded = loadDev();
    const timeoutCaseId = loaded.suite.cases.find(
      (testCase) =>
        testCase.expectation === "NO_ANSWER" &&
        testCase.category !== "EXTERNAL_VERIFICATION_REQUIRED",
    )!.id;
    const byQuestion = new Map(
      loaded.suite.cases.map((testCase) => [
        testCase.question,
        testCase,
      ]),
    );

    const report = await evaluateT41Answerability({
      loadedSuite: loaded,
      corpusBundleHash: CORPUS_HASH,
      provider: {
        async retrieve(query) {
          const testCase = byQuestion.get(query.originalText ?? "")!;
          if (testCase.id === timeoutCaseId) {
            return observation("TIMEOUT", []);
          }
          return testCase.expectation === "ANSWERABLE"
            ? observation("SUCCESS", [testCase.targetObjectIds[0]])
            : observation("EMPTY", []);
        },
      },
      generatedAt: "2026-07-28T00:00:00.000Z",
    });

    expect(report.gates.qualityPassed).toBe(true);
    expect(report.gates.runtimeIntegrityPassed).toBe(false);
    expect(report.reportPassed).toBe(false);
    expect(
      report.gates.results.find(
        ({ metric }) => metric === "ERROR_TIMEOUT_COUNT",
      ),
    ).toMatchObject({ observed: 1, required: 0, passed: false });
  });

  it("rejects provider output that tries to smuggle case labels back in", async () => {
    const loaded = loadDev();

    await expect(
      evaluateT41Answerability({
        loadedSuite: loaded,
        corpusBundleHash: CORPUS_HASH,
        provider: {
          async retrieve() {
            return {
              ...observation("EMPTY", []),
              expectation: "NO_ANSWER",
            };
          },
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses a forged loaded-suite digest before calling the provider", async () => {
    const loaded = loadDev();
    const retrieve = vi.fn();

    await expect(
      evaluateT41Answerability({
        loadedSuite: {
          ...loaded,
          suiteSha256: "0".repeat(64),
        },
        corpusBundleHash: CORPUS_HASH,
        provider: { retrieve },
      }),
    ).rejects.toThrow(/unfrozen suite digest/);
    expect(retrieve).not.toHaveBeenCalled();
  });
});
