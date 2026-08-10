import { createHash } from "node:crypto";

import { z } from "zod";

import { RetrievalModeV2Schema, type RetrievalModeV2 } from "./retrieval-query-v2";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IdSchema = z.string().regex(ID_PATTERN, "expected a stable lowercase identifier");
const HashSchema = z.string().regex(HASH_PATTERN, "expected a lowercase sha256 hash");

export const RetrievalChannelV2Schema = z.enum([
  "LEXICAL",
  "TEXT_VECTOR",
  "VISUAL_VECTOR",
]);

const RetrievalRegionV2Schema = z
  .object({
    coordinateSpace: z.literal("NORMALIZED"),
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().gt(0).max(1),
    height: z.number().finite().gt(0).max(1),
    origin: z.enum(["INDEXED_REGION", "PATCH_MATCH"]),
  })
  .strict()
  .superRefine((region, context) => {
    if (region.x + region.width > 1 || region.y + region.height > 1) {
      context.addIssue({
        code: "custom",
        message: "normalized region must stay inside the image",
      });
    }
  });

export const ChannelCandidateV2Schema = z
  .object({
    candidateId: IdSchema,
    objectId: IdSchema,
    representationId: IdSchema.nullable(),
    nodeId: IdSchema.nullable(),
    assetId: IdSchema.nullable(),
    region: RetrievalRegionV2Schema.nullable(),
    rank: z.number().int().min(1).max(20),
    rawScore: z.number().finite().nullable(),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.region !== null && candidate.assetId === null) {
      context.addIssue({
        code: "custom",
        message: "region candidates require an asset",
        path: ["region"],
      });
    }
  });

export const FusionChannelTraceV2Schema = z
  .object({
    channel: RetrievalChannelV2Schema,
    rank: z.number().int().min(1).max(20),
    contribution: z.number().finite().positive(),
    rawScore: z.number().finite().nullable(),
    representationId: IdSchema.nullable(),
    nodeId: IdSchema.nullable(),
    assetId: IdSchema.nullable(),
    region: RetrievalRegionV2Schema.nullable(),
  })
  .strict();

export const FusedCandidateV2Schema = z
  .object({
    candidateId: IdSchema,
    objectId: IdSchema,
    fusedRank: z.number().int().min(1).max(10),
    fusionScore: z.number().finite().positive(),
    channelTraces: z.array(FusionChannelTraceV2Schema).min(1).max(3),
  })
  .strict();

export const RRF_K_V2 = 60;
export const RRF_CHANNEL_LIMIT_V2 = 20;
export const RRF_FUSED_LIMIT_V2 = 10;
export const RRF_WEIGHTS_V2 = Object.freeze({
  LEXICAL: 1,
  TEXT_VECTOR: 1,
  VISUAL_VECTOR: 1,
} satisfies Record<z.infer<typeof RetrievalChannelV2Schema>, number>);

export const CANDIDATE_PROJECTION_BY_MODE_V2 = Object.freeze({
  TEXT_TO_TEXT: "NODE",
  TEXT_TO_IMAGE: "OBJECT",
  IMAGE_TO_IMAGE: "OBJECT",
  IMAGE_TEXT_TO_EVIDENCE: "OBJECT",
} as const satisfies Record<RetrievalModeV2, "NODE" | "OBJECT">);

export type CandidateProjectionV2 =
  (typeof CANDIDATE_PROJECTION_BY_MODE_V2)[RetrievalModeV2];

export function candidateProjectionForModeV2(
  mode: RetrievalModeV2,
): CandidateProjectionV2 {
  return CANDIDATE_PROJECTION_BY_MODE_V2[RetrievalModeV2Schema.parse(mode)];
}

const ChannelRequirementV2Schema = z
  .array(RetrievalChannelV2Schema)
  .min(1)
  .max(3)
  .superRefine((channels, context) => {
    if (new Set(channels).size !== channels.length) {
      context.addIssue({ code: "custom", message: "required channels must be unique" });
    }
  });

