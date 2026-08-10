import { z } from "zod";

import {
  EvidenceBundleV2Schema,
  type EvidenceBundleV2,
} from "@/lib/knowledge/evidence-bundle-v2";
import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";

const IdSchema = z.string()
  .regex(/^[a-z0-9][a-z0-9-]{0,127}$/);
const HashSchema = z.string()
  .regex(/^[0-9a-f]{64}$/);

export const AGENT_EVIDENCE_TOOL_LIMITS_V2 =
  Object.freeze({
    nodes: 5,
    excerptCharactersPerNode: 1_200,
    assets: 3,
    regions: 3,
    sources: 5,
    jsonBytes: 16 * 1_024,
  } as const);

const EvidencePreviewUrlSchema = z.string()
  .regex(
    /^\/api\/knowledge\/assets\/[a-z0-9][a-z0-9-]{0,127}$/,
  );

export const AgentEvidenceToolOutputV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    kind: z.literal(
      "KNOWLEDGE_MAP_SEARCH_EVIDENCE",
    ),
    bundle: z
      .object({
        bundleId: IdSchema,
        status: z.enum([
          "SUCCESS",
          "DEGRADED",
          "EMPTY",
          "UNSUPPORTED",
          "TIMEOUT",
          "ERROR",
        ]),
        queryHash: HashSchema,
        corpusBundleHash: HashSchema,
        activeIndexBundleHash: HashSchema,
        capabilitiesLost: z.array(z.enum([
          "LEXICAL",
          "TEXT_VECTOR",
          "VISUAL_VECTOR",
          "ASSET",
          "REGION",
          "TEXT_EVIDENCE",
          "GRAPH_CONTEXT",
        ])).max(7),
      })
      .strict(),
    channels: z.array(z
      .object({
        channel: z.enum([
          "LEXICAL",
          "TEXT_VECTOR",
          "VISUAL_VECTOR",
        ]),
        status: z.enum([
          "SUCCESS",
          "EMPTY",
          "UNAVAILABLE",
          "TIMEOUT",
          "ERROR",
          "SKIPPED",
        ]),
        hitCount:
          z.number().int().nonnegative().max(20),
        indexVersionId:
          IdSchema.nullable(),
        modelId:
          z.string().trim().min(1).max(300)
            .nullable(),
        modelRevision:
          z.string().trim().min(1).max(300)
            .nullable(),
      })
      .strict()).length(3),
    evidence: z
      .object({
        nodes: z.array(z
          .object({
            nodeId: IdSchema,
            objectId: IdSchema,
            sourceId: IdSchema,
            kind: z.enum([
              "DOCUMENT",
              "SECTION",
              "TEXT",
              "IMAGE",
              "TABLE",
              "REGION",
            ]),
            relation: z.enum([
              "PRIMARY",
              "PARENT",
              "SIBLING",
            ]),
            evidenceKind: z.enum([
              "KNOWLEDGE_FACT",
              "VISUAL_REFERENCE",
              "CONTEXT",
            ]),
            excerpt: z.string().max(
              AGENT_EVIDENCE_TOOL_LIMITS_V2
                .excerptCharactersPerNode,
            ).nullable(),
            assetId: IdSchema.nullable(),
          })
          .strict()).max(
            AGENT_EVIDENCE_TOOL_LIMITS_V2.nodes,
          ),
        assets: z.array(z
          .object({
            assetId: IdSchema,
            objectId: IdSchema,
            sha256: HashSchema,
            widthPx: z.number().int().positive(),
            heightPx: z.number().int().positive(),
            previewUrl: EvidencePreviewUrlSchema,
          })
          .strict()).max(
            AGENT_EVIDENCE_TOOL_LIMITS_V2.assets,
          ),
        regions: z.array(z
          .object({
            regionId: IdSchema,
            objectId: IdSchema,
            assetId: IdSchema,
            regionNodeId: IdSchema.nullable(),
            bbox: z.object({
              coordinateSpace:
                z.literal("NORMALIZED"),
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
              width: z.number().gt(0).max(1),
              height: z.number().gt(0).max(1),
            }).strict(),
            previewUrl: EvidencePreviewUrlSchema,
          })
          .strict()).max(
            AGENT_EVIDENCE_TOOL_LIMITS_V2.regions,
          ),
        sources: z.array(z
          .object({
            sourceId: IdSchema,
            objectId: IdSchema,
            title: z.string().trim().min(1).max(160),
            authority: z.enum([
              "OFFICIAL",
              "COURSE_DESIGN",
              "TEACHER_EXPERIENCE",
              "ANONYMIZED_CASE",
            ]),
            verifiedDate: z.iso.date(),
            scope:
              z.string().trim().min(1).max(300),
          })
          .strict()).max(
            AGENT_EVIDENCE_TOOL_LIMITS_V2.sources,
          ),
      })
      .strict(),
    usageRules: z
      .object({
        knowledgeFacts: z.literal(
          "只把带 excerpt 的课程节点作为课程知识事实。",
        ),
        visualReferences: z.literal(
          "图片和区域是课程参考图，只描述其中可见内容，不当作学生当前作品。",
        ),
        inference: z.literal(
          "超出节点文字或参考图可见内容的判断必须明确标为推断。",
        ),
        uncertainty: z.literal(
          "证据不足或通道降级时要说明不确定性，不得补造来源。",
        ),
      })
      .strict(),
  })
  .strict()
  .superRefine((output, context) => {
    if (
      Buffer.byteLength(
        JSON.stringify(output),
        "utf8",
      )
      > AGENT_EVIDENCE_TOOL_LIMITS_V2.jsonBytes
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Agent evidence tool output exceeds 16 KiB",
      });
    }
    const nodesById = new Map(
      output.evidence.nodes.map((node) => [
        node.nodeId,
        node,
      ]),
    );
    const assetsById = new Map(
      output.evidence.assets.map((asset) => [
        asset.assetId,
        asset,
      ]),
    );
    const sourcesById = new Map(
      output.evidence.sources.map((source) => [
        source.sourceId,
        source,
      ]),
    );
    for (
      const [kind, values] of [
        [
          "node",
          output.evidence.nodes.map(
            ({ nodeId }) => nodeId,
          ),
        ],
        [
          "asset",
          output.evidence.assets.map(
            ({ assetId }) => assetId,
          ),
        ],
        [
          "region",
          output.evidence.regions.map(
            ({ regionId }) => regionId,
          ),
        ],
        [
          "source",
          output.evidence.sources.map(
            ({ sourceId }) => sourceId,
          ),
        ],
      ] as const
    ) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message:
            `Agent evidence ${kind} ids must be unique`,
        });
      }
    }
    for (const node of output.evidence.nodes) {
      if (
        sourcesById.get(node.sourceId)
          ?.objectId !== node.objectId
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Agent evidence node source must be retained and object-local",
        });
      }
      if (
        node.assetId !== null
        && assetsById.get(node.assetId)
          ?.objectId !== node.objectId
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Agent evidence node asset must be retained and object-local",
        });
      }
    }
    for (
      const region of output.evidence.regions
    ) {
      if (
        assetsById.get(region.assetId)
          ?.objectId !== region.objectId
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Agent evidence region asset must be retained and object-local",
        });
      }
      if (
        region.regionNodeId !== null
        && (
          nodesById.get(region.regionNodeId)
            ?.objectId !== region.objectId
          || nodesById.get(region.regionNodeId)
            ?.assetId !== region.assetId
        )
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Agent evidence region node must be retained and object-local",
        });
      }
    }
  });

