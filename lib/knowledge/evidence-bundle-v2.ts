import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  CapabilityBoundaryTraceV2Schema,
  type CapabilityBoundaryTraceV2,
} from "./capability-boundary-v2";
import {
  CoursePackReferenceV2Schema,
  sha256StableJsonV2,
} from "./knowledge-object-v2";
import {
  AcceptanceTraceV2Schema,
  FusedCandidateV2Schema,
  RetrievalChannelV2Schema,
  type AcceptanceTraceV2,
  type FusedCandidateV2,
} from "./rank-fusion-v2";
import {
  ObjectConsensusTraceV2Schema,
  type ObjectConsensusTraceV2,
} from "./object-candidate-v2";
import {
  QueryEvidenceAdequacyTraceV2Schema,
  type QueryEvidenceAdequacyTraceV2,
} from "./query-evidence-adequacy-trace-v2";
import { RetrievalQueryV2Schema, type RetrievalQueryV2 } from "./retrieval-query-v2";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IdSchema = z.string().regex(ID_PATTERN, "expected a stable lowercase identifier");
const HashSchema = z.string().regex(HASH_PATTERN, "expected a lowercase sha256 hash");
const ImmutableRevisionSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (value) => !new Set(["latest", "main", "master", "head", "stable", "current"])
      .has(value.toLowerCase()),
    "model revision must be immutable",
  );
const CONTROLLED_ROOT_SOURCE_PATHS = new Set([
  "Product-Spec.md",
  "附件2：参赛资料附件1-4.docx",
]);

const EvidenceLocalDocumentPathSchema = z
  .string()
  .max(500)
  .refine((value) => {
    if (
      value !== value.trim()
      || value.includes("\\")
      || value.startsWith("/")
      || /^[A-Za-z]:/.test(value)
      || /[\u0000-\u001f\u007f<>:"|?*]/.test(value)
      || (
        !/^(?:data\/knowledge|data\/courses|docs\/course-packs)\//.test(value)
        && !CONTROLLED_ROOT_SOURCE_PATHS.has(value)
      )
    ) return false;
    return value.split("/").every((segment) =>
      segment.length > 0
      && segment !== "."
      && segment !== ".."
      && !/[ .]$/.test(segment));
  }, "source path must be a controlled POSIX workspace-relative path");

export const EVIDENCE_LIMITS_V2 = Object.freeze({
  primary: 5,
  nodes: 12,
  parents: 3,
  siblings: 6,
  assets: 5,
  regions: 5,
  excerptCharacters: 12_000,
  jsonBytes: 64 * 1_024,
} as const);

const EvidenceChannelIdentityV2Schema = z
  .object({
    activeIndexBundleHash: HashSchema,
    providerIndexBundleHash: HashSchema.nullable(),
    indexVersionId: IdSchema,
    modelId: z.string().trim().min(1).max(300).nullable(),
    modelRevision: ImmutableRevisionSchema.nullable(),
    configHash: HashSchema,
    payloadHashes: z.array(HashSchema).min(1).max(20),
  })
  .strict();

export const EvidenceChannelV2Schema = z
  .object({
    channel: RetrievalChannelV2Schema,
    status: z.enum(["SUCCESS", "EMPTY", "UNAVAILABLE", "TIMEOUT", "ERROR", "SKIPPED"]),
    reason: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable(),
    corpusBundleHash: HashSchema,
    identity: EvidenceChannelIdentityV2Schema.nullable(),
    hitCount: z.number().int().nonnegative().max(20),
    timingMs: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((channel, context) => {
    const evaluated = channel.status === "SUCCESS" || channel.status === "EMPTY";
    if (evaluated !== (channel.reason === null)) {
      context.addIssue({
        code: "custom",
        message: "only failed or skipped channels require a reason",
        path: ["reason"],
      });
    }
    if (channel.status === "SUCCESS" !== (channel.hitCount > 0)) {
      context.addIssue({
        code: "custom",
        message: "successful channels require hits and only successful channels may contain hits",
        path: ["hitCount"],
      });
    }
    if (evaluated && channel.identity === null) {
      context.addIssue({
        code: "custom",
        message: "evaluated channels require immutable identity",
        path: ["identity"],
      });
    }
    if (channel.identity) {
      const vector = channel.channel !== "LEXICAL";
      if (
        new Set(channel.identity.payloadHashes).size
        !== channel.identity.payloadHashes.length
      ) {
        context.addIssue({
          code: "custom",
          message: "channel payload hashes must be unique",
          path: ["identity", "payloadHashes"],
        });
      }
      if (
        (channel.identity.modelId === null)
        !== (channel.identity.modelRevision === null)
      ) {
        context.addIssue({
          code: "custom",
          message: "model id and revision must be declared together",
          path: ["identity"],
        });
      }
      if (vector !== (channel.identity.providerIndexBundleHash !== null)) {
        context.addIssue({
          code: "custom",
          message: "vector channel identities require a provider index bundle hash",
          path: ["identity", "providerIndexBundleHash"],
        });
      }
      if (
        vector !== (
          channel.identity.modelId !== null
          && channel.identity.modelRevision !== null
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "vector channel identities require an immutable model identity",
          path: ["identity"],
        });
      }
    }
  });

export const EvidencePrimaryV2Schema = FusedCandidateV2Schema;

export const EvidenceNodeV2Schema = z
  .object({
    nodeId: IdSchema,
    objectId: IdSchema,
    kind: z.enum(["DOCUMENT", "SECTION", "TEXT", "IMAGE", "TABLE", "REGION"]),
    relation: z.enum(["PRIMARY", "PARENT", "SIBLING"]),
    seedCandidateId: IdSchema,
    parentNodeId: IdSchema.nullable(),
    sourceId: IdSchema,
    sourceCoursePack: CoursePackReferenceV2Schema,
    excerpt: z.string().max(EVIDENCE_LIMITS_V2.excerptCharacters).nullable(),
    assetId: IdSchema.nullable(),
  })
  .strict();

export const EvidenceAssetV2Schema = z
  .object({
    assetId: IdSchema,
    objectId: IdSchema,
    sha256: HashSchema,
    mimeType: z.literal("image/png"),
    dimensions: z
      .object({
        widthPx: z.number().int().positive(),
        heightPx: z.number().int().positive(),
      })
      .strict(),
    retrieval: z
      .object({
        channel: z.enum(["VISUAL_VECTOR", "CAPTION_LEXICAL"]),
        rank: z.number().int().min(1).max(20),
        representationId: IdSchema.nullable(),
      })
      .strict()
      .superRefine((retrieval, context) => {
        if (
          (retrieval.channel === "VISUAL_VECTOR") !== (retrieval.representationId !== null)
        ) {
          context.addIssue({
            code: "custom",
            message: "visual evidence assets require an immutable representation id",
            path: ["representationId"],
          });
        }
      })
      .optional(),
  })
  .strict();

export const EvidenceRegionV2Schema = z
  .object({
    regionId: IdSchema,
    imageNodeId: IdSchema,
    regionNodeId: IdSchema.nullable(),
    objectId: IdSchema,
    assetId: IdSchema,
    bbox: z
      .object({
        coordinateSpace: z.literal("NORMALIZED"),
        x: z.number().finite().min(0).max(1),
        y: z.number().finite().min(0).max(1),
        width: z.number().finite().gt(0).max(1),
        height: z.number().finite().gt(0).max(1),
      })
      .strict()
      .superRefine((bbox, context) => {
        if (bbox.x + bbox.width > 1 || bbox.y + bbox.height > 1) {
          context.addIssue({
            code: "custom",
            message: "evidence region must stay inside the image",
          });
        }
      }),
    origin: z.enum(["INDEXED_REGION", "PATCH_MATCH", "CORPUS_REGION"]),
  })
  .strict();

const SourceLocatorV2Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("LOCAL_DOCUMENT"),
      path: EvidenceLocalDocumentPathSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("URL"),
      url: z.url().refine((value) => {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      }),
    })
    .strict(),
]);

