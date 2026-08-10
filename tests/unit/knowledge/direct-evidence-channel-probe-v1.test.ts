// @vitest-environment node

import { setImmediate as waitImmediate } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import {
  createCapabilityEntityManifestV2,
} from "@/lib/knowledge/capability-boundary-v2";
import {
  createDirectEvidenceChannelProbeV1,
} from "@/lib/knowledge/direct-evidence-channel-probe-v1";
import {
  ChannelRetrievalResultV2Schema,
  type RetrievalChannelProviderV2,
} from "@/lib/knowledge/hybrid-retriever-v2";
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

function manifest() {
  return createCapabilityEntityManifestV2({
    id: "direct-evidence-probe-test",
    version: "1.0.0",
    corpusBundleHash: CORPUS_HASH,
    entities: [],
  });
}

function parentQuery(
  text = "版式层级和网格怎么调整？",
) {
  return createRetrievalQueryV2({
    mode: "TEXT_TO_TEXT",
    text,
    scope: {
      corpusBundleHash: CORPUS_HASH,
      sourceCoursePack: PACK,
    },
  });
}

function compiledQuery(input: {
  id?: number;
  text?: string;
  source?: "WHOLE_QUERY" | "OBLIGATION";
  obligationIds?: string[];
  modalities?: Array<"TEXT" | "IMAGE">;
} = {}): CompiledDirectQueryV1 {
  const text = input.text ?? parentQuery().normalizedText!;
  return CompiledDirectQueryV1Schema.parse({
    queryId: `query-${(input.id ?? 1).toString(16).padStart(16, "0")}`,
    normalizedText: normalizeRetrievalTextV2(text),
    source: input.source ?? "WHOLE_QUERY",
    obligationIds: input.obligationIds ?? [],
    modalities: input.modalities ?? ["TEXT"],
  });
}

