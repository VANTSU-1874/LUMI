// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  assembleEvidenceBundleV2,
  type EvidenceChannelV2,
  type EvidenceExpansionV2,
  type EvidenceProvenanceV2,
} from "../../../lib/knowledge/evidence-bundle-v2";
import {
  ObjectConsensusTraceV2Schema,
  TEXT_OBJECT_CONSENSUS_CONFIG_HASH_V2,
} from "../../../lib/knowledge/object-candidate-v2";
import {
  applyPostFusionAcceptanceV2,
  fuseRankedChannelsV2,
} from "../../../lib/knowledge/rank-fusion-v2";
import type { RetrievalQueryV2 } from "../../../lib/knowledge/retrieval-query-v2";
import {
  T42_OBJECT_RECALL_MISSING_TRACE_REASON,
  T42_OBJECT_RECALL_UNAVAILABLE_REASON,
  T42_RECALL_GATE_THRESHOLDS,
  T42_RUNTIME_QUERY_KEYS,
  evaluateT42Recall,
  scoreT42RecallCase,
} from "../../../tools/mixed-retrieval/t42-recall-evaluator";
import {
  T42_RECALL_CORPUS_BUNDLE_SHA256,
  T42RecallCaseSchema,
  loadT42RecallSuite,
} from "../../../tools/mixed-retrieval/t42-recall-loader";

const ACTIVE_INDEX_HASH = "b".repeat(64);
const CONFIG_HASH = "c".repeat(64);
const PAYLOAD_HASH = "d".repeat(64);
const TEXT_INDEX_HASH = "e".repeat(64);

const DEV_PATH = join(
  process.cwd(),
  "tests",
  "retrieval-quality",
  "t42-recall-dev.json",
);

function loadDev() {
  return loadT42RecallSuite(readFileSync(DEV_PATH));
}

function channelIdentity(channel: EvidenceChannelV2["channel"]) {
  return {
    activeIndexBundleHash: ACTIVE_INDEX_HASH,
    providerIndexBundleHash:
      channel === "LEXICAL" ? null : TEXT_INDEX_HASH,
    indexVersionId: `${channel.toLowerCase().replace("_", "-")}-index`,
    modelId:
      channel === "LEXICAL" ? null : "example/immutable-model",
    modelRevision:
      channel === "LEXICAL" ? null : "immutable-model-revision",
    configHash: CONFIG_HASH,
    payloadHashes: [PAYLOAD_HASH],
  };
}

function channels(hasHits: boolean): EvidenceChannelV2[] {
  return [
    {
      channel: "LEXICAL",
      status: hasHits ? "SUCCESS" : "EMPTY",
      reason: null,
      corpusBundleHash: T42_RECALL_CORPUS_BUNDLE_SHA256,
      identity: channelIdentity("LEXICAL"),
      hitCount: hasHits ? 1 : 0,
      timingMs: 1,
    },
    {
      channel: "TEXT_VECTOR",
      status: hasHits ? "SUCCESS" : "EMPTY",
      reason: null,
      corpusBundleHash: T42_RECALL_CORPUS_BUNDLE_SHA256,
      identity: channelIdentity("TEXT_VECTOR"),
      hitCount: hasHits ? 1 : 0,
      timingMs: 2,
    },
    {
      channel: "VISUAL_VECTOR",
      status: "SKIPPED",
      reason: "MODE_NOT_APPLICABLE",
      corpusBundleHash: T42_RECALL_CORPUS_BUNDLE_SHA256,
      identity: null,
      hitCount: 0,
      timingMs: 0,
    },
  ];
}

function objectConsensus(objectIds: readonly string[]) {
  return ObjectConsensusTraceV2Schema.parse({
    configHash: TEXT_OBJECT_CONSENSUS_CONFIG_HASH_V2,
    applied: false,
    objectRanking: objectIds.map((objectId, index) => ({
      objectId,
      rank: index + 1,
      combinedScore: 2 / (61 + index),
      commonTextNodeIds: [],
      selectedNodeId: null,
      channels: [
        {
          channel: "LEXICAL",
          sourceObjectRank: index + 1,
          rawScore: 10 - index / 10,
        },
        {
          channel: "TEXT_VECTOR",
          sourceObjectRank: index + 1,
          rawScore: 1 - index / 100,
        },
      ],
    })),
    candidates: [],
  });
}

