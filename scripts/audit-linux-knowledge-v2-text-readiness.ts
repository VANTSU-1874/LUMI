import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  projectEvidenceBundleForAgentV2,
} from "@/lib/agent/evidence-tool-v2";
import {
  createDb,
  type DatabaseConnection,
} from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  createActiveKnowledgeGenerationLoaderV2,
} from "@/lib/knowledge/active-knowledge-generation-v2";
import {
  agentEvidenceRuntimeProfileV2,
  fixedAgentEvidenceRuntimeOptionsV2,
} from "@/lib/knowledge/agent-evidence-runtime-v2";
import {
  createLocalMixedRuntimeV2,
  type LocalMixedRuntimeV2,
} from "@/lib/knowledge/mixed-retrieval-runtime-v2";
import {
  ingestPreparedKnowledgeV2,
  prepareKnowledgeV2Ingestion,
  storeKnowledgeIndexBundleV2,
} from "@/lib/knowledge/knowledge-v2-store";
import { createRetrievalQueryV2 } from "@/lib/knowledge/retrieval-query-v2";
import {
  KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS,
} from "@/lib/operations/knowledge-v2-text-runtime-package";

const OUTPUT_ROOT = [
  ".runtime",
  "linux-knowledge-v2-readiness",
] as const;
const CONTROL_DIRECTORY = path.join(
  ".runtime",
  "knowledge-index",
  "control",
  KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.controlBundleHash,
);
type GenerationCounts = {
  documentCount: number;
  nodeCount: number;
  assetCount: number;
  representationCount: number;
  activeCorpusCount: number;
  activeIndexCount: number;
};
const EXPECTED_COUNTS: Readonly<GenerationCounts> = Object.freeze({
  documentCount: 116,
  nodeCount: 1702,
  assetCount: 156,
  representationCount: 1858,
  activeCorpusCount: 1,
  activeIndexCount: 1,
});
const COURSE_PACK = Object.freeze({
  id: "layout-design",
  version: "1",
});
const PROBE =
  "我的海报标题、副标题和正文看起来都一样重，第一步先改哪里？";

export function parseLinuxKnowledgeV2TextReadinessArguments(
  argv: readonly string[],
) {
  const args = argv[0] === "--"
    ? argv.slice(1)
    : [...argv];
  if (
    args.length !== 2
    || args[0] !== "--output-name"
    || !args[1]
    || !/^[a-z0-9][a-z0-9.-]{0,100}\.json$/
      .test(args[1])
  ) {
    throw new Error(
      "usage: audit-linux-knowledge-v2-text-readiness.ts --output-name <safe-name.json>",
    );
  }
  return { outputName: args[1] };
}

async function readJson(filePath: string) {
  return JSON.parse(
    await readFile(filePath, "utf8"),
  ) as unknown;
}

function counts(connection: DatabaseConnection) {
  return connection.sqlite.prepare(`
    SELECT
      (SELECT count(*) FROM knowledge_documents_v2) documentCount,
      (SELECT count(*) FROM knowledge_nodes_v2) nodeCount,
      (SELECT count(*) FROM knowledge_assets_v2) assetCount,
      (SELECT count(*) FROM knowledge_index_entries_v2) representationCount,
      (SELECT count(*) FROM knowledge_active_corpus_v2) activeCorpusCount,
      (SELECT count(*) FROM knowledge_active_index_bundle_v2) activeIndexCount
  `).get() as GenerationCounts;
}

function summarizeSearch(
  bundle: Awaited<
    ReturnType<LocalMixedRuntimeV2["retrieve"]>
  >,
  latencyMs: number,
) {
  const projected =
    projectEvidenceBundleForAgentV2(bundle);
  return {
    queryHash: projected.bundle.queryHash,
    status: projected.bundle.status,
    latencyMs: Math.round(latencyMs),
    nodeCount: projected.evidence.nodes.length,
    sourceCount: projected.evidence.sources.length,
    channels: projected.channels.map((channel) => ({
      channel: channel.channel,
      status: channel.status,
      hitCount: channel.hitCount,
    })),
  };
}

