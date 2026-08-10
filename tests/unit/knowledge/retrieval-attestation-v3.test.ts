// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  ChannelRetrievalResultV2Schema,
  type ChannelRetrievalResultV2,
} from "@/lib/knowledge/hybrid-retriever-v2";
import { sha256StableJsonV2 } from "@/lib/knowledge/knowledge-object-v2";
import {
  createRetrievalChannelAttestationV3,
  hashRetrievalChannelResultV3,
  RETRIEVAL_ATTESTATION_PROJECTION_ALGORITHM_HASH_V3,
  RETRIEVAL_ATTESTATION_PROJECTION_ALGORITHM_V3,
  retrievalAttestationProjectionV3,
} from "@/lib/knowledge/retrieval-attestation-v3";

const CORPUS_HASH = "a".repeat(64);
const ACTIVE_INDEX_HASH = "b".repeat(64);
const CONFIG_HASH = "c".repeat(64);
const PAYLOAD_HASH = "d".repeat(64);

function lexicalResult(): ChannelRetrievalResultV2 {
  return ChannelRetrievalResultV2Schema.parse({
    summary: {
      channel: "LEXICAL",
      status: "SUCCESS",
      reason: null,
      corpusBundleHash: CORPUS_HASH,
      identity: {
        activeIndexBundleHash: ACTIVE_INDEX_HASH,
        providerIndexBundleHash: null,
        indexVersionId: "lexical-index",
        modelId: null,
        modelRevision: null,
        configHash: CONFIG_HASH,
        payloadHashes: [PAYLOAD_HASH],
      },
      hitCount: 2,
      timingMs: 1,
    },
    hits: [
      {
        candidateId: "node-a",
        objectId: "object-a",
        representationId: null,
        nodeId: "node-a",
        assetId: null,
        region: null,
        rank: 1,
        rawScore: 12,
      },
      {
        candidateId: "node-b",
        objectId: "object-b",
        representationId: null,
        nodeId: "node-b",
        assetId: null,
        region: null,
        rank: 2,
        rawScore: 8,
      },
    ],
    objectCandidates: [
      {
        objectId: "object-a",
        coursePackId: "layout-design",
        objectRank: 1,
        rawScore: 0.9,
        nodes: [{
          nodeId: "node-a",
          objectId: "object-a",
          nodeKind: "TEXT",
          representationId: null,
          innerRank: 1,
          rawScore: 0.9,
        }],
      },
      {
        objectId: "object-b",
        coursePackId: "brand-vi-design",
        objectRank: 2,
        rawScore: 0.7,
        nodes: [{
          nodeId: "node-b",
          objectId: "object-b",
          nodeKind: "TEXT",
          representationId: null,
          innerRank: 1,
          rawScore: 0.7,
        }],
      },
    ],
    packCompetition: {
      status: "AVAILABLE",
      reason: null,
      packCompetition: {
        schemaVersion: 1,
        scoreMetric: "LEXICAL_NORMALIZED_SCORE",
        objectDeduplication: "BEST_REPRESENTATION_PER_OBJECT",
        packWinnerSelection: "BEST_OBJECT_PER_PACK",
        globalWinnerSelection: "BEST_PACK_WINNER",
        sourceScope: { coursePackId: "layout-design" },
        scoredRepresentationCount: 2,
        deduplicatedObjectCount: 2,
        perPackWinners: [
          {
            coursePackId: "brand-vi-design",
            objectCount: 1,
            objectId: "object-b",
            representationId: null,
            nodeId: "node-b",
            score: 0.7,
          },
          {
            coursePackId: "layout-design",
            objectCount: 1,
            objectId: "object-a",
            representationId: null,
            nodeId: "node-a",
            score: 0.9,
          },
        ],
        globalWinner: {
          coursePackId: "layout-design",
          objectCount: 1,
          objectId: "object-a",
          representationId: null,
          nodeId: "node-a",
          score: 0.9,
        },
        scopedWinner: {
          coursePackId: "layout-design",
          objectCount: 1,
          objectId: "object-a",
          representationId: null,
          nodeId: "node-a",
          score: 0.9,
        },
        globalToScopedMargin: 0,
      },
    },
  });
}

