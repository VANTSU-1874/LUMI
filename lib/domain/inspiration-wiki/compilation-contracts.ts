import { z } from "zod";

import {
  CanonicalInputBundleSchema,
  CanonicalLedgerCursorSchema,
  CourseConceptReferenceSchema,
  RevisionBindingSchema,
  TimelineEntrySchema,
  WikiClaimTypeSchema,
  WikiClaimProvenanceSchema,
  WikiLinkDecisionDraftSchema,
  WikiOpaqueIdSchema,
  WikiPageDraftSchema,
  WikiPageIdSchema,
  WikiPageRevisionSchema,
  WikiPageTypeSchema,
  WikiSha256Schema,
} from "./core-contracts";

export const CompiledTruthSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-compiled-truth/v1"),
  state: z.literal("CURRENT_COMPILED_TRUTH"),
  pageId: WikiPageIdSchema,
  pageType: WikiPageTypeSchema,
  pageRevision: RevisionBindingSchema,
  canonicalInputBundle: RevisionBindingSchema,
  contentHash: WikiSha256Schema,
  compiledAt: z.string().datetime(),
  title: z.string().trim().min(1).max(240),
  aliases: z.array(z.string().trim().min(1).max(120)).max(40).readonly(),
  facets: z.array(z.string().trim().min(1).max(120)).max(60).readonly(),
  claims: z.array(z.object({
    claimId: WikiOpaqueIdSchema,
    claimType: WikiClaimTypeSchema,
    text: z.string().trim().min(1).max(2_000),
    supportObjectIds: z.array(WikiOpaqueIdSchema).min(2).max(20).readonly(),
    provenance: WikiClaimProvenanceSchema,
    authorship: z.literal("HUMAN_REVIEWED"),
    reviewDecisionIds: z.array(WikiOpaqueIdSchema).min(1).max(20).readonly(),
  }).strict().readonly()).max(80).readonly(),
  courseConceptRefs: z.array(CourseConceptReferenceSchema).max(20).readonly(),
}).strict().superRefine((value, context) => {
  const courseConceptIds = new Set(value.courseConceptRefs.map((reference) => reference.conceptId));
  if (value.pageType === "INSPIRATION_CASE") {
    for (const claim of value.claims) {
      if (claim.provenance.domain !== "NON_COURSE_INSPIRATION") {
        context.addIssue({ code: "custom", message: "Inspiration claims require exact non-course provenance" });
      }
      if (claim.supportObjectIds.some((objectId) => courseConceptIds.has(objectId))) {
        context.addIssue({ code: "custom", message: "Inspiration claims cannot use Course Knowledge concepts as support" });
      }
      if (new Set(claim.reviewDecisionIds).size !== claim.reviewDecisionIds.length) {
        context.addIssue({ code: "custom", message: "Claim review decisions must be unique" });
      }
    }
  }
  if (value.pageType !== "COURSE_CONCEPT_REF") return;
  const reference = value.courseConceptRefs[0];
  if (value.courseConceptRefs.length !== 1 || !reference) {
    context.addIssue({ code: "custom", message: "COURSE_CONCEPT_REF must contain one opaque course reference" });
  }
  if (!reference || value.title !== reference.displayLabel) {
    context.addIssue({ code: "custom", message: "COURSE_CONCEPT_REF title must equal its approved display label" });
  }
  if (value.aliases.length > 0 || value.facets.length > 0 || value.claims.length > 0) {
    context.addIssue({ code: "custom", message: "COURSE_CONCEPT_REF cannot contain copied course claims or explanatory text" });
  }
}).readonly();

export const WikiCompilerIdentitySchema = z.object({
  adapter: z.literal("LUMI_COMPATIBLE_PURE_PORT"),
  compilerId: WikiOpaqueIdSchema,
  compilerVersion: z.string().trim().min(1).max(80),
  runtimeCommit: z.literal("NOT_SELECTED_D17_PENDING"),
}).strict().readonly();

export const CompilationReceiptSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-wiki-compilation-receipt/v1"),
  receipt: RevisionBindingSchema,
  receiptKind: z.literal("DRAFT_COMPILATION_RECEIPT"),
  release: z.null(),
  canonicalInputBundle: RevisionBindingSchema,
  ledger: CanonicalLedgerCursorSchema,
  schemaPackVersion: z.literal("lumi-inspiration-wiki-schema-pack/v1"),
  compiler: WikiCompilerIdentitySchema,
  outputPageSetHash: WikiSha256Schema,
  outputTimelineSetHash: WikiSha256Schema,
  outputLinkSetHash: WikiSha256Schema,
  rightsSnapshotHash: WikiSha256Schema,
  withdrawalSnapshotHash: WikiSha256Schema,
  vectorMode: z.literal("VECTOR_DISABLED"),
  createdAt: z.string().datetime(),
}).strict().readonly();

