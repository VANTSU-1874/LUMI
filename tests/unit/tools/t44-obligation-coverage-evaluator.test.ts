// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  AnswerObligationSetV1,
  QueryUnderstandingInputV1,
} from "@/lib/knowledge/answer-obligation-v1";
import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  T44_CLAIM_MATRIX_CONFIG_HASH_V1,
  T44_CLAIM_MATRIX_CONFIG_V1,
  T44ClaimMatrixSidecarOutputV1Schema,
} from "@/tools/mixed-retrieval/t44-claim-coverage-evaluator";
import {
  T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
  T44_OBLIGATION_CANDIDATE_CONFIG_V1,
  T44ObligationCandidateArtifactV1Schema,
} from "@/tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  buildT44BaselineProtectedObligationSelectionArtifactV2,
  evaluateT44LegacyEvidenceCaseV1,
  matchT44AnswerObligationsV1,
  sealT44ObligationSelectionArtifactV1,
  selectT44BaselineProtectedObligationNodesV2,
  selectT44ObligationNodesV1,
  verifyT44ObligationSelectionBindingsV1,
} from "@/tools/mixed-retrieval/t44-obligation-coverage-evaluator";

const HASH = "b".repeat(64);

function ranked(
  ids: readonly string[],
  objectId = "layout-object",
) {
  return ids.map((nodeId, index) => ({
    nodeId,
    objectId,
    coursePackId: "layout-design",
    score: 1 - index / 100,
    rank: index + 1,
  }));
}

