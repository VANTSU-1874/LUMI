import { z } from "zod";

import {
  ChannelRetrievalResultV2Schema,
  type ChannelRetrievalResultV2,
} from "./hybrid-retriever-v2";
import {
  ChannelCandidateV2Schema,
  type CandidateProjectionV2,
  type ChannelCandidateV2,
} from "./rank-fusion-v2";
import {
  ChannelObjectCandidatesV2Schema,
  type ObjectCandidateV2,
} from "./object-candidate-v2";
import {
  PackCompetitionDiagnosticsV2Schema,
  PackCompetitionObservationV2Schema,
  type PackCompetitionDiagnosticsV2,
} from "./pack-competition-v2";
import {
  TextRetrievalResponseSchema,
  type TextRetrievalResponse,
} from "./text-retriever";
import {
  VisualRetrievalResponseSchema,
  type VisualRetrievalResponse,
} from "./visual-retriever";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HashSchema = z.string().regex(HASH_PATTERN, "expected a lowercase sha256 hash");
const IdSchema = z.string().regex(ID_PATTERN, "expected a stable lowercase identifier");
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

export const ChannelAdapterIdentityV2Schema = z
  .object({
    expectedCorpusBundleHash: HashSchema,
    activeIndexBundleHash: HashSchema,
    expectedProviderIndexBundleHash: HashSchema,
    expectedIndexVersionId: IdSchema,
    expectedModelId: z.string().trim().min(1).max(300),
    expectedModelRevision: ImmutableRevisionSchema,
    configHash: HashSchema,
    payloadHashes: z.array(HashSchema).min(1).max(20),
  })
  .strict()
  .superRefine((identity, context) => {
    if (new Set(identity.payloadHashes).size !== identity.payloadHashes.length) {
      context.addIssue({
        code: "custom",
        message: "adapter payload hashes must be unique",
        path: ["payloadHashes"],
      });
    }
  });

export const VisualAssetOwnerV2Schema = z
  .object({
    objectId: IdSchema,
    imageNodeId: IdSchema,
  })
  .strict();

export const LexicalChannelIdentityV2Schema = z
  .object({
    corpusBundleHash: HashSchema,
    activeIndexBundleHash: HashSchema,
    indexVersionId: IdSchema,
    configHash: HashSchema,
    payloadHashes: z.array(HashSchema).min(1).max(20),
  })
  .strict();

export type ChannelAdapterIdentityV2 = z.infer<typeof ChannelAdapterIdentityV2Schema>;
export type VisualAssetOwnerV2 = z.infer<typeof VisualAssetOwnerV2Schema>;

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function adaptLexicalCandidatesV2(
  candidateInputs: readonly ChannelCandidateV2[],
  identityInput: z.infer<typeof LexicalChannelIdentityV2Schema>,
  timingMs = 0,
  projection: CandidateProjectionV2 = "OBJECT",
  packCompetitionInput?: PackCompetitionDiagnosticsV2 | null,
  objectCandidateInputs: readonly ObjectCandidateV2[] = [],
): ChannelRetrievalResultV2 {
  const identity = LexicalChannelIdentityV2Schema.parse(identityInput);
  const candidates = z.array(ChannelCandidateV2Schema).max(20).parse(candidateInputs);
  const objectCandidates = ChannelObjectCandidatesV2Schema.parse(
    objectCandidateInputs,
  );
  if (
    objectCandidates.some(({ nodes }) =>
      nodes.some(({ representationId }) => representationId !== null))
  ) {
    throw new Error(
      "lexical object candidate representations must be null",
    );
  }
  if (
    candidates.some(({ candidateId, objectId, representationId, nodeId, assetId, region }) =>
      (
        projection === "NODE"
          ? nodeId === null || candidateId !== nodeId
          : candidateId !== objectId
      )
      || representationId !== null
      || assetId !== null
      || region !== null)
  ) {
    throw new Error(
      `lexical candidates must obey the ${projection.toLowerCase()} projection`,
    );
  }
  const packCompetition = packCompetitionInput === undefined
    ? undefined
    : packCompetitionInput === null
      ? PackCompetitionObservationV2Schema.parse({
          status: "UNAVAILABLE",
          reason: "NOT_PROVIDED",
          packCompetition: null,
        })
      : PackCompetitionObservationV2Schema.parse({
          status: "AVAILABLE",
          reason: null,
          packCompetition: PackCompetitionDiagnosticsV2Schema.parse(packCompetitionInput),
        });
  return ChannelRetrievalResultV2Schema.parse({
    summary: {
      channel: "LEXICAL",
      status: candidates.length > 0 ? "SUCCESS" : "EMPTY",
      reason: null,
      corpusBundleHash: identity.corpusBundleHash,
      identity: {
        activeIndexBundleHash: identity.activeIndexBundleHash,
        providerIndexBundleHash: null,
        indexVersionId: identity.indexVersionId,
        modelId: null,
        modelRevision: null,
        configHash: identity.configHash,
        payloadHashes: identity.payloadHashes,
      },
      hitCount: candidates.length,
      timingMs: z.number().finite().nonnegative().parse(timingMs),
    },
    hits: candidates,
    objectCandidates,
    ...(packCompetition ? { packCompetition } : {}),
  });
}

