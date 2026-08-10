import { z } from "zod";

import {
  CapabilityEntityManifestV2Schema,
  type CapabilityEntityManifestV2,
} from "./capability-boundary-v2";
import {
  ChannelRetrievalResultV2Schema,
  type ChannelRetrievalResultV2,
  type RetrievalChannelProviderV2,
} from "./hybrid-retriever-v2";
import {
  QueryPrerequisiteTraceV3Schema,
  evaluateQueryPrerequisiteV3,
} from "./query-prerequisite-router-v3";
import {
  createRetrievalQueryV2,
  RetrievalQueryV2Schema,
  type RetrievalQueryV2,
} from "./retrieval-query-v2";
import {
  CompiledDirectQueryV1Schema,
  MODEL_GUIDED_RETRIEVAL_LIMITS_V1,
  type CompiledDirectQueryV1,
} from "./retrieval-plan-v1";

export const DirectEvidenceChannelV1Schema = z.enum([
  "LEXICAL",
  "TEXT_VECTOR",
  "VISUAL_VECTOR",
]);

export type DirectEvidenceChannelV1 = z.infer<
  typeof DirectEvidenceChannelV1Schema
>;

const DirectEvidenceChannelsV1Schema = z
  .object({
    LEXICAL: ChannelRetrievalResultV2Schema.optional(),
    TEXT_VECTOR:
      ChannelRetrievalResultV2Schema.optional(),
    VISUAL_VECTOR:
      ChannelRetrievalResultV2Schema.optional(),
  })
  .strict();

export const DirectEvidenceProbeResultV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    query: CompiledDirectQueryV1Schema,
    prerequisiteBasis: z.enum([
      "PROBE_QUERY",
      "STATIC_PARENT_QUERY",
      "NON_FAIL_CLOSED_PROBE_QUERY",
    ]),
    probePrerequisite: QueryPrerequisiteTraceV3Schema,
    prerequisite: QueryPrerequisiteTraceV3Schema,
    status: z.enum([
      "SUCCESS",
      "EMPTY",
      "SKIPPED_NON_STATIC",
    ]),
    channels: DirectEvidenceChannelsV1Schema,
  })
  .strict()
  .superRefine((result, context) => {
    const entries = Object.entries(result.channels) as Array<
      [
        DirectEvidenceChannelV1,
        ChannelRetrievalResultV2,
      ]
    >;
    if (result.status === "SKIPPED_NON_STATIC") {
      if (
        entries.length > 0
        || result.prerequisiteBasis !== "PROBE_QUERY"
        || result.prerequisite.queryHash
          !== result.probePrerequisite.queryHash
      ) {
        context.addIssue({
          code: "custom",
          path: ["status"],
          message:
            "skipped direct probes cannot retain provider results or inherited authority",
        });
      }
      return;
    }
    if (
      result.prerequisiteBasis === "PROBE_QUERY"
      && (
        result.probePrerequisite.decision
          !== "STATIC_CORPUS_ELIGIBLE"
        || result.probePrerequisite.queryHash
          !== result.prerequisite.queryHash
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["prerequisiteBasis"],
        message:
          "direct prerequisite authority must come from the probe itself",
      });
    }
    if (
      result.prerequisiteBasis
        === "NON_FAIL_CLOSED_PROBE_QUERY"
      && (
        result.probePrerequisite.decision
          === "STATIC_CORPUS_ELIGIBLE"
        || result.probePrerequisite.failClosedEligible
        || result.probePrerequisite.queryHash
          !== result.prerequisite.queryHash
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["prerequisiteBasis"],
        message:
          "non-fail-closed probes require the same auditable non-static prerequisite",
      });
    }
    if (
      result.prerequisiteBasis
        === "STATIC_PARENT_QUERY"
      && (
        result.probePrerequisite.decision
          !== "AMBIGUOUS"
        || result.probePrerequisite.queryHash
          === result.prerequisite.queryHash
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["prerequisiteBasis"],
        message:
          "parent authority may only resolve an ambiguous derived query",
      });
    }
    const expectedChannels =
      enabledDirectEvidenceChannelsV1(result.query);
    const actualChannels = entries
      .map(([channel]) => channel)
      .sort(compareCodePoints);
    if (
      JSON.stringify(actualChannels)
      !== JSON.stringify(
        [...expectedChannels].sort(compareCodePoints),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["channels"],
        message:
          "direct probe channel set must match query modalities",
      });
    }
    for (const [channel, value] of entries) {
      if (value.summary.channel !== channel) {
        context.addIssue({
          code: "custom",
          path: ["channels", channel],
          message:
            "direct probe channel key must match provider summary",
        });
      }
      if (
        value.summary.corpusBundleHash
        !== result.prerequisite.corpusBundleHash
      ) {
        context.addIssue({
          code: "custom",
          path: ["channels", channel],
          message:
            "direct probe channel must preserve prerequisite corpus scope",
        });
      }
    }
    const hasHits = entries.some(
      ([, value]) => value.hits.length > 0,
    );
    if (
      (result.status === "SUCCESS") !== hasHits
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "direct probe status must reflect retained candidates",
      });
    }
  });

