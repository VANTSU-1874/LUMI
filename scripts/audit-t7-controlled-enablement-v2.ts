import {
  createHash,
} from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  AgentEvidenceToolOutputV2Schema,
} from "@/lib/agent/evidence-tool-v2";
import {
  retrieveTutorKnowledge,
} from "@/lib/agent/knowledge-retriever";
import {
  createDb,
  type DatabaseConnection,
} from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  createActiveKnowledgeGenerationLoaderV2,
} from "@/lib/knowledge/active-knowledge-generation-v2";
import {
  createAgentEvidenceRuntimeManagerV2,
} from "@/lib/knowledge/agent-evidence-runtime-v2";
import {
  prepareAgentEvidenceRuntimeV2,
  resolveKnowledgeV2Enablement,
} from "@/lib/knowledge/knowledge-v2-enablement";
import {
  deactivateKnowledgeV2Storage,
  ingestPreparedKnowledgeV2,
  prepareKnowledgeV2Ingestion,
  storeKnowledgeIndexBundleV2,
} from "@/lib/knowledge/knowledge-v2-store";
import {
  T45CapabilityRuntimeSuiteSchema,
  t45CapabilityRuntimeSuiteHash,
} from "@/tools/mixed-retrieval/t45-capability-loader";

import {
  createConsistentBackup,
} from "./create-backup";
import { restoreBackup } from "./restore-backup";
import { verifyBackup } from "./verify-backup";

const EXPECTED_INDEX_BUNDLE_HASH =
  "cad61822cf3e4d95e984b08c66fa6427c5adf182fc305329291f8eb9aad1be5d";
const OUTPUT_ROOT_SEGMENTS = [
  ".runtime",
  "t7-controlled-enablement",
] as const;

const ArmResultSchema = z
  .object({
    caseId: z.string().min(1).max(120),
    coursePackId: z.string().min(1).max(80),
    queryHash: z.string().regex(/^[a-f0-9]{64}$/),
    sameQuestion: z.literal(true),
    legacy: z
      .object({
        strategy: z.enum([
          "HYBRID",
          "LEXICAL_FALLBACK",
        ]),
        semanticStatus: z.enum([
          "USED",
          "UNAVAILABLE",
          "TIMEOUT",
          "ERROR",
        ]),
        itemIds: z.array(
          z.string().min(1).max(200),
        ).max(10),
      })
      .strict(),
    v2: z
      .object({
        bundleStatus: z.enum([
          "SUCCESS",
          "DEGRADED",
          "EMPTY",
          "UNSUPPORTED",
          "TIMEOUT",
          "ERROR",
        ]),
        nodeIds: z.array(
          z.string().min(1).max(200),
        ).max(16),
        sourceIds: z.array(
          z.string().min(1).max(200),
        ).max(16),
        channels: z
          .array(z.object({
            channel: z.enum([
              "LEXICAL",
              "TEXT_VECTOR",
              "VISUAL_VECTOR",
            ]),
            status: z.enum([
              "SUCCESS",
              "EMPTY",
              "UNAVAILABLE",
              "SKIPPED",
              "TIMEOUT",
              "ERROR",
            ]),
            hitCount: z.number()
              .int().nonnegative().max(10_000),
          }).strict())
          .max(3),
      })
      .strict(),
  })
  .strict();

