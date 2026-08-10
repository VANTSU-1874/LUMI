import { createHash } from "node:crypto";

import { z } from "zod";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const ReleaseIdSchema = z.string().regex(
  /^[a-f0-9]{40}(?:-[a-z0-9]+)*$/,
);
const AttemptIdSchema = z.string().regex(
  /^t8-[a-z0-9]+(?:-[a-z0-9]+){1,10}$/,
);

export const KnowledgeV2ShadowObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    operatingMode: z.literal("TRUE_SHADOW"),
    runtimeInitializationCount:
      z.number().int().nonnegative(),
    bypassInvocationCount:
      z.number().int().nonnegative(),
    agentEvidenceToolExposed: z.boolean(),
    responseSource: z.enum(["LEGACY", "V2"]),
  })
  .strict();

export type KnowledgeV2ShadowObservation = z.infer<
  typeof KnowledgeV2ShadowObservationSchema
>;

export type KnowledgeV2ShadowFailureReason =
  | "RUNTIME_NOT_INITIALIZED"
  | "NO_BYPASS_INVOCATIONS"
  | "AGENT_TOOL_EXPOSED"
  | "NON_LEGACY_RESPONSE";

export function evaluateKnowledgeV2ShadowObservation(
  input: unknown,
) {
  const observation =
    KnowledgeV2ShadowObservationSchema.parse(input);
  const reasons: KnowledgeV2ShadowFailureReason[] = [];
  if (observation.runtimeInitializationCount < 1) {
    reasons.push("RUNTIME_NOT_INITIALIZED");
  }
  if (observation.bypassInvocationCount < 1) {
    reasons.push("NO_BYPASS_INVOCATIONS");
  }
  if (observation.agentEvidenceToolExposed) {
    reasons.push("AGENT_TOOL_EXPOSED");
  }
  if (observation.responseSource !== "LEGACY") {
    reasons.push("NON_LEGACY_RESPONSE");
  }
  return {
    status: reasons.length === 0
      ? "SHADOW_STATUS_SUCCEEDED" as const
      : "SHADOW_STATUS_FAILED" as const,
    reasons,
    observation,
  };
}

export const KnowledgeV2RollbackReasonSchema = z.enum([
  "UI_SURFACE_REGRESSION",
  "KNOWLEDGE_V2_NOT_READY",
  "KNOWLEDGE_RUNTIME_UNAVAILABLE",
  "CANARY_GATE_FAILED",
  "OPERATOR_ABORT",
]);

export const KnowledgeV2RollbackReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("KNOWLEDGE_V2_ROLLBACK_RECEIPT"),
    status: z.literal("P6_ROLLBACK_STATUS_SUCCEEDED"),
    attemptId: AttemptIdSchema,
    reason: KnowledgeV2RollbackReasonSchema,
    candidateRelease: ReleaseIdSchema,
    rollbackTargetRelease: ReleaseIdSchema,
    configurationBackupBindingSha256: HashSchema,
    canaryEnrollmentBackupBindingSha256: HashSchema,
    configurationRestoredFromBackup: z.literal(true),
    canaryEnrollmentRestoredFromBackup: z.literal(true),
    service: z.literal("active"),
    health: z.literal("ok"),
    studentHttp: z.literal(200),
    bindingSha256: HashSchema,
  })
  .strict();

export type KnowledgeV2RollbackReceipt = z.infer<
  typeof KnowledgeV2RollbackReceiptSchema
>;

type KnowledgeV2RollbackReceiptInput = Omit<
  KnowledgeV2RollbackReceipt,
  "schemaVersion" | "kind" | "status" | "bindingSha256"
>;

function sha256(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function rollbackBinding(
  receipt: Omit<KnowledgeV2RollbackReceipt, "bindingSha256">,
) {
  return sha256(JSON.stringify(receipt));
}

export function createKnowledgeV2RollbackReceipt(
  input: KnowledgeV2RollbackReceiptInput,
): KnowledgeV2RollbackReceipt {
  const body = KnowledgeV2RollbackReceiptSchema
    .omit({ bindingSha256: true })
    .parse({
      schemaVersion: 1,
      kind: "KNOWLEDGE_V2_ROLLBACK_RECEIPT",
      status: "P6_ROLLBACK_STATUS_SUCCEEDED",
      ...input,
    });
  return KnowledgeV2RollbackReceiptSchema.parse({
    ...body,
    bindingSha256: rollbackBinding(body),
  });
}

export function verifyKnowledgeV2RollbackReceipt(
  input: unknown,
) {
  const receipt =
    KnowledgeV2RollbackReceiptSchema.parse(input);
  const { bindingSha256, ...body } = receipt;
  if (bindingSha256 !== rollbackBinding(body)) {
    throw new Error(
      "KNOWLEDGE_V2_ROLLBACK_RECEIPT_BINDING_MISMATCH",
    );
  }
  return receipt;
}