export const DirectEvidenceBatchResultV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("DIRECT_EVIDENCE_BATCH"),
    expectedProviderCalls:
      z.number().int().min(0).max(15),
    results: z.array(DirectEvidenceProbeResultV1Schema)
      .min(1)
      .max(
        MODEL_GUIDED_RETRIEVAL_LIMITS_V1
          .maximumPhysicalQueries,
      ),
  })
  .strict()
  .superRefine((batch, context) => {
    const queryIds = batch.results.map(
      ({ query }) => query.queryId,
    );
    const normalizedTexts = batch.results.map(
      ({ query }) => query.normalizedText,
    );
    if (
      new Set(queryIds).size !== queryIds.length
      || new Set(normalizedTexts).size
        !== normalizedTexts.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["results"],
        message:
          "direct evidence batch queries must be physically deduplicated",
      });
    }
    if (
      batch.results[0]?.query.source
        !== "WHOLE_QUERY"
      || batch.results.filter(
        ({ query }) => query.source === "WHOLE_QUERY",
      ).length !== 1
    ) {
      context.addIssue({
        code: "custom",
        path: ["results"],
        message:
          "direct evidence batch must retain exactly one leading whole query",
      });
    }
    const expectedProviderCalls = batch.results.reduce(
      (count, result) =>
        count
        + (
          result.status === "SKIPPED_NON_STATIC"
            ? 0
            : Object.keys(result.channels).length
        ),
      0,
    );
    if (
      batch.expectedProviderCalls
      !== expectedProviderCalls
    ) {
      context.addIssue({
        code: "custom",
        path: ["expectedProviderCalls"],
        message:
          "expected provider calls must be derived from executable frozen channels",
      });
    }
  });

export type DirectEvidenceProbeResultV1 = z.infer<
  typeof DirectEvidenceProbeResultV1Schema
>;
export type DirectEvidenceBatchResultV1 = z.infer<
  typeof DirectEvidenceBatchResultV1Schema
>;

export type DirectEvidenceProbeContextV1 = {
  signal?: AbortSignal;
  staticParentQuery: RetrievalQueryV2;
};

export type DirectEvidenceCorpusBindingsV1 = {
  objectCoursePackById: ReadonlyMap<string, string>;
  nodeOwnerById: ReadonlyMap<string, string>;
  assetOwnerById: ReadonlyMap<string, string>;
};

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function enabledDirectEvidenceChannelsV1(
  queryInput: CompiledDirectQueryV1,
): DirectEvidenceChannelV1[] {
  const query = CompiledDirectQueryV1Schema.parse(
    queryInput,
  );
  return [
    ...(query.modalities.includes("TEXT")
      ? [
          "LEXICAL" as const,
          "TEXT_VECTOR" as const,
        ]
      : []),
    ...(query.modalities.includes("IMAGE")
      ? ["VISUAL_VECTOR" as const]
      : []),
  ];
}