export function evaluateLinuxKnowledgeV2TextReadiness(input: {
  counts: GenerationCounts;
  runtimeEnvironment: LocalMixedRuntimeV2["runtimeEnvironment"];
  startupMs: number;
  firstSearch: ReturnType<typeof summarizeSearch>;
  warmSearch: ReturnType<typeof summarizeSearch>;
  beforeDispose: ReturnType<
    LocalMixedRuntimeV2["resourceReport"]
  >;
  afterDispose: ReturnType<
    LocalMixedRuntimeV2["resourceReport"]
  >;
}) {
  const textChannelsHealthy = [
    input.firstSearch,
    input.warmSearch,
  ].every((search) => (
    search.status === "SUCCESS"
    && search.nodeCount > 0
    && search.sourceCount > 0
    && search.channels.find(
      ({ channel }) => channel === "LEXICAL",
    )?.status === "SUCCESS"
    && search.channels.find(
      ({ channel }) => channel === "TEXT_VECTOR",
    )?.status === "SUCCESS"
    && search.channels.find(
      ({ channel }) => channel === "VISUAL_VECTOR",
    )?.status === "SKIPPED"
  ));
  const checks = {
    countsMatch:
      Object.entries(EXPECTED_COUNTS).every(
        ([key, value]) =>
          input.counts[
            key as keyof typeof EXPECTED_COUNTS
          ] === value,
      ),
    linuxCpuEnvironment:
      input.runtimeEnvironment.device.requested === "cpu"
      && input.runtimeEnvironment.device.actual === "cpu"
      && input.runtimeEnvironment.python.version
        .startsWith("3.12."),
    textChannelsHealthy,
    runtimeStarted:
      input.beforeDispose.startup.completed
      && input.beforeDispose.sidecars.text.processRunning
      && input.beforeDispose.sidecars.visual === null,
    pendingZeroBeforeDispose:
      input.beforeDispose.sidecars.text.pendingRequests === 0,
    disposed:
      input.afterDispose.disposed
      && !input.afterDispose.sidecars.text.processRunning
      && input.afterDispose.sidecars.text.pendingRequests === 0,
    circuitsClosed:
      input.beforeDispose.channels.TEXT_VECTOR.state
        === "CLOSED"
      && input.beforeDispose.channels.VISUAL_VECTOR
        === null,
  };
  return {
    checks,
    decision: Object.values(checks).every(Boolean)
      ? "LINUX_TEXT_RUNTIME_GO" as const
      : "LINUX_TEXT_RUNTIME_NO_GO" as const,
  };
}

