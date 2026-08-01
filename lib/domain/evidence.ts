import { z } from "zod";

export const MIN_EVIDENCE_VALUE = -1_000_000_000;
export const MAX_EVIDENCE_VALUE = 1_000_000_000;
export const EvidenceNumericValueSchema = z.number().finite()
  .min(MIN_EVIDENCE_VALUE)
  .max(MAX_EVIDENCE_VALUE);

export const PublicEvidenceRecordSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["VALUE", "TEXT", "VIDEO_LINK", "IMAGE", "PROBE"]),
  signalLayer: z.enum(["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"]),
  label: z.string().trim().min(1).max(80),
  verificationStatus: z.enum(["SUBMITTED", "RULE_VERIFIED", "TEACHER_VERIFIED", "REJECTED"]),
  createdAt: z.iso.datetime(),
}).strict();

export const EvidenceApiErrorSchema = z.object({ error: z.string().min(1).max(500) }).passthrough();
export type PublicEvidenceRecord = z.infer<typeof PublicEvidenceRecordSchema>;
