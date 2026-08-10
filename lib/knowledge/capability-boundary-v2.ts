import { createHash } from "node:crypto";

import { z } from "zod";

import {
  CapabilityAnchorCoverageV2Schema,
  unsupportedExplicitTechnicalAnchorsV2,
  verifyCapabilityAnchorCoverageV2,
  type CapabilityAnchorCoverageV2,
} from "./capability-anchor-coverage-v2";
import { CoursePackReferenceV2Schema } from "./knowledge-object-v2";
import { PackCompetitionObservationV2Schema } from "./pack-competition-v2";
import { RetrievalModeV2Schema } from "./retrieval-query-v2";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const IMMUTABLE_MODEL_REVISION_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const IdSchema = z.string().regex(ID_PATTERN, "expected a stable lowercase identifier");
const HashSchema = z.string().regex(HASH_PATTERN, "expected a lowercase sha256 hash");
const SemverSchema = z.string().regex(SEMVER_PATTERN, "expected a fixed semantic version");
const ImmutableModelRevisionSchema = z
  .string()
  .trim()
  .regex(
    IMMUTABLE_MODEL_REVISION_PATTERN,
    "text model revision must be an immutable 40- or 64-hex digest",
  );

export const CapabilityEntityAliasClassificationV2Schema = z.enum([
  "EXCLUSIVE",
  "AMBIGUOUS",
]);

export function normalizeCapabilityEntityTextV2(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("zh-CN");
}

const CapabilityEntityAliasInputV2Schema = z
  .object({
    text: z.string().trim().min(2).max(100),
    classification: CapabilityEntityAliasClassificationV2Schema,
  })
  .strict();

export const CapabilityEntityAliasV2Schema = CapabilityEntityAliasInputV2Schema
  .extend({
    normalizedText: z.string().min(1).max(100),
  })
  .strict()
  .superRefine((alias, context) => {
    if (alias.normalizedText !== normalizeCapabilityEntityTextV2(alias.text)) {
      context.addIssue({
        code: "custom",
        message: "capability aliases require deterministic NFKC normalization",
        path: ["normalizedText"],
      });
    }
  });

const CapabilityEntityInputV2Schema = z
  .object({
    entityId: IdSchema,
    ownerCoursePack: CoursePackReferenceV2Schema,
    scope: z.enum(["COURSE_EXCLUSIVE", "SHARED_OR_AMBIGUOUS"]),
    evidenceObjectIds: z.array(IdSchema).min(1).max(32),
    aliases: z.array(CapabilityEntityAliasInputV2Schema).min(1).max(32),
  })
  .strict();

export const CapabilityEntityV2Schema = CapabilityEntityInputV2Schema
  .omit({ aliases: true })
  .extend({
    aliases: z.array(CapabilityEntityAliasV2Schema).min(1).max(32),
  })
  .strict()
  .superRefine((entity, context) => {
    if (new Set(entity.evidenceObjectIds).size !== entity.evidenceObjectIds.length) {
      context.addIssue({
        code: "custom",
        message: "capability evidence object ids must be unique",
        path: ["evidenceObjectIds"],
      });
    }
    const normalizedAliases = entity.aliases.map(({ normalizedText }) => normalizedText);
    if (new Set(normalizedAliases).size !== normalizedAliases.length) {
      context.addIssue({
        code: "custom",
        message: "capability aliases must be unique after normalization",
        path: ["aliases"],
      });
    }
    const exclusiveAliases = entity.aliases.filter(
      ({ classification }) => classification === "EXCLUSIVE",
    );
    if (
      (entity.scope === "COURSE_EXCLUSIVE" && exclusiveAliases.length === 0)
      || (entity.scope === "SHARED_OR_AMBIGUOUS" && exclusiveAliases.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "only audited course-exclusive entities may declare exclusive aliases",
        path: ["aliases"],
      });
    }
  });

const CapabilityEntityManifestInputV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    id: IdSchema,
    version: SemverSchema,
    corpusBundleHash: HashSchema,
    entities: z.array(CapabilityEntityV2Schema).max(256),
    technicalAnchorCoverage:
      CapabilityAnchorCoverageV2Schema.optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const entityIds = manifest.entities.map(({ entityId }) => entityId);
    if (new Set(entityIds).size !== entityIds.length) {
      context.addIssue({
        code: "custom",
        message: "capability entity ids must be unique",
        path: ["entities"],
      });
    }
    const exclusiveAliases = manifest.entities.flatMap((entity) =>
      entity.aliases
        .filter(({ classification }) => classification === "EXCLUSIVE")
        .map(({ normalizedText }) => normalizedText));
    if (new Set(exclusiveAliases).size !== exclusiveAliases.length) {
      context.addIssue({
        code: "custom",
        message: "exclusive aliases must identify exactly one audited entity",
        path: ["entities"],
      });
    }
    if (
      manifest.technicalAnchorCoverage
      && manifest.technicalAnchorCoverage.corpusBundleHash
        !== manifest.corpusBundleHash
    ) {
      context.addIssue({
        code: "custom",
        message:
          "technical anchor coverage must bind the manifest corpus bundle",
        path: ["technicalAnchorCoverage", "corpusBundleHash"],
      });
    }
  });

export const CapabilityEntityManifestV2Schema = CapabilityEntityManifestInputV2Schema
  .extend({
    configHash: HashSchema,
  })
  .strict();

