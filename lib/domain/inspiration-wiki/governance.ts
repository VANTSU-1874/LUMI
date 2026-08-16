import {
  CompiledTruthReviewBindingEvaluationSchema,
  CompiledTruthReviewBindingInputSchema,
  DomainReviewTargetSchema,
  FailClosedEvaluationSchema,
  ReleaseDecisionEvaluationInputSchema,
  ReviewDomainSchema,
  ReviewTargetRiskScopeSchema,
  RoleDomainReviewEvaluationInputSchema,
  StudentCurrentReleaseEligibilityInputSchema,
  type FailClosedEvaluation,
  type CompiledTruthReviewBindingEvaluation,
  type ReviewDomain,
  type ReviewerRoleAssignment,
  type ReviewTargetRiskScope,
} from "./governance-contracts";
import {
  WikiContractIntegrityError,
  deepFreezeWikiValue,
  deriveCanonicalReleaseSemantics,
  deriveVerifiedWikiDraftMaterial,
  deriveVerifiedWikiMaterial,
  hashWikiValue,
  stableWikiJson,
  wikiRevisionMatches,
} from "./integrity";

const DOMAIN_ROLE: Record<ReviewDomain, ReviewerRoleAssignment["role"]> = {
  CURATION: "CURATION_REVIEWER",
  TEACHING: "TEACHING_REVIEWER",
  RIGHTS: "RIGHTS_REVIEWER",
  SAFETY: "SAFETY_REVIEWER",
};

function evaluation(
  eligible: boolean,
  reasons: readonly string[],
  acceptedDecisionIds: readonly string[] = [],
): FailClosedEvaluation {
  return deepFreezeWikiValue(FailClosedEvaluationSchema.parse({
    eligible,
    reasons: [...new Set(reasons)].sort((left, right) => left.localeCompare(right)),
    acceptedDecisionIds: eligible
      ? [...new Set(acceptedDecisionIds)].sort((left, right) => left.localeCompare(right))
      : [],
  }));
}

function activeAssignmentAt(
  assignment: ReviewerRoleAssignment,
  evaluatedAt: string,
  policyVersion: string,
  policyRevision: ReviewerRoleAssignment["policyRevision"],
) {
  const evaluated = Date.parse(evaluatedAt);
  const validFrom = Date.parse(assignment.validFrom);
  const validUntil = assignment.validUntil ? Date.parse(assignment.validUntil) : Number.POSITIVE_INFINITY;
  return assignment.status === "ACTIVE"
    && assignment.policyVersion === policyVersion
    && stableWikiJson(assignment.policyRevision) === stableWikiJson(policyRevision)
    && evaluated >= validFrom
    && evaluated <= validUntil;
}

export function reviewerAssignmentSupportsDomain(
  assignment: ReviewerRoleAssignment,
  domain: ReviewDomain,
  evaluatedAt: string,
  policyVersion: string,
  policyRevision: ReviewerRoleAssignment["policyRevision"],
) {
  return activeAssignmentAt(assignment, evaluatedAt, policyVersion, policyRevision)
    && assignment.role === DOMAIN_ROLE[domain];
}

function withoutKey(value: Readonly<Record<string, unknown>>, key: string) {
  return Object.fromEntries(Object.entries(value).filter(([candidate]) => candidate !== key));
}

function hasSupersessionCycle(
  decisions: ReadonlyMap<string, { readonly supersedesDecisionId: string | null }>,
) {
  for (const decisionId of decisions.keys()) {
    const visited = new Set<string>();
    let cursor: string | null = decisionId;
    while (cursor) {
      if (visited.has(cursor)) return true;
      visited.add(cursor);
      cursor = decisions.get(cursor)?.supersedesDecisionId ?? null;
    }
  }
  return false;
}

export function deriveDomainReviewTarget(rawDraftMaterial: unknown, rawRiskScope: unknown) {
  const material = deriveVerifiedWikiDraftMaterial(rawDraftMaterial);
  const riskScope = ReviewTargetRiskScopeSchema.parse(rawRiskScope) as ReviewTargetRiskScope;
  return deepFreezeWikiValue(DomainReviewTargetSchema.parse({
    pageId: material.pageId,
    candidateRevision: material.candidateRevision,
    canonicalInputBundle: material.canonicalInputBundle,
    pageDraftRevision: material.pageDraftRevision,
    pageRevision: material.pageRevision,
    compilationReceipt: material.compilationReceipt,
    draftMaterialReceipt: material.draftMaterialReceipt,
    compiledPreviewHash: material.compiledPreviewHash,
    timelineSetHash: material.timelineSetHash,
    wikiLinkDecisionSetHash: material.linkSetHash,
    ledger: material.ledger,
    rightsDecisionSetRevision: material.rightsDecisionSetRevision,
    withdrawalSnapshotRevision: material.withdrawalSnapshotRevision,
    riskScope,
  }));
}

function draftReadyAt(input: ReturnType<typeof RoleDomainReviewEvaluationInputSchema.parse>) {
  const compilation = input.draftMaterial.compilation;
  return Math.max(
    Date.parse(compilation.pageDraft.createdAt),
    Date.parse(compilation.pageRevision.createdAt),
    Date.parse(compilation.receipt.createdAt),
    ...compilation.timelineEntries.map((entry) => Date.parse(entry.recordedAt)),
  );
}

