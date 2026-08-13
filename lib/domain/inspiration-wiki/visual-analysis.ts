import {
  VisualAnalysisDraftSchema,
  VisualAnalysisDraftSeedSchema,
  VisualAnalysisRequestInputSchema,
  VisualAnalysisRequestMaterialSchema,
  VisualAnalysisRequestSchema,
  type VisualAnalysisClaim,
  type VisualAnalysisDraft,
  type VisualAnalysisRequest,
} from "./visual-analysis-contracts";
import {
  parseImmutableHermesHandoffV2Candidate,
} from "./hermes-handoff-v2";
import type { HermesHandoffV2Candidate } from "./hermes-handoff-v2-contracts";
import {
  WikiContractIntegrityError,
  deepFreezeWikiValue,
  hashWikiValue,
  type DeepReadonly,
} from "./integrity";

function assertUnique(values: readonly string[], code: string) {
  if (new Set(values).size !== values.length) throw new WikiContractIntegrityError(code);
}

function requestMaterial(candidate: HermesHandoffV2Candidate, requestedAt: string) {
  const sourceMaterialDigest = hashWikiValue({
    taxonomyPaths: candidate.source.taxonomyPaths,
    sourceStyleRaw: candidate.source.sourceStyleRaw,
    mediumOrTechnologyRaw: candidate.source.mediumOrTechnologyRaw,
    sourceStatements: candidate.sourceStatements,
  });
  return VisualAnalysisRequestMaterialSchema.parse({
    schemaVersion: "lumi-inspiration-visual-analysis-request/v1",
    requestedAt,
    candidateId: candidate.candidateId,
    candidateMaterialDigest: candidate.materialDigest,
    sourceMaterialDigest,
    mediaBindings: candidate.media.map((media) => ({
      mediaId: media.mediaId,
      kind: media.kind,
      role: media.role,
      mediaDigest: hashWikiValue(media),
    })).sort((left, right) => left.mediaId.localeCompare(right.mediaId)),
    sourceStatementBindings: candidate.sourceStatements.map((statement) => ({
      statementId: statement.statementId,
      statementDigest: hashWikiValue(statement),
    })).sort((left, right) => left.statementId.localeCompare(right.statementId)),
  });
}

export function createVisualAnalysisRequest(
  rawCandidate: unknown,
  rawInput: unknown,
): DeepReadonly<VisualAnalysisRequest> {
  const candidate = parseImmutableHermesHandoffV2Candidate(rawCandidate);
  const input = VisualAnalysisRequestInputSchema.parse(rawInput);
  const material = requestMaterial(candidate, input.requestedAt);
  const requestId = `visual-analysis-request:${hashWikiValue(material).slice(7, 31)}`;
  const request = VisualAnalysisRequestSchema.parse({
    ...material,
    requestId,
    requestDigest: hashWikiValue({ requestId, ...material }),
  });
  return deepFreezeWikiValue(request);
}

export function parseVisualAnalysisRequestAgainstCandidate(
  rawRequest: unknown,
  rawCandidate: unknown,
): DeepReadonly<VisualAnalysisRequest> {
  const request = VisualAnalysisRequestSchema.parse(rawRequest);
  const expected = createVisualAnalysisRequest(rawCandidate, { requestedAt: request.requestedAt });
  if (request.requestId !== expected.requestId || request.requestDigest !== expected.requestDigest) {
    throw new WikiContractIntegrityError("VISUAL_ANALYSIS_REQUEST_CANDIDATE_BINDING_MISMATCH");
  }
  return deepFreezeWikiValue(request);
}

function assertClaimEvidence(
  claim: VisualAnalysisClaim,
  request: VisualAnalysisRequest,
) {
  assertUnique(claim.mediaAnchors.map((anchor) => `${anchor.mediaId}:${JSON.stringify(anchor.region)}:${JSON.stringify(anchor.timeRangeMs)}`), "DUPLICATE_VISUAL_MEDIA_ANCHOR");
  assertUnique(claim.sourceStatementIds, "DUPLICATE_VISUAL_SOURCE_STATEMENT_REF");
  const mediaById = new Map(request.mediaBindings.map((binding) => [binding.mediaId, binding]));
  const statementIds = new Set(request.sourceStatementBindings.map((binding) => binding.statementId));
  if (claim.mediaAnchors.some((anchor) => !mediaById.has(anchor.mediaId))) {
    throw new WikiContractIntegrityError("VISUAL_CLAIM_MEDIA_OUTSIDE_REQUEST");
  }
  if (claim.sourceStatementIds.some((statementId) => !statementIds.has(statementId))) {
    throw new WikiContractIntegrityError("VISUAL_CLAIM_STATEMENT_OUTSIDE_REQUEST");
  }
  for (const anchor of claim.mediaAnchors) {
    const media = mediaById.get(anchor.mediaId)!;
    const timeAddressable = media.kind === "VIDEO" || media.kind === "ANIMATED_IMAGE" || media.kind === "AUDIO";
    if (!timeAddressable && anchor.timeRangeMs !== null) {
      throw new WikiContractIntegrityError("VISUAL_CLAIM_TIME_RANGE_MEDIA_MISMATCH");
    }
    if (media.kind === "AUDIO" && anchor.region !== null) {
      throw new WikiContractIntegrityError("VISUAL_AUDIO_ANCHOR_FORBIDS_REGION");
    }
  }
  if (claim.claimType !== "VISIBLE_OBSERVATION") return;
  const bound = claim.mediaAnchors.map((anchor) => ({ anchor, media: mediaById.get(anchor.mediaId)! }));
  if (claim.dimension === "TECHNOLOGY") {
    throw new WikiContractIntegrityError("VISUAL_APPEARANCE_CANNOT_PROVE_TECHNOLOGY");
  }
  if (claim.dimension === "MOTION") {
    if (!bound.some(({ anchor, media }) =>
      (media.kind === "VIDEO" && anchor.timeRangeMs !== null)
      || media.kind === "ANIMATED_IMAGE")) {
      throw new WikiContractIntegrityError("VISUAL_MOTION_CLAIM_REQUIRES_DYNAMIC_MEDIA");
    }
  }
  if (claim.dimension === "INTERACTION") {
    if (!bound.some(({ anchor, media }) =>
      (media.role === "INTERACTION_DEMO" || media.role === "SCREEN_RECORDING")
      && (media.kind === "ANIMATED_IMAGE" || (media.kind === "VIDEO" && anchor.timeRangeMs !== null)))) {
      throw new WikiContractIntegrityError("VISUAL_INTERACTION_CLAIM_REQUIRES_BEHAVIOR_EVIDENCE");
    }
  }
  if (claim.dimension === "AUDIO") {
    if (!bound.some(({ anchor, media }) =>
      (media.kind === "AUDIO" || media.kind === "VIDEO") && anchor.timeRangeMs !== null)) {
      throw new WikiContractIntegrityError("VISUAL_AUDIO_CLAIM_REQUIRES_TIME_EVIDENCE");
    }
  }
}

