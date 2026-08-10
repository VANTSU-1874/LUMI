import { z } from "zod";

import { KnowledgeAuthoritySchema } from "./retrieve";

const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,127}$/;
const VERSION_PATTERN = /^[a-z0-9][a-z0-9.-]{0,79}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

const StableIdSchema = z.string().regex(
  STABLE_ID_PATTERN,
  "expected a stable lowercase identifier",
);
const VersionSchema = z.string().regex(
  VERSION_PATTERN,
  "expected a fixed lowercase version identifier",
);
const HashSchema = z.string().regex(HASH_PATTERN, "expected a lowercase sha256 hash");

export const CourseEvidenceAvailabilityV1Schema = z.enum([
  "AVAILABLE",
  "DEGRADED",
  "UNAVAILABLE",
  "SKIPPED",
]);

export const CourseEvidenceDegradedReasonV1Schema = z.enum([
  "EMPTY_RESULT",
  "INDEX_VERSION_MISMATCH",
  "TEXT_PROVIDER_UNAVAILABLE",
  "OPTIONAL_VISUAL_UNAVAILABLE",
  "EXTERNAL_VISUAL_ENCODER_UNAVAILABLE",
  "EXTERNAL_VECTOR_STORE_UNAVAILABLE",
]);

export const CourseEvidenceSourceRightsV1Schema = z.enum([
  "COURSE_INTERNAL",
  "PUBLIC_REFERENCE",
  "ANONYMIZED_EDUCATIONAL_USE",
  "UNVERIFIED",
]);

export const CourseEvidenceSourceStatusV1Schema = z.enum([
  "ACTIVE",
  "RESTRICTED",
  "WITHDRAWN",
]);

export const CourseEvidenceSourceV1Schema = z
  .object({
    sourceId: StableIdSchema,
    authority: KnowledgeAuthoritySchema,
    rights: CourseEvidenceSourceRightsV1Schema,
    status: CourseEvidenceSourceStatusV1Schema,
    verifiedDate: z.iso.date(),
  })
  .strict();

export const CourseEvidenceCandidateV1Schema = z
  .object({
    candidateStableId: StableIdSchema,
    evidenceId: StableIdSchema,
    objectId: StableIdSchema,
    source: CourseEvidenceSourceV1Schema,
    confidence: z.number().finite().min(0).max(1),
    disposition: z.enum(["SELECTED", "REJECTED_SIMILAR"]),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (
      candidate.disposition === "SELECTED"
      && candidate.source.status !== "ACTIVE"
    ) {
      context.addIssue({
        code: "custom",
        message: "selected evidence requires an active source",
        path: ["source", "status"],
      });
    }
  });

const OptionalDependencyV1Schema = z
  .object({
    capability: z.enum([
      "VISUAL_RETRIEVAL",
      "EXTERNAL_VISUAL_ENCODER",
      "EXTERNAL_VECTOR_STORE",
    ]),
    availability: CourseEvidenceAvailabilityV1Schema,
    degradedReason: CourseEvidenceDegradedReasonV1Schema.nullable(),
  })
  .strict()
  .superRefine((dependency, context) => {
    if (
      (dependency.availability === "AVAILABLE")
      !== (dependency.degradedReason === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "only available optional dependencies omit degradedReason",
        path: ["degradedReason"],
      });
    }
  });