export function evaluateRoleDomainReviews(rawInput: unknown): FailClosedEvaluation {
  const parsed = RoleDomainReviewEvaluationInputSchema.safeParse(rawInput);
  if (!parsed.success) return evaluation(false, ["INVALID_ROLE_DOMAIN_REVIEW_INPUT"]);
  const input = parsed.data;
  const reasons: string[] = [];
  let expectedTarget: ReturnType<typeof deriveDomainReviewTarget>;
  try {
    expectedTarget = deriveDomainReviewTarget(input.draftMaterial, input.currentTarget.riskScope);
  } catch (error) {
    const reason = error instanceof WikiContractIntegrityError ? error.code : "UNPARSEABLE_DRAFT_MATERIAL";
    return evaluation(false, [`INVALID_VERIFIED_DRAFT_MATERIAL:${reason}`]);
  }
  if (stableWikiJson(input.currentTarget) !== stableWikiJson(expectedTarget)) {
    reasons.push("CURRENT_REVIEW_TARGET_NOT_DERIVED_FROM_DRAFT_MATERIAL");
  }
  try {
    const semantics = deriveCanonicalReleaseSemantics(input.draftMaterial.canonicalInputBundle, input.evaluatedAt);
    if (!semantics.eligible) reasons.push("CANONICAL_RELEASE_SEMANTICS_BLOCK_REVIEW", ...semantics.reasons);
  } catch (error) {
    const reason = error instanceof WikiContractIntegrityError ? error.code : "UNPARSEABLE_CANONICAL_SEMANTICS";
    reasons.push(`INVALID_CANONICAL_RELEASE_SEMANTICS:${reason}`);
  }
  if (!wikiRevisionMatches(input.policy.policyRevision, withoutKey(input.policy, "policyRevision"))) {
    reasons.push("STALE_ROLE_POLICY_DOCUMENT");
  }
  if (!wikiRevisionMatches(
    input.currentTarget.riskScope.scopeRevision,
    withoutKey(input.currentTarget.riskScope, "scopeRevision"),
  )) {
    reasons.push("STALE_TARGET_RISK_SCOPE");
  }
  if (input.currentTarget.riskScope.appliesToPageId !== expectedTarget.pageId
    || stableWikiJson(input.currentTarget.riskScope.appliesToPageRevision)
      !== stableWikiJson(expectedTarget.pageRevision)) {
    reasons.push("TARGET_RISK_SCOPE_PAGE_MISMATCH");
  }
  const riskRule = input.policy.riskRules.find(
    (rule) => rule.targetRisk === input.currentTarget.riskScope.targetRisk,
  );
  if (!riskRule) reasons.push("TARGET_RISK_POLICY_RULE_MISSING");
  if (riskRule && riskRule.dualReviewRequired !== input.currentTarget.riskScope.dualReviewRequired) {
    reasons.push("TARGET_RISK_DUAL_REVIEW_MISMATCH");
  }
  const assignments = new Map(input.assignments.map((assignment) => [assignment.assignmentId, assignment]));
  if (assignments.size !== input.assignments.length) reasons.push("DUPLICATE_ROLE_ASSIGNMENT_ID");
  const decisions = new Map(input.reviews.map((review) => [review.decisionId, review]));
  if (decisions.size !== input.reviews.length) reasons.push("DUPLICATE_REVIEW_DECISION_ID");
  for (const review of input.reviews) {
    if (!wikiRevisionMatches(review.decisionRevision, withoutKey(review, "decisionRevision"))) {
      reasons.push(`${review.reviewDomain}_STALE_REVIEW_DECISION_HASH`);
    }
  }

  const supersededDecisionIds = new Set<string>();
  const supersededByCounts = new Map<string, number>();
  for (const review of input.reviews) {
    if (!review.supersedesDecisionId) continue;
    const prior = decisions.get(review.supersedesDecisionId);
    if (!prior) {
      reasons.push("REVIEW_SUPERSEDES_UNKNOWN_DECISION");
      continue;
    }
    if (prior.decisionId === review.decisionId
      || prior.reviewDomain !== review.reviewDomain
      || stableWikiJson(prior.target) !== stableWikiJson(review.target)) {
      reasons.push("REVIEW_SUPERSESSION_TARGET_OR_DOMAIN_MISMATCH");
      continue;
    }
    if (Date.parse(review.decidedAt) <= Date.parse(prior.decidedAt)) {
      reasons.push("REVIEW_SUPERSESSION_TIME_INVALID");
    }
    supersededDecisionIds.add(prior.decisionId);
    supersededByCounts.set(prior.decisionId, (supersededByCounts.get(prior.decisionId) ?? 0) + 1);
  }
  if ([...supersededByCounts.values()].some((count) => count > 1)) reasons.push("REVIEW_SUPERSESSION_FORK");
  if (hasSupersessionCycle(decisions)) reasons.push("REVIEW_SUPERSESSION_CYCLE");
  const currentReviewHeads = input.reviews.filter((review) => !supersededDecisionIds.has(review.decisionId));
  const activeReviews = currentReviewHeads.filter((review) => review.status === "ACTIVE"
    && (!review.validUntil || Date.parse(input.evaluatedAt) <= Date.parse(review.validUntil)));
  for (const review of currentReviewHeads) {
    if (!activeReviews.includes(review)) reasons.push(`${review.reviewDomain}_REVIEW_DECISION_NOT_CURRENT`);
  }
  const activeDecisions = new Map(activeReviews.map((review) => [review.decisionId, review]));
  const targetJson = stableWikiJson(input.currentTarget);
  const readyAt = draftReadyAt(input);

  for (const review of activeReviews) {
    const requirement = riskRule?.requirements.find((candidate) => candidate.domain === review.reviewDomain);
    const assignment = assignments.get(review.actorRoleAssignmentId);
    if (review.decision !== "APPROVE") reasons.push(`${review.reviewDomain}_NOT_APPROVED`);
    if (review.rolePolicyVersion !== input.policy.version) reasons.push(`${review.reviewDomain}_STALE_POLICY_VERSION`);
    if (stableWikiJson(review.rolePolicyRevision) !== stableWikiJson(input.policy.policyRevision)) {
      reasons.push(`${review.reviewDomain}_STALE_POLICY_DOCUMENT`);
    }
    if (stableWikiJson(review.target) !== targetJson) reasons.push(`${review.reviewDomain}_STALE_TARGET_HASH`);
    if (!requirement || review.requiredReviewerCount !== requirement.requiredReviewerCount) {
      reasons.push(`${review.reviewDomain}_REVIEWER_COUNT_POLICY_MISMATCH`);
    }
    if (!assignment) {
      reasons.push(`${review.reviewDomain}_ROLE_ASSIGNMENT_MISSING`);
      continue;
    }
    if (assignment.actorId !== review.actorId) reasons.push(`${review.reviewDomain}_ROLE_ACTOR_MISMATCH`);
    if (!activeAssignmentAt(assignment, review.decidedAt, input.policy.version, input.policy.policyRevision)) {
      reasons.push(`${review.reviewDomain}_ROLE_NOT_ELIGIBLE_AT_DECISION`);
    }
    if (!reviewerAssignmentSupportsDomain(
      assignment,
      review.reviewDomain,
      input.evaluatedAt,
      input.policy.version,
      input.policy.policyRevision,
    )) {
      reasons.push(`${review.reviewDomain}_ROLE_NOT_CURRENTLY_ELIGIBLE`);
    }
    if (Date.parse(review.decidedAt) < readyAt) {
      reasons.push(`${review.reviewDomain}_DECISION_BEFORE_DRAFT_MATERIAL_READY`);
    }
    if (Date.parse(review.decidedAt) > Date.parse(input.evaluatedAt)) {
      reasons.push(`${review.reviewDomain}_DECISION_AFTER_EVALUATION`);
    }
    if (!input.policy.allowSelfReview && input.proposerOrEditorActorIds.includes(review.actorId)) {
      reasons.push(`${review.reviewDomain}_SELF_REVIEW_FORBIDDEN`);
    }
  }

  for (const domain of ReviewDomainSchema.options) {
    const requirement = riskRule?.requirements.find((candidate) => candidate.domain === domain);
    const domainReviews = activeReviews.filter((review) => review.reviewDomain === domain && review.decision === "APPROVE");
    if (!requirement || domainReviews.length < (requirement?.requiredReviewerCount ?? 1)) {
      reasons.push(`${domain}_SECOND_REVIEW_MISSING`);
      continue;
    }
    const actors = new Set(domainReviews.map((review) => review.actorId));
    if (actors.size < requirement.requiredReviewerCount) reasons.push(`${domain}_REVIEWERS_NOT_UNIQUE`);
    for (const review of domainReviews) {
      const coReviews = review.coReviewerDecisionIds.map((decisionId) => activeDecisions.get(decisionId));
      if (review.coReviewerDecisionIds.length !== requirement.requiredReviewerCount - 1) {
        reasons.push(`${domain}_CO_REVIEW_LINK_MISSING`);
      }
      if (coReviews.some((coReview) => !coReview
        || coReview.decision !== "APPROVE"
        || coReview.reviewDomain !== domain
        || coReview.actorId === review.actorId)) {
        reasons.push(`${domain}_INVALID_CO_REVIEW_LINK`);
      }
      if (new Set(review.coReviewerDecisionIds).size !== review.coReviewerDecisionIds.length) {
        reasons.push(`${domain}_DUPLICATE_CO_REVIEW_LINK`);
      }
    }
  }

  return evaluation(reasons.length === 0, reasons, activeReviews
    .filter((review) => review.decision === "APPROVE")
    .map((review) => review.decisionId));
}