const AcceptancePolicyInputV2Schema = z
  .object({
    id: IdSchema,
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    eligibleMaxRank: z.number().int().min(1).max(20),
    requirementsByMode: z
      .object({
        TEXT_TO_TEXT: z.array(ChannelRequirementV2Schema).min(1).max(3),
        TEXT_TO_IMAGE: z.array(ChannelRequirementV2Schema).min(1).max(3),
        IMAGE_TO_IMAGE: z.array(ChannelRequirementV2Schema).min(1).max(3),
        IMAGE_TEXT_TO_EVIDENCE: z.array(ChannelRequirementV2Schema).min(1).max(3),
      })
      .strict(),
  })
  .strict();

export const AcceptancePolicyV2Schema = AcceptancePolicyInputV2Schema.extend({
  configHash: HashSchema,
}).strict();

export const AcceptanceSignalV2Schema = z
  .object({
    channel: RetrievalChannelV2Schema,
    rank: z.number().int().min(1).max(20),
    rawScore: z.number().finite().nullable(),
    modeEligible: z.boolean(),
    fallbackEligible: z.boolean(),
  })
  .strict();

export const CandidateAcceptanceTraceV2Schema = z
  .object({
    candidateId: IdSchema,
    accepted: z.boolean(),
    reasons: z.array(z.enum([
      "MODE_CHANNEL_REQUIREMENT",
      "MODE_SINGLE_VISUAL",
      "DEGRADED_LEXICAL_FALLBACK",
    ])).max(1),
    signals: z.array(AcceptanceSignalV2Schema).min(1).max(3),
  })
  .strict()
  .superRefine((trace, context) => {
    if (trace.accepted !== (trace.reasons.length > 0)) {
      context.addIssue({
        code: "custom",
        message: "acceptance decision must agree with its reasons",
        path: ["reasons"],
      });
    }
  });

export const AcceptanceTraceV2Schema = z
  .object({
    policyId: IdSchema,
    policyVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    policyConfigHash: HashSchema,
    queryMode: RetrievalModeV2Schema,
    degradedLexicalFallback: z.boolean(),
    candidates: z.array(CandidateAcceptanceTraceV2Schema).max(10),
    acceptedCount: z.number().int().nonnegative().max(10),
    rejectedCount: z.number().int().nonnegative().max(10),
  })
  .strict()
  .superRefine((trace, context) => {
    const acceptedCount = trace.candidates.filter(({ accepted }) => accepted).length;
    if (
      trace.acceptedCount !== acceptedCount
      || trace.rejectedCount !== trace.candidates.length - acceptedCount
    ) {
      context.addIssue({
        code: "custom",
        message: "acceptance counts must match candidate decisions",
      });
    }
  });

export type RetrievalChannelV2 = z.infer<typeof RetrievalChannelV2Schema>;
export type RetrievalRegionV2 = z.infer<typeof RetrievalRegionV2Schema>;
export type ChannelCandidateV2 = z.infer<typeof ChannelCandidateV2Schema>;
export type FusionChannelTraceV2 = z.infer<typeof FusionChannelTraceV2Schema>;
export type FusedCandidateV2 = z.infer<typeof FusedCandidateV2Schema>;
export type AcceptancePolicyV2 = z.infer<typeof AcceptancePolicyV2Schema>;
export type AcceptanceTraceV2 = z.infer<typeof AcceptanceTraceV2Schema>;

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

function validateChannelRanking(candidates: readonly ChannelCandidateV2[]) {
  const parsed = z.array(ChannelCandidateV2Schema).max(RRF_CHANNEL_LIMIT_V2).parse(candidates);
  const candidateIds = parsed.map(({ candidateId }) => candidateId);
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error("channel candidates must be unique by candidate id");
  }
  const ranks = parsed.map(({ rank }) => rank).sort((left, right) => left - right);
  if (ranks.some((rank, index) => rank !== index + 1)) {
    throw new Error("channel candidate ranks must be contiguous from one");
  }
  return parsed;
}