const PackCompetitionPolicyInputV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    id: IdSchema,
    version: SemverSchema,
    applicableMode: z.literal("TEXT_TO_TEXT"),
    requireExplicitCourseScope: z.literal(true),
    requireHealthyChannels: z.tuple([
      z.literal("LEXICAL"),
      z.literal("TEXT_VECTOR"),
    ]),
    skipDegradedLexicalFallback: z.literal(true),
    entityResolution: z.literal(
      "NON_OVERLAPPING_EXCLUSIVE_WITH_AMBIGUOUS_SPAN_GUARD",
    ),
    ambiguousEntityAction: z.literal("ABSTAIN"),
    exclusiveForeignEntityAction: z.literal("REJECT"),
    technicalAnchorCoverage: z.literal("SCOPED_CORPUS_DERIVED"),
    unsupportedTechnicalAnchorAction: z.literal("REJECT"),
    dualChannelForeignPackAgreementRequired: z.literal(true),
    dualChannelMarginComparison: z.literal("BOTH_AT_OR_ABOVE_MINIMUM"),
    scopedSufficiencyProtection: z.literal("EITHER_AT_OR_ABOVE_FLOOR"),
  })
  .strict();

export const PackCompetitionPolicyV2Schema = PackCompetitionPolicyInputV2Schema
  .extend({
    configHash: HashSchema,
  })
  .strict();

const PackCompetitionChannelCalibrationV2Schema = z
  .object({
    minimumForeignPackMargin: z.number().finite().nonnegative(),
    scopedSufficiencyFloor: z.number().finite(),
    minimumDistinctObjects: z.number().int().min(2).max(10_000),
  })
  .strict();

const PackCompetitionCalibrationInputV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    id: IdSchema,
    version: SemverSchema,
    developmentSuiteHash: HashSchema,
    corpusBundleHash: HashSchema,
    lexicalConfigHash: HashSchema,
    normalizerConfigHash: HashSchema,
    textProviderIndexBundleHash: HashSchema,
    textModelId: z.string().trim().min(1).max(300),
    textModelRevision: ImmutableModelRevisionSchema,
    lexicalPackCompetitionAlgorithmHash: HashSchema,
    textPackCompetitionAlgorithmHash: HashSchema,
    capabilityEntityManifestHash: HashSchema,
    packCompetitionPolicyHash: HashSchema,
    channels: z
      .object({
        LEXICAL: PackCompetitionChannelCalibrationV2Schema,
        TEXT_VECTOR: PackCompetitionChannelCalibrationV2Schema,
      })
      .strict(),
  })
  .strict();

export const PackCompetitionCalibrationV2Schema =
  PackCompetitionCalibrationInputV2Schema
    .extend({
      configHash: HashSchema,
    })
    .strict();

export const PackCompetitionWinnerV2Schema = z
  .object({
    coursePack: CoursePackReferenceV2Schema,
    objectId: IdSchema,
    representationId: IdSchema.nullable(),
    score: z.number().finite(),
  })
  .strict();

const PackCompetitionChannelDiagnosticV2Schema = z
  .object({
    status: z.literal("HEALTHY"),
    globalWinner: PackCompetitionWinnerV2Schema,
    scopedWinner: PackCompetitionWinnerV2Schema,
    foreignPackMargin: z.number().finite().nonnegative(),
    scopedSufficiency: z.number().finite(),
    distinctObjectCount: z.number().int().positive().max(10_000),
    distinctRepresentationCount: z.number().int().positive().max(100_000),
  })
  .strict()
  .superRefine((diagnostic, context) => {
    if (diagnostic.distinctRepresentationCount < diagnostic.distinctObjectCount) {
      context.addIssue({
        code: "custom",
        message: "representation count cannot be smaller than distinct object count",
        path: ["distinctRepresentationCount"],
      });
    }
    const expectedMargin = diagnostic.globalWinner.score
      - diagnostic.scopedWinner.score;
    if (
      expectedMargin < 0
      || Math.abs(diagnostic.foreignPackMargin - expectedMargin) > 1e-12
    ) {
      context.addIssue({
        code: "custom",
        message: "foreign pack margin must equal the winner score delta",
        path: ["foreignPackMargin"],
      });
    }
    if (diagnostic.scopedSufficiency !== diagnostic.scopedWinner.score) {
      context.addIssue({
        code: "custom",
        message: "scoped sufficiency must equal the scoped winner score",
        path: ["scopedSufficiency"],
      });
    }
  });

export const PackCompetitionDiagnosticsV2Schema = z
  .object({
    LEXICAL: PackCompetitionChannelDiagnosticV2Schema,
    TEXT_VECTOR: PackCompetitionChannelDiagnosticV2Schema,
  })
  .strict();

const TextChannelStatusV2Schema = z.enum([
  "SUCCESS",
  "EMPTY",
  "UNAVAILABLE",
  "TIMEOUT",
  "ERROR",
]);

const CapabilityBoundaryInputV2Schema = z
  .object({
    queryMode: RetrievalModeV2Schema,
    originalText: z.string().min(1).max(500).nullable(),
    normalizedText: z.string().min(1).max(500).nullable(),
    corpusBundleHash: HashSchema,
    lexicalConfigHash: HashSchema,
    normalizerConfigHash: HashSchema,
    textProviderIndexBundleHash: HashSchema,
    textModelId: z.string().trim().min(1).max(300),
    textModelRevision: ImmutableModelRevisionSchema,
    lexicalPackCompetitionAlgorithmHash: HashSchema,
    textPackCompetitionAlgorithmHash: HashSchema,
    sourceCoursePack: CoursePackReferenceV2Schema.nullable(),
    acceptedCandidateIds: z.array(IdSchema).max(10),
    degradedLexicalFallback: z.boolean(),
    channelStatuses: z
      .object({
        LEXICAL: TextChannelStatusV2Schema,
        TEXT_VECTOR: TextChannelStatusV2Schema,
      })
      .strict(),
    acceptancePolicyHash: HashSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.acceptedCandidateIds).size !== input.acceptedCandidateIds.length) {
      context.addIssue({
        code: "custom",
        message: "accepted candidate ids must be unique",
        path: ["acceptedCandidateIds"],
      });
    }
    if (
      (input.originalText === null) !== (input.normalizedText === null)
      || (
        input.originalText !== null
        && normalizeCapabilityEntityTextV2(input.originalText)
          !== input.normalizedText
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "boundary normalized text must be derived from original text",
        path: ["normalizedText"],
      });
    }
  });

