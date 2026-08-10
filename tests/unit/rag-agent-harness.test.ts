// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  CURRENT_RAG_AGENT_HARNESS_VERSION,
  RagAgentHarnessReportSchema,
  REQUIRED_RAG_AGENT_HARNESS_CASES,
  buildRagAgentHarnessReport,
  type RagAgentHarnessCaseResult,
} from "@/lib/agent/rag-harness";
import {
  CLEAN_RELEASE_SOURCE,
  V3_RELEASE_RUNTIME,
} from "@/tests/helpers/release-source-binding";

const HASH = "a".repeat(64);

function passingResults(): RagAgentHarnessCaseResult[] {
  return REQUIRED_RAG_AGENT_HARNESS_CASES.map(
    (caseId) => ({
      caseId,
      passed: true,
      durationMs: 5,
      coursePackId:
        caseId === "rag-cross-pack-isolated"
          ? "brand-vi-design"
          : "layout-design",
      modality:
        caseId.includes("visual")
          || caseId.includes("cross-modal")
          ? "MULTIMODAL"
          : "TEXT",
      queryType:
        caseId.includes("context")
          ? "CONTEXTUAL"
          : "STANDALONE",
      caseFamily:
        caseId.includes("memory")
          ? "MEMORY"
          : caseId.includes("provider")
            ? "DEGRADATION"
            : "EVIDENCE_CHAIN",
      rawQuestion: "学生口语问题",
      selfContainedQuestion: "自包含学生问题",
      ambiguityStatus: "NONE",
      sourceTurnIds: [],
      planner: {
        callCount: 0,
        modelId: "deterministic-fixture",
        latencyMs: 0,
      },
      answer: {
        callCount: 2,
        modelId: "deterministic-fixture",
        latencyMs: 2,
      },
      degradationReason: null,
      returnedSourceIds: ["node-1", "node-2"],
      injectedSourceIds: ["node-1", "node-2"],
      usedSourceIds: ["node-1"],
      persistedSourceIds: ["node-1"],
      assetIds: [],
      regions: [],
      parentNodeIds: [],
      toolCallIds: [
        "11111111-1111-4111-8111-111111111111",
      ],
      persistenceTraceIds: [
        "22222222-2222-4222-8222-222222222222",
      ],
      requiredGroupResults: [{
        groupId: "group-1",
        expectedSourceIds: ["node-1"],
        injected: true,
        used: true,
      }],
      failures: [],
      observed: {},
    }),
  );
}

const identity = {
  suiteHash: HASH,
  corpusBundleHash: "b".repeat(64),
  activeIndexBundleHash: "c".repeat(64),
  textProvider: {
    providerId: "bge",
    modelId: "bge-m3",
    revision: "fixture",
  },
  visualProvider: {
    providerId: "siglip2",
    modelId: "siglip2-so400m",
    revision: "fixture",
  },
  answerModelId: "deterministic-fixture",
  plannerModelId: "deterministic-fixture",
  knowledgeObjectV2Enabled: true,
};

describe("RAG Agent Harness report", () => {
  it("accepts exactly 12 passing cases with a valid four-stage evidence chain", () => {
    const report = buildRagAgentHarnessReport({
      results: passingResults(),
      source: CLEAN_RELEASE_SOURCE,
      runtime: V3_RELEASE_RUNTIME,
      mode: "deterministic",
      identity,
      evaluatedAt: new Date(
        "2026-07-30T12:00:00.000Z",
      ),
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      harnessVersion:
        CURRENT_RAG_AGENT_HARNESS_VERSION,
      caseCount: 12,
      passedCaseCount: 12,
      hardFailureCount: 0,
      passed: true,
    });
    expect(
      RagAgentHarnessReportSchema.parse(report),
    ).toEqual(report);
  });

  it("rejects duplicated cases and returned-injected-used-persisted drift", () => {
    const valid = buildRagAgentHarnessReport({
      results: passingResults(),
      source: CLEAN_RELEASE_SOURCE,
      runtime: V3_RELEASE_RUNTIME,
      mode: "deterministic",
      identity,
    });
    const duplicated = {
      ...valid,
      results: [
        ...valid.results.slice(0, -1),
        valid.results[0],
      ],
    };
    expect(
      RagAgentHarnessReportSchema.safeParse(duplicated)
        .success,
    ).toBe(false);

    const drift = structuredClone(valid);
    drift.results[0]!.usedSourceIds = ["forged-node"];
    expect(
      RagAgentHarnessReportSchema.safeParse(drift)
        .success,
    ).toBe(false);

    const persistenceDrift = structuredClone(valid);
    persistenceDrift.results[0]!
      .persistedSourceIds = ["node-2"];
    expect(
      RagAgentHarnessReportSchema.safeParse(
        persistenceDrift,
      ).success,
    ).toBe(false);
  });
});
