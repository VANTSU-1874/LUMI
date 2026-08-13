import { z } from "zod";

import { PrivateWikiPageIdSchema } from "./private-compilation-contracts";

const WikiHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const ContentHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const ReleaseQualificationGateSchema = z.enum([
  "STUDENT_DISPLAY_RIGHTS",
  "AUDIENCE_POLICY",
  "SOURCE_DISCLOSURE",
  "WITHDRAWAL_READINESS",
  "RELEASE_ROLE_SIGNOFF",
]);
export const ReleaseQualificationGateValues = ReleaseQualificationGateSchema.options;

export const ReleaseQualificationGateStatusSchema = z.enum(["PENDING", "SATISFIED", "BLOCKED"]);

export const ReleaseQualificationCaseIdSchema = z.string()
  .regex(/^release-qualification:[0-9a-f]{32}$/);

export const ReleaseQualificationBoundarySchema = z.object({
  teacherPrivate: z.literal(true),
  formalQualificationOnly: z.literal(true),
  studentVisible: z.literal(false),
  formalRelease: z.literal("DISABLED"),
  currentPage: z.literal("DISABLED"),
  browseRelease: z.literal("SHADOW"),
  studentSearch: z.literal("SHADOW"),
  wikiRetrieval: z.literal("DISABLED"),
  r2: z.literal("DISABLED"),
  embedding: z.literal("DISABLED"),
  lumiRetrieval: z.literal("DISABLED"),
  productionDeployment: z.literal("DISABLED"),
}).strict().readonly();

export const ReleaseQualificationCaseSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-release-qualification-case/v1"),
  caseId: ReleaseQualificationCaseIdSchema,
  caseHash: WikiHashSchema,
  entryId: z.string().regex(/^private-internal-catalog:[0-9a-f]{32}:\d+$/),
  pageId: PrivateWikiPageIdSchema,
  pageRevisionId: z.string().regex(/^private-wiki-page-revision:[0-9a-f]{32}:\d+$/),
  pageRevision: z.number().int().positive(),
  contentHash: ContentHashSchema,
  title: z.string().trim().min(1).max(240),
  primaryCategory: z.string().trim().min(1).max(120),
  artisticStyleLabels: z.array(z.string().trim().min(1).max(80)).max(12),
  primaryPreviewUrl: z.string().startsWith("/api/teacher/inspiration-wiki/").nullable(),
  evidenceGapCount: z.literal(0),
  rightsScope: z.literal("UNKNOWN_PRIVATE_ONLY"),
  selectedAt: z.string().datetime(),
  boundary: ReleaseQualificationBoundarySchema,
}).strict().readonly();

const ReleaseQualificationDecisionInputObjectSchema = z.object({
  caseId: ReleaseQualificationCaseIdSchema,
  gate: ReleaseQualificationGateSchema,
  status: z.enum(["SATISFIED", "BLOCKED"]),
  evidenceRef: z.string().trim().max(500).nullable(),
  note: z.string().trim().min(1).max(1_000),
  idempotencyKey: z.string().uuid(),
}).strict();

export const ReleaseQualificationDecisionInputSchema = ReleaseQualificationDecisionInputObjectSchema
  .superRefine((value, context) => {
    if (value.gate === "STUDENT_DISPLAY_RIGHTS" && value.status === "SATISFIED" && !value.evidenceRef) {
      context.addIssue({ code: "custom", path: ["evidenceRef"], message: "正式展示权利通过时必须绑定可核验依据" });
    }
  }).readonly();

export const ReleaseQualificationDecisionSchema = ReleaseQualificationDecisionInputObjectSchema.extend({
  schemaVersion: z.literal("lumi-inspiration-release-qualification-decision/v1"),
  decisionId: z.string().regex(/^release-qualification-decision:[0-9a-f]{32}:\d+:[a-z_]+$/),
  decisionHash: WikiHashSchema,
  revision: z.number().int().positive(),
  actorId: z.string().trim().min(1).max(200),
  decidedAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (value.gate === "STUDENT_DISPLAY_RIGHTS" && value.status === "SATISFIED" && !value.evidenceRef) {
    context.addIssue({ code: "custom", path: ["evidenceRef"], message: "正式展示权利通过时必须绑定可核验依据" });
  }
}).readonly();

export const ReleaseQualificationDecisionReceiptSchema = z.object({
  decision: ReleaseQualificationDecisionSchema,
  replayed: z.boolean(),
}).strict().readonly();

const GateViewSchema = z.object({
  gate: ReleaseQualificationGateSchema,
  label: z.string().trim().min(1).max(80),
  status: ReleaseQualificationGateStatusSchema,
  decision: ReleaseQualificationDecisionSchema.nullable(),
}).strict().readonly();

export const TeacherReleaseQualificationQueueSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-release-qualification-queue/v1"),
  items: z.array(z.object({
    releaseCase: ReleaseQualificationCaseSchema,
    gates: z.array(GateViewSchema).length(5),
    satisfiedGateCount: z.number().int().min(0).max(5),
    state: z.enum(["QUALIFICATION_IN_PROGRESS", "QUALIFIED_FOR_CANONICAL_BUILD"]),
  }).strict().readonly()).max(12),
  meta: z.object({
    total: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    qualified: z.number().int().nonnegative(),
    boundary: ReleaseQualificationBoundarySchema,
  }).strict().readonly(),
}).strict().readonly();

export type ReleaseQualificationCase = z.infer<typeof ReleaseQualificationCaseSchema>;
export type ReleaseQualificationGate = z.infer<typeof ReleaseQualificationGateSchema>;
export type ReleaseQualificationDecision = z.infer<typeof ReleaseQualificationDecisionSchema>;
export type ReleaseQualificationDecisionInput = z.infer<typeof ReleaseQualificationDecisionInputSchema>;
export type TeacherReleaseQualificationQueue = z.infer<typeof TeacherReleaseQualificationQueueSchema>;
