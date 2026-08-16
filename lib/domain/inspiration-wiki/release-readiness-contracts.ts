import { z } from "zod";

import { PrivateInternalCatalogEntryIdSchema } from "./private-catalog-governance-contracts";
import { PrivateWikiPageIdSchema } from "./private-compilation-contracts";

export const ReleaseReadinessGateKeySchema = z.enum([
  "PRIVATE_CATALOG_BINDING",
  "RIGHTS_ALLOW",
  "CANONICAL_MATERIAL",
  "WITHDRAWAL_READINESS",
  "AUDIENCE_POLICY",
  "RELEASE_DECISION",
  "CURRENT_PAGE",
  "CHANNEL_ACTIVATION",
]);

export const ReleaseReadinessGateSchema = z.object({
  key: ReleaseReadinessGateKeySchema,
  status: z.enum(["PASSED", "BLOCKED", "NOT_STARTED"]),
  label: z.string().trim().min(1).max(80),
  explanation: z.string().trim().min(1).max(240),
}).strict().readonly();

export const ReleaseReadinessBoundarySchema = z.object({
  teacherPrivate: z.literal(true),
  readOnlyAudit: z.literal(true),
  studentVisible: z.literal(false),
  formalRelease: z.literal("DISABLED"),
  currentPage: z.literal("DISABLED"),
  browseRelease: z.literal("DISABLED"),
  studentSearch: z.literal("DISABLED"),
  r2: z.literal("DISABLED"),
  embedding: z.literal("DISABLED"),
  lumiRetrieval: z.literal("DISABLED"),
}).strict().readonly();

export const ReleaseReadinessItemSchema = z.object({
  entryId: PrivateInternalCatalogEntryIdSchema,
  pageId: PrivateWikiPageIdSchema,
  revision: z.number().int().positive(),
  title: z.string().trim().min(1).max(240),
  primaryCategory: z.string().trim().min(1).max(80),
  artisticStyleLabels: z.array(z.string().trim().min(1).max(40)).min(1).max(3),
  primaryPreviewUrl: z.string().regex(/^\/api\/teacher\/inspiration-wiki\/review-packs\//),
  evidenceGapCount: z.number().int().min(0).max(9),
  rightsScope: z.literal("UNKNOWN_PRIVATE_ONLY"),
  state: z.literal("BLOCKED_FOR_FORMAL_RELEASE"),
  passedGateCount: z.literal(1),
  totalGateCount: z.literal(8),
  gates: z.array(ReleaseReadinessGateSchema).length(8),
}).strict().superRefine((item, context) => {
  const keys = item.gates.map((gate) => gate.key);
  if (new Set(keys).size !== ReleaseReadinessGateKeySchema.options.length) {
    context.addIssue({ code: "custom", path: ["gates"], message: "Release readiness gates must be unique" });
  }
  if (item.gates.filter((gate) => gate.status === "PASSED").length !== item.passedGateCount) {
    context.addIssue({ code: "custom", path: ["passedGateCount"], message: "Passed gate count is inconsistent" });
  }
}).readonly();

export const TeacherReleaseReadinessQueueSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-release-readiness-audit/v1"),
  evaluatedAt: z.string().datetime(),
  items: z.array(ReleaseReadinessItemSchema),
  meta: z.object({
    total: z.number().int().nonnegative(),
    eligible: z.literal(0),
    blocked: z.number().int().nonnegative(),
    rightsUnknown: z.number().int().nonnegative(),
    canonicalDrafts: z.number().int().nonnegative(),
    canonicalDomainDecisions: z.number().int().nonnegative(),
    legacyInternalCatalog: z.number().int().nonnegative(),
    boundary: ReleaseReadinessBoundarySchema,
  }).strict(),
}).strict().superRefine((queue, context) => {
  if (queue.items.length !== queue.meta.total || queue.meta.total !== queue.meta.blocked || queue.meta.total !== queue.meta.rightsUnknown) {
    context.addIssue({ code: "custom", path: ["meta"], message: "Release readiness totals are inconsistent" });
  }
}).readonly();

export type TeacherReleaseReadinessQueue = z.infer<typeof TeacherReleaseReadinessQueueSchema>;