function providerForChannel(
  input: {
    lexicalProvider: RetrievalChannelProviderV2;
    textVectorProvider: RetrievalChannelProviderV2;
    visualVectorProvider: RetrievalChannelProviderV2;
  },
  channel: DirectEvidenceChannelV1,
) {
  if (channel === "LEXICAL") {
    return input.lexicalProvider;
  }
  if (channel === "TEXT_VECTOR") {
    return input.textVectorProvider;
  }
  return input.visualVectorProvider;
}

function queryForChannel(input: {
  query: CompiledDirectQueryV1;
  parent: RetrievalQueryV2;
  channel: DirectEvidenceChannelV1;
}) {
  return createRetrievalQueryV2({
    mode: input.channel === "VISUAL_VECTOR"
      ? "TEXT_TO_IMAGE"
      : "TEXT_TO_TEXT",
    text: input.query.normalizedText,
    scope: input.parent.scope,
    excludeAssetIds: input.parent.excludeAssetIds,
  });
}

function ownerBindingValid(input: {
  objectId: string;
  nodeId: string | null;
  assetId: string | null;
  coursePackId: string;
  bindings: DirectEvidenceCorpusBindingsV1;
}) {
  return (
    input.bindings.objectCoursePackById.get(
      input.objectId,
    ) === input.coursePackId
    && (
      input.nodeId === null
      || input.bindings.nodeOwnerById.get(
        input.nodeId,
      ) === input.objectId
    )
    && (
      input.assetId === null
      || input.bindings.assetOwnerById.get(
        input.assetId,
      ) === input.objectId
    )
  );
}

function sanitizeHealthyChannel(input: {
  raw: unknown;
  channel: DirectEvidenceChannelV1;
  query: RetrievalQueryV2;
  bindings: DirectEvidenceCorpusBindingsV1;
}): ChannelRetrievalResultV2 {
  const parsed = ChannelRetrievalResultV2Schema.safeParse(
    input.raw,
  );
  if (!parsed.success) {
    throw new Error(
      `DIRECT_EVIDENCE_CHANNEL_INVALID:${input.channel}`,
    );
  }
  const result = parsed.data;
  if (result.summary.channel !== input.channel) {
    throw new Error(
      `DIRECT_EVIDENCE_CHANNEL_MISMATCH:${input.channel}`,
    );
  }
  if (
    result.summary.status !== "SUCCESS"
    && result.summary.status !== "EMPTY"
  ) {
    throw new Error(
      "DIRECT_EVIDENCE_CHANNEL_UNHEALTHY:"
      + `${input.channel}:${result.summary.status}`,
    );
  }
  if (
    result.summary.identity === null
    || result.summary.reason !== null
    || result.summary.corpusBundleHash
      !== input.query.scope.corpusBundleHash
    || (
      result.summary.status === "SUCCESS"
      && result.hits.length === 0
    )
    || (
      result.summary.status === "EMPTY"
      && result.hits.length > 0
    )
  ) {
    throw new Error(
      `DIRECT_EVIDENCE_CHANNEL_INVALID:${input.channel}`,
    );
  }
  const coursePackId =
    input.query.scope.sourceCoursePack?.id;
  if (!coursePackId) {
    throw new Error(
      "DIRECT_EVIDENCE_PROBE_COURSE_SCOPE_REQUIRED",
    );
  }
  const hits = result.hits
    .filter((hit) =>
      ownerBindingValid({
        objectId: hit.objectId,
        nodeId: hit.nodeId,
        assetId: hit.assetId,
        coursePackId,
        bindings: input.bindings,
      }))
    .map((hit, index) => ({
      ...hit,
      rank: index + 1,
    }));
  const retainedObjectIds = new Set(
    hits.map(({ objectId }) => objectId),
  );
  const objectCandidates = result.objectCandidates
    ?.flatMap((candidate) => {
      if (
        candidate.coursePackId !== coursePackId
        || !retainedObjectIds.has(candidate.objectId)
        || input.bindings.objectCoursePackById.get(
          candidate.objectId,
        ) !== coursePackId
      ) {
        return [];
      }
      const nodes = candidate.nodes
        .filter((node) =>
          input.bindings.nodeOwnerById.get(
            node.nodeId,
          ) === candidate.objectId)
        .map((node, index) => ({
          ...node,
          innerRank: index + 1,
        }));
      if (nodes.length === 0) return [];
      return [{
        ...candidate,
        objectRank: 1,
        rawScore: nodes[0]!.rawScore,
        nodes,
      }];
    })
    .map((candidate, index) => ({
      ...candidate,
      objectRank: index + 1,
    }));
  const visualAssetHits = result.visualAssetHits
    ?.filter((hit) =>
      retainedObjectIds.has(hit.objectId)
      && ownerBindingValid({
        objectId: hit.objectId,
        nodeId: hit.nodeId,
        assetId: hit.assetId,
        coursePackId,
        bindings: input.bindings,
      }))
    .map((hit, index) => ({
      ...hit,
      rank: index + 1,
    }));
  const status = hits.length > 0
    ? "SUCCESS"
    : "EMPTY";
  return ChannelRetrievalResultV2Schema.parse({
    ...result,
    summary: {
      ...result.summary,
      status,
      reason: null,
      hitCount: hits.length,
    },
    hits,
    ...(result.objectCandidates === undefined
      ? {}
      : { objectCandidates: objectCandidates ?? [] }),
    ...(result.visualAssetHits === undefined
      ? {}
      : { visualAssetHits: visualAssetHits ?? [] }),
  });
}

