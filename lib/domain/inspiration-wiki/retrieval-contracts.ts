import { z } from "zod";

import { WikiMaterialSourceSchema } from "./compilation-contracts";
import { RoleDomainReviewEvaluationInputSchema } from "./governance-contracts";

import {
  ReviewedWikiLinkSchema,
  RevisionBindingSchema,
  WikiLinkTypeSchema,
  WikiPageIdSchema,
  WikiPageTypeSchema,
  WikiSha256Schema,
} from "./core-contracts";

export const P1CurrentAllowlistEntrySchema = z.object({
  pageId: WikiPageIdSchema,
  pageRevision: RevisionBindingSchema,
  sourceMaterialReceipt: RevisionBindingSchema,
  compiledTruthHash: WikiSha256Schema,
  rightsDecisionSetRevision: RevisionBindingSchema,
  withdrawalSnapshotRevision: RevisionBindingSchema,
  acceptedReviewDecisionSetHash: WikiSha256Schema,
  indexAuthorizationCheckedAt: z.string().datetime(),
}).strict().readonly();

export const P1CurrentAllowlistSnapshotSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-p1-current-allowlist-snapshot/v1"),
  scope: z.literal("DRAFT_SHADOW"),
  authority: z.object({
    source: z.literal("UPSTREAM_TRUSTED_CURRENT_ALLOWLIST"),
    trustBoundary: z.literal("D18_PERSISTED_CURRENTNESS_NOT_IMPLEMENTED_IN_S1"),
    receipt: RevisionBindingSchema,
  }).strict().readonly(),
  snapshotRevision: RevisionBindingSchema,
  indexRevision: RevisionBindingSchema,
  asOf: z.string().datetime(),
  validUntil: z.string().datetime(),
  entries: z.array(P1CurrentAllowlistEntrySchema).min(1).max(200).readonly(),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.validUntil) <= Date.parse(value.asOf)) {
    context.addIssue({ code: "custom", message: "Current allowlist must have a finite future validity bound" });
  }
  const pageIds = value.entries.map((entry) => entry.pageId);
  if (new Set(pageIds).size !== pageIds.length) {
    context.addIssue({ code: "custom", message: "Current allowlist page ids must be unique" });
  }
}).readonly();

export const P1SeedQueryInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  eligiblePageIds: z.array(WikiPageIdSchema).min(1).max(200),
  allowedPageTypes: z.array(WikiPageTypeSchema).min(1).max(7),
  allowedLinkTypes: z.array(WikiLinkTypeSchema).max(7),
  hopLimit: z.union([z.literal(1), z.literal(2)]),
  resultLimit: z.number().int().min(1).max(50),
  evaluatedAt: z.string().datetime(),
  evaluatedAtTrustBoundary: z.literal("UPSTREAM_TRUSTED_CLOCK_NOT_IMPLEMENTED_IN_S1"),
  expectedIndexRevision: RevisionBindingSchema,
  currentAllowlist: P1CurrentAllowlistSnapshotSchema,
}).strict();

export const P1SeedQueryContractSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-p1-seed-query/v1"),
  scope: z.literal("DRAFT_SHADOW"),
  audience: z.literal("INTERNAL_REVIEWER_ONLY"),
  normalizedQuery: z.string().trim().min(1).max(500),
  eligiblePageIds: z.array(WikiPageIdSchema).min(1).max(200).readonly(),
  currentnessContract: z.literal("UPSTREAM_SNAPSHOT_REQUIRED_QUERY_ONLY_NARROWS"),
  currentAllowlist: P1CurrentAllowlistSnapshotSchema,
  allowedPageTypes: z.array(WikiPageTypeSchema).min(1).max(7).readonly(),
  seedModes: z.tuple([z.literal("FTS"), z.literal("ALIAS"), z.literal("FACET")]).readonly(),
  lexicalMatchContract: z.literal("EXACT_NORMALIZED_TERMS_NOT_SUBSTRING"),
  graph: z.object({
    scope: z.literal("ELIGIBLE_VISIBLE_SUBGRAPH"),
    allowedLinkTypes: z.array(WikiLinkTypeSchema).max(7).readonly(),
    hopLimit: z.union([z.literal(1), z.literal(2)]),
    hiddenNodesAsBridges: z.literal(false),
  }).strict().readonly(),
  vector: z.object({
    mode: z.literal("VECTOR_DISABLED"),
    vectorCalls: z.literal(0),
    provider: z.null(),
    index: z.null(),
  }).strict().readonly(),
  resultLimit: z.number().int().min(1).max(50),
  evaluatedAt: z.string().datetime(),
  evaluatedAtTrustBoundary: z.literal("UPSTREAM_TRUSTED_CLOCK_NOT_IMPLEMENTED_IN_S1"),
  expectedIndexRevision: RevisionBindingSchema,
}).strict().readonly();