function assertDraftBindings(
  draft: ReturnType<typeof VisualAnalysisDraftSeedSchema.parse>,
  request: VisualAnalysisRequest,
) {
  if (
    draft.requestId !== request.requestId
    || draft.requestDigest !== request.requestDigest
    || draft.candidateId !== request.candidateId
    || draft.candidateMaterialDigest !== request.candidateMaterialDigest
  ) {
    throw new WikiContractIntegrityError("VISUAL_ANALYSIS_DRAFT_REQUEST_BINDING_MISMATCH");
  }
  assertUnique(draft.claims.map((claim) => claim.claimId), "DUPLICATE_VISUAL_CLAIM_ID");
  assertUnique(draft.keywordProposals.map((proposal) => proposal.proposalId), "DUPLICATE_VISUAL_KEYWORD_PROPOSAL_ID");
  assertUnique(
    draft.keywordProposals.map((proposal) => `${proposal.dimension}:${proposal.proposedTerm.toLocaleLowerCase("en-US")}`),
    "DUPLICATE_VISUAL_KEYWORD_PROPOSAL",
  );
  for (const claim of draft.claims) assertClaimEvidence(claim, request);

  const claimById = new Map(draft.claims.map((claim) => [claim.claimId, claim]));
  for (const proposal of draft.keywordProposals) {
    assertUnique(proposal.supportClaimIds, "DUPLICATE_VISUAL_KEYWORD_SUPPORT_REF");
    const support = proposal.supportClaimIds.map((claimId) => claimById.get(claimId));
    if (support.some((claim) => !claim)) {
      throw new WikiContractIntegrityError("VISUAL_KEYWORD_SUPPORT_OUTSIDE_DRAFT");
    }
    const claims = support as VisualAnalysisClaim[];
    if (proposal.dimension === "STYLE") {
      if (!claims.some((claim) => claim.claimType === "VISIBLE_OBSERVATION")) {
        throw new WikiContractIntegrityError("VISUAL_STYLE_KEYWORD_REQUIRES_VISIBLE_SUPPORT");
      }
    } else if (!claims.some((claim) => claim.dimension === proposal.dimension)) {
      throw new WikiContractIntegrityError("VISUAL_KEYWORD_DIMENSION_SUPPORT_MISMATCH");
    }
    if (proposal.dimension === "TECHNOLOGY" && !claims.every((claim) => claim.claimType === "SOURCE_FACT")) {
      throw new WikiContractIntegrityError("VISUAL_TECHNOLOGY_KEYWORD_REQUIRES_SOURCE_FACT");
    }
  }
}

export function createVisualAnalysisDraft(
  rawSeed: unknown,
  rawRequest: unknown,
  rawCandidate: unknown,
): DeepReadonly<VisualAnalysisDraft> {
  const request = parseVisualAnalysisRequestAgainstCandidate(rawRequest, rawCandidate);
  const seed = VisualAnalysisDraftSeedSchema.parse(rawSeed);
  assertDraftBindings(seed, request);
  const draft = VisualAnalysisDraftSchema.parse({
    ...seed,
    analysisDigest: hashWikiValue(seed),
  });
  return deepFreezeWikiValue(draft);
}

export function parseVisualAnalysisDraftAgainstRequest(
  rawDraft: unknown,
  rawRequest: unknown,
  rawCandidate: unknown,
): DeepReadonly<VisualAnalysisDraft> {
  const request = parseVisualAnalysisRequestAgainstCandidate(rawRequest, rawCandidate);
  const draft = VisualAnalysisDraftSchema.parse(rawDraft);
  const seedValue = Object.fromEntries(
    Object.entries(draft).filter(([key]) => key !== "analysisDigest"),
  );
  const seed = VisualAnalysisDraftSeedSchema.parse(seedValue);
  assertDraftBindings(seed, request);
  if (draft.analysisDigest !== hashWikiValue(seed)) {
    throw new WikiContractIntegrityError("STALE_VISUAL_ANALYSIS_DIGEST");
  }
  return deepFreezeWikiValue(draft);
}
