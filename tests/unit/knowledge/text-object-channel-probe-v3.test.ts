// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createCapabilityEntityManifestV2,
} from "@/lib/knowledge/capability-boundary-v2";
import {
  ChannelRetrievalResultV2Schema,
  type RetrievalChannelProviderV2,
} from "@/lib/knowledge/hybrid-retriever-v2";
import {
  createRetrievalQueryV2,
} from "@/lib/knowledge/retrieval-query-v2";
import {
  createTextObjectChannelProbeV3,
} from "@/lib/knowledge/text-object-channel-probe-v3";

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

function manifest() {
  return createCapabilityEntityManifestV2({
    id: "text-object-probe-test",
    version: "1.0.0",
    corpusBundleHash: CORPUS_HASH,
    entities: [],
  });
}

function query(text = "这张练习的层级和网格怎么调整？") {
  return createRetrievalQueryV2({
    mode: "TEXT_TO_TEXT",
    text,
    scope: {
      corpusBundleHash: CORPUS_HASH,
      sourceCoursePack: PACK,
    },
  });
}

function healthyResult(
  channel: "LEXICAL" | "TEXT_VECTOR",
  objectId = "layout-object",
) {
  const representationId =
    channel === "LEXICAL" ? null : "text-representation";
  return ChannelRetrievalResultV2Schema.parse({
    summary: {
      channel,
      status: "SUCCESS",
      reason: null,
      corpusBundleHash: CORPUS_HASH,
      identity: {
        activeIndexBundleHash: ACTIVE_HASH,
        providerIndexBundleHash:
          channel === "LEXICAL" ? null : PROVIDER_HASH,
        indexVersionId:
          channel === "LEXICAL"
            ? "lexical-index"
            : "text-vector-index",
        modelId:
          channel === "LEXICAL" ? null : "test/text-model",
        modelRevision:
          channel === "LEXICAL" ? null : MODEL_REVISION,
        configHash: CONFIG_HASH,
        payloadHashes: [PAYLOAD_HASH],
      },
      hitCount: 1,
      timingMs: 1,
    },
    hits: [{
      candidateId: "candidate-node",
      objectId,
      representationId,
      nodeId: "candidate-node",
      assetId: null,
      region: null,
      rank: 1,
      rawScore: 1,
    }],
    objectCandidates: [{
      objectId,
      coursePackId: PACK.id,
      objectRank: 1,
      rawScore: 1,
      nodes: [{
        nodeId: "candidate-node",
        objectId,
        nodeKind: "TEXT",
        representationId,
        innerRank: 1,
        rawScore: 1,
      }],
    }],
  });
}

function provider(
  channel: "LEXICAL" | "TEXT_VECTOR",
): RetrievalChannelProviderV2 {
  return {
    retrieve: vi.fn(async () => healthyResult(channel)),
  };
}

