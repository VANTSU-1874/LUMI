import { describe, expect, it } from "vitest";

import {
  createCapabilityEntityManifestV2,
} from "@/lib/knowledge/capability-boundary-v2";
import {
  DirectEvidenceProbeResultV1Schema,
} from "@/lib/knowledge/direct-evidence-channel-probe-v1";
import {
  ChannelRetrievalResultV2Schema,
} from "@/lib/knowledge/hybrid-retriever-v2";
import {
  fuseObligationRrfV1,
} from "@/lib/knowledge/obligation-rrf-v1";
import {
  evaluateQueryPrerequisiteV3,
} from "@/lib/knowledge/query-prerequisite-router-v3";
import {
  createRetrievalQueryV2,
  normalizeRetrievalTextV2,
} from "@/lib/knowledge/retrieval-query-v2";
import {
  CompiledDirectQueryV1Schema,
  type CompiledDirectQueryV1,
} from "@/lib/knowledge/retrieval-plan-v1";

const CORPUS_HASH = "a".repeat(64);
const ACTIVE_HASH = "b".repeat(64);
const PROVIDER_HASH = "c".repeat(64);
const CONFIG_HASH = "d".repeat(64);
const PAYLOAD_HASH = "e".repeat(64);
const MODEL_REVISION = "f".repeat(40);
const PACK = {
  id: "layout-design",
  version: "1",
} as const;

type Channel = "LEXICAL" | "TEXT_VECTOR" | "VISUAL_VECTOR";
type RankedRow = {
  objectId: string;
  rank: number;
  rawScore: number | null;
};

const manifest = createCapabilityEntityManifestV2({
  id: "obligation-rrf-test",
  version: "1.0.0",
  corpusBundleHash: CORPUS_HASH,
  entities: [],
});

function baseQuery(text = "版式层级怎么调整？") {
  return createRetrievalQueryV2({
    mode: "TEXT_TO_TEXT",
    text,
    scope: {
      corpusBundleHash: CORPUS_HASH,
      sourceCoursePack: PACK,
    },
  });
}

const prerequisite = evaluateQueryPrerequisiteV3({
  query: baseQuery(),
  capabilityEntityManifest: manifest,
});

function compiled(input: {
  id: number;
  source?: "WHOLE_QUERY" | "OBLIGATION";
  text?: string;
  obligationIds?: string[];
  modalities?: Array<"TEXT" | "IMAGE">;
}): CompiledDirectQueryV1 {
  return CompiledDirectQueryV1Schema.parse({
    queryId: `query-${input.id.toString(16).padStart(16, "0")}`,
    normalizedText: normalizeRetrievalTextV2(
      input.text ?? baseQuery().normalizedText!,
    ),
    source: input.source ?? "OBLIGATION",
    obligationIds: input.obligationIds ?? ["obligation-1"],
    modalities: input.modalities ?? ["TEXT"],
  });
}

function channelIdentity(channel: Channel) {
  return {
    activeIndexBundleHash: ACTIVE_HASH,
    providerIndexBundleHash:
      channel === "LEXICAL" ? null : PROVIDER_HASH,
    indexVersionId:
      channel === "LEXICAL"
        ? "lexical-index"
        : `${channel.toLowerCase().replace("_", "-")}-index`,
    modelId:
      channel === "LEXICAL"
        ? null
        : `test/${channel.toLowerCase()}`,
    modelRevision:
      channel === "LEXICAL" ? null : MODEL_REVISION,
    configHash: CONFIG_HASH,
    payloadHashes: [PAYLOAD_HASH],
  };
}