export type AgentEvidenceToolOutputV2 = z.infer<
  typeof AgentEvidenceToolOutputV2Schema
>;

export type AgentEvidenceSearchPortV2 = {
  search(input: {
    query: string;
    coursePackId: string;
    coursePackVersion: string;
    signal: AbortSignal;
  }): Promise<AgentEvidenceToolOutputV2>;
  runtimeHealth?(): {
    generationHash: string;
    textCircuitState: "CLOSED" | "OPEN" | "HALF_OPEN";
    visualCircuitState:
      | "CLOSED"
      | "OPEN"
      | "HALF_OPEN"
      | null;
    visualQueueDepth: number;
    visualCacheEntries: number;
  };
  openAsset?(assetId: string): Promise<{
    assetId: string;
    bytes: Uint8Array;
    contentType: "image/png";
    size: number;
    width: number;
    height: number;
    sha256: string;
  }>;
};

function previewUrl(assetId: string) {
  return `/api/knowledge/assets/${assetId}`;
}

function evidenceKind(
  node: EvidenceBundleV2["evidence"]["nodes"][number],
) {
  if (
    node.kind === "IMAGE"
    || node.kind === "REGION"
  ) {
    return "VISUAL_REFERENCE" as const;
  }
  if (
    node.kind === "TEXT"
    || node.kind === "TABLE"
  ) {
    return "KNOWLEDGE_FACT" as const;
  }
  return "CONTEXT" as const;
}

function sourceTitle(input: {
  sourceId: string;
  objectId: string;
  nodes: EvidenceBundleV2["evidence"]["nodes"];
}) {
  const excerpt = input.nodes.find(
    ({ sourceId }) =>
      sourceId === input.sourceId,
  )?.excerpt?.split(/\r?\n/u)[0]?.trim();
  return (
    excerpt
    || `课程知识对象：${input.objectId}`
  ).slice(0, 160);
}