function indexMatchesExpected(
  index: {
    corpusBundleHash: string;
    indexBundleHash: string;
    indexVersionId: string;
    modelId: string;
    modelRevision: string;
  } | null,
  metadata: ChannelAdapterIdentityV2,
) {
  return index !== null
    && index.corpusBundleHash === metadata.expectedCorpusBundleHash
    && index.indexBundleHash === metadata.expectedProviderIndexBundleHash
    && index.indexVersionId === metadata.expectedIndexVersionId
    && index.modelId === metadata.expectedModelId
    && index.modelRevision === metadata.expectedModelRevision;
}

function failedResult(
  channel: "TEXT_VECTOR" | "VISUAL_VECTOR",
  metadata: ChannelAdapterIdentityV2,
  status: "UNAVAILABLE" | "TIMEOUT" | "ERROR",
  reason: string,
  timingMs: number,
): ChannelRetrievalResultV2 {
  return ChannelRetrievalResultV2Schema.parse({
    summary: {
      channel,
      status,
      reason,
      corpusBundleHash: metadata.expectedCorpusBundleHash,
      identity: null,
      hitCount: 0,
      timingMs,
    },
    hits: [],
  });
}

export function adaptTextRetrievalResponseV2(
  responseInput: TextRetrievalResponse,
  metadataInput: ChannelAdapterIdentityV2,
  projection: CandidateProjectionV2 = "OBJECT",
): ChannelRetrievalResultV2 {
  const response = TextRetrievalResponseSchema.parse(responseInput);
  const metadata = ChannelAdapterIdentityV2Schema.parse(metadataInput);
  if (response.status !== "SUCCESS" && response.status !== "EMPTY") {
    return failedResult(
      "TEXT_VECTOR",
      metadata,
      response.status,
      response.reason!,
      response.timing.totalMs,
    );
  }
  if (!indexMatchesExpected(response.index, metadata)) {
    return failedResult(
      "TEXT_VECTOR",
      metadata,
      "ERROR",
      "INDEX_IDENTITY_MISMATCH",
      response.timing.totalMs,
    );
  }
  const sortedHits = [...response.hits].sort((left, right) =>
    left.rank - right.rank
    || compareCodePoints(left.representationId, right.representationId));
  const projectedHits = new Map<string, TextRetrievalResponse["hits"][number]>();
  for (const hit of sortedHits) {
    const candidateId = projection === "NODE" ? hit.nodeId : hit.objectId;
    if (!projectedHits.has(candidateId)) projectedHits.set(candidateId, hit);
  }
  const hits = Array.from(projectedHits.values())
    .slice(0, 20)
    .map((hit, index) => ({
      candidateId: projection === "NODE" ? hit.nodeId : hit.objectId,
      objectId: hit.objectId,
      representationId: hit.representationId,
      nodeId: hit.nodeId,
      assetId: null,
      region: null,
      rank: index + 1,
      rawScore: hit.score ?? null,
    }));
  return ChannelRetrievalResultV2Schema.parse({
    summary: {
      channel: "TEXT_VECTOR",
      status: hits.length > 0 ? "SUCCESS" : "EMPTY",
      reason: null,
      corpusBundleHash: metadata.expectedCorpusBundleHash,
      identity: {
        activeIndexBundleHash: metadata.activeIndexBundleHash,
        providerIndexBundleHash: response.index!.indexBundleHash,
        indexVersionId: response.index!.indexVersionId,
        modelId: response.index!.modelId,
        modelRevision: response.index!.modelRevision,
        configHash: metadata.configHash,
        payloadHashes: metadata.payloadHashes,
      },
      hitCount: hits.length,
      timingMs: response.timing.totalMs,
    },
    hits,
    objectCandidates: response.objectCandidates.map((candidate) => ({
      objectId: candidate.objectId,
      coursePackId: candidate.coursePackId,
      objectRank: candidate.objectRank,
      rawScore: candidate.objectScore,
      nodes: candidate.nodes.map((node) => ({
        nodeId: node.nodeId,
        objectId: candidate.objectId,
        nodeKind: node.nodeKind,
        representationId: node.representationId,
        innerRank: node.innerRank,
        rawScore: node.score,
      })),
    })),
    packCompetition: response.diagnostics,
  });
}

