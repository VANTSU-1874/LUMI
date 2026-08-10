// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  assembleEvidenceBundleV2,
  type EvidenceChannelV2,
  type EvidenceExpansionV2,
  type EvidenceProvenanceV2,
} from "@/lib/knowledge/evidence-bundle-v2";
import {
  ObjectConsensusTraceV2Schema,
  TEXT_OBJECT_CONSENSUS_CONFIG_HASH_V2,
} from "@/lib/knowledge/object-candidate-v2";
import {
  applyPostFusionAcceptanceV2,
  fuseRankedChannelsV2,
} from "@/lib/knowledge/rank-fusion-v2";
import {
  createRetrievalQueryV2,
  type RetrievalQueryV2,
} from "@/lib/knowledge/retrieval-query-v2";
import {
  T43_DEV_GATES_V1,
  scoreT43EvidenceAdequacyCase,
} from "@/tools/mixed-retrieval/t43-evidence-adequacy-evaluator";
import {
  T43_EVIDENCE_ADEQUACY_CORPUS_BUNDLE_SHA256,
  T43EvidenceAdequacyCaseSchema,
} from "@/tools/mixed-retrieval/t43-evidence-adequacy-loader";

const ACTIVE_INDEX_HASH = "b".repeat(64);
const CONFIG_HASH = "c".repeat(64);
const PAYLOAD_HASH = "d".repeat(64);
const TEXT_INDEX_HASH = "e".repeat(64);
const OBJECT_ID = "design-example-object";
const NODE_ID = `node-${"1".repeat(64)}`;