export const P1SeedPageSchema = z.object({
  projectionSource: z.literal("WIKI_PAGE_REVISION"),
  pageId: WikiPageIdSchema,
  revision: RevisionBindingSchema,
  compilationReceipt: RevisionBindingSchema,
  sourceMaterialReceipt: RevisionBindingSchema,
  compiledTruthHash: WikiSha256Schema,
  rightsDecisionSetRevision: RevisionBindingSchema,
  withdrawalSnapshotRevision: RevisionBindingSchema,
  acceptedReviewDecisionSetHash: WikiSha256Schema,
  authorizationCheckedAt: z.string().datetime(),
  pageType: WikiPageTypeSchema,
  visibility: z.enum(["ELIGIBLE", "HIDDEN", "WITHDRAWN"]),
  title: z.string().trim().min(1).max(240),
  ftsTerms: z.array(z.string().trim().min(1).max(240)).max(200).readonly(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(40).readonly(),
  facets: z.array(z.string().trim().min(1).max(120)).max(60).readonly(),
  termSourceDigest: WikiSha256Schema,
  termProjectionReceipt: RevisionBindingSchema,
}).strict().readonly();

export const P1SeedMaterialSourceSchema = z.object({
  sourceMaterial: WikiMaterialSourceSchema,
  reviewGate: RoleDomainReviewEvaluationInputSchema,
  visibility: z.enum(["ELIGIBLE", "HIDDEN", "WITHDRAWN"]),
}).strict().readonly();

export const P1SeedIndexBuildReceiptSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-p1-seed-index-build-receipt/v1"),
  receipt: RevisionBindingSchema,
  sourceMaterialReceipts: z.array(RevisionBindingSchema).min(1).max(200).readonly(),
  pageSetHash: WikiSha256Schema,
  linkSetHash: WikiSha256Schema,
  vectorMode: z.literal("VECTOR_DISABLED"),
  createdAt: z.string().datetime(),
}).strict().readonly();

export const P1SeedIndexInputSchema = z.object({
  sources: z.array(P1SeedMaterialSourceSchema).min(1).max(200),
  links: z.array(ReviewedWikiLinkSchema).max(1_000),
  createdAt: z.string().datetime(),
}).strict();

export const P1SeedIndexSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-p1-seed-index/v1"),
  indexRevision: RevisionBindingSchema,
  buildReceipt: P1SeedIndexBuildReceiptSchema,
  sources: z.array(P1SeedMaterialSourceSchema).min(1).max(200).readonly(),
  pages: z.array(P1SeedPageSchema).max(200).readonly(),
  links: z.array(ReviewedWikiLinkSchema).max(1_000).readonly(),
}).strict().readonly();

export const P1SeedQueryResultSchema = z.object({
  pageId: WikiPageIdSchema,
  revision: RevisionBindingSchema,
  matchedBy: z.array(z.enum(["FTS", "ALIAS", "FACET", "VISIBLE_GRAPH"])).min(1).max(4).readonly(),
  relationshipPaths: z.array(z.object({
    fromPageId: WikiPageIdSchema,
    toPageId: WikiPageIdSchema,
    linkIds: z.array(z.string().min(1).max(180)).min(1).max(2).readonly(),
  }).strict().superRefine((value, context) => {
    if (value.fromPageId === value.toPageId) {
      context.addIssue({ code: "custom", message: "Relationship paths cannot return to their origin" });
    }
    if (new Set(value.linkIds).size !== value.linkIds.length) {
      context.addIssue({ code: "custom", message: "Relationship paths cannot reuse a link" });
    }
  }).readonly()).max(8).readonly(),
}).strict().superRefine((value, context) => {
  const paths = value.relationshipPaths.map((path) => JSON.stringify(path));
  if (new Set(paths).size !== paths.length) {
    context.addIssue({ code: "custom", message: "Relationship paths must be unique" });
  }
}).readonly();

export const P1SeedQueryResponseSchema = z.object({
  results: z.array(P1SeedQueryResultSchema).max(50).readonly(),
  vectorCalls: z.literal(0),
  noAnswer: z.boolean(),
}).strict().readonly();

export type P1SeedQueryContract = z.infer<typeof P1SeedQueryContractSchema>;
export type P1SeedIndex = z.infer<typeof P1SeedIndexSchema>;
export type P1SeedIndexInput = z.infer<typeof P1SeedIndexInputSchema>;
export type P1SeedQueryResponse = z.infer<typeof P1SeedQueryResponseSchema>;
export type P1CurrentAllowlistSnapshot = z.infer<typeof P1CurrentAllowlistSnapshotSchema>;
export type P1CurrentAllowlistEntry = z.infer<typeof P1CurrentAllowlistEntrySchema>;
