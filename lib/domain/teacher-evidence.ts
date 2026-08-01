import { z } from "zod";

import { DataTypeSchema } from "./data-provenance";
import { EvidenceNumericValueSchema } from "./evidence";
import { EvidenceProbeSchema } from "./evidence-probe";

const EvidenceDetailBase = {
  id: z.uuid(),
  label: z.string().trim().min(1).max(80),
  signalLayer: z.enum(["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"]),
  verificationStatus: z.enum(["SUBMITTED", "RULE_VERIFIED", "TEACHER_VERIFIED", "REJECTED"]),
  confirmedCode: z.enum(["INPUT_OK", "MAPPING_OK", "TRANSPORT_OK", "BINDING_OK", "OUTPUT_OK"]).nullable(),
  evidenceSequence: z.number().int().positive(),
  createdAt: z.string().datetime(),
  dataType: DataTypeSchema,
};

const HttpsUrlSchema = z.string().trim().max(2_000).url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    context.addIssue({ code: "custom", message: "证据外链必须为不含凭据的 HTTPS 地址" });
  }
});

export const TeacherEvidenceDetailSchema = z.discriminatedUnion("kind", [
  z.object({ ...EvidenceDetailBase, kind: z.literal("TEXT"), text: z.string().min(1).max(2_000) }).strict(),
  z.object({ ...EvidenceDetailBase, kind: z.literal("VALUE"), value: EvidenceNumericValueSchema }).strict(),
  z.object({ ...EvidenceDetailBase, kind: z.literal("VIDEO_LINK"), url: HttpsUrlSchema }).strict(),
  z.object({ ...EvidenceDetailBase, kind: z.literal("PROBE"), probe: EvidenceProbeSchema }).strict(),
  z.object({ ...EvidenceDetailBase, kind: z.literal("IMAGE"), previewUrl: z.string().regex(/^\/api\/evidence\/[0-9a-f-]{36}$/) }).strict(),
]);

export type TeacherEvidenceDetail = z.infer<typeof TeacherEvidenceDetailSchema>;