function failedResult(
  status: "ERROR" | "TIMEOUT",
  reason: string,
): ChannelRetrievalResultV2 {
  return ChannelRetrievalResultV2Schema.parse({
    summary: {
      channel: "LEXICAL",
      status,
      reason,
      corpusBundleHash: CORPUS_HASH,
      identity: null,
      hitCount: 0,
      timingMs: 1,
    },
    hits: [],
  });
}

describe("retrieval attestation v3", () => {
  it("binds the algorithm identity to its complete frozen definition", () => {
    expect(
      sha256StableJsonV2(RETRIEVAL_ATTESTATION_PROJECTION_ALGORITHM_V3),
    ).toBe(RETRIEVAL_ATTESTATION_PROJECTION_ALGORITHM_HASH_V3);
  });

  it("excludes timing from the projection and fingerprint without mutating input", () => {
    const baseline = lexicalResult();
    const before = structuredClone(baseline);
    const slower = structuredClone(baseline);
    slower.summary.timingMs = 987.654;

    expect(retrievalAttestationProjectionV3(baseline)).toEqual(
      retrievalAttestationProjectionV3(slower),
    );
    expect(
      "timingMs" in retrievalAttestationProjectionV3(baseline).summary,
    ).toBe(false);
    expect(hashRetrievalChannelResultV3(baseline)).toBe(
      hashRetrievalChannelResultV3(slower),
    );
    expect(createRetrievalChannelAttestationV3(baseline)).toEqual(
      createRetrievalChannelAttestationV3(slower),
    );
    expect(baseline).toEqual(before);
  });

  it("changes the fingerprint when status or reason changes", () => {
    expect(
      hashRetrievalChannelResultV3(failedResult("ERROR", "PROVIDER_ERROR")),
    ).not.toBe(
      hashRetrievalChannelResultV3(
        failedResult("TIMEOUT", "PROVIDER_TIMEOUT"),
      ),
    );
    expect(
      hashRetrievalChannelResultV3(failedResult("ERROR", "PROVIDER_ERROR")),
    ).not.toBe(
      hashRetrievalChannelResultV3(
        failedResult("ERROR", "PROVIDER_RESPONSE_INVALID"),
      ),
    );
  });

  it.each([
    [
      "identity",
      (result: ChannelRetrievalResultV2) => {
        result.summary.identity!.configHash = "e".repeat(64);
      },
    ],
    [
      "rank",
      (result: ChannelRetrievalResultV2) => {
        result.hits[0]!.rank = 2;
        result.hits[1]!.rank = 1;
      },
    ],
    [
      "score",
      (result: ChannelRetrievalResultV2) => {
        result.hits[0]!.rawScore = 11.5;
      },
    ],
    [
      "node",
      (result: ChannelRetrievalResultV2) => {
        result.hits[0]!.nodeId = "node-c";
      },
    ],
    [
      "object",
      (result: ChannelRetrievalResultV2) => {
        result.hits[0]!.objectId = "object-c";
      },
    ],
  ])("changes the fingerprint when %s evidence changes", (_label, mutate) => {
    const baseline = lexicalResult();
    const changed = structuredClone(baseline);
    mutate(changed);

    expect(hashRetrievalChannelResultV3(changed)).not.toBe(
      hashRetrievalChannelResultV3(baseline),
    );
  });

  it("retains stable object-candidate and pack-competition evidence", () => {
    const baseline = lexicalResult();
    const changedObjectCandidate = structuredClone(baseline);
    changedObjectCandidate.objectCandidates![0]!.rawScore = 0.95;
    changedObjectCandidate.objectCandidates![0]!.nodes[0]!.rawScore = 0.95;

    const changedPackCompetition = structuredClone(baseline);
    changedPackCompetition.packCompetition = {
      status: "UNAVAILABLE",
      reason: "NOT_PROVIDED",
      packCompetition: null,
    };

    expect(hashRetrievalChannelResultV3(changedObjectCandidate)).not.toBe(
      hashRetrievalChannelResultV3(baseline),
    );
    expect(hashRetrievalChannelResultV3(changedPackCompetition)).not.toBe(
      hashRetrievalChannelResultV3(baseline),
    );
  });

  it("rejects a malformed provider result before hashing", () => {
    const invalid = lexicalResult();
    invalid.summary.timingMs = -1;

    expect(() => hashRetrievalChannelResultV3(invalid)).toThrow();
  });
});