export const CourseEvidenceV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    caseId: StableIdSchema,
    caseKind: z.enum([
      "HIT",
      "NO_ANSWER",
      "SIMILAR_DISTRACTOR",
      "SOURCE_TRACE",
    ]),
    channel: z.literal("course"),
    queryKind: z.literal("text"),
    collectionId: z.literal("course-v2-text"),
    namespaceId: z.enum([
      "general-design",
      "digital-interaction",
      "book-design",
      "layout-design",
      "brand-vi-design",
    ]),
    providerId: z.literal("lumi-course-text-v2"),
    providerVersion: VersionSchema,
    modelVersion: VersionSchema,
    indexVersion: VersionSchema,
    sourceManifestVersion: VersionSchema,
    availability: CourseEvidenceAvailabilityV1Schema,
    degradedReason: CourseEvidenceDegradedReasonV1Schema.nullable(),
    candidateCount: z.number().int().nonnegative().max(20),
    candidates: z.array(CourseEvidenceCandidateV1Schema).max(20),
    selectedEvidenceIds: z.array(StableIdSchema).max(20),
    optionalDependencies: z.array(OptionalDependencyV1Schema).max(3),
    latencyBucket: z.enum(["NOT_RECORDED", "LT_250_MS", "LT_1_S", "GTE_1_S"]),
    costBucket: z.enum(["NOT_APPLICABLE", "FREE_LOCAL", "METERED"]),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.candidateCount !== evidence.candidates.length) {
      context.addIssue({
        code: "custom",
        message: "candidateCount must equal the sealed candidate list length",
        path: ["candidateCount"],
      });
    }

    const uniqueFields = [
      ["candidateStableId", evidence.candidates.map(({ candidateStableId }) => candidateStableId)],
      ["evidenceId", evidence.candidates.map(({ evidenceId }) => evidenceId)],
    ] as const;
    for (const [field, values] of uniqueFields) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: `${field} values must be unique per case`,
          path: ["candidates"],
        });
      }
    }

    const selected = evidence.candidates
      .filter(({ disposition }) => disposition === "SELECTED")
      .map(({ evidenceId }) => evidenceId);
    if (
      selected.length !== evidence.selectedEvidenceIds.length
      || selected.some((id, index) => id !== evidence.selectedEvidenceIds[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "selectedEvidenceIds must exactly bind selected candidates",
        path: ["selectedEvidenceIds"],
      });
    }

    const dependencyKinds = evidence.optionalDependencies
      .map(({ capability }) => capability);
    if (new Set(dependencyKinds).size !== dependencyKinds.length) {
      context.addIssue({
        code: "custom",
        message: "optional dependency capabilities must be unique",
        path: ["optionalDependencies"],
      });
    }

    if (evidence.availability === "AVAILABLE") {
      if (evidence.candidateCount === 0) {
        if (evidence.degradedReason !== "EMPTY_RESULT") {
          context.addIssue({
            code: "custom",
            message: "an available empty result requires EMPTY_RESULT",
            path: ["degradedReason"],
          });
        }
      } else if (
        evidence.degradedReason !== null
        || evidence.selectedEvidenceIds.length === 0
      ) {
        context.addIssue({
          code: "custom",
          message: "an available hit requires selected evidence and no degradation",
          path: ["availability"],
        });
      }
    } else {
      if (evidence.degradedReason === null) {
        context.addIssue({
          code: "custom",
          message: "non-available evidence requires degradedReason",
          path: ["degradedReason"],
        });
      }
      if (
        (evidence.availability === "UNAVAILABLE" || evidence.availability === "SKIPPED")
        && (evidence.candidateCount > 0 || evidence.selectedEvidenceIds.length > 0)
      ) {
        context.addIssue({
          code: "custom",
          message: "unavailable or skipped evidence cannot claim candidates",
          path: ["candidates"],
        });
      }
    }
  });

export const CourseEvidenceFixtureFileV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    fixtureStatus: z.literal("FIXTURE_CONTRACT_READY"),
    sourceManifestVersion: VersionSchema,
    cases: z.array(CourseEvidenceV1Schema).length(4),
  })
  .strict()
  .superRefine((fixture, context) => {
    const kinds = fixture.cases.map(({ caseKind }) => caseKind);
    const requiredKinds = [
      "HIT",
      "NO_ANSWER",
      "SIMILAR_DISTRACTOR",
      "SOURCE_TRACE",
    ];
    if (
      new Set(kinds).size !== requiredKinds.length
      || requiredKinds.some((kind) => !kinds.includes(kind as typeof kinds[number]))
    ) {
      context.addIssue({
        code: "custom",
        message: "fixture must contain exactly one case of each required kind",
        path: ["cases"],
      });
    }
    if (fixture.cases.some(
      ({ sourceManifestVersion }) => sourceManifestVersion !== fixture.sourceManifestVersion,
    )) {
      context.addIssue({
        code: "custom",
        message: "every case must bind the sealed source manifest version",
        path: ["sourceManifestVersion"],
      });
    }
  });

export const CourseEvidenceFixtureManifestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    fixtureStatus: z.literal("FIXTURE_CONTRACT_READY"),
    files: z
      .array(z
        .object({
          path: z.literal("course-evidence-v1.json"),
          bytes: z.number().int().positive(),
          sha256: HashSchema,
        })
        .strict())
      .length(1),
  })
  .strict();

export type CourseEvidenceV1 = z.infer<typeof CourseEvidenceV1Schema>;
export type CourseEvidenceFixtureFileV1 = z.infer<typeof CourseEvidenceFixtureFileV1Schema>;
export type CourseEvidenceFixtureManifestV1 = z.infer<
  typeof CourseEvidenceFixtureManifestV1Schema
>;