export const EvidenceSourceV2Schema = z
  .object({
    sourceId: IdSchema,
    objectId: IdSchema,
    authority: z.enum(["OFFICIAL", "COURSE_DESIGN", "TEACHER_EXPERIENCE", "ANONYMIZED_CASE"]),
    verifiedDate: z.iso.date(),
    scope: z.string().trim().min(1).max(1_000),
    locators: z.array(SourceLocatorV2Schema).min(1).max(5),
  })
  .strict();

export const EvidenceExpansionV2Schema = z
  .object({
    nodes: z.array(EvidenceNodeV2Schema).max(100),
    assets: z.array(EvidenceAssetV2Schema).max(100),
    regions: z.array(EvidenceRegionV2Schema).max(100),
    sources: z.array(EvidenceSourceV2Schema).max(100),
  })
  .strict();

export const EvidenceProvenanceV2Schema = z
  .object({
    corpusBundleHash: HashSchema,
    activeIndexBundleHash: HashSchema,
    relationConfigHash: HashSchema,
    normalizerConfigHash: HashSchema,
    rrfConfigHash: HashSchema,
    acceptancePolicyHash: HashSchema,
    capabilityEntityManifestHash: HashSchema.optional(),
    packCompetitionPolicyHash: HashSchema.optional(),
    packCompetitionCalibrationHash: HashSchema.optional(),
    lexicalPackCompetitionAlgorithmHash: HashSchema.optional(),
    textPackCompetitionAlgorithmHash: HashSchema.optional(),
    queryEvidenceAdequacyPolicyHash: HashSchema.optional(),
    queryEvidenceFeatureAlgorithmHash: HashSchema.optional(),
    queryAnchorCorpusStatsHash: HashSchema.optional(),
    primaryEvidenceBindingAlgorithmHash: HashSchema.optional(),
    graphExpansion: z.literal("POST_FUSION"),
    externalVerification: z
      .object({
        required: z.boolean(),
        claimKinds: z
          .array(z.enum([
            "AUTHORIZATION",
            "PRICE",
            "OWNERSHIP",
            "EXAM_SCHEDULE",
            "RESULT_GUARANTEE",
            "CURRENT_STATUS",
            "REGULATION",
          ]))
          .max(7),
        authorized: z.boolean(),
        matchedSourceIds: z.array(IdSchema).max(20),
        matchedSources: z.array(z
          .object({
            sourceId: IdSchema,
            verifiedDate: z.iso.date(),
          })
          .strict()).max(20),
        reason: z.enum(["NOT_REQUIRED", "AUTHORITATIVE_SOURCE_FOUND", "EXTERNAL_VERIFICATION_REQUIRED"]),
      })
      .strict(),
    captionFallback: EvidenceChannelV2Schema.nullable().optional(),
    fallbackTriggers: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/)).max(12),
    capabilitiesLost: z
      .array(z.enum([
        "LEXICAL",
        "TEXT_VECTOR",
        "VISUAL_VECTOR",
        "ASSET",
        "REGION",
        "TEXT_EVIDENCE",
        "GRAPH_CONTEXT",
      ]))
      .max(7),
  })
  .strict();