export function adaptVisualRetrievalResponseV2(
  responseInput: VisualRetrievalResponse,
  metadataInput: ChannelAdapterIdentityV2,
  assetOwnerInputs: ReadonlyMap<string, VisualAssetOwnerV2>,
): ChannelRetrievalResultV2 {
  const response = VisualRetrievalResponseSchema.parse(responseInput);
  const metadata = ChannelAdapterIdentityV2Schema.parse(metadataInput);
  const assetOwners = new Map(
    Array.from(assetOwnerInputs.entries()).map(([assetId, owner]) => [
      IdSchema.parse(assetId),
      VisualAssetOwnerV2Schema.parse(owner),
    ]),
  );
  if (response.status !== "SUCCESS" && response.status !== "EMPTY") {
    return failedResult(
      "VISUAL_VECTOR",
      metadata,
      response.status,
      response.reason!,
      response.timing.totalMs,
    );
  }
  if (!indexMatchesExpected(response.index, metadata)) {
    return failedResult(
      "VISUAL_VECTOR",
      metadata,
      "ERROR",
      "INDEX_IDENTITY_MISMATCH",
      response.timing.totalMs,
    );
  }
  const bestByObject = new Map<string, {
    hit: VisualRetrievalResponse["hits"][number];
    owner: VisualAssetOwnerV2;
  }>();
  const visualAssetHits = [];
  const rankedAssetHits = [...response.hits]
    .sort((left, right) =>
      left.rank - right.rank
      || compareCodePoints(left.assetId, right.assetId)
      || compareCodePoints(left.representationId, right.representationId))
    .slice(0, 20);
  for (const [index, hit] of rankedAssetHits.entries()) {
    const owner = assetOwners.get(hit.assetId);
    if (!owner) {
      return failedResult(
        "VISUAL_VECTOR",
        metadata,
        "ERROR",
        "INVALID_RESPONSE",
        response.timing.totalMs,
      );
    }
    visualAssetHits.push({
      objectId: owner.objectId,
      representationId: hit.representationId,
      nodeId: owner.imageNodeId,
      assetId: hit.assetId,
      region: hit.region,
      rank: index + 1,
      rawScore: hit.score ?? null,
    });
    if (!bestByObject.has(owner.objectId)) bestByObject.set(owner.objectId, { hit, owner });
  }
  const hits = Array.from(bestByObject.values())
    .slice(0, 20)
    .map(({ hit, owner }, index) => ({
      candidateId: owner.objectId,
      objectId: owner.objectId,
      representationId: hit.representationId,
      nodeId: owner.imageNodeId,
      assetId: hit.assetId,
      region: hit.region,
      rank: index + 1,
      rawScore: hit.score ?? null,
    }));
  return ChannelRetrievalResultV2Schema.parse({
    summary: {
      channel: "VISUAL_VECTOR",
      status: hits.length > 0 ? "SUCCESS" : "EMPTY",
      reason: null,
      corpusBundleHash: metadata.expectedCorpusBundleHash,
      identity: {
        activeIndexBundleHash: metadata.activeIndexBundleHash,
        providerIndexBundleHash: response.index!.indexBundleHash,
        indexVersionId: response.index!.indexVersionId,
        modelId: response.index!.modelId,
        modelRevision: response.index!.modelRevision,
        configHash: metadata.configHash,
        payloadHashes: metadata.payloadHashes,
      },
      hitCount: hits.length,
      timingMs: response.timing.totalMs,
    },
    hits,
    visualAssetHits,
  });
}