function makeBundle(
  query: RetrievalQueryV2,
  options: {
    status?: "SUCCESS" | "DEGRADED" | "EMPTY" | "UNSUPPORTED";
    primaryObjectId?: string;
    primaryNodeId?: string;
    retainedSiblingNodeIds?: string[];
    objectRanking?: string[];
    latencyMs?: number;
  } = {},
) {
  const status = options.status ?? "SUCCESS";
  const hasPrimary =
    options.primaryObjectId !== undefined &&
    options.primaryNodeId !== undefined;
  const fused = hasPrimary
    ? fuseRankedChannelsV2({
        LEXICAL: [
          {
            candidateId: options.primaryNodeId!,
            objectId: options.primaryObjectId!,
            representationId: null,
            nodeId: options.primaryNodeId!,
            assetId: null,
            region: null,
            rank: 1,
            rawScore: 10,
          },
        ],
        TEXT_VECTOR: [
          {
            candidateId: options.primaryNodeId!,
            objectId: options.primaryObjectId!,
            representationId: "representation-fixture",
            nodeId: options.primaryNodeId!,
            assetId: null,
            region: null,
            rank: 1,
            rawScore: 0.9,
          },
        ],
      })
    : [];
  const acceptance = applyPostFusionAcceptanceV2(
    "TEXT_TO_TEXT",
    fused,
  ).trace;
  const sourceCoursePack = query.scope.sourceCoursePack!;
  const sourceId = "source-fixture";
  const parentNodeId = "node-parent-fixture";
  const expansion: EvidenceExpansionV2 = hasPrimary
    ? {
        nodes: [
          {
            nodeId: options.primaryNodeId!,
            objectId: options.primaryObjectId!,
            kind: "TEXT",
            relation: "PRIMARY",
            seedCandidateId: options.primaryNodeId!,
            parentNodeId,
            sourceId,
            sourceCoursePack,
            excerpt: "fixture primary evidence",
            assetId: null,
          },
          ...(options.retainedSiblingNodeIds ?? []).map((nodeId) => ({
            nodeId,
            objectId: options.primaryObjectId!,
            kind: "TEXT" as const,
            relation: "SIBLING" as const,
            seedCandidateId: options.primaryNodeId!,
            parentNodeId,
            sourceId,
            sourceCoursePack,
            excerpt: "fixture retained sibling evidence",
            assetId: null,
          })),
        ],
        assets: [],
        regions: [],
        sources: [
          {
            sourceId,
            objectId: options.primaryObjectId!,
            authority: "COURSE_DESIGN",
            verifiedDate: "2026-07-28",
            scope: "T4.2 evaluator fixture.",
            locators: [
              {
                kind: "LOCAL_DOCUMENT",
                path: "data/knowledge/t42-evaluator-fixture.md",
              },
            ],
          },
        ],
      }
    : { nodes: [], assets: [], regions: [], sources: [] };
  const provenance: EvidenceProvenanceV2 = {
    corpusBundleHash: T42_RECALL_CORPUS_BUNDLE_SHA256,
    activeIndexBundleHash: ACTIVE_INDEX_HASH,
    relationConfigHash: CONFIG_HASH,
    normalizerConfigHash: CONFIG_HASH,
    rrfConfigHash: CONFIG_HASH,
    acceptancePolicyHash: acceptance.policyConfigHash,
    graphExpansion: "POST_FUSION",
    externalVerification: {
      required: false,
      claimKinds: [],
      authorized: true,
      matchedSourceIds: [],
      matchedSources: [],
      reason: "NOT_REQUIRED",
    },
    fallbackTriggers: [],
    capabilitiesLost: [],
  };
  const latencyMs = options.latencyMs ?? 5;
  return assembleEvidenceBundleV2({
    status,
    query,
    channels: channels(hasPrimary),
    fused,
    acceptance,
    ...(options.objectRanking
      ? { objectConsensus: objectConsensus(options.objectRanking) }
      : {}),
    expansion,
    provenance,
    timing: {
      retrievalMs: Math.max(0, latencyMs - 1),
      expansionMs: hasPrimary ? 1 : 0,
      totalMs: latencyMs,
    },
  });
}