// Deliberately clock-only: all semantic page material comes from the exact
// Canonical Candidate/Analysis payloads, never from a caller-supplied seed.
export const WikiDraftSeedSchema = z.object({
  occurredAt: z.string().datetime(),
  recordedAt: z.string().datetime(),
}).strict();

// Semantic edits require a new CanonicalInputBundle and a fresh compilation.
// A revision request can only advance time for the already-verified material.
export const WikiDraftPatchSchema = z.object({
  createdAt: z.string().datetime(),
}).strict();

export const WikiDraftCompilationSchema = z.object({
  pageDraft: WikiPageDraftSchema,
  pageRevision: WikiPageRevisionSchema,
  timelineEntries: z.array(TimelineEntrySchema).min(1).max(20).readonly(),
  linkDecisionDrafts: z.array(WikiLinkDecisionDraftSchema).max(80).readonly(),
  receipt: CompilationReceiptSchema,
  lint: z.object({
    passed: z.literal(true),
    issues: z.tuple([]).readonly(),
  }).strict().readonly(),
}).strict().readonly();

export const WikiDraftMaterialSourceSchema = z.object({
  canonicalInputBundle: CanonicalInputBundleSchema,
  compilation: WikiDraftCompilationSchema,
}).strict().readonly();

export const WikiMaterialSourceSchema = z.object({
  canonicalInputBundle: CanonicalInputBundleSchema,
  compilation: WikiDraftCompilationSchema,
  compiledTruth: CompiledTruthSchema,
}).strict().readonly();

export const VerifiedWikiDraftMaterialSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-verified-wiki-draft-material/v1"),
  draftMaterialReceipt: RevisionBindingSchema,
  pageId: WikiPageIdSchema,
  candidateRevision: RevisionBindingSchema,
  pageDraftRevision: RevisionBindingSchema,
  pageRevision: RevisionBindingSchema,
  canonicalInputBundle: RevisionBindingSchema,
  compilationReceipt: RevisionBindingSchema,
  compiledPreviewHash: WikiSha256Schema,
  timelineSetHash: WikiSha256Schema,
  linkSetHash: WikiSha256Schema,
  ledger: CanonicalLedgerCursorSchema,
  rightsDecisionSetRevision: RevisionBindingSchema,
  withdrawalSnapshotRevision: RevisionBindingSchema,
}).strict().readonly();

export const VerifiedWikiMaterialSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-verified-wiki-material/v1"),
  materialReceipt: RevisionBindingSchema,
  draftMaterialReceipt: RevisionBindingSchema,
  pageId: WikiPageIdSchema,
  candidateRevision: RevisionBindingSchema,
  pageDraftRevision: RevisionBindingSchema,
  pageRevision: RevisionBindingSchema,
  canonicalInputBundle: RevisionBindingSchema,
  compilationReceipt: RevisionBindingSchema,
  compiledTruthHash: WikiSha256Schema,
  compiledPreviewHash: WikiSha256Schema,
  timelineSetHash: WikiSha256Schema,
  linkSetHash: WikiSha256Schema,
  ledger: CanonicalLedgerCursorSchema,
  rightsDecisionSetRevision: RevisionBindingSchema,
  withdrawalSnapshotRevision: RevisionBindingSchema,
}).strict().readonly();

export type CompiledTruth = z.infer<typeof CompiledTruthSchema>;
export type CompilationReceipt = z.infer<typeof CompilationReceiptSchema>;
export type WikiDraftSeed = z.infer<typeof WikiDraftSeedSchema>;
export type WikiDraftPatch = z.infer<typeof WikiDraftPatchSchema>;
export type WikiDraftCompilation = z.infer<typeof WikiDraftCompilationSchema>;
export type WikiDraftMaterialSource = z.infer<typeof WikiDraftMaterialSourceSchema>;
export type WikiMaterialSource = z.infer<typeof WikiMaterialSourceSchema>;
export type VerifiedWikiDraftMaterial = z.infer<typeof VerifiedWikiDraftMaterialSchema>;
export type VerifiedWikiMaterial = z.infer<typeof VerifiedWikiMaterialSchema>;
