import {
  CompiledTruthSchema,
  type WikiDraftSeed,
  type WikiMaterialSource,
} from "@/lib/domain/inspiration-wiki/compilation-contracts";
import {
  ReviewedWikiLinkSchema,
  type CanonicalInputBundle,
  type CanonicalInputBundleSeed,
  type RevisionBinding,
} from "@/lib/domain/inspiration-wiki/core-contracts";
import {
  type ReleaseActivationReceipt,
  type ReleaseDecision,
  type ReleaseDecisionEvaluationInput,
  type ReviewerRoleAssignment,
  type ReviewTargetRiskScope,
  type RoleDomainPolicy,
  type RoleDomainReview,
  type StudentCurrentReleaseEligibilityInput,
  type WikiAudiencePolicy,
} from "@/lib/domain/inspiration-wiki/governance-contracts";
import {
  P1CurrentAllowlistSnapshotSchema,
  type P1CurrentAllowlistSnapshot,
  type P1SeedIndex,
} from "@/lib/domain/inspiration-wiki/retrieval-contracts";
import { deriveDomainReviewTarget } from "@/lib/domain/inspiration-wiki/governance";
import {
  bindWikiRevision,
  compileWikiPageDraft,
  createCanonicalInputBundle,
  deriveVerifiedWikiMaterial,
  hashWikiValue,
} from "@/lib/domain/inspiration-wiki/integrity";

export const CANONICAL_AT = "2026-08-09T23:00:00.000Z";
export const COMPILE_AT = "2026-08-10T00:00:00.000Z";
export const REVIEW_AT = "2026-08-10T01:00:00.000Z";
export const TRUTH_AT = "2026-08-10T01:30:00.000Z";
export const RELEASE_AT = "2026-08-10T02:00:00.000Z";
export const ACTIVATION_AT = "2026-08-10T03:00:00.000Z";

export type SyntheticMaterialOptions = {
  readonly slug?: string;
  readonly title?: string;
  readonly aliases?: readonly string[];
  readonly facets?: readonly string[];
  readonly claimText?: string;
  readonly linkToSlugs?: readonly string[];
  readonly rightsDecision?: "ALLOW" | "DENY" | "HOLD";
  readonly rightsValidUntil?: string | null;
  readonly withdrawalState?: "CLEAR" | "RIGHTS_HOLD" | "SAFETY_HOLD" | "WITHDRAWAL_HOLD" | "WITHDRAWN" | "REVOKED" | "REVIEW_HOLD";
};

function materialOptions(options: SyntheticMaterialOptions = {}) {
  const slug = options.slug ?? "synthetic-grid-rhythm";
  return {
    slug,
    title: options.title ?? (slug === "synthetic-grid-rhythm" ? "Synthetic grid rhythm" : `Synthetic ${slug}`),
    aliases: [...(options.aliases ?? (slug === "synthetic-grid-rhythm" ? ["栅格节奏", "Grid rhythm", "栅格节奏"] : [slug]))],
    facets: [...(options.facets ?? ["信息层级", "版式"])],
    claimText: options.claimText ?? `Synthetic ${slug} evidence establishes a clear reading order.`,
    linkToSlugs: [...(options.linkToSlugs ?? [`${slug}-contrast`])],
    rightsDecision: options.rightsDecision ?? "ALLOW",
    rightsValidUntil: options.rightsValidUntil ?? null,
    withdrawalState: options.withdrawalState ?? "CLEAR",
  };
}

function releaseDecisionMaterial(decision: Omit<ReleaseDecision, "decisionRevision">) {
  return decision;
}

export function rebindSyntheticReleaseDecision(
  raw: Omit<ReleaseDecision, "decisionRevision">,
): ReleaseDecision {
  return {
    ...raw,
    decisionRevision: bindWikiRevision(`${raw.decisionId}:revision`, releaseDecisionMaterial(raw)),
  };
}