function channelIdentity(channel: EvidenceChannelV2["channel"]) {
  return {
    activeIndexBundleHash: ACTIVE_INDEX_HASH,
    providerIndexBundleHash:
      channel === "LEXICAL" ? null : TEXT_INDEX_HASH,
    indexVersionId:
      `${channel.toLowerCase().replace("_", "-")}-index`,
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
      corpusBundleHash:
        T43_EVIDENCE_ADEQUACY_CORPUS_BUNDLE_SHA256,
      identity: channelIdentity("LEXICAL"),
      hitCount: hasHits ? 1 : 0,
      timingMs: 1,
    },
    {
      channel: "TEXT_VECTOR",
      status: hasHits ? "SUCCESS" : "EMPTY",
      reason: null,
      corpusBundleHash:
        T43_EVIDENCE_ADEQUACY_CORPUS_BUNDLE_SHA256,
      identity: channelIdentity("TEXT_VECTOR"),
      hitCount: hasHits ? 1 : 0,
      timingMs: 2,
    },
    {
      channel: "VISUAL_VECTOR",
      status: "SKIPPED",
      reason: "MODE_NOT_APPLICABLE",
      corpusBundleHash:
        T43_EVIDENCE_ADEQUACY_CORPUS_BUNDLE_SHA256,
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
    status?: "SUCCESS" | "DEGRADED" | "EMPTY";
    primaryObjectId?: string;
    primaryNodeId?: string;
    objectRanking?: string[];
  } = {},
) {
  const status = options.status ?? "SUCCESS";
  const hasPrimary =
    options.primaryObjectId !== undefined
    && options.primaryNodeId !== undefined;
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
  const expansion: EvidenceExpansionV2 = hasPrimary
    ? {
        nodes: [
          {
            nodeId: options.primaryNodeId!,
            objectId: options.primaryObjectId!,
            kind: "TEXT",
            relation: "PRIMARY",
            seedCandidateId: options.primaryNodeId!,
            parentNodeId: "node-parent-fixture",
            sourceId: "source-fixture",
            sourceCoursePack,
            excerpt: "fixture primary evidence",
            assetId: null,
          },
        ],
        assets: [],
        regions: [],
        sources: [
          {
            sourceId: "source-fixture",
            objectId: options.primaryObjectId!,
            authority: "COURSE_DESIGN",
            verifiedDate: "2026-07-28",
            scope: "T4.3 evaluator fixture.",
            locators: [
              {
                kind: "LOCAL_DOCUMENT",
                path: "data/knowledge/t43-evaluator-fixture.md",
              },
            ],
          },
        ],
      }
    : {
        nodes: [],
        assets: [],
        regions: [],
        sources: [],
      };
  const provenance: EvidenceProvenanceV2 = {
    corpusBundleHash:
      T43_EVIDENCE_ADEQUACY_CORPUS_BUNDLE_SHA256,
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
  return assembleEvidenceBundleV2({
    status,
    query,
    channels: channels(hasPrimary),
    fused,
    acceptance,
    ...(options.objectRanking
      ? {
          objectConsensus: objectConsensus(
            options.objectRanking,
          ),
        }
      : {}),
    expansion,
    provenance,
    timing: {
      retrievalMs: 4,
      expansionMs: hasPrimary ? 1 : 0,
      totalMs: hasPrimary ? 5 : 4,
    },
  });
}

function runtimeQuery(question: string) {
  return createRetrievalQueryV2({
    mode: "TEXT_TO_TEXT",
    text: question,
    scope: {
      corpusBundleHash:
        T43_EVIDENCE_ADEQUACY_CORPUS_BUNDLE_SHA256,
      sourceCoursePack: {
        id: "general-design",
        version: "1",
      },
    },
  });
}

function answerableCase() {
  return T43EvidenceAdequacyCaseSchema.parse({
    runtime: {
      mode: "TEXT_TO_TEXT",
      coursePackId: "general-design",
      coursePackVersion: "1",
      question: "我该怎么检查这个设计关系？",
    },
    scoring: {
      caseId: "t43-evidence-dev-fixture-answerable",
      familyId: "t43-family-fixture-answerable",
      clusterId: "t43-cluster-fixture-answerable",
      pairId: null,
      pairRole: null,
      pairDeltaKind: null,
      stratum: "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
      expectation: "ANSWERABLE",
      reasonClass: "CORPUS_SUPPORTED",
      executionClass: "HEALTHY_SCOPED_TTT",
      targetObjectIds: [OBJECT_ID],
      requiredEvidenceGroups: [[NODE_ID]],
    },
  });
}

function noAnswerCase() {
  return T43EvidenceAdequacyCaseSchema.parse({
    runtime: {
      mode: "TEXT_TO_TEXT",
      coursePackId: "general-design",
      coursePackVersion: "1",
      question: "能给我不存在的精确参数吗？",
    },
    scoring: {
      caseId: "t43-evidence-dev-fixture-no-answer",
      familyId: "t43-family-fixture-no-answer",
      clusterId: "t43-cluster-fixture-no-answer",
      pairId: null,
      pairRole: null,
      pairDeltaKind: null,
      stratum: "NO_ANSWER_PARAMETER_CODE_STEP_GAP",
      expectation: "NO_ANSWER",
      reasonClass: "UNSUPPORTED_DETAIL",
      executionClass: "HEALTHY_SCOPED_TTT",
      targetObjectIds: [],
      requiredEvidenceGroups: [],
    },
  });
}

describe("T4.3 evidence adequacy evaluator", () => {
  it("freezes the single machine-readable promotion thresholds", () => {
    expect(T43_DEV_GATES_V1).toMatchObject({
      objectRecallAt10: { required: 48, total: 50 },
      answerableComplete: { required: 45, total: 50 },
      noAnswerEmpty: { required: 46, total: 50 },
      pairJointPass: { required: 27, total: 30 },
      expectedProviderCallsPerArm: 180,
      expectedQueriedFingerprintsPerArm: 90,
      expectedPreRetrievalSkipsPerArm: 10,
    });
  });

  it("requires SUCCESS, a target primary, and every evidence group", () => {
    const testCase = answerableCase();
    const query = runtimeQuery(testCase.runtime.question);
    const pass = scoreT43EvidenceAdequacyCase(
      testCase,
      makeBundle(query, {
        primaryObjectId: OBJECT_ID,
        primaryNodeId: NODE_ID,
        objectRanking: [OBJECT_ID],
      }),
    );
    const degraded = scoreT43EvidenceAdequacyCase(
      testCase,
      makeBundle(query, {
        status: "DEGRADED",
        primaryObjectId: OBJECT_ID,
        primaryNodeId: NODE_ID,
        objectRanking: [OBJECT_ID],
      }),
    );

    expect(pass).toMatchObject({
      pass: true,
      outcome: "ANSWERABLE_COMPLETE",
      objectRecallAt10: true,
      answerableComplete: true,
    });
    expect(degraded).toMatchObject({
      pass: false,
      outcome: "ANSWERABLE_NON_SUCCESS_STATUS",
      answerableComplete: false,
    });
  });

  it("scores object recall from the pre-gate ranking even after EMPTY", () => {
    const testCase = answerableCase();
    const query = runtimeQuery(testCase.runtime.question);
    const score = scoreT43EvidenceAdequacyCase(
      testCase,
      makeBundle(query, {
        status: "EMPTY",
        objectRanking: [OBJECT_ID],
      }),
    );

    expect(score).toMatchObject({
      objectRecallAt10: true,
      answerableComplete: false,
      pass: false,
      outcome: "ANSWERABLE_NON_SUCCESS_STATUS",
    });
  });

  it("accepts NO_ANSWER only when status and every evidence layer are empty", () => {
    const testCase = noAnswerCase();
    const query = runtimeQuery(testCase.runtime.question);
    const empty = scoreT43EvidenceAdequacyCase(
      testCase,
      makeBundle(query, { status: "EMPTY" }),
    );
    const retained = scoreT43EvidenceAdequacyCase(
      testCase,
      makeBundle(query, {
        primaryObjectId: OBJECT_ID,
        primaryNodeId: NODE_ID,
        objectRanking: [OBJECT_ID],
      }),
    );

    expect(empty).toMatchObject({
      pass: true,
      noAnswerEmpty: true,
      outcome: "NO_ANSWER_EMPTY",
    });
    expect(retained).toMatchObject({
      pass: false,
      noAnswerEmpty: false,
      outcome: "NO_ANSWER_EVIDENCE_RETAINED",
    });
  });
});
