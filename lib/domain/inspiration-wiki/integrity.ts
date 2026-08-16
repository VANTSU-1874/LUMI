import { createHash } from "node:crypto";

import {
  CompilationReceiptSchema,
  CompiledTruthSchema,
  VerifiedWikiDraftMaterialSchema,
  VerifiedWikiMaterialSchema,
  WikiDraftCompilationSchema,
  WikiDraftMaterialSourceSchema,
  WikiDraftPatchSchema,
  WikiDraftSeedSchema,
  WikiMaterialSourceSchema,
  type CompilationReceipt,
  type CompiledTruth,
  type VerifiedWikiDraftMaterial,
  type VerifiedWikiMaterial,
  type WikiDraftCompilation,
  type WikiDraftMaterialSource,
  type WikiMaterialSource,
} from "./compilation-contracts";
import {
  CanonicalInputBundleSchema,
  CanonicalInputBundleSeedSchema,
  ReviewedWikiLinkSchema,
  RevisionBindingSchema,
  TimelineEntrySchema,
  WikiClaimProvenanceSchema,
  WikiLinkDecisionDraftSchema,
  WikiPageDraftSchema,
  WikiPageRevisionSchema,
  type CanonicalInputBundle,
  type CanonicalInputObject,
  type ReviewedWikiLink,
  type RevisionBinding,
  type WikiPageDraft,
  type WikiPageRevision,
} from "./core-contracts";

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export class WikiContractIntegrityError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Inspiration Wiki contract failed closed: ${code}`);
    this.name = "WikiContractIntegrityError";
    this.code = code;
  }
}

function cloneWikiValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneWikiValue(item)) as T;
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new WikiContractIntegrityError("NON_JSON_CLONE_INPUT");
    }
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      cloneWikiValue(child),
    ])) as T;
  }
  return value;
}

function freezeWikiClone<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) freezeWikiClone(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export function deepFreezeWikiValue<T>(value: T): DeepReadonly<T> {
  return freezeWikiClone(cloneWikiValue(value));
}

export function stableWikiJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new WikiContractIntegrityError("NON_FINITE_CANONICAL_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableWikiJson).join(",")}]`;
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new WikiContractIntegrityError("NON_JSON_CANONICAL_OBJECT");
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableWikiJson(item)}`).join(",")}}`;
  }
  throw new WikiContractIntegrityError("NON_JSON_CANONICAL_VALUE");
}

