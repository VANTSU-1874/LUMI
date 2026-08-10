import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  AGENT_EVIDENCE_TOOL_LIMITS_V2,
  AgentEvidenceToolOutputV2Schema,
  type AgentEvidenceToolOutputV2,
  type AgentEvidenceSearchPortV2,
} from "@/lib/agent/evidence-tool-v2";
import {
  disposeAgentEvidenceRuntimeV2,
  getFixedAgentEvidenceSearchPortV2ForAudit,
} from "@/lib/knowledge/agent-evidence-runtime-v2";

export const T5_AGENT_EVIDENCE_QUESTION_V2 =
  "我的标题、图片和亮色都很抢，第一眼不知道看哪儿，先怎么判断冲突？";

const COURSE_PACK_ID = "layout-design";
const COURSE_PACK_VERSION = "1";
const EXPECTED_CORPUS_HASH =
  "82db90934afaffa3d227b6b0d11ab5efdb88009fd8b9274845567de4888079f8";
const EXPECTED_INDEX_HASH =
  "cad61822cf3e4d95e984b08c66fa6427c5adf182fc305329291f8eb9aad1be5d";

export function evaluateAgentEvidenceSmokeV2(
  outputInput: unknown,
) {
  const output =
    AgentEvidenceToolOutputV2Schema.parse(
      outputInput,
    );
  const json = JSON.stringify(output);
  const jsonBytes =
    Buffer.byteLength(json, "utf8");
  const sourcesById = new Map(
    output.evidence.sources.map((source) => [
      source.sourceId,
      source,
    ]),
  );
  const assetsById = new Map(
    output.evidence.assets.map((asset) => [
      asset.assetId,
      asset,
    ]),
  );
  const nodesById = new Map(
    output.evidence.nodes.map((node) => [
      node.nodeId,
      node,
    ]),
  );
  const checks = {
    successfulBundle:
      output.bundle.status === "SUCCESS",
    frozenIdentity:
      output.bundle.corpusBundleHash
        === EXPECTED_CORPUS_HASH
      && output.bundle.activeIndexBundleHash
        === EXPECTED_INDEX_HASH,
    allChannelsSucceeded:
      output.channels.length === 3
      && output.channels.every(
        ({ status }) => status === "SUCCESS",
      ),
    boundedOutput:
      jsonBytes
        <= AGENT_EVIDENCE_TOOL_LIMITS_V2
          .jsonBytes,
    evidencePresent:
      output.evidence.nodes.length > 0
      && output.evidence.sources.length > 0
      && output.evidence.assets.length > 0
      && output.evidence.regions.length > 0,
    nodeSourcesTraceable:
      output.evidence.nodes.every((node) =>
        sourcesById.get(node.sourceId)
          ?.objectId === node.objectId),
    nodeAssetsTraceable:
      output.evidence.nodes.every((node) =>
        node.assetId === null
        || assetsById.get(node.assetId)
          ?.objectId === node.objectId),
    regionsTraceable:
      output.evidence.regions.every(
        (region) =>
          assetsById.get(region.assetId)
            ?.objectId === region.objectId
          && (
            region.regionNodeId === null
            || nodesById.get(
              region.regionNodeId,
            )?.objectId === region.objectId
          ),
      ),
    previewUrlsControlled: [
      ...output.evidence.assets.map(
        ({ assetId, previewUrl }) =>
          previewUrl
            === `/api/knowledge/assets/${assetId}`,
      ),
      ...output.evidence.regions.map(
        ({ assetId, previewUrl }) =>
          previewUrl
            === `/api/knowledge/assets/${assetId}`,
      ),
    ].every(Boolean),
    noLocalLocatorLeak:
      !json.includes("data/courses")
      && !json.includes("LOCAL_DOCUMENT")
      && !json.includes("\\"),
  };
  return {
    question:
      T5_AGENT_EVIDENCE_QUESTION_V2,
    coursePack: {
      id: COURSE_PACK_ID,
      version: COURSE_PACK_VERSION,
    },
    bundle: output.bundle,
    channels: output.channels,
    counts: {
      nodes: output.evidence.nodes.length,
      assets: output.evidence.assets.length,
      regions: output.evidence.regions.length,
      sources: output.evidence.sources.length,
    },
    nodeIds: output.evidence.nodes.map(
      ({ nodeId }) => nodeId,
    ),
    objectIds: [
      ...new Set(output.evidence.nodes.map(
        ({ objectId }) => objectId,
      )),
    ],
    assetIds: output.evidence.assets.map(
      ({ assetId }) => assetId,
    ),
    regionIds: output.evidence.regions.map(
      ({ regionId }) => regionId,
    ),
    sourceIds: output.evidence.sources.map(
      ({ sourceId }) => sourceId,
    ),
    jsonBytes,
    limitBytes:
      AGENT_EVIDENCE_TOOL_LIMITS_V2.jsonBytes,
    checks,
    decision: Object.values(checks).every(Boolean)
      ? "T5_AGENT_EVIDENCE_GO" as const
      : "T5_AGENT_EVIDENCE_NO_GO" as const,
  };
}

type Dependencies = {
  getPort(
    workspaceRoot: string,
  ): Promise<AgentEvidenceSearchPortV2>;
  dispose(workspaceRoot: string): Promise<void>;
};

const DEFAULT_DEPENDENCIES: Dependencies = {
  getPort: (workspaceRoot) =>
    getFixedAgentEvidenceSearchPortV2ForAudit(
      workspaceRoot,
    ),
  dispose: disposeAgentEvidenceRuntimeV2,
};

export async function runAgentEvidenceSmokeV2(
  workspaceRoot = process.cwd(),
  dependencies: Dependencies =
    DEFAULT_DEPENDENCIES,
) {
  const resolvedRoot = path.resolve(
    workspaceRoot,
  );
  const port =
    await dependencies.getPort(resolvedRoot);
  try {
    const output = await port.search({
      query: T5_AGENT_EVIDENCE_QUESTION_V2,
      coursePackId: COURSE_PACK_ID,
      coursePackVersion:
        COURSE_PACK_VERSION,
      signal:
        new AbortController().signal,
    });
    return evaluateAgentEvidenceSmokeV2(
      output,
    );
  } finally {
    await dependencies.dispose(resolvedRoot);
  }
}

async function main() {
  const report =
    await runAgentEvidenceSmokeV2();
  process.stdout.write(
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (
    report.decision
    !== "T5_AGENT_EVIDENCE_GO"
  ) {
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1];
if (
  entryPoint
  && import.meta.url
    === pathToFileURL(path.resolve(entryPoint)).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error
        ? error.message
        : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
