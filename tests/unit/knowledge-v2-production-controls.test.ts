import { describe, expect, it } from "vitest";

import {
  createKnowledgeV2RollbackReceipt,
  evaluateKnowledgeV2ShadowObservation,
  verifyKnowledgeV2RollbackReceipt,
} from "@/lib/operations/knowledge-v2-production-controls";

const release = "a".repeat(40);
const candidate = `${"b".repeat(40)}-t8v5`;
const hash = "c".repeat(64);

describe("Knowledge V2 production control contracts", () => {
  it("only reports true shadow success after runtime work while Agent stays legacy", () => {
    expect(evaluateKnowledgeV2ShadowObservation({
      schemaVersion: 1,
      operatingMode: "TRUE_SHADOW",
      runtimeInitializationCount: 1,
      bypassInvocationCount: 3,
      agentEvidenceToolExposed: false,
      responseSource: "LEGACY",
    })).toMatchObject({
      status: "SHADOW_STATUS_SUCCEEDED",
      reasons: [],
    });
  });

  it("rejects a no-op control preset as successful shadow evidence", () => {
    expect(evaluateKnowledgeV2ShadowObservation({
      schemaVersion: 1,
      operatingMode: "TRUE_SHADOW",
      runtimeInitializationCount: 0,
      bypassInvocationCount: 0,
      agentEvidenceToolExposed: false,
      responseSource: "LEGACY",
    })).toMatchObject({
      status: "SHADOW_STATUS_FAILED",
      reasons: [
        "RUNTIME_NOT_INITIALIZED",
        "NO_BYPASS_INVOCATIONS",
      ],
    });
  });

  it("requires an allowlisted reason and binds both restored backups", () => {
    const receipt = createKnowledgeV2RollbackReceipt({
      attemptId: "t8-candidate-release-v5",
      reason: "KNOWLEDGE_V2_NOT_READY",
      candidateRelease: candidate,
      rollbackTargetRelease: release,
      configurationBackupBindingSha256: hash,
      canaryEnrollmentBackupBindingSha256:
        "d".repeat(64),
      configurationRestoredFromBackup: true,
      canaryEnrollmentRestoredFromBackup: true,
      service: "active",
      health: "ok",
      studentHttp: 200,
    });

    expect(verifyKnowledgeV2RollbackReceipt(receipt))
      .toEqual(receipt);
    expect(() => verifyKnowledgeV2RollbackReceipt({
      ...receipt,
      reason: "HARDCODED_OLD_INCIDENT",
    })).toThrow();
    expect(() => verifyKnowledgeV2RollbackReceipt({
      ...receipt,
      rollbackTargetRelease: candidate,
    })).toThrow(
      /ROLLBACK_RECEIPT_BINDING_MISMATCH/,
    );
  });
});
