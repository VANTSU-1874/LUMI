import { z } from "zod";

import {
  applyCapabilityBoundaryV2,
  mapPackCompetitionObservationsToBoundaryDiagnosticsV2,
  verifyCapabilityEntityManifestEvidenceV2,
  type CapabilityBoundaryTraceV2,
  type CapabilityEntityManifestV2,
  type PackCompetitionCalibrationV2,
  type PackCompetitionPolicyV2,
} from "./capability-boundary-v2";
import {
  CoursePackReferenceV2Schema,
  sha256StableJsonV2,
} from "./knowledge-object-v2";
import {
  evaluateQueryPrerequisiteV3,
  type QueryPrerequisiteTraceV3,
} from "./query-prerequisite-router-v3";
import { PackCompetitionObservationV2Schema } from "./pack-competition-v2";
import {
  assembleEvidenceBundleV2,
  emptyEvidenceExpansionV2,
  EvidenceChannelV2Schema,
  EvidenceExpansionV2Schema,
  type EvidenceBundleV2,
  type EvidenceAssetV2,
  type EvidenceChannelV2,
  type EvidenceProvenanceV2,
} from "./evidence-bundle-v2";
import {
  AcceptancePolicyV2Schema,
  applyPostFusionAcceptanceV2,
  CANDIDATE_PROJECTION_BY_MODE_V2,
  candidateProjectionForModeV2,
  ChannelCandidateV2Schema,
  createAcceptancePolicyV2,
  fuseRankedChannelsV2,
  RRF_CHANNEL_LIMIT_V2,
  RRF_FUSED_LIMIT_V2,
  RRF_K_V2,
  RRF_WEIGHTS_V2,
  RetrievalChannelV2Schema,
  type AcceptancePolicyV2,
  type ChannelCandidateV2,
  type FusedCandidateV2,
  type RetrievalChannelV2,
} from "./rank-fusion-v2";
import {
  ObjectCandidateV2Schema,
  ObjectConsensusTraceV2Schema,
  TEXT_OBJECT_CONSENSUS_CONFIG_V2,
  resolveTextObjectConsensusV2,
  type ObjectConsensusTraceV2,
} from "./object-candidate-v2";
import {
  RetrievalQueryV2Schema,
  normalizeRetrievalTextV2,
  type RetrievalQueryV2,
} from "./retrieval-query-v2";
import {
  applyQueryEvidenceAdequacyV2,
  type QueryEvidenceAdequacyRuntimeV2,
  type QueryEvidenceAdequacyTraceV2,
} from "./query-evidence-adequacy-v2";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const IdSchema = z.string().regex(ID_PATTERN, "expected a stable lowercase identifier");

export const HYBRID_RRF_CONFIG_V2 = Object.freeze({
  id: "lumi-rrf-v2",
  version: "1.2.0",
  k: RRF_K_V2,
  weights: RRF_WEIGHTS_V2,
  channelLimit: RRF_CHANNEL_LIMIT_V2,
  fusedLimit: RRF_FUSED_LIMIT_V2,
  candidateProjectionByMode: CANDIDATE_PROJECTION_BY_MODE_V2,
  textObjectConsensus: TEXT_OBJECT_CONSENSUS_CONFIG_V2,
  visualReservationPolicy: Object.freeze({
    modes: Object.freeze([
      "TEXT_TO_IMAGE",
      "IMAGE_TO_IMAGE",
      "IMAGE_TEXT_TO_EVIDENCE",
    ] as const),
    source: "VISUAL_ASSET_HITS",
    sourceLimit: 5,
    dedupe: "FIRST_BY_OBJECT",
    reserveWithinFusedLimit: RRF_FUSED_LIMIT_V2,
    eviction: "LOWEST_FUSED_NON_RESERVED",
  }),
  primaryLimit: 5,
  finalPrimarySelectionByMode: Object.freeze({
    TEXT_TO_TEXT: "STRONGEST_FUSED_NODE_PER_OBJECT_FIRST_WINS_MAX5",
    TEXT_TO_IMAGE: "RAW_VISUAL_TOP5_OBJECTS_THEN_FUSED_BACKFILL_MAX5",
    IMAGE_TO_IMAGE: "RAW_VISUAL_TOP5_OBJECTS_THEN_FUSED_BACKFILL_MAX5",
    IMAGE_TEXT_TO_EVIDENCE:
      "RAW_VISUAL_TOP5_OBJECTS_THEN_FUSED_BACKFILL_MAX5",
  }),
});

export const VisualAssetCandidateV2Schema = z
  .object({
    objectId: IdSchema,
    representationId: IdSchema,
    nodeId: IdSchema,
    assetId: IdSchema,
    region: ChannelCandidateV2Schema.shape.region,
    rank: ChannelCandidateV2Schema.shape.rank,
    rawScore: ChannelCandidateV2Schema.shape.rawScore,
  })
  .strict();

export const ChannelRetrievalResultV2Schema = z
  .object({
    summary: EvidenceChannelV2Schema,
    hits: z.array(ChannelCandidateV2Schema).max(20),
    objectCandidates: z.array(ObjectCandidateV2Schema).max(10).optional(),
    visualAssetHits: z.array(VisualAssetCandidateV2Schema).max(20).optional(),
    packCompetition: PackCompetitionObservationV2Schema.optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.summary.status === "SKIPPED") {
      context.addIssue({ code: "custom", message: "providers cannot return skipped channels" });
    }
    if (result.summary.hitCount !== result.hits.length) {
      context.addIssue({
        code: "custom",
        message: "channel hit count must match returned candidates",
        path: ["summary", "hitCount"],
      });
    }
    const candidateIds = result.hits.map(({ candidateId }) => candidateId);
    if (new Set(candidateIds).size !== candidateIds.length) {
      context.addIssue({
        code: "custom",
        message: "channel candidates must be unique",
        path: ["hits"],
      });
    }
    const ranks = result.hits.map(({ rank }) => rank).sort((left, right) => left - right);
    if (ranks.some((rank, index) => rank !== index + 1)) {
      context.addIssue({
        code: "custom",
        message: "channel ranks must be contiguous from one",
        path: ["hits"],
      });
    }
    const visualAssetHits = result.visualAssetHits ?? [];
    if (
      visualAssetHits.length > 0
      && (
        result.summary.channel !== "VISUAL_VECTOR"
        || result.summary.status !== "SUCCESS"
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "only successful visual channels may retain asset-level ranking",
        path: ["visualAssetHits"],
      });
    }
    const visualAssetIds = visualAssetHits.map(({ assetId }) => assetId);
    if (new Set(visualAssetIds).size !== visualAssetIds.length) {
      context.addIssue({
        code: "custom",
        message: "visual asset-level ranking must be unique by asset id",
        path: ["visualAssetHits"],
      });
    }
    const visualAssetRanks = visualAssetHits
      .map(({ rank }) => rank)
      .sort((left, right) => left - right);
    if (visualAssetRanks.some((rank, index) => rank !== index + 1)) {
      context.addIssue({
        code: "custom",
        message: "visual asset-level ranks must be contiguous from one",
        path: ["visualAssetHits"],
      });
    }
    const hitObjects = new Set(result.hits.map(({ objectId }) => objectId));
    if (visualAssetHits.some(({ objectId }) => !hitObjects.has(objectId))) {
      context.addIssue({
        code: "custom",
        message: "visual asset-level hits must belong to a retained fusion object",
        path: ["visualAssetHits"],
      });
    }
  });

export const ExternalClaimKindV2Schema = z.enum([
  "AUTHORIZATION",
  "PRICE",
  "OWNERSHIP",
  "EXAM_SCHEDULE",
  "RESULT_GUARANTEE",
  "CURRENT_STATUS",
  "REGULATION",
]);

export const CorpusProvenanceClaimV2Schema = z
  .object({
    sourceId: IdSchema,
    objectId: IdSchema,
    sourceCoursePack: CoursePackReferenceV2Schema,
    authority: z.enum(["OFFICIAL", "COURSE_DESIGN", "TEACHER_EXPERIENCE", "ANONYMIZED_CASE"]),
    verifiedDate: z.iso.date(),
    claimKinds: z.array(ExternalClaimKindV2Schema).min(1).max(7),
    topicTerms: z.array(z.string().trim().min(2).max(100)).min(1).max(20),
  })
  .strict()
  .superRefine((claim, context) => {
    if (new Set(claim.claimKinds).size !== claim.claimKinds.length) {
      context.addIssue({
        code: "custom",
        message: "provenance claim kinds must be unique",
        path: ["claimKinds"],
      });
    }
    const normalizedTerms = claim.topicTerms.map(normalizeRetrievalTextV2);
    if (
      normalizedTerms.some((term) => term.length < 2)
      || new Set(normalizedTerms).size !== normalizedTerms.length
    ) {
      context.addIssue({
        code: "custom",
        message: "provenance topic terms must be unique after normalization",
        path: ["topicTerms"],
      });
    }
  });

export const CorpusProvenanceClaimsV2Schema = z
  .array(CorpusProvenanceClaimV2Schema)
  .superRefine((claims, context) => {
    const sourceIds = claims.map(({ sourceId }) => sourceId);
    if (new Set(sourceIds).size !== sourceIds.length) {
      context.addIssue({
        code: "custom",
        message: "corpus provenance sources must be unique",
      });
    }
  });

export type ChannelRetrievalResultV2 = z.infer<typeof ChannelRetrievalResultV2Schema>;
export type VisualAssetCandidateV2 = z.infer<typeof VisualAssetCandidateV2Schema>;
export type ExternalClaimKindV2 = z.infer<typeof ExternalClaimKindV2Schema>;
export type CorpusProvenanceClaimV2 = z.infer<typeof CorpusProvenanceClaimV2Schema>;