const T7ControlledEnablementReportV2Schema =
  z.object({
    schemaVersion: z.literal(2),
    decision: z.literal(
      "T7_LOCAL_ISOLATED_GO",
    ),
    isolation: z.object({
      database:
        z.literal("TEMPORARY_ISOLATED_REMOVED"),
      serviceDatabase:
        z.literal("NOT_USED"),
      projectDatabase:
        z.literal("NOT_USED"),
      externalModelCalls: z.literal(0),
      externalWebCalls: z.literal(0),
    }).strict(),
    suite: z.object({
      id: z.string().min(1).max(160),
      version: z.string().min(1).max(80),
      split: z.string().min(1).max(80),
      suiteHash: z.string()
        .regex(/^[a-f0-9]{64}$/),
      caseCount: z.number().int().min(1)
        .max(1_000),
    }).strict(),
    generation: z.object({
      corpusBundleHash: z.string()
        .regex(/^[a-f0-9]{64}$/),
      activeIndexBundleHash: z.string()
        .regex(/^[a-f0-9]{64}$/),
      generationKeyHash: z.string()
        .regex(/^[a-f0-9]{64}$/),
      documentCount: z.number().int()
        .nonnegative(),
      nodeCount: z.number().int()
        .nonnegative(),
      assetCount: z.number().int()
        .nonnegative(),
      representationCount: z.number().int()
        .nonnegative(),
    }).strict(),
    enablementMatrix: z.array(z.object({
      raw: z.object({
        knowledgeObjectV2: z.boolean(),
        visualRetrieval: z.boolean(),
        evidenceBundleV2: z.boolean(),
      }).strict(),
      effective: z.object({
        knowledgeObjectV2: z.boolean(),
        visualRetrieval: z.boolean(),
        evidenceBundleV2: z.boolean(),
      }).strict(),
      loadAuthorized: z.boolean(),
    }).strict()).length(8),
    doubleRun: z.object({
      caseCount: z.number().int().min(1),
      legacyNonEmptyCount:
        z.number().int().nonnegative(),
      v2NonEmptyCount:
        z.number().int().nonnegative(),
      v2UnavailableCaseCount:
        z.number().int().nonnegative(),
      results: z.array(ArmResultSchema),
    }).strict(),
    textOnly: z.object({
      ready: z.literal(true),
      visualChannelStatus:
        z.literal("SKIPPED"),
      visualRuntimePresent:
        z.literal(false),
    }).strict(),
    recovery: z.object({
      masterOffLoadCount: z.literal(0),
      masterOffStatus:
        z.literal("KNOWLEDGE_OBJECT_DISABLED"),
      pointerRemovedStatus:
        z.literal("RUNTIME_UNAVAILABLE"),
      legacyStillAvailable: z.boolean(),
      pointerReactivated: z.literal(true),
      corruptionDetected: z.literal(true),
      corruptionCode: z.string()
        .regex(/^[A-Z0-9_]+$/),
      corruptionRecoverySearchSucceeded:
        z.literal(true),
    }).strict(),
    backup: z.object({
      verified: z.literal(true),
      fileCount: z.number().int().min(1),
      evidenceReferenceCount:
        z.number().int().nonnegative(),
      restoredGenerationMatches:
        z.literal(true),
      restoredSearchSucceeded:
        z.literal(true),
    }).strict(),
    resources: z.object({
      runtimeCacheEntries:
        z.number().int().min(1).max(4),
      allCircuitsClosed: z.literal(true),
      allPendingRequestsZero: z.literal(true),
      allSidecarsExitedAfterDispose:
        z.literal(true),
    }).strict(),
    licenses: z.array(z.object({
      component: z.string().min(1).max(120),
      revision: z.string().min(1).max(120),
      license: z.enum(["MIT", "Apache-2.0"]),
      localMetadataVerified: z.literal(true),
      releaseNoticeRequired: z.literal(true),
    }).strict()).length(2),
    knownBoundaries: z.array(
      z.string().min(1).max(240),
    ).min(4).max(12),
  }).strict();

export type T7ControlledEnablementReportV2 =
  z.infer<
    typeof T7ControlledEnablementReportV2Schema
  >;