export function syntheticActivationReceipt(
  decision: ReleaseDecision,
  current: ReleaseDecisionEvaluationInput["current"],
  times: { readonly recordedAt?: string; readonly activatedAt?: string } = {},
): ReleaseActivationReceipt {
  const recordedAt = times.recordedAt ?? ACTIVATION_AT;
  const activatedAt = times.activatedAt ?? ACTIVATION_AT;
  const releaseDecision = decision.decisionRevision;
  const channelReceipts = (["BROWSE_RELEASE", "STUDENT_SEARCH", "WIKI_RETRIEVAL"] as const).map((channel) => {
    const material = {
      schemaVersion: "lumi-inspiration-channel-activation-receipt/v1" as const,
      channel,
      state: current.channelStates[channel],
      release: current.release,
      pageRevision: current.pageRevision,
      releaseDecision,
      recordedAt,
    };
    return {
      ...material,
      receipt: bindWikiRevision(`channel-receipt:${channel.toLowerCase()}`, material),
    };
  });
  const material = {
    schemaVersion: "lumi-inspiration-release-activation-receipt/v1" as const,
    release: current.release,
    pageRevision: current.pageRevision,
    releaseDecision,
    channelReceipts,
    activatedAt,
  };
  return {
    ...material,
    receipt: bindWikiRevision("release-activation-receipt:synthetic-v1", material),
  };
}

export function syntheticCanonicalInputSeed(options: SyntheticMaterialOptions = {}): CanonicalInputBundleSeed {
  const selected = materialOptions(options);
  const claimId = `wiki-claim:${selected.slug}-observation`;
  const rightsPayload = selected.rightsDecision === "ALLOW"
    ? {
      decision: "ALLOW" as const,
      decidedAt: CANONICAL_AT,
      validUntil: selected.rightsValidUntil,
      studentDisplay: "ALLOW" as const,
      sourceDisclosure: "ALLOW" as const,
      preview: "ALLOW" as const,
      aiCitation: "ALLOW" as const,
    }
    : selected.rightsDecision === "DENY"
      ? { decision: "DENY" as const, decidedAt: CANONICAL_AT, reason: "Synthetic rights denial." }
      : {
        decision: "HOLD" as const,
        decidedAt: CANONICAL_AT,
        holdKind: "RIGHTS_HOLD" as const,
        reason: "Synthetic rights hold.",
      };
  const withdrawalPayload = selected.withdrawalState === "CLEAR"
    ? { state: "CLEAR" as const, recordedAt: CANONICAL_AT }
    : {
      state: selected.withdrawalState,
      recordedAt: CANONICAL_AT,
      effectiveAt: CANONICAL_AT,
      reason: "Synthetic canonical restriction.",
    };
  return {
    caseId: `inspiration-case:${selected.slug}`,
    candidateId: `inspiration-intake:${selected.slug}`,
    inputs: [
      {
        kind: "SOURCE_VERSION",
        objectId: `source:${selected.slug}`,
        revisionId: `source-revision:${selected.slug}-v1`,
        payload: {
          sourceAuthority: "NON_COURSE_SYNTHETIC_FIXTURE",
          locator: `fixture:source-${selected.slug}`,
          capturedAt: CANONICAL_AT,
          evidenceClaims: [{ claimId, text: selected.claimText }],
        },
      },
      {
        kind: "CANDIDATE_REVISION",
        objectId: `candidate:${selected.slug}`,
        revisionId: `candidate-revision:${selected.slug}-v1`,
        payload: {
          pageType: "INSPIRATION_CASE",
          title: selected.title,
          aliases: selected.aliases,
          facets: selected.facets,
          scope: "PRIVATE_CANDIDATE",
          studentVisible: false,
          createdAt: CANONICAL_AT,
          linkDrafts: selected.linkToSlugs.map((targetSlug) => ({
            toCaseId: `inspiration-case:${targetSlug}`,
            relationType: "CONTRASTS_WITH" as const,
            evidenceObjectIds: [`analysis:${selected.slug}`],
            reason: `Synthetic contrast from ${selected.slug} to ${targetSlug}.`,
          })),
        },
      },
      {
        kind: "ANALYSIS_REVISION",
        objectId: `analysis:${selected.slug}`,
        revisionId: `analysis-revision:${selected.slug}-v1`,
        payload: {
          knowledgeDomain: "NON_COURSE_INSPIRATION",
          authorship: "MODEL_DRAFT",
          createdAt: CANONICAL_AT,
          claims: [{
            claimId,
            claimType: "VISIBLE_OBSERVATION",
            text: selected.claimText,
            supportObjectIds: [`source:${selected.slug}`, `analysis:${selected.slug}`],
          }],
        },
      },
      {
        kind: "RIGHTS_DECISION_SET",
        objectId: `rights:${selected.slug}`,
        revisionId: `rights-revision:${selected.slug}-v1`,
        payload: rightsPayload,
      },
      {
        kind: "REVIEW_PACKAGE_REVISION",
        objectId: `review-package:${selected.slug}`,
        revisionId: `review-package-revision:${selected.slug}-v1`,
        payload: {
          state: "READY_FOR_DOMAIN_REVIEW",
          opaqueAssetRef: `asset-ref:${selected.slug}`,
          preparedAt: CANONICAL_AT,
        },
      },
      {
        kind: "WITHDRAWAL_SNAPSHOT",
        objectId: `withdrawal:${selected.slug}`,
        revisionId: `withdrawal-revision:${selected.slug}-v1`,
        payload: withdrawalPayload,
      },
    ],
    ledger: {
      highWatermark: `wiki-ledger-event:${selected.slug}-baseline`,
      ledgerHash: hashWikiValue({ events: [`wiki-ledger-event:${selected.slug}-baseline`] }),
    },
    courseConceptRefs: [{
      authority: "COURSE_KNOWLEDGE_V2",
      conceptId: "course-concept:digital-interaction-layout-hierarchy",
      displayLabel: "信息层级",
      referenceMode: "REFERENCE_ONLY",
    }],
  };
}

