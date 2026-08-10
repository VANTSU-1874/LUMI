import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { buildAgentHarnessReport } from "./harness";
import { runAgentHarness } from "./harness-runner";
import {
  createContextMemoryEvidenceChain,
  MEMORY_HARNESS_ADAPTER_VERSION,
  type ContextMemoryEvidenceScope,
} from "./runtime/harness/context-memory-evidence-chain";
import { readReleaseSourceBinding, sameReleaseSourceBinding } from "./release-source-binding";
import { CURRENT_AGENT_RUNTIME } from "./runtime/current-agent-runtime";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { saveBookLayoutDraft } from "@/lib/services/book-layout";

const require = createRequire(import.meta.url);
const http = require("node:http") as typeof import("node:http");
const https = require("node:https") as typeof import("node:https");
const net = require("node:net") as typeof import("node:net");
const tls = require("node:tls") as typeof import("node:tls");

export const HermeticHarnessModeSchema = z.enum(["OFF", "SHADOW", "ON"]);
export type HermeticHarnessMode = z.infer<typeof HermeticHarnessModeSchema>;

const inferenceEnvironmentKeys = [
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "LLM_EMBEDDING_BASE_URL",
  "LLM_EMBEDDING_API_KEY",
  "LLM_EMBEDDING_MODEL",
] as const;

export const HermeticUnifiedHarnessReportSchema = z.object({
  schemaVersion: z.literal(1),
  evaluatedAt: z.string().datetime(),
  mode: HermeticHarnessModeSchema,
  fixture: z.object({
    configuration: z.literal("FIXED_HERMETIC_V1"),
    modelProvider: z.literal("FAKE_HARNESS_ADAPTERS_ONLY"),
    serviceEnvironment: z.literal("DISABLED"),
    inferenceEnvironmentKeysPresent: z.array(z.string()).length(0),
    networkAttempts: z.array(z.string()).length(0),
  }).strict(),
  contextMemoryEvidence: z.object({
    contextStatus: z.enum(["SKIPPED", "SUCCEEDED", "REJECTED"]),
    memoryStatus: z.enum(["SKIPPED", "SUCCEEDED", "EMPTY"]),
    steps: z.array(z.enum(["CONTEXT_BOUNDARY", "MEMORY_READ", "COURSE_EVIDENCE"])).max(3),
    contextBoundaryCalls: z.number().int().min(0).max(1),
    memoryAdapterCalls: z.number().int().min(0).max(1),
  }).strict(),
  agentHarness: z.object({
    passed: z.boolean(),
    caseCount: z.number().int().positive(),
    passedCaseCount: z.number().int().min(0),
  }).passthrough(),
}).strict();

type HermeticHarnessOptions = {
  mode: HermeticHarnessMode;
  outputRoot?: string;
  requireCleanSource?: boolean;
};

function patchFunction(target: object, key: string, value: (...args: never[]) => never) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor) throw new Error(`HERMETIC_NETWORK_PATCH_MISSING:${key}`);
  Object.defineProperty(target, key, { ...descriptor, value });
  return () => Object.defineProperty(target, key, descriptor);
}

function installNetworkDenyGuard() {
  const attempts: string[] = [];
  const blocked = (surface: string) => () => {
    attempts.push(surface);
    throw new Error(`HERMETIC_NETWORK_FORBIDDEN:${surface}`);
  };
  const restores = [
    patchFunction(globalThis, "fetch", blocked("fetch")),
    patchFunction(http, "request", blocked("http.request")),
    patchFunction(https, "request", blocked("https.request")),
    patchFunction(net, "connect", blocked("net.connect")),
    patchFunction(tls, "connect", blocked("tls.connect")),
  ];
  return {
    attempts,
    restore() {
      for (const restore of restores.reverse()) restore();
    },
  };
}

