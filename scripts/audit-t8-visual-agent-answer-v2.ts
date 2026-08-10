import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  type AgentEvidenceSearchPortV2,
  AgentEvidenceToolOutputV2Schema,
  type AgentEvidenceToolOutputV2,
} from "@/lib/agent/evidence-tool-v2";
import {
  guardModelProviderSecretOutputs,
} from "@/lib/agent/evaluation-safety";
import {
  createOpenAICompatibleModelProvider,
} from "@/lib/agent/model-provider-adapter";
import {
  disposeAgentEvidenceRuntimeV2,
  fixedAgentEvidenceRuntimeOptionsV2,
  getFixedAgentEvidenceSearchPortV2ForAudit,
} from "@/lib/knowledge/agent-evidence-runtime-v2";
import { projectEvidenceBundleForAgentV2 } from "@/lib/agent/evidence-tool-v2";
import { createLocalMixedRuntimeV2 } from "@/lib/knowledge/mixed-retrieval-runtime-v2";
import { createRetrievalQueryV2 } from "@/lib/knowledge/retrieval-query-v2";
import { createActiveKnowledgeGenerationLoaderV2 } from "@/lib/knowledge/active-knowledge-generation-v2";
import {
  ingestPreparedKnowledgeV2,
  prepareKnowledgeV2Ingestion,
  storeKnowledgeIndexBundleV2,
} from "@/lib/knowledge/knowledge-v2-store";
import { isGpt56ModelId } from "@/lib/ai/model-id";
import { readEnv } from "@/lib/config/env";
import { loadRuntimeEnvironment } from "@/lib/config/runtime-environment";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

export const T8_VISUAL_AGENT_QUESTION_V2 =
  "我的标题、图片和亮色都很抢，第一眼不知道看哪儿，先怎么判断冲突？";

const COURSE_PACK = Object.freeze({
  id: "layout-design",
  version: "1",
});
const MAX_EVIDENCE_NODES = 3;
const MAX_PREVIEW_IMAGES = 5;
const MAX_EXCERPT_CHARACTERS = 1_000;
const MAX_PROMPT_BYTES = 12 * 1_024;
const OUTPUT_ROOT = ".runtime/t8-visual-agent-answer";
let auditStage = "START";

type BoundedNode = {
  sourceId: string;
  nodeId: string;
  evidenceKind: "KNOWLEDGE_FACT" | "VISUAL_REFERENCE" | "CONTEXT";
  excerpt: string;
};

export type T8VisualOutboundPayload = {
  question: string;
  coursePack: typeof COURSE_PACK;
  evidence: {
    nodes: BoundedNode[];
    sources: Array<{
      sourceId: string;
      title: string;
      authority: "OFFICIAL" | "COURSE_DESIGN" | "TEACHER_EXPERIENCE" | "ANONYMIZED_CASE";
    }>;
  };
};