export function evaluateCompiledTruthReviewBinding(
  rawInput: unknown,
): CompiledTruthReviewBindingEvaluation {
  const parsed = CompiledTruthReviewBindingInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return deepFreezeWikiValue(CompiledTruthReviewBindingEvaluationSchema.parse({
      eligible: false,
      reasons: ["INVALID_COMPILED_TRUTH_REVIEW_BINDING_INPUT"],
      acceptedDecisionIds: [],
      acceptedDecisionSetHash: null,
      latestAcceptedReviewDecidedAt: null,
    }));
  }
  const input = parsed.data;
  const reasons: string[] = [];
  const reviewEvaluation = evaluateRoleDomainReviews(input.reviewGate);
  if (!reviewEvaluation.eligible) {
    reasons.push("DOMAIN_REVIEW_GATE_FAILED", ...reviewEvaluation.reasons);
  }
  const acceptedDecisionIds = [...reviewEvaluation.acceptedDecisionIds].sort((left, right) => (
    left.localeCompare(right)
  ));
  const reviewById = new Map(input.reviewGate.reviews.map((review) => [review.decisionId, review]));
  const acceptedReviews = acceptedDecisionIds.map((decisionId) => reviewById.get(decisionId));
  if (acceptedDecisionIds.length === 0) reasons.push("ACCEPTED_REVIEW_SET_EMPTY");
  if (acceptedReviews.some((review) => !review)) reasons.push("ACCEPTED_REVIEW_DECISION_MISSING");
  const acceptedBindings = acceptedReviews.filter(Boolean).map((review) => ({
    decisionId: review!.decisionId,
    decisionRevision: review!.decisionRevision,
  })).sort((left, right) => left.decisionId.localeCompare(right.decisionId));
  const acceptedDecisionSetHash = acceptedBindings.length === acceptedDecisionIds.length
    && acceptedBindings.length > 0
    ? hashWikiValue(acceptedBindings)
    : null;
  const acceptedIdJson = stableWikiJson(acceptedDecisionIds);
  if (input.compiledTruth.claims.some((claim) => (
    stableWikiJson([...claim.reviewDecisionIds].sort((left, right) => left.localeCompare(right))) !== acceptedIdJson
  ))) {
    reasons.push("COMPILED_TRUTH_CLAIM_REVIEW_SET_MISMATCH");
  }
  const latestAcceptedReview = acceptedReviews.filter(Boolean)
    .sort((left, right) => Date.parse(right!.decidedAt) - Date.parse(left!.decidedAt))[0];
  const latestAcceptedReviewDecidedAt = latestAcceptedReview?.decidedAt ?? null;
  if (latestAcceptedReviewDecidedAt
    && Date.parse(input.compiledTruth.compiledAt) < Date.parse(latestAcceptedReviewDecidedAt)) {
    reasons.push("COMPILED_TRUTH_BEFORE_ACCEPTED_REVIEWS");
  }
  if (input.notAfter) {
    if (latestAcceptedReviewDecidedAt
      && Date.parse(latestAcceptedReviewDecidedAt) > Date.parse(input.notAfter)) {
      reasons.push("ACCEPTED_REVIEW_AFTER_BOUNDARY");
    }
    if (Date.parse(input.compiledTruth.compiledAt) > Date.parse(input.notAfter)) {
      reasons.push("COMPILED_TRUTH_AFTER_BOUNDARY");
    }
  }
  const uniqueReasons = [...new Set(reasons)].sort((left, right) => left.localeCompare(right));
  return deepFreezeWikiValue(CompiledTruthReviewBindingEvaluationSchema.parse({
    eligible: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    acceptedDecisionIds,
    acceptedDecisionSetHash,
    latestAcceptedReviewDecidedAt,
  }));
}

