import {
  HermesHandoffV2CandidateSchema,
  HermesHandoffV2CandidateSeedSchema,
  HermesHandoffV2ManifestInputSchema,
  HermesHandoffV2ManifestSchema,
  HermesHandoffV2ManifestSeedSchema,
  type HermesDynamicEvidence,
  type HermesDynamicWorkModality,
  type HermesHandoffV2Candidate,
  type HermesHandoffV2CandidateSeed,
  type HermesHandoffV2Manifest,
  type HermesProjectMedia,
} from "./hermes-handoff-v2-contracts";
import {
  WikiContractIntegrityError,
  deepFreezeWikiValue,
  hashWikiValue,
  type DeepReadonly,
} from "./integrity";

function assertUnique(values: readonly string[], code: string) {
  if (new Set(values).size !== values.length) throw new WikiContractIntegrityError(code);
}

function candidateMaterial(candidate: HermesHandoffV2Candidate | HermesHandoffV2CandidateSeed) {
  if ("materialDigest" in candidate) {
    const seedValue = Object.fromEntries(
      Object.entries(candidate).filter(([key]) => key !== "materialDigest"),
    );
    return HermesHandoffV2CandidateSeedSchema.parse(seedValue);
  }
  return HermesHandoffV2CandidateSeedSchema.parse(candidate);
}

function evidenceKindSupportsModality(evidence: HermesDynamicEvidence) {
  const allowed: Record<HermesDynamicWorkModality, ReadonlySet<HermesDynamicEvidence["evidenceKind"]>> = {
    TIME_BASED: new Set(["DIRECT_MOTION", "DIRECT_AUDIO", "SOURCE_ATTESTED"]),
    INTERACTIVE: new Set(["DIRECT_INTERACTION", "PUBLIC_INTERACTIVE_ENDPOINT", "SOURCE_ATTESTED"]),
    REALTIME_GENERATIVE: new Set(["DIRECT_MOTION", "DIRECT_INTERACTION", "PUBLIC_INTERACTIVE_ENDPOINT", "SOURCE_ATTESTED"]),
    IMMERSIVE: new Set(["DIRECT_MOTION", "DIRECT_INTERACTION", "SOURCE_ATTESTED"]),
    SPATIAL_INTERACTIVE: new Set(["DIRECT_MOTION", "DIRECT_INTERACTION", "SOURCE_ATTESTED"]),
    AUDIO_RESPONSIVE: new Set(["DIRECT_AUDIO", "DIRECT_MOTION", "DIRECT_INTERACTION", "SOURCE_ATTESTED"]),
  };
  return allowed[evidence.modality].has(evidence.evidenceKind);
}

function evidenceHasQualifiedMedia(evidence: HermesDynamicEvidence, media: readonly HermesProjectMedia[]) {
  const bound = evidence.mediaIds.map((mediaId) => media.find((candidate) => candidate.mediaId === mediaId));
  if (bound.some((item) => !item)) return false;
  const present = bound as HermesProjectMedia[];
  switch (evidence.evidenceKind) {
    case "DIRECT_MOTION":
      return present.some((item) => item.kind === "VIDEO" || item.kind === "ANIMATED_IMAGE");
    case "DIRECT_INTERACTION":
      return present.some((item) => item.role === "INTERACTION_DEMO" || item.role === "SCREEN_RECORDING");
    case "PUBLIC_INTERACTIVE_ENDPOINT":
      return present.some((item) => item.kind === "INTERACTIVE_URL" && item.role === "LIVE_INTERACTIVE_ENDPOINT");
    case "DIRECT_AUDIO":
      return present.some((item) => item.kind === "AUDIO" && item.role === "AUDIO_SAMPLE");
    case "SOURCE_ATTESTED":
      return present.length > 0;
  }
}