export function syntheticCanonicalInputBundle(options: SyntheticMaterialOptions = {}): CanonicalInputBundle {
  return createCanonicalInputBundle(syntheticCanonicalInputSeed(options));
}

export function syntheticWikiDraftSeed(): WikiDraftSeed {
  return { occurredAt: COMPILE_AT, recordedAt: COMPILE_AT };
}

export function syntheticDraftCompilation(options: SyntheticMaterialOptions = {}) {
  const bundle = syntheticCanonicalInputBundle(options);
  const compilation = compileWikiPageDraft(bundle, syntheticWikiDraftSeed());
  const draftMaterial = { canonicalInputBundle: bundle, compilation } as const;
  return { bundle, compilation, draftMaterial };
}

export function syntheticRoleDomainPolicy(): RoleDomainPolicy {
  const material = {
    schemaVersion: "lumi-inspiration-role-domain-policy/v1" as const,
    version: "role-policy:synthetic-v1",
    allowSelfReview: false,
    riskRules: [{
      targetRisk: "STANDARD" as const,
      dualReviewRequired: true,
      requirements: [
        { domain: "CURATION" as const, requiredReviewerCount: 1 },
        { domain: "TEACHING" as const, requiredReviewerCount: 1 },
        { domain: "RIGHTS" as const, requiredReviewerCount: 2 },
        { domain: "SAFETY" as const, requiredReviewerCount: 1 },
      ],
    }],
  };
  return { ...material, policyRevision: bindWikiRevision("role-policy-revision:synthetic-v1", material) };
}

export function syntheticAudiencePolicy(): WikiAudiencePolicy {
  const material = {
    schemaVersion: "lumi-inspiration-wiki-audience-policy/v1" as const,
    policyId: "audience-policy:student-current-v1",
    audience: "AUTHENTICATED_STUDENT_ONLY" as const,
    studentVisible: true as const,
    studentDisplayDecision: "ALLOW" as const,
    sourceDisclosureDecision: "ALLOW" as const,
    previewDecision: "ALLOW" as const,
    aiCitationDecision: "ALLOW" as const,
  };
  return { ...material, policyRevision: bindWikiRevision("audience-policy-revision:student-current-v1", material) };
}

export function syntheticReviewTargetRiskScope(
  pageId: string,
  pageRevision: RevisionBinding,
): ReviewTargetRiskScope {
  const material = {
    schemaVersion: "lumi-inspiration-review-target-risk-scope/v1" as const,
    scopeId: "review-risk-scope:synthetic-standard",
    targetRisk: "STANDARD" as const,
    dualReviewRequired: true,
    appliesToPageId: pageId,
    appliesToPageRevision: pageRevision,
  };
  return {
    ...material,
    scopeRevision: bindWikiRevision(`review-risk-scope-revision:${pageId.slice(-12)}`, material),
  };
}