export const CaptionLexicalFallbackResultV2Schema = ChannelRetrievalResultV2Schema
  .superRefine((result, context) => {
    if (result.summary.channel !== "LEXICAL") {
      context.addIssue({
        code: "custom",
        message: "caption fallback must use the frozen lexical channel slot",
        path: ["summary", "channel"],
      });
    }
    for (const [index, hit] of result.hits.entries()) {
      if (
        hit.assetId === null
        || hit.nodeId === null
        || hit.candidateId !== hit.assetId
        || hit.region !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "caption fallback hits must identify ranked corpus assets and image nodes",
          path: ["hits", index],
        });
      }
    }
  });

export type CaptionLexicalFallbackResultV2 = z.infer<
  typeof CaptionLexicalFallbackResultV2Schema
>;

export interface RetrievalChannelProviderV2 {
  retrieve(
    query: RetrievalQueryV2,
    context: { signal?: AbortSignal },
  ): Promise<unknown>;
}

export interface EvidenceGraphExpanderV2 {
  expand(
    input: {
      query: RetrievalQueryV2;
      seeds: readonly FusedCandidateV2[];
      channelResults: ReadonlyMap<RetrievalChannelV2, ChannelRetrievalResultV2>;
      requiredSourceIds: readonly string[];
      requiredSourceClaims?: readonly CorpusProvenanceClaimV2[];
      requiredClaimKinds?: readonly ExternalClaimKindV2[];
      captionFallbackHits?: readonly ChannelCandidateV2[];
      objectConsensus?: ObjectConsensusTraceV2 | null;
      objectConsensusSourceChannelResults?: ReadonlyMap<
        RetrievalChannelV2,
        ChannelRetrievalResultV2
      >;
    },
    context: { signal?: AbortSignal },
  ): Promise<unknown>;
  resolvePrimaries(
    input: {
      query: RetrievalQueryV2;
      seeds: readonly FusedCandidateV2[];
      channelResults: ReadonlyMap<RetrievalChannelV2, ChannelRetrievalResultV2>;
      requiredSourceIds: readonly string[];
      requiredSourceClaims?: readonly CorpusProvenanceClaimV2[];
      requiredClaimKinds?: readonly ExternalClaimKindV2[];
      captionFallbackHits?: readonly ChannelCandidateV2[];
      objectConsensus?: ObjectConsensusTraceV2 | null;
      objectConsensusSourceChannelResults?: ReadonlyMap<
        RetrievalChannelV2,
        ChannelRetrievalResultV2
      >;
    },
    context: { signal?: AbortSignal },
  ): Promise<unknown>;
}

type ChannelProvidersV2 = {
  lexical: RetrievalChannelProviderV2;
  frozenLexicalFallback?: RetrievalChannelProviderV2 | null;
  textVector?: RetrievalChannelProviderV2 | null;
  visualVector?: RetrievalChannelProviderV2 | null;
  captionFallback?: RetrievalChannelProviderV2 | null;
};

export type HybridRetrieverV2Dependencies = {
  providers: ChannelProvidersV2;
  graphExpander: EvidenceGraphExpanderV2;
  sourceCoursePackByObjectId: ReadonlyMap<string, z.infer<typeof CoursePackReferenceV2Schema>>;
  assetIdByNodeId?: ReadonlyMap<string, string>;
  corpusProvenanceClaims: readonly CorpusProvenanceClaimV2[];
  externalVerificationEvaluator?: (
    query: RetrievalQueryV2,
    claims: readonly CorpusProvenanceClaimV2[],
  ) => EvidenceProvenanceV2["externalVerification"];
  acceptancePolicy?: AcceptancePolicyV2;
  capabilityBoundary?: {
    manifest: CapabilityEntityManifestV2;
    policy?: PackCompetitionPolicyV2;
    calibration: PackCompetitionCalibrationV2;
    runtimeIdentity: {
      lexicalConfigHash: string;
      textProviderIndexBundleHash: string;
      textModelId: string;
      textModelRevision: string;
      lexicalPackCompetitionAlgorithmHash: string;
      textPackCompetitionAlgorithmHash: string;
    };
  };
  textObjectConsensusEnabled?: boolean;
  queryEvidenceAdequacy?: QueryEvidenceAdequacyRuntimeV2 | null;
  provenance: {
    activeIndexBundleHash: string;
    relationConfigHash: string;
    normalizerConfigHash: string;
    rrfConfigHash: string;
  };
  now?: () => number;
  queryDeadlineMs?: number;
};