const EvidenceLimitsV2Schema = z
  .object({
    primary: z.literal(EVIDENCE_LIMITS_V2.primary),
    nodes: z.literal(EVIDENCE_LIMITS_V2.nodes),
    parents: z.literal(EVIDENCE_LIMITS_V2.parents),
    siblings: z.literal(EVIDENCE_LIMITS_V2.siblings),
    assets: z.literal(EVIDENCE_LIMITS_V2.assets),
    regions: z.literal(EVIDENCE_LIMITS_V2.regions),
    excerptCharacters: z.literal(EVIDENCE_LIMITS_V2.excerptCharacters),
    jsonBytes: z.literal(EVIDENCE_LIMITS_V2.jsonBytes),
  })
  .strict();

const EvidenceTimingV2Schema = z
  .object({
    retrievalMs: z.number().finite().nonnegative(),
    expansionMs: z.number().finite().nonnegative(),
    adequacyMs: z.number().finite().nonnegative().optional(),
    totalMs: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((timing, context) => {
    if (
      timing.totalMs + Number.EPSILON
        < timing.retrievalMs
          + timing.expansionMs
          + (timing.adequacyMs ?? 0)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "total evidence time cannot be below retrieval plus expansion and adequacy time",
      });
    }
  });

const EvidenceLayerV2Schema = z
  .object({
    primary: z.array(EvidencePrimaryV2Schema).max(EVIDENCE_LIMITS_V2.primary),
    nodes: z.array(EvidenceNodeV2Schema).max(EVIDENCE_LIMITS_V2.nodes),
    assets: z.array(EvidenceAssetV2Schema).max(EVIDENCE_LIMITS_V2.assets),
    regions: z.array(EvidenceRegionV2Schema).max(EVIDENCE_LIMITS_V2.regions),
    acceptance: AcceptanceTraceV2Schema,
    boundary: CapabilityBoundaryTraceV2Schema.optional(),
    objectConsensus: ObjectConsensusTraceV2Schema.optional(),
    queryEvidenceAdequacy:
      QueryEvidenceAdequacyTraceV2Schema.optional(),
  })
  .strict();