function sha256(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function request(
  message = "字都挤在一起了，先改哪里，改完怎么判断好点了？",
): QueryUnderstandingInputV1 {
  return {
    schemaVersion: 1,
    currentMessage: {
      source: "CURRENT_MESSAGE",
      message,
      messageHash: sha256(message),
    },
    recentTurns: [],
    coursePack: {
      id: "layout-design",
      version: "1",
      label: "版式设计",
      summary: "以阅读任务、栅格、层级与留白检查版面。",
    },
    view: {
      id: "student-conversation",
      focus: "mentor",
    },
    hasArtwork: false,
    artworkHash: null,
  };
}

function obligationSet(
  input: QueryUnderstandingInputV1,
): AnswerObligationSetV1 {
  const message = input.currentMessage.message;
  return {
    schemaVersion: 1,
    plannerId: "lumi-answer-obligation-planner-v1",
    plannerVersion: "1.0.0",
    modelId: "gpt-5.6-test",
    normalizedQuestion: message,
    normalizedQuestionHash: sha256(message),
    status: "READY",
    obligations: [{
      obligationId: "obligation-1",
      learnerNeed: "确定第一步调整动作",
      intent: "FIRST_ACTION",
      sourceAnchors: [{
        source: "CURRENT_MESSAGE",
        sourceMessageHash:
          input.currentMessage.messageHash,
        quote: Array.from(message).slice(0, 8).join(""),
        startCodePoint: 0,
        endCodePoint: 8,
      }],
      entityMentions: [{
        surface: "字",
        normalized: "文字",
        anchorIndexes: [0],
      }],
      constraints: [],
      evidenceNeeds: ["DIRECT_TEXT"],
      retrievalQueries: [{
        text: "版面文字拥挤 第一处调整",
        purpose: "DIRECT",
      }],
      confidence: 0.92,
    }, {
      obligationId: "obligation-2",
      learnerNeed: "给出调整后的检查标准",
      intent: "CHECK_CRITERIA",
      sourceAnchors: [{
        source: "CURRENT_MESSAGE",
        sourceMessageHash:
          input.currentMessage.messageHash,
        quote: Array.from(message).slice(8).join(""),
        startCodePoint: 8,
        endCodePoint: Array.from(message).length,
      }],
      entityMentions: [],
      constraints: [],
      evidenceNeeds: ["DIRECT_TEXT"],
      retrievalQueries: [{
        text: "版面调整后 阅读层级 检查",
        purpose: "DIRECT",
      }],
      confidence: 0.91,
    }],
    clarifyingQuestion: null,
    artworkObservationHints: [],
    trace: {
      promptHash: HASH,
      outputHash: HASH,
      elapsedMs: 10,
    },
  };
}

describe("T4.4 obligation-aware selection", () => {
  it("builds a baseline-protected selection for a 20-case shared transport", () => {
    const caseIds = Array.from(
      { length: 20 },
      (_, index) => `t45-cal-case-${index + 1}`,
    );
    const emptyArm = {
      directEvidenceBatchHash: null,
      rrfResultHash: null,
      objectRanking: [],
      candidateNodes: [],
      candidateNodeIdsSha256:
        sha256StableJsonV2([]),
    };
    const candidate =
      T44ObligationCandidateArtifactV1Schema.parse({
        schemaVersion: 1,
        kind: "T44_OBLIGATION_CANDIDATES",
        runtimeSuite: {
          id: "lumi-t45-capability-calibration-runtime",
          version: "2026-07-29.1",
          suiteHash: HASH,
        },
        corpusSnapshot: {
          bundleHash: HASH,
        },
        config: T44_OBLIGATION_CANDIDATE_CONFIG_V1,
        configHash:
          T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
        graphifyInvocationCount: 0,
        providerAudit: {
          expectedCalls: 0,
          actualCalls: 0,
          channelCounts: {
            LEXICAL: 0,
            TEXT_VECTOR: 0,
            VISUAL_VECTOR: 0,
          },
          matched: true,
        },
        cases: caseIds.map((caseId) => ({
          caseId,
          coursePackId: "layout-design",
          coursePackVersion: "1",
          normalizedQuestionHash: HASH,
          obligationSetHash: HASH,
          retrievalPlanHash: HASH,
          arms: {
            A_WHOLE_QUERY: emptyArm,
            B_MODEL_GUIDED: emptyArm,
          },
        })),
      });
    const matrix =
      T44ClaimMatrixSidecarOutputV1Schema.parse({
        schemaVersion: 1,
        kind: "T44_CLAIM_NODE_MATRIX_SCORES",
        candidateInputSha256: HASH,
        runtimeSuite: candidate.runtimeSuite,
        corpusBundleHash:
          candidate.corpusSnapshot.bundleHash,
        config: T44_CLAIM_MATRIX_CONFIG_V1,
        configHash:
          T44_CLAIM_MATRIX_CONFIG_HASH_V1,
        model: {
          modelId: "BAAI/bge-small-zh-v1.5",
          modelRevision:
            "7999e1d3359715c523056ef9478215996d62a620",
          modelLicense: "MIT",
          modelDirectorySha256: HASH,
          modelSealSha256: HASH,
          indexBundleHash: HASH,
          indexPayloadSha256: HASH,
        },
        environment: {
          pythonVersion: "3.12.0",
          torchVersion: "test",
          transformersVersion: "test",
          safetensorsVersion: "test",
          actualDevice: "cpu",
          cudaRuntime: null,
          deviceName: null,
          tokenizerClassName: "TestTokenizer",
          modelClassName: "TestModel",
          modelDtype: "torch.float32",
        },
        timingProtocol: {
          warmupRunsPerModel: 1,
          repetitionsPerCase: 3,
          caseAggregate: "MEDIAN",
          suiteAggregate: "P95_NEAREST_RANK",
          aMatrixBoundary:
            T44_CLAIM_MATRIX_CONFIG_V1
              .aMatrixBoundary,
          bMatrixBoundary:
            T44_CLAIM_MATRIX_CONFIG_V1
              .bMatrixBoundary,
        },
        cases: caseIds.map((caseId) => ({
          caseId,
          coursePackId: "layout-design",
          candidateCount: 0,
          candidateNodeIdsSha256:
            sha256StableJsonV2([]),
          arms: {
            A_FULL_QUERY: {
              timingMs: {
                samples: [1, 1, 1],
                median: 1,
              },
              wholeQueryRanking: [],
            },
            B_CLAIM_MATRIX: {
              timingMs: {
                samples: [1, 1, 1],
                median: 1,
              },
              wholeQueryRanking: [],
              claimRankings: [{
                claimId: "obligation-1",
                textHash: HASH,
                ranking: [],
              }],
            },
          },
        })),
      });

    const selection =
      buildT44BaselineProtectedObligationSelectionArtifactV2({
        candidateArtifact: candidate,
        candidateArtifactSha256: HASH,
        matrixOutputSha256: HASH,
        aMatrixOutput: matrix,
        bMatrixOutput: matrix,
      });

    expect(
      selection.cases.map(({ caseId }) => caseId),
    ).toEqual(caseIds);
  });

  it("keeps the whole-query Top-8 unchanged when obligations add no rank lift", () => {
    const whole = ranked([
      "node-1", "node-2", "node-3", "node-4",
      "node-5", "node-6", "node-7", "node-8",
      "node-9", "node-10", "node-11", "node-12",
    ]);

    const selected =
      selectT44BaselineProtectedObligationNodesV2({
        wholeQueryRanking: whole,
        obligationRankings: [{
          obligationId: "obligation-1",
          ranking: whole,
        }],
      });

    expect(selected.map(({ nodeId }) => nodeId))
      .toEqual(whole.slice(0, 8).map(({ nodeId }) => nodeId));
    expect(selected.every(
      ({ selectionSource, obligationId }) =>
        selectionSource === "WHOLE_QUERY_BASELINE"
        && obligationId === null,
    )).toBe(true);
  });

  it("admits a genuine outside-Top-8 complement without evicting the protected prefix", () => {
    const wholeIds = [
      "node-1", "node-2", "node-3", "node-4",
      "node-5", "node-6", "node-7", "node-8",
      "node-9", "node-10", "node-11", "node-12",
    ];
    const selected =
      selectT44BaselineProtectedObligationNodesV2({
        wholeQueryRanking: ranked(wholeIds),
        obligationRankings: [{
          obligationId: "obligation-1",
          ranking: ranked([
            "node-9", "node-1", "node-2", "node-3",
            "node-4", "node-5", "node-6", "node-7",
            "node-8", "node-10", "node-11", "node-12",
          ]),
        }],
      });

    expect(selected.map(({ nodeId }) => nodeId))
      .toEqual([
        "node-1", "node-2", "node-3", "node-4",
        "node-5", "node-6", "node-7", "node-9",
      ]);
    expect(selected.at(-1)).toMatchObject({
      nodeId: "node-9",
      selectionSource: "OBLIGATION_COMPLEMENT",
      obligationId: "obligation-1",
    });
  });

  it("deduplicates complements across obligations and always protects four baseline nodes", () => {
    const wholeIds = [
      "node-1", "node-2", "node-3", "node-4",
      "node-5", "node-6", "node-7", "node-8",
      "node-9", "node-10", "node-11", "node-12",
    ];
    const obligationRanking = (
      first: string,
      second?: string,
    ) => ranked([
      first,
      ...(second ? [second] : []),
      ...wholeIds.filter(
        (nodeId) =>
          nodeId !== first && nodeId !== second,
      ),
    ]);
    const selected =
      selectT44BaselineProtectedObligationNodesV2({
        wholeQueryRanking: ranked(wholeIds),
        obligationRankings: [{
          obligationId: "obligation-1",
          ranking: obligationRanking("node-9"),
        }, {
          obligationId: "obligation-2",
          ranking: obligationRanking(
            "node-9",
            "node-10",
          ),
        }, {
          obligationId: "obligation-3",
          ranking: obligationRanking("node-11"),
        }, {
          obligationId: "obligation-4",
          ranking: obligationRanking("node-12"),
        }],
      });

    expect(selected.map(({ nodeId }) => nodeId))
      .toEqual([
        "node-1", "node-2", "node-3", "node-4",
        "node-9", "node-10", "node-11", "node-12",
      ]);
    expect(new Set(
      selected.map(({ nodeId }) => nodeId),
    ).size).toBe(8);
  });

  it("fails closed when a complement changes object binding across rankings", () => {
    const whole = ranked([
      "node-1", "node-2", "node-3", "node-4",
      "node-5", "node-6", "node-7", "node-8",
      "node-9",
    ]);
    const obligation = ranked([
      "node-9", "node-1", "node-2", "node-3",
      "node-4", "node-5", "node-6", "node-7",
      "node-8",
    ]);
    obligation[0] = {
      ...obligation[0]!,
      objectId: "different-object",
    };

    expect(() =>
      selectT44BaselineProtectedObligationNodesV2({
        wholeQueryRanking: whole,
        obligationRankings: [{
          obligationId: "obligation-1",
          ranking: obligation,
        }],
      })).toThrow(/BINDING_DRIFT/);
  });

  it("keeps two complementary nodes for one obligation and has no per-object cap", () => {
    const whole = ranked([
      "node-5", "node-6", "node-7", "node-8",
      "node-9", "node-10", "node-11", "node-12",
    ]);
    const selected = selectT44ObligationNodesV1({
      wholeQueryRanking: whole,
      obligationRankings: [{
        obligationId: "obligation-1",
        ranking: ranked([
          "node-1", "node-2", "node-5", "node-6",
        ]),
      }, {
        obligationId: "obligation-2",
        ranking: ranked([
          "node-3", "node-4", "node-7", "node-8",
        ]),
      }],
    });

    expect(selected).toHaveLength(8);
    expect(selected.slice(0, 2).map(
      ({ selectionSource }) => selectionSource,
    )).toEqual([
      "OBLIGATION_PASS_1",
      "OBLIGATION_PASS_1",
    ]);
    expect(selected.slice(2, 4).map(
      ({ selectionSource }) => selectionSource,
    )).toEqual([
      "OBLIGATION_PASS_2",
      "OBLIGATION_PASS_2",
    ]);
    expect(selected.filter(
      ({ obligationId }) =>
        obligationId === "obligation-1",
    ).map(({ nodeId }) => nodeId)).toEqual([
      "node-1",
      "node-2",
    ]);
    expect(new Set(selected.map(({ objectId }) => objectId)))
      .toEqual(new Set(["layout-object"]));
  });

  it("counts a selected hard negative instead of washing it clean", () => {
    const evaluation = evaluateT44LegacyEvidenceCaseV1({
      selectedNodeIds: ["node-good", "node-hard"],
      requiredEvidenceGroups: [{
        groupId: "group-one",
        acceptableNodeIds: ["node-good"],
      }],
      hardNegativeNodeIds: ["node-hard"],
    });
    expect(evaluation.allRequiredGroupsCovered).toBe(true);
    expect(evaluation.hardNegativeIntrusions).toEqual([
      "node-hard",
    ]);
  });

  it("matches by source, span coverage and allowed intent with deterministic cardinality", () => {
    const input = request();
    const predicted = obligationSet(input);
    const result = matchT44AnswerObligationsV1({
      request: input,
      prediction: predicted,
      qrel: {
        caseId: "case-one",
        expectedObligations: [{
          goldId: "gold-first",
          source: "CURRENT_MESSAGE",
          startCodePoint: 0,
          endCodePoint: 8,
          allowedIntents: ["FIRST_ACTION"],
          requiredEvidenceGroups: [["node-one"]],
        }, {
          goldId: "gold-check",
          source: "CURRENT_MESSAGE",
          startCodePoint: 8,
          endCodePoint:
            Array.from(
              input.currentMessage.message,
            ).length,
          allowedIntents: ["CHECK_CRITERIA"],
          requiredEvidenceGroups: [["node-two"]],
        }],
        nonObligationSpans: [],
        hardNegativeNodeIds: [],
        clarificationExpected: false,
      },
    });

    expect(result.matches).toEqual([
      {
        goldId: "gold-first",
        obligationId: "obligation-1",
      },
      {
        goldId: "gold-check",
        obligationId: "obligation-2",
      },
    ]);
    expect(result.obligationRecall).toBe(1);
    expect(result.caseJointCoverage).toBe(true);
    expect(result.materialFabrications).toHaveLength(0);
    expect(result.severeFabrications).toHaveLength(0);
    expect(result.bindingViolations).toEqual({
      sourceAnchor: 0,
      entity: 0,
      constraint: 0,
    });
    expect(result.wrongClarification).toBe(false);
  });

  it("separates redundant splits, material fabrication and severe fabrication", () => {
    const input = request();
    const prediction = obligationSet(input);
    const first = prediction.obligations[0]!;
    prediction.obligations = [
      first,
      {
        ...first,
        obligationId: "obligation-2",
      },
      {
        ...first,
        obligationId: "obligation-3",
        intent: "VERIFY_FACT",
        sourceAnchors: [{
          ...first.sourceAnchors[0]!,
          quote: Array.from(
            input.currentMessage.message,
          ).slice(4, 10).join(""),
          startCodePoint: 4,
          endCodePoint: 10,
        }],
      },
      {
        ...first,
        obligationId: "obligation-4",
        intent: "VERIFY_FACT",
        sourceAnchors: [{
          ...first.sourceAnchors[0]!,
          quote: Array.from(
            input.currentMessage.message,
          ).slice(12).join(""),
          startCodePoint: 12,
          endCodePoint: Array.from(
            input.currentMessage.message,
          ).length,
        }],
      },
    ];
    const result = matchT44AnswerObligationsV1({
      request: input,
      prediction,
      qrel: {
        caseId: "case-one",
        expectedObligations: [{
          goldId: "gold-first",
          source: "CURRENT_MESSAGE",
          startCodePoint: 0,
          endCodePoint: 8,
          allowedIntents: ["FIRST_ACTION"],
          requiredEvidenceGroups: [["node-one"]],
        }],
        nonObligationSpans: [{
          source: "CURRENT_MESSAGE",
          startCodePoint: 12,
          endCodePoint: Array.from(
            input.currentMessage.message,
          ).length,
        }],
        hardNegativeNodeIds: [],
        clarificationExpected: false,
      },
    });

    expect(result.redundantSplits).toEqual([
      "obligation-2",
    ]);
    expect(result.materialFabrications).toEqual([
      "obligation-3",
    ]);
    expect(result.severeFabrications).toEqual([
      "obligation-4",
    ]);
  });

  it("rejects candidate or matrix binding drift before qrels evaluation", () => {
    const sealed =
      sealT44ObligationSelectionArtifactV1({
        schemaVersion: 1,
        kind: "T44_OBLIGATION_SELECTIONS",
        candidateArtifactSha256: HASH,
        matrixOutputSha256: "c".repeat(64),
        graphifyInvocationCount: 0,
        cases: [],
      });

    expect(() =>
      verifyT44ObligationSelectionBindingsV1({
        seal: sealed,
        candidateArtifactSha256: "d".repeat(64),
        matrixOutputSha256: "c".repeat(64),
      })).toThrow(/CANDIDATE_SHA_DRIFT/);
    expect(() =>
      verifyT44ObligationSelectionBindingsV1({
        seal: sealed,
        candidateArtifactSha256: HASH,
        matrixOutputSha256: "e".repeat(64),
      })).toThrow(/MATRIX_SHA_DRIFT/);
  });
});
