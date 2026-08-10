import { z } from "zod";

import {
  CapabilityEntityManifestV2Schema,
  type CapabilityEntityManifestV2,
} from "./capability-boundary-v2";
import {
  ChannelRetrievalResultV2Schema,
  type RetrievalChannelProviderV2,
} from "./hybrid-retriever-v2";
import {
  QueryPrerequisiteTraceV3Schema,
  evaluateQueryPrerequisiteV3,
} from "./query-prerequisite-router-v3";
import {
  RetrievalQueryV2Schema,
  type RetrievalQueryV2,
} from "./retrieval-query-v2";

const HealthyTextObjectChannelResultV3Schema =
  ChannelRetrievalResultV2Schema
    .superRefine((result, context) => {
      if (
        result.summary.channel !== "LEXICAL"
        && result.summary.channel !== "TEXT_VECTOR"
      ) {
        context.addIssue({
          code: "custom",
          path: ["summary", "channel"],
          message: "text-object probes only accept text channels",
        });
      }
      if (
        result.summary.status !== "SUCCESS"
        && result.summary.status !== "EMPTY"
      ) {
        context.addIssue({
          code: "custom",
          path: ["summary", "status"],
          message: "text-object probes fail closed on channel faults",
        });
      }
      const candidates = result.objectCandidates ?? [];
      if (
        result.summary.status === "SUCCESS"
        && candidates.length === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["objectCandidates"],
          message: "successful object probes require object candidates",
        });
      }
      if (
        result.summary.status === "EMPTY"
        && candidates.length > 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["objectCandidates"],
          message: "empty object probes cannot retain candidates",
        });
      }
    });

export const TextObjectChannelProbeResultV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    kind: z.literal("TEXT_OBJECT_CHANNEL_PROBE"),
    query: RetrievalQueryV2Schema,
    prerequisiteBasis: z.enum([
      "PROBE_QUERY",
      "STATIC_PARENT_QUERY",
    ]),
    probePrerequisiteTrace:
      QueryPrerequisiteTraceV3Schema,
    prerequisiteTrace: QueryPrerequisiteTraceV3Schema,
    channels: z
      .object({
        LEXICAL: HealthyTextObjectChannelResultV3Schema,
        TEXT_VECTOR:
          HealthyTextObjectChannelResultV3Schema,
      })
      .strict(),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.prerequisiteBasis === "PROBE_QUERY"
      && (
        result.probePrerequisiteTrace.decision
          !== "STATIC_CORPUS_ELIGIBLE"
        || result.probePrerequisiteTrace.queryHash
          !== result.prerequisiteTrace.queryHash
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["prerequisiteBasis"],
        message:
          "direct probe prerequisite must be independently static",
      });
    }
    if (
      result.prerequisiteBasis
        === "STATIC_PARENT_QUERY"
      && (
        result.probePrerequisiteTrace.decision
          !== "AMBIGUOUS"
        || result.probePrerequisiteTrace.queryHash
          === result.prerequisiteTrace.queryHash
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["prerequisiteBasis"],
        message:
          "parent inheritance only resolves an ambiguous derived probe",
      });
    }
    if (
      result.prerequisiteTrace.decision
      !== "STATIC_CORPUS_ELIGIBLE"
    ) {
      context.addIssue({
        code: "custom",
        path: ["prerequisiteTrace", "decision"],
        message: "text-object probes require a static query",
      });
    }
    if (
      result.channels.LEXICAL.summary.channel
      !== "LEXICAL"
      || result.channels.TEXT_VECTOR.summary.channel
      !== "TEXT_VECTOR"
    ) {
      context.addIssue({
        code: "custom",
        path: ["channels"],
        message: "text-object channels must use canonical keys",
      });
    }
    if (
      result.channels.LEXICAL.summary.corpusBundleHash
        !== result.query.scope.corpusBundleHash
      || result.channels.TEXT_VECTOR.summary
        .corpusBundleHash
        !== result.query.scope.corpusBundleHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["channels"],
        message:
          "text-object channels must preserve query corpus scope",
      });
    }
    const scope = result.query.scope.sourceCoursePack;
    if (
      scope
      && [
        ...(result.channels.LEXICAL.objectCandidates ?? []),
        ...(result.channels.TEXT_VECTOR.objectCandidates ?? []),
      ].some(({ coursePackId }) =>
        coursePackId !== scope.id)
    ) {
      context.addIssue({
        code: "custom",
        path: ["channels"],
        message: "object probes must preserve query course scope",
      });
    }
  });

export type TextObjectChannelProbeResultV3 = z.infer<
  typeof TextObjectChannelProbeResultV3Schema
>;

export type TextObjectChannelProbeContextV3 = {
  signal?: AbortSignal;
  staticParentQuery?: RetrievalQueryV2;
};