function oracleProvider(input: {
  arm: "A0_EXACT_NODE" | "B_OBJECT_CONSENSUS";
  recallMissCaseIds?: ReadonlySet<string>;
  noAnswerFailureCaseIds?: ReadonlySet<string>;
  missingRankingCaseIds?: ReadonlySet<string>;
}) {
  const loaded = loadDev();
  const byQuestion = new Map(
    loaded.suite.cases.map((testCase) => [
      testCase.runtime.question,
      testCase,
    ]),
  );
  const retrieve = vi.fn(async (query: Readonly<RetrievalQueryV2>) => {
    const testCase = byQuestion.get(query.originalText ?? "");
    if (!testCase) throw new Error("unexpected T4.2 query");
    if (testCase.expected.expectation === "NO_ANSWER") {
      if (input.noAnswerFailureCaseIds?.has(testCase.id)) {
        return makeBundle(query, {
          status: "SUCCESS",
          primaryObjectId: "wrong-negative-object",
          primaryNodeId: `node-${"f".repeat(64)}`,
          ...(input.arm === "B_OBJECT_CONSENSUS"
            ? { objectRanking: ["wrong-negative-object"] }
            : {}),
        });
      }
      return makeBundle(query, { status: "EMPTY" });
    }

    const targetObjectId = testCase.expected.targetObjectIds[0]!;
    const requiredNodeId =
      testCase.expected.requiredEvidenceGroups[0]![0]!;
    const missingRanking =
      input.missingRankingCaseIds?.has(testCase.id) ?? false;
    const recallMiss =
      input.recallMissCaseIds?.has(testCase.id) ?? false;
    return makeBundle(query, {
      status: "SUCCESS",
      primaryObjectId: targetObjectId,
      primaryNodeId: requiredNodeId,
      ...(input.arm === "B_OBJECT_CONSENSUS" && !missingRanking
        ? {
            objectRanking: [
              recallMiss ? "wrong-recalled-object" : targetObjectId,
            ],
          }
        : {}),
    });
  });
  return { loaded, retrieve };
}

function syntheticCase(requiredEvidenceGroups: string[][]) {
  return T42RecallCaseSchema.parse({
    id: "t42-recall-dev-synthetic-answerable",
    familyId: "t42-family-synthetic-answerable",
    clusterId: "t42-cluster-synthetic-answerable",
    runtime: {
      mode: "TEXT_TO_TEXT",
      coursePackId: "general-design",
      coursePackVersion: "1",
      question: "合成评测问题",
    },
    expected: {
      expectation: "ANSWERABLE",
      targetObjectIds: ["target-object"],
      requiredEvidenceGroups,
    },
  });
}