export const EvidenceBundleV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    bundleId: IdSchema,
    status: z.enum(["SUCCESS", "DEGRADED", "EMPTY", "UNSUPPORTED", "TIMEOUT", "ERROR"]),
    query: RetrievalQueryV2Schema,
    channels: z.array(EvidenceChannelV2Schema).length(3),
    evidence: EvidenceLayerV2Schema,
    sources: z.array(EvidenceSourceV2Schema).max(5),
    provenance: EvidenceProvenanceV2Schema,
    limits: EvidenceLimitsV2Schema,
    timing: EvidenceTimingV2Schema,
  })
  .strict()
  .superRefine((bundle, context) => {
    const channelNames = bundle.channels.map(({ channel }) => channel);
    if (new Set(channelNames).size !== channelNames.length) {
      context.addIssue({ code: "custom", message: "evidence channels must be unique" });
    }
    if (bundle.channels.some(({ corpusBundleHash }) =>
      corpusBundleHash !== bundle.provenance.corpusBundleHash)) {
      context.addIssue({
        code: "custom",
        message: "every channel must bind the evidence corpus hash",
        path: ["channels"],
      });
    }
    const evaluatedActiveIndexes = bundle.channels.flatMap(({ identity }) =>
      identity ? [identity.activeIndexBundleHash] : []);
    if (
      evaluatedActiveIndexes.some((hash) =>
        hash !== bundle.provenance.activeIndexBundleHash)
    ) {
      context.addIssue({
        code: "custom",
        message: "every evaluated channel must bind the active index generation",
        path: ["channels"],
      });
    }
    if (bundle.query.scope.corpusBundleHash !== bundle.provenance.corpusBundleHash) {
      context.addIssue({
        code: "custom",
        message: "query and evidence provenance must bind the same corpus",
        path: ["provenance", "corpusBundleHash"],
      });
    }
    const boundary = bundle.evidence.boundary;
    const objectConsensus = bundle.evidence.objectConsensus;
    const queryEvidenceAdequacy =
      bundle.evidence.queryEvidenceAdequacy;
    const adequacyIdentityHashes = [
      bundle.provenance.queryEvidenceAdequacyPolicyHash,
      bundle.provenance.queryEvidenceFeatureAlgorithmHash,
      bundle.provenance.queryAnchorCorpusStatsHash,
      bundle.provenance.primaryEvidenceBindingAlgorithmHash,
    ];
    const declaredAdequacyIdentityCount =
      adequacyIdentityHashes.filter(
        (value) => value !== undefined,
      ).length;
    const adequacyTimingDeclared =
      bundle.timing.adequacyMs !== undefined;
    if (
      queryEvidenceAdequacy
        ? (
            declaredAdequacyIdentityCount
              !== adequacyIdentityHashes.length
            || !adequacyTimingDeclared
          )
        : (
            declaredAdequacyIdentityCount !== 0
            || adequacyTimingDeclared
          )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "adequacy trace, provenance identities, and timing must be declared together",
        path: ["evidence", "queryEvidenceAdequacy"],
      });
    }
    if (queryEvidenceAdequacy) {
      const identity = queryEvidenceAdequacy.identity;
      const sourceCoursePack =
        bundle.query.scope.sourceCoursePack;
      const lexical = bundle.channels.find(
        ({ channel }) => channel === "LEXICAL",
      );
      const textVector = bundle.channels.find(
        ({ channel }) => channel === "TEXT_VECTOR",
      );
      const identityMismatch =
        sourceCoursePack === null
        || !isDeepStrictEqual(
          queryEvidenceAdequacy.sourceCoursePack,
          sourceCoursePack,
        )
        || identity.corpusBundleHash
          !== bundle.provenance.corpusBundleHash
        || identity.queryEvidenceAdequacyPolicyHash
          !== bundle.provenance.queryEvidenceAdequacyPolicyHash
        || identity.queryEvidenceFeatureAlgorithmHash
          !== bundle.provenance.queryEvidenceFeatureAlgorithmHash
        || identity.queryAnchorCorpusStatsHash
          !== bundle.provenance.queryAnchorCorpusStatsHash
        || identity.primaryEvidenceBindingAlgorithmHash
          !== bundle.provenance.primaryEvidenceBindingAlgorithmHash
        || identity.normalizerConfigHash
          !== bundle.provenance.normalizerConfigHash
        || identity.rrfConfigHash
          !== bundle.provenance.rrfConfigHash
        || identity.acceptancePolicyHash
          !== bundle.provenance.acceptancePolicyHash
        || identity.objectConsensusConfigHash
          !== objectConsensus?.configHash
        || identity.lexicalConfigHash
          !== lexical?.identity?.configHash
        || identity.textProviderIndexBundleHash
          !== textVector?.identity?.providerIndexBundleHash
        || identity.textModelId
          !== textVector?.identity?.modelId
        || identity.textModelRevision
          !== textVector?.identity?.modelRevision;
      if (identityMismatch) {
        context.addIssue({
          code: "custom",
          message:
            "adequacy trace must bind the active query, corpus, ranking, and provider identities",
          path: ["evidence", "queryEvidenceAdequacy"],
        });
      }
      if (
        !objectConsensus
        || queryEvidenceAdequacy.retrievalAttestation
          .objectRankingHash
          !== sha256StableJsonV2(objectConsensus.objectRanking)
        || queryEvidenceAdequacy.retrievalAttestation
          .objectConsensusTraceHash
          !== sha256StableJsonV2(objectConsensus)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "adequacy retrieval attestation must bind the retained object consensus trace",
          path: [
            "evidence",
            "queryEvidenceAdequacy",
            "retrievalAttestation",
          ],
        });
      }
      const emptyDecision =
        queryEvidenceAdequacy.decision === "EMPTY";
      const evidenceEmpty =
        bundle.evidence.primary.length === 0
        && bundle.evidence.nodes.length === 0
        && bundle.evidence.assets.length === 0
        && bundle.evidence.regions.length === 0
        && bundle.sources.length === 0;
      if (
        !isDeepStrictEqual(
          bundle.evidence.primary,
          queryEvidenceAdequacy.postGateSeeds,
        )
        || (
          emptyDecision
            ? bundle.status !== "EMPTY" || !evidenceEmpty
            : (
                bundle.status !== "SUCCESS"
                || !isDeepStrictEqual(
                  bundle.evidence.primary,
                  queryEvidenceAdequacy.preGateSeeds,
                )
              )
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "adequacy KEEP must preserve every primary and EMPTY must clear every evidence layer",
          path: ["evidence", "queryEvidenceAdequacy"],
        });
      }
    }
    if (
      objectConsensus
      && (
        bundle.query.mode !== "TEXT_TO_TEXT"
        || bundle.query.scope.sourceCoursePack === null
        || (
          objectConsensus.applied
          && bundle.evidence.acceptance.candidates.some(
            ({ candidateId }) =>
              !objectConsensus.candidates.some(
                ({ selectedNodeId }) => selectedNodeId === candidateId,
              ),
          )
        )
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "object consensus trace must bind every derived TTT acceptance candidate",
        path: ["evidence", "objectConsensus"],
      });
    }
    const boundaryIdentityHashes = [
      bundle.provenance.capabilityEntityManifestHash,
      bundle.provenance.packCompetitionPolicyHash,
      bundle.provenance.packCompetitionCalibrationHash,
      bundle.provenance.lexicalPackCompetitionAlgorithmHash,
      bundle.provenance.textPackCompetitionAlgorithmHash,
    ];
    const declaredBoundaryIdentityCount = boundaryIdentityHashes.filter(
      (value) => value !== undefined,
    ).length;
    if (
      declaredBoundaryIdentityCount !== 0
      && (
        declaredBoundaryIdentityCount !== boundaryIdentityHashes.length
        || !boundary
        || bundle.query.mode !== "TEXT_TO_TEXT"
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "T4.1 boundary identities must be complete, text-only, and accompanied by a trace",
        path: ["provenance"],
      });
    }
    if (
      boundary
      && (
        bundle.query.mode !== "TEXT_TO_TEXT"
        || boundary.capabilityEntityManifestHash
          !== bundle.provenance.capabilityEntityManifestHash
        || boundary.packCompetitionPolicyHash
          !== bundle.provenance.packCompetitionPolicyHash
        || boundary.packCompetitionCalibrationHash
          !== bundle.provenance.packCompetitionCalibrationHash
        || boundary.lexicalPackCompetitionAlgorithmHash
          !== bundle.provenance.lexicalPackCompetitionAlgorithmHash
        || boundary.textPackCompetitionAlgorithmHash
          !== bundle.provenance.textPackCompetitionAlgorithmHash
        || boundary.acceptancePolicyHash !== bundle.provenance.acceptancePolicyHash
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "capability boundary trace must bind the TTT provenance identities",
        path: ["evidence", "boundary"],
      });
    }
    const external = bundle.provenance.externalVerification;
    const captionFallback = bundle.provenance.captionFallback ?? null;
    if (
      captionFallback
      && (
        captionFallback.channel !== "LEXICAL"
        || captionFallback.corpusBundleHash !== bundle.provenance.corpusBundleHash
        || (
          captionFallback.identity
          && captionFallback.identity.activeIndexBundleHash
            !== bundle.provenance.activeIndexBundleHash
        )
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "caption fallback must bind the lexical slot and active generation",
        path: ["provenance", "captionFallback"],
      });
    }
    if (
      bundle.provenance.fallbackTriggers.some((trigger) =>
        trigger.startsWith("CAPTION_LEXICAL_FALLBACK_"))
      !== (captionFallback !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "caption fallback provenance and trigger must be declared together",
        path: ["provenance", "captionFallback"],
      });
    }
    if (
      (!external.required
        && (
          !external.authorized
          || external.claimKinds.length > 0
          || external.reason !== "NOT_REQUIRED"
        ))
      || (
        external.required
        && external.authorized !== (external.reason === "AUTHORITATIVE_SOURCE_FOUND")
      )
      || (
        external.required
        && !external.authorized
        && external.reason !== "EXTERNAL_VERIFICATION_REQUIRED"
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "external verification trace is internally inconsistent",
        path: ["provenance", "externalVerification"],
      });
    }
    if (
      external.matchedSourceIds.length !== external.matchedSources.length
      || external.matchedSourceIds.some(
        (sourceId, index) => external.matchedSources[index]?.sourceId !== sourceId,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "external verification sources must preserve verified dates",
        path: ["provenance", "externalVerification", "matchedSources"],
      });
    }
    if (
      bundle.query.scope.sourceCoursePack
      && bundle.evidence.nodes.some(({ sourceCoursePack }) =>
        sourceCoursePack.id !== bundle.query.scope.sourceCoursePack?.id
        || sourceCoursePack.version !== bundle.query.scope.sourceCoursePack?.version)
    ) {
      context.addIssue({
        code: "custom",
        message: "evidence nodes must obey source course scope",
        path: ["evidence", "nodes"],
      });
    }
    const primaryIds = new Set(bundle.evidence.primary.map(({ candidateId }) => candidateId));
    const primaryById = new Map(
      bundle.evidence.primary.map((primary) => [primary.candidateId, primary]),
    );
    if (primaryIds.size !== bundle.evidence.primary.length) {
      context.addIssue({ code: "custom", message: "primary evidence must be unique" });
    }
    if (
      (bundle.status === "SUCCESS" && bundle.evidence.primary.length === 0)
      || (
        ["EMPTY", "UNSUPPORTED", "TIMEOUT", "ERROR"].includes(bundle.status)
        && bundle.evidence.primary.length > 0
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "bundle status must agree with retained primary evidence",
        path: ["status"],
      });
    }
    const hasTextEvidence = bundle.evidence.nodes.some(({ kind }) =>
      ["DOCUMENT", "SECTION", "TEXT", "TABLE"].includes(kind));
    const hasAssetEvidence = bundle.evidence.assets.length > 0;
    if (
      bundle.status === "SUCCESS"
      && (
        (
          ["TEXT_TO_IMAGE", "IMAGE_TO_IMAGE", "IMAGE_TEXT_TO_EVIDENCE"]
            .includes(bundle.query.mode)
          && !hasAssetEvidence
        )
        || (
          ["TEXT_TO_TEXT", "IMAGE_TEXT_TO_EVIDENCE"].includes(bundle.query.mode)
          && !hasTextEvidence
        )
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "successful visual modes require their declared evidence modalities",
        path: ["evidence"],
      });
    }
    if (bundle.evidence.primary.some(({ fusedRank }, index) => fusedRank !== index + 1)) {
      context.addIssue({
        code: "custom",
        message: "primary evidence ranks must be contiguous from one",
      });
    }
    const nodeIds = bundle.evidence.nodes.map(({ nodeId }) => nodeId);
    if (new Set(nodeIds).size !== nodeIds.length) {
      context.addIssue({ code: "custom", message: "evidence nodes must be unique" });
    }
    const parentCount = bundle.evidence.nodes.filter(({ relation }) => relation === "PARENT").length;
    const siblingCount = bundle.evidence.nodes
      .filter(({ relation }) => relation === "SIBLING").length;
    if (parentCount > EVIDENCE_LIMITS_V2.parents) {
      context.addIssue({ code: "custom", message: "evidence parent cap exceeded" });
    }
    if (siblingCount > EVIDENCE_LIMITS_V2.siblings) {
      context.addIssue({ code: "custom", message: "evidence sibling cap exceeded" });
    }
    const primaryNodes = new Map(
      bundle.evidence.nodes
        .filter(({ relation }) => relation === "PRIMARY")
        .map((node) => [node.seedCandidateId, node]),
    );
    for (const primary of bundle.evidence.primary) {
      const acceptedTrace = bundle.evidence.acceptance.candidates.find(
        ({ candidateId }) => candidateId === primary.candidateId,
      );
      if (!acceptedTrace?.accepted) {
        context.addIssue({
          code: "custom",
          message: "primary evidence requires an accepted post-fusion trace",
          path: ["evidence", "primary"],
        });
      }
      const owners = bundle.evidence.nodes.filter((node) =>
        node.relation === "PRIMARY" && node.seedCandidateId === primary.candidateId);
      if (owners.length !== 1 || owners[0]?.objectId !== primary.objectId) {
        context.addIssue({
          code: "custom",
          message: "each retained primary requires exactly one primary owner node",
          path: ["evidence", "nodes"],
        });
      }
    }
    const parentSeeds = new Set<string>();
    for (const node of bundle.evidence.nodes) {
      const seed = primaryById.get(node.seedCandidateId);
      if (!seed || seed.objectId !== node.objectId) {
        context.addIssue({
          code: "custom",
          message: "graph evidence must remain inside its fused seed object",
          path: ["evidence", "nodes"],
        });
      }
      const primaryNode = primaryNodes.get(node.seedCandidateId);
      if (node.relation === "PARENT") {
        if (
          parentSeeds.has(node.seedCandidateId)
          || !primaryNode
          || primaryNode.parentNodeId !== node.nodeId
        ) {
          context.addIssue({
            code: "custom",
            message: "each seed may add only its direct parent",
            path: ["evidence", "nodes"],
          });
        }
        parentSeeds.add(node.seedCandidateId);
      }
      if (
        node.relation === "SIBLING"
        && (
          !primaryNode
          || node.nodeId === primaryNode.nodeId
          || node.parentNodeId === null
          || node.parentNodeId !== primaryNode.parentNodeId
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "siblings must share the seed node direct parent",
          path: ["evidence", "nodes"],
        });
      }
    }
    const assetIds = bundle.evidence.assets.map(({ assetId }) => assetId);
    if (new Set(assetIds).size !== assetIds.length) {
      context.addIssue({ code: "custom", message: "evidence assets must be unique" });
    }
    const visualChannel = bundle.channels.find(({ channel }) =>
      channel === "VISUAL_VECTOR");
    const retrievalRanks = new Set<string>();
    for (const [index, asset] of bundle.evidence.assets.entries()) {
      if (!asset.retrieval) continue;
      const rankKey = `${asset.retrieval.channel}:${asset.retrieval.rank}`;
      if (retrievalRanks.has(rankKey)) {
        context.addIssue({
          code: "custom",
          message: "retrieval-backed evidence asset ranks must be unique per channel",
          path: ["evidence", "assets", index, "retrieval", "rank"],
        });
      }
      retrievalRanks.add(rankKey);
      if (
        (
          asset.retrieval.channel === "VISUAL_VECTOR"
          && visualChannel?.status !== "SUCCESS"
        )
        || (
          asset.retrieval.channel === "CAPTION_LEXICAL"
          && (
            bundle.query.mode !== "TEXT_TO_IMAGE"
            || captionFallback?.status !== "SUCCESS"
          )
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "asset retrieval provenance requires its successful trusted channel",
          path: ["evidence", "assets", index, "retrieval"],
        });
      }
    }
    if (
      bundle.query.queryAsset
      && (
        assetIds.includes(bundle.query.queryAsset.assetId)
        || bundle.evidence.regions.some(({ assetId }) =>
          assetId === bundle.query.queryAsset?.assetId)
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "query assets must not be returned as evidence",
        path: ["evidence", "assets"],
      });
    }
    const retainedAssets = new Set(assetIds);
    if (bundle.evidence.regions.some(({ assetId }) => !retainedAssets.has(assetId))) {
      context.addIssue({
        code: "custom",
        message: "regions require a retained evidence asset",
        path: ["evidence", "regions"],
      });
    }
    const regionIds = bundle.evidence.regions.map(({ regionId }) => regionId);
    if (new Set(regionIds).size !== regionIds.length) {
      context.addIssue({ code: "custom", message: "evidence regions must be unique" });
    }
    const assetById = new Map(
      bundle.evidence.assets.map((asset) => [asset.assetId, asset]),
    );
    for (const region of bundle.evidence.regions) {
      if (assetById.get(region.assetId)?.objectId !== region.objectId) {
        context.addIssue({
          code: "custom",
          message: "region and asset evidence must share an object owner",
          path: ["evidence", "regions"],
        });
      }
      if (region.regionNodeId !== null) {
        const regionNode = bundle.evidence.nodes.find(
          ({ nodeId }) => nodeId === region.regionNodeId,
        );
        if (
          !regionNode
          || regionNode.kind !== "REGION"
          || regionNode.objectId !== region.objectId
          || regionNode.assetId !== region.assetId
        ) {
          context.addIssue({
            code: "custom",
            message: "regionNodeId must identify a retained real REGION node",
            path: ["evidence", "regions"],
          });
        }
      }
    }
    const sourceIds = bundle.sources.map(({ sourceId }) => sourceId);
    if (new Set(sourceIds).size !== sourceIds.length) {
      context.addIssue({ code: "custom", message: "evidence sources must be unique" });
    }
    const retainedSources = new Set(sourceIds);
    const sourceById = new Map(bundle.sources.map((source) => [source.sourceId, source]));
    if (bundle.evidence.nodes.some(({ sourceId }) => !retainedSources.has(sourceId))) {
      context.addIssue({
        code: "custom",
        message: "every evidence node requires retained source provenance",
        path: ["sources"],
      });
    }
    if (bundle.evidence.nodes.some((node) =>
      sourceById.get(node.sourceId)?.objectId !== node.objectId)) {
      context.addIssue({
        code: "custom",
        message: "every evidence node source must belong to the same knowledge object",
        path: ["sources"],
      });
    }
    if (
      external.required
      && external.authorized
      && external.matchedSources.some((matched) => {
        const source = sourceById.get(matched.sourceId);
        return !source
          || source.authority !== "OFFICIAL"
          || source.verifiedDate !== matched.verifiedDate;
      })
    ) {
      context.addIssue({
        code: "custom",
        message: "authorized external verification sources must remain in final evidence",
        path: ["sources"],
      });
    }
    const excerptCharacters = bundle.evidence.nodes.reduce(
      (total, node) => total + (node.excerpt?.length ?? 0),
      0,
    );
    if (excerptCharacters > EVIDENCE_LIMITS_V2.excerptCharacters) {
      context.addIssue({ code: "custom", message: "evidence excerpt cap exceeded" });
    }
    if (Buffer.byteLength(JSON.stringify(bundle), "utf8") > EVIDENCE_LIMITS_V2.jsonBytes) {
      context.addIssue({ code: "custom", message: "serialized evidence bundle cap exceeded" });
    }
  });