describe("text object channel probe v3", () => {
  it("is disabled by default and never touches providers", async () => {
    const lexical = provider("LEXICAL");
    const textVector = provider("TEXT_VECTOR");
    const probe = createTextObjectChannelProbeV3({
      enabled: false,
      capabilityEntityManifest: manifest(),
      lexicalProvider: lexical,
      textVectorProvider: textVector,
    });

    await expect(probe(query())).rejects.toThrow(
      "TEXT_OBJECT_CHANNEL_PROBE_DISABLED",
    );
    expect(lexical.retrieve).not.toHaveBeenCalled();
    expect(textVector.retrieve).not.toHaveBeenCalled();
  });

  it("runs each healthy text channel exactly once for a static query", async () => {
    const lexical = provider("LEXICAL");
    const textVector = provider("TEXT_VECTOR");
    const probe = createTextObjectChannelProbeV3({
      enabled: true,
      capabilityEntityManifest: manifest(),
      lexicalProvider: lexical,
      textVectorProvider: textVector,
    });

    const result = await probe(query());

    expect(result.prerequisiteTrace.decision)
      .toBe("STATIC_CORPUS_ELIGIBLE");
    expect(result.channels.LEXICAL.summary.channel)
      .toBe("LEXICAL");
    expect(result.channels.TEXT_VECTOR.summary.channel)
      .toBe("TEXT_VECTOR");
    expect(lexical.retrieve).toHaveBeenCalledTimes(1);
    expect(textVector.retrieve).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(
      /qrels|requiredEvidenceGroups|hardNegative/i,
    );
  });

  it("fails before provider invocation for non-static queries", async () => {
    const lexical = provider("LEXICAL");
    const textVector = provider("TEXT_VECTOR");
    const probe = createTextObjectChannelProbeV3({
      enabled: true,
      capabilityEntityManifest: manifest(),
      lexicalProvider: lexical,
      textVectorProvider: textVector,
    });

    await expect(
      probe(query("这张作品的版权归谁所有？")),
    ).rejects.toThrow(
      "TEXT_OBJECT_CHANNEL_PROBE_NON_STATIC",
    );
    expect(lexical.retrieve).not.toHaveBeenCalled();
    expect(textVector.retrieve).not.toHaveBeenCalled();
  });

  it("lets an ambiguous derived fragment inherit only its static parent intent", async () => {
    const lexical = provider("LEXICAL");
    const textVector = provider("TEXT_VECTOR");
    const probe = createTextObjectChannelProbeV3({
      enabled: true,
      capabilityEntityManifest: manifest(),
      lexicalProvider: lexical,
      textVectorProvider: textVector,
    });
    const parent = query(
      "这个字标感觉太冷，怎么判断是字形问题还是受众不合适？",
    );

    const result = await probe(
      query("这个字标感觉太冷"),
      { staticParentQuery: parent },
    );

    expect(result.prerequisiteBasis)
      .toBe("STATIC_PARENT_QUERY");
    expect(result.probePrerequisiteTrace.decision)
      .toBe("AMBIGUOUS");
    expect(result.prerequisiteTrace.decision)
      .toBe("STATIC_CORPUS_ELIGIBLE");
    expect(
      result.probePrerequisiteTrace.queryHash,
    ).not.toBe(result.prerequisiteTrace.queryHash);
    expect(lexical.retrieve).toHaveBeenCalledTimes(1);
    expect(textVector.retrieve).toHaveBeenCalledTimes(1);
  });

  it("rejects an unrelated parent and never uses it to bypass explicit non-static intent", async () => {
    const lexical = provider("LEXICAL");
    const textVector = provider("TEXT_VECTOR");
    const probe = createTextObjectChannelProbeV3({
      enabled: true,
      capabilityEntityManifest: manifest(),
      lexicalProvider: lexical,
      textVectorProvider: textVector,
    });

    await expect(
      probe(
        query("这个字标感觉太冷"),
        { staticParentQuery: query("网格怎么调整？") },
      ),
    ).rejects.toThrow(
      "TEXT_OBJECT_CHANNEL_PROBE_PARENT_BINDING_INVALID",
    );
    await expect(
      probe(
        query("这张作品的版权归谁所有？"),
        {
          staticParentQuery: query(
            "这张作品的版权归谁所有，先看什么再改？",
          ),
        },
      ),
    ).rejects.toThrow(
      "TEXT_OBJECT_CHANNEL_PROBE_NON_STATIC",
    );
    expect(lexical.retrieve).not.toHaveBeenCalled();
    expect(textVector.retrieve).not.toHaveBeenCalled();
  });

  it("fails closed when a channel faults or returns a foreign pack", async () => {
    const faulting: RetrievalChannelProviderV2 = {
      async retrieve() {
        return ChannelRetrievalResultV2Schema.parse({
          summary: {
            channel: "LEXICAL",
            status: "ERROR",
            reason: "PROVIDER_ERROR",
            corpusBundleHash: CORPUS_HASH,
            identity: null,
            hitCount: 0,
            timingMs: 1,
          },
          hits: [],
        });
      },
    };
    const faultProbe = createTextObjectChannelProbeV3({
      enabled: true,
      capabilityEntityManifest: manifest(),
      lexicalProvider: faulting,
      textVectorProvider: provider("TEXT_VECTOR"),
    });
    const foreignResult = healthyResult(
      "TEXT_VECTOR",
      "foreign-object",
    );
    foreignResult.objectCandidates![0]!.coursePackId =
      "brand-vi-design";
    const scopeProbe = createTextObjectChannelProbeV3({
      enabled: true,
      capabilityEntityManifest: manifest(),
      lexicalProvider: provider("LEXICAL"),
      textVectorProvider: {
        retrieve: vi.fn(async () => foreignResult),
      },
    });

    await expect(faultProbe(query())).rejects.toThrow(
      "TEXT_OBJECT_CHANNEL_PROBE_LEXICAL_INVALID",
    );
    await expect(scopeProbe(query())).rejects.toThrow(
      /preserve query course scope/,
    );
  });

  it("accepts a healthy empty ranking without inventing candidates", async () => {
    const empty = (
      channel: "LEXICAL" | "TEXT_VECTOR",
    ): RetrievalChannelProviderV2 => ({
      async retrieve() {
        const healthy = healthyResult(channel);
        return ChannelRetrievalResultV2Schema.parse({
          ...healthy,
          summary: {
            ...healthy.summary,
            status: "EMPTY",
            hitCount: 0,
          },
          hits: [],
          objectCandidates: [],
        });
      },
    });
    const probe = createTextObjectChannelProbeV3({
      enabled: true,
      capabilityEntityManifest: manifest(),
      lexicalProvider: empty("LEXICAL"),
      textVectorProvider: empty("TEXT_VECTOR"),
    });

    const result = await probe(query());

    expect(result.channels.LEXICAL.objectCandidates)
      .toEqual([]);
    expect(result.channels.TEXT_VECTOR.objectCandidates)
      .toEqual([]);
  });

  it("rejects a healthy channel bound to a different corpus", async () => {
    const drifted = healthyResult("LEXICAL");
    drifted.summary.corpusBundleHash = "0".repeat(64);
    const probe = createTextObjectChannelProbeV3({
      enabled: true,
      capabilityEntityManifest: manifest(),
      lexicalProvider: {
        retrieve: vi.fn(async () => drifted),
      },
      textVectorProvider: provider("TEXT_VECTOR"),
    });

    await expect(probe(query())).rejects.toThrow(
      /preserve query corpus scope/,
    );
  });
});