function installHermeticEnvironment(root: string, mode: HermeticHarnessMode) {
  const previous = { ...process.env };
  const controlledKeys = [
    ...inferenceEnvironmentKeys,
    "CHUYING_SERVICE_ENV",
    "DATABASE_PATH",
    "EVIDENCE_ROOT",
    "LOCALAPPDATA",
    "NODE_ENV",
    "SESSION_SECRET",
    "AUTH_PROXY_SECRET",
    "IDENTITY_CODE_PEPPER",
    "TEACHER_ACCESS_CODE",
    "AGENT_V2_ENABLED",
    "AGENT_V3_ENABLED",
    "AGENT_UNIFIED_HARNESS_MODE",
  ];
  for (const key of controlledKeys) delete process.env[key];
  Object.assign(process.env, {
    NODE_ENV: "test",
    LOCALAPPDATA: path.join(root, "local-app-data"),
    SESSION_SECRET: "hermetic-harness-session-secret-at-least-32-characters",
    AUTH_PROXY_SECRET: "hermetic-harness-auth-proxy-secret-at-least-32-chars",
    IDENTITY_CODE_PEPPER: "hermetic-harness-identity-pepper-at-least-32-chars",
    TEACHER_ACCESS_CODE: "hermetic-harness-teacher-only",
    DATABASE_PATH: path.join(root, "harness.sqlite"),
    EVIDENCE_ROOT: path.join(root, "evidence"),
    AGENT_V2_ENABLED: "true",
    AGENT_V3_ENABLED: "true",
    AGENT_UNIFIED_HARNESS_MODE: mode,
  });
  const present = inferenceEnvironmentKeys.filter((key) => process.env[key]?.trim());
  if (present.length > 0) throw new Error("HERMETIC_INFERENCE_CONFIGURATION_PRESENT");
  return {
    restore() {
      for (const key of controlledKeys) delete process.env[key];
      for (const key of controlledKeys) {
        const value = previous[key];
        if (value !== undefined) process.env[key] = value;
      }
    },
  };
}