function parentAuthority(input: {
  query: CompiledDirectQueryV1;
  parent: RetrievalQueryV2;
  manifest: CapabilityEntityManifestV2;
}) {
  if (
    input.parent.mode !== "TEXT_TO_TEXT"
    || input.parent.normalizedText === null
    || input.parent.scope.sourceCoursePack === null
  ) {
    throw new Error(
      "DIRECT_EVIDENCE_PROBE_PARENT_UNSUPPORTED",
    );
  }
  if (
    input.query.source === "WHOLE_QUERY"
    && input.query.normalizedText
      !== input.parent.normalizedText
  ) {
    throw new Error(
      "DIRECT_EVIDENCE_WHOLE_QUERY_PARENT_MISMATCH",
    );
  }
  const probeQuery = queryForChannel({
    query: input.query,
    parent: input.parent,
    channel: "LEXICAL",
  });
  const probePrerequisite =
    evaluateQueryPrerequisiteV3({
      query: probeQuery,
      capabilityEntityManifest: input.manifest,
    });
  if (
    probePrerequisite.decision
    === "STATIC_CORPUS_ELIGIBLE"
  ) {
    return {
      executable: true as const,
      probeQuery,
      probePrerequisite,
      prerequisiteBasis: "PROBE_QUERY" as const,
      prerequisite: probePrerequisite,
    };
  }
  if (
    probePrerequisite.decision === "AMBIGUOUS"
    && input.query.normalizedText
      !== input.parent.normalizedText
    && input.parent.normalizedText.includes(
      input.query.normalizedText,
    )
  ) {
    const prerequisite = evaluateQueryPrerequisiteV3({
      query: input.parent,
      capabilityEntityManifest: input.manifest,
    });
    if (
      prerequisite.decision
      === "STATIC_CORPUS_ELIGIBLE"
    ) {
      return {
        executable: true as const,
        probeQuery,
        probePrerequisite,
        prerequisiteBasis:
          "STATIC_PARENT_QUERY" as const,
        prerequisite,
      };
    }
  }
  if (!probePrerequisite.failClosedEligible) {
    return {
      executable: true as const,
      probeQuery,
      probePrerequisite,
      prerequisiteBasis:
        "NON_FAIL_CLOSED_PROBE_QUERY" as const,
      prerequisite: probePrerequisite,
    };
  }
  return {
    executable: false as const,
    probeQuery,
    probePrerequisite,
    prerequisiteBasis: "PROBE_QUERY" as const,
    prerequisite: probePrerequisite,
  };
}

