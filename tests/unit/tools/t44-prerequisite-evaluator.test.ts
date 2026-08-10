// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  createCapabilityEntityManifestV2,
} from "@/lib/knowledge/capability-boundary-v2";
import {
  AUDITED_CAPABILITY_ENTITIES_V2,
} from "@/lib/knowledge/capability-entity-registry-v2";
import {
  QUERY_PREREQUISITE_CONFIG_HASH_V3,
  QUERY_PREREQUISITE_FEATURE_ALGORITHM_HASH_V3,
  QUERY_PREREQUISITE_POLICY_HASH_V3,
} from "@/lib/knowledge/query-prerequisite-router-v3";
import {
  evaluateT44PrerequisiteDev,
  T44_PREREQUISITE_DEV_GATES_V1,
  verifyT44PrerequisiteReport,
} from "@/tools/mixed-retrieval/t44-prerequisite-evaluator";
import {
  loadT44PrerequisiteSuite,
} from "@/tools/mixed-retrieval/t44-prerequisite-loader";

const SUITE_PATH =
  "tests/retrieval-quality/t44-prerequisite-dev.json";
const CORPUS_HASH = "a".repeat(64);

function manifest() {
  return createCapabilityEntityManifestV2({
    id: "t44-prerequisite-evaluator-manifest",
    version: "1.0.0",
    corpusBundleHash: CORPUS_HASH,
    entities: AUDITED_CAPABILITY_ENTITIES_V2,
  });
}

async function evaluate() {
  return evaluateT44PrerequisiteDev({
    candidateId: "route-candidate-1",
    suite: await loadT44PrerequisiteSuite(SUITE_PATH),
    capabilityEntityManifest: manifest(),
  });
}

describe("T4.4 prerequisite DEV evaluator", () => {
  it("emits 100 replayable rows and an honest shadow provider audit", async () => {
    const report = await evaluate();

    expect(report.rows).toHaveLength(100);
    expect(report).toMatchObject({
      featureAlgorithmHash:
        QUERY_PREREQUISITE_FEATURE_ALGORITHM_HASH_V3,
      policyHash: QUERY_PREREQUISITE_POLICY_HASH_V3,
      configHash: QUERY_PREREQUISITE_CONFIG_HASH_V3,
      gates: T44_PREREQUISITE_DEV_GATES_V1,
      traceReplay: { passed: 100, total: 100 },
      providerInvocationAudit: {
        mode: "INSTRUMENTED_SHADOW",
        expectedDownstreamRetrievalCalls: 100,
        observedDownstreamRetrievalCalls: 100,
        expectedInstrumentedProviderCalls: 200,
        observedInstrumentedProviderCalls: 200,
        shadowProviderCallDelta: 0,
      },
    });
    expect(report.gateResults.traceReplay).toBe(true);
    expect(report.gateResults.providerParity).toBe(true);
  });

  it("does not copy questions or family labels into the report rows", async () => {
    const suite = await loadT44PrerequisiteSuite(SUITE_PATH);
    const report = await evaluate();
    const serialized = JSON.stringify(report.rows);

    for (const testCase of suite.cases) {
      expect(serialized).not.toContain(testCase.runtime.question);
      expect(serialized).not.toContain(testCase.scoring.familyId);
    }
  });

  it("verifies the stable report hash and rejects tampering", async () => {
    const report = await evaluate();
    expect(verifyT44PrerequisiteReport(report)).toEqual(report);

    expect(() => verifyT44PrerequisiteReport({
      ...report,
      candidateId: "route-candidate-2",
    })).toThrow(/REPORT_HASH_MISMATCH/);
  });
});