export function syntheticReviewerAssignment(
  actor: string,
  role: ReviewerRoleAssignment["role"],
  suffix: string,
  policy: RoleDomainPolicy,
): ReviewerRoleAssignment {
  return {
    assignmentId: `role-assignment:${suffix}`,
    actorId: `actor:${actor}`,
    role,
    status: "ACTIVE",
    policyVersion: policy.version,
    policyRevision: policy.policyRevision,
    validFrom: "2026-08-01T00:00:00.000Z",
    validUntil: null,
  };
}

export function syntheticRoleDomainReview(
  domain: RoleDomainReview["reviewDomain"],
  actor: string,
  suffix: string,
  target: RoleDomainReview["target"],
  policy: RoleDomainPolicy,
  requiredReviewerCount = 1,
  coReviewerDecisionIds: string[] = [],
): RoleDomainReview {
  const material = {
    schemaVersion: "lumi-inspiration-role-domain-review/v1" as const,
    decisionId: `domain-review:${suffix}`,
    reviewDomain: domain,
    decision: "APPROVE" as const,
    actorId: `actor:${actor}`,
    actorRoleAssignmentId: `role-assignment:${suffix}`,
    rolePolicyVersion: policy.version,
    rolePolicyRevision: policy.policyRevision,
    reviewerStatusAtDecision: "ACTIVE" as const,
    status: "ACTIVE" as const,
    validUntil: null,
    target,
    requiredReviewerCount,
    coReviewerDecisionIds,
    decidedAt: REVIEW_AT,
    supersedesDecisionId: null,
  };
  return { ...material, decisionRevision: bindWikiRevision(`domain-review-revision:${suffix}`, material) };
}