export function fuseRankedChannelsV2(
  rankings: Partial<Record<RetrievalChannelV2, readonly ChannelCandidateV2[]>>,
): FusedCandidateV2[] {
  const byCandidate = new Map<string, {
    objectId: string;
    traces: FusionChannelTraceV2[];
    score: number;
    tieNodeId: string | null;
  }>();
  for (const channel of RetrievalChannelV2Schema.options) {
    const candidates = validateChannelRanking(rankings[channel] ?? []);
    for (const candidate of candidates) {
      const existing = byCandidate.get(candidate.candidateId);
      if (existing && existing.objectId !== candidate.objectId) {
        throw new Error("a fused candidate cannot cross knowledge objects");
      }
      const contribution = RRF_WEIGHTS_V2[channel] / (RRF_K_V2 + candidate.rank);
      const trace = FusionChannelTraceV2Schema.parse({
        channel,
        rank: candidate.rank,
        contribution,
        rawScore: candidate.rawScore,
        representationId: candidate.representationId,
        nodeId: candidate.nodeId,
        assetId: candidate.assetId,
        region: candidate.region,
      });
      if (existing) {
        existing.score += contribution;
        existing.traces.push(trace);
        if (
          trace.nodeId !== null
          && (
            existing.tieNodeId === null
            || compareCodePoints(trace.nodeId, existing.tieNodeId) < 0
          )
        ) {
          existing.tieNodeId = trace.nodeId;
        }
      } else {
        byCandidate.set(candidate.candidateId, {
          objectId: candidate.objectId,
          traces: [trace],
          score: contribution,
          tieNodeId: trace.nodeId,
        });
      }
    }
  }
  return Array.from(byCandidate.entries())
    .sort(([leftId, left], [rightId, right]) =>
      right.score - left.score
      || compareCodePoints(
        left.tieNodeId ?? leftId,
        right.tieNodeId ?? rightId,
      )
      || compareCodePoints(leftId, rightId))
    .slice(0, RRF_FUSED_LIMIT_V2)
    .map(([candidateId, candidate], index) =>
      FusedCandidateV2Schema.parse({
        candidateId,
        objectId: candidate.objectId,
        fusedRank: index + 1,
        fusionScore: candidate.score,
        channelTraces: candidate.traces.sort((left, right) =>
          RetrievalChannelV2Schema.options.indexOf(left.channel)
            - RetrievalChannelV2Schema.options.indexOf(right.channel)),
      }));
}

export function createAcceptancePolicyV2(
  input: Partial<z.input<typeof AcceptancePolicyInputV2Schema>> = {},
): AcceptancePolicyV2 {
  const defaults: z.input<typeof AcceptancePolicyInputV2Schema> = {
    id: "lumi-post-fusion-acceptance",
    version: "1.0.0",
    eligibleMaxRank: 20,
    requirementsByMode: {
      TEXT_TO_TEXT: [["LEXICAL", "TEXT_VECTOR"]],
      TEXT_TO_IMAGE: [
        ["LEXICAL", "VISUAL_VECTOR"],
        ["TEXT_VECTOR", "VISUAL_VECTOR"],
        ["VISUAL_VECTOR"],
      ],
      IMAGE_TO_IMAGE: [["VISUAL_VECTOR"]],
      IMAGE_TEXT_TO_EVIDENCE: [
        ["LEXICAL", "VISUAL_VECTOR"],
        ["TEXT_VECTOR", "VISUAL_VECTOR"],
        ["VISUAL_VECTOR"],
      ],
    },
  };
  const parsed = AcceptancePolicyInputV2Schema.parse({
    ...defaults,
    ...input,
    requirementsByMode: {
      ...defaults.requirementsByMode,
      ...input.requirementsByMode,
    },
  });
  return AcceptancePolicyV2Schema.parse({
    ...parsed,
    configHash: sha256(parsed),
  });
}