function sameProbeScope(
  left: RetrievalQueryV2,
  right: RetrievalQueryV2,
) {
  return (
    left.mode === right.mode
    && JSON.stringify(left.scope)
      === JSON.stringify(right.scope)
    && JSON.stringify(left.excludeAssetIds)
      === JSON.stringify(right.excludeAssetIds)
    && JSON.stringify(left.queryAsset)
      === JSON.stringify(right.queryAsset)
  );
}

export function createTextObjectChannelProbeV3(input: {
  enabled: boolean;
  capabilityEntityManifest: CapabilityEntityManifestV2;
  lexicalProvider: RetrievalChannelProviderV2;
  textVectorProvider: RetrievalChannelProviderV2;
}) {
  const manifest = CapabilityEntityManifestV2Schema.parse(
    input.capabilityEntityManifest,
  );

  return async function probeTextObjectChannelsV3(
    queryInput: RetrievalQueryV2,
    context: TextObjectChannelProbeContextV3 = {},
  ): Promise<TextObjectChannelProbeResultV3> {
    if (!input.enabled) {
      throw new Error("TEXT_OBJECT_CHANNEL_PROBE_DISABLED");
    }
    const query = RetrievalQueryV2Schema.parse(queryInput);
    if (
      query.mode !== "TEXT_TO_TEXT"
      || query.normalizedText === null
      || query.scope.sourceCoursePack === null
    ) {
      throw new Error(
        "TEXT_OBJECT_CHANNEL_PROBE_QUERY_UNSUPPORTED",
      );
    }
    const probePrerequisiteTrace =
      evaluateQueryPrerequisiteV3({
        query,
        capabilityEntityManifest: manifest,
      });
    let prerequisiteBasis:
      | "PROBE_QUERY"
      | "STATIC_PARENT_QUERY" =
        "PROBE_QUERY";
    let prerequisiteTrace = probePrerequisiteTrace;
    if (
      probePrerequisiteTrace.decision === "AMBIGUOUS"
      && context.staticParentQuery !== undefined
    ) {
      const parentQuery =
        RetrievalQueryV2Schema.parse(
          context.staticParentQuery,
        );
      if (
        parentQuery.mode !== "TEXT_TO_TEXT"
        || parentQuery.normalizedText === null
        || parentQuery.normalizedText
          === query.normalizedText
        || !parentQuery.normalizedText.includes(
          query.normalizedText,
        )
        || !sameProbeScope(parentQuery, query)
      ) {
        throw new Error(
          "TEXT_OBJECT_CHANNEL_PROBE_PARENT_BINDING_INVALID",
        );
      }
      const parentTrace =
        evaluateQueryPrerequisiteV3({
          query: parentQuery,
          capabilityEntityManifest: manifest,
        });
      if (
        parentTrace.decision
        !== "STATIC_CORPUS_ELIGIBLE"
      ) {
        throw new Error(
          "TEXT_OBJECT_CHANNEL_PROBE_PARENT_NON_STATIC:"
          + parentTrace.decision,
        );
      }
      prerequisiteBasis = "STATIC_PARENT_QUERY";
      prerequisiteTrace = parentTrace;
    }
    if (
      prerequisiteTrace.decision
      !== "STATIC_CORPUS_ELIGIBLE"
    ) {
      throw new Error(
        "TEXT_OBJECT_CHANNEL_PROBE_NON_STATIC:"
        + prerequisiteTrace.decision,
      );
    }

    const [lexicalRaw, textVectorRaw] = await Promise.all([
      input.lexicalProvider.retrieve(query, context),
      input.textVectorProvider.retrieve(query, context),
    ]);
    const lexical =
      HealthyTextObjectChannelResultV3Schema.safeParse(
        lexicalRaw,
      );
    if (!lexical.success) {
      throw new Error(
        "TEXT_OBJECT_CHANNEL_PROBE_LEXICAL_INVALID:"
        + lexical.error.issues
          .map(({ message }) => message)
          .join("|"),
      );
    }
    const textVector =
      HealthyTextObjectChannelResultV3Schema.safeParse(
        textVectorRaw,
      );
    if (!textVector.success) {
      throw new Error(
        "TEXT_OBJECT_CHANNEL_PROBE_TEXT_VECTOR_INVALID:"
        + textVector.error.issues
          .map(({ message }) => message)
          .join("|"),
      );
    }
    return TextObjectChannelProbeResultV3Schema.parse({
      schemaVersion: 3,
      kind: "TEXT_OBJECT_CHANNEL_PROBE",
      query,
      prerequisiteBasis,
      probePrerequisiteTrace,
      prerequisiteTrace,
      channels: {
        LEXICAL: lexical.data,
        TEXT_VECTOR: textVector.data,
      },
    });
  };
}