function channelResult(
  channel: Channel,
  rows: RankedRow[],
) {
  const sorted = [...rows].sort(
    (left, right) => left.rank - right.rank,
  );
  return ChannelRetrievalResultV2Schema.parse({
    summary: {
      channel,
      status: sorted.length > 0 ? "SUCCESS" : "EMPTY",
      reason: null,
      corpusBundleHash: CORPUS_HASH,
      identity: channelIdentity(channel),
      hitCount: sorted.length,
      timingMs: 1,
    },
    hits: sorted.map((row) => ({
      candidateId: row.objectId,
      objectId: row.objectId,
      representationId:
        channel === "LEXICAL"
          ? null
          : `${row.objectId}-representation`,
      nodeId: `${row.objectId}-${
        channel === "VISUAL_VECTOR" ? "image" : "text"
      }`,
      assetId:
        channel === "VISUAL_VECTOR"
          ? `${row.objectId}-asset`
          : null,
      region: null,
      rank: row.rank,
      rawScore: row.rawScore,
    })),
    ...(channel === "VISUAL_VECTOR"
      ? {
          visualAssetHits: sorted.map((row) => ({
            objectId: row.objectId,
            representationId:
              `${row.objectId}-representation`,
            nodeId: `${row.objectId}-image`,
            assetId: `${row.objectId}-asset`,
            region: null,
            rank: row.rank,
            rawScore: row.rawScore,
          })),
        }
      : {}),
  });
}

function probeResult(input: {
  query: CompiledDirectQueryV1;
  lexical?: RankedRow[];
  textVector?: RankedRow[];
  visualVector?: RankedRow[];
}) {
  const channels = {
    ...(input.query.modalities.includes("TEXT")
      ? {
          LEXICAL: channelResult(
            "LEXICAL",
            input.lexical ?? [],
          ),
          TEXT_VECTOR: channelResult(
            "TEXT_VECTOR",
            input.textVector ?? [],
          ),
        }
      : {}),
    ...(input.query.modalities.includes("IMAGE")
      ? {
          VISUAL_VECTOR: channelResult(
            "VISUAL_VECTOR",
            input.visualVector ?? [],
          ),
        }
      : {}),
  };
  const hasHits = Object.values(channels).some(
    ({ hits }) => hits.length > 0,
  );
  return DirectEvidenceProbeResultV1Schema.parse({
    schemaVersion: 1,
    query: input.query,
    prerequisiteBasis: "PROBE_QUERY",
    probePrerequisite: prerequisite,
    prerequisite,
    status: hasHits ? "SUCCESS" : "EMPTY",
    channels,
  });
}

function wholeEmpty() {
  return probeResult({
    query: compiled({
      id: 1,
      source: "WHOLE_QUERY",
      obligationIds: [],
      modalities: ["TEXT"],
    }),
  });
}

function contributionScore(
  result: ReturnType<typeof fuseObligationRrfV1>,
  objectId: string,
  obligationId: string,
) {
  const candidate = result.candidates.find(
    (value) => value.objectId === objectId,
  );
  return candidate?.contributions
    .filter((value) =>
      value.obligationId === obligationId)
    .reduce(
      (sum, value) => sum + value.rrfContribution,
      0,
    ) ?? 0;
}