function releaseBindingProjection(value: ReturnType<typeof ReleaseDecisionEvaluationInputSchema.parse>["decision"]
  | ReturnType<typeof ReleaseDecisionEvaluationInputSchema.parse>["current"]) {
  return {
    pageId: value.pageId,
    candidateRevision: value.candidateRevision,
    pageDraftRevision: value.pageDraftRevision,
    pageRevision: value.pageRevision,
    canonicalInputBundle: value.canonicalInputBundle,
    compilationReceipt: value.compilationReceipt,
    sourceMaterialReceipt: value.sourceMaterialReceipt,
    reviewTargetHash: value.reviewTargetHash,
    domainReviewDecisionSetHash: value.domainReviewDecisionSetHash,
    release: value.release,
    compiledTruthHash: value.compiledTruthHash,
    timelineSetHash: value.timelineSetHash,
    wikiLinkDecisionSetHash: value.wikiLinkDecisionSetHash,
    ledger: value.ledger,
    rightsDecisionSetRevision: value.rightsDecisionSetRevision,
    rightsDecisionSetHash: value.rightsDecisionSetHash,
    withdrawalSnapshotRevision: value.withdrawalSnapshotRevision,
    withdrawalSnapshotHash: value.withdrawalSnapshotHash,
    audiencePolicyRevision: value.audiencePolicyRevision,
    audiencePolicyHash: value.audiencePolicyHash,
    channelStates: value.channelStates,
  };
}

function releaseBindingsMatch(
  decision: ReturnType<typeof ReleaseDecisionEvaluationInputSchema.parse>["decision"],
  current: ReturnType<typeof ReleaseDecisionEvaluationInputSchema.parse>["current"],
) {
  return stableWikiJson(releaseBindingProjection(decision)) === stableWikiJson(releaseBindingProjection(current));
}

function currentReleaseMaterial(current: ReturnType<typeof ReleaseDecisionEvaluationInputSchema.parse>["current"]) {
  return withoutKey(current, "release");
}

function releaseDecisionMaterial(
  decision: ReturnType<typeof ReleaseDecisionEvaluationInputSchema.parse>["decision"],
) {
  return withoutKey(decision, "decisionRevision");
}