const EXTERNAL_CLAIM_PATTERNS: ReadonlyArray<{
  kind: ExternalClaimKindV2;
  patterns: readonly RegExp[];
}> = [
  {
    kind: "AUTHORIZATION",
    patterns: [
      /授权|许可/u,
      /(?:官方|品牌|作者|学校|机构).{0,8}(?:授权|许可|批准|认证)/u,
      /(?:授权|许可).{0,8}(?:使用|改编|发布|商用)/u,
      /\b(?:authorized|licensed|approved)\b/i,
    ],
  },
  {
    kind: "PRICE",
    patterns: [
      /价格|售价|多少钱|收费|费用|报价|(?:要)?付多少|花多少|要付.{0,4}钱/u,
      /\b(?:price|cost|fee|quote)\b/i,
    ],
  },
  {
    kind: "OWNERSHIP",
    patterns: [
      /版权|著作权|所有权|权属|归谁所有|归属/u,
      /\b(?:copyright|ownership|rights holder)\b/i,
    ],
  },
  {
    kind: "EXAM_SCHEDULE",
    patterns: [
      /考试.{0,12}(?:时间|日期|安排|日程|哪天|几点|教室|地点|考场)|(?:时间|日期|安排|日程|哪天|几点|教室|地点|考场).{0,12}考试/u,
      /\bexam.{0,12}(?:date|time|schedule)\b/i,
    ],
  },
  {
    kind: "RESULT_GUARANTEE",
    patterns: [
      /保证.{0,8}(?:通过|结果|得奖|获奖|高分|成功)|保过|百分之百.{0,8}(?:通过|成功)|一定会.{0,8}(?:通过|成功|获奖)/u,
      /\bguarantee(?:d)?\s+(?:result|pass|success)\b/i,
    ],
  },
  {
    kind: "CURRENT_STATUS",
    patterns: [
      /(?:今天|目前|当前|现在|这周|本周|今年|最新|刚(?:刚)?(?:公布|发布|更新))(?=.{0,48}(?:有没有|是否|还能不能|能否|支持到|哪天|多少钱|有货|更新|公布|发布|查询|审核))(?=.{0,48}(?:驱动|固件|库存|现货|截止|报名|资格|版本|域名|注册|年度色|色值|报价|到货)).{0,48}/u,
      /(?:驱动|固件|库存|现货|截止|报名|资格|版本|域名|注册|年度色|色值|报价|到货)(?=.{0,48}(?:今天|目前|当前|现在|这周|本周|今年|最新|更新))(?=.{0,48}(?:有没有|是否|还能不能|能否|支持到|哪天|多少钱|有货|更新|公布|发布|查询|审核)).{0,48}/u,
      /\b(?:current|latest|today(?:'s)?|this\s+(?:week|year))(?=.{0,48}(?:available|availability|released|updated|deadline|price|register|support|check))(?=.{0,48}(?:driver|firmware|stock|inventory|deadline|registration|version|domain|availability)).{0,48}\b/i,
    ],
  },
  {
    kind: "REGULATION",
    patterns: [
      /(?:现行|最新|刚(?:刚)?(?:发布|修订)|已生效)(?=.{0,40}(?:法规|规章|监管|合规要求|法定标准))(?=.{0,40}(?:有哪些|要求|规定|必须|不得|应当|适用|生效|怎么规定)).{0,40}/u,
      /(?:法规|规章|监管|合规要求|法定标准)(?=.{0,40}(?:现行|最新|刚(?:刚)?(?:发布|修订)|已生效))(?=.{0,40}(?:有哪些|要求|规定|必须|不得|应当|适用|生效|怎么规定)).{0,40}/u,
      /\b(?:current|latest|effective|newly\s+(?:issued|revised))(?=.{0,40}(?:law|regulation|statutory\s+standard|compliance\s+requirement))(?=.{0,40}(?:require|apply|effective|must|prohibit|check)).{0,40}\b/i,
    ],
  },
];

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return Array.from(new Set(values)).sort() as T[];
}

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function evaluateExternalVerificationV2(
  queryInput: RetrievalQueryV2,
  claimInputs: readonly CorpusProvenanceClaimV2[],
): EvidenceProvenanceV2["externalVerification"] {
  const query = RetrievalQueryV2Schema.parse(queryInput);
  const claims = CorpusProvenanceClaimsV2Schema.parse(claimInputs);
  if (query.normalizedText === null) {
    return {
      required: false,
      claimKinds: [],
      authorized: true,
      matchedSourceIds: [],
      matchedSources: [],
      reason: "NOT_REQUIRED",
    };
  }
  const claimKinds = uniqueSorted(
    EXTERNAL_CLAIM_PATTERNS
      .filter(({ patterns }) => patterns.some((pattern) => pattern.test(query.normalizedText!)))
      .map(({ kind }) => kind),
  );
  if (claimKinds.length === 0) {
    return {
      required: false,
      claimKinds: [],
      authorized: true,
      matchedSourceIds: [],
      matchedSources: [],
      reason: "NOT_REQUIRED",
    };
  }
  const matchingClaims = claims.filter((claim) =>
    claim.authority === "OFFICIAL"
    && (
      query.scope.sourceCoursePack === null
      || (
        claim.sourceCoursePack.id === query.scope.sourceCoursePack.id
        && claim.sourceCoursePack.version === query.scope.sourceCoursePack.version
      )
    )
    && claim.topicTerms.some((term) =>
      query.normalizedText!.includes(normalizeRetrievalTextV2(term))));
  const remainingKinds = new Set(claimKinds);
  const selectedClaims: CorpusProvenanceClaimV2[] = [];
  const availableClaims = [...matchingClaims].sort((left, right) =>
    compareCodePoints(left.sourceId, right.sourceId));
  while (remainingKinds.size > 0) {
    const best = availableClaims
      .map((claim) => ({
        claim,
        coverage: claim.claimKinds.filter((kind) => remainingKinds.has(kind)).length,
      }))
      .filter(({ coverage }) => coverage > 0)
      .sort((left, right) =>
        right.coverage - left.coverage
        || compareCodePoints(left.claim.sourceId, right.claim.sourceId))[0];
    if (!best) break;
    selectedClaims.push(best.claim);
    for (const kind of best.claim.claimKinds) remainingKinds.delete(kind);
    availableClaims.splice(availableClaims.indexOf(best.claim), 1);
  }
  const authorized = remainingKinds.size === 0;
  const matchedSourceIds = selectedClaims.map(({ sourceId }) => sourceId);
  const verifiedDateBySource = new Map(
    selectedClaims.map(({ sourceId, verifiedDate }) => [sourceId, verifiedDate]),
  );
  return {
    required: true,
    claimKinds,
    authorized,
    matchedSourceIds,
    matchedSources: matchedSourceIds.map((sourceId) => ({
      sourceId,
      verifiedDate: verifiedDateBySource.get(sourceId)!,
    })),
    reason: authorized
      ? "AUTHORITATIVE_SOURCE_FOUND"
      : "EXTERNAL_VERIFICATION_REQUIRED",
  };

}

export function evaluateExternalVerificationWithPrerequisiteShadowV3(
  input: {
    query: RetrievalQueryV2;
    claims: readonly CorpusProvenanceClaimV2[];
    capabilityEntityManifest: CapabilityEntityManifestV2;
  },
): {
  externalVerification:
    EvidenceProvenanceV2["externalVerification"];
  legacyExternalVerification:
    EvidenceProvenanceV2["externalVerification"];
  prerequisiteTrace: QueryPrerequisiteTraceV3;
  staticBypassApplied: boolean;
} {
  const legacyExternalVerification =
    evaluateExternalVerificationV2(
      input.query,
      input.claims,
    );
  const prerequisiteTrace = evaluateQueryPrerequisiteV3({
    query: input.query,
    capabilityEntityManifest:
      input.capabilityEntityManifest,
  });
  const staticBypassApplied =
    prerequisiteTrace.decision
      === "STATIC_CORPUS_ELIGIBLE"
    && legacyExternalVerification.required
    && !legacyExternalVerification.authorized;
  return {
    externalVerification: staticBypassApplied
      ? {
          required: false,
          claimKinds: [],
          authorized: true,
          matchedSourceIds: [],
          matchedSources: [],
          reason: "NOT_REQUIRED",
        }
      : legacyExternalVerification,
    legacyExternalVerification,
    prerequisiteTrace,
    staticBypassApplied,
  };
}

function skippedChannel(
  channel: RetrievalChannelV2,
  corpusBundleHash: string,
  reason: string,
): EvidenceChannelV2 {
  return EvidenceChannelV2Schema.parse({
    channel,
    status: "SKIPPED",
    reason,
    corpusBundleHash,
    identity: null,
    hitCount: 0,
    timingMs: 0,
  });
}

function failedChannel(
  channel: RetrievalChannelV2,
  corpusBundleHash: string,
  status: "UNAVAILABLE" | "TIMEOUT" | "ERROR",
  reason: string,
  timingMs: number,
): ChannelRetrievalResultV2 {
  return ChannelRetrievalResultV2Schema.parse({
    summary: {
      channel,
      status,
      reason,
      corpusBundleHash,
      identity: null,
      hitCount: 0,
      timingMs,
    },
    hits: [],
  });
}

function neededChannels(query: RetrievalQueryV2) {
  if (query.mode === "TEXT_TO_TEXT") {
    return new Set<RetrievalChannelV2>(["LEXICAL", "TEXT_VECTOR"]);
  }
  if (query.mode === "IMAGE_TO_IMAGE") {
    return new Set<RetrievalChannelV2>(["VISUAL_VECTOR"]);
  }
  return new Set<RetrievalChannelV2>(["LEXICAL", "TEXT_VECTOR", "VISUAL_VECTOR"]);
}

function providerFor(
  channel: RetrievalChannelV2,
  providers: ChannelProvidersV2,
) {
  if (channel === "LEXICAL") return providers.lexical;
  if (channel === "TEXT_VECTOR") return providers.textVector ?? null;
  return providers.visualVector ?? null;
}

async function runChannel(
  channel: RetrievalChannelV2,
  query: RetrievalQueryV2,
  dependencies: HybridRetrieverV2Dependencies,
  signal: AbortSignal | undefined,
): Promise<ChannelRetrievalResultV2> {
  const startedAt = (dependencies.now ?? performance.now.bind(performance))();
  const provider = providerFor(channel, dependencies.providers);
  if (!provider) {
    return failedChannel(
      channel,
      query.scope.corpusBundleHash,
      "UNAVAILABLE",
      "PROVIDER_UNAVAILABLE",
      0,
    );
  }
  try {
    const result = ChannelRetrievalResultV2Schema.parse(
      await provider.retrieve(query, { signal }),
    );
    if (
      result.summary.channel !== channel
      || result.summary.corpusBundleHash !== query.scope.corpusBundleHash
      || (
        result.summary.identity
        && result.summary.identity.activeIndexBundleHash
          !== dependencies.provenance.activeIndexBundleHash
      )
    ) {
      return failedChannel(
        channel,
        query.scope.corpusBundleHash,
        "ERROR",
        "INDEX_IDENTITY_MISMATCH",
        Math.max(0, (dependencies.now ?? performance.now.bind(performance))() - startedAt),
      );
    }
    for (const hit of result.hits) {
      const sourceCoursePack = dependencies.sourceCoursePackByObjectId.get(hit.objectId);
      if (
        (
          channel === "VISUAL_VECTOR"
          && (
            hit.assetId === null
            || hit.nodeId === null
            || hit.representationId === null
          )
        )
        || (
          channel !== "VISUAL_VECTOR"
          && (hit.assetId !== null || hit.region !== null)
        )
      ) {
        return failedChannel(
          channel,
          query.scope.corpusBundleHash,
          "ERROR",
          "INVALID_RESPONSE",
          Math.max(0, (dependencies.now ?? performance.now.bind(performance))() - startedAt),
        );
      }
      const expectedProjection = candidateProjectionForModeV2(query.mode);
      if (
        (
          expectedProjection === "NODE"
            ? (
                channel === "VISUAL_VECTOR"
                || hit.nodeId === null
                || hit.candidateId !== hit.nodeId
              )
            : hit.candidateId !== hit.objectId
        )
        || !sourceCoursePack
        || (
          query.scope.sourceCoursePack !== null
          && (
            sourceCoursePack.id !== query.scope.sourceCoursePack.id
            || sourceCoursePack.version !== query.scope.sourceCoursePack.version
          )
        )
      ) {
        return failedChannel(
          channel,
          query.scope.corpusBundleHash,
          "ERROR",
          "SCOPE_VIOLATION",
          Math.max(0, (dependencies.now ?? performance.now.bind(performance))() - startedAt),
        );
      }
    }
    for (const hit of result.visualAssetHits ?? []) {
      const sourceCoursePack = dependencies.sourceCoursePackByObjectId.get(hit.objectId);
      if (
        !sourceCoursePack
        || (
          query.scope.sourceCoursePack !== null
          && (
            sourceCoursePack.id !== query.scope.sourceCoursePack.id
            || sourceCoursePack.version !== query.scope.sourceCoursePack.version
          )
        )
      ) {
        return failedChannel(
          channel,
          query.scope.corpusBundleHash,
          "ERROR",
          "SCOPE_VIOLATION",
          Math.max(0, (dependencies.now ?? performance.now.bind(performance))() - startedAt),
        );
      }
    }
    return result;
  } catch {
    return failedChannel(
      channel,
      query.scope.corpusBundleHash,
      signal?.aborted ? "TIMEOUT" : "ERROR",
      signal?.aborted ? "REQUEST_ABORTED" : "INVALID_RESPONSE",
      Math.max(0, (dependencies.now ?? performance.now.bind(performance))() - startedAt),
    );
  }
}

async function runCaptionFallback(
  query: RetrievalQueryV2,
  dependencies: HybridRetrieverV2Dependencies,
  signal: AbortSignal | undefined,
): Promise<CaptionLexicalFallbackResultV2 | null> {
  const provider = dependencies.providers.captionFallback ?? null;
  if (!provider) return null;
  const startedAt = (dependencies.now ?? performance.now.bind(performance))();
  try {
    const parsed = CaptionLexicalFallbackResultV2Schema.parse(
      await provider.retrieve(query, { signal }),
    );
    if (
      parsed.summary.corpusBundleHash !== query.scope.corpusBundleHash
      || (
        parsed.summary.identity
        && parsed.summary.identity.activeIndexBundleHash
          !== dependencies.provenance.activeIndexBundleHash
      )
    ) {
      return failedChannel(
        "LEXICAL",
        query.scope.corpusBundleHash,
        "ERROR",
        "INDEX_IDENTITY_MISMATCH",
        Math.max(0, (dependencies.now ?? performance.now.bind(performance))() - startedAt),
      );
    }
    const hits = [...parsed.hits].sort((left, right) =>
      left.rank - right.rank || compareCodePoints(left.candidateId, right.candidateId));
    for (const hit of hits) {
      const sourceCoursePack = dependencies.sourceCoursePackByObjectId.get(hit.objectId);
      if (
        !sourceCoursePack
        || (
          query.scope.sourceCoursePack !== null
          && (
            sourceCoursePack.id !== query.scope.sourceCoursePack.id
            || sourceCoursePack.version !== query.scope.sourceCoursePack.version
          )
        )
        || query.excludeAssetIds.includes(hit.assetId!)
      ) {
        return failedChannel(
          "LEXICAL",
          query.scope.corpusBundleHash,
          "ERROR",
          "SCOPE_VIOLATION",
          Math.max(0, (dependencies.now ?? performance.now.bind(performance))() - startedAt),
        );
      }
    }
    return CaptionLexicalFallbackResultV2Schema.parse({ ...parsed, hits });
  } catch {
    return failedChannel(
      "LEXICAL",
      query.scope.corpusBundleHash,
      signal?.aborted ? "TIMEOUT" : "ERROR",
      signal?.aborted ? "REQUEST_ABORTED" : "INVALID_RESPONSE",
      Math.max(0, (dependencies.now ?? performance.now.bind(performance))() - startedAt),
    );
  }
}

function statusForPureImage(channel: EvidenceChannelV2): EvidenceBundleV2["status"] {
  if (channel.status === "TIMEOUT") return "TIMEOUT";
  if (channel.status === "UNAVAILABLE") return "UNSUPPORTED";
  if (channel.status === "ERROR") return "ERROR";
  return "EMPTY";
}

function isChannelFailure(status: EvidenceChannelV2["status"]) {
  return status === "UNAVAILABLE" || status === "TIMEOUT" || status === "ERROR";
}

function degradationSignals(
  query: RetrievalQueryV2,
  channels: readonly EvidenceChannelV2[],
) {
  const needed = neededChannels(query);
  const fallbackTriggers: string[] = [];
  const capabilitiesLost: EvidenceProvenanceV2["capabilitiesLost"] = [];
  for (const channel of channels) {
    if (!needed.has(channel.channel)) continue;
    if (channel.status === "SUCCESS" || channel.status === "EMPTY") continue;
    fallbackTriggers.push(`${channel.channel}_${channel.status}`);
    if (channel.channel === "LEXICAL") capabilitiesLost.push("LEXICAL");
    if (channel.channel === "TEXT_VECTOR") capabilitiesLost.push("TEXT_VECTOR");
    if (channel.channel === "VISUAL_VECTOR") {
      capabilitiesLost.push("VISUAL_VECTOR", "ASSET", "REGION");
    }
  }
  return {
    fallbackTriggers: uniqueSorted(fallbackTriggers),
    capabilitiesLost: uniqueSorted(capabilitiesLost),
  };
}

function retainedExternalCoverage(
  external: EvidenceProvenanceV2["externalVerification"],
  claims: readonly CorpusProvenanceClaimV2[],
  expansion: z.infer<typeof EvidenceExpansionV2Schema>,
) {
  if (!external.required) return true;
  const sourceById = new Map(expansion.sources.map((source) => [source.sourceId, source]));
  return external.matchedSources.every((matched) => {
    const claim = claims.find(({ sourceId }) => sourceId === matched.sourceId);
    const source = sourceById.get(matched.sourceId);
    return claim !== undefined
      && source !== undefined
      && source.objectId === claim.objectId
      && source.authority === "OFFICIAL"
      && source.verifiedDate === matched.verifiedDate;
  });
}

export function selectFinalSeedsV2(
  mode: RetrievalQueryV2["mode"],
  accepted: readonly FusedCandidateV2[],
  visualAssetHits: readonly VisualAssetCandidateV2[] = [],
) {
  const primaryLimit = HYBRID_RRF_CONFIG_V2.primaryLimit;
  const selectionStrategy =
    HYBRID_RRF_CONFIG_V2.finalPrimarySelectionByMode[mode];
  if (
    selectionStrategy
    === "STRONGEST_FUSED_NODE_PER_OBJECT_FIRST_WINS_MAX5"
  ) {
    const firstByObjectId = new Map<string, FusedCandidateV2>();
    for (const candidate of accepted) {
      if (!firstByObjectId.has(candidate.objectId)) {
        firstByObjectId.set(candidate.objectId, candidate);
      }
    }
    const selected = Array.from(firstByObjectId.values()).slice(0, primaryLimit);
    return selected.map((candidate, index) => ({
      ...candidate,
      fusedRank: index + 1,
    }));
  }
  if (
    selectionStrategy
    !== "RAW_VISUAL_TOP5_OBJECTS_THEN_FUSED_BACKFILL_MAX5"
  ) {
    throw new Error(`UNSUPPORTED_FINAL_PRIMARY_SELECTION:${selectionStrategy}`);
  }
  const acceptedByObjectId = new Map<string, FusedCandidateV2>();
  for (const candidate of accepted) {
    if (!acceptedByObjectId.has(candidate.objectId)) {
      acceptedByObjectId.set(candidate.objectId, candidate);
    }
  }
  const rawVisualObjectIds = Array.from(new Set(
    visualAssetHits
      .slice(0, HYBRID_RRF_CONFIG_V2.visualReservationPolicy.sourceLimit)
      .map(({ objectId }) => objectId),
  ));
  const selected: FusedCandidateV2[] = rawVisualObjectIds
    .flatMap((objectId) => {
      const candidate = acceptedByObjectId.get(objectId);
      return candidate ? [candidate] : [];
    })
    .slice(0, primaryLimit);
  const selectedIds = new Set(selected.map(({ candidateId }) => candidateId));
  for (const candidate of accepted) {
    if (selected.length >= primaryLimit) break;
    if (selectedIds.has(candidate.candidateId)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.candidateId);
  }
  return selected
    .sort((left, right) =>
      left.fusedRank - right.fusedRank
      || compareCodePoints(left.candidateId, right.candidateId))
    .map((candidate, index) => ({ ...candidate, fusedRank: index + 1 }));
}

function retainRawVisualObjectsInFusionV2(
  mode: RetrievalQueryV2["mode"],
  fused: readonly FusedCandidateV2[],
  visual: ChannelRetrievalResultV2,
) {
  if (!HYBRID_RRF_CONFIG_V2.visualReservationPolicy.modes.some(
    (candidateMode) => candidateMode === mode,
  )) {
    return [...fused];
  }
  const rawVisualObjectIds = Array.from(new Set(
    (visual.visualAssetHits ?? [])
      .slice(0, HYBRID_RRF_CONFIG_V2.visualReservationPolicy.sourceLimit)
      .map(({ objectId }) => objectId),
  ));
  if (rawVisualObjectIds.length === 0) return [...fused];
  const visualOnlyByObjectId = new Map(
    fuseRankedChannelsV2({ VISUAL_VECTOR: visual.hits })
      .map((candidate) => [candidate.objectId, candidate]),
  );
  const fusedByObjectId = new Map(fused.map((candidate) => [
    candidate.objectId,
    candidate,
  ]));
  const reserved = rawVisualObjectIds.flatMap((objectId) => {
    const candidate = fusedByObjectId.get(objectId)
      ?? visualOnlyByObjectId.get(objectId);
    return candidate ? [candidate] : [];
  });
  const reservedIds = new Set(reserved.map(({ candidateId }) => candidateId));
  const missingReserved = reserved.filter(({ candidateId }) =>
    !fused.some((candidate) => candidate.candidateId === candidateId));
  const dropCount = Math.max(
    0,
    fused.length
      + missingReserved.length
      - HYBRID_RRF_CONFIG_V2.visualReservationPolicy.reserveWithinFusedLimit,
  );
  const droppedIds = new Set(
    dropCount === 0
      ? []
      : fused
        .filter(({ candidateId }) => !reservedIds.has(candidateId))
        .slice(-dropCount)
        .map(({ candidateId }) => candidateId),
  );
  const retainedFused = fused.filter(({ candidateId }) => !droppedIds.has(candidateId));
  const selected: FusedCandidateV2[] = [];
  const selectedIds = new Set<string>();
  for (const candidate of [...retainedFused, ...missingReserved]) {
    if (
      selectedIds.has(candidate.candidateId)
      || selected.length
        >= HYBRID_RRF_CONFIG_V2.visualReservationPolicy.reserveWithinFusedLimit
    ) continue;
    selected.push(candidate);
    selectedIds.add(candidate.candidateId);
  }
  for (const candidate of fused) {
    if (
      selectedIds.has(candidate.candidateId)
      || selected.length
        >= HYBRID_RRF_CONFIG_V2.visualReservationPolicy.reserveWithinFusedLimit
    ) continue;
    selected.push(candidate);
    selectedIds.add(candidate.candidateId);
  }
  return selected.map((candidate, index) => ({
    ...candidate,
    fusedRank: index + 1,
  }));
}

type TrustedAssetRetrievalV2 = {
  assetId: string;
  objectId: string;
  channel: "VISUAL_VECTOR" | "CAPTION_LEXICAL";
  rank: number;
  representationId: string | null;
};

function snapshotTrustedAssetRetrievalV2(input: {
  channelResults: ReadonlyMap<RetrievalChannelV2, ChannelRetrievalResultV2>;
  captionFallbackHits: readonly ChannelCandidateV2[];
}) {
  const snapshot: TrustedAssetRetrievalV2[] = [];
  if (input.captionFallbackHits.length > 0) {
    for (const hit of [...input.captionFallbackHits].sort((left, right) =>
      left.rank - right.rank || compareCodePoints(left.assetId!, right.assetId!))) {
      snapshot.push({
        assetId: hit.assetId!,
        objectId: hit.objectId,
        channel: "CAPTION_LEXICAL",
        rank: hit.rank,
        representationId: null,
      });
    }
  } else {
    const visual = input.channelResults.get("VISUAL_VECTOR");
    const visualAssetHits = visual?.visualAssetHits ?? [];
    for (const hit of [...visualAssetHits].sort((left, right) =>
      left.rank - right.rank || compareCodePoints(left.assetId, right.assetId))) {
      snapshot.push({
        assetId: hit.assetId,
        objectId: hit.objectId,
        channel: "VISUAL_VECTOR",
        rank: hit.rank,
        representationId: hit.representationId,
      });
    }
  }
  return Object.freeze(snapshot.map((item) => Object.freeze({ ...item })));
}

function bindTrustedAssetRetrievalV2(input: {
  expansion: z.infer<typeof EvidenceExpansionV2Schema>;
  trustedAssetRetrievals: readonly TrustedAssetRetrievalV2[];
}) {
  const cleanAsset = (asset: EvidenceAssetV2): EvidenceAssetV2 => ({
    assetId: asset.assetId,
    objectId: asset.objectId,
    sha256: asset.sha256,
    mimeType: asset.mimeType,
    dimensions: asset.dimensions,
  });
  const byAssetId = new Map(
    input.expansion.assets.map((asset) => [asset.assetId, cleanAsset(asset)]),
  );
  const ranked: EvidenceAssetV2[] = [];
  const retained = new Set<string>();
  for (const trusted of input.trustedAssetRetrievals) {
    const asset = byAssetId.get(trusted.assetId);
    if (
      !asset
      || asset.objectId !== trusted.objectId
      || retained.has(asset.assetId)
    ) continue;
    retained.add(asset.assetId);
    ranked.push({
      ...asset,
      retrieval: {
        channel: trusted.channel,
        rank: trusted.rank,
        representationId: trusted.representationId,
      },
    });
  }
  return EvidenceExpansionV2Schema.parse({
    ...input.expansion,
    assets: [
      ...ranked,
      ...input.expansion.assets
        .filter(({ assetId }) => !retained.has(assetId))
        .map(cleanAsset),
    ],
  });
}

export function createHybridRetrieverV2(dependencies: HybridRetrieverV2Dependencies) {
  const sourceCoursePackByObjectId = new Map(
    Array.from(dependencies.sourceCoursePackByObjectId.entries()).map(([objectId, pack]) => [
      IdSchema.parse(objectId),
      CoursePackReferenceV2Schema.parse(pack),
    ]),
  );
  const assetIdByNodeId = new Map(
    Array.from(dependencies.assetIdByNodeId?.entries() ?? []).map(([nodeId, assetId]) => [
      IdSchema.parse(nodeId),
      IdSchema.parse(assetId),
    ]),
  );
  const runtimeDependencies: HybridRetrieverV2Dependencies = {
    ...dependencies,
    sourceCoursePackByObjectId,
    assetIdByNodeId,
  };
  const defaultAcceptancePolicy = createAcceptancePolicyV2();
  const policy = AcceptancePolicyV2Schema.parse(
    runtimeDependencies.acceptancePolicy ?? defaultAcceptancePolicy,
  );
  const capabilityBoundary = runtimeDependencies.capabilityBoundary ?? null;
  const coursePackVersions: Partial<Record<
    z.infer<typeof CoursePackReferenceV2Schema>["id"],
    string
  >> = {};
  const coursePackObjectCounts = new Map<
    z.infer<typeof CoursePackReferenceV2Schema>["id"],
    number
  >();
  for (const coursePack of sourceCoursePackByObjectId.values()) {
    const existing = coursePackVersions[coursePack.id];
    if (existing !== undefined && existing !== coursePack.version) {
      throw new Error(`course pack version drift:${coursePack.id}`);
    }
    coursePackVersions[coursePack.id] = coursePack.version;
    coursePackObjectCounts.set(
      coursePack.id,
      (coursePackObjectCounts.get(coursePack.id) ?? 0) + 1,
    );
  }
  let capabilityManifestVerified = false;
  const boundaryProvenance = (
    query: RetrievalQueryV2,
  ): Partial<EvidenceProvenanceV2> => (
    query.mode === "TEXT_TO_TEXT" && capabilityBoundary
      ? {
          capabilityEntityManifestHash:
            capabilityBoundary.manifest.configHash,
          packCompetitionPolicyHash:
            capabilityBoundary.policy?.configHash
              ?? capabilityBoundary.calibration.packCompetitionPolicyHash,
          packCompetitionCalibrationHash:
            capabilityBoundary.calibration.configHash,
          lexicalPackCompetitionAlgorithmHash:
            capabilityBoundary.runtimeIdentity
              .lexicalPackCompetitionAlgorithmHash,
          textPackCompetitionAlgorithmHash:
            capabilityBoundary.runtimeIdentity
              .textPackCompetitionAlgorithmHash,
        }
      : {}
  );
  const boundaryChannelStatus = (
    result: ChannelRetrievalResultV2 | undefined,
  ): "SUCCESS" | "EMPTY" | "UNAVAILABLE" | "TIMEOUT" | "ERROR" => {
    const status = result?.summary.status ?? "UNAVAILABLE";
    return status === "SKIPPED" ? "UNAVAILABLE" : status;
  };
  const sanitizePackCompetition = (
    query: RetrievalQueryV2,
    observation: ChannelRetrievalResultV2["packCompetition"],
  ): ChannelRetrievalResultV2["packCompetition"] => {
    if (!observation || observation.status !== "AVAILABLE") {
      return observation;
    }
    const diagnostics = observation.packCompetition;
    const expectedScopeId = query.scope.sourceCoursePack?.id ?? null;
    const declaredPackIds = new Set(
      diagnostics.perPackWinners.map(({ coursePackId }) =>
        coursePackId),
    );
    const valid = diagnostics.sourceScope.coursePackId === expectedScopeId
      && diagnostics.deduplicatedObjectCount
        === sourceCoursePackByObjectId.size
      && diagnostics.scoredRepresentationCount
        >= sourceCoursePackByObjectId.size
      && declaredPackIds.size === coursePackObjectCounts.size
      && Array.from(coursePackObjectCounts.keys()).every((coursePackId) =>
        declaredPackIds.has(coursePackId))
      && diagnostics.perPackWinners.every((winner) => {
        const owner = sourceCoursePackByObjectId.get(winner.objectId);
        return owner?.id === winner.coursePackId
          && owner.version === coursePackVersions[winner.coursePackId]
          && winner.objectCount
            === coursePackObjectCounts.get(winner.coursePackId);
      });
    return valid
      ? observation
      : {
          status: "INVALID",
          reason: "SCHEMA_INVALID",
          packCompetition: null,
        };
  };
  const applyConfiguredBoundary = (input: {
    query: RetrievalQueryV2;
    accepted: readonly FusedCandidateV2[];
    degradedLexicalFallback: boolean;
    channelResults?: ReadonlyMap<
      RetrievalChannelV2,
      ChannelRetrievalResultV2
    >;
  }): {
    accepted: FusedCandidateV2[];
    trace: CapabilityBoundaryTraceV2 | null;
  } => {
    if (input.query.mode !== "TEXT_TO_TEXT" || !capabilityBoundary) {
      return { accepted: [...input.accepted], trace: null };
    }
    if (!capabilityManifestVerified) {
      verifyCapabilityEntityManifestEvidenceV2(
        capabilityBoundary.manifest,
        {
          corpusBundleHash:
            capabilityBoundary.manifest.corpusBundleHash,
          objectCoursePacks: Array.from(
            sourceCoursePackByObjectId.entries(),
          ).map(([objectId, coursePack]) => ({
            objectId,
            coursePack,
          })),
        },
      );
      capabilityManifestVerified = true;
    }
    const lexicalResult = input.channelResults?.get("LEXICAL");
    const textResult = input.channelResults?.get("TEXT_VECTOR");
    const lexicalObservation = lexicalResult?.packCompetition;
    const textObservation = textResult?.packCompetition;
    const diagnostics =
      mapPackCompetitionObservationsToBoundaryDiagnosticsV2(
        {
          LEXICAL: lexicalObservation,
          TEXT_VECTOR: textObservation,
        },
        coursePackVersions,
      );
    const hasInvalidDiagnostics =
      lexicalObservation?.status === "INVALID"
      || textObservation?.status === "INVALID"
      || (
        lexicalObservation?.status === "AVAILABLE"
        && textObservation?.status === "AVAILABLE"
        && diagnostics === undefined
      );
    const result = applyCapabilityBoundaryV2({
      queryMode: input.query.mode,
      originalText: input.query.originalText,
      normalizedText: input.query.normalizedText,
      corpusBundleHash: input.query.scope.corpusBundleHash,
      lexicalConfigHash:
        capabilityBoundary.runtimeIdentity.lexicalConfigHash,
      normalizerConfigHash:
        runtimeDependencies.provenance.normalizerConfigHash,
      textProviderIndexBundleHash:
        capabilityBoundary.runtimeIdentity.textProviderIndexBundleHash,
      textModelId: capabilityBoundary.runtimeIdentity.textModelId,
      textModelRevision:
        capabilityBoundary.runtimeIdentity.textModelRevision,
      lexicalPackCompetitionAlgorithmHash:
        capabilityBoundary.runtimeIdentity
          .lexicalPackCompetitionAlgorithmHash,
      textPackCompetitionAlgorithmHash:
        capabilityBoundary.runtimeIdentity
          .textPackCompetitionAlgorithmHash,
      sourceCoursePack: input.query.scope.sourceCoursePack,
      acceptedCandidateIds: input.accepted.map(({ candidateId }) =>
        candidateId),
      degradedLexicalFallback: input.degradedLexicalFallback,
      channelStatuses: {
        LEXICAL: boundaryChannelStatus(lexicalResult),
        TEXT_VECTOR: boundaryChannelStatus(textResult),
      },
      acceptancePolicyHash: policy.configHash,
      ...(
        diagnostics
          ? { diagnostics }
          : hasInvalidDiagnostics
            ? { diagnostics: { invalid: true } }
            : {}
      ),
      manifest: capabilityBoundary.manifest,
      ...(capabilityBoundary.policy
        ? { policy: capabilityBoundary.policy }
        : {}),
      calibration: capabilityBoundary.calibration,
    });
    const acceptedIds = new Set(result.acceptedCandidateIds);
    return {
      accepted: input.accepted.filter(({ candidateId }) =>
        acceptedIds.has(candidateId)),
      trace: result.trace,
    };
  };
  const provenanceClaims = CorpusProvenanceClaimsV2Schema
    .parse(runtimeDependencies.corpusProvenanceClaims);
  const now = runtimeDependencies.now ?? performance.now.bind(performance);
  const queryDeadlineMs = z.number().int().min(1).max(30_000)
    .parse(runtimeDependencies.queryDeadlineMs ?? 5_000);

  const retrieveHybridV2Core = async function retrieveHybridV2Core(
    queryInput: RetrievalQueryV2,
    context: { signal?: AbortSignal } = {},
  ): Promise<EvidenceBundleV2> {
    const query = RetrievalQueryV2Schema.parse(queryInput);
    const startedAt = now();
    const externalVerification = (
      runtimeDependencies.externalVerificationEvaluator
      ?? evaluateExternalVerificationV2
    )(query, provenanceClaims);
    const requiredSourceIds = externalVerification.required
      ? externalVerification.matchedSourceIds
      : [];
    const requiredSourceClaims = provenanceClaims.filter(({ sourceId }) =>
      requiredSourceIds.includes(sourceId));
    const externallyAuthorizedObjectIds = new Set(
      provenanceClaims
        .filter(({ sourceId }) => requiredSourceIds.includes(sourceId))
        .map(({ objectId }) => objectId),
    );
    const baseProvenance = {
      corpusBundleHash: query.scope.corpusBundleHash,
      activeIndexBundleHash: runtimeDependencies.provenance.activeIndexBundleHash,
      relationConfigHash: runtimeDependencies.provenance.relationConfigHash,
      normalizerConfigHash: runtimeDependencies.provenance.normalizerConfigHash,
      rrfConfigHash: runtimeDependencies.provenance.rrfConfigHash,
      acceptancePolicyHash: policy.configHash,
      ...boundaryProvenance(query),
      graphExpansion: "POST_FUSION" as const,
      externalVerification,
    };
    if (externalVerification.required && !externalVerification.authorized) {
      const acceptance = applyPostFusionAcceptanceV2(query.mode, [], policy).trace;
      const boundary = applyConfiguredBoundary({
        query,
        accepted: [],
        degradedLexicalFallback: false,
      });
      return assembleEvidenceBundleV2({
        status: "EMPTY",
        query,
        channels: RetrievalChannelV2Schema.options.map((channel) =>
          skippedChannel(channel, query.scope.corpusBundleHash, "EXTERNAL_VERIFICATION_REQUIRED")),
        fused: [],
        acceptance,
        boundary: boundary.trace,
        expansion: emptyEvidenceExpansionV2(),
        provenance: {
          ...baseProvenance,
          fallbackTriggers: ["EXTERNAL_VERIFICATION_REQUIRED"],
          capabilitiesLost: [],
        },
        timing: {
          retrievalMs: 0,
          expansionMs: 0,
          totalMs: Math.max(0, now() - startedAt),
        },
      });
    }
    const needed = neededChannels(query);
    const retrievalStartedAt = now();
    const channelEntries = await Promise.all(
      RetrievalChannelV2Schema.options.map(async (channel) => {
        if (!needed.has(channel)) {
          const skippedResult: ChannelRetrievalResultV2 = {
            summary: skippedChannel(
              channel,
              query.scope.corpusBundleHash,
              "MODE_NOT_APPLICABLE",
            ),
            hits: [],
          };
          return [
            channel,
            skippedResult,
          ] as const;
        }
        return [
          channel,
          await runChannel(channel, query, runtimeDependencies, context.signal)
            .then((result) => ChannelRetrievalResultV2Schema.parse({
              ...result,
              ...(result.packCompetition
                ? {
                    packCompetition: sanitizePackCompetition(
                      query,
                      result.packCompetition,
                    ),
                  }
                : {}),
            })),
        ] as const;
      }),
    );
    const retrievalMs = Math.max(0, now() - retrievalStartedAt);
    const channelResults = new Map<RetrievalChannelV2, ChannelRetrievalResultV2>(channelEntries);
    if (
      query.mode === "TEXT_TO_TEXT"
      && isChannelFailure(channelResults.get("TEXT_VECTOR")!.summary.status)
      && runtimeDependencies.providers.frozenLexicalFallback
    ) {
      const fallbackDependencies: HybridRetrieverV2Dependencies = {
        ...runtimeDependencies,
        providers: {
          ...runtimeDependencies.providers,
          lexical: runtimeDependencies.providers.frozenLexicalFallback,
        },
      };
      channelResults.set(
        "LEXICAL",
        await runChannel("LEXICAL", query, fallbackDependencies, context.signal),
      );
    }
    const initialVisual = channelResults.get("VISUAL_VECTOR")!.summary;
    const captionFallbackResult = query.mode === "TEXT_TO_IMAGE"
      && isChannelFailure(initialVisual.status)
      ? await runCaptionFallback(query, runtimeDependencies, context.signal)
      : null;
    const captionFallbackHits = captionFallbackResult?.summary.status === "SUCCESS"
      ? [...captionFallbackResult.hits]
      : [];
    const captionObjectHits = new Map<string, ChannelCandidateV2>();
    for (const hit of captionFallbackHits) {
      if (!captionObjectHits.has(hit.objectId)) {
        captionObjectHits.set(hit.objectId, {
          ...hit,
          candidateId: hit.objectId,
        });
      }
    }
    if (captionFallbackHits.length > 0) {
      const hits = Array.from(captionObjectHits.values()).map((hit, index) => ({
        ...hit,
        rank: index + 1,
      }));
      channelResults.set("LEXICAL", ChannelRetrievalResultV2Schema.parse({
        summary: {
          ...captionFallbackResult!.summary,
          hitCount: hits.length,
        },
        hits,
      }));
    }
    for (const channel of RetrievalChannelV2Schema.options) {
      const current = channelResults.get(channel)!;
      if (current.summary.status !== "SUCCESS") continue;
      const hits = current.hits
        .filter(({ objectId }) =>
          !externalVerification.required
          || externallyAuthorizedObjectIds.has(objectId))
        .filter(({ nodeId, assetId }) =>
          !query.excludeAssetIds.includes(assetId ?? "")
          && (
            nodeId === null
            || !query.excludeAssetIds.includes(assetIdByNodeId.get(nodeId) ?? "")
          ))
        .map((hit, index) => ({ ...hit, rank: index + 1 }));
      const retainedObjectIds = new Set(hits.map(({ objectId }) => objectId));
      const visualAssetHits = current.visualAssetHits
        ?.filter(({ objectId, nodeId, assetId }) =>
          retainedObjectIds.has(objectId)
          && !query.excludeAssetIds.includes(assetId)
          && !query.excludeAssetIds.includes(assetIdByNodeId.get(nodeId) ?? ""))
        .map((hit, index) => ({ ...hit, rank: index + 1 }));
      const objectCandidates = current.objectCandidates
        ?.flatMap((candidate) => {
          const owner = sourceCoursePackByObjectId.get(candidate.objectId);
          const ownerMatchesCandidate =
            owner?.id === candidate.coursePackId;
          const inCourseScope = ownerMatchesCandidate
            && (
              query.scope.sourceCoursePack === null
              || (
                owner.id === query.scope.sourceCoursePack.id
                && owner.version === query.scope.sourceCoursePack.version
              )
            );
          if (
            !inCourseScope
            || (
              externalVerification.required
              && !externallyAuthorizedObjectIds.has(candidate.objectId)
            )
          ) {
            return [];
          }
          const nodes = candidate.nodes
            .filter(({ nodeId }) =>
              !query.excludeAssetIds.includes(
                assetIdByNodeId.get(nodeId) ?? "",
              ))
            .map((node, index) => ({ ...node, innerRank: index + 1 }));
          return nodes.length === 0
            ? []
            : [{
                ...candidate,
                rawScore: nodes[0]!.rawScore,
                nodes,
              }];
        })
        .map((candidate, index) => ({
          ...candidate,
          objectRank: index + 1,
        }));
      channelResults.set(channel, ChannelRetrievalResultV2Schema.parse({
        ...current,
        summary: {
          ...current.summary,
          status: hits.length > 0 ? "SUCCESS" : "EMPTY",
          hitCount: hits.length,
        },
        hits,
        ...(visualAssetHits ? { visualAssetHits } : {}),
        ...(objectCandidates ? { objectCandidates } : {}),
      }));
    }
    let objectConsensusTrace: ObjectConsensusTraceV2 | null = null;
    let objectConsensusSourceChannelResults:
      | ReadonlyMap<RetrievalChannelV2, ChannelRetrievalResultV2>
      | null = null;
    if (
      runtimeDependencies.textObjectConsensusEnabled !== false
      && policy.configHash === defaultAcceptancePolicy.configHash
      && query.mode === "TEXT_TO_TEXT"
      && query.scope.sourceCoursePack !== null
      && captionFallbackHits.length === 0
      && channelResults.get("LEXICAL")!.summary.status === "SUCCESS"
      && channelResults.get("TEXT_VECTOR")!.summary.status === "SUCCESS"
    ) {
      const lexicalResult = channelResults.get("LEXICAL")!;
      const textResult = channelResults.get("TEXT_VECTOR")!;
      objectConsensusSourceChannelResults = new Map([
        ["LEXICAL", structuredClone(lexicalResult)],
        ["TEXT_VECTOR", structuredClone(textResult)],
      ]);
      const consensus = resolveTextObjectConsensusV2({
        lexicalHits: lexicalResult.hits,
        textVectorHits: textResult.hits,
        lexicalObjects: lexicalResult.objectCandidates ?? [],
        textVectorObjects: textResult.objectCandidates ?? [],
      });
      objectConsensusTrace = ObjectConsensusTraceV2Schema.parse(
        consensus.trace,
      );
      if (consensus.applied) {
        for (const channel of ["LEXICAL", "TEXT_VECTOR"] as const) {
          const current = channelResults.get(channel)!;
          const hits = consensus.rankings[channel];
          channelResults.set(channel, ChannelRetrievalResultV2Schema.parse({
            ...current,
            summary: {
              ...current.summary,
              status: hits.length > 0 ? "SUCCESS" : "EMPTY",
              hitCount: hits.length,
            },
            hits,
          }));
        }
      }
    }
    const channels = RetrievalChannelV2Schema.options.map((channel) =>
      channelResults.get(channel)!.summary);
    const rankings = Object.fromEntries(
      RetrievalChannelV2Schema.options.map((channel) => [
        channel,
        captionFallbackHits.length > 0 && channel === "TEXT_VECTOR"
          ? []
          : channelResults.get(channel)!.summary.status === "SUCCESS"
          ? channelResults.get(channel)!.hits
          : [],
      ]),
    ) as Record<RetrievalChannelV2, ChannelCandidateV2[]>;
    const fusedBase = fuseRankedChannelsV2(rankings);
    const fused = query.mode === "TEXT_TO_TEXT"
      ? fusedBase
      : retainRawVisualObjectsInFusionV2(
          query.mode,
          fusedBase,
          channelResults.get("VISUAL_VECTOR")!,
        );
    let acceptanceResult = applyPostFusionAcceptanceV2(query.mode, fused, policy);
    const visual = channelResults.get("VISUAL_VECTOR")!.summary;
    const lexical = channelResults.get("LEXICAL")!.summary;
    const allowLexicalFallback = query.normalizedText !== null
      && lexical.status === "SUCCESS"
      && (
        (query.mode === "TEXT_TO_TEXT"
          && isChannelFailure(channelResults.get("TEXT_VECTOR")!.summary.status))
        || (
          query.mode === "TEXT_TO_IMAGE"
          && captionFallbackHits.length > 0
          && isChannelFailure(visual.status)
        )
        || (
          query.mode === "IMAGE_TEXT_TO_EVIDENCE"
          && isChannelFailure(visual.status)
        )
      );
    if (acceptanceResult.accepted.length === 0 && allowLexicalFallback) {
      acceptanceResult = applyPostFusionAcceptanceV2(
        query.mode,
        fused,
        policy,
        { degradedLexicalFallback: true },
      );
    }
    const boundaryResult = applyConfiguredBoundary({
      query,
      accepted: acceptanceResult.accepted,
      degradedLexicalFallback:
        acceptanceResult.trace.degradedLexicalFallback,
      channelResults,
    });
    const boundaryAccepted = boundaryResult.accepted;
    const signals = degradationSignals(query, channels);
    if (captionFallbackResult) {
      signals.fallbackTriggers.push(
        `CAPTION_LEXICAL_FALLBACK_${captionFallbackResult.summary.status}`,
      );
    }
    const postRetrievalBaseProvenance = captionFallbackResult
      ? { ...baseProvenance, captionFallback: captionFallbackResult.summary }
      : baseProvenance;
    if (acceptanceResult.trace.degradedLexicalFallback) {
      const unavailableChannel = query.mode === "TEXT_TO_TEXT"
        ? channelResults.get("TEXT_VECTOR")!.summary
        : visual;
      signals.fallbackTriggers.push(
        `${unavailableChannel.channel}_${unavailableChannel.status}`,
      );
      if (unavailableChannel.channel === "TEXT_VECTOR") {
        signals.capabilitiesLost.push("TEXT_VECTOR");
      } else {
        signals.capabilitiesLost.push("VISUAL_VECTOR", "ASSET", "REGION");
      }
    }
    if (query.mode === "IMAGE_TO_IMAGE" && visual.status !== "SUCCESS") {
      return assembleEvidenceBundleV2({
        status: statusForPureImage(visual),
        query,
        channels,
        fused: [],
        acceptance: acceptanceResult.trace,
        boundary: boundaryResult.trace,
        objectConsensus: objectConsensusTrace,
        expansion: emptyEvidenceExpansionV2(),
        provenance: {
          ...postRetrievalBaseProvenance,
          ...signals,
        },
        timing: {
          retrievalMs,
          expansionMs: 0,
          totalMs: Math.max(retrievalMs, now() - startedAt),
        },
      });
    }
    if (context.signal?.aborted) {
      return assembleEvidenceBundleV2({
        status: "TIMEOUT",
        query,
        channels,
        fused: [],
        acceptance: acceptanceResult.trace,
        boundary: boundaryResult.trace,
        objectConsensus: objectConsensusTrace,
        expansion: emptyEvidenceExpansionV2(),
        provenance: {
          ...postRetrievalBaseProvenance,
          fallbackTriggers: uniqueSorted([
            ...signals.fallbackTriggers,
            "REQUEST_ABORTED",
          ]),
          capabilitiesLost: uniqueSorted(signals.capabilitiesLost),
        },
        timing: {
          retrievalMs,
          expansionMs: 0,
          totalMs: Math.max(retrievalMs, now() - startedAt),
        },
      });
    }

    let finalSeeds = selectFinalSeedsV2(
      query.mode,
      boundaryAccepted,
      channelResults.get("VISUAL_VECTOR")?.visualAssetHits ?? [],
    );
    const expansionChannelResults = new Map(
      Array.from(channelResults.entries()).filter(([, result]) =>
        result.summary.status !== "SKIPPED"),
    );
    const trustedAssetRetrievals = snapshotTrustedAssetRetrievalV2({
      channelResults: expansionChannelResults,
      captionFallbackHits,
    });
    const createExpanderInput = () => ({
      query: structuredClone(query),
      seeds: structuredClone(finalSeeds),
      channelResults: new Map(
        Array.from(expansionChannelResults.entries()).map(([channel, result]) => [
          channel,
          structuredClone(result),
        ]),
      ),
      requiredSourceIds: [...requiredSourceIds],
      requiredSourceClaims: structuredClone(requiredSourceClaims),
      requiredClaimKinds: [...externalVerification.claimKinds],
      captionFallbackHits: structuredClone(captionFallbackHits),
      objectConsensus: objectConsensusTrace
        ? structuredClone(objectConsensusTrace)
        : null,
      ...(objectConsensusSourceChannelResults
        ? {
            objectConsensusSourceChannelResults: new Map(
              Array.from(objectConsensusSourceChannelResults.entries()).map(
                ([channel, result]) => [
                  channel,
                  structuredClone(result),
                ],
              ),
            ),
          }
        : {}),
    });
    let expansion = emptyEvidenceExpansionV2();
    let expansionFailed = false;
    const expansionStartedAt = now();
    if (finalSeeds.length > 0) {
      try {
        expansion = EvidenceExpansionV2Schema.parse(
          await runtimeDependencies.graphExpander.expand(
            createExpanderInput(),
            { signal: context.signal },
          ),
        );
        for (const seed of finalSeeds) {
          const owners = expansion.nodes.filter((node) =>
            node.relation === "PRIMARY"
            && node.seedCandidateId === seed.candidateId
            && node.objectId === seed.objectId);
          if (owners.length !== 1) throw new Error("missing primary owner");
          if (
            requiredSourceIds.length > 0
            && !expansion.sources.some((source) =>
              source.objectId === seed.objectId
              && source.authority === "OFFICIAL"
              && requiredSourceIds.includes(source.sourceId)
              && externalVerification.matchedSources.some((matched) =>
                matched.sourceId === source.sourceId
                && matched.verifiedDate === source.verifiedDate))
          ) {
            throw new Error("missing verified authoritative source");
          }
        }
      } catch {
        try {
          expansion = EvidenceExpansionV2Schema.parse(
            await runtimeDependencies.graphExpander.resolvePrimaries(
              createExpanderInput(),
              { signal: context.signal },
            ),
          );
          if (expansion.nodes.some(({ relation }) => relation !== "PRIMARY")) {
            throw new Error("primary fallback cannot add graph context");
          }
          for (const seed of finalSeeds) {
            const owners = expansion.nodes.filter((node) =>
              node.relation === "PRIMARY"
              && node.seedCandidateId === seed.candidateId
              && node.objectId === seed.objectId);
            if (owners.length !== 1) throw new Error("missing fallback primary owner");
            if (
              requiredSourceIds.length > 0
              && !expansion.sources.some((source) =>
                source.objectId === seed.objectId
                && source.authority === "OFFICIAL"
                && requiredSourceIds.includes(source.sourceId)
                && externalVerification.matchedSources.some((matched) =>
                  matched.sourceId === source.sourceId
                  && matched.verifiedDate === source.verifiedDate))
            ) {
              throw new Error("missing fallback authoritative source");
            }
          }
          expansionFailed = true;
        } catch {
          expansion = emptyEvidenceExpansionV2();
          expansionFailed = true;
        }
      }
    }
    expansion = bindTrustedAssetRetrievalV2({
      expansion,
      trustedAssetRetrievals,
    });
    const expansionMs = Math.max(0, now() - expansionStartedAt);
    if (expansionFailed) {
      signals.fallbackTriggers.push("RELATION_EXPANSION_ERROR");
      signals.capabilitiesLost.push("GRAPH_CONTEXT");
    }
    if (
      externalVerification.required
      && !retainedExternalCoverage(externalVerification, provenanceClaims, expansion)
    ) {
      return assembleEvidenceBundleV2({
        status: "EMPTY",
        query,
        channels,
        fused: [],
        acceptance: acceptanceResult.trace,
        boundary: boundaryResult.trace,
        objectConsensus: objectConsensusTrace,
        expansion: emptyEvidenceExpansionV2(),
        provenance: {
          ...postRetrievalBaseProvenance,
          externalVerification: {
            ...externalVerification,
            authorized: false,
            reason: "EXTERNAL_VERIFICATION_REQUIRED",
          },
          fallbackTriggers: uniqueSorted([
            ...signals.fallbackTriggers,
            "EXTERNAL_VERIFICATION_REQUIRED",
          ]),
          capabilitiesLost: uniqueSorted(signals.capabilitiesLost),
        },
        timing: {
          retrievalMs,
          expansionMs,
          totalMs: Math.max(retrievalMs + expansionMs, now() - startedAt),
        },
      });
    }
    const preAdequacyStatus: EvidenceBundleV2["status"] =
      finalSeeds.length === 0
      ? "EMPTY"
      : expansionFailed
        || acceptanceResult.trace.degradedLexicalFallback
        || signals.fallbackTriggers.length > 0
        ? "DEGRADED"
        : "SUCCESS";
    const hasAssetEvidence = expansion.assets.some(({ assetId }) =>
      assetId !== query.queryAsset?.assetId);
    const hasTextEvidence = expansion.nodes.some(({ kind }) =>
      ["DOCUMENT", "SECTION", "TEXT", "TABLE"].includes(kind));
    const evidenceShapeDegraded = finalSeeds.length > 0 && (
      (
        ["TEXT_TO_IMAGE", "IMAGE_TO_IMAGE", "IMAGE_TEXT_TO_EVIDENCE"].includes(query.mode)
        && !hasAssetEvidence
      )
      || (
        ["TEXT_TO_TEXT", "IMAGE_TEXT_TO_EVIDENCE"].includes(query.mode)
        && !hasTextEvidence
      )
    );
    if (evidenceShapeDegraded) {
      signals.fallbackTriggers.push("EVIDENCE_MODALITY_MISSING");
      if (
        ["TEXT_TO_IMAGE", "IMAGE_TO_IMAGE", "IMAGE_TEXT_TO_EVIDENCE"].includes(query.mode)
        && !hasAssetEvidence
      ) {
        signals.capabilitiesLost.push("ASSET", "REGION");
      }
      if (
        ["TEXT_TO_TEXT", "IMAGE_TEXT_TO_EVIDENCE"].includes(query.mode)
        && !hasTextEvidence
      ) {
        signals.capabilitiesLost.push("TEXT_EVIDENCE");
      }
    }
    let queryEvidenceAdequacyTrace:
      | QueryEvidenceAdequacyTraceV2
      | null = null;
    let adequacyMs = 0;
    const queryEvidenceAdequacy =
      runtimeDependencies.queryEvidenceAdequacy ?? null;
    const lexicalForAttestation =
      objectConsensusSourceChannelResults?.get("LEXICAL");
    const textForAttestation =
      objectConsensusSourceChannelResults?.get("TEXT_VECTOR");
    const acceptedCandidateIds =
      boundaryResult.trace?.acceptedCandidateIdsAfter ?? [];
    const adequacyApplicable =
      queryEvidenceAdequacy !== null
      && query.mode === "TEXT_TO_TEXT"
      && query.scope.sourceCoursePack !== null
      && externalVerification.required === false
      && preAdequacyStatus === "SUCCESS"
      && !evidenceShapeDegraded
      && signals.fallbackTriggers.length === 0
      && channelResults.get("LEXICAL")?.summary.status === "SUCCESS"
      && channelResults.get("TEXT_VECTOR")?.summary.status === "SUCCESS"
      && acceptedCandidateIds.length >= 1
      && acceptedCandidateIds.length <= 5
      && finalSeeds.length >= 1
      && finalSeeds.length <= 5
      && objectConsensusTrace !== null
      && lexicalForAttestation !== undefined
      && textForAttestation !== undefined;
    if (adequacyApplicable) {
      if (
        queryEvidenceAdequacy === null
        || objectConsensusTrace === null
        || lexicalForAttestation === undefined
        || textForAttestation === undefined
      ) {
        throw new Error(
          "QUERY_EVIDENCE_ADEQUACY_APPLICABILITY_INVARIANT",
        );
      }
      const adequacyStartedAt = now();
      const gated = applyQueryEvidenceAdequacyV2({
        runtime: queryEvidenceAdequacy,
        query,
        seeds: finalSeeds,
        expansion,
        retrievalAttestation: {
          lexicalResultHash:
            sha256StableJsonV2(lexicalForAttestation),
          textVectorResultHash:
            sha256StableJsonV2(textForAttestation),
          objectRankingHash: sha256StableJsonV2(
            objectConsensusTrace.objectRanking,
          ),
          objectConsensusTraceHash:
            sha256StableJsonV2(objectConsensusTrace),
          finalSeedsHash: sha256StableJsonV2(finalSeeds),
        },
        signal: context.signal,
      });
      adequacyMs = Math.max(0, now() - adequacyStartedAt);
      finalSeeds = gated.seeds;
      expansion = gated.expansion;
      queryEvidenceAdequacyTrace = gated.trace;
    }
    const status: EvidenceBundleV2["status"] =
      queryEvidenceAdequacyTrace?.decision === "EMPTY"
        ? "EMPTY"
        : preAdequacyStatus;
    const adequacyProvenance =
      queryEvidenceAdequacyTrace === null
        ? {}
        : {
            queryEvidenceAdequacyPolicyHash:
              queryEvidenceAdequacyTrace.identity
                .queryEvidenceAdequacyPolicyHash,
            queryEvidenceFeatureAlgorithmHash:
              queryEvidenceAdequacyTrace.identity
                .queryEvidenceFeatureAlgorithmHash,
            queryAnchorCorpusStatsHash:
              queryEvidenceAdequacyTrace.identity
                .queryAnchorCorpusStatsHash,
            primaryEvidenceBindingAlgorithmHash:
              queryEvidenceAdequacyTrace.identity
                .primaryEvidenceBindingAlgorithmHash,
          };
    const finalTiming = {
      retrievalMs,
      expansionMs,
      ...(queryEvidenceAdequacyTrace
        ? { adequacyMs }
        : {}),
      totalMs: Math.max(
        retrievalMs + expansionMs + adequacyMs,
        now() - startedAt,
      ),
    };
    try {
      return assembleEvidenceBundleV2({
        status: evidenceShapeDegraded ? "DEGRADED" : status,
        query,
        channels,
        fused: expansion.nodes.length === 0 ? [] : finalSeeds,
        acceptance: acceptanceResult.trace,
        boundary: boundaryResult.trace,
        objectConsensus: objectConsensusTrace,
        queryEvidenceAdequacy: queryEvidenceAdequacyTrace,
        expansion,
        provenance: {
          ...postRetrievalBaseProvenance,
          ...adequacyProvenance,
          fallbackTriggers: uniqueSorted(signals.fallbackTriggers),
          capabilitiesLost: uniqueSorted(signals.capabilitiesLost),
        },
        timing: finalTiming,
      });
    } catch (error) {
      if (
        queryEvidenceAdequacyTrace !== null
        || expansionFailed
        || finalSeeds.length === 0
      ) {
        throw error;
      }
      return assembleEvidenceBundleV2({
        status: "DEGRADED",
        query,
        channels,
        fused: [],
        acceptance: acceptanceResult.trace,
        boundary: boundaryResult.trace,
        objectConsensus: objectConsensusTrace,
        expansion: emptyEvidenceExpansionV2(),
        provenance: {
          ...postRetrievalBaseProvenance,
          fallbackTriggers: uniqueSorted([
            ...signals.fallbackTriggers,
            "RELATION_EXPANSION_ERROR",
          ]),
          capabilitiesLost: uniqueSorted([
            ...signals.capabilitiesLost,
            "GRAPH_CONTEXT",
          ]),
        },
        timing: finalTiming,
      });
    }
  };

  return async function retrieveHybridV2(
    queryInput: RetrievalQueryV2,
    context: { signal?: AbortSignal } = {},
  ): Promise<EvidenceBundleV2> {
    const query = RetrievalQueryV2Schema.parse(queryInput);
    const deadlineController = new AbortController();
    let deadlineReached = false;
    const deadline = setTimeout(() => {
      deadlineReached = true;
      deadlineController.abort(new Error("QUERY_DEADLINE_EXCEEDED"));
    }, queryDeadlineMs);
    const signal = context.signal
      ? AbortSignal.any([context.signal, deadlineController.signal])
      : deadlineController.signal;
    const startedAt = now();
    const deadlineBundle = () => {
      const external = evaluateExternalVerificationV2(query, provenanceClaims);
      const deadlineExternal = external.required
        ? {
            ...external,
            authorized: false,
            reason: "EXTERNAL_VERIFICATION_REQUIRED" as const,
          }
        : external;
      const channelResults = RetrievalChannelV2Schema.options.map((channel) =>
        neededChannels(query).has(channel)
          ? failedChannel(
              channel,
              query.scope.corpusBundleHash,
              "TIMEOUT",
              deadlineReached ? "QUERY_DEADLINE_EXCEEDED" : "REQUEST_ABORTED",
              Math.max(0, now() - startedAt),
            ).summary
          : skippedChannel(channel, query.scope.corpusBundleHash, "MODE_NOT_APPLICABLE"));
      const acceptance = applyPostFusionAcceptanceV2(query.mode, [], policy).trace;
      const boundary = applyConfiguredBoundary({
        query,
        accepted: [],
        degradedLexicalFallback: false,
      });
      const signals = degradationSignals(query, channelResults);
      return assembleEvidenceBundleV2({
        status: "TIMEOUT",
        query,
        channels: channelResults,
        fused: [],
        acceptance,
        boundary: boundary.trace,
        expansion: emptyEvidenceExpansionV2(),
        provenance: {
          corpusBundleHash: query.scope.corpusBundleHash,
          activeIndexBundleHash: runtimeDependencies.provenance.activeIndexBundleHash,
          relationConfigHash: runtimeDependencies.provenance.relationConfigHash,
          normalizerConfigHash: runtimeDependencies.provenance.normalizerConfigHash,
          rrfConfigHash: runtimeDependencies.provenance.rrfConfigHash,
          acceptancePolicyHash: policy.configHash,
          ...boundaryProvenance(query),
          graphExpansion: "POST_FUSION",
          externalVerification: deadlineExternal,
          fallbackTriggers: uniqueSorted([
            ...signals.fallbackTriggers,
            deadlineReached ? "QUERY_DEADLINE_EXCEEDED" : "REQUEST_ABORTED",
          ]),
          capabilitiesLost: uniqueSorted(signals.capabilitiesLost),
        },
        timing: {
          retrievalMs: Math.max(0, now() - startedAt),
          expansionMs: 0,
          totalMs: Math.max(0, now() - startedAt),
        },
      });
    };
    let abortListener: (() => void) | null = null;
    const aborted = new Promise<EvidenceBundleV2>((resolve) => {
      abortListener = () => resolve(deadlineBundle());
      if (signal.aborted) abortListener();
      else signal.addEventListener("abort", abortListener, { once: true });
    });
    try {
      return await Promise.race([
        retrieveHybridV2Core(query, { signal }),
        aborted,
      ]);
    } finally {
      clearTimeout(deadline);
      if (abortListener) signal.removeEventListener("abort", abortListener);
    }
  };
}