export function hashWikiValue(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(stableWikiJson(value), "utf8").digest("hex")}`;
}

export function bindWikiRevision(revisionId: string, payload: unknown): RevisionBinding {
  return RevisionBindingSchema.parse({
    revisionId,
    revisionHash: hashWikiValue({ revisionId, payload }),
  });
}

export function wikiRevisionMatches(binding: RevisionBinding, payload: unknown) {
  const parsed = RevisionBindingSchema.safeParse(binding);
  return parsed.success && parsed.data.revisionHash === bindWikiRevision(parsed.data.revisionId, payload).revisionHash;
}

function withoutKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]) {
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !excluded.has(key)));
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function canonicalBundleMaterial(bundle: Omit<CanonicalInputBundle, "bundle" | "schemaVersion">) {
  const inputs = [...bundle.inputs].sort((left, right) => left.kind.localeCompare(right.kind));
  return {
    caseId: bundle.caseId,
    candidateId: bundle.candidateId,
    inputs,
    ledger: bundle.ledger,
    courseConceptRefs: bundle.courseConceptRefs,
  };
}

export function createCanonicalInputBundle(rawSeed: unknown): DeepReadonly<CanonicalInputBundle> {
  const seed = CanonicalInputBundleSeedSchema.parse(rawSeed);
  const inputs = seed.inputs.map((input) => {
    const payload = { kind: input.kind, objectId: input.objectId, payload: input.payload };
    return {
      kind: input.kind,
      objectId: input.objectId,
      revision: bindWikiRevision(input.revisionId, payload),
      payload: input.payload,
    } as CanonicalInputObject;
  }).sort((left, right) => left.kind.localeCompare(right.kind));
  const material = canonicalBundleMaterial({
    caseId: seed.caseId,
    candidateId: seed.candidateId,
    inputs,
    ledger: seed.ledger,
    courseConceptRefs: seed.courseConceptRefs,
  });
  const bundleId = `canonical-bundle:${hashWikiValue(material).slice(7, 31)}`;
  const bundle = CanonicalInputBundleSchema.parse({
    schemaVersion: "lumi-inspiration-canonical-input-bundle/v1",
    bundle: bindWikiRevision(bundleId, material),
    ...material,
  });
  return deepFreezeWikiValue(bundle);
}

export function parseImmutableCanonicalInputBundle(rawBundle: unknown): DeepReadonly<CanonicalInputBundle> {
  const bundle = CanonicalInputBundleSchema.parse(rawBundle);
  for (const input of bundle.inputs) {
    const payload = { kind: input.kind, objectId: input.objectId, payload: input.payload };
    if (!wikiRevisionMatches(input.revision, payload)) {
      throw new WikiContractIntegrityError(`STALE_${input.kind}_HASH`);
    }
  }
  const material = canonicalBundleMaterial(bundle);
  const expectedId = `canonical-bundle:${hashWikiValue(material).slice(7, 31)}`;
  if (bundle.bundle.revisionId !== expectedId || !wikiRevisionMatches(bundle.bundle, material)) {
    throw new WikiContractIntegrityError("STALE_CANONICAL_BUNDLE_HASH");
  }
  return deepFreezeWikiValue(bundle);
}

type CanonicalInputKind = CanonicalInputObject["kind"];

export function canonicalInput<K extends CanonicalInputKind>(
  bundle: CanonicalInputBundle,
  kind: K,
): Extract<CanonicalInputObject, { kind: K }> {
  const input = bundle.inputs.find((candidate) => candidate.kind === kind);
  if (!input) throw new WikiContractIntegrityError(`MISSING_${kind}`);
  return input as Extract<CanonicalInputObject, { kind: K }>;
}

export function canonicalInputRevision(bundle: CanonicalInputBundle, kind: CanonicalInputKind) {
  return canonicalInput(bundle, kind).revision;
}

function canonicalInputTime(input: CanonicalInputObject) {
  switch (input.kind) {
    case "SOURCE_VERSION": return input.payload.capturedAt;
    case "CANDIDATE_REVISION": return input.payload.createdAt;
    case "ANALYSIS_REVISION": return input.payload.createdAt;
    case "RIGHTS_DECISION_SET": return input.payload.decidedAt;
    case "REVIEW_PACKAGE_REVISION": return input.payload.preparedAt;
    case "WITHDRAWAL_SNAPSHOT": return input.payload.recordedAt;
  }
}

export function deriveCanonicalReleaseSemantics(rawBundle: unknown, evaluatedAt: string) {
  const bundle = parseImmutableCanonicalInputBundle(rawBundle);
  if (!Number.isFinite(Date.parse(evaluatedAt))) {
    throw new WikiContractIntegrityError("INVALID_CANONICAL_SEMANTICS_EVALUATION_TIME");
  }
  const rights = canonicalInput(bundle, "RIGHTS_DECISION_SET");
  const withdrawal = canonicalInput(bundle, "WITHDRAWAL_SNAPSHOT");
  const reasons: string[] = [];
  if (rights.payload.decision !== "ALLOW") reasons.push(`RIGHTS_${rights.payload.decision}`);
  if (Date.parse(rights.payload.decidedAt) > Date.parse(evaluatedAt)) reasons.push("RIGHTS_DECISION_NOT_YET_EFFECTIVE");
  if (rights.payload.decision === "ALLOW"
    && rights.payload.validUntil
    && Date.parse(rights.payload.validUntil) < Date.parse(rights.payload.decidedAt)) {
    reasons.push("RIGHTS_ALLOW_VALIDITY_PRECEDES_DECISION");
  }
  if (rights.payload.decision === "ALLOW"
    && rights.payload.validUntil
    && Date.parse(rights.payload.validUntil) < Date.parse(evaluatedAt)) {
    reasons.push("RIGHTS_ALLOW_EXPIRED");
  }
  if (withdrawal.payload.state !== "CLEAR") reasons.push(`WITHDRAWAL_${withdrawal.payload.state}`);
  if (withdrawal.payload.state !== "CLEAR"
    && Date.parse(withdrawal.payload.recordedAt) < Date.parse(withdrawal.payload.effectiveAt)) {
    reasons.push("WITHDRAWAL_RECORDED_BEFORE_EFFECTIVE");
  }
  if (Date.parse(withdrawal.payload.recordedAt) > Date.parse(evaluatedAt)) {
    reasons.push("WITHDRAWAL_SNAPSHOT_AFTER_EVALUATION");
  }
  return deepFreezeWikiValue({
    eligible: reasons.length === 0,
    reasons: uniqueSorted(reasons),
    rightsDecision: rights.payload.decision,
    withdrawalState: withdrawal.payload.state,
    rightsRevision: rights.revision,
    withdrawalRevision: withdrawal.revision,
  });
}

export function wikiPageIdForCase(caseId: string) {
  return `wiki-page:${hashWikiValue({ caseId }).slice(7, 31)}` as const;
}

function pageDraftMaterialFromBound(draft: WikiPageDraft): Omit<WikiPageDraft, "revision"> {
  return withoutKeys(draft, ["revision"]) as Omit<WikiPageDraft, "revision">;
}

function makePageDraft(raw: Omit<WikiPageDraft, "revision">): WikiPageDraft {
  const revisionId = `wiki-revision:${hashWikiValue(raw).slice(7, 31)}`;
  return WikiPageDraftSchema.parse({ ...raw, revision: bindWikiRevision(revisionId, raw) });
}

export function parseImmutableWikiPageDraft(rawDraft: unknown): DeepReadonly<WikiPageDraft> {
  const draft = WikiPageDraftSchema.parse(rawDraft);
  if (!wikiRevisionMatches(draft.revision, pageDraftMaterialFromBound(draft))) {
    throw new WikiContractIntegrityError("STALE_PAGE_DRAFT_HASH");
  }
  return deepFreezeWikiValue(draft);
}

function pageRevisionMaterialFromBound(revision: WikiPageRevision): Omit<WikiPageRevision, "revision"> {
  return withoutKeys(revision, ["revision"]) as Omit<WikiPageRevision, "revision">;
}

function makePageRevision(raw: Omit<WikiPageRevision, "revision">): WikiPageRevision {
  const revisionId = `wiki-page-revision:${hashWikiValue(raw).slice(7, 31)}`;
  return WikiPageRevisionSchema.parse({ ...raw, revision: bindWikiRevision(revisionId, raw) });
}

export function parseImmutableWikiPageRevision(rawRevision: unknown): DeepReadonly<WikiPageRevision> {
  const revision = WikiPageRevisionSchema.parse(rawRevision);
  if (!wikiRevisionMatches(revision.revision, pageRevisionMaterialFromBound(revision))) {
    throw new WikiContractIntegrityError("STALE_PAGE_REVISION_HASH");
  }
  return deepFreezeWikiValue(revision);
}

function compilationReceiptMaterial(receipt: CompilationReceipt) {
  return withoutKeys(receipt, ["receipt"]);
}

export function parseImmutableCompilationReceipt(rawReceipt: unknown): DeepReadonly<CompilationReceipt> {
  const receipt = CompilationReceiptSchema.parse(rawReceipt);
  if (!wikiRevisionMatches(receipt.receipt, compilationReceiptMaterial(receipt))) {
    throw new WikiContractIntegrityError("STALE_COMPILATION_RECEIPT_HASH");
  }
  return deepFreezeWikiValue(receipt);
}

export function parseImmutableCompiledTruth(rawTruth: unknown): DeepReadonly<CompiledTruth> {
  const truth = CompiledTruthSchema.parse(rawTruth);
  const material = withoutKeys(truth, ["contentHash"]);
  if (truth.contentHash !== hashWikiValue(material)) {
    throw new WikiContractIntegrityError("STALE_COMPILED_TRUTH_HASH");
  }
  return deepFreezeWikiValue(truth);
}

function reviewedLinkDecisionMaterial(link: ReviewedWikiLink) {
  return {
    linkId: link.linkId,
    fromPageId: link.fromPageId,
    fromPageRevision: link.fromPageRevision,
    toPageId: link.toPageId,
    toPageRevision: link.toPageRevision,
    sourcePageId: link.sourcePageId,
    sourcePageRevision: link.sourcePageRevision,
    sourceCanonicalInputBundle: link.sourceCanonicalInputBundle,
    sourceDraftMaterialReceipt: link.sourceDraftMaterialReceipt,
    linkDraftRevision: link.linkDraftRevision,
    relationType: link.relationType,
    evidenceRefs: link.evidenceRefs,
  };
}

export function parseImmutableReviewedWikiLink(rawLink: unknown): DeepReadonly<ReviewedWikiLink> {
  const link = ReviewedWikiLinkSchema.parse(rawLink);
  if (!wikiRevisionMatches(link.decision, reviewedLinkDecisionMaterial(link))) {
    throw new WikiContractIntegrityError("STALE_WIKI_LINK_DECISION");
  }
  if (!wikiRevisionMatches(link.approvalReceipt, withoutKeys(link, ["revision", "approvalReceipt"]))) {
    throw new WikiContractIntegrityError("STALE_WIKI_LINK_APPROVAL_RECEIPT");
  }
  if (!wikiRevisionMatches(link.revision, withoutKeys(link, ["revision"]))) {
    throw new WikiContractIntegrityError("STALE_REVIEWED_WIKI_LINK_REVISION");
  }
  return deepFreezeWikiValue(link);
}

function verifyClaimMaterial(
  bundle: CanonicalInputBundle,
  claim: {
    readonly claimId: string;
    readonly claimType: string;
    readonly text: string;
    readonly supportObjectIds: readonly string[];
  },
) {
  const supportIds = uniqueSorted(claim.supportObjectIds);
  if (supportIds.length !== claim.supportObjectIds.length) {
    throw new WikiContractIntegrityError("DUPLICATE_CLAIM_SUPPORT");
  }
  const courseConceptIds = new Set(bundle.courseConceptRefs.map((reference) => reference.conceptId));
  if (supportIds.some((objectId) => courseConceptIds.has(objectId))) {
    throw new WikiContractIntegrityError("COURSE_CONCEPT_CANNOT_SUPPORT_INSPIRATION_CLAIM");
  }
  const analysis = canonicalInput(bundle, "ANALYSIS_REVISION");
  if (analysis.payload.knowledgeDomain !== "NON_COURSE_INSPIRATION") {
    throw new WikiContractIntegrityError("COURSE_ANALYSIS_CANNOT_SUPPORT_INSPIRATION_CLAIM");
  }
  const exactAnalysisClaim = analysis.payload.claims.find((candidate) => (
    candidate.claimId === claim.claimId
    && candidate.claimType === claim.claimType
    && candidate.text === claim.text
    && stableWikiJson(uniqueSorted(candidate.supportObjectIds)) === stableWikiJson(supportIds)
  ));
  if (!exactAnalysisClaim || !supportIds.includes(analysis.objectId)) {
    throw new WikiContractIntegrityError("CLAIM_NOT_DERIVED_FROM_EXACT_ANALYSIS_REVISION");
  }
  let nonCourseEvidenceCount = 0;
  for (const objectId of supportIds) {
    const input = bundle.inputs.find((candidate) => candidate.objectId === objectId);
    if (!input) throw new WikiContractIntegrityError("CLAIM_SUPPORT_OUTSIDE_CANONICAL_BUNDLE");
    if (input.kind === "ANALYSIS_REVISION") {
      if (input.objectId !== analysis.objectId || input.payload.knowledgeDomain !== "NON_COURSE_INSPIRATION") {
        throw new WikiContractIntegrityError("CLAIM_SUPPORT_NOT_NON_COURSE_PROVENANCE");
      }
      continue;
    }
    if (input.kind !== "SOURCE_VERSION" || input.payload.sourceAuthority === "COURSE_KNOWLEDGE_V2") {
      throw new WikiContractIntegrityError("CLAIM_SUPPORT_NOT_NON_COURSE_PROVENANCE");
    }
    if (!input.payload.evidenceClaims.some((evidence) => (
      evidence.claimId === claim.claimId && evidence.text === claim.text
    ))) {
      throw new WikiContractIntegrityError("CLAIM_NOT_DERIVED_FROM_EXACT_NON_COURSE_EVIDENCE");
    }
    nonCourseEvidenceCount += 1;
  }
  if (nonCourseEvidenceCount === 0) {
    throw new WikiContractIntegrityError("CLAIM_REQUIRES_NON_COURSE_SOURCE_EVIDENCE");
  }
}

export function deriveInspirationClaimProvenance(
  rawBundle: unknown,
  rawSupportObjectIds: readonly string[],
) {
  const bundle = parseImmutableCanonicalInputBundle(rawBundle);
  const supportObjectIds = uniqueSorted(rawSupportObjectIds);
  if (supportObjectIds.length !== rawSupportObjectIds.length) {
    throw new WikiContractIntegrityError("DUPLICATE_CLAIM_SUPPORT");
  }
  const courseConceptIds = new Set(bundle.courseConceptRefs.map((reference) => reference.conceptId));
  const sources = supportObjectIds.map((objectId) => {
    if (courseConceptIds.has(objectId)) {
      throw new WikiContractIntegrityError("COURSE_CONCEPT_CANNOT_SUPPORT_INSPIRATION_CLAIM");
    }
    const input = bundle.inputs.find((candidate) => candidate.objectId === objectId);
    if (!input) throw new WikiContractIntegrityError("CLAIM_SUPPORT_OUTSIDE_CANONICAL_BUNDLE");
    if (input.kind === "SOURCE_VERSION") {
      if (input.payload.sourceAuthority === "COURSE_KNOWLEDGE_V2") {
        throw new WikiContractIntegrityError("COURSE_SOURCE_CANNOT_BE_RELABELED_NON_COURSE");
      }
      return {
        inputKind: "SOURCE_VERSION" as const,
        objectId: input.objectId,
        inputRevision: input.revision,
        sourceAuthority: input.payload.sourceAuthority,
      };
    }
    if (input.kind === "ANALYSIS_REVISION" && input.payload.knowledgeDomain === "NON_COURSE_INSPIRATION") {
      return {
        inputKind: "ANALYSIS_REVISION" as const,
        objectId: input.objectId,
        inputRevision: input.revision,
        knowledgeDomain: input.payload.knowledgeDomain,
      };
    }
    throw new WikiContractIntegrityError("CLAIM_SUPPORT_NOT_NON_COURSE_PROVENANCE");
  });
  if (!sources.some((source) => source.inputKind === "SOURCE_VERSION")
    || !sources.some((source) => source.inputKind === "ANALYSIS_REVISION")) {
    throw new WikiContractIntegrityError("CLAIM_REQUIRES_SOURCE_AND_ANALYSIS_PROVENANCE");
  }
  return WikiClaimProvenanceSchema.parse({
    domain: "NON_COURSE_INSPIRATION",
    sources,
    courseKnowledgeUse: "NONE",
    courseKnowledgeBodyIncluded: false,
  });
}

function deriveClaimDrafts(bundle: CanonicalInputBundle) {
  const analysis = canonicalInput(bundle, "ANALYSIS_REVISION");
  if (analysis.payload.knowledgeDomain !== "NON_COURSE_INSPIRATION") return [];
  const nonCourseAnalysis = analysis.payload;
  const claimIds = nonCourseAnalysis.claims.map((claim) => claim.claimId);
  if (new Set(claimIds).size !== claimIds.length) {
    throw new WikiContractIntegrityError("DUPLICATE_CANONICAL_CLAIM_ID");
  }
  return nonCourseAnalysis.claims.map((claim) => {
    verifyClaimMaterial(bundle, claim);
    return {
      ...claim,
      supportObjectIds: uniqueSorted(claim.supportObjectIds),
      provenance: deriveInspirationClaimProvenance(bundle, claim.supportObjectIds),
      authorship: nonCourseAnalysis.authorship,
    };
  }).sort((left, right) => left.claimId.localeCompare(right.claimId));
}

function deriveDraftLinkDecisions(bundle: CanonicalInputBundle, pageId: string) {
  const candidate = canonicalInput(bundle, "CANDIDATE_REVISION");
  const canonicalIds = new Set(bundle.inputs.map((input) => input.objectId));
  return candidate.payload.linkDrafts.map((link) => {
    const evidenceRefs = uniqueSorted(link.evidenceObjectIds);
    if (evidenceRefs.length !== link.evidenceObjectIds.length
      || evidenceRefs.some((objectId) => !canonicalIds.has(objectId))) {
      throw new WikiContractIntegrityError("LINK_EVIDENCE_OUTSIDE_CANONICAL_BUNDLE");
    }
    for (const evidenceId of evidenceRefs) {
      const input = bundle.inputs.find((item) => item.objectId === evidenceId);
      if (!input
        || (input.kind !== "SOURCE_VERSION" && input.kind !== "ANALYSIS_REVISION")
        || (input.kind === "SOURCE_VERSION" && input.payload.sourceAuthority === "COURSE_KNOWLEDGE_V2")
        || (input.kind === "ANALYSIS_REVISION" && input.payload.knowledgeDomain !== "NON_COURSE_INSPIRATION")) {
        throw new WikiContractIntegrityError("LINK_EVIDENCE_NOT_EXACT_NON_COURSE_MATERIAL");
      }
    }
    const toPageId = wikiPageIdForCase(link.toCaseId);
    const identity = { fromPageId: pageId, toPageId, relationType: link.relationType, evidenceRefs, reason: link.reason };
    const linkId = `wiki-link:${hashWikiValue(identity).slice(7, 31)}`;
    const material = {
      schemaVersion: "lumi-inspiration-wiki-link-decision-draft/v1" as const,
      linkId,
      fromPageId: pageId,
      toPageId,
      relationType: link.relationType,
      evidenceRefs,
      reason: link.reason,
      reviewState: "PROPOSED" as const,
      audience: "INTERNAL_REVIEWER_ONLY" as const,
    };
    return WikiLinkDecisionDraftSchema.parse({
      ...material,
      revision: bindWikiRevision(`wiki-link-revision:${hashWikiValue(material).slice(7, 31)}`, material),
    });
  }).sort((left, right) => left.linkId.localeCompare(right.linkId));
}

function buildWikiDraftCompilation(
  bundle: CanonicalInputBundle,
  seed: ReturnType<typeof WikiDraftSeedSchema.parse>,
): WikiDraftCompilation {
  if (Date.parse(seed.recordedAt) < Date.parse(seed.occurredAt)) {
    throw new WikiContractIntegrityError("TIMELINE_RECORDED_BEFORE_OCCURRED");
  }
  const latestCanonicalTime = Math.max(...bundle.inputs.map((input) => Date.parse(canonicalInputTime(input))));
  if (Date.parse(seed.occurredAt) < latestCanonicalTime) {
    throw new WikiContractIntegrityError("DRAFT_OCCURRED_BEFORE_CANONICAL_INPUT");
  }
  const candidate = canonicalInput(bundle, "CANDIDATE_REVISION");
  const analysis = canonicalInput(bundle, "ANALYSIS_REVISION");
  const pageId = wikiPageIdForCase(bundle.caseId);
  let title = candidate.payload.title;
  let aliases = uniqueSorted(candidate.payload.aliases);
  let facets = uniqueSorted(candidate.payload.facets);
  let claimDrafts = deriveClaimDrafts(bundle);
  if (candidate.payload.pageType === "INSPIRATION_CASE"
    && analysis.payload.knowledgeDomain !== "NON_COURSE_INSPIRATION") {
    throw new WikiContractIntegrityError("INSPIRATION_CASE_REQUIRES_NON_COURSE_ANALYSIS");
  }
  if (candidate.payload.pageType === "COURSE_CONCEPT_REF") {
    const reference = bundle.courseConceptRefs[0];
    if (!reference || bundle.courseConceptRefs.length !== 1
      || candidate.payload.title !== reference.displayLabel
      || candidate.payload.aliases.length > 0
      || candidate.payload.facets.length > 0
      || candidate.payload.linkDrafts.length > 0
      || (analysis.payload.knowledgeDomain === "NON_COURSE_INSPIRATION" && analysis.payload.claims.length > 0)) {
      throw new WikiContractIntegrityError("COURSE_CONCEPT_REF_MUST_BE_OPAQUE_REFERENCE_ONLY");
    }
    title = reference.displayLabel;
    aliases = [];
    facets = [];
    claimDrafts = [];
  }
  const pageDraft = makePageDraft({
    schemaVersion: "lumi-inspiration-wiki-page-draft/v1",
    pageId,
    pageType: candidate.payload.pageType,
    caseId: bundle.caseId,
    canonicalInputBundle: bundle.bundle,
    revisionNumber: 1,
    supersedesRevision: null,
    state: "DRAFT_COMPILED_PREVIEW",
    audience: "INTERNAL_REVIEWER_ONLY",
    title,
    createdAt: seed.recordedAt,
    aliases,
    facets,
    claimDrafts,
    courseConceptRefs: bundle.courseConceptRefs,
  });
  const compiledPreviewHash = hashWikiValue(pageDraft);
  const pageRevision = makePageRevision({
    schemaVersion: "lumi-inspiration-wiki-page-revision/v1",
    pageId,
    pageDraftRevision: pageDraft.revision,
    revisionNumber: 1,
    canonicalInputBundle: bundle.bundle,
    compiledPreviewHash,
    reviewState: "PENDING_REVIEW",
    schemaPackVersion: "lumi-inspiration-wiki-schema-pack/v1",
    compilerIdentity: "wiki-compiler:lumi-s1-v1",
    createdAt: seed.recordedAt,
    supersedesRevision: null,
  });
  const timelineIdentity = { pageId, bundle: bundle.bundle, occurredAt: seed.occurredAt, recordedAt: seed.recordedAt };
  const eventId = `wiki-event:${hashWikiValue(timelineIdentity).slice(7, 31)}`;
  const timelineMaterial = {
    schemaVersion: "lumi-inspiration-wiki-timeline-entry/v1" as const,
    eventId,
    pageId,
    pageRevision: pageRevision.revision,
    eventType: "DRAFT_COMPILED" as const,
    projectionState: "DRAFT" as const,
    occurredAt: seed.occurredAt,
    recordedAt: seed.recordedAt,
    canonicalInputBundle: bundle.bundle,
    ledger: bundle.ledger,
    evidenceRefs: bundle.inputs.map((input) => input.objectId),
    correctsEventId: null,
    supersedesEventId: null,
  };
  const timelineEntries = [TimelineEntrySchema.parse({
    ...timelineMaterial,
    entryRevision: bindWikiRevision(`wiki-event-revision:${hashWikiValue(timelineMaterial).slice(7, 31)}`, timelineMaterial),
  })];
  const linkDecisionDrafts = deriveDraftLinkDecisions(bundle, pageId);
  const rights = canonicalInput(bundle, "RIGHTS_DECISION_SET");
  const withdrawal = canonicalInput(bundle, "WITHDRAWAL_SNAPSHOT");
  const compiler = {
    adapter: "LUMI_COMPATIBLE_PURE_PORT" as const,
    compilerId: "wiki-compiler:lumi-s1-v1",
    compilerVersion: "1.0.0",
    runtimeCommit: "NOT_SELECTED_D17_PENDING" as const,
  };
  const receiptMaterial = {
    schemaVersion: "lumi-inspiration-wiki-compilation-receipt/v1" as const,
    receiptKind: "DRAFT_COMPILATION_RECEIPT" as const,
    release: null,
    canonicalInputBundle: bundle.bundle,
    ledger: bundle.ledger,
    schemaPackVersion: "lumi-inspiration-wiki-schema-pack/v1" as const,
    compiler,
    outputPageSetHash: hashWikiValue([pageRevision]),
    outputTimelineSetHash: hashWikiValue(timelineEntries),
    outputLinkSetHash: hashWikiValue(linkDecisionDrafts),
    rightsSnapshotHash: rights.revision.revisionHash,
    withdrawalSnapshotHash: withdrawal.revision.revisionHash,
    vectorMode: "VECTOR_DISABLED" as const,
    createdAt: seed.recordedAt,
  };
  const receiptId = `wiki-receipt:${hashWikiValue(receiptMaterial).slice(7, 31)}`;
  const receipt = CompilationReceiptSchema.parse({
    ...receiptMaterial,
    receipt: bindWikiRevision(receiptId, receiptMaterial),
  });
  return WikiDraftCompilationSchema.parse({
    pageDraft,
    pageRevision,
    timelineEntries,
    linkDecisionDrafts,
    receipt,
    lint: { passed: true, issues: [] },
  });
}

export function compileWikiPageDraft(rawBundle: unknown, rawSeed: unknown): DeepReadonly<WikiDraftCompilation> {
  const bundle = parseImmutableCanonicalInputBundle(rawBundle);
  const seed = WikiDraftSeedSchema.parse(rawSeed);
  return deepFreezeWikiValue(buildWikiDraftCompilation(bundle, seed));
}

export function parseImmutableWikiDraftCompilation(
  rawCompilation: unknown,
  rawBundle: unknown,
): DeepReadonly<WikiDraftCompilation> {
  const bundle = parseImmutableCanonicalInputBundle(rawBundle);
  const compilation = WikiDraftCompilationSchema.parse(rawCompilation);
  const draftEvent = compilation.timelineEntries.find((entry) => entry.eventType === "DRAFT_COMPILED");
  if (!draftEvent) throw new WikiContractIntegrityError("DRAFT_TIMELINE_EVENT_MISSING");
  const expected = buildWikiDraftCompilation(bundle, {
    occurredAt: draftEvent.occurredAt,
    recordedAt: draftEvent.recordedAt,
  });
  if (stableWikiJson(compilation) !== stableWikiJson(expected)) {
    throw new WikiContractIntegrityError("COMPILATION_NOT_UNIQUELY_DERIVED_FROM_CANONICAL_MATERIAL");
  }
  return deepFreezeWikiValue(compilation);
}

export function reviseWikiPageDraft(
  rawCurrentCompilation: unknown,
  rawPatch: unknown,
  rawExpectedRevision: unknown,
  rawBundle: unknown,
): DeepReadonly<WikiPageDraft> {
  const bundle = parseImmutableCanonicalInputBundle(rawBundle);
  const currentCompilation = parseImmutableWikiDraftCompilation(rawCurrentCompilation, bundle);
  const current = currentCompilation.pageDraft;
  const patch = WikiDraftPatchSchema.parse(rawPatch);
  const expected = RevisionBindingSchema.parse(rawExpectedRevision);
  if (stableWikiJson(current.revision) !== stableWikiJson(expected)) {
    throw new WikiContractIntegrityError("STALE_PAGE_DRAFT_REVISION");
  }
  if (Date.parse(patch.createdAt) <= Date.parse(current.createdAt)) {
    throw new WikiContractIntegrityError("PAGE_DRAFT_REVISION_TIME_NOT_MONOTONIC");
  }
  return deepFreezeWikiValue(makePageDraft({
    ...pageDraftMaterialFromBound(current),
    revisionNumber: current.revisionNumber + 1,
    supersedesRevision: current.revision,
    createdAt: patch.createdAt,
  }));
}

export function deriveVerifiedWikiDraftMaterial(rawSource: unknown): DeepReadonly<VerifiedWikiDraftMaterial> {
  const source = WikiDraftMaterialSourceSchema.parse(rawSource) as WikiDraftMaterialSource;
  const bundle = parseImmutableCanonicalInputBundle(source.canonicalInputBundle);
  const compilation = parseImmutableWikiDraftCompilation(source.compilation, bundle);
  const draftMaterial = { canonicalInputBundle: bundle, compilation };
  const receiptId = `wiki-draft-material-receipt:${hashWikiValue(draftMaterial).slice(7, 31)}`;
  return deepFreezeWikiValue(VerifiedWikiDraftMaterialSchema.parse({
    schemaVersion: "lumi-inspiration-verified-wiki-draft-material/v1",
    draftMaterialReceipt: bindWikiRevision(receiptId, draftMaterial),
    pageId: compilation.pageDraft.pageId,
    candidateRevision: canonicalInputRevision(bundle, "CANDIDATE_REVISION"),
    pageDraftRevision: compilation.pageDraft.revision,
    pageRevision: compilation.pageRevision.revision,
    canonicalInputBundle: bundle.bundle,
    compilationReceipt: compilation.receipt.receipt,
    compiledPreviewHash: compilation.pageRevision.compiledPreviewHash,
    timelineSetHash: compilation.receipt.outputTimelineSetHash,
    linkSetHash: compilation.receipt.outputLinkSetHash,
    ledger: bundle.ledger,
    rightsDecisionSetRevision: canonicalInputRevision(bundle, "RIGHTS_DECISION_SET"),
    withdrawalSnapshotRevision: canonicalInputRevision(bundle, "WITHDRAWAL_SNAPSHOT"),
  }));
}

export function deriveVerifiedWikiMaterial(rawSource: unknown): DeepReadonly<VerifiedWikiMaterial> {
  const source = WikiMaterialSourceSchema.parse(rawSource) as WikiMaterialSource;
  const draftVerified = deriveVerifiedWikiDraftMaterial({
    canonicalInputBundle: source.canonicalInputBundle,
    compilation: source.compilation,
  });
  const bundle = parseImmutableCanonicalInputBundle(source.canonicalInputBundle);
  const compilation = parseImmutableWikiDraftCompilation(source.compilation, bundle);
  const truth = parseImmutableCompiledTruth(source.compiledTruth);
  const draft = compilation.pageDraft;
  if (truth.pageId !== draft.pageId
    || truth.pageType !== draft.pageType
    || stableWikiJson(truth.pageRevision) !== stableWikiJson(compilation.pageRevision.revision)
    || stableWikiJson(truth.canonicalInputBundle) !== stableWikiJson(bundle.bundle)
    || truth.title !== draft.title
    || stableWikiJson(truth.aliases) !== stableWikiJson(draft.aliases)
    || stableWikiJson(truth.facets) !== stableWikiJson(draft.facets)
    || stableWikiJson(truth.courseConceptRefs) !== stableWikiJson(bundle.courseConceptRefs)
    || Date.parse(truth.compiledAt) < Date.parse(compilation.receipt.createdAt)) {
    throw new WikiContractIntegrityError("COMPILED_TRUTH_SOURCE_MATERIAL_MISMATCH");
  }
  const expectedClaims = draft.claimDrafts.map((claim) => ({
    claimId: claim.claimId,
    claimType: claim.claimType,
    text: claim.text,
    supportObjectIds: claim.supportObjectIds,
    provenance: claim.provenance,
  }));
  const actualClaims = truth.claims.map((claim) => ({
    claimId: claim.claimId,
    claimType: claim.claimType,
    text: claim.text,
    supportObjectIds: claim.supportObjectIds,
    provenance: claim.provenance,
  }));
  if (stableWikiJson(actualClaims) !== stableWikiJson(expectedClaims)) {
    throw new WikiContractIntegrityError("COMPILED_TRUTH_CLAIMS_NOT_EXACTLY_DERIVED");
  }
  const materialSource = {
    canonicalInputBundle: bundle,
    compilation,
    compiledTruth: truth,
  };
  const materialReceiptId = `wiki-material-receipt:${hashWikiValue(materialSource).slice(7, 31)}`;
  return deepFreezeWikiValue(VerifiedWikiMaterialSchema.parse({
    schemaVersion: "lumi-inspiration-verified-wiki-material/v1",
    materialReceipt: bindWikiRevision(materialReceiptId, materialSource),
    draftMaterialReceipt: draftVerified.draftMaterialReceipt,
    pageId: draftVerified.pageId,
    candidateRevision: draftVerified.candidateRevision,
    pageDraftRevision: draftVerified.pageDraftRevision,
    pageRevision: draftVerified.pageRevision,
    canonicalInputBundle: draftVerified.canonicalInputBundle,
    compilationReceipt: draftVerified.compilationReceipt,
    compiledTruthHash: truth.contentHash,
    compiledPreviewHash: draftVerified.compiledPreviewHash,
    timelineSetHash: draftVerified.timelineSetHash,
    linkSetHash: draftVerified.linkSetHash,
    ledger: draftVerified.ledger,
    rightsDecisionSetRevision: draftVerified.rightsDecisionSetRevision,
    withdrawalSnapshotRevision: draftVerified.withdrawalSnapshotRevision,
  }));
}