function activationReceiptsMatch(input: ReturnType<typeof ReleaseDecisionEvaluationInputSchema.parse>) {
  const activation = input.activationReceipt;
  const activationMaterial = withoutKey(activation, "receipt");
  if (!wikiRevisionMatches(activation.receipt, activationMaterial)
    || stableWikiJson(activation.releaseDecision) !== stableWikiJson(input.decision.decisionRevision)
    || stableWikiJson(activation.release) !== stableWikiJson(input.current.release)
    || stableWikiJson(activation.pageRevision) !== stableWikiJson(input.current.pageRevision)) return false;
  return activation.channelReceipts.every((channelReceipt) => {
    const channelMaterial = withoutKey(channelReceipt, "receipt");
    return wikiRevisionMatches(channelReceipt.receipt, channelMaterial)
      && stableWikiJson(channelReceipt.releaseDecision) === stableWikiJson(activation.releaseDecision)
      && stableWikiJson(channelReceipt.release) === stableWikiJson(input.current.release)
      && stableWikiJson(channelReceipt.pageRevision) === stableWikiJson(input.current.pageRevision)
      && channelReceipt.state === input.current.channelStates[channelReceipt.channel];
  });
}

function validateReleaseDecisionHistory(input: ReturnType<typeof ReleaseDecisionEvaluationInputSchema.parse>) {
  const reasons: string[] = [];
  const history = input.releaseDecisionHistory;
  const byId = new Map(history.map((decision) => [decision.decisionId, decision]));
  if (byId.size !== history.length) reasons.push("DUPLICATE_RELEASE_DECISION_ID");
  for (const decision of history) {
    if (!wikiRevisionMatches(decision.decisionRevision, releaseDecisionMaterial(decision))) {
      reasons.push("STALE_RELEASE_DECISION_REVISION");
    }
  }
  const superseded = new Set<string>();
  const supersededByCounts = new Map<string, number>();
  for (const decision of history) {
    if (!decision.supersedesDecisionId) continue;
    const prior = byId.get(decision.supersedesDecisionId);
    if (!prior) {
      reasons.push("RELEASE_SUPERSEDES_UNKNOWN_DECISION");
      continue;
    }
    if (prior.decisionId === decision.decisionId) reasons.push("RELEASE_SUPERSEDES_SELF");
    if (stableWikiJson(releaseBindingProjection(prior)) !== stableWikiJson(releaseBindingProjection(decision))) {
      reasons.push("RELEASE_SUPERSESSION_CROSS_TARGET");
    }
    if (Date.parse(decision.decidedAt) <= Date.parse(prior.decidedAt)) {
      reasons.push("RELEASE_SUPERSESSION_TIME_INVALID");
    }
    superseded.add(prior.decisionId);
    supersededByCounts.set(prior.decisionId, (supersededByCounts.get(prior.decisionId) ?? 0) + 1);
  }
  if ([...supersededByCounts.values()].some((count) => count > 1)) reasons.push("RELEASE_SUPERSESSION_FORK");
  if (hasSupersessionCycle(byId)) reasons.push("RELEASE_SUPERSESSION_CYCLE");
  const heads = history.filter((decision) => !superseded.has(decision.decisionId));
  if (heads.length !== 1) reasons.push("RELEASE_DECISION_HISTORY_HAS_MULTIPLE_HEADS");
  if (heads[0]?.decisionId !== input.decision.decisionId) reasons.push("RELEASE_DECISION_NOT_CURRENT_HISTORY_HEAD");
  const declared = byId.get(input.decision.decisionId);
  if (!declared || stableWikiJson(declared) !== stableWikiJson(input.decision)) {
    reasons.push("RELEASE_DECISION_NOT_EXACT_HISTORY_MEMBER");
  }
  return reasons;
}