describe("T4.2 recall evaluator", () => {
  it("scores the B oracle and sends only one frozen RetrievalQueryV2", async () => {
    const { loaded, retrieve } = oracleProvider({
      arm: "B_OBJECT_CONSENSUS",
    });

    const report = await evaluateT42Recall({
      loadedSuite: loaded,
      arm: "B_OBJECT_CONSENSUS",
      provider: {
        async retrieve(query) {
          expect(Object.isFrozen(query)).toBe(true);
          expect(Object.isFrozen(query.scope)).toBe(true);
          expect(Object.keys(query).sort()).toEqual(
            [...T42_RUNTIME_QUERY_KEYS].sort(),
          );
          expect(Object.hasOwn(query, "expected")).toBe(false);
          expect(Object.hasOwn(query, "expectation")).toBe(false);
          expect(Object.hasOwn(query, "familyId")).toBe(false);
          expect(Object.hasOwn(query, "clusterId")).toBe(false);
          expect(Object.hasOwn(query, "targetObjectIds")).toBe(false);
          expect(
            Object.hasOwn(query, "requiredEvidenceGroups"),
          ).toBe(false);
          return retrieve(query);
        },
      },
      generatedAt: "2026-07-28T00:00:00.000Z",
    });

    expect(report.reportPassed).toBe(true);
    expect(report.aggregates.overall).toMatchObject({
      total: 40,
      answerable: 25,
      noAnswer: 15,
      objectRecallAt10: {
        availability: "AVAILABLE",
        eligible: 25,
        available: 25,
        passed: 25,
        passRate: 1,
      },
      primaryObjectHit: { eligible: 25, passed: 25 },
      firstPrimaryObjectHit: { eligible: 25, passed: 25 },
      requiredEvidenceGroupsCovered: {
        eligible: 25,
        passed: 25,
      },
      retainedEvidenceGroupsCovered: {
        eligible: 25,
        passed: 25,
      },
      noAnswerEmptyNoPrimary: { eligible: 15, passed: 15 },
    });
    expect(
      Object.values(report.aggregates.byPack).map(
        ({ total, answerable, noAnswer }) => ({
          total,
          answerable,
          noAnswer,
        }),
      ),
    ).toEqual(
      Array.from({ length: 5 }, () => ({
        total: 8,
        answerable: 5,
        noAnswer: 3,
      })),
    );
    expect(report.leakageAudit).toMatchObject({
      passed: true,
      providerCallArgumentCount: 1,
      expectedSentToProvider: false,
      familyIdSentToProvider: false,
      clusterIdSentToProvider: false,
      targetObjectIdsSentToProvider: false,
      requiredEvidenceGroupsSentToProvider: false,
      coursePackIdSentOnlyInQueryScope: true,
      questionsIncludedInReport: false,
      violations: [],
    });
    expect(retrieve).toHaveBeenCalledTimes(40);
    expect(retrieve.mock.calls.every((call) => call.length === 1)).toBe(
      true,
    );
    expect(JSON.stringify(report)).not.toContain(
      loaded.suite.cases[0].runtime.question,
    );
  });

  it("marks A0 object Recall@10 unavailable without hiding its other metrics", async () => {
    const { loaded, retrieve } = oracleProvider({
      arm: "A0_EXACT_NODE",
    });
    const report = await evaluateT42Recall({
      loadedSuite: loaded,
      arm: "A0_EXACT_NODE",
      provider: { retrieve },
      generatedAt: "2026-07-28T00:00:00.000Z",
    });

    expect(report.reportPassed).toBe(false);
    expect(report.aggregates.overall.objectRecallAt10).toMatchObject({
      eligible: 25,
      available: 0,
      unavailable: 25,
      availability: "UNAVAILABLE",
      unavailableReason: T42_OBJECT_RECALL_UNAVAILABLE_REASON,
      passed: 0,
      passRate: null,
    });
    expect(report.aggregates.overall.primaryObjectHit.passed).toBe(25);
    expect(
      report.aggregates.overall.requiredEvidenceGroupsCovered.passed,
    ).toBe(25);
    expect(
      report.aggregates.overall.noAnswerEmptyNoPrimary.passed,
    ).toBe(15);
    expect(
      report.gates.results.find(
        ({ metric }) => metric === "OBJECT_RECALL_AT_10",
      ),
    ).toMatchObject({
      observed: null,
      passed: false,
      reason: T42_OBJECT_RECALL_UNAVAILABLE_REASON,
    });
    expect(
      report.gates.results.find(
        ({ metric }) => metric === "OBJECT_RANKING_TRACE",
      ),
    ).toMatchObject({ passed: true, observed: 0 });
  });

  it("fails closed when a B answerable case lacks objectRanking", async () => {
    const loaded = loadDev();
    const missingCase = loaded.suite.cases.find(
      (testCase) =>
        testCase.expected.expectation === "ANSWERABLE",
    )!;
    const { retrieve } = oracleProvider({
      arm: "B_OBJECT_CONSENSUS",
      missingRankingCaseIds: new Set([missingCase.id]),
    });

    const report = await evaluateT42Recall({
      loadedSuite: loaded,
      arm: "B_OBJECT_CONSENSUS",
      provider: { retrieve },
      generatedAt: "2026-07-28T00:00:00.000Z",
    });

    expect(report.reportPassed).toBe(false);
    expect(report.aggregates.overall.objectRecallAt10).toMatchObject({
      availability: "PARTIAL",
      available: 24,
      unavailable: 1,
      passed: 24,
      failed: 1,
    });
    expect(report.runtimeAudit.missingObjectRankingCaseIds).toEqual([
      missingCase.id,
    ]);
    expect(
      report.cases.find(({ caseId }) => caseId === missingCase.id),
    ).toMatchObject({
      objectRecallAt10: null,
      objectRecallAt10Reason:
        T42_OBJECT_RECALL_MISSING_TRACE_REASON,
      pass: false,
      outcome: "ANSWERABLE_OBJECT_RANKING_UNAVAILABLE",
    });
    expect(
      report.gates.results.find(
        ({ metric }) => metric === "OBJECT_RANKING_TRACE",
      ),
    ).toMatchObject({ observed: 1, required: 0, passed: false });
  });

  it("keeps object, primary and evidence-group scoring orthogonal", () => {
    const nodeA = `node-${"a".repeat(64)}`;
    const nodeB = `node-${"b".repeat(64)}`;
    const nodeC = `node-${"c".repeat(64)}`;
    const testCase = syntheticCase([[nodeA, nodeB], [nodeC]]);
    const query = {
      schemaVersion: 2 as const,
      mode: "TEXT_TO_TEXT" as const,
      originalText: "合成评测问题",
      normalizedText: "合成评测问题",
      queryAsset: null,
      scope: {
        corpusBundleHash: T42_RECALL_CORPUS_BUNDLE_SHA256,
        sourceCoursePack: {
          id: "general-design" as const,
          version: "1" as const,
        },
      },
      excludeAssetIds: [],
    };

    const siblingOnly = makeBundle(query, {
      primaryObjectId: "target-object",
      primaryNodeId: nodeB,
      retainedSiblingNodeIds: [nodeC],
      objectRanking: ["target-object"],
    });
    expect(
      scoreT42RecallCase(
        testCase,
        siblingOnly,
        "B_OBJECT_CONSENSUS",
      ),
    ).toMatchObject({
      objectRecallAt10: true,
      primaryObjectHit: true,
      requiredEvidenceGroupsCovered: false,
      retainedEvidenceGroupsCovered: true,
      pass: false,
      outcome: "ANSWERABLE_REQUIRED_EVIDENCE_MISS",
    });

    const wrongPrimary = makeBundle(query, {
      primaryObjectId: "wrong-primary-object",
      primaryNodeId: nodeA,
      objectRanking: ["target-object"],
    });
    expect(
      scoreT42RecallCase(
        syntheticCase([[nodeA]]),
        wrongPrimary,
        "B_OBJECT_CONSENSUS",
      ),
    ).toMatchObject({
      objectRecallAt10: true,
      primaryObjectHit: false,
      pass: false,
      outcome: "ANSWERABLE_PRIMARY_OBJECT_MISS",
    });

    const recallMiss = makeBundle(query, {
      primaryObjectId: "target-object",
      primaryNodeId: nodeA,
      objectRanking: ["wrong-recalled-object"],
    });
    expect(
      scoreT42RecallCase(
        syntheticCase([[nodeA]]),
        recallMiss,
        "B_OBJECT_CONSENSUS",
      ),
    ).toMatchObject({
      objectRecallAt10: false,
      primaryObjectHit: true,
      pass: false,
      outcome: "ANSWERABLE_OBJECT_RECALL_MISS",
    });
  });

  it("requires healthy EMPTY with no primary for NO_ANSWER", () => {
    const testCase = T42RecallCaseSchema.parse({
      id: "t42-recall-dev-synthetic-no-answer",
      familyId: "t42-family-synthetic-no-answer",
      clusterId: "t42-cluster-synthetic-no-answer",
      runtime: {
        mode: "TEXT_TO_TEXT",
        coursePackId: "general-design",
        coursePackVersion: "1",
        question: "不可回答的合成问题",
      },
      expected: {
        expectation: "NO_ANSWER",
        targetObjectIds: [],
        requiredEvidenceGroups: [],
      },
    });
    const query = {
      schemaVersion: 2 as const,
      mode: "TEXT_TO_TEXT" as const,
      originalText: "不可回答的合成问题",
      normalizedText: "不可回答的合成问题",
      queryAsset: null,
      scope: {
        corpusBundleHash: T42_RECALL_CORPUS_BUNDLE_SHA256,
        sourceCoursePack: {
          id: "general-design" as const,
          version: "1" as const,
        },
      },
      excludeAssetIds: [],
    };

    expect(
      scoreT42RecallCase(
        testCase,
        makeBundle(query, { status: "EMPTY" }),
        "B_OBJECT_CONSENSUS",
      ),
    ).toMatchObject({
      pass: true,
      noAnswerEmptyNoPrimary: true,
      outcome: "NO_ANSWER_EMPTY_NO_PRIMARY",
    });
    expect(
      scoreT42RecallCase(
        testCase,
        makeBundle(query, { status: "UNSUPPORTED" }),
        "B_OBJECT_CONSENSUS",
      ),
    ).toMatchObject({
      pass: false,
      noAnswerEmptyNoPrimary: false,
      outcome: "NO_ANSWER_EXPECTED_EMPTY_NO_PRIMARY",
    });
  });

  it("enforces the preregistered 24/25 and 14/15 boundaries", async () => {
    expect(T42_RECALL_GATE_THRESHOLDS).toEqual({
      objectRecallAt10: { required: 24, total: 25 },
      noAnswer: { required: 14, total: 15 },
      retrievalP95Ms: 500,
    });

    const loaded = loadDev();
    const answerableIds = loaded.suite.cases
      .filter(
        (testCase) =>
          testCase.expected.expectation === "ANSWERABLE",
      )
      .map(({ id }) => id);
    const noAnswerIds = loaded.suite.cases
      .filter(
        (testCase) =>
          testCase.expected.expectation === "NO_ANSWER",
      )
      .map(({ id }) => id);

    const atBoundary = oracleProvider({
      arm: "B_OBJECT_CONSENSUS",
      recallMissCaseIds: new Set(answerableIds.slice(0, 1)),
      noAnswerFailureCaseIds: new Set(noAnswerIds.slice(0, 1)),
    });
    const passing = await evaluateT42Recall({
      loadedSuite: atBoundary.loaded,
      arm: "B_OBJECT_CONSENSUS",
      provider: { retrieve: atBoundary.retrieve },
    });
    expect(passing.gates.qualityPassed).toBe(true);
    expect(passing.reportPassed).toBe(true);

    const belowBoundary = oracleProvider({
      arm: "B_OBJECT_CONSENSUS",
      recallMissCaseIds: new Set(answerableIds.slice(0, 2)),
      noAnswerFailureCaseIds: new Set(noAnswerIds.slice(0, 2)),
    });
    const failing = await evaluateT42Recall({
      loadedSuite: belowBoundary.loaded,
      arm: "B_OBJECT_CONSENSUS",
      provider: { retrieve: belowBoundary.retrieve },
    });
    expect(failing.gates.qualityPassed).toBe(false);
    expect(failing.reportPassed).toBe(false);
    expect(
      failing.gates.results.find(
        ({ metric }) => metric === "OBJECT_RECALL_AT_10",
      ),
    ).toMatchObject({ observed: 23, required: 24, passed: false });
    expect(
      failing.gates.results.find(
        ({ metric }) => metric === "NO_ANSWER_EMPTY_NO_PRIMARY",
      ),
    ).toMatchObject({ observed: 13, required: 14, passed: false });
  });

  it("rejects a forged loaded-suite digest before provider execution", async () => {
    const loaded = loadDev();
    const retrieve = vi.fn();

    await expect(
      evaluateT42Recall({
        loadedSuite: {
          ...loaded,
          suiteSha256: "0".repeat(64),
        },
        arm: "B_OBJECT_CONSENSUS",
        provider: { retrieve },
      }),
    ).rejects.toThrow(/unfrozen DEV suite digest/);
    expect(retrieve).not.toHaveBeenCalled();
  });
});