function assertCandidateBindings(candidate: HermesHandoffV2CandidateSeed) {
  assertUnique(candidate.source.taxonomyPaths.map((item) => item.pathId), "DUPLICATE_SOURCE_TAXONOMY_PATH_ID");
  assertUnique(candidate.source.sourceStyleRaw.map((item) => item.termId), "DUPLICATE_SOURCE_STYLE_TERM_ID");
  assertUnique(candidate.source.mediumOrTechnologyRaw.map((item) => item.termId), "DUPLICATE_SOURCE_MEDIUM_TERM_ID");
  assertUnique(candidate.sourceStatements.map((item) => item.statementId), "DUPLICATE_SOURCE_STATEMENT_ID");
  assertUnique(candidate.designCategories, "DUPLICATE_DESIGN_CATEGORY");
  assertUnique(candidate.workModalities, "DUPLICATE_WORK_MODALITY");
  assertUnique(candidate.media.map((item) => item.mediaId), "DUPLICATE_PROJECT_MEDIA_ID");
  assertUnique(candidate.dynamicEvidence.map((item) => item.evidenceId), "DUPLICATE_DYNAMIC_EVIDENCE_ID");

  const mediaIds = new Set(candidate.media.map((item) => item.mediaId));
  const sourceStatementIds = new Set(candidate.sourceStatements.map((item) => item.statementId));
  for (const evidence of candidate.dynamicEvidence) {
    assertUnique(evidence.mediaIds, "DUPLICATE_DYNAMIC_EVIDENCE_MEDIA_REF");
    assertUnique(evidence.sourceStatementIds, "DUPLICATE_DYNAMIC_EVIDENCE_STATEMENT_REF");
    if (evidence.mediaIds.some((mediaId) => !mediaIds.has(mediaId))) {
      throw new WikiContractIntegrityError("DYNAMIC_EVIDENCE_MEDIA_OUTSIDE_PROJECT");
    }
    if (evidence.sourceStatementIds.some((statementId) => !sourceStatementIds.has(statementId))) {
      throw new WikiContractIntegrityError("DYNAMIC_EVIDENCE_STATEMENT_OUTSIDE_SOURCE");
    }
    if (!evidenceKindSupportsModality(evidence)) {
      throw new WikiContractIntegrityError("DYNAMIC_EVIDENCE_KIND_MODALITY_MISMATCH");
    }
    if (!evidenceHasQualifiedMedia(evidence, candidate.media)) {
      throw new WikiContractIntegrityError("DYNAMIC_EVIDENCE_MEDIA_KIND_MISMATCH");
    }
  }

  const dynamicModalities = candidate.workModalities.filter(
    (modality): modality is HermesDynamicWorkModality => modality !== "STATIC",
  );
  if (dynamicModalities.length === 0 && candidate.dynamicEvidence.length > 0) {
    throw new WikiContractIntegrityError("STATIC_PROJECT_FORBIDS_DYNAMIC_EVIDENCE");
  }
  for (const modality of dynamicModalities) {
    if (!candidate.dynamicEvidence.some((evidence) => evidence.modality === modality)) {
      throw new WikiContractIntegrityError(`DYNAMIC_MODALITY_EVIDENCE_MISSING:${modality}`);
    }
  }
  if (candidate.dynamicEvidence.some((evidence) => !dynamicModalities.includes(evidence.modality))) {
    throw new WikiContractIntegrityError("DYNAMIC_EVIDENCE_MODALITY_NOT_DECLARED");
  }
}

export function createHermesHandoffV2Candidate(
  rawSeed: unknown,
): DeepReadonly<HermesHandoffV2Candidate> {
  const seed = HermesHandoffV2CandidateSeedSchema.parse(rawSeed);
  assertCandidateBindings(seed);
  const candidate = HermesHandoffV2CandidateSchema.parse({
    ...seed,
    materialDigest: hashWikiValue(seed),
  });
  return deepFreezeWikiValue(candidate);
}

export function parseImmutableHermesHandoffV2Candidate(
  rawCandidate: unknown,
): DeepReadonly<HermesHandoffV2Candidate> {
  const candidate = HermesHandoffV2CandidateSchema.parse(rawCandidate);
  const seed = candidateMaterial(candidate);
  assertCandidateBindings(seed);
  if (candidate.materialDigest !== hashWikiValue(seed)) {
    throw new WikiContractIntegrityError("STALE_HERMES_CANDIDATE_MATERIAL_DIGEST");
  }
  return deepFreezeWikiValue(candidate);
}

export function createHermesHandoffV2Manifest(
  rawInput: unknown,
  rawCandidates: readonly unknown[],
): DeepReadonly<HermesHandoffV2Manifest> {
  const input = HermesHandoffV2ManifestInputSchema.parse(rawInput);
  const candidates = rawCandidates.map(parseImmutableHermesHandoffV2Candidate);
  if (candidates.length === 0 || candidates.length > 100) {
    throw new WikiContractIntegrityError("HERMES_MANIFEST_CANDIDATE_COUNT_OUT_OF_RANGE");
  }
  if (candidates.some((candidate) => candidate.batchId !== input.batchId)) {
    throw new WikiContractIntegrityError("HERMES_MANIFEST_CANDIDATE_BATCH_MISMATCH");
  }
  assertUnique(
    candidates.map((candidate) => candidate.candidateId),
    "HERMES_MANIFEST_CANDIDATE_ID_DUPLICATE",
  );
  const candidateMaterialDigests = candidates
    .map((candidate) => candidate.materialDigest)
    .sort((left, right) => left.localeCompare(right));
  assertUnique(candidateMaterialDigests, "HERMES_MANIFEST_CANDIDATE_DIGEST_DUPLICATE");
  const seed = HermesHandoffV2ManifestSeedSchema.parse({ ...input, candidateMaterialDigests });
  const manifest = HermesHandoffV2ManifestSchema.parse({
    ...seed,
    manifestDigest: hashWikiValue(seed),
  });
  return deepFreezeWikiValue(manifest);
}

export function parseImmutableHermesHandoffV2Manifest(
  rawManifest: unknown,
  rawCandidates: readonly unknown[],
): DeepReadonly<HermesHandoffV2Manifest> {
  const manifest = HermesHandoffV2ManifestSchema.parse(rawManifest);
  const seedValue = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== "manifestDigest"),
  );
  const seed = HermesHandoffV2ManifestSeedSchema.parse(seedValue);
  if (manifest.manifestDigest !== hashWikiValue(seed)) {
    throw new WikiContractIntegrityError("STALE_HERMES_MANIFEST_DIGEST");
  }
  const inputValue = Object.fromEntries(
    Object.entries(seed).filter(([key]) => key !== "candidateMaterialDigests"),
  );
  const expected = createHermesHandoffV2Manifest(
    HermesHandoffV2ManifestInputSchema.parse(inputValue),
    rawCandidates,
  );
  if (expected.manifestDigest !== manifest.manifestDigest) {
    throw new WikiContractIntegrityError("HERMES_MANIFEST_CANDIDATE_SET_MISMATCH");
  }
  return deepFreezeWikiValue(manifest);
}