export async function runLinuxKnowledgeV2TextReadiness(
  input: { outputName: string },
  options: { workspaceRoot?: string } = {},
) {
  const workspaceRoot = path.resolve(
    options.workspaceRoot ?? process.cwd(),
  );
  if (process.platform !== "linux") {
    throw new Error(
      `LINUX_TEXT_READINESS_PLATFORM_REQUIRED:${process.platform}`,
    );
  }
  const outputRoot = path.join(
    workspaceRoot,
    ...OUTPUT_ROOT,
  );
  const outputPath = path.join(
    outputRoot,
    input.outputName,
  );
  await mkdir(outputRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "lumi-linux-text-readiness-"),
  );
  let connection: DatabaseConnection | undefined;
  let runtime: LocalMixedRuntimeV2 | undefined;
  try {
    const databasePath = path.join(
      temporaryRoot,
      "isolated.sqlite",
    );
    runMigrations(databasePath);
    connection = createDb(databasePath);
    const prepared =
      await prepareKnowledgeV2Ingestion(
        workspaceRoot,
      );
    ingestPreparedKnowledgeV2(
      connection,
      prepared,
      { now: 1 },
    );
    const controlDirectory = path.join(
      workspaceRoot,
      CONTROL_DIRECTORY,
    );
    const [indexBundle, configsByVersionId] =
      await Promise.all([
        readJson(path.join(
          controlDirectory,
          "knowledge-index-bundle.v2.json",
        )),
        readJson(path.join(
          controlDirectory,
          "configs-by-version.v2.json",
        )),
      ]);
    await storeKnowledgeIndexBundleV2(
      connection,
      prepared.bundle,
      indexBundle,
      {
        configsByVersionId:
          configsByVersionId as Record<
            string,
            Record<string, unknown>
          >,
        activate: true,
        now: 2,
        workspaceRoot,
        activationRequiredProviderIndexHashes: [
          KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS.providerIndexHash,
        ],
      },
    );
    const profile =
      agentEvidenceRuntimeProfileV2("linux");
    const generation =
      await createActiveKnowledgeGenerationLoaderV2({
        connection,
        workspaceRoot,
        requiredProviderModels: [{
          modelId: profile.textModel.id,
          modelRevision:
            profile.textModel.revision,
        }],
      }).load();
    const generationCounts = counts(connection);
    const startupStarted = performance.now();
    runtime = await createLocalMixedRuntimeV2({
      ...fixedAgentEvidenceRuntimeOptionsV2(
        workspaceRoot,
        "linux",
      ),
      activeGeneration: generation,
      visualRetrievalEnabled: false,
    });
    const startupMs =
      performance.now() - startupStarted;
    const query = createRetrievalQueryV2({
      mode: "TEXT_TO_TEXT",
      text: PROBE,
      scope: {
        corpusBundleHash:
          generation.corpus.bundleHash,
        sourceCoursePack: COURSE_PACK,
      },
    });
    const firstStarted = performance.now();
    const firstBundle = await runtime.retrieve(query);
    const firstSearch = summarizeSearch(
      firstBundle,
      performance.now() - firstStarted,
    );
    const warmStarted = performance.now();
    const warmBundle = await runtime.retrieve(query);
    const warmSearch = summarizeSearch(
      warmBundle,
      performance.now() - warmStarted,
    );
    const beforeDispose = runtime.resourceReport();
    const runtimeEnvironment =
      runtime.runtimeEnvironment;
    await runtime.dispose();
    const afterDispose = runtime.resourceReport();
    const evaluation =
      evaluateLinuxKnowledgeV2TextReadiness({
        counts: generationCounts,
        runtimeEnvironment,
        startupMs,
        firstSearch,
        warmSearch,
        beforeDispose,
        afterDispose,
      });
    const report = {
      schemaVersion: 1,
      decision: evaluation.decision,
      isolation: {
        database:
          "TEMPORARY_ISOLATED_REMOVED",
        serviceDatabase: "NOT_USED",
        projectDatabase: "NOT_USED",
        productionHost: "NOT_CONNECTED",
        externalModelCalls: 0,
        externalWebCalls: 0,
      },
      target: {
        os: "linux",
        arch: process.arch,
        device: "cpu",
      },
      bindings: {
        ...KNOWLEDGE_V2_TEXT_RUNTIME_BINDINGS,
        generationKey:
          generation.generationKey,
      },
      counts: generationCounts,
      runtimeEnvironment,
      metrics: {
        startupMs: Math.round(startupMs),
        firstSearch,
        warmSearch,
        rss: "NOT_EXPOSED_BY_SIDECAR_PROTOCOL",
      },
      resources: {
        beforeDispose,
        afterDispose,
      },
      checks: evaluation.checks,
      knownBoundaries: [
        "Text-only; visual model and visual sidecar are not installed.",
        "WSL2 evidence is production-outside and does not authorize deployment.",
        "The runtime payload excludes service configuration, secrets, and databases.",
      ],
    };
    await writeFile(
      outputPath,
      `${JSON.stringify(report, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    process.stdout.write(
      `${JSON.stringify({
        decision: report.decision,
        counts: report.counts,
        runtimeEnvironment: {
          python:
            report.runtimeEnvironment.python.version,
          torch:
            report.runtimeEnvironment.libraries.torch,
          transformers:
            report.runtimeEnvironment.libraries.transformers,
          device:
            report.runtimeEnvironment.device.actual,
        },
        metrics: report.metrics,
        checks: report.checks,
        output:
          `${OUTPUT_ROOT.join("/")}/${input.outputName}`,
      })}\n`,
    );
    if (report.decision !== "LINUX_TEXT_RUNTIME_GO") {
      process.exitCode = 1;
    }
    return report;
  } finally {
    if (runtime && !runtime.resourceReport().disposed) {
      await runtime.dispose();
    }
    connection?.sqlite.close();
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  runLinuxKnowledgeV2TextReadiness(
    parseLinuxKnowledgeV2TextReadinessArguments(
      process.argv.slice(2),
    ),
  ).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error
        ? error.stack ?? error.message
        : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
