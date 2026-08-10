import { z } from "zod";

import {
  ChannelRetrievalResultV2Schema,
  type ChannelRetrievalResultV2,
} from "./hybrid-retriever-v2";
import { sha256StableJsonV2 } from "./knowledge-object-v2";
import { RetrievalChannelV2Schema } from "./rank-fusion-v2";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const HashSchema = z.string().regex(
  HASH_PATTERN,
  "expected a lowercase sha256 hash",
);

export const RETRIEVAL_ATTESTATION_PROJECTION_ALGORITHM_V3 = Object.freeze({
  id: "lumi-retrieval-attestation-projection-v3",
  version: "1.0.0",
  schemaVersion: 3,
  inputContract: "ChannelRetrievalResultV2",
  includedFields: Object.freeze([
    "summary.channel",
    "summary.status",
    "summary.reason",
    "summary.corpusBundleHash",
    "summary.identity",
    "summary.hitCount",
    "hits",
    "objectCandidates",
    "visualAssetHits",
    "packCompetition",
  ]),
  excludedFields: Object.freeze([
    "summary.timingMs",
  ]),
  optionalFieldPolicy: "PRESERVE_ABSENCE",
  rankedArrayPolicy: "PRESERVE_VALIDATED_PROVIDER_ORDER",
} as const);

export const RETRIEVAL_ATTESTATION_PROJECTION_ALGORITHM_HASH_V3 =
  sha256StableJsonV2(RETRIEVAL_ATTESTATION_PROJECTION_ALGORITHM_V3);

function projectParsedChannelResultV3(
  result: ChannelRetrievalResultV2,
) {
  const {
    timingMs: _timingMs,
    ...stableSummary
  } = result.summary;

  return {
    summary: stableSummary,
    hits: result.hits,
    ...(result.objectCandidates === undefined
      ? {}
      : { objectCandidates: result.objectCandidates }),
    ...(result.visualAssetHits === undefined
      ? {}
      : { visualAssetHits: result.visualAssetHits }),
    ...(result.packCompetition === undefined
      ? {}
      : { packCompetition: result.packCompetition }),
  };
}

/**
 * Parses the complete provider result before projecting it. This keeps the
 * attestation from accepting a malformed result merely because its stable
 * subset happens to look valid.
 */
export const RetrievalAttestationProjectionV3Schema =
  ChannelRetrievalResultV2Schema.transform(projectParsedChannelResultV3);

export type RetrievalAttestationProjectionV3 = z.output<
  typeof RetrievalAttestationProjectionV3Schema
>;

export const RetrievalChannelAttestationV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    channel: RetrievalChannelV2Schema,
    projectionAlgorithmId: z.literal(
      RETRIEVAL_ATTESTATION_PROJECTION_ALGORITHM_V3.id,
    ),
    projectionAlgorithmVersion: z.literal(
      RETRIEVAL_ATTESTATION_PROJECTION_ALGORITHM_V3.version,
    ),
    projectionAlgorithmHash: z.literal(
      RETRIEVAL_ATTESTATION_PROJECTION_ALGORITHM_HASH_V3,
    ),
    channelResultHash: HashSchema,
  })
  .strict();

export type RetrievalChannelAttestationV3 = z.infer<
  typeof RetrievalChannelAttestationV3Schema
>;

export function retrievalAttestationProjectionV3(
  input: unknown,
): RetrievalAttestationProjectionV3 {
  return RetrievalAttestationProjectionV3Schema.parse(input);
}

export function hashRetrievalChannelResultV3(input: unknown): string {
  const projection = retrievalAttestationProjectionV3(input);
  return sha256StableJsonV2({
    projectionAlgorithmHash:
      RETRIEVAL_ATTESTATION_PROJECTION_ALGORITHM_HASH_V3,
    projection,
  });
}

export function createRetrievalChannelAttestationV3(
  input: unknown,
): RetrievalChannelAttestationV3 {
  const projection = retrievalAttestationProjectionV3(input);
  return RetrievalChannelAttestationV3Schema.parse({
    schemaVersion: 3,
    channel: projection.summary.channel,
    projectionAlgorithmId:
      RETRIEVAL_ATTESTATION_PROJECTION_ALGORITHM_V3.id,
    projectionAlgorithmVersion:
      RETRIEVAL_ATTESTATION_PROJECTION_ALGORITHM_V3.version,
    projectionAlgorithmHash:
      RETRIEVAL_ATTESTATION_PROJECTION_ALGORITHM_HASH_V3,
    channelResultHash: sha256StableJsonV2({
      projectionAlgorithmHash:
        RETRIEVAL_ATTESTATION_PROJECTION_ALGORITHM_HASH_V3,
      projection,
    }),
  });
}