export type EvidenceChannelV2 = z.infer<typeof EvidenceChannelV2Schema>;
export type EvidenceNodeV2 = z.infer<typeof EvidenceNodeV2Schema>;
export type EvidenceAssetV2 = z.infer<typeof EvidenceAssetV2Schema>;
export type EvidenceRegionV2 = z.infer<typeof EvidenceRegionV2Schema>;
export type EvidenceSourceV2 = z.infer<typeof EvidenceSourceV2Schema>;
export type EvidenceExpansionV2 = z.infer<typeof EvidenceExpansionV2Schema>;
export type EvidenceProvenanceV2 = z.infer<typeof EvidenceProvenanceV2Schema>;
export type EvidenceBundleV2 = z.infer<typeof EvidenceBundleV2Schema>;

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

function fusedRankBySeed(primary: readonly FusedCandidateV2[]) {
  return new Map(primary.map(({ candidateId, fusedRank }) => [candidateId, fusedRank]));
}

function capNodes(
  nodes: readonly EvidenceNodeV2[],
  primary: readonly FusedCandidateV2[],
) {
  const allowedSeeds = new Set(primary.map(({ candidateId }) => candidateId));
  const seedRank = fusedRankBySeed(primary);
  const sorted = [...nodes]
    .filter(({ seedCandidateId }) => allowedSeeds.has(seedCandidateId))
    .sort((left, right) => {
      const relationOrder = { PRIMARY: 0, PARENT: 1, SIBLING: 2 } as const;
      return (
        relationOrder[left.relation] - relationOrder[right.relation]
        || (seedRank.get(left.seedCandidateId) ?? 99)
          - (seedRank.get(right.seedCandidateId) ?? 99)
        || compareCodePoints(left.nodeId, right.nodeId)
      );
    });
  const primaryBySeed = new Set<string>();
  const parentBySeed = new Set<string>();
  const retainedIds = new Set<string>();
  const retained: EvidenceNodeV2[] = [];
  let parents = 0;
  let siblings = 0;
  for (const node of sorted) {
    if (retained.length >= EVIDENCE_LIMITS_V2.nodes || retainedIds.has(node.nodeId)) continue;
    if (node.relation === "PRIMARY") {
      if (primaryBySeed.has(node.seedCandidateId)) continue;
      primaryBySeed.add(node.seedCandidateId);
    } else if (node.relation === "PARENT") {
      if (
        parents >= EVIDENCE_LIMITS_V2.parents
        || parentBySeed.has(node.seedCandidateId)
        || !primaryBySeed.has(node.seedCandidateId)
      ) continue;
      parents += 1;
      parentBySeed.add(node.seedCandidateId);
    } else {
      if (
        siblings >= EVIDENCE_LIMITS_V2.siblings
        || !primaryBySeed.has(node.seedCandidateId)
      ) continue;
      siblings += 1;
    }
    retainedIds.add(node.nodeId);
    retained.push(node);
  }
  let remainingCharacters = EVIDENCE_LIMITS_V2.excerptCharacters;
  return retained.map((node) => {
    if (node.excerpt === null) return node;
    const excerpt = node.excerpt.slice(0, remainingCharacters);
    remainingCharacters -= excerpt.length;
    return { ...node, excerpt };
  });
}