function buildGovernanceFixture(options: SyntheticMaterialOptions = {}) {
  const draft = syntheticDraftCompilation(options);
  const { bundle, compilation, draftMaterial } = draft;
  const policy = syntheticRoleDomainPolicy();
  const audiencePolicy = syntheticAudiencePolicy();
  const riskScope = syntheticReviewTargetRiskScope(compilation.pageDraft.pageId, compilation.pageRevision.revision);
  const target = deriveDomainReviewTarget(draftMaterial, riskScope);
  const assignments = [
    syntheticReviewerAssignment("curator", "CURATION_REVIEWER", "curation", policy),
    syntheticReviewerAssignment("teacher", "TEACHING_REVIEWER", "teaching", policy),
    syntheticReviewerAssignment("rights-a", "RIGHTS_REVIEWER", "rights-a", policy),
    syntheticReviewerAssignment("rights-b", "RIGHTS_REVIEWER", "rights-b", policy),
    syntheticReviewerAssignment("safety", "SAFETY_REVIEWER", "safety", policy),
    syntheticReviewerAssignment("release", "RELEASE_APPROVER", "release", policy),
  ];
  const reviews = [
    syntheticRoleDomainReview("CURATION", "curator", "curation", target, policy),
    syntheticRoleDomainReview("TEACHING", "teacher", "teaching", target, policy),
    syntheticRoleDomainReview("RIGHTS", "rights-a", "rights-a", target, policy, 2, ["domain-review:rights-b"]),
    syntheticRoleDomainReview("RIGHTS", "rights-b", "rights-b", target, policy, 2, ["domain-review:rights-a"]),
    syntheticRoleDomainReview("SAFETY", "safety", "safety", target, policy),
  ];
  const reviewDecisionIds = reviews.map((review) => review.decisionId).sort();
  const truthMaterial = {
    schemaVersion: "lumi-inspiration-compiled-truth/v1" as const,
    state: "CURRENT_COMPILED_TRUTH" as const,
    pageId: compilation.pageDraft.pageId,
    pageType: compilation.pageDraft.pageType,
    pageRevision: compilation.pageRevision.revision,
    canonicalInputBundle: bundle.bundle,
    compiledAt: TRUTH_AT,
    title: compilation.pageDraft.title,
    aliases: compilation.pageDraft.aliases,
    facets: compilation.pageDraft.facets,
    claims: compilation.pageDraft.claimDrafts.map((claim) => ({
      claimId: claim.claimId,
      claimType: claim.claimType,
      text: claim.text,
      supportObjectIds: claim.supportObjectIds,
      provenance: claim.provenance,
      authorship: "HUMAN_REVIEWED" as const,
      reviewDecisionIds,
    })),
    courseConceptRefs: bundle.courseConceptRefs,
  };
  const truth = CompiledTruthSchema.parse({ ...truthMaterial, contentHash: hashWikiValue(truthMaterial) });
  const sourceMaterial: WikiMaterialSource = { canonicalInputBundle: bundle, compilation, compiledTruth: truth };
  const verified = deriveVerifiedWikiMaterial(sourceMaterial);
  const reviewGate = {
    evaluatedAt: ACTIVATION_AT,
    policy,
    assignments,
    reviews,
    draftMaterial,
    currentTarget: target,
    proposerOrEditorActorIds: ["actor:editor"],
  } as const;
  const reviewTargetHash = hashWikiValue(target);
  const domainReviewDecisionSetHash = hashWikiValue(reviews
    .map((review) => ({ decisionId: review.decisionId, decisionRevision: review.decisionRevision }))
    .sort((left, right) => left.decisionId.localeCompare(right.decisionId)));
  const channelStates = {
    BROWSE_RELEASE: "ACTIVE",
    STUDENT_SEARCH: "ACTIVE",
    WIKI_RETRIEVAL: "ACTIVE",
  } as const;
  const currentMaterial = {
    pageId: verified.pageId,
    candidateRevision: verified.candidateRevision,
    pageDraftRevision: verified.pageDraftRevision,
    pageRevision: verified.pageRevision,
    canonicalInputBundle: verified.canonicalInputBundle,
    compilationReceipt: verified.compilationReceipt,
    sourceMaterialReceipt: verified.materialReceipt,
    reviewTargetHash,
    rolePolicyRevision: policy.policyRevision,
    domainReviewDecisionSetHash,
    compiledTruthHash: verified.compiledTruthHash,
    timelineSetHash: verified.timelineSetHash,
    wikiLinkDecisionSetHash: verified.linkSetHash,
    ledger: verified.ledger,
    rightsDecisionSetRevision: verified.rightsDecisionSetRevision,
    rightsDecisionSetHash: verified.rightsDecisionSetRevision.revisionHash,
    withdrawalSnapshotRevision: verified.withdrawalSnapshotRevision,
    withdrawalSnapshotHash: verified.withdrawalSnapshotRevision.revisionHash,
    audiencePolicyRevision: audiencePolicy.policyRevision,
    audiencePolicyHash: audiencePolicy.policyRevision.revisionHash,
    channelStates,
    releaseState: "RELEASED" as const,
    isCurrent: true,
  };
  const release = bindWikiRevision(`wiki-release:${hashWikiValue(currentMaterial).slice(7, 31)}`, currentMaterial);
  const current = { ...currentMaterial, release };
  const qualification = {
    audience: "AUTHENTICATED_STUDENT_ONLY" as const,
    studentVisible: true as const,
    studentDisplayDecision: "ALLOW" as const,
    sourceDisclosureDecision: "ALLOW" as const,
    teachingDecision: "ALLOW" as const,
    rightsDecision: "ALLOW" as const,
    safetyDecision: "ALLOW" as const,
    qualityDecision: "ALLOW" as const,
    withdrawalReadiness: "READY" as const,
  };
  const decision = rebindSyntheticReleaseDecision({
    schemaVersion: "lumi-inspiration-release-decision/v1",
    decisionId: "release-decision:synthetic-v1",
    decision: "ALLOW",
    actorId: "actor:release",
    actorRoleAssignmentId: "role-assignment:release",
    rolePolicyVersion: policy.version,
    rolePolicyRevision: policy.policyRevision,
    reviewerStatusAtDecision: "ACTIVE",
    pageId: current.pageId,
    candidateRevision: current.candidateRevision,
    pageDraftRevision: current.pageDraftRevision,
    pageRevision: current.pageRevision,
    canonicalInputBundle: current.canonicalInputBundle,
    compilationReceipt: current.compilationReceipt,
    sourceMaterialReceipt: current.sourceMaterialReceipt,
    reviewTargetHash: current.reviewTargetHash,
    domainReviewDecisionSetHash: current.domainReviewDecisionSetHash,
    release: current.release,
    compiledTruthHash: current.compiledTruthHash,
    timelineSetHash: current.timelineSetHash,
    wikiLinkDecisionSetHash: current.wikiLinkDecisionSetHash,
    ledger: current.ledger,
    rightsDecisionSetRevision: current.rightsDecisionSetRevision,
    rightsDecisionSetHash: current.rightsDecisionSetHash,
    withdrawalSnapshotRevision: current.withdrawalSnapshotRevision,
    withdrawalSnapshotHash: current.withdrawalSnapshotHash,
    audiencePolicyRevision: current.audiencePolicyRevision,
    audiencePolicyHash: current.audiencePolicyHash,
    channelStates: current.channelStates,
    qualification,
    domainReviewDecisionIds: reviewDecisionIds,
    decidedAt: RELEASE_AT,
    supersedesDecisionId: null,
  });
  const releaseGate: ReleaseDecisionEvaluationInput = {
    reviewGate,
    sourceMaterial,
    audiencePolicy,
    decision,
    releaseDecisionHistory: [decision],
    current,
    activationReceipt: syntheticActivationReceipt(decision, current),
    releaseAuthorActorIds: ["actor:editor"],
  };
  const eligibility: StudentCurrentReleaseEligibilityInput = {
    accessKind: "BROWSE",
    viewer: {
      actorId: "actor:student",
      actorType: "STUDENT",
      authenticated: true,
      authorizedForCurrentStudent: true,
      audience: "AUTHENTICATED_STUDENT_ONLY",
    },
    page: {
      projectionSource: "CURRENT_PAGE_RELEASE_COMPILED_TRUTH",
      publicId: `inspiration:${hashWikiValue({ pageId: truth.pageId }).slice(7, 31)}`,
      pageId: truth.pageId,
      pageRevision: truth.pageRevision,
      release,
      compiledTruthHash: truth.contentHash,
      reviewState: "APPROVED_STUDENT",
      audience: "AUTHENTICATED_STUDENT_ONLY",
      withdrawalState: "CLEAR",
      studentDisplayDecision: "ALLOW",
      sourceDisclosureDecision: "ALLOW",
      previewDecision: "ALLOW",
      aiCitationDecision: "ALLOW",
      evidenceAnchorResolvable: true,
    },
    releaseGate,
  };
  return {
    bundle,
    compilation,
    draftMaterial,
    truth,
    sourceMaterial,
    verified,
    policy,
    audiencePolicy,
    target,
    releaseGate,
    eligibility,
  };
}