export function projectEvidenceBundleForAgentV2(
  input: EvidenceBundleV2,
): AgentEvidenceToolOutputV2 {
  const bundle =
    EvidenceBundleV2Schema.parse(input);
  const candidateNodes = bundle.evidence.nodes
    .slice(
      0,
      AGENT_EVIDENCE_TOOL_LIMITS_V2.nodes,
    )
    .map((node) => ({
      nodeId: node.nodeId,
      objectId: node.objectId,
      sourceId: node.sourceId,
      kind: node.kind,
      relation: node.relation,
      evidenceKind: evidenceKind(node),
      excerpt: node.excerpt?.slice(
        0,
        AGENT_EVIDENCE_TOOL_LIMITS_V2
          .excerptCharactersPerNode,
      ) ?? null,
      assetId: node.assetId,
    }));
  const selectedAssetIds = new Set(
    candidateNodes.flatMap(({ assetId }) =>
      assetId ? [assetId] : []),
  );
  const assets = [
    ...bundle.evidence.assets.filter(
      ({ assetId }) =>
        selectedAssetIds.has(assetId),
    ),
    ...bundle.evidence.assets.filter(
      ({ assetId }) =>
        !selectedAssetIds.has(assetId),
    ),
  ]
    .slice(
      0,
      AGENT_EVIDENCE_TOOL_LIMITS_V2.assets,
    )
    .map((asset) => ({
      assetId: asset.assetId,
      objectId: asset.objectId,
      sha256: asset.sha256,
      widthPx: asset.dimensions.widthPx,
      heightPx: asset.dimensions.heightPx,
      previewUrl: previewUrl(asset.assetId),
    }));
  const retainedAssetIds = new Set(
    assets.map(({ assetId }) => assetId),
  );
  const nodes = candidateNodes.filter(
    ({ assetId }) =>
      assetId === null
      || retainedAssetIds.has(assetId),
  );
  const retainedNodeIds = new Set(
    nodes.map(({ nodeId }) => nodeId),
  );
  const regions = bundle.evidence.regions
    .filter(({ assetId }) =>
      retainedAssetIds.has(assetId))
    .slice(
      0,
      AGENT_EVIDENCE_TOOL_LIMITS_V2.regions,
    )
    .map((region) => ({
      regionId: region.regionId,
      objectId: region.objectId,
      assetId: region.assetId,
      regionNodeId:
        region.regionNodeId
        && retainedNodeIds.has(
          region.regionNodeId,
        )
          ? region.regionNodeId
          : null,
      bbox: region.bbox,
      previewUrl: previewUrl(region.assetId),
    }));
  const selectedSourceIds = new Set(
    nodes.map(({ sourceId }) => sourceId),
  );
  const sources = bundle.sources
    .filter(({ sourceId }) =>
      selectedSourceIds.has(sourceId))
    .slice(
      0,
      AGENT_EVIDENCE_TOOL_LIMITS_V2.sources,
    )
    .map((source) => ({
      sourceId: source.sourceId,
      objectId: source.objectId,
      title: sourceTitle({
        sourceId: source.sourceId,
        objectId: source.objectId,
        nodes: bundle.evidence.nodes,
      }),
      authority: source.authority,
      verifiedDate: source.verifiedDate,
      scope: source.scope.slice(0, 300),
    }));
  return AgentEvidenceToolOutputV2Schema.parse({
    schemaVersion: 2,
    kind: "KNOWLEDGE_MAP_SEARCH_EVIDENCE",
    bundle: {
      bundleId: bundle.bundleId,
      status: bundle.status,
      queryHash:
        sha256StableJsonV2(bundle.query),
      corpusBundleHash:
        bundle.provenance.corpusBundleHash,
      activeIndexBundleHash:
        bundle.provenance.activeIndexBundleHash,
      capabilitiesLost:
        bundle.provenance.capabilitiesLost,
    },
    channels: bundle.channels.map(
      (channel) => ({
        channel: channel.channel,
        status: channel.status,
        hitCount: channel.hitCount,
        indexVersionId:
          channel.identity?.indexVersionId
          ?? null,
        modelId:
          channel.identity?.modelId ?? null,
        modelRevision:
          channel.identity?.modelRevision ?? null,
      }),
    ),
    evidence: {
      nodes,
      assets,
      regions,
      sources,
    },
    usageRules: {
      knowledgeFacts:
        "只把带 excerpt 的课程节点作为课程知识事实。",
      visualReferences:
        "图片和区域是课程参考图，只描述其中可见内容，不当作学生当前作品。",
      inference:
        "超出节点文字或参考图可见内容的判断必须明确标为推断。",
      uncertainty:
        "证据不足或通道降级时要说明不确定性，不得补造来源。",
    },
  });
}