function identity(channel: Channel) {
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

function healthyResult(
  channel: Channel,
  input: {
    status?: "SUCCESS" | "EMPTY";
    objectId?: string;
    coursePackId?: string;
    nodeId?: string;
    assetId?: string | null;
    rawScore?: number;
  } = {},
) {
  const status = input.status ?? "SUCCESS";
  const objectId = input.objectId ?? "layout-object";
  const nodeId = input.nodeId ?? (
    channel === "VISUAL_VECTOR"
      ? "layout-image-node"
      : "layout-text-node"
  );
  const assetId = channel === "VISUAL_VECTOR"
    ? (input.assetId ?? "layout-asset")
    : null;
  const hits = status === "SUCCESS"
    ? [{
        candidateId: objectId,
        objectId,
        representationId:
          channel === "LEXICAL"
            ? null
            : `${
                channel.toLowerCase().replaceAll("_", "-")
              }-representation`,
        nodeId,
        assetId,
        region: null,
        rank: 1,
        rawScore: input.rawScore ?? 1,
      }]
    : [];
  return ChannelRetrievalResultV2Schema.parse({
    summary: {
      channel,
      status,
      reason: null,
      corpusBundleHash: CORPUS_HASH,
      identity: identity(channel),
      hitCount: hits.length,
      timingMs: 1,
    },
    hits,
    ...(channel === "VISUAL_VECTOR"
      ? {
          visualAssetHits: status === "SUCCESS"
            ? [{
                objectId,
                representationId: "visual-representation",
                nodeId,
                assetId,
                region: null,
                rank: 1,
                rawScore: input.rawScore ?? 1,
              }]
            : [],
        }
      : {
          objectCandidates: status === "SUCCESS"
            ? [{
                objectId,
                coursePackId:
                  input.coursePackId ?? PACK.id,
                objectRank: 1,
                rawScore: input.rawScore ?? 1,
                nodes: [{
                  nodeId,
                  objectId,
                  nodeKind: "TEXT",
                  representationId:
                    channel === "LEXICAL"
                      ? null
                      : "text-representation",
                  innerRank: 1,
                  rawScore: input.rawScore ?? 1,
                }],
              }]
            : [],
        }),
  });
}

function provider(
  channel: Channel,
  result = healthyResult(channel),
): RetrievalChannelProviderV2 {
  return {
    retrieve: vi.fn(async () => result),
  };
}

function bindings(input: {
  includeForeign?: boolean;
} = {}) {
  const objectCoursePackById = new Map<string, string>([
    ["layout-object", PACK.id],
  ]);
  const nodeOwnerById = new Map([
    ["layout-text-node", "layout-object"],
    ["layout-image-node", "layout-object"],
  ]);
  const assetOwnerById = new Map([
    ["layout-asset", "layout-object"],
  ]);
  if (input.includeForeign) {
    objectCoursePackById.set(
      "foreign-object",
      "brand-vi-design",
    );
    nodeOwnerById.set(
      "foreign-node",
      "foreign-object",
    );
  }
  return {
    objectCoursePackById,
    nodeOwnerById,
    assetOwnerById,
  };
}

function probeFixture(input: {
  enabled?: boolean;
  lexical?: RetrievalChannelProviderV2;
  textVector?: RetrievalChannelProviderV2;
  visualVector?: RetrievalChannelProviderV2;
  includeForeign?: boolean;
} = {}) {
  const lexical = input.lexical ?? provider("LEXICAL");
  const textVector = input.textVector
    ?? provider("TEXT_VECTOR");
  const visualVector = input.visualVector
    ?? provider("VISUAL_VECTOR");
  const probe = createDirectEvidenceChannelProbeV1({
    enabled: input.enabled ?? true,
    capabilityEntityManifest: manifest(),
    lexicalProvider: lexical,
    textVectorProvider: textVector,
    visualVectorProvider: visualVector,
    bindings: bindings({
      includeForeign: input.includeForeign,
    }),
  });
  return {
    ...probe,
    lexical,
    textVector,
    visualVector,
  };
}

describe("direct evidence channel probe v1", () => {
  it("is default-off and never touches a provider", async () => {
    const fixture = probeFixture({ enabled: false });

    await expect(
      fixture.probeDirectEvidenceChannels(
        compiledQuery(),
        { staticParentQuery: parentQuery() },
      ),
    ).rejects.toThrow("DIRECT_EVIDENCE_PROBE_DISABLED");
    expect(fixture.lexical.retrieve).not.toHaveBeenCalled();
    expect(fixture.textVector.retrieve).not.toHaveBeenCalled();
    expect(fixture.visualVector.retrieve).not.toHaveBeenCalled();
  });

  it("maps TEXT to lexical+BGE and IMAGE to an additional text-to-image call", async () => {
    const fixture = probeFixture();
    const result =
      await fixture.probeDirectEvidenceChannels(
        compiledQuery({
          modalities: ["TEXT", "IMAGE"],
        }),
        { staticParentQuery: parentQuery() },
      );

    expect(result.status).toBe("SUCCESS");
    expect(Object.keys(result.channels).sort()).toEqual([
      "LEXICAL",
      "TEXT_VECTOR",
      "VISUAL_VECTOR",
    ]);
    expect(fixture.lexical.retrieve)
      .toHaveBeenCalledTimes(1);
    expect(fixture.textVector.retrieve)
      .toHaveBeenCalledTimes(1);
    expect(fixture.visualVector.retrieve)
      .toHaveBeenCalledTimes(1);
    expect(vi.mocked(fixture.lexical.retrieve)
      .mock.calls[0]?.[0]).toMatchObject({
        mode: "TEXT_TO_TEXT",
        queryAsset: null,
        scope: parentQuery().scope,
      });
    expect(vi.mocked(fixture.visualVector.retrieve)
      .mock.calls[0]?.[0]).toMatchObject({
        mode: "TEXT_TO_IMAGE",
        queryAsset: null,
        scope: parentQuery().scope,
      });
  });

  it("starts all physical queries and their channels before awaiting any provider", async () => {
    const starts: string[] = [];
    const releases: Array<() => void> = [];
    const deferred = (
      channel: "LEXICAL" | "TEXT_VECTOR",
    ): RetrievalChannelProviderV2 => ({
      retrieve: vi.fn(async (query) => {
        starts.push(`${query.normalizedText}:${channel}`);
        return new Promise((resolve) => {
          releases.push(() =>
            resolve(healthyResult(channel)));
        });
      }),
    });
    const fixture = probeFixture({
      lexical: deferred("LEXICAL"),
      textVector: deferred("TEXT_VECTOR"),
    });
    const queries = [
      compiledQuery(),
      compiledQuery({
        id: 2,
        source: "OBLIGATION",
        obligationIds: ["obligation-1"],
        text: "版式层级",
      }),
      compiledQuery({
        id: 3,
        source: "OBLIGATION",
        obligationIds: ["obligation-2"],
        text: "网格调整",
      }),
      compiledQuery({
        id: 4,
        source: "OBLIGATION",
        obligationIds: ["obligation-3"],
        text: "信息层级",
      }),
      compiledQuery({
        id: 5,
        source: "OBLIGATION",
        obligationIds: ["obligation-4"],
        text: "对齐关系",
      }),
    ];

    const pending = fixture.probeDirectEvidenceBatch(
      queries,
      { staticParentQuery: parentQuery() },
    );
    await waitImmediate();

    expect(starts).toHaveLength(10);
    expect(releases).toHaveLength(10);
    releases.forEach((release) => release());
    const result = await pending;
    expect(result.results).toHaveLength(5);
    expect(result.expectedProviderCalls).toBe(10);
    expect(result.results[0]?.query.source)
      .toBe("WHOLE_QUERY");
  });

  it("inherits only an ambiguous strict substring from the same static parent", async () => {
    const fixture = probeFixture();
    const parent = parentQuery(
      "这个字标感觉太冷，怎么判断是字形问题还是受众不合适？",
    );
    const inherited =
      await fixture.probeDirectEvidenceChannels(
        compiledQuery({
          source: "OBLIGATION",
          obligationIds: ["obligation-1"],
          text: "这个字标感觉太冷",
        }),
        { staticParentQuery: parent },
      );
    const unrelated =
      await fixture.probeDirectEvidenceChannels(
        compiledQuery({
          id: 2,
          source: "OBLIGATION",
          obligationIds: ["obligation-1"],
          text: "这个字标有授权吗",
        }),
        { staticParentQuery: parent },
      );

    expect(inherited.prerequisiteBasis)
      .toBe("STATIC_PARENT_QUERY");
    expect(inherited.probePrerequisite.decision)
      .toBe("AMBIGUOUS");
    expect(inherited.prerequisite.decision)
      .toBe("STATIC_CORPUS_ELIGIBLE");
    expect(unrelated.status).toBe("SKIPPED_NON_STATIC");
    expect(fixture.lexical.retrieve)
      .toHaveBeenCalledTimes(1);
    expect(fixture.textVector.retrieve)
      .toHaveBeenCalledTimes(1);
  });

  it("executes a whole-query baseline when the prerequisite is ambiguous but not fail-closed", async () => {
    const fixture = probeFixture();
    const text = "这个字标感觉太冷";
    const result =
      await fixture.probeDirectEvidenceChannels(
        compiledQuery({ text }),
        { staticParentQuery: parentQuery(text) },
      );

    expect(result).toMatchObject({
      status: "SUCCESS",
      prerequisiteBasis:
        "NON_FAIL_CLOSED_PROBE_QUERY",
      probePrerequisite: {
        decision: "AMBIGUOUS",
        failClosedEligible: false,
      },
      prerequisite: {
        decision: "AMBIGUOUS",
        failClosedEligible: false,
      },
    });
    expect(fixture.lexical.retrieve)
      .toHaveBeenCalledTimes(1);
    expect(fixture.textVector.retrieve)
      .toHaveBeenCalledTimes(1);
  });

  it("skips explicit non-static model rewrites without deleting the whole query", async () => {
    const fixture = probeFixture();
    const batch = await fixture.probeDirectEvidenceBatch([
      compiledQuery(),
      compiledQuery({
        id: 2,
        source: "OBLIGATION",
        obligationIds: ["obligation-1"],
        text: "这张作品的版权归谁所有？",
      }),
    ], {
      staticParentQuery: parentQuery(),
    });

    expect(batch.results.map(({ status }) => status))
      .toEqual(["SUCCESS", "SKIPPED_NON_STATIC"]);
    expect(batch.results[0]?.query.source)
      .toBe("WHOLE_QUERY");
    expect(batch.expectedProviderCalls).toBe(2);
    expect(fixture.lexical.retrieve)
      .toHaveBeenCalledTimes(1);
    expect(fixture.textVector.retrieve)
      .toHaveBeenCalledTimes(1);
  });

  it("fails closed on ERROR, TIMEOUT, or corrupt channel output", async () => {
    const fault = (
      status: "ERROR" | "TIMEOUT",
    ): RetrievalChannelProviderV2 => ({
      async retrieve() {
        return ChannelRetrievalResultV2Schema.parse({
          summary: {
            channel: "LEXICAL",
            status,
            reason: "SIMULATED_FAULT",
            corpusBundleHash: CORPUS_HASH,
            identity: null,
            hitCount: 0,
            timingMs: 1,
          },
          hits: [],
        });
      },
    });
    for (const status of ["ERROR", "TIMEOUT"] as const) {
      const fixture = probeFixture({
        lexical: fault(status),
      });
      await expect(
        fixture.probeDirectEvidenceChannels(
          compiledQuery(),
          { staticParentQuery: parentQuery() },
        ),
      ).rejects.toThrow(
        `DIRECT_EVIDENCE_CHANNEL_UNHEALTHY:LEXICAL:${status}`,
      );
    }
    const corrupt = probeFixture({
      lexical: {
        async retrieve() {
          return { corrupt: true };
        },
      },
    });
    await expect(
      corrupt.probeDirectEvidenceChannels(
        compiledQuery(),
        { staticParentQuery: parentQuery() },
      ),
    ).rejects.toThrow(
      "DIRECT_EVIDENCE_CHANNEL_INVALID:LEXICAL",
    );
  });

  it("retains healthy EMPTY without inventing candidates", async () => {
    const fixture = probeFixture({
      lexical: provider(
        "LEXICAL",
        healthyResult("LEXICAL", { status: "EMPTY" }),
      ),
      textVector: provider(
        "TEXT_VECTOR",
        healthyResult("TEXT_VECTOR", {
          status: "EMPTY",
        }),
      ),
    });

    const result =
      await fixture.probeDirectEvidenceChannels(
        compiledQuery(),
        { staticParentQuery: parentQuery() },
      );

    expect(result.status).toBe("EMPTY");
    expect(result.channels.LEXICAL?.summary.identity)
      .not.toBeNull();
    expect(result.channels.LEXICAL?.hits).toEqual([]);
    expect(result.channels.TEXT_VECTOR?.hits).toEqual([]);
  });

  it("filters foreign course, source, and owner candidates to zero", async () => {
    const foreign = healthyResult("LEXICAL", {
      objectId: "foreign-object",
      coursePackId: "brand-vi-design",
      nodeId: "foreign-node",
    });
    const ownerMismatch = healthyResult("TEXT_VECTOR", {
      objectId: "layout-object",
      nodeId: "foreign-node",
    });
    const fixture = probeFixture({
      lexical: provider("LEXICAL", foreign),
      textVector: provider("TEXT_VECTOR", ownerMismatch),
      includeForeign: true,
    });

    const result =
      await fixture.probeDirectEvidenceChannels(
        compiledQuery(),
        { staticParentQuery: parentQuery() },
      );

    expect(result.status).toBe("EMPTY");
    expect(result.channels.LEXICAL?.summary.status)
      .toBe("EMPTY");
    expect(result.channels.TEXT_VECTOR?.summary.status)
      .toBe("EMPTY");
    expect(result.channels.LEXICAL?.hits).toEqual([]);
    expect(result.channels.TEXT_VECTOR?.objectCandidates)
      .toEqual([]);
  });

  it("executes a normalized duplicate once while preserving every obligation binding", async () => {
    const fixture = probeFixture();
    const query = compiledQuery({
      source: "OBLIGATION",
      obligationIds: ["obligation-1", "obligation-2"],
      text: "网格 调整",
    });

    const result =
      await fixture.probeDirectEvidenceChannels(
        query,
        { staticParentQuery: parentQuery() },
      );

    expect(result.query.obligationIds).toEqual([
      "obligation-1",
      "obligation-2",
    ]);
    expect(fixture.lexical.retrieve)
      .toHaveBeenCalledTimes(1);
    expect(fixture.textVector.retrieve)
      .toHaveBeenCalledTimes(1);
  });
});