export function buildT8VisualOutboundPayload(
  input: {
    textOutput: AgentEvidenceToolOutputV2;
    visualOutput: AgentEvidenceToolOutputV2;
  },
) {
  const textOutput = AgentEvidenceToolOutputV2Schema.parse(input.textOutput);
  const visualOutput = AgentEvidenceToolOutputV2Schema.parse(input.visualOutput);
  if (
    textOutput.bundle.status !== "SUCCESS"
    || visualOutput.bundle.status !== "SUCCESS"
  ) {
    throw new Error("T8_VISUAL_EVIDENCE_BUNDLE_NOT_SUCCESS");
  }
  if (
    textOutput.bundle.corpusBundleHash !== visualOutput.bundle.corpusBundleHash
    || textOutput.bundle.activeIndexBundleHash
      !== visualOutput.bundle.activeIndexBundleHash
  ) {
    throw new Error("T8_VISUAL_EVIDENCE_IDENTITY_DRIFT");
  }
  const nodes = textOutput.evidence.nodes
    .filter((node) => Boolean(node.excerpt?.trim()))
    .slice(0, MAX_EVIDENCE_NODES)
    .map((node) => ({
      sourceId: node.sourceId,
      nodeId: node.nodeId,
      evidenceKind: node.evidenceKind,
      excerpt: node.excerpt!.slice(0, MAX_EXCERPT_CHARACTERS),
      assetId: node.assetId,
    }));
  if (nodes.length === 0) {
    throw new Error("T8_VISUAL_TEXT_EVIDENCE_EMPTY");
  }
  const selectedAssetIds = [
    ...new Set(
      visualOutput.evidence.nodes.flatMap(({ assetId }) =>
        assetId ? [assetId] : [],
      ),
    ),
  ].slice(0, MAX_PREVIEW_IMAGES);
  if (selectedAssetIds.length === 0) {
    throw new Error("T8_VISUAL_PREVIEW_ASSET_EMPTY");
  }
  const selectedSourceIds = new Set(nodes.map(({ sourceId }) => sourceId));
  const payload = {
    question: T8_VISUAL_AGENT_QUESTION_V2,
    coursePack: COURSE_PACK,
    evidence: {
      nodes: nodes.map(({ assetId: _assetId, ...node }) => node),
      sources: textOutput.evidence.sources
        .filter(({ sourceId }) => selectedSourceIds.has(sourceId))
        .map(({ sourceId, title, authority }) => ({
          sourceId,
          title,
          authority,
        })),
    },
  } satisfies T8VisualOutboundPayload;
  if (payload.evidence.sources.length !== selectedSourceIds.size) {
    throw new Error("T8_VISUAL_SOURCE_CLOSURE_BROKEN");
  }
  const serialized = JSON.stringify(payload);
  if (
    Buffer.byteLength(serialized, "utf8") > MAX_PROMPT_BYTES
    || /data\/courses|LOCAL_DOCUMENT|[A-Za-z]:[\\/]|file:/i.test(serialized)
  ) {
    throw new Error("T8_VISUAL_OUTBOUND_PAYLOAD_UNSAFE");
  }
  return {
    payload,
    selectedAssetIds,
    payloadHash: sha256(serialized),
    payloadBytes: Buffer.byteLength(serialized, "utf8"),
  };
}

function sha256(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

export function parseT8VisualOutputName(
  rawArguments: readonly string[],
) {
  if (rawArguments.length === 0) {
    return "t8-3-visual-agent-answer-v1.json";
  }
  if (
    rawArguments.length === 2
    && rawArguments[0] === "--output-name"
    && /^[a-z0-9][a-z0-9-]{0,80}\.json$/.test(rawArguments[1] ?? "")
  ) {
    return rawArguments[1]!;
  }
  throw new Error("T8_VISUAL_OUTPUT_ARGUMENT_INVALID");
}

function visualAuditPrompt(payload: T8VisualOutboundPayload) {
  return [
    "请仅依据下列课程文字证据与随附课程参考图，回答学生的问题。",
    "课程参考图不是学生作品；只描述图中可见内容，不虚构来源或画面。",
    "给出先判断什么、怎么判断、下一步做什么的简洁中文建议。",
    JSON.stringify(payload),
  ].join("\n\n");
}

function safeErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_-]{1,80}$/.test(code)) {
      return code;
    }
  }
  if (error instanceof Error && /^T8_[A-Z0-9_]{1,80}$/.test(error.message)) {
    return error.message;
  }
  if (error instanceof Error && error.name === "ZodError") {
    return "T8_VISUAL_CONFIGURATION_INVALID";
  }
  return "T8_VISUAL_AUDIT_FAILED";
}