describe("obligation RRF v1", () => {
  it("keeps each obligation total weight invariant across query and channel counts", () => {
    const oneQuery = fuseObligationRrfV1([
      wholeEmpty(),
      probeResult({
        query: compiled({ id: 2 }),
        lexical: [{
          objectId: "target-object",
          rank: 1,
          rawScore: 0.1,
        }],
        textVector: [{
          objectId: "target-object",
          rank: 1,
          rawScore: 999,
        }],
      }),
    ]);
    const twoQueries = fuseObligationRrfV1([
      wholeEmpty(),
      probeResult({
        query: compiled({ id: 2 }),
        lexical: [{
          objectId: "target-object",
          rank: 1,
          rawScore: 0.1,
        }],
        textVector: [{
          objectId: "target-object",
          rank: 1,
          rawScore: 999,
        }],
      }),
      probeResult({
        query: compiled({
          id: 3,
          text: "网格关系",
        }),
        lexical: [{
          objectId: "target-object",
          rank: 1,
          rawScore: 10,
        }],
        textVector: [{
          objectId: "target-object",
          rank: 1,
          rawScore: -1,
        }],
      }),
    ]);
    const threeChannels = fuseObligationRrfV1([
      wholeEmpty(),
      probeResult({
        query: compiled({
          id: 4,
          modalities: ["TEXT", "IMAGE"],
        }),
        lexical: [{
          objectId: "target-object",
          rank: 1,
          rawScore: 0.1,
        }],
        textVector: [{
          objectId: "target-object",
          rank: 1,
          rawScore: 999,
        }],
        visualVector: [{
          objectId: "target-object",
          rank: 1,
          rawScore: -500,
        }],
      }),
    ]);

    const expected = 1 / 61;
    expect(contributionScore(
      oneQuery,
      "target-object",
      "obligation-1",
    )).toBeCloseTo(expected, 12);
    expect(contributionScore(
      twoQueries,
      "target-object",
      "obligation-1",
    )).toBeCloseTo(expected, 12);
    expect(contributionScore(
      threeChannels,
      "target-object",
      "obligation-1",
    )).toBeCloseTo(expected, 12);
  });

  it("uses rank only and never compares incomparable raw scores", () => {
    const result = fuseObligationRrfV1([
      probeResult({
        query: compiled({
          id: 1,
          source: "WHOLE_QUERY",
          obligationIds: [],
        }),
        lexical: [
          {
            objectId: "rank-one",
            rank: 1,
            rawScore: -999,
          },
          {
            objectId: "rank-two",
            rank: 2,
            rawScore: 1_000_000,
          },
        ],
        textVector: [],
      }),
    ]);

    expect(result.candidates.map(({ objectId }) => objectId))
      .toEqual(["rank-one", "rank-two"]);
    expect(result.candidates[0]?.fusionScore)
      .toBeGreaterThan(result.candidates[1]!.fusionScore);
  });

  it("does not reserve a whole-query rank-one hit even when deduplication binds an obligation", () => {
    const result = fuseObligationRrfV1([
      probeResult({
        query: compiled({
          id: 1,
          source: "WHOLE_QUERY",
          obligationIds: ["obligation-1"],
        }),
        lexical: [{
          objectId: "whole-query-object",
          rank: 1,
          rawScore: 1,
        }],
        textVector: [],
      }),
    ]);

    expect(result.candidates[0]).toMatchObject({
      objectId: "whole-query-object",
      reserved: false,
      reservations: [],
    });
  });

  it("records separate obligation contributions for one deduplicated shared query", () => {
    const result = fuseObligationRrfV1([
      wholeEmpty(),
      probeResult({
        query: compiled({
          id: 2,
          obligationIds: [
            "obligation-1",
            "obligation-2",
          ],
        }),
        lexical: [{
          objectId: "shared-object",
          rank: 1,
          rawScore: 1,
        }],
        textVector: [],
      }),
    ]);
    const candidate = result.candidates.find(
      ({ objectId }) => objectId === "shared-object",
    )!;

    expect(new Set(candidate.contributions.map(
      ({ obligationId }) => obligationId,
    ))).toEqual(new Set([
      "obligation-1",
      "obligation-2",
    ]));
    expect(candidate.obligationIds).toEqual([
      "obligation-1",
      "obligation-2",
    ]);
    expect(candidate).toMatchObject({
      reserved: true,
      reservations: [{
        queryId: "query-0000000000000002",
        obligationIds: [
          "obligation-1",
          "obligation-2",
        ],
        channel: "LEXICAL",
        candidateId: "shared-object",
        objectId: "shared-object",
        rank: 1,
      }],
    });
  });

  it("reserves distinct rank-one objects from two physical queries bound to one obligation", () => {
    const result = fuseObligationRrfV1([
      wholeEmpty(),
      probeResult({
        query: compiled({
          id: 2,
          obligationIds: ["obligation-1"],
        }),
        lexical: [{
          objectId: "first-query-anchor",
          rank: 1,
          rawScore: 1,
        }],
        textVector: [],
      }),
      probeResult({
        query: compiled({
          id: 3,
          obligationIds: ["obligation-1"],
        }),
        lexical: [{
          objectId: "second-query-anchor",
          rank: 1,
          rawScore: 1,
        }],
        textVector: [],
      }),
    ]);

    expect(result.candidates.map((candidate) => ({
      objectId: candidate.objectId,
      reserved: candidate.reserved,
      queryIds: candidate.reservations.map(
        ({ queryId }) => queryId,
      ),
    }))).toEqual([
      {
        objectId: "first-query-anchor",
        reserved: true,
        queryIds: ["query-0000000000000002"],
      },
      {
        objectId: "second-query-anchor",
        reserved: true,
        queryIds: ["query-0000000000000003"],
      },
    ]);
  });

  it("applies score, best-rank, then Unicode object-id tie breaks", () => {
    const result = fuseObligationRrfV1([
      probeResult({
        query: compiled({
          id: 1,
          source: "WHOLE_QUERY",
          obligationIds: [],
        }),
        lexical: [
          { objectId: "object-a", rank: 1, rawScore: 1 },
          { objectId: "object-b", rank: 2, rawScore: 100 },
        ],
        textVector: [
          { objectId: "object-b", rank: 1, rawScore: -1 },
          { objectId: "object-a", rank: 2, rawScore: 500 },
        ],
      }),
    ]);

    expect(result.candidates[0]?.fusionScore)
      .toBeCloseTo(result.candidates[1]!.fusionScore, 15);
    expect(result.candidates.map(({ objectId }) => objectId))
      .toEqual(["object-a", "object-b"]);
  });

  it("caps canonical objects at 16 and preserves deterministic rank order", () => {
    const rows = Array.from({ length: 18 }, (_, index) => ({
      objectId: `object-${String(index + 1).padStart(2, "0")}`,
      rank: index + 1,
      rawScore: 18 - index,
    }));
    const result = fuseObligationRrfV1([
      probeResult({
        query: compiled({
          id: 1,
          source: "WHOLE_QUERY",
          obligationIds: [],
        }),
        lexical: rows,
        textVector: [],
      }),
    ]);

    expect(result.candidates).toHaveLength(16);
    expect(result.candidates.map(({ objectId }) => objectId))
      .toEqual(rows.slice(0, 16).map(({ objectId }) => objectId));
    expect(result.candidates.map(({ fusedRank }) => fusedRank))
      .toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
  });

  it("keeps a per-obligation-query channel rank-one object before global Top-16 clipping", () => {
    const distractors = Array.from(
      { length: 20 },
      (_, index) => ({
        objectId:
          `distractor-${String(index + 1).padStart(2, "0")}`,
        rank: index + 1,
        rawScore: 20 - index,
      }),
    );
    const result = fuseObligationRrfV1([
      probeResult({
        query: compiled({
          id: 1,
          source: "WHOLE_QUERY",
          obligationIds: [],
        }),
        lexical: distractors,
        textVector: distractors,
      }),
      probeResult({
        query: compiled({
          id: 2,
          obligationIds: ["obligation-1"],
        }),
        lexical: [{
          objectId: "isolated-anchor",
          rank: 1,
          rawScore: 1,
        }],
        textVector: [],
      }),
    ]);

    expect(result.candidates).toHaveLength(16);
    expect(result.candidates.map(({ objectId }) => objectId))
      .toEqual([
        ...distractors.slice(0, 15).map(
          ({ objectId }) => objectId,
        ),
        "isolated-anchor",
      ]);
    expect(result.candidates[0]).toMatchObject({
      objectId: "distractor-01",
      reserved: false,
      reservations: [],
    });
    expect(result.candidates[15]).toMatchObject({
      objectId: "isolated-anchor",
      fusedRank: 16,
      reserved: true,
      reservations: [{
        queryId: "query-0000000000000002",
        obligationIds: ["obligation-1"],
        channel: "LEXICAL",
        candidateId: "isolated-anchor",
        objectId: "isolated-anchor",
        rank: 1,
      }],
    });
  });

  it("returns an empty, fully audited result when every healthy channel is EMPTY", () => {
    const result = fuseObligationRrfV1([
      wholeEmpty(),
    ]);

    expect(result.candidates).toEqual([]);
    expect(result.queryCount).toBe(1);
    expect(result.executableQueryCount).toBe(1);
    expect(result.skippedQueryCount).toBe(0);
  });
});