export const CapabilityBoundaryDecisionV2Schema = z.enum([
  "SKIP",
  "ABSTAIN",
  "REJECT",
]);

export const CapabilityBoundaryReasonV2Schema = z.enum([
  "SKIPPED_UNSCOPED",
  "SKIPPED_QUERY_TEXT_MISSING",
  "SKIPPED_NO_ACCEPTED_EVIDENCE",
  "SKIPPED_DEGRADED_LEXICAL_FALLBACK",
  "SKIPPED_UNHEALTHY_TEXT_CHANNELS",
  "SKIPPED_CORPUS_IDENTITY_MISMATCH",
  "EXCLUSIVE_ENTITY_FOREIGN_PACK",
  "UNSUPPORTED_TECHNICAL_ANCHOR",
  "DUAL_CHANNEL_FOREIGN_PACK_MARGIN",
  "SCOPED_EXCLUSIVE_ENTITY_PRESENT",
  "AMBIGUOUS_ENTITY_PRESENT",
  "DIAGNOSTICS_MISSING",
  "DIAGNOSTICS_INVALID",
  "CHANNEL_PACK_DISAGREEMENT",
  "WINNER_IS_SCOPED_PACK",
  "INSUFFICIENT_COMPETITION_SAMPLE",
  "MARGIN_BELOW_THRESHOLD",
  "SCOPED_SUFFICIENCY_PROTECTED",
]);

export const MatchedCapabilityEntityV2Schema = z
  .object({
    entityId: IdSchema,
    ownerCoursePack: CoursePackReferenceV2Schema,
    alias: z.string().min(1).max(100),
    aliasClassification: CapabilityEntityAliasClassificationV2Schema,
    entityScope: z.enum(["COURSE_EXCLUSIVE", "SHARED_OR_AMBIGUOUS"]),
    matchStart: z.number().int().nonnegative().max(500),
    matchEnd: z.number().int().positive().max(500),
  })
  .strict()
  .refine(
    ({ matchStart, matchEnd }) => matchEnd > matchStart,
    "capability entity match span must be non-empty",
  );

export const CapabilityBoundaryTraceV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    decision: CapabilityBoundaryDecisionV2Schema,
    reason: CapabilityBoundaryReasonV2Schema,
    queryMode: z.literal("TEXT_TO_TEXT"),
    sourceCoursePack: CoursePackReferenceV2Schema.nullable(),
    acceptancePolicyHash: HashSchema,
    capabilityEntityManifestHash: HashSchema,
    packCompetitionPolicyHash: HashSchema,
    packCompetitionCalibrationHash: HashSchema,
    lexicalPackCompetitionAlgorithmHash: HashSchema,
    textPackCompetitionAlgorithmHash: HashSchema,
    acceptedCandidateIdsBefore: z.array(IdSchema).max(10),
    acceptedCandidateIdsAfter: z.array(IdSchema).max(10),
    matchedEntities: z.array(MatchedCapabilityEntityV2Schema).max(64),
    unsupportedTechnicalAnchors: z
      .array(z.string().min(2).max(80))
      .max(32),
    diagnostics: PackCompetitionDiagnosticsV2Schema.nullable(),
  })
  .strict()
  .superRefine((trace, context) => {
    const rejectionReasons = new Set([
      "EXCLUSIVE_ENTITY_FOREIGN_PACK",
      "UNSUPPORTED_TECHNICAL_ANCHOR",
      "DUAL_CHANNEL_FOREIGN_PACK_MARGIN",
    ]);
    const skipped = trace.reason.startsWith("SKIPPED_");
    if (
      (trace.decision === "REJECT") !== rejectionReasons.has(trace.reason)
      || (trace.decision === "SKIP") !== skipped
    ) {
      context.addIssue({
        code: "custom",
        message: "boundary decision must agree with its reason",
      });
    }
    if (
      trace.decision === "REJECT"
        ? trace.acceptedCandidateIdsAfter.length !== 0
        : stableJson(trace.acceptedCandidateIdsAfter)
          !== stableJson(trace.acceptedCandidateIdsBefore)
    ) {
      context.addIssue({
        code: "custom",
        message: "boundary may only clear accepted candidates",
        path: ["acceptedCandidateIdsAfter"],
      });
    }
  });

export type CapabilityEntityManifestV2 = z.infer<
  typeof CapabilityEntityManifestV2Schema
>;
export type PackCompetitionPolicyV2 = z.infer<
  typeof PackCompetitionPolicyV2Schema
>;
export type PackCompetitionCalibrationV2 = z.infer<
  typeof PackCompetitionCalibrationV2Schema
>;
export type PackCompetitionDiagnosticsV2 = z.infer<
  typeof PackCompetitionDiagnosticsV2Schema
>;
export type CapabilityBoundaryTraceV2 = z.infer<
  typeof CapabilityBoundaryTraceV2Schema
>;
export type MatchedCapabilityEntityV2 = z.infer<
  typeof MatchedCapabilityEntityV2Schema
>;

type CapabilityCoursePackIdV2 =
  z.infer<typeof CoursePackReferenceV2Schema>["id"];