export function syntheticGovernanceFixture(options: SyntheticMaterialOptions = {}) {
  return buildGovernanceFixture(options);
}

export function syntheticWikiMaterial(options: SyntheticMaterialOptions = {}) {
  return buildGovernanceFixture(options);
}

export function syntheticTrustedP1CurrentAllowlistFixture(
  index: P1SeedIndex,
  options: {
    readonly pageIds?: readonly string[];
    readonly asOf?: string;
    readonly validUntil?: string;
  } = {},
): P1CurrentAllowlistSnapshot {
  const asOf = options.asOf ?? index.buildReceipt.createdAt;
  const validUntil = options.validUntil
    ?? new Date(Date.parse(asOf) + 60 * 60 * 1_000).toISOString();
  const selectedPageIds = new Set(options.pageIds ?? index.pages
    .filter((page) => page.visibility === "ELIGIBLE")
    .map((page) => page.pageId));
  const entries = index.pages.filter((page) => selectedPageIds.has(page.pageId)).map((page) => ({
    pageId: page.pageId,
    pageRevision: page.revision,
    sourceMaterialReceipt: page.sourceMaterialReceipt,
    compiledTruthHash: page.compiledTruthHash,
    rightsDecisionSetRevision: page.rightsDecisionSetRevision,
    withdrawalSnapshotRevision: page.withdrawalSnapshotRevision,
    acceptedReviewDecisionSetHash: page.acceptedReviewDecisionSetHash,
    indexAuthorizationCheckedAt: page.authorizationCheckedAt,
  })).sort((left, right) => left.pageId.localeCompare(right.pageId));
  const authorityMaterial = {
    source: "UPSTREAM_TRUSTED_CURRENT_ALLOWLIST" as const,
    trustBoundary: "D18_PERSISTED_CURRENTNESS_NOT_IMPLEMENTED_IN_S1" as const,
    indexRevision: index.indexRevision,
    asOf,
    validUntil,
    entries,
  };
  const authority = {
    source: authorityMaterial.source,
    trustBoundary: authorityMaterial.trustBoundary,
    receipt: bindWikiRevision(
      `wiki-current-allowlist-authority:${hashWikiValue(authorityMaterial).slice(7, 31)}`,
      authorityMaterial,
    ),
  };
  const snapshotMaterial = {
    schemaVersion: "lumi-inspiration-p1-current-allowlist-snapshot/v1" as const,
    scope: "DRAFT_SHADOW" as const,
    authority,
    indexRevision: index.indexRevision,
    asOf,
    validUntil,
    entries,
  };
  return P1CurrentAllowlistSnapshotSchema.parse({
    ...snapshotMaterial,
    snapshotRevision: bindWikiRevision(
      `wiki-current-allowlist-snapshot:${hashWikiValue(snapshotMaterial).slice(7, 31)}`,
      snapshotMaterial,
    ),
  });
}