async function retrieveTextEvidenceInTemporaryGeneration(
  workspaceRoot: string,
): Promise<AgentEvidenceToolOutputV2> {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "lumi-t8-visual-text-evidence-"),
  );
  let connection: ReturnType<typeof createDb> | undefined;
  let textRuntime: Awaited<ReturnType<typeof createLocalMixedRuntimeV2>>
    | undefined;
  try {
    const databasePath = path.join(temporaryRoot, "isolated.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    const prepared = await prepareKnowledgeV2Ingestion(workspaceRoot);
    const options = fixedAgentEvidenceRuntimeOptionsV2(workspaceRoot);
    const [indexBundle, configsByVersionId] = await Promise.all([
      readFile(
        path.join(options.controlDir, "knowledge-index-bundle.v2.json"),
        "utf8",
      ).then((value) => JSON.parse(value) as unknown),
      readFile(
        path.join(options.controlDir, "configs-by-version.v2.json"),
        "utf8",
      ).then((value) => JSON.parse(value) as unknown),
    ]);
    ingestPreparedKnowledgeV2(connection, prepared, { now: 1 });
    await storeKnowledgeIndexBundleV2(
      connection,
      prepared.bundle,
      indexBundle,
      {
        configsByVersionId: configsByVersionId as Record<
          string,
          Record<string, unknown>
        >,
        activate: true,
        now: 2,
        workspaceRoot,
      },
    );
    const generation = await createActiveKnowledgeGenerationLoaderV2({
      connection,
      workspaceRoot,
    }).load();
    textRuntime = await createLocalMixedRuntimeV2({
      ...options,
      activeGeneration: generation,
      visualRetrievalEnabled: false,
    });
    const textBundle = await textRuntime.retrieve(
      createRetrievalQueryV2({
        mode: "TEXT_TO_TEXT",
        text: T8_VISUAL_AGENT_QUESTION_V2,
        scope: {
          corpusBundleHash:
            textRuntime.t41CandidateIdentity.corpusBundleHash,
          sourceCoursePack: COURSE_PACK,
        },
      }),
    );
    return projectEvidenceBundleForAgentV2(textBundle);
  } finally {
    await textRuntime?.dispose();
    connection?.sqlite.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function main() {
  auditStage = "ARGUMENTS";
  const workspaceRoot = path.resolve(process.cwd());
  const rawArguments = process.argv.slice(2);
  const dryRun = rawArguments.at(-1) === "--dry-run";
  const outputName = parseT8VisualOutputName(
    dryRun ? rawArguments.slice(0, -1) : rawArguments,
  );
  const outputPath = path.join(
    workspaceRoot,
    OUTPUT_ROOT,
    outputName,
  );
  auditStage = "ENVIRONMENT";
  const loadedEnvironment = await loadRuntimeEnvironment({
    mode: "SERVICE_REQUIRED",
    nodeEnv: "test",
  });
  const config = readEnv(loadedEnvironment.environment);
  auditStage = "MODEL_CONFIGURATION";
  if (
    !config.ai.enabled
    || !config.ai.baseUrl
    || !config.ai.apiKey
    || !config.ai.model
  ) {
    throw new Error("T8_VISUAL_MODEL_CONFIG_MISSING");
  }
  if (!isGpt56ModelId(config.ai.model)) {
    throw new Error("T8_VISUAL_REQUIRES_GPT_5_6");
  }
  if (!config.ai.vision) {
    throw new Error("T8_VISUAL_REQUIRES_VISION_ENABLED");
  }

  auditStage = "VISUAL_RUNTIME";
  const basePort = await getFixedAgentEvidenceSearchPortV2ForAudit(
    workspaceRoot,
  );
  try {
    auditStage = "VISUAL_RETRIEVAL";
    const visualOutput = await basePort.search({
      query: T8_VISUAL_AGENT_QUESTION_V2,
      coursePackId: COURSE_PACK.id,
      coursePackVersion: COURSE_PACK.version,
      signal: new AbortController().signal,
    });
    auditStage = "TEXT_RUNTIME";
    const textOutput = await retrieveTextEvidenceInTemporaryGeneration(
      workspaceRoot,
    );
    auditStage = "OUTBOUND_BOUNDS";
    const bounded = buildT8VisualOutboundPayload({
      textOutput,
      visualOutput,
    });
    if (!basePort.openAsset) {
      throw new Error("T8_VISUAL_ASSET_PORT_UNAVAILABLE");
    }
    auditStage = "ASSET_READ";
    const images = await Promise.all(
      bounded.selectedAssetIds.map((assetId) =>
        basePort.openAsset!(assetId).then((file) => ({
          mimeType: file.contentType,
          bytes: new Uint8Array(file.bytes),
        })),
      ),
    );
    const totalImageBytes = images.reduce(
      (total, image) => total + image.bytes.byteLength,
      0,
    );
    if (
      images.length === 0
      || images.length > MAX_PREVIEW_IMAGES
      || totalImageBytes > 15 * 1024 * 1024
    ) {
      throw new Error("T8_VISUAL_IMAGE_BOUNDS_INVALID");
    }
    if (dryRun) {
      process.stdout.write(`${JSON.stringify({
        decision: "T8_VISUAL_AGENT_ANSWER_DRY_RUN_GO",
        externalModelCalls: 0,
        externalWebCalls: 0,
        evidenceNodeCount: bounded.payload.evidence.nodes.length,
        imageCount: images.length,
        imageBytes: totalImageBytes,
        textChannels: textOutput.channels.map(({ channel, status, hitCount }) => ({
          channel,
          status,
          hitCount,
        })),
        visualChannels: visualOutput.channels.map(({ channel, status, hitCount }) => ({
          channel,
          status,
          hitCount,
        })),
      })}\n`);
      return;
    }
    auditStage = "MODEL_REQUEST";
    const adapter = guardModelProviderSecretOutputs(
      createOpenAICompatibleModelProvider({
        baseUrl: config.ai.baseUrl,
        apiKey: config.ai.apiKey,
        model: config.ai.model,
        maxOutputTokens: config.ai.maxOutputTokens,
        idleTimeoutMs: config.agentTimeouts.evaluation.modelIdleTimeoutMs,
        totalTimeoutMs: config.agentTimeouts.evaluation.modelTotalTimeoutMs,
        vision: true,
      }),
      config.ai.apiKey,
    );
    const usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }[] = [];
    const response = await adapter.respond!([
      {
        role: "user",
        content: visualAuditPrompt(bounded.payload),
      },
    ], {
      images,
      tools: [],
      toolChoice: "none",
      onUsage: (value) => usage.push(value),
    });
    if (!response.content?.trim() || response.toolCalls.length !== 0) {
      throw new Error("T8_VISUAL_MODEL_RESPONSE_INVALID");
    }
    if (/data\/courses|LOCAL_DOCUMENT|[A-Za-z]:[\\/]|file:/i.test(response.content)) {
      throw new Error("T8_VISUAL_MODEL_OUTPUT_LOCATOR_LEAK");
    }
    auditStage = "REPORT_WRITE";
    await mkdir(path.dirname(outputPath), { recursive: true });
    const report = {
      schemaVersion: 1,
      kind: "T8_VISUAL_AGENT_ANSWER_AUDIT",
      decision: "T8_VISUAL_AGENT_ANSWER_GO",
      isolation: {
        serviceDatabase: "NOT_USED",
        projectDatabase: "NOT_USED",
        externalWebCalls: 0,
      },
      model: {
        modelId: config.ai.model,
        endpointHash: sha256(config.ai.baseUrl),
        configurationSource: loadedEnvironment.provenance.model.source,
        vision: true,
      },
      outbound: {
        questionHash: sha256(T8_VISUAL_AGENT_QUESTION_V2),
        evidencePayloadHash: bounded.payloadHash,
        evidencePayloadBytes: bounded.payloadBytes,
        evidenceNodeCount: bounded.payload.evidence.nodes.length,
        imageCount: images.length,
        imageBytes: totalImageBytes,
        selectedAssetIds: bounded.selectedAssetIds,
        excluded: [
          "secrets",
          "databases",
          "local-paths",
          "real-student-data",
          "unselected-course-images",
          "tool-schema",
          "web-search",
        ],
      },
      evidence: {
        corpusBundleHash: visualOutput.bundle.corpusBundleHash,
        activeIndexBundleHash: visualOutput.bundle.activeIndexBundleHash,
        text: {
          bundleStatus: textOutput.bundle.status,
          channels: textOutput.channels.map(({ channel, status, hitCount }) => ({
            channel,
            status,
            hitCount,
          })),
        },
        visual: {
          bundleStatus: visualOutput.bundle.status,
          channels: visualOutput.channels.map(({ channel, status, hitCount }) => ({
          channel,
          status,
          hitCount,
          })),
        },
        sourceIds: bounded.payload.evidence.sources.map(({ sourceId }) => sourceId),
      },
      answer: response.content,
      answerHash: sha256(response.content),
      usage,
    };
    await writeFile(
      outputPath,
      `${JSON.stringify(report, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    process.stdout.write(`${JSON.stringify({
      decision: report.decision,
      output: path.relative(workspaceRoot, outputPath),
      modelId: report.model.modelId,
      endpointHash: report.model.endpointHash,
      evidenceNodeCount: report.outbound.evidenceNodeCount,
      imageCount: report.outbound.imageCount,
      imageBytes: report.outbound.imageBytes,
      answerHash: report.answerHash,
      answerCharacters: report.answer.length,
      textChannels: report.evidence.text.channels,
      visualChannels: report.evidence.visual.channels,
    })}\n`);
  } finally {
    await disposeAgentEvidenceRuntimeV2(workspaceRoot);
  }
}

const entryPoint = process.argv[1];
if (
  entryPoint
  && import.meta.url === pathToFileURL(path.resolve(entryPoint)).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeErrorCode(error)}:STAGE_${auditStage}\n`);
    process.exitCode = 1;
  });
}