export function mapPackCompetitionObservationsToBoundaryDiagnosticsV2(
  observations: {
    LEXICAL?: unknown;
    TEXT_VECTOR?: unknown;
  },
  coursePackVersions: Partial<Record<CapabilityCoursePackIdV2, unknown>>,
): PackCompetitionDiagnosticsV2 | undefined {
  const lexicalObservation = PackCompetitionObservationV2Schema.safeParse(
    observations.LEXICAL,
  );
  const vectorObservation = PackCompetitionObservationV2Schema.safeParse(
    observations.TEXT_VECTOR,
  );
  if (
    !lexicalObservation.success
    || !vectorObservation.success
    || lexicalObservation.data.status !== "AVAILABLE"
    || vectorObservation.data.status !== "AVAILABLE"
  ) {
    return undefined;
  }
  const lexical = lexicalObservation.data.packCompetition;
  const vector = vectorObservation.data.packCompetition;
  if (
    lexical.scoreMetric !== "LEXICAL_NORMALIZED_SCORE"
    || vector.scoreMetric !== "COSINE_SIMILARITY"
    || lexical.sourceScope.coursePackId === null
    || lexical.sourceScope.coursePackId !== vector.sourceScope.coursePackId
  ) {
    return undefined;
  }

  function coursePack(coursePackId: CapabilityCoursePackIdV2) {
    const parsed = CoursePackReferenceV2Schema.safeParse({
      id: coursePackId,
      version: coursePackVersions[coursePackId],
    });
    return parsed.success ? parsed.data : null;
  }

  function mapChannel(
    diagnostic: typeof lexical | typeof vector,
  ): z.input<typeof PackCompetitionChannelDiagnosticV2Schema> | null {
    if (
      diagnostic.globalWinner === null
      || diagnostic.scopedWinner === null
      || diagnostic.globalToScopedMargin === null
    ) {
      return null;
    }
    const globalCoursePack = coursePack(diagnostic.globalWinner.coursePackId);
    const scopedCoursePack = coursePack(diagnostic.scopedWinner.coursePackId);
    if (!globalCoursePack || !scopedCoursePack) return null;
    return {
      status: "HEALTHY",
      globalWinner: {
        coursePack: globalCoursePack,
        objectId: diagnostic.globalWinner.objectId,
        representationId: diagnostic.globalWinner.representationId,
        score: diagnostic.globalWinner.score,
      },
      scopedWinner: {
        coursePack: scopedCoursePack,
        objectId: diagnostic.scopedWinner.objectId,
        representationId: diagnostic.scopedWinner.representationId,
        score: diagnostic.scopedWinner.score,
      },
      foreignPackMargin: diagnostic.globalToScopedMargin,
      scopedSufficiency: diagnostic.scopedWinner.score,
      distinctObjectCount: diagnostic.deduplicatedObjectCount,
      distinctRepresentationCount: diagnostic.scoredRepresentationCount,
    };
  }

  const mappedLexical = mapChannel(lexical);
  const mappedVector = mapChannel(vector);
  if (!mappedLexical || !mappedVector) return undefined;
  const mapped = PackCompetitionDiagnosticsV2Schema.safeParse({
    LEXICAL: mappedLexical,
    TEXT_VECTOR: mappedVector,
  });
  return mapped.success ? mapped.data : undefined;
}

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function withoutConfigHash<T extends { configHash: string }>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "configHash"),
  );
}

function verifyConfigHash<T extends { configHash: string }>(
  value: T,
  label: string,
) {
  if (value.configHash !== sha256(withoutConfigHash(value))) {
    throw new Error(`${label} config hash mismatch`);
  }
}

export function createCapabilityEntityManifestV2(input: {
  id?: string;
  version?: string;
  corpusBundleHash: string;
  entities: readonly z.input<typeof CapabilityEntityInputV2Schema>[];
  technicalAnchorCoverage?: CapabilityAnchorCoverageV2;
}): CapabilityEntityManifestV2 {
  const entities = input.entities
    .map((rawEntity) => {
      const entity = CapabilityEntityInputV2Schema.parse(rawEntity);
      return CapabilityEntityV2Schema.parse({
        ...entity,
        evidenceObjectIds: [...entity.evidenceObjectIds].sort(compareCodePoints),
        aliases: entity.aliases
          .map((alias) => ({
            ...alias,
            normalizedText: normalizeCapabilityEntityTextV2(alias.text),
          }))
          .sort((left, right) =>
            right.normalizedText.length - left.normalizedText.length
            || compareCodePoints(left.normalizedText, right.normalizedText)),
      });
    })
    .sort((left, right) => compareCodePoints(left.entityId, right.entityId));
  const parsed = CapabilityEntityManifestInputV2Schema.parse({
    schemaVersion: 2,
    id: input.id ?? "lumi-capability-entity-manifest-v2",
    version: input.version ?? "1.0.0",
    corpusBundleHash: input.corpusBundleHash,
    entities,
    ...(input.technicalAnchorCoverage
      ? {
          technicalAnchorCoverage:
            verifyCapabilityAnchorCoverageV2(
              input.technicalAnchorCoverage,
            ),
        }
      : {}),
  });
  return CapabilityEntityManifestV2Schema.parse({
    ...parsed,
    configHash: sha256(parsed),
  });
}

export const PACK_COMPETITION_POLICY_V2 = createPackCompetitionPolicyV2();

export function createPackCompetitionPolicyV2(input: {
  id?: string;
  version?: string;
} = {}): PackCompetitionPolicyV2 {
  const parsed = PackCompetitionPolicyInputV2Schema.parse({
    schemaVersion: 2,
    id: input.id ?? "lumi-pack-competition-policy-v2",
    version: input.version ?? "1.0.0",
    applicableMode: "TEXT_TO_TEXT",
    requireExplicitCourseScope: true,
    requireHealthyChannels: ["LEXICAL", "TEXT_VECTOR"],
    skipDegradedLexicalFallback: true,
    entityResolution:
      "NON_OVERLAPPING_EXCLUSIVE_WITH_AMBIGUOUS_SPAN_GUARD",
    ambiguousEntityAction: "ABSTAIN",
    exclusiveForeignEntityAction: "REJECT",
    technicalAnchorCoverage: "SCOPED_CORPUS_DERIVED",
    unsupportedTechnicalAnchorAction: "REJECT",
    dualChannelForeignPackAgreementRequired: true,
    dualChannelMarginComparison: "BOTH_AT_OR_ABOVE_MINIMUM",
    scopedSufficiencyProtection: "EITHER_AT_OR_ABOVE_FLOOR",
  });
  return PackCompetitionPolicyV2Schema.parse({
    ...parsed,
    configHash: sha256(parsed),
  });
}