type SyntheticLinkedMaterial = ReturnType<typeof syntheticGovernanceFixture>;

export function syntheticReviewedLink(
  from: SyntheticLinkedMaterial,
  to: SyntheticLinkedMaterial,
) {
  if (from.verified.pageId === to.verified.pageId) {
    throw new Error("Wiki links cannot be self-referential");
  }
  const draft = from.compilation.linkDecisionDrafts.find((candidate) => (
    candidate.toPageId === to.verified.pageId
  ));
  if (!draft) throw new Error("Synthetic reviewed link requires an exact canonical endpoint draft");
  const approvalReviewDecisionIds = from.releaseGate.reviewGate.reviews
    .filter((review) => review.reviewDomain === "CURATION" && review.decision === "APPROVE")
    .map((review) => review.decisionId)
    .sort();
  const decisionMaterial = {
    linkId: draft.linkId,
    fromPageId: from.verified.pageId,
    fromPageRevision: from.verified.pageRevision,
    toPageId: to.verified.pageId,
    toPageRevision: to.verified.pageRevision,
    sourcePageId: from.verified.pageId,
    sourcePageRevision: from.verified.pageRevision,
    sourceCanonicalInputBundle: from.verified.canonicalInputBundle,
    sourceDraftMaterialReceipt: from.target.draftMaterialReceipt,
    linkDraftRevision: draft.revision,
    relationType: draft.relationType,
    evidenceRefs: draft.evidenceRefs,
  };
  const decision = bindWikiRevision(
    `wiki-link-decision:${hashWikiValue(decisionMaterial).slice(7, 31)}`,
    decisionMaterial,
  );
  const approvalMaterial = {
    schemaVersion: "lumi-inspiration-reviewed-wiki-link/v1" as const,
    ...decisionMaterial,
    decision,
    approvalReviewDecisionIds,
    reviewState: "APPROVED" as const,
    audience: "INTERNAL_REVIEWER_ONLY" as const,
    validFrom: TRUTH_AT,
    validUntil: null,
  };
  const approvalReceipt = bindWikiRevision(
    `wiki-link-approval-receipt:${hashWikiValue(approvalMaterial).slice(7, 31)}`,
    approvalMaterial,
  );
  const revisionMaterial = { ...approvalMaterial, approvalReceipt };
  return ReviewedWikiLinkSchema.parse({
    ...revisionMaterial,
    revision: bindWikiRevision(
      `wiki-link-reviewed-revision:${hashWikiValue(revisionMaterial).slice(7, 31)}`,
      revisionMaterial,
    ),
  });
}