export function evaluateReleaseDecision(rawInput: unknown): FailClosedEvaluation {
  const parsed = ReleaseDecisionEvaluationInputSchema.safeParse(rawInput);
  if (!parsed.success) return evaluation(false, ["INVALID_RELEASE_DECISION_INPUT"]);
  const input = parsed.data;
  const reasons: string[] = [];
  let verifiedMaterial: ReturnType<typeof deriveVerifiedWikiMaterial>;
  try {
    verifiedMaterial = deriveVerifiedWikiMaterial(input.sourceMaterial);
  } catch (error) {
    const reason = error instanceof WikiContractIntegrityError ? error.code : "UNPARSEABLE_SOURCE_MATERIAL";
    return evaluation(false, [`INVALID_VERIFIED_SOURCE_MATERIAL:${reason}`]);
  }
  if (stableWikiJson(input.reviewGate.draftMaterial) !== stableWikiJson({
    canonicalInputBundle: input.sourceMaterial.canonicalInputBundle,
    compilation: input.sourceMaterial.compilation,
  })) {
    reasons.push("RELEASE_REVIEW_DRAFT_MATERIAL_MISMATCH");
  }
  let canonicalSemantics: ReturnType<typeof deriveCanonicalReleaseSemantics>;
  try {
    canonicalSemantics = deriveCanonicalReleaseSemantics(
      input.sourceMaterial.canonicalInputBundle,
      input.reviewGate.evaluatedAt,
    );
    if (!canonicalSemantics.eligible) reasons.push("CANONICAL_RELEASE_SEMANTICS_BLOCK_RELEASE", ...canonicalSemantics.reasons);
  } catch (error) {
    const reason = error instanceof WikiContractIntegrityError ? error.code : "UNPARSEABLE_CANONICAL_SEMANTICS";
    return evaluation(false, [`INVALID_CANONICAL_RELEASE_SEMANTICS:${reason}`]);
  }
  const reviewGate = evaluateRoleDomainReviews(input.reviewGate);
  if (!reviewGate.eligible) reasons.push("DOMAIN_REVIEW_GATE_FAILED", ...reviewGate.reasons);
  const truthReviewBinding = evaluateCompiledTruthReviewBinding({
    compiledTruth: input.sourceMaterial.compiledTruth,
    reviewGate: input.reviewGate,
    notAfter: input.decision.decidedAt,
  });
  if (!truthReviewBinding.eligible) {
    reasons.push(...truthReviewBinding.reasons);
    if (truthReviewBinding.reasons.some((reason) => (
      reason === "COMPILED_TRUTH_BEFORE_ACCEPTED_REVIEWS"
      || reason === "COMPILED_TRUTH_AFTER_BOUNDARY"
    ))) {
      reasons.push("COMPILED_TRUTH_TIME_OUTSIDE_REVIEW_RELEASE_WINDOW");
    }
  }
  if (input.decision.decision !== "ALLOW") reasons.push("RELEASE_DECISION_NOT_ALLOWED");
  reasons.push(...validateReleaseDecisionHistory(input));
  if (input.decision.rolePolicyVersion !== input.reviewGate.policy.version) reasons.push("RELEASE_STALE_POLICY_VERSION");
  if (stableWikiJson(input.decision.rolePolicyRevision) !== stableWikiJson(input.reviewGate.policy.policyRevision)) {
    reasons.push("RELEASE_STALE_POLICY_DOCUMENT");
  }
  if (!wikiRevisionMatches(input.audiencePolicy.policyRevision, withoutKey(input.audiencePolicy, "policyRevision"))) {
    reasons.push("STALE_AUDIENCE_POLICY_DOCUMENT");
  }

  const derivedSourceBindings = {
    pageId: verifiedMaterial.pageId,
    candidateRevision: verifiedMaterial.candidateRevision,
    pageDraftRevision: verifiedMaterial.pageDraftRevision,
    pageRevision: verifiedMaterial.pageRevision,
    canonicalInputBundle: verifiedMaterial.canonicalInputBundle,
    compilationReceipt: verifiedMaterial.compilationReceipt,
    sourceMaterialReceipt: verifiedMaterial.materialReceipt,
    compiledTruthHash: verifiedMaterial.compiledTruthHash,
    timelineSetHash: verifiedMaterial.timelineSetHash,
    wikiLinkDecisionSetHash: verifiedMaterial.linkSetHash,
    ledger: verifiedMaterial.ledger,
    rightsDecisionSetRevision: verifiedMaterial.rightsDecisionSetRevision,
    rightsDecisionSetHash: verifiedMaterial.rightsDecisionSetRevision.revisionHash,
    withdrawalSnapshotRevision: verifiedMaterial.withdrawalSnapshotRevision,
    withdrawalSnapshotHash: verifiedMaterial.withdrawalSnapshotRevision.revisionHash,
    audiencePolicyRevision: input.audiencePolicy.policyRevision,
    audiencePolicyHash: input.audiencePolicy.policyRevision.revisionHash,
  };
  const sourceProjection = (value: typeof input.current | typeof input.decision) => ({
    pageId: value.pageId,
    candidateRevision: value.candidateRevision,
    pageDraftRevision: value.pageDraftRevision,
    pageRevision: value.pageRevision,
    canonicalInputBundle: value.canonicalInputBundle,
    compilationReceipt: value.compilationReceipt,
    sourceMaterialReceipt: value.sourceMaterialReceipt,
    compiledTruthHash: value.compiledTruthHash,
    timelineSetHash: value.timelineSetHash,
    wikiLinkDecisionSetHash: value.wikiLinkDecisionSetHash,
    ledger: value.ledger,
    rightsDecisionSetRevision: value.rightsDecisionSetRevision,
    rightsDecisionSetHash: value.rightsDecisionSetHash,
    withdrawalSnapshotRevision: value.withdrawalSnapshotRevision,
    withdrawalSnapshotHash: value.withdrawalSnapshotHash,
    audiencePolicyRevision: value.audiencePolicyRevision,
    audiencePolicyHash: value.audiencePolicyHash,
  });
  if (stableWikiJson(sourceProjection(input.current)) !== stableWikiJson(derivedSourceBindings)
    || stableWikiJson(sourceProjection(input.decision)) !== stableWikiJson(derivedSourceBindings)) {
    reasons.push("RELEASE_SOURCE_MATERIAL_NOT_DERIVED");
  }
  if (input.decision.qualification.audience !== input.audiencePolicy.audience
    || input.decision.qualification.studentVisible !== input.audiencePolicy.studentVisible
    || input.decision.qualification.studentDisplayDecision !== input.audiencePolicy.studentDisplayDecision
    || input.decision.qualification.sourceDisclosureDecision !== input.audiencePolicy.sourceDisclosureDecision) {
    reasons.push("RELEASE_AUDIENCE_POLICY_MISMATCH");
  }
  const reviewTargetHash = hashWikiValue(input.reviewGate.currentTarget);
  if (input.reviewGate.currentTarget.pageId !== input.decision.pageId
    || input.reviewGate.currentTarget.pageId !== input.current.pageId
    || stableWikiJson(input.reviewGate.currentTarget.pageRevision) !== stableWikiJson(input.decision.pageRevision)
    || stableWikiJson(input.reviewGate.currentTarget.pageRevision) !== stableWikiJson(input.current.pageRevision)
    || stableWikiJson(input.reviewGate.currentTarget.canonicalInputBundle) !== stableWikiJson(input.decision.canonicalInputBundle)
    || stableWikiJson(input.reviewGate.currentTarget.canonicalInputBundle) !== stableWikiJson(input.current.canonicalInputBundle)
    || input.decision.reviewTargetHash !== reviewTargetHash
    || input.current.reviewTargetHash !== reviewTargetHash
    || stableWikiJson(input.current.rolePolicyRevision) !== stableWikiJson(input.reviewGate.policy.policyRevision)) {
    reasons.push("RELEASE_REVIEW_TARGET_MISMATCH");
  }
  if (!releaseBindingsMatch(input.decision, input.current)) reasons.push("RELEASE_BINDING_MISMATCH");
  const reviewById = new Map(input.reviewGate.reviews.map((review) => [review.decisionId, review]));
  const domainReviewDecisionSetHash = truthReviewBinding.acceptedDecisionSetHash;
  if (input.decision.domainReviewDecisionSetHash !== domainReviewDecisionSetHash
    || input.current.domainReviewDecisionSetHash !== domainReviewDecisionSetHash) {
    reasons.push("RELEASE_DOMAIN_REVIEW_SET_HASH_MISMATCH");
  }
  const releaseMaterial = currentReleaseMaterial(input.current);
  const expectedReleaseId = `wiki-release:${hashWikiValue(releaseMaterial).slice(7, 31)}`;
  if (input.current.release.revisionId !== expectedReleaseId
    || !wikiRevisionMatches(input.current.release, releaseMaterial)) {
    reasons.push("STALE_CURRENT_RELEASE_HASH");
  }
  if (!activationReceiptsMatch(input)) reasons.push("RELEASE_OR_CHANNEL_RECEIPT_MISMATCH");
  if (!input.current.isCurrent) reasons.push("RELEASE_NOT_CURRENT");
  if (input.current.releaseState !== "RELEASED") reasons.push("RELEASE_STATE_NOT_ELIGIBLE");

  const assignment = input.reviewGate.assignments.find(
    (candidate) => candidate.assignmentId === input.decision.actorRoleAssignmentId,
  );
  if (!assignment) {
    reasons.push("RELEASE_APPROVER_ASSIGNMENT_MISSING");
  } else {
    if (assignment.actorId !== input.decision.actorId) reasons.push("RELEASE_APPROVER_ACTOR_MISMATCH");
    if (assignment.role !== "RELEASE_APPROVER") reasons.push("RELEASE_APPROVER_ROLE_INVALID");
    if (!activeAssignmentAt(
      assignment,
      input.decision.decidedAt,
      input.reviewGate.policy.version,
      input.reviewGate.policy.policyRevision,
    )) reasons.push("RELEASE_APPROVER_NOT_ELIGIBLE_AT_DECISION");
    if (!activeAssignmentAt(
      assignment,
      input.reviewGate.evaluatedAt,
      input.reviewGate.policy.version,
      input.reviewGate.policy.policyRevision,
    )) reasons.push("RELEASE_APPROVER_NOT_CURRENTLY_ELIGIBLE");
  }
  if (Date.parse(input.decision.decidedAt) > Date.parse(input.reviewGate.evaluatedAt)) {
    reasons.push("RELEASE_DECISION_AFTER_EVALUATION");
  }
  const relevantReviews = reviewGate.acceptedDecisionIds.map((decisionId) => reviewById.get(decisionId));
  if (relevantReviews.some((review) => !review || Date.parse(review.decidedAt) > Date.parse(input.decision.decidedAt))) {
    reasons.push("REVIEW_DECISION_AFTER_RELEASE_DECISION");
  }
  if (Date.parse(input.activationReceipt.activatedAt) < Date.parse(input.decision.decidedAt)
    || Date.parse(input.activationReceipt.activatedAt) > Date.parse(input.reviewGate.evaluatedAt)
    || input.activationReceipt.channelReceipts.some((receipt) => (
      Date.parse(receipt.recordedAt) < Date.parse(input.decision.decidedAt)
      || Date.parse(receipt.recordedAt) > Date.parse(input.activationReceipt.activatedAt)
    ))) {
    reasons.push("RELEASE_OR_CHANNEL_RECEIPT_TIME_INVALID");
  }
  if (input.releaseAuthorActorIds.includes(input.decision.actorId)) reasons.push("RELEASE_SELF_APPROVAL_FORBIDDEN");
  const declaredDomainDecisions = new Set(input.decision.domainReviewDecisionIds);
  if (declaredDomainDecisions.size !== reviewGate.acceptedDecisionIds.length
    || !reviewGate.acceptedDecisionIds.every((decisionId) => declaredDomainDecisions.has(decisionId))) {
    reasons.push("RELEASE_DOMAIN_DECISION_SET_MISMATCH");
  }
  if (declaredDomainDecisions.size !== input.decision.domainReviewDecisionIds.length) {
    reasons.push("RELEASE_DOMAIN_DECISION_IDS_DUPLICATED");
  }
  return evaluation(reasons.length === 0, reasons, [...reviewGate.acceptedDecisionIds, input.decision.decisionId]);
}