export function createPackCompetitionCalibrationV2(input: {
  id?: string;
  version?: string;
  developmentSuiteHash: string;
  corpusBundleHash: string;
  lexicalConfigHash: string;
  normalizerConfigHash: string;
  textProviderIndexBundleHash: string;
  textModelId: string;
  textModelRevision: string;
  lexicalPackCompetitionAlgorithmHash: string;
  textPackCompetitionAlgorithmHash: string;
  capabilityEntityManifestHash: string;
  packCompetitionPolicyHash: string;
  channels: z.input<typeof PackCompetitionCalibrationInputV2Schema>["channels"];
}): PackCompetitionCalibrationV2 {
  const parsed = PackCompetitionCalibrationInputV2Schema.parse({
    schemaVersion: 2,
    id: input.id ?? "lumi-pack-competition-calibration-v2",
    version: input.version ?? "1.0.0",
    developmentSuiteHash: input.developmentSuiteHash,
    corpusBundleHash: input.corpusBundleHash,
    lexicalConfigHash: input.lexicalConfigHash,
    normalizerConfigHash: input.normalizerConfigHash,
    textProviderIndexBundleHash: input.textProviderIndexBundleHash,
    textModelId: input.textModelId,
    textModelRevision: input.textModelRevision,
    lexicalPackCompetitionAlgorithmHash:
      input.lexicalPackCompetitionAlgorithmHash,
    textPackCompetitionAlgorithmHash:
      input.textPackCompetitionAlgorithmHash,
    capabilityEntityManifestHash: input.capabilityEntityManifestHash,
    packCompetitionPolicyHash: input.packCompetitionPolicyHash,
    channels: input.channels,
  });
  return PackCompetitionCalibrationV2Schema.parse({
    ...parsed,
    configHash: sha256(parsed),
  });
}

export function verifyCapabilityEntityManifestEvidenceV2(
  rawManifest: CapabilityEntityManifestV2,
  input: {
    corpusBundleHash: string;
    objectCoursePacks: readonly {
      objectId: string;
      coursePack: z.input<typeof CoursePackReferenceV2Schema>;
    }[];
  },
) {
  const manifest = CapabilityEntityManifestV2Schema.parse(rawManifest);
  verifyConfigHash(manifest, "capability entity manifest");
  const corpusBundleHash = HashSchema.parse(input.corpusBundleHash);
  if (
    corpusBundleHash !== manifest.corpusBundleHash
  ) {
    throw new Error("capability entity manifest corpus bundle hash mismatch");
  }
  const ownership = new Map<string, z.infer<typeof CoursePackReferenceV2Schema>>();
  for (const rawBinding of input.objectCoursePacks) {
    const objectId = IdSchema.parse(rawBinding.objectId);
    const coursePack = CoursePackReferenceV2Schema.parse(rawBinding.coursePack);
    if (ownership.has(objectId)) {
      throw new Error(`duplicate capability evidence ownership:${objectId}`);
    }
    ownership.set(objectId, coursePack);
  }
  if (manifest.technicalAnchorCoverage) {
    const coverage = verifyCapabilityAnchorCoverageV2(
      manifest.technicalAnchorCoverage,
    );
    if (coverage.corpusBundleHash !== corpusBundleHash) {
      throw new Error(
        "technical anchor coverage corpus bundle hash mismatch",
      );
    }
    const actualCounts = new Map<string, {
      version: string;
      count: number;
    }>();
    for (const coursePack of ownership.values()) {
      const existing = actualCounts.get(coursePack.id);
      if (existing && existing.version !== coursePack.version) {
        throw new Error(
          `technical anchor course pack version drift:${coursePack.id}`,
        );
      }
      actualCounts.set(coursePack.id, {
        version: coursePack.version,
        count: (existing?.count ?? 0) + 1,
      });
    }
    if (
      coverage.coursePacks.length !== actualCounts.size
      || coverage.coursePacks.some(({ coursePack, objectCount }) => {
        const actual = actualCounts.get(coursePack.id);
        return !actual
          || actual.version !== coursePack.version
          || actual.count !== objectCount;
      })
    ) {
      throw new Error(
        "technical anchor coverage course pack ownership mismatch",
      );
    }
  }
  const verifiedBindings = manifest.entities.flatMap((entity) =>
    entity.evidenceObjectIds.map((objectId) => {
      const actualOwner = ownership.get(objectId);
      if (!actualOwner) {
        throw new Error(`capability evidence object missing:${objectId}`);
      }
      if (
        actualOwner.id !== entity.ownerCoursePack.id
        || actualOwner.version !== entity.ownerCoursePack.version
      ) {
        throw new Error(`capability evidence owner mismatch:${objectId}`);
      }
      return {
        entityId: entity.entityId,
        objectId,
        coursePack: actualOwner,
      };
    }));
  return Object.freeze({
    corpusBundleHash,
    manifestHash: manifest.configHash,
    evidenceBindingHash: sha256(verifiedBindings),
    entityCount: manifest.entities.length,
    evidenceObjectCount: verifiedBindings.length,
  });
}

function parseManifest(raw: CapabilityEntityManifestV2) {
  const manifest = CapabilityEntityManifestV2Schema.parse(raw);
  verifyConfigHash(manifest, "capability entity manifest");
  if (manifest.technicalAnchorCoverage) {
    verifyCapabilityAnchorCoverageV2(
      manifest.technicalAnchorCoverage,
    );
  }
  return manifest;
}