export function applyPostFusionAcceptanceV2(
  mode: RetrievalModeV2,
  candidates: readonly FusedCandidateV2[],
  policy: AcceptancePolicyV2 = createAcceptancePolicyV2(),
  options: { degradedLexicalFallback?: boolean } = {},
): { accepted: FusedCandidateV2[]; trace: AcceptanceTraceV2 } {
  const parsedMode = RetrievalModeV2Schema.parse(mode);
  const parsedPolicy = AcceptancePolicyV2Schema.parse(policy);
  if (parsedPolicy.configHash !== sha256(
    Object.fromEntries(Object.entries(parsedPolicy).filter(([key]) => key !== "configHash")),
  )) {
    throw new Error("acceptance policy config hash mismatch");
  }
  const parsedCandidates = z.array(FusedCandidateV2Schema).max(10).parse(candidates);
  const degradedLexicalFallback = options.degradedLexicalFallback === true;
  if (degradedLexicalFallback && parsedMode === "IMAGE_TO_IMAGE") {
    throw new Error("pure image queries cannot use lexical fallback");
  }
  const traces = parsedCandidates.map((candidate) => {
    const eligibleChannels = new Set(
      candidate.channelTraces
        .filter(({ rank }) => rank <= parsedPolicy.eligibleMaxRank)
        .map(({ channel }) => channel),
    );
    const signals = candidate.channelTraces.map((channelTrace) => {
      return AcceptanceSignalV2Schema.parse({
        channel: channelTrace.channel,
        rank: channelTrace.rank,
        rawScore: channelTrace.rawScore,
        modeEligible: channelTrace.rank <= parsedPolicy.eligibleMaxRank,
        fallbackEligible: degradedLexicalFallback && channelTrace.channel === "LEXICAL",
      });
    });
    const reasons: Array<
      "MODE_CHANNEL_REQUIREMENT"
      | "MODE_SINGLE_VISUAL"
      | "DEGRADED_LEXICAL_FALLBACK"
    > = [];
    const textNodeIds = candidate.channelTraces
      .filter(({ channel, rank }) =>
        rank <= parsedPolicy.eligibleMaxRank
        && (channel === "LEXICAL" || channel === "TEXT_VECTOR"))
      .map(({ nodeId }) => nodeId);
    const exactTextNodeConsensus = parsedMode !== "TEXT_TO_TEXT"
      || (
        textNodeIds.length >= 2
        && textNodeIds.every((nodeId) =>
          nodeId !== null && nodeId === candidate.candidateId)
      );
    if (degradedLexicalFallback) {
      if (eligibleChannels.has("LEXICAL")) reasons.push("DEGRADED_LEXICAL_FALLBACK");
    } else if (
      exactTextNodeConsensus
      &&
      parsedPolicy.requirementsByMode[parsedMode].some((requirement) =>
        requirement.every((channel) => eligibleChannels.has(channel)))
    ) {
      reasons.push(
        parsedMode === "IMAGE_TO_IMAGE"
          ? "MODE_SINGLE_VISUAL"
          : "MODE_CHANNEL_REQUIREMENT",
      );
    }
    return CandidateAcceptanceTraceV2Schema.parse({
      candidateId: candidate.candidateId,
      accepted: reasons.length > 0,
      reasons,
      signals,
    });
  });
  const acceptedIds = new Set(
    traces.filter(({ accepted }) => accepted).map(({ candidateId }) => candidateId),
  );
  const accepted = parsedCandidates
    .filter(({ candidateId }) => acceptedIds.has(candidateId))
    .map((candidate, index) => ({ ...candidate, fusedRank: index + 1 }));
  return {
    accepted: z.array(FusedCandidateV2Schema).parse(accepted),
    trace: AcceptanceTraceV2Schema.parse({
      policyId: parsedPolicy.id,
      policyVersion: parsedPolicy.version,
      policyConfigHash: parsedPolicy.configHash,
      queryMode: parsedMode,
      degradedLexicalFallback,
      candidates: traces,
      acceptedCount: accepted.length,
      rejectedCount: traces.length - accepted.length,
    }),
  };
}