export function createDirectEvidenceChannelProbeV1(
  input: {
    enabled: boolean;
    capabilityEntityManifest:
      CapabilityEntityManifestV2;
    lexicalProvider: RetrievalChannelProviderV2;
    textVectorProvider: RetrievalChannelProviderV2;
    visualVectorProvider: RetrievalChannelProviderV2;
    bindings: DirectEvidenceCorpusBindingsV1;
  },
) {
  const manifest = CapabilityEntityManifestV2Schema.parse(
    input.capabilityEntityManifest,
  );

  const probeDirectEvidenceChannels = async (
    queryInput: CompiledDirectQueryV1,
    context: DirectEvidenceProbeContextV1,
  ): Promise<DirectEvidenceProbeResultV1> => {
    if (!input.enabled) {
      throw new Error(
        "DIRECT_EVIDENCE_PROBE_DISABLED",
      );
    }
    const query = CompiledDirectQueryV1Schema.parse(
      queryInput,
    );
    const parent = RetrievalQueryV2Schema.parse(
      context.staticParentQuery,
    );
    if (
      parent.scope.corpusBundleHash
      !== manifest.corpusBundleHash
    ) {
      throw new Error(
        "DIRECT_EVIDENCE_PROBE_MANIFEST_SCOPE_MISMATCH",
      );
    }
    const authority = parentAuthority({
      query,
      parent,
      manifest,
    });
    if (!authority.executable) {
      return DirectEvidenceProbeResultV1Schema.parse({
        schemaVersion: 1,
        query,
        prerequisiteBasis:
          authority.prerequisiteBasis,
        probePrerequisite:
          authority.probePrerequisite,
        prerequisite: authority.prerequisite,
        status: "SKIPPED_NON_STATIC",
        channels: {},
      });
    }
    const enabledChannels =
      enabledDirectEvidenceChannelsV1(query);
    const entries = await Promise.all(
      enabledChannels.map(async (channel) => {
        const provider = providerForChannel(
          input,
          channel,
        );
        const providerQuery = queryForChannel({
          query,
          parent,
          channel,
        });
        const raw = await Promise.resolve()
          .then(() => provider.retrieve(
            providerQuery,
            { signal: context.signal },
          ));
        const result = sanitizeHealthyChannel({
          raw,
          channel,
          query: providerQuery,
          bindings: input.bindings,
        });
        return [channel, result] as const;
      }),
    );
    const channels = Object.fromEntries(entries);
    const status = entries.some(
      ([, result]) => result.hits.length > 0,
    )
      ? "SUCCESS"
      : "EMPTY";
    return DirectEvidenceProbeResultV1Schema.parse({
      schemaVersion: 1,
      query,
      prerequisiteBasis:
        authority.prerequisiteBasis,
      probePrerequisite:
        authority.probePrerequisite,
      prerequisite: authority.prerequisite,
      status,
      channels,
    });
  };

  const probeDirectEvidenceBatch = async (
    queryInputs: readonly CompiledDirectQueryV1[],
    context: DirectEvidenceProbeContextV1,
  ): Promise<DirectEvidenceBatchResultV1> => {
    if (!input.enabled) {
      throw new Error(
        "DIRECT_EVIDENCE_PROBE_DISABLED",
      );
    }
    const queries = z.array(
      CompiledDirectQueryV1Schema,
    )
      .min(1)
      .max(
        MODEL_GUIDED_RETRIEVAL_LIMITS_V1
          .maximumPhysicalQueries,
      )
      .parse(queryInputs);
    const results = await Promise.all(
      queries.map((query) =>
        probeDirectEvidenceChannels(query, context)),
    );
    return DirectEvidenceBatchResultV1Schema.parse({
      schemaVersion: 1,
      kind: "DIRECT_EVIDENCE_BATCH",
      expectedProviderCalls: results.reduce(
        (count, result) =>
          count
          + (
            result.status === "SKIPPED_NON_STATIC"
              ? 0
              : Object.keys(result.channels).length
          ),
        0,
      ),
      results,
    });
  };

  return {
    probeDirectEvidenceChannels,
    probeDirectEvidenceBatch,
  };
}
