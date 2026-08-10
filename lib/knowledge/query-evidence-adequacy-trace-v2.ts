import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  CoursePackReferenceV2Schema,
  sha256StableJsonV2,
} from "./knowledge-object-v2";
import { FusedCandidateV2Schema } from "./rank-fusion-v2";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HashSchema = z.string().regex(HASH_PATTERN);
const IdSchema = z.string().regex(ID_PATTERN);

export const QUERY_EVIDENCE_ADEQUACY_TRACE_LIMITS_V2 =
  Object.freeze({
    primary: 5,
    visibleCharacters: 12_000,
    maxObligations: 32,
  } as const);

export const TextualNodeKindV2Schema = z.enum([
  "DOCUMENT",
  "SECTION",
  "TEXT",
  "TABLE",
]);

export const ActionClassV2Schema = z.enum([
  "CREATE",
  "CONFIGURE",
  "CONNECT",
  "INSPECT",
  "TRANSFER",
  "COMPUTE",
  "ORDER",
  "AUTHOR",
]);

export type ActionClassV2 = z.infer<typeof ActionClassV2Schema>;

export const QueryEvidenceAdequacyIdentityV2Schema = z
  .object({
    corpusBundleHash: HashSchema,
    queryEvidenceAdequacyPolicyHash: HashSchema,
    queryEvidenceFeatureAlgorithmHash: HashSchema,
    queryAnchorCorpusStatsHash: HashSchema,
    primaryEvidenceBindingAlgorithmHash: HashSchema,
    normalizerConfigHash: HashSchema,
    rrfConfigHash: HashSchema,
    acceptancePolicyHash: HashSchema,
    objectConsensusConfigHash: HashSchema,
    lexicalConfigHash: HashSchema,
    textProviderIndexBundleHash: HashSchema,
    textModelId: z.string().trim().min(1).max(300),
    textModelRevision: z.string().trim().min(1).max(300),
  })
  .strict();

export type QueryEvidenceAdequacyIdentityV2 = z.infer<
  typeof QueryEvidenceAdequacyIdentityV2Schema
>;

export const QueryEvidenceObligationKindV2Schema = z.enum([
  "LATIN_TECHNICAL",
  "QUOTED_TERM",
  "OPERATION_OBJECT",
]);

export const QueryEvidenceObligationV2Schema = z
  .object({
    kind: QueryEvidenceObligationKindV2Schema,
    normalizedText: z.string().min(1).max(80),
    start: z.number().int().nonnegative().max(500),
    end: z.number().int().positive().max(500),
    actionClass: ActionClassV2Schema.nullable(),
    objectDf: z.number().int().nonnegative().max(1_000_000).nullable(),
    supportedPrimaryNodeIds: z
      .array(IdSchema)
      .max(QUERY_EVIDENCE_ADEQUACY_TRACE_LIMITS_V2.primary),
  })
  .strict()
  .superRefine((obligation, context) => {
    const operation = obligation.kind === "OPERATION_OBJECT";
    if (
      operation
        !== (
          obligation.actionClass !== null
          && obligation.objectDf !== null
        )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "only operation-object obligations require an action class and object DF",
      });
    }
    if (obligation.end <= obligation.start) {
      context.addIssue({
        code: "custom",
        message: "obligation span must be non-empty",
      });
    }
    const sorted = [...obligation.supportedPrimaryNodeIds].sort();
    if (
      new Set(obligation.supportedPrimaryNodeIds).size
        !== obligation.supportedPrimaryNodeIds.length
      || obligation.supportedPrimaryNodeIds.some(
        (nodeId, index) => nodeId !== sorted[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "supported primary node ids must be unique and sorted",
      });
    }
  });

export const QueryEvidencePrimaryBindingV2Schema = z
  .object({
    seedCandidateId: IdSchema,
    objectId: IdSchema,
    nodeId: IdSchema,
    nodeKind: TextualNodeKindV2Schema,
    contentHash: HashSchema,
    sourceId: IdSchema,
    sourceCoursePack: CoursePackReferenceV2Schema,
    canonicalCharacters: z.number().int().nonnegative().max(32_000),
    visibleCharacters: z.number().int().nonnegative().max(
      QUERY_EVIDENCE_ADEQUACY_TRACE_LIMITS_V2.visibleCharacters,
    ),
    visibleTextHash: HashSchema,
  })
  .strict();

export const QueryEvidenceRetrievalAttestationV2Schema = z
  .object({
    lexicalResultHash: HashSchema,
    textVectorResultHash: HashSchema,
    objectRankingHash: HashSchema,
    objectConsensusTraceHash: HashSchema,
    finalSeedsHash: HashSchema,
  })
  .strict();