const CHANNEL_BY_ACCESS = {
  BROWSE: "BROWSE_RELEASE",
  SEARCH: "STUDENT_SEARCH",
  PREVIEW: "BROWSE_RELEASE",
  WIKI_CONTEXT: "WIKI_RETRIEVAL",
} as const;

export function evaluateStudentCurrentReleaseEligibility(rawInput: unknown): FailClosedEvaluation {
  const parsed = StudentCurrentReleaseEligibilityInputSchema.safeParse(rawInput);
  if (!parsed.success) return evaluation(false, ["INVALID_STUDENT_RELEASE_INPUT"]);
  const input = parsed.data;
  const reasons: string[] = [];
  const releaseGate = evaluateReleaseDecision(input.releaseGate);
  if (!releaseGate.eligible) reasons.push("RELEASE_GATE_FAILED", ...releaseGate.reasons);
  let semantics: ReturnType<typeof deriveCanonicalReleaseSemantics>;
  try {
    semantics = deriveCanonicalReleaseSemantics(
      input.releaseGate.sourceMaterial.canonicalInputBundle,
      input.releaseGate.reviewGate.evaluatedAt,
    );
    if (!semantics.eligible) reasons.push("CANONICAL_RELEASE_SEMANTICS_BLOCK_STUDENT", ...semantics.reasons);
    if (input.page.withdrawalState !== semantics.withdrawalState) {
      reasons.push("PAGE_WITHDRAWAL_STATE_NOT_CANONICAL");
    }
  } catch {
    reasons.push("INVALID_CANONICAL_RELEASE_SEMANTICS");
  }
  if (!input.viewer.authenticated) reasons.push("STUDENT_NOT_AUTHENTICATED");
  if (!input.viewer.authorizedForCurrentStudent) reasons.push("STUDENT_SCOPE_NOT_AUTHORIZED");
  if (input.page.audience !== input.viewer.audience) reasons.push("PAGE_AUDIENCE_MISMATCH");
  if (input.page.reviewState !== "APPROVED_STUDENT") reasons.push("PAGE_NOT_APPROVED_STUDENT");
  if (input.page.withdrawalState !== "CLEAR") reasons.push("PAGE_RESTRICTED_OR_WITHDRAWN");
  if (input.page.studentDisplayDecision !== "ALLOW") reasons.push("PAGE_DISPLAY_NOT_ALLOWED");
  if (input.page.sourceDisclosureDecision !== "ALLOW") reasons.push("SOURCE_DISCLOSURE_NOT_ALLOWED");
  if (!input.page.evidenceAnchorResolvable) reasons.push("EVIDENCE_ANCHOR_UNRESOLVABLE");
  const current = input.releaseGate.current;
  const audiencePolicy = input.releaseGate.audiencePolicy;
  if (input.page.pageId !== current.pageId
    || stableWikiJson(input.page.pageRevision) !== stableWikiJson(current.pageRevision)
    || stableWikiJson(input.page.release) !== stableWikiJson(current.release)
    || input.page.compiledTruthHash !== current.compiledTruthHash) {
    reasons.push("PAGE_RELEASE_BINDING_MISMATCH");
  }
  const expectedPublicId = `inspiration:${hashWikiValue({ pageId: current.pageId }).slice(7, 31)}`;
  if (input.page.publicId !== expectedPublicId) reasons.push("PAGE_PUBLIC_ID_NOT_DERIVED");
  if (input.page.audience !== audiencePolicy.audience
    || input.page.studentDisplayDecision !== audiencePolicy.studentDisplayDecision
    || input.page.sourceDisclosureDecision !== audiencePolicy.sourceDisclosureDecision
    || input.page.previewDecision !== audiencePolicy.previewDecision
    || input.page.aiCitationDecision !== audiencePolicy.aiCitationDecision) {
    reasons.push("PAGE_AUDIENCE_POLICY_MISMATCH");
  }
  const channel = CHANNEL_BY_ACCESS[input.accessKind];
  if (current.channelStates[channel] !== "ACTIVE") reasons.push(`${channel}_NOT_ACTIVE`);
  if (input.accessKind === "PREVIEW" && input.page.previewDecision !== "ALLOW") reasons.push("PAGE_PREVIEW_NOT_ALLOWED");
  if (input.accessKind === "WIKI_CONTEXT" && input.page.aiCitationDecision !== "ALLOW") {
    reasons.push("PAGE_AI_CITATION_NOT_ALLOWED");
  }
  return evaluation(reasons.length === 0, reasons, releaseGate.acceptedDecisionIds);
}

export function revokeReviewerAssignments(
  assignments: readonly ReviewerRoleAssignment[],
  actorId: string,
): readonly ReviewerRoleAssignment[] {
  return deepFreezeWikiValue(assignments.map((assignment) => (
    assignment.actorId === actorId ? { ...assignment, status: "REVOKED" as const } : assignment
  )));
}