export function parseT7ControlledEnablementArguments(
  argv: readonly string[],
) {
  if (
    argv.length !== 2
    || argv[0] !== "--output-name"
    || !argv[1]
    || !/^[a-z0-9][a-z0-9.-]{0,100}\.json$/
      .test(argv[1])
  ) {
    throw new Error(
      "usage: audit-t7-controlled-enablement-v2.ts "
      + "--output-name <safe-name.json>",
    );
  }
  return { outputName: argv[1] };
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function diagnosticCode(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : String(error);
  return /^[A-Z][A-Z0-9_]+/.exec(message)
    ?.[0] ?? "UNEXPECTED_ERROR";
}

function safeWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

async function readControlBundle(
  workspaceRoot: string,
) {
  const controlRoot = path.join(
    workspaceRoot,
    ".runtime",
    "knowledge-index",
    "control",
  );
  const controlDirectory = await realpath(
    path.join(
      controlRoot,
      EXPECTED_INDEX_BUNDLE_HASH,
    ),
  );
  if (
    !safeWithin(controlRoot, controlDirectory)
    || path.basename(controlDirectory)
      !== EXPECTED_INDEX_BUNDLE_HASH
  ) {
    throw new Error(
      "T7_CONTROL_DIRECTORY_INVALID",
    );
  }
  const [indexBundle, configsByVersionId] =
    await Promise.all([
      readFile(path.join(
        controlDirectory,
        "knowledge-index-bundle.v2.json",
      ), "utf8").then(
        (value) => JSON.parse(value) as unknown,
      ),
      readFile(path.join(
        controlDirectory,
        "configs-by-version.v2.json",
      ), "utf8").then(
        (value) => JSON.parse(value) as unknown,
      ),
    ]);
  if (
    !indexBundle
    || typeof indexBundle !== "object"
    || !("indexBundleHash" in indexBundle)
    || indexBundle.indexBundleHash
      !== EXPECTED_INDEX_BUNDLE_HASH
  ) {
    throw new Error(
      "T7_CONTROL_BUNDLE_HASH_DRIFT",
    );
  }
  if (
    !configsByVersionId
    || typeof configsByVersionId !== "object"
    || Array.isArray(configsByVersionId)
  ) {
    throw new Error(
      "T7_CONTROL_CONFIGS_INVALID",
    );
  }
  return {
    indexBundle,
    configsByVersionId:
      configsByVersionId as Record<
        string,
        Record<string, unknown>
      >,
  };
}

function enablementMatrix() {
  const rows = [];
  for (const knowledgeObjectV2
    of [false, true]) {
    for (const visualRetrieval
      of [false, true]) {
      for (const evidenceBundleV2
        of [false, true]) {
        const raw = {
          knowledgeObjectV2,
          visualRetrieval,
          evidenceBundleV2,
        };
        const resolved =
          resolveKnowledgeV2Enablement(raw);
        rows.push({
          raw,
          effective: resolved.effective,
          loadAuthorized:
            resolved.effective
              .knowledgeObjectV2
            && resolved.effective
              .evidenceBundleV2,
        });
      }
    }
  }
  return rows;
}

function generationCounts(
  connection: DatabaseConnection,
) {
  return connection.sqlite.prepare(`
    SELECT
      (SELECT count(*) FROM knowledge_documents_v2) documentCount,
      (SELECT count(*) FROM knowledge_nodes_v2) nodeCount,
      (SELECT count(*) FROM knowledge_assets_v2) assetCount,
      (SELECT count(*) FROM knowledge_index_entries_v2) representationCount
  `).get() as {
    documentCount: number;
    nodeCount: number;
    assetCount: number;
    representationCount: number;
  };
}

async function activateGeneration(input: {
  connection: DatabaseConnection;
  workspaceRoot: string;
  prepared: Awaited<
    ReturnType<typeof prepareKnowledgeV2Ingestion>
  >;
  control: Awaited<
    ReturnType<typeof readControlBundle>
  >;
  now: number;
}) {
  ingestPreparedKnowledgeV2(
    input.connection,
    input.prepared,
    { now: input.now },
  );
  await storeKnowledgeIndexBundleV2(
    input.connection,
    input.prepared.bundle,
    input.control.indexBundle,
    {
      configsByVersionId:
        input.control.configsByVersionId,
      activate: true,
      now: input.now + 1,
      workspaceRoot: input.workspaceRoot,
    },
  );
  return createActiveKnowledgeGenerationLoaderV2({
    connection: input.connection,
    workspaceRoot: input.workspaceRoot,
  }).load();
}

export function summarizeT7DoubleRunV2(
  resultsInput: readonly unknown[],
) {
  const results = resultsInput.map(
    (result) => ArmResultSchema.parse(result),
  );
  return {
    caseCount: results.length,
    legacyNonEmptyCount: results.filter(
      ({ legacy }) =>
        legacy.itemIds.length > 0,
    ).length,
    v2NonEmptyCount: results.filter(
      ({ v2 }) =>
        v2.nodeIds.length > 0,
    ).length,
    v2UnavailableCaseCount: results.filter(
      ({ v2 }) =>
        v2.bundleStatus === "UNSUPPORTED"
        || v2.bundleStatus === "TIMEOUT"
        || v2.bundleStatus === "ERROR"
        || v2.channels.some(
          ({ status }) =>
            status === "UNAVAILABLE"
            || status === "TIMEOUT"
            || status === "ERROR",
        ),
    ).length,
    results,
  };
}

export function assertT7DoubleRunCoverageGateV2(
  summary: ReturnType<
    typeof summarizeT7DoubleRunV2
  >,
) {
  if (
    summary.v2NonEmptyCount
      < summary.legacyNonEmptyCount
  ) {
    const regressions = summary.results
      .filter(
        ({ legacy, v2 }) =>
          legacy.itemIds.length > 0
          && v2.nodeIds.length === 0,
      )
      .map(({ caseId, coursePackId, v2 }) => ({
        caseId,
        coursePackId,
        bundleStatus: v2.bundleStatus,
        channels: v2.channels,
      }));
    throw new Error(
      `T7_V2_COVERAGE_REGRESSION:${JSON.stringify({
        legacyNonEmptyCount:
          summary.legacyNonEmptyCount,
        v2NonEmptyCount:
          summary.v2NonEmptyCount,
        regressions,
      })}`,
    );
  }
  return summary;
}

export function assertSafeT7ReportV2(
  reportInput: unknown,
  forbiddenFragments: readonly string[] = [],
) {
  const report =
    T7ControlledEnablementReportV2Schema
      .parse(reportInput);
  const serialized = JSON.stringify(report);
  const forbidden = [
    "service.env",
    ".sqlite",
    "data/courses",
    "\\",
    "http://",
    "https://",
    ...forbiddenFragments.filter(Boolean),
  ];
  if (
    forbidden.some((fragment) =>
      serialized.includes(fragment))
  ) {
    throw new Error(
      "T7_REPORT_FORBIDDEN_LOCATOR",
    );
  }
  return report;
}

async function runDoubleRetrieval(input: {
  connection: DatabaseConnection;
  port: Awaited<ReturnType<
    ReturnType<
      typeof createAgentEvidenceRuntimeManagerV2
    >["get"]
  >>;
  suite: z.infer<
    typeof T45CapabilityRuntimeSuiteSchema
  >;
}) {
  const results = [];
  for (const testCase of input.suite.cases) {
    const legacy =
      await retrieveTutorKnowledge(
        input.connection,
        testCase.coursePackId,
        testCase.coursePackVersion,
        testCase.question,
        null,
        {
          signal:
            AbortSignal.timeout(30_000),
        },
      );
    const output =
      AgentEvidenceToolOutputV2Schema.parse(
        await input.port.search({
          query: testCase.question,
          coursePackId:
            testCase.coursePackId,
          coursePackVersion:
            testCase.coursePackVersion,
          signal:
            AbortSignal.timeout(30_000),
        }),
      );
    results.push({
      caseId: testCase.caseId,
      coursePackId:
        testCase.coursePackId,
      queryHash: sha256(
        testCase.question,
      ),
      sameQuestion: true as const,
      legacy: {
        strategy: legacy.strategy,
        semanticStatus:
          legacy.semanticStatus,
        itemIds: legacy.items
          .slice(0, 10)
          .map(({ id }) => id),
      },
      v2: {
        bundleStatus:
          output.bundle.status,
        nodeIds: output.evidence.nodes
          .map(({ nodeId }) => nodeId),
        sourceIds:
          output.evidence.sources
            .map(({ sourceId }) =>
              sourceId),
        channels: output.channels.map(
          ({ channel, status, hitCount }) => ({
            channel,
            status,
            hitCount,
          }),
        ),
      },
    });
  }
  return summarizeT7DoubleRunV2(results);
}

async function searchSucceeded(input: {
  port: Awaited<ReturnType<
    ReturnType<
      typeof createAgentEvidenceRuntimeManagerV2
    >["get"]
  >>;
  query: string;
  coursePackId: string;
  coursePackVersion: string;
}) {
  const output =
    AgentEvidenceToolOutputV2Schema.parse(
      await input.port.search({
        query: input.query,
        coursePackId: input.coursePackId,
        coursePackVersion:
          input.coursePackVersion,
        signal:
          AbortSignal.timeout(30_000),
      }),
  );
  return ![
    "UNSUPPORTED",
    "TIMEOUT",
    "ERROR",
  ].includes(output.bundle.status);
}

async function writeReport(input: {
  workspaceRoot: string;
  outputName: string;
  report: T7ControlledEnablementReportV2;
}) {
  const outputRoot = path.join(
    input.workspaceRoot,
    ...OUTPUT_ROOT_SEGMENTS,
  );
  await mkdir(outputRoot, {
    recursive: true,
  });
  const canonicalRoot =
    await realpath(outputRoot);
  if (
    path.resolve(canonicalRoot)
      .toLowerCase()
    !== path.resolve(outputRoot)
      .toLowerCase()
  ) {
    throw new Error(
      "T7_OUTPUT_ROOT_SYMLINK",
    );
  }
  const outputPath = path.join(
    outputRoot,
    input.outputName,
  );
  if (
    await stat(outputPath)
      .then(() => true)
      .catch((error: unknown) => {
        if (
          (error as NodeJS.ErrnoException)
            .code === "ENOENT"
        ) return false;
        throw error;
      })
  ) {
    throw new Error(
      "T7_OUTPUT_ALREADY_EXISTS",
    );
  }
  const draft = path.join(
    outputRoot,
    `.${input.outputName}.${process.pid}.tmp`,
  );
  try {
    await writeFile(
      draft,
      `${JSON.stringify(
        input.report,
        null,
        2,
      )}\n`,
      {
        encoding: "utf8",
        flag: "wx",
      },
    );
    await rename(draft, outputPath);
  } finally {
    await rm(draft, { force: true });
  }
  return path.posix.join(
    ...OUTPUT_ROOT_SEGMENTS,
    input.outputName,
  );
}

export async function runT7ControlledEnablementAuditV2(
  input: {
    workspaceRoot?: string;
    outputName: string;
  },
) {
  const workspaceRoot = await realpath(
    path.resolve(
      input.workspaceRoot ?? process.cwd(),
    ),
  );
  const suiteBytes = await readFile(
    path.join(
      workspaceRoot,
      "tests",
      "retrieval-quality",
      "t45-capability-calibration.runtime.json",
    ),
    "utf8",
  );
  const suite =
    T45CapabilityRuntimeSuiteSchema.parse(
      JSON.parse(suiteBytes) as unknown,
    );
  const suiteHash =
    t45CapabilityRuntimeSuiteHash(suite);
  const control =
    await readControlBundle(workspaceRoot);
  const prepared =
    await prepareKnowledgeV2Ingestion(
      workspaceRoot,
    );
  if (
    suite.corpusSnapshot.bundleHash
      !== prepared.bundle.bundleHash
  ) {
    throw new Error(
      "T7_SUITE_CORPUS_HASH_DRIFT",
    );
  }

  const temporaryRoot = await mkdtemp(
    path.join(
      os.tmpdir(),
      "lumi-t7-controlled-enablement-",
    ),
  );
  const liveRoot = path.join(
    temporaryRoot,
    "live",
  );
  const evidenceRoot = path.join(
    liveRoot,
    "evidence",
  );
  const backupBase = path.join(
    temporaryRoot,
    "backups",
  );
  const restoreBase = path.join(
    temporaryRoot,
    "restores",
  );
  await Promise.all([
    mkdir(evidenceRoot, {
      recursive: true,
    }),
    mkdir(backupBase, {
      recursive: true,
    }),
    mkdir(restoreBase, {
      recursive: true,
    }),
  ]);
  const databasePath = path.join(
    liveRoot,
    "isolated.sqlite",
  );
  runMigrations(databasePath);
  let connection:
    DatabaseConnection | undefined =
      createDb(databasePath);
  const managers: Array<
    ReturnType<
      typeof createAgentEvidenceRuntimeManagerV2
    >
  > = [];
  let restoredConnection:
    DatabaseConnection | undefined;
  try {
    const generation =
      await activateGeneration({
        connection,
        workspaceRoot,
        prepared,
        control,
        now: 1,
      });
    const counts =
      generationCounts(connection);
    const firstCase = suite.cases[0];
    if (!firstCase) {
      throw new Error(
        "T7_SUITE_EMPTY",
      );
    }

    let masterOffLoadCount = 0;
    const masterOff =
      await prepareAgentEvidenceRuntimeV2(
        {
          knowledgeObjectV2Enabled: false,
          visualRetrievalEnabled: true,
          evidenceBundleV2Enabled: true,
        },
        async () => {
          masterOffLoadCount += 1;
          throw new Error(
            "T7_MASTER_OFF_LOADER_CALLED",
          );
        },
      );

    const manager =
      createAgentEvidenceRuntimeManagerV2();
    managers.push(manager);
    const fullPrepared =
      await prepareAgentEvidenceRuntimeV2(
        {
          knowledgeObjectV2Enabled: true,
          visualRetrievalEnabled: true,
          evidenceBundleV2Enabled: true,
        },
        () => manager.get({
          connection: connection!,
          workspaceRoot,
          visualRetrievalEnabled: true,
        }),
      );
    if (
      fullPrepared.status !== "READY"
      || !fullPrepared.port
    ) {
      throw new Error(
        "T7_FULL_RUNTIME_NOT_READY",
      );
    }
    const doubleRun =
      await runDoubleRetrieval({
        connection,
        port: fullPrepared.port,
        suite,
      });
    assertT7DoubleRunCoverageGateV2(
      doubleRun,
    );
    if (
      doubleRun.v2UnavailableCaseCount
        !== 0
    ) {
      throw new Error(
        "T7_V2_HEALTHY_RUN_UNAVAILABLE",
      );
    }

    const textOnlyPrepared =
      await prepareAgentEvidenceRuntimeV2(
        {
          knowledgeObjectV2Enabled: true,
          visualRetrievalEnabled: false,
          evidenceBundleV2Enabled: true,
        },
        () => manager.get({
          connection: connection!,
          workspaceRoot,
          visualRetrievalEnabled: false,
        }),
      );
    if (
      textOnlyPrepared.status !== "READY"
      || !textOnlyPrepared.port
    ) {
      throw new Error(
        "T7_TEXT_ONLY_RUNTIME_NOT_READY",
      );
    }
    const textOnlyOutput =
      AgentEvidenceToolOutputV2Schema.parse(
        await textOnlyPrepared.port.search({
          query: firstCase.question,
          coursePackId:
            firstCase.coursePackId,
          coursePackVersion:
            firstCase.coursePackVersion,
          signal:
            AbortSignal.timeout(30_000),
        }),
      );
    const textOnlyVisualChannel =
      textOnlyOutput.channels.find(
        ({ channel }) =>
          channel === "VISUAL_VECTOR",
      );
    if (
      textOnlyVisualChannel?.status
        !== "SKIPPED"
    ) {
      throw new Error(
        "T7_TEXT_ONLY_VISUAL_CHANNEL_NOT_SKIPPED",
      );
    }

    const beforeDispose =
      await manager.resourceReport(
        workspaceRoot,
      );
    const allCircuitsClosed =
      beforeDispose.runtimes.every(
        ({ channels }) =>
          channels.TEXT_VECTOR.state
            === "CLOSED"
          && (
            !channels.VISUAL_VECTOR
            || channels.VISUAL_VECTOR.state
              === "CLOSED"
          ),
      );
    const allPendingRequestsZero =
      beforeDispose.runtimes.every(
        ({ sidecars }) =>
          sidecars.text.pendingRequests === 0
          && (
            !sidecars.visual
            || sidecars.visual
              .pendingRequests === 0
          ),
      );
    const textOnlyRuntime =
      beforeDispose.runtimes.find(
        ({ channels, sidecars }) =>
          !channels.VISUAL_VECTOR
          && !sidecars.visual,
      );
    const visualRuntimePresent =
      !textOnlyRuntime;
    if (
      !allCircuitsClosed
      || !allPendingRequestsZero
      || visualRuntimePresent
    ) {
      throw new Error(
        "T7_RUNTIME_RESOURCE_GATE_FAILED",
      );
    }
    await manager.dispose(workspaceRoot);
    const afterDispose =
      await manager.resourceReport(
        workspaceRoot,
      );
    const allSidecarsExitedAfterDispose =
      afterDispose.runtimeCacheEntries === 0;

    deactivateKnowledgeV2Storage(
      connection,
    );
    const pointerManager =
      createAgentEvidenceRuntimeManagerV2();
    managers.push(pointerManager);
    const pointerRemoved =
      await prepareAgentEvidenceRuntimeV2(
        {
          knowledgeObjectV2Enabled: true,
          visualRetrievalEnabled: true,
          evidenceBundleV2Enabled: true,
        },
        () => pointerManager.get({
          connection: connection!,
          workspaceRoot,
          visualRetrievalEnabled: true,
        }),
      );
    const legacyAfterPointerRemoval =
      await retrieveTutorKnowledge(
        connection,
        firstCase.coursePackId,
        firstCase.coursePackVersion,
        firstCase.question,
        null,
      );
    const legacyStillAvailable =
      legacyAfterPointerRemoval.items
        .length > 0;
    await pointerManager.dispose(
      workspaceRoot,
    );

    await activateGeneration({
      connection,
      workspaceRoot,
      prepared,
      control,
      now: 10,
    });
    const reactivatedManager =
      createAgentEvidenceRuntimeManagerV2();
    managers.push(reactivatedManager);
    const reactivatedPort =
      await reactivatedManager.get({
        connection,
        workspaceRoot,
        visualRetrievalEnabled: true,
      });
    const pointerReactivated =
      await searchSucceeded({
        port: reactivatedPort,
        query: firstCase.question,
        coursePackId:
          firstCase.coursePackId,
        coursePackVersion:
          firstCase.coursePackVersion,
      });
    await reactivatedManager.dispose(
      workspaceRoot,
    );

    const payload = connection.sqlite
      .prepare(`
        SELECT id,
          payload_sha256 payloadSha256
        FROM knowledge_index_payloads_v2
        ORDER BY id
        LIMIT 1
      `)
      .get() as {
        id: string;
        payloadSha256: string;
      } | undefined;
    if (!payload) {
      throw new Error(
        "T7_PAYLOAD_ROW_MISSING",
      );
    }
    connection.sqlite.prepare(`
      UPDATE knowledge_index_payloads_v2
      SET payload_sha256=?
      WHERE id=?
    `).run("0".repeat(64), payload.id);
    const corruptManager =
      createAgentEvidenceRuntimeManagerV2();
    managers.push(corruptManager);
    const corruptPrepared =
      await prepareAgentEvidenceRuntimeV2(
        {
          knowledgeObjectV2Enabled: true,
          visualRetrievalEnabled: true,
          evidenceBundleV2Enabled: true,
        },
        () => corruptManager.get({
          connection: connection!,
          workspaceRoot,
          visualRetrievalEnabled: true,
        }),
      );
    const corruptionDetected =
      corruptPrepared.status
        === "RUNTIME_UNAVAILABLE";
    const corruptionCode =
      diagnosticCode(
        corruptPrepared.error,
      );
    await corruptManager.dispose(
      workspaceRoot,
    );
    connection.sqlite.prepare(`
      UPDATE knowledge_index_payloads_v2
      SET payload_sha256=?
      WHERE id=?
    `).run(
      payload.payloadSha256,
      payload.id,
    );
    const repairedManager =
      createAgentEvidenceRuntimeManagerV2();
    managers.push(repairedManager);
    const repairedPort =
      await repairedManager.get({
        connection,
        workspaceRoot,
        visualRetrievalEnabled: true,
      });
    const corruptionRecoverySearchSucceeded =
      await searchSucceeded({
        port: repairedPort,
        query: firstCase.question,
        coursePackId:
          firstCase.coursePackId,
        coursePackVersion:
          firstCase.coursePackVersion,
      });
    await repairedManager.dispose(
      workspaceRoot,
    );

    connection.sqlite.close();
    connection = undefined;
    const backup =
      await createConsistentBackup({
        databasePath,
        evidenceRoot,
        backupBase,
        now: new Date(
          "2026-07-31T00:00:00.000Z",
        ),
      });
    const verified = await verifyBackup({
      backupBase,
      backupPath: backup.backupPath,
    });
    const restored = await restoreBackup({
      backupBase,
      backupPath: backup.backupPath,
      restoreBase,
      liveDatabasePath: databasePath,
      liveEvidenceRoot: evidenceRoot,
    });
    restoredConnection =
      createDb(restored.databasePath);
    const restoredGeneration =
      await createActiveKnowledgeGenerationLoaderV2({
        connection: restoredConnection,
        workspaceRoot,
      }).load();
    const restoredManager =
      createAgentEvidenceRuntimeManagerV2();
    managers.push(restoredManager);
    const restoredPort =
      await restoredManager.get({
        connection: restoredConnection,
        workspaceRoot,
        visualRetrievalEnabled: true,
      });
    const restoredSearchSucceeded =
      await searchSucceeded({
        port: restoredPort,
        query: firstCase.question,
        coursePackId:
          firstCase.coursePackId,
        coursePackVersion:
          firstCase.coursePackVersion,
      });
    await restoredManager.dispose(
      workspaceRoot,
    );

    const report =
      assertSafeT7ReportV2({
        schemaVersion: 2,
        decision: "T7_LOCAL_ISOLATED_GO",
        isolation: {
          database:
            "TEMPORARY_ISOLATED_REMOVED",
          serviceDatabase: "NOT_USED",
          projectDatabase: "NOT_USED",
          externalModelCalls: 0,
          externalWebCalls: 0,
        },
        suite: {
          id: suite.id,
          version: suite.version,
          split: suite.split,
          suiteHash,
          caseCount: suite.cases.length,
        },
        generation: {
          corpusBundleHash:
            generation.corpus.bundleHash,
          activeIndexBundleHash:
            generation.activeIndexBundleHash,
          generationKeyHash:
            sha256(generation.generationKey),
          ...counts,
        },
        enablementMatrix:
          enablementMatrix(),
        doubleRun,
        textOnly: {
          ready: true,
          visualChannelStatus:
            textOnlyVisualChannel.status,
          visualRuntimePresent,
        },
        recovery: {
          masterOffLoadCount,
          masterOffStatus:
            masterOff.status,
          pointerRemovedStatus:
            pointerRemoved.status,
          legacyStillAvailable,
          pointerReactivated,
          corruptionDetected,
          corruptionCode,
          corruptionRecoverySearchSucceeded,
        },
        backup: {
          verified: true,
          fileCount: verified.fileCount,
          evidenceReferenceCount:
            verified.evidenceReferenceCount,
          restoredGenerationMatches:
            restoredGeneration.generationKey
              === generation.generationKey,
          restoredSearchSucceeded,
        },
        resources: {
          runtimeCacheEntries:
            beforeDispose.runtimeCacheEntries,
          allCircuitsClosed,
          allPendingRequestsZero,
          allSidecarsExitedAfterDispose,
        },
        licenses: [{
          component:
            "BAAI/bge-small-zh-v1.5",
          revision:
            "7999e1d3359715c523056ef9478215996d62a620",
          license: "MIT",
          localMetadataVerified: true,
          releaseNoticeRequired: true,
        }, {
          component:
            "google/siglip2-base-patch16-224",
          revision:
            "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2",
          license: "Apache-2.0",
          localMetadataVerified: true,
          releaseNoticeRequired: true,
        }],
        knownBoundaries: [
          "本结果仅证明本机临时库与本地模型上的隔离运行、回退和恢复，不代表已部署。",
          "双跑只比较同题链路是否可运行及证据覆盖，不重新解释为导师回答专业性提升。",
          "没有调用外部回答模型或网页检索，也没有使用真实学生数据。",
          "服务库、项目库、生产活动指针和三个默认关闭的运行开关均未修改。",
          "发布安装包前仍须随包提供适用的第三方许可证和 notice 文本。",
        ],
      }, [
        workspaceRoot,
        temporaryRoot,
      ]);
    const output = await writeReport({
      workspaceRoot,
      outputName: input.outputName,
      report,
    });
    process.stdout.write(
      `${JSON.stringify({
        decision: report.decision,
        output,
        caseCount:
          report.doubleRun.caseCount,
        legacyNonEmptyCount:
          report.doubleRun
            .legacyNonEmptyCount,
        v2NonEmptyCount:
          report.doubleRun
            .v2NonEmptyCount,
        v2UnavailableCaseCount:
          report.doubleRun
            .v2UnavailableCaseCount,
        backup: report.backup,
        resources: report.resources,
      }, null, 2)}\n`,
    );
    return report;
  } finally {
    await Promise.allSettled(
      managers.map((manager) =>
        manager.dispose(workspaceRoot)),
    );
    restoredConnection?.sqlite.close();
    connection?.sqlite.close();
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    });
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(
      path.resolve(process.argv[1]),
    ).href
  : "";

if (invokedPath === import.meta.url) {
  runT7ControlledEnablementAuditV2({
    ...parseT7ControlledEnablementArguments(
      process.argv.slice(2),
    ),
  }).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error
        ? error.stack ?? error.message
        : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