export function assembleEvidenceBundleV2(input: {
  status: EvidenceBundleV2["status"];
  query: RetrievalQueryV2;
  channels: readonly EvidenceChannelV2[];
  fused: readonly FusedCandidateV2[];
  acceptance: AcceptanceTraceV2;
  boundary?: CapabilityBoundaryTraceV2 | null;
  objectConsensus?: ObjectConsensusTraceV2 | null;
  queryEvidenceAdequacy?: QueryEvidenceAdequacyTraceV2 | null;
  expansion: EvidenceExpansionV2;
  provenance: EvidenceProvenanceV2;
  timing: EvidenceBundleV2["timing"];
}): EvidenceBundleV2 {
  const query = RetrievalQueryV2Schema.parse(input.query);
  const channels = z.array(EvidenceChannelV2Schema).length(3).parse(input.channels);
  const provenance = EvidenceProvenanceV2Schema.parse(input.provenance);
  const fused = z
    .array(FusedCandidateV2Schema)
    .max(10)
    .parse(input.fused)
    .slice(0, EVIDENCE_LIMITS_V2.primary)
    .map((candidate, index) => ({ ...candidate, fusedRank: index + 1 }));
  const acceptance = AcceptanceTraceV2Schema.parse(input.acceptance);
  const boundary = input.boundary === undefined || input.boundary === null
    ? null
    : CapabilityBoundaryTraceV2Schema.parse(input.boundary);
  const objectConsensus =
    input.objectConsensus === undefined || input.objectConsensus === null
      ? null
      : ObjectConsensusTraceV2Schema.parse(input.objectConsensus);
  const queryEvidenceAdequacy =
    input.queryEvidenceAdequacy === undefined
      || input.queryEvidenceAdequacy === null
      ? null
      : QueryEvidenceAdequacyTraceV2Schema.parse(
          input.queryEvidenceAdequacy,
        );
  const expansion = EvidenceExpansionV2Schema.parse(input.expansion);
  const parsedNodes = expansion.nodes.map((node) => EvidenceNodeV2Schema.parse(node));
  const nodes = capNodes(parsedNodes, fused);
  const retainedObjectIds = new Set(fused.map(({ objectId }) => objectId));
  const objectRank = new Map(fused.map(({ objectId, fusedRank }) => [objectId, fusedRank]));
  const queryAssetId = query.queryAsset?.assetId ?? null;
  const assets = Array.from(
    new Map(
      expansion.assets
        .filter(({ objectId, assetId }) =>
          retainedObjectIds.has(objectId) && assetId !== queryAssetId)
        .map((asset) => [asset.assetId, asset]),
    ).values(),
  ).slice(0, EVIDENCE_LIMITS_V2.assets);
  const retainedAssetIds = new Set(assets.map(({ assetId }) => assetId));
  const regions = Array.from(
    new Map(
      expansion.regions
        .filter(({ objectId, assetId }) =>
          retainedObjectIds.has(objectId)
          && retainedAssetIds.has(assetId)
          && assetId !== queryAssetId)
        .map((region) => [region.regionId, region]),
    ).values(),
  ).slice(0, EVIDENCE_LIMITS_V2.regions);
  const usedSourceIds = new Set(nodes.map(({ sourceId }) => sourceId));
  const externallyRequiredSourceIds = new Set(
    provenance.externalVerification.authorized
      ? provenance.externalVerification.matchedSourceIds
      : [],
  );
  const sources = Array.from(
    new Map(
      expansion.sources
        .filter(({ sourceId, objectId }) =>
          (usedSourceIds.has(sourceId) || externallyRequiredSourceIds.has(sourceId))
          && retainedObjectIds.has(objectId))
        .sort((left, right) =>
          Number(externallyRequiredSourceIds.has(right.sourceId))
            - Number(externallyRequiredSourceIds.has(left.sourceId))
          || (objectRank.get(left.objectId) ?? 99) - (objectRank.get(right.objectId) ?? 99)
          || compareCodePoints(left.sourceId, right.sourceId))
        .map((source) => [source.sourceId, source]),
    ).values(),
  ).slice(0, 5);
  const base = {
    schemaVersion: 2 as const,
    status: input.status,
    query,
    channels,
    evidence: {
      primary: fused,
      nodes,
      assets,
      regions,
      acceptance,
      ...(boundary ? { boundary } : {}),
      ...(objectConsensus ? { objectConsensus } : {}),
      ...(queryEvidenceAdequacy
        ? { queryEvidenceAdequacy }
        : {}),
    },
    sources,
    provenance,
    limits: EVIDENCE_LIMITS_V2,
    timing: input.timing,
  };
  const bundleId = `evidence-${createHash("sha256").update(stableJson(base)).digest("hex")}`;
  return EvidenceBundleV2Schema.parse({ ...base, bundleId });
}

export function emptyEvidenceExpansionV2(): EvidenceExpansionV2 {
  return { nodes: [], assets: [], regions: [], sources: [] };
}