async function seedHarnessFixture(databasePath: string) {
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('harness-class','Agent Harness','HARNESS');
    INSERT INTO users(id,class_id,role,alias,created_at) VALUES
      ('harness-student','harness-class','STUDENT','Harness Student',1700000000),
      ('harness-other-student','harness-class','STUDENT','Harness Other Student',1700000000);
  `);
  await ingestCoursePackKnowledge(connection);
  saveBookLayoutDraft(connection, { userId: "harness-student", role: "STUDENT" }, {
    audience: "COMMUNITY_RESIDENTS",
    pageOrder: ["cover", "activity-map", "quick-start", "featured-activity", "calendar", "community-voices", "join-us", "contact"],
    diagnosticAnswers: ["AUDIENCE_FIRST", "TASK_FIRST", "AUDIENCE_FIRST"],
    transferChoices: ["COMMUNITY_ENTRY_FIRST", "VOLUNTEER_CALL_TO_ACTION", "RETAIN_ACTIVITY_CORE"],
  });
  return connection;
}

async function runContextMemoryFixture(mode: HermeticHarnessMode) {
  const scope: ContextMemoryEvidenceScope = {
    studentId: "harness-student",
    classId: "harness-class",
    taskId: "harness-task",
    projectId: null,
    coursePackId: "general-design",
    coursePackVersion: "1",
  };
  const originalQuestion = "我想先聊聊这个设计想法";
  const resolutionHash = "e".repeat(64);
  const steps: Array<"CONTEXT_BOUNDARY" | "MEMORY_READ" | "COURSE_EVIDENCE"> = [];
  let contextBoundaryCalls = 0;
  let memoryAdapterCalls = 0;
  const chain = createContextMemoryEvidenceChain({
    mode,
    ports: {
      projectContext: {
        version: "project-context-intent-adapter/v1",
        async resolve(input) {
          contextBoundaryCalls += 1;
          return {
            contractVersion: "project-context-intent-adapter/v1",
            contextResolutionInput: {
              ...input.expectedScope,
              currentTurn: { text: input.originalQuestion },
              sourceTurnIds: [],
            },
            resolvedUserIntent: {
              originalQuestion: input.originalQuestion,
              standaloneQuestion: input.originalQuestion,
              ambiguityStatus: "SELF_CONTAINED",
              clarificationCandidate: null,
              initialRetrieval: { mustRun: true, baselineQuestion: input.originalQuestion, supplementalQuestion: null },
              coursePackCandidates: [],
              knowledgeQuery: null,
              memoryQuery: null,
              contextManifest: { resolutionHash },
              sourceTurnIds: [],
              resolutionHash,
            },
            contextManifest: { resolutionHash },
            executionTrace: {
              resolutionHash,
              projectContextRemoteCallCount: 0,
              plannerCallCount: 0,
              plannerModel: null,
              answerCallCount: 0,
              answerModel: null,
              degraded: false,
              degradationReason: null,
            },
          };
        },
      },
      memoryIntentResolution: {
        version: "memory-intent-resolution/v1",
        async resolve({ contextIntent, scope: memoryScope }) {
          return {
            hash: contextIntent.resolutionReceipt.resolutionHash,
            ...memoryScope,
            trigger: "TASK_RESUMED",
            appliesTo: ["CURRENT_TASK"],
          };
        },
      },
      memoryAdapter: {
        version: MEMORY_HARNESS_ADAPTER_VERSION,
        async afterResolvedIntent(raw) {
          memoryAdapterCalls += 1;
          return {
            resolutionHash: (raw as { hash: string }).hash,
            snapshotCardCount: 1,
            checkpointOutcome: "NOT_REQUESTED",
            latencyMs: 1,
          };
        },
      },
      onStep(step) {
        steps.push(step);
      },
    },
  });
  const preparation = await chain.prepare({ scope, originalQuestion });
  chain.markCourseEvidenceStart();
  return { ...preparation, steps, contextBoundaryCalls, memoryAdapterCalls };
}

export async function runHermeticUnifiedHarness(options: HermeticHarnessOptions) {
  const mode = HermeticHarnessModeSchema.parse(options.mode);
  const root = options.outputRoot
    ? path.resolve(options.outputRoot)
    : await mkdtemp(path.join(tmpdir(), "lumi-hermetic-harness-"));
  await mkdir(root, { recursive: true });
  const databasePath = path.join(root, "harness.sqlite");
  const reportPath = path.join(root, `unified-${mode.toLowerCase()}.json`);
  const environment = installHermeticEnvironment(root, mode);
  const network = installNetworkDenyGuard();
  let connection: ReturnType<typeof createDb> | undefined;
  try {
    const startSource = readReleaseSourceBinding();
    if (options.requireCleanSource !== false && !startSource.sourceTrackedTreeClean) {
      throw new Error("HERMETIC_HARNESS_SOURCE_DIRTY");
    }
    connection = await seedHarnessFixture(databasePath);
    const results = await runAgentHarness(connection);
    const endSource = readReleaseSourceBinding();
    if (!sameReleaseSourceBinding(startSource, endSource)) {
      throw new Error("HERMETIC_HARNESS_SOURCE_CHANGED_DURING_RUN");
    }
    if (network.attempts.length > 0) {
      throw new Error(`HERMETIC_NETWORK_ATTEMPTED:${network.attempts.join(",")}`);
    }
    const contextMemoryEvidence = await runContextMemoryFixture(mode);
    const report = HermeticUnifiedHarnessReportSchema.parse({
      schemaVersion: 1,
      evaluatedAt: new Date().toISOString(),
      mode,
      fixture: {
        configuration: "FIXED_HERMETIC_V1",
        modelProvider: "FAKE_HARNESS_ADAPTERS_ONLY",
        serviceEnvironment: "DISABLED",
        inferenceEnvironmentKeysPresent: [],
        networkAttempts: [],
      },
      contextMemoryEvidence,
      agentHarness: buildAgentHarnessReport(results, startSource, {
        ...CURRENT_AGENT_RUNTIME,
        generation: "V3",
        entrypoint: "runTutorTurn",
        agentV3Enabled: true,
      }),
    });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (!report.agentHarness.passed) throw new Error("HERMETIC_HARNESS_CASE_FAILURE");
    return { root, reportPath, report };
  } finally {
    connection?.sqlite.close();
    network.restore();
    environment.restore();
    await Promise.all([databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
      .map((filePath) => rm(filePath, { force: true })));
  }
}