export type QueryEvidenceRetrievalAttestationV2 = z.infer<
  typeof QueryEvidenceRetrievalAttestationV2Schema
>;

export const QueryEvidenceAdequacyTraceV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    decision: z.enum(["KEEP", "EMPTY"]),
    reason: z.enum([
      "NO_HIGH_CONFIDENCE_OBLIGATION",
      "AMBIGUOUS_EXTRACTION",
      "ALL_OBLIGATIONS_SUPPORTED",
      "UNSUPPORTED_EXPLICIT_OBLIGATION",
    ]),
    sourceCoursePack: CoursePackReferenceV2Schema,
    normalizedQueryHash: HashSchema,
    identity: QueryEvidenceAdequacyIdentityV2Schema,
    retrievalAttestation: QueryEvidenceRetrievalAttestationV2Schema,
    preGateSeeds: z
      .array(FusedCandidateV2Schema)
      .min(1)
      .max(QUERY_EVIDENCE_ADEQUACY_TRACE_LIMITS_V2.primary),
    postGateSeeds: z
      .array(FusedCandidateV2Schema)
      .max(QUERY_EVIDENCE_ADEQUACY_TRACE_LIMITS_V2.primary),
    preGateSeedsHash: HashSchema,
    postGateSeedsHash: HashSchema,
    primaryBindings: z
      .array(QueryEvidencePrimaryBindingV2Schema)
      .min(1)
      .max(QUERY_EVIDENCE_ADEQUACY_TRACE_LIMITS_V2.primary),
    obligations: z
      .array(QueryEvidenceObligationV2Schema)
      .max(QUERY_EVIDENCE_ADEQUACY_TRACE_LIMITS_V2.maxObligations),
    ambiguousExtraction: z.boolean(),
    extractionOverflow: z.boolean(),
    unsupportedObligationCount: z
      .number()
      .int()
      .nonnegative()
      .max(QUERY_EVIDENCE_ADEQUACY_TRACE_LIMITS_V2.maxObligations),
  })
  .strict()
  .superRefine((trace, context) => {
    if (
      trace.preGateSeedsHash
        !== sha256StableJsonV2(trace.preGateSeeds)
      || trace.postGateSeedsHash
        !== sha256StableJsonV2(trace.postGateSeeds)
      || trace.retrievalAttestation.finalSeedsHash
        !== trace.preGateSeedsHash
    ) {
      context.addIssue({
        code: "custom",
        message:
          "adequacy seed hashes must be recomputed from complete snapshots",
      });
    }
    const keep = trace.decision === "KEEP";
    if (
      (
        keep
        && !isDeepStrictEqual(
          trace.preGateSeeds,
          trace.postGateSeeds,
        )
      )
      || (!keep && trace.postGateSeeds.length !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "adequacy may only keep all seeds unchanged or clear all seeds",
      });
    }
    const expectedReason = trace.ambiguousExtraction
      ? "AMBIGUOUS_EXTRACTION"
      : trace.obligations.length === 0
        ? "NO_HIGH_CONFIDENCE_OBLIGATION"
        : trace.unsupportedObligationCount > 0
          ? "UNSUPPORTED_EXPLICIT_OBLIGATION"
          : "ALL_OBLIGATIONS_SUPPORTED";
    if (
      trace.reason !== expectedReason
      || keep
        !== (expectedReason !== "UNSUPPORTED_EXPLICIT_OBLIGATION")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "adequacy decision and reason must match observed obligations",
      });
    }
    const unsupported = trace.obligations.filter(
      ({ supportedPrimaryNodeIds }) =>
        supportedPrimaryNodeIds.length === 0,
    ).length;
    if (trace.unsupportedObligationCount !== unsupported) {
      context.addIssue({
        code: "custom",
        message:
          "unsupported obligation count must match obligation evidence",
      });
    }
    const seedIds = trace.preGateSeeds.map(
      ({ candidateId }) => candidateId,
    );
    const bindingSeedIds = trace.primaryBindings.map(
      ({ seedCandidateId }) => seedCandidateId,
    );
    if (!isDeepStrictEqual(seedIds, bindingSeedIds)) {
      context.addIssue({
        code: "custom",
        message:
          "primary bindings must follow the exact pre-gate seed order",
      });
    }
  });

export type QueryEvidenceAdequacyTraceV2 = z.infer<
  typeof QueryEvidenceAdequacyTraceV2Schema
>;
