import { z } from "zod";

import { PrivateWikiPageIdSchema } from "./private-compilation-contracts";

const WikiHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const P2StudentChannelShadowSnapshotIdSchema = z.string()
  .regex(/^p2-channel-shadow:[0-9a-f]{32}$/);

export const P2StudentChannelShadowBoundarySchema = z.object({
  studentVisible: z.literal(false),
  productionDeployment: z.literal("DISABLED"),
  formalRelease: z.literal("DISABLED"),
  currentPage: z.literal("DISABLED"),
  r2: z.literal("DISABLED"),
  embedding: z.literal("DISABLED"),
  lumiRetrieval: z.literal("DISABLED"),
}).strict().readonly();

export const P2StudentChannelShadowSnapshotSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-p2-channel-shadow-snapshot/v1"),
  snapshotId: P2StudentChannelShadowSnapshotIdSchema,
  snapshotHash: WikiHashSchema,
  sourceReadinessHash: WikiHashSchema,
  sourceSetHash: WikiHashSchema,
  mode: z.literal("SHADOW"),
  channels: z.object({
    BROWSE_RELEASE: z.literal("SHADOW"),
    STUDENT_SEARCH: z.literal("SHADOW"),
    WIKI_RETRIEVAL: z.literal("DISABLED"),
  }).strict().readonly(),
  source: z.object({
    releaseReadinessSchemaVersion: z.literal("lumi-inspiration-release-readiness-audit/v1"),
    total: z.number().int().nonnegative(),
    eligible: z.literal(0),
    blocked: z.number().int().nonnegative(),
    rightsUnknown: z.number().int().nonnegative(),
  }).strict().readonly(),
  eligiblePageIds: z.array(PrivateWikiPageIdSchema).max(500),
  restrictedPageIds: z.array(PrivateWikiPageIdSchema).max(500),
  exposure: z.object({
    browsePageIds: z.array(PrivateWikiPageIdSchema).length(0),
    searchablePageIds: z.array(PrivateWikiPageIdSchema).length(0),
    previewPageIds: z.array(PrivateWikiPageIdSchema).length(0),
    lumiContextPageIds: z.array(PrivateWikiPageIdSchema).length(0),
  }).strict().readonly(),
  boundary: P2StudentChannelShadowBoundarySchema,
  createdAt: z.string().datetime(),
}).strict().superRefine((snapshot, context) => {
  const restricted = new Set(snapshot.restrictedPageIds);
  if (restricted.size !== snapshot.restrictedPageIds.length) {
    context.addIssue({ code: "custom", path: ["restrictedPageIds"], message: "Restricted page IDs must be unique" });
  }
  if (snapshot.eligiblePageIds.length !== 0) {
    context.addIssue({ code: "custom", path: ["eligiblePageIds"], message: "P2 Shadow cannot expose eligible pages" });
  }
  if (
    snapshot.source.total !== snapshot.source.blocked
    || snapshot.source.total !== snapshot.source.rightsUnknown
    || snapshot.source.blocked !== snapshot.restrictedPageIds.length
  ) {
    context.addIssue({ code: "custom", path: ["source"], message: "P2 Shadow totals are inconsistent" });
  }
}).readonly();

export type P2StudentChannelShadowSnapshot = z.infer<typeof P2StudentChannelShadowSnapshotSchema>;

export function p2StudentChannelShadowSnapshotMaterial(
  snapshot: Omit<P2StudentChannelShadowSnapshot, "snapshotHash">,
) {
  return snapshot;
}