function parsePolicy(raw: PackCompetitionPolicyV2) {
  const policy = PackCompetitionPolicyV2Schema.parse(raw);
  verifyConfigHash(policy, "pack competition policy");
  return policy;
}

function parseCalibration(raw: PackCompetitionCalibrationV2) {
  const calibration = PackCompetitionCalibrationV2Schema.parse(raw);
  verifyConfigHash(calibration, "pack competition calibration");
  return calibration;
}

function aliasMatchSpans(
  normalizedQuery: string,
  normalizedAlias: string,
) {
  const spans: { matchStart: number; matchEnd: number }[] = [];
  if (/^[a-z0-9][a-z0-9 ._+/#-]*$/.test(normalizedAlias)) {
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(
      `(^|[^a-z0-9])(${escaped})(?=$|[^a-z0-9])`,
      "gu",
    );
    for (const match of normalizedQuery.matchAll(expression)) {
      const prefixLength = match[1]?.length ?? 0;
      const matchStart = (match.index ?? 0) + prefixLength;
      spans.push({
        matchStart,
        matchEnd: matchStart + normalizedAlias.length,
      });
    }
    return spans;
  }
  let matchStart = normalizedQuery.indexOf(normalizedAlias);
  while (matchStart >= 0) {
    spans.push({
      matchStart,
      matchEnd: matchStart + normalizedAlias.length,
    });
    matchStart = normalizedQuery.indexOf(
      normalizedAlias,
      matchStart + 1,
    );
  }
  return spans;
}

function matchedEntities(
  normalizedText: string,
  manifest: CapabilityEntityManifestV2,
) {
  return manifest.entities
    .flatMap((entity) =>
      entity.aliases
        .flatMap((alias) =>
          aliasMatchSpans(
            normalizedText,
            alias.normalizedText,
          ).map(({ matchStart, matchEnd }) => ({
            entityId: entity.entityId,
            ownerCoursePack: entity.ownerCoursePack,
            alias: alias.normalizedText,
            aliasClassification: alias.classification,
            entityScope: entity.scope,
            matchStart,
            matchEnd,
          }))))
    .sort((left, right) =>
      right.alias.length - left.alias.length
      || compareCodePoints(left.entityId, right.entityId)
      || compareCodePoints(left.alias, right.alias)
      || left.matchStart - right.matchStart);
}

function resolveEntityMatches(
  matched: ReturnType<typeof matchedEntities>,
) {
  const ordered = [...matched].sort((left, right) =>
    left.matchStart - right.matchStart
    || right.matchEnd - left.matchEnd
    || compareCodePoints(left.entityId, right.entityId));
  const components: typeof ordered[] = [];
  for (const item of ordered) {
    const current = components.at(-1);
    const currentEnd = current === undefined
      ? -1
      : Math.max(...current.map(({ matchEnd }) => matchEnd));
    if (!current || item.matchStart >= currentEnd) {
      components.push([item]);
    } else {
      current.push(item);
    }
  }
  const exclusiveByEntity = new Map<
    string,
    (typeof matched)[number]
  >();
  let hasAmbiguousComponent = false;
  for (const component of components) {
    const longestLength = Math.max(
      ...component.map(({ alias }) => alias.length),
    );
    const winners = component.filter(
      ({ alias }) => alias.length === longestLength,
    );
    const winnerEntityIds = new Set(
      winners.map(({ entityId }) => entityId),
    );
    if (
      winnerEntityIds.size === 1
      && winners.every((winner) =>
        winner.entityScope === "COURSE_EXCLUSIVE"
        && winner.aliasClassification === "EXCLUSIVE")
    ) {
      const winner = winners[0]!;
      exclusiveByEntity.set(winner.entityId, winner);
    } else {
      hasAmbiguousComponent = true;
    }
  }
  const exclusiveEntities = [...exclusiveByEntity.values()];
  const exclusiveOwner =
    exclusiveEntities.length > 0
    && exclusiveEntities.every((entity) =>
      sameCoursePack(
        entity.ownerCoursePack,
        exclusiveEntities[0]!.ownerCoursePack,
      ))
      ? exclusiveEntities[0]!
      : null;
  return {
    exclusiveOwner,
    hasAmbiguous:
      hasAmbiguousComponent
      || (exclusiveEntities.length > 0 && exclusiveOwner === null),
  };
}

export function resolveCapabilityEntityMentionsV2(input: {
  normalizedText: string;
  manifest: CapabilityEntityManifestV2;
}) {
  const normalizedText = z.string().min(1).max(500)
    .parse(input.normalizedText);
  if (normalizedText !== normalizeCapabilityEntityTextV2(normalizedText)) {
    throw new Error(
      "capability entity resolution requires deterministically normalized text",
    );
  }
  const manifest = parseManifest(input.manifest);
  const matched = matchedEntities(normalizedText, manifest);
  const resolution = resolveEntityMatches(matched);
  return {
    matchedEntities: matched,
    exclusiveOwner: resolution.exclusiveOwner,
    hasAmbiguous: resolution.hasAmbiguous,
  };
}

function sameCoursePack(
  left: z.infer<typeof CoursePackReferenceV2Schema>,
  right: z.infer<typeof CoursePackReferenceV2Schema>,
) {
  return left.id === right.id && left.version === right.version;
}

function trace(input: {
  decision: z.infer<typeof CapabilityBoundaryDecisionV2Schema>;
  reason: z.infer<typeof CapabilityBoundaryReasonV2Schema>;
  sourceCoursePack: z.infer<typeof CoursePackReferenceV2Schema> | null;
  acceptancePolicyHash: string;
  manifest: CapabilityEntityManifestV2;
  policy: PackCompetitionPolicyV2;
  calibration: PackCompetitionCalibrationV2;
  acceptedBefore: string[];
  matched: ReturnType<typeof matchedEntities>;
  unsupportedTechnicalAnchors: string[];
  diagnostics: PackCompetitionDiagnosticsV2 | null;
}) {
  return CapabilityBoundaryTraceV2Schema.parse({
    schemaVersion: 2,
    decision: input.decision,
    reason: input.reason,
    queryMode: "TEXT_TO_TEXT",
    sourceCoursePack: input.sourceCoursePack,
    acceptancePolicyHash: input.acceptancePolicyHash,
    capabilityEntityManifestHash: input.manifest.configHash,
    packCompetitionPolicyHash: input.policy.configHash,
    packCompetitionCalibrationHash: input.calibration.configHash,
    lexicalPackCompetitionAlgorithmHash:
      input.calibration.lexicalPackCompetitionAlgorithmHash,
    textPackCompetitionAlgorithmHash:
      input.calibration.textPackCompetitionAlgorithmHash,
    acceptedCandidateIdsBefore: input.acceptedBefore,
    acceptedCandidateIdsAfter: input.decision === "REJECT" ? [] : input.acceptedBefore,
    matchedEntities: input.matched,
    unsupportedTechnicalAnchors:
      input.unsupportedTechnicalAnchors,
    diagnostics: input.diagnostics,
  });
}

export function applyCapabilityBoundaryV2(input: {
  queryMode: z.input<typeof RetrievalModeV2Schema>;
  originalText: string | null;
  normalizedText: string | null;
  corpusBundleHash: string;
  lexicalConfigHash: string;
  normalizerConfigHash: string;
  textProviderIndexBundleHash: string;
  textModelId: string;
  textModelRevision: string;
  lexicalPackCompetitionAlgorithmHash: string;
  textPackCompetitionAlgorithmHash: string;
  sourceCoursePack: z.input<typeof CoursePackReferenceV2Schema> | null;
  acceptedCandidateIds: readonly string[];
  degradedLexicalFallback: boolean;
  channelStatuses: {
    LEXICAL: z.input<typeof TextChannelStatusV2Schema>;
    TEXT_VECTOR: z.input<typeof TextChannelStatusV2Schema>;
  };
  acceptancePolicyHash: string;
  diagnostics?: unknown;
  manifest: CapabilityEntityManifestV2;
  policy?: PackCompetitionPolicyV2;
  calibration: PackCompetitionCalibrationV2;
}): {
  acceptedCandidateIds: string[];
  trace: CapabilityBoundaryTraceV2 | null;
} {
  const queryMode = RetrievalModeV2Schema.parse(input.queryMode);
  if (queryMode !== "TEXT_TO_TEXT") {
    return {
      acceptedCandidateIds: [...input.acceptedCandidateIds],
      trace: null,
    };
  }
  const manifest = parseManifest(input.manifest);
  const policy = parsePolicy(input.policy ?? PACK_COMPETITION_POLICY_V2);
  const calibration = parseCalibration(input.calibration);
  const parsedInput = CapabilityBoundaryInputV2Schema.parse({
    queryMode,
    originalText: input.originalText,
    normalizedText: input.normalizedText,
    corpusBundleHash: input.corpusBundleHash,
    lexicalConfigHash: input.lexicalConfigHash,
    normalizerConfigHash: input.normalizerConfigHash,
    textProviderIndexBundleHash: input.textProviderIndexBundleHash,
    textModelId: input.textModelId,
    textModelRevision: input.textModelRevision,
    lexicalPackCompetitionAlgorithmHash:
      input.lexicalPackCompetitionAlgorithmHash,
    textPackCompetitionAlgorithmHash:
      input.textPackCompetitionAlgorithmHash,
    sourceCoursePack: input.sourceCoursePack,
    acceptedCandidateIds: [...input.acceptedCandidateIds],
    degradedLexicalFallback: input.degradedLexicalFallback,
    channelStatuses: input.channelStatuses,
    acceptancePolicyHash: input.acceptancePolicyHash,
  });
  if (
    calibration.capabilityEntityManifestHash !== manifest.configHash
    || calibration.packCompetitionPolicyHash !== policy.configHash
    || calibration.corpusBundleHash !== manifest.corpusBundleHash
    || calibration.lexicalConfigHash !== parsedInput.lexicalConfigHash
    || calibration.normalizerConfigHash !== parsedInput.normalizerConfigHash
    || calibration.textProviderIndexBundleHash
      !== parsedInput.textProviderIndexBundleHash
    || calibration.textModelId !== parsedInput.textModelId
    || calibration.textModelRevision !== parsedInput.textModelRevision
    || calibration.lexicalPackCompetitionAlgorithmHash
      !== parsedInput.lexicalPackCompetitionAlgorithmHash
    || calibration.textPackCompetitionAlgorithmHash
      !== parsedInput.textPackCompetitionAlgorithmHash
  ) {
    throw new Error("pack competition calibration identity mismatch");
  }
  const acceptedBefore = [...parsedInput.acceptedCandidateIds];
  const baseTrace = {
    sourceCoursePack: parsedInput.sourceCoursePack,
    acceptancePolicyHash: parsedInput.acceptancePolicyHash,
    manifest,
    policy,
    calibration,
    acceptedBefore,
    matched: [] as ReturnType<typeof matchedEntities>,
    unsupportedTechnicalAnchors: [] as string[],
    diagnostics: null,
  };
  if (parsedInput.sourceCoursePack === null) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({ ...baseTrace, decision: "SKIP", reason: "SKIPPED_UNSCOPED" }),
    };
  }
  if (parsedInput.normalizedText === null) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({
        ...baseTrace,
        decision: "SKIP",
        reason: "SKIPPED_QUERY_TEXT_MISSING",
      }),
    };
  }
  if (parsedInput.corpusBundleHash !== manifest.corpusBundleHash) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({
        ...baseTrace,
        decision: "SKIP",
        reason: "SKIPPED_CORPUS_IDENTITY_MISMATCH",
      }),
    };
  }
  if (acceptedBefore.length === 0) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({
        ...baseTrace,
        decision: "SKIP",
        reason: "SKIPPED_NO_ACCEPTED_EVIDENCE",
      }),
    };
  }
  if (parsedInput.degradedLexicalFallback) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({
        ...baseTrace,
        decision: "SKIP",
        reason: "SKIPPED_DEGRADED_LEXICAL_FALLBACK",
      }),
    };
  }
  if (
    parsedInput.channelStatuses.LEXICAL !== "SUCCESS"
    || parsedInput.channelStatuses.TEXT_VECTOR !== "SUCCESS"
  ) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({
        ...baseTrace,
        decision: "SKIP",
        reason: "SKIPPED_UNHEALTHY_TEXT_CHANNELS",
      }),
    };
  }

  const matched = matchedEntities(parsedInput.normalizedText, manifest);
  const entityResolution = resolveEntityMatches(matched);
  const exclusiveEntity = entityResolution.exclusiveOwner;
  if (
    exclusiveEntity
    && !sameCoursePack(
      exclusiveEntity.ownerCoursePack,
      parsedInput.sourceCoursePack,
    )
  ) {
    return {
      acceptedCandidateIds: [],
      trace: trace({
        ...baseTrace,
        decision: "REJECT",
        reason: "EXCLUSIVE_ENTITY_FOREIGN_PACK",
        matched,
      }),
    };
  }

  const unsupportedTechnicalAnchors =
    manifest.technicalAnchorCoverage
      ? unsupportedExplicitTechnicalAnchorsV2({
          queryText: parsedInput.originalText!,
          sourceCoursePack: parsedInput.sourceCoursePack,
          coverage: manifest.technicalAnchorCoverage,
        })
      : [];
  if (unsupportedTechnicalAnchors.length > 0) {
    return {
      acceptedCandidateIds: [],
      trace: trace({
        ...baseTrace,
        decision: "REJECT",
        reason: "UNSUPPORTED_TECHNICAL_ANCHOR",
        matched,
        unsupportedTechnicalAnchors,
      }),
    };
  }

  if (exclusiveEntity) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({
        ...baseTrace,
        decision: "ABSTAIN",
        reason: "SCOPED_EXCLUSIVE_ENTITY_PRESENT",
        matched,
      }),
    };
  }

  if (entityResolution.hasAmbiguous) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({
        ...baseTrace,
        decision: "ABSTAIN",
        reason: "AMBIGUOUS_ENTITY_PRESENT",
        matched,
      }),
    };
  }

  if (input.diagnostics === undefined) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({
        ...baseTrace,
        decision: "ABSTAIN",
        reason: "DIAGNOSTICS_MISSING",
        matched,
      }),
    };
  }
  const parsedDiagnostics = PackCompetitionDiagnosticsV2Schema.safeParse(input.diagnostics);
  if (!parsedDiagnostics.success) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({
        ...baseTrace,
        decision: "ABSTAIN",
        reason: "DIAGNOSTICS_INVALID",
        matched,
      }),
    };
  }
  const diagnostics = parsedDiagnostics.data;
  const lexical = diagnostics.LEXICAL;
  const vector = diagnostics.TEXT_VECTOR;
  if (
    !sameCoursePack(lexical.scopedWinner.coursePack, parsedInput.sourceCoursePack)
    || !sameCoursePack(vector.scopedWinner.coursePack, parsedInput.sourceCoursePack)
  ) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({
        ...baseTrace,
        decision: "ABSTAIN",
        reason: "DIAGNOSTICS_INVALID",
        matched,
      }),
    };
  }
  if (!sameCoursePack(lexical.globalWinner.coursePack, vector.globalWinner.coursePack)) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({
        ...baseTrace,
        decision: "ABSTAIN",
        reason: "CHANNEL_PACK_DISAGREEMENT",
        matched,
        diagnostics,
      }),
    };
  }
  if (sameCoursePack(lexical.globalWinner.coursePack, parsedInput.sourceCoursePack)) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({
        ...baseTrace,
        decision: "ABSTAIN",
        reason: "WINNER_IS_SCOPED_PACK",
        matched,
        diagnostics,
      }),
    };
  }
  if (
    lexical.distinctObjectCount
      < calibration.channels.LEXICAL.minimumDistinctObjects
    || vector.distinctObjectCount
      < calibration.channels.TEXT_VECTOR.minimumDistinctObjects
  ) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({
        ...baseTrace,
        decision: "ABSTAIN",
        reason: "INSUFFICIENT_COMPETITION_SAMPLE",
        matched,
        diagnostics,
      }),
    };
  }
  if (
    lexical.foreignPackMargin
      < calibration.channels.LEXICAL.minimumForeignPackMargin
    || vector.foreignPackMargin
      < calibration.channels.TEXT_VECTOR.minimumForeignPackMargin
  ) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({
        ...baseTrace,
        decision: "ABSTAIN",
        reason: "MARGIN_BELOW_THRESHOLD",
        matched,
        diagnostics,
      }),
    };
  }
  if (
    lexical.scopedSufficiency
      >= calibration.channels.LEXICAL.scopedSufficiencyFloor
    || vector.scopedSufficiency
      >= calibration.channels.TEXT_VECTOR.scopedSufficiencyFloor
  ) {
    return {
      acceptedCandidateIds: acceptedBefore,
      trace: trace({
        ...baseTrace,
        decision: "ABSTAIN",
        reason: "SCOPED_SUFFICIENCY_PROTECTED",
        matched,
        diagnostics,
      }),
    };
  }
  return {
    acceptedCandidateIds: [],
    trace: trace({
      ...baseTrace,
      decision: "REJECT",
      reason: "DUAL_CHANNEL_FOREIGN_PACK_MARGIN",
      matched,
      diagnostics,
    }),
  };
}
