import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  guardModelProviderSecretOutputs,
} from "@/lib/agent/evaluation-safety";
import { isGpt56ModelId } from "@/lib/ai/model-id";
import {
  createOpenAICompatibleModelProvider,
} from "@/lib/agent/model-provider-adapter";
import {
  readEnv,
  resolvePlannerModelConfiguration,
} from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
} from "@/lib/config/runtime-environment";
import { getCoursePack } from "@/lib/course-packs/registry";
import {
  QueryUnderstandingInputV1Schema,
  type QueryUnderstandingInputV1,
} from "@/lib/knowledge/answer-obligation-v1";
import {
  QUERY_UNDERSTANDING_CONFIG_HASH_V1,
  QUERY_UNDERSTANDING_PLANNER_VERSION_V2,
  QUERY_UNDERSTANDING_PROMPT_HASH_V1,
  QUERY_UNDERSTANDING_REASONING_EFFORT_V1,
  QUERY_UNDERSTANDING_STRUCTURED_OUTPUT_SCHEMA_HASH_V1,
  QueryUnderstandingAttemptV1Schema,
  QueryUnderstandingFailureCategoryV1Schema,
  createQueryUnderstandingPlannerV1,
  type QueryUnderstandingPlannerResultV1,
} from "@/lib/knowledge/query-understanding-planner-v1";
import {
  auditT44AnswerObligationBindingsV1,
} from "@/tools/mixed-retrieval/t44-obligation-coverage-evaluator";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const RUN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const PLANNER_REPAIR_PROBE_RUN_ID_V1 =
  "repair-v1" as const;
export const PLANNER_REPAIR_PROBE_RUN_ID_V2 =
  "repair-v2" as const;
export const PLANNER_REPAIR_PROBE_RUN_ID_V3 =
  "repair-v3" as const;
export const PLANNER_REPAIR_PROBE_RUN_ID_V4 =
  "repair-v4" as const;
export const PLANNER_REPAIR_PROBE_RUN_ID_V5 =
  "repair-v5" as const;
const PlannerRepairProbeRunIdSchema = z.enum([
  PLANNER_REPAIR_PROBE_RUN_ID_V1,
  PLANNER_REPAIR_PROBE_RUN_ID_V2,
  PLANNER_REPAIR_PROBE_RUN_ID_V3,
  PLANNER_REPAIR_PROBE_RUN_ID_V4,
  PLANNER_REPAIR_PROBE_RUN_ID_V5,
]);
export const PLANNER_REPAIR_PROBE_TOTAL_TIMEOUT_MS_V1 =
  20_000;
export const PLANNER_REPAIR_PROBE_IDLE_TIMEOUT_MS_V1 =
  PLANNER_REPAIR_PROBE_TOTAL_TIMEOUT_MS_V1 - 1;
export const PLANNER_REPAIR_PROBE_PLANNER_VERSION_V1 =
  "1.1.0" as const;
export const PLANNER_REPAIR_PROBE_PLANNER_VERSION_V2 =
  "1.2.0" as const;
export const PLANNER_REPAIR_PROBE_PLANNER_VERSION_V3 =
  "1.3.0" as const;
export const PLANNER_REPAIR_PROBE_PLANNER_VERSION_V4 =
  QUERY_UNDERSTANDING_PLANNER_VERSION_V2;

function plannerProfileForRunId(
  runId: z.infer<typeof PlannerRepairProbeRunIdSchema>,
) {
  return {
    plannerVersion:
      runId === PLANNER_REPAIR_PROBE_RUN_ID_V5
        ? PLANNER_REPAIR_PROBE_PLANNER_VERSION_V4
        : runId === PLANNER_REPAIR_PROBE_RUN_ID_V4
          ? PLANNER_REPAIR_PROBE_PLANNER_VERSION_V3
          : runId === PLANNER_REPAIR_PROBE_RUN_ID_V3
            ? PLANNER_REPAIR_PROBE_PLANNER_VERSION_V2
            : PLANNER_REPAIR_PROBE_PLANNER_VERSION_V1,
    totalTimeoutMs:
      PLANNER_REPAIR_PROBE_TOTAL_TIMEOUT_MS_V1,
    idleTimeoutMs:
      PLANNER_REPAIR_PROBE_IDLE_TIMEOUT_MS_V1,
  };
}

const CoursePackIdSchema = z.enum([
  "general-design",
  "digital-interaction",
  "book-design",
  "layout-design",
  "brand-vi-design",
]);

const ProbeDefinitionSchema = z.object({
  caseId: z.string().regex(RUN_ID_PATTERN),
  coursePackId: CoursePackIdSchema,
  question: z.string().trim().min(1).max(500),
}).strict();

export const PLANNER_REPAIR_PROBE_CASES_V1 = Object.freeze(
  z.array(ProbeDefinitionSchema).length(5).parse([
    {
      caseId: "repair-general-hierarchy",
      coursePackId: "general-design",
      question: "我做的活动海报看着很乱，标题和正文都在抢，我应该先动哪一块？",
    },
    {
      caseId: "repair-digital-no-motion",
      coursePackId: "digital-interaction",
      question: "声音节点已经有数值了，可预览还是不动，我第一步先检查哪儿？",
    },
    {
      caseId: "repair-book-page-rhythm",
      coursePackId: "book-design",
      question: "这本小册子翻起来前后都一个节奏，我应该先从哪几页开始改？",
    },
    {
      caseId: "repair-layout-first-glance",
      coursePackId: "layout-design",
      question: "校园展海报上标题、时间和地点挤在一起，别人一眼看不出重点，我先改什么？",
    },
    {
      caseId: "repair-brand-system",
      coursePackId: "brand-vi-design",
      question: "我做了几版社团标志，单看都还行，可放到海报和头像里就不像一套，先统一什么？",
    },
  ]),
);

const UsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
}).strict();

const BindingAuditSchema = z.object({
  sourceAnchor: z.number().int().min(0),
  entity: z.number().int().min(0),
  constraint: z.number().int().min(0),
}).strict();

export const PlannerRepairProbeCaseResultV1Schema = z.object({
  caseId: z.string().regex(RUN_ID_PATTERN),
  coursePackId: CoursePackIdSchema,
  questionHash: z.string().regex(HASH_PATTERN),
  status: z.enum(["READY", "CLARIFY", "DEGRADED"]),
  firstAttempt: QueryUnderstandingAttemptV1Schema,
  repairAttempt: QueryUnderstandingAttemptV1Schema,
  callCount: z.number().int().min(0).max(2),
  failureCategory:
    QueryUnderstandingFailureCategoryV1Schema.nullable(),
  elapsedMs: z.number().int().min(0)
    .max(PLANNER_REPAIR_PROBE_TOTAL_TIMEOUT_MS_V1 + 100),
  usage: UsageSchema,
  bindingAudit: BindingAuditSchema,
}).strict();

const ModelProvenanceSchema = z.object({
  environmentMode: z.literal("SERVICE_REQUIRED"),
  source: z.literal("service-env"),
  modelId: z.string().trim().min(1).max(200),
  endpointHash: z.string().regex(HASH_PATTERN),
}).strict();

const GateResultsSchema = z.object({
  nonDegraded: z.boolean(),
  validAfterAtMostOneRepair: z.boolean(),
  bindingViolations: z.boolean(),
  plannerP95: z.boolean(),
}).strict();

export const PlannerRepairProbeReportV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("LUMI_PLANNER_RUNTIME_REPAIR_PROBE"),
  runId: PlannerRepairProbeRunIdSchema,
  decision: z.enum([
    "PLANNER_RUNTIME_REPAIR_GO",
    "PLANNER_RUNTIME_REPAIR_NO_GO",
  ]),
  model: ModelProvenanceSchema,
  plannerConfig: z.object({
    plannerVersion: z.enum([
      PLANNER_REPAIR_PROBE_PLANNER_VERSION_V1,
      PLANNER_REPAIR_PROBE_PLANNER_VERSION_V2,
      PLANNER_REPAIR_PROBE_PLANNER_VERSION_V3,
      PLANNER_REPAIR_PROBE_PLANNER_VERSION_V4,
    ]),
    reasoningEffort: z.literal(
      QUERY_UNDERSTANDING_REASONING_EFFORT_V1,
    ),
    totalTimeoutMs: z.literal(
      PLANNER_REPAIR_PROBE_TOTAL_TIMEOUT_MS_V1,
    ),
    idleTimeoutMs: z.literal(
      PLANNER_REPAIR_PROBE_IDLE_TIMEOUT_MS_V1,
    ),
    promptHash: z.string().regex(HASH_PATTERN),
    configHash: z.string().regex(HASH_PATTERN),
    structuredOutputSchemaHash:
      z.string().regex(HASH_PATTERN),
  }).strict(),
  sampleSize: z.literal(5),
  summary: z.object({
    nonDegraded: z.number().int().min(0).max(5),
    validAfterAtMostOneRepair:
      z.number().int().min(0).max(5),
    bindingViolations: BindingAuditSchema,
    plannerP95Ms: z.number().int().min(0),
    providerCallCount: z.number().int().min(0).max(10),
    usage: UsageSchema,
  }).strict(),
  gateResults: GateResultsSchema,
  passed: z.boolean(),
  cases: z.array(
    PlannerRepairProbeCaseResultV1Schema,
  ).length(5),
  operations: z.object({
    database: z.literal("NOT_USED"),
    qrels: z.literal("NOT_READ"),
    graphify: z.literal("NOT_USED"),
    web: z.literal("NOT_USED"),
    deployment: z.literal("NOT_PERFORMED"),
  }).strict(),
  generatedAt: z.string().datetime(),
  interpretationBoundary: z.literal(
    "This label-free probe verifies planner runtime structure, source binding, and latency only; it does not measure retrieval gain, answer professionalism, or classroom outcomes.",
  ),
}).strict().superRefine((report, context) => {
  const expectedProfile =
    plannerProfileForRunId(report.runId);
  if (
    report.plannerConfig.plannerVersion
      !== expectedProfile.plannerVersion
  ) {
    context.addIssue({
      code: "custom",
      path: ["plannerConfig", "plannerVersion"],
      message:
        "planner version must match the immutable run profile",
    });
  }
  if (
    report.passed
    !== Object.values(report.gateResults).every(Boolean)
    || report.decision
      !== (report.passed
        ? "PLANNER_RUNTIME_REPAIR_GO"
        : "PLANNER_RUNTIME_REPAIR_NO_GO")
  ) {
    context.addIssue({
      code: "custom",
      path: ["decision"],
      message: "decision must agree with frozen gates",
    });
  }
});

export type PlannerRepairProbeCaseResultV1 = z.infer<
  typeof PlannerRepairProbeCaseResultV1Schema
>;
export type PlannerRepairProbeReportV1 = z.infer<
  typeof PlannerRepairProbeReportV1Schema
>;

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function nearestRankPercentile(
  values: readonly number[],
  percentile: number,
) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) =>
    left - right);
  const index = Math.max(
    0,
    Math.ceil(percentile * sorted.length) - 1,
  );
  return sorted[index] ?? 0;
}

export function parsePlannerRepairProbeArgumentsV1(
  argv: readonly string[],
) {
  const values = argv[0] === "--"
    ? argv.slice(1)
    : argv;
  const runId = PlannerRepairProbeRunIdSchema.safeParse(
    values[1],
  );
  if (
    values.length !== 2
    || values[0] !== "--run-id"
    || !runId.success
  ) {
    throw new Error(
      "PLANNER_REPAIR_PROBE_RUN_ID_REQUIRED: --run-id repair-v1|repair-v2|repair-v3|repair-v4|repair-v5",
    );
  }
  return { runId: runId.data };
}

export function buildPlannerRepairProbeRequestV1(
  definition: z.infer<typeof ProbeDefinitionSchema>,
): QueryUnderstandingInputV1 {
  const parsed = ProbeDefinitionSchema.parse(definition);
  const coursePack = getCoursePack(
    parsed.coursePackId,
    "1",
  );
  return QueryUnderstandingInputV1Schema.parse({
    schemaVersion: 1,
    currentMessage: {
      source: "CURRENT_MESSAGE",
      message: parsed.question,
      messageHash: sha256(parsed.question),
    },
    recentTurns: [],
    coursePack: {
      id: coursePack.id,
      version: coursePack.version,
      label: coursePack.label,
      summary: coursePack.summary,
    },
    view: {
      id: "student-conversation",
      focus: "mentor",
    },
    hasArtwork: false,
    artworkHash: null,
  });
}

export function projectPlannerRepairProbeCaseV1(input: {
  definition: z.infer<typeof ProbeDefinitionSchema>;
  request: QueryUnderstandingInputV1;
  result: QueryUnderstandingPlannerResultV1;
}): PlannerRepairProbeCaseResultV1 {
  const definition = ProbeDefinitionSchema.parse(
    input.definition,
  );
  const bindingAudit =
    auditT44AnswerObligationBindingsV1({
      request: input.request,
      prediction: input.result.obligationSet,
    });
  return PlannerRepairProbeCaseResultV1Schema.parse({
    caseId: definition.caseId,
    coursePackId: definition.coursePackId,
    questionHash:
      input.request.currentMessage.messageHash,
    status: input.result.obligationSet.status,
    firstAttempt: input.result.audit.firstAttempt,
    repairAttempt: input.result.audit.repairAttempt,
    callCount: input.result.audit.callCount,
    failureCategory:
      input.result.audit.failureCategory,
    elapsedMs: input.result.publicTrace.elapsedMs,
    usage: input.result.publicTrace.usage,
    bindingAudit,
  });
}

export function evaluatePlannerRepairProbeV1(input: {
  runId: z.infer<typeof PlannerRepairProbeRunIdSchema>;
  model: z.infer<typeof ModelProvenanceSchema>;
  cases: readonly PlannerRepairProbeCaseResultV1[];
  generatedAt?: string;
}): PlannerRepairProbeReportV1 {
  const profile = plannerProfileForRunId(input.runId);
  const cases = z.array(
    PlannerRepairProbeCaseResultV1Schema,
  ).length(5).parse(input.cases);
  const nonDegraded = cases.filter(
    ({ status }) => status !== "DEGRADED",
  ).length;
  const validAfterAtMostOneRepair = cases.filter(
    ({ firstAttempt, repairAttempt }) =>
      firstAttempt === "VALID"
      || repairAttempt === "VALID",
  ).length;
  const bindingViolations = cases.reduce(
    (sum, result) => ({
      sourceAnchor:
        sum.sourceAnchor
        + result.bindingAudit.sourceAnchor,
      entity:
        sum.entity + result.bindingAudit.entity,
      constraint:
        sum.constraint
        + result.bindingAudit.constraint,
    }),
    { sourceAnchor: 0, entity: 0, constraint: 0 },
  );
  const plannerP95Ms = nearestRankPercentile(
    cases.map(({ elapsedMs }) => elapsedMs),
    0.95,
  );
  const usage = cases.reduce(
    (sum, result) => ({
      inputTokens:
        sum.inputTokens + result.usage.inputTokens,
      outputTokens:
        sum.outputTokens + result.usage.outputTokens,
      totalTokens:
        sum.totalTokens + result.usage.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );
  const gateResults = {
    nonDegraded: nonDegraded === 5,
    validAfterAtMostOneRepair:
      validAfterAtMostOneRepair === 5,
    bindingViolations:
      Object.values(bindingViolations)
        .every((value) => value === 0),
    plannerP95:
      plannerP95Ms
      <= profile.totalTimeoutMs,
  };
  const passed = Object.values(gateResults)
    .every(Boolean);
  return PlannerRepairProbeReportV1Schema.parse({
    schemaVersion: 1,
    kind: "LUMI_PLANNER_RUNTIME_REPAIR_PROBE",
    runId: input.runId,
    decision: passed
      ? "PLANNER_RUNTIME_REPAIR_GO"
      : "PLANNER_RUNTIME_REPAIR_NO_GO",
    model: input.model,
    plannerConfig: {
      plannerVersion:
        profile.plannerVersion,
      reasoningEffort:
        QUERY_UNDERSTANDING_REASONING_EFFORT_V1,
      totalTimeoutMs:
        profile.totalTimeoutMs,
      idleTimeoutMs:
        profile.idleTimeoutMs,
      promptHash:
        QUERY_UNDERSTANDING_PROMPT_HASH_V1,
      configHash:
        QUERY_UNDERSTANDING_CONFIG_HASH_V1,
      structuredOutputSchemaHash:
        QUERY_UNDERSTANDING_STRUCTURED_OUTPUT_SCHEMA_HASH_V1,
    },
    sampleSize: 5,
    summary: {
      nonDegraded,
      validAfterAtMostOneRepair,
      bindingViolations,
      plannerP95Ms,
      providerCallCount: cases.reduce(
        (sum, result) => sum + result.callCount,
        0,
      ),
      usage,
    },
    gateResults,
    passed,
    cases,
    operations: {
      database: "NOT_USED",
      qrels: "NOT_READ",
      graphify: "NOT_USED",
      web: "NOT_USED",
      deployment: "NOT_PERFORMED",
    },
    generatedAt:
      input.generatedAt ?? new Date().toISOString(),
    interpretationBoundary:
      "This label-free probe verifies planner runtime structure, source binding, and latency only; it does not measure retrieval gain, answer professionalism, or classroom outcomes.",
  });
}

const FORBIDDEN_ARTIFACT_KEYS = new Set([
  "apiKey",
  "baseUrl",
  "databasePath",
  "question",
  "rawModelOutput",
  "rawPlannerOutput",
  "sourceFile",
]);

function assertSafeArtifact(
  value: unknown,
  pathParts: readonly string[] = [],
) {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertSafeArtifact(child, [
        ...pathParts,
        String(index),
      ]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_ARTIFACT_KEYS.has(key)) {
      throw new Error(
        `PLANNER_REPAIR_PROBE_FORBIDDEN_ARTIFACT_KEY:${[
          ...pathParts,
          key,
        ].join(".")}`,
      );
    }
    assertSafeArtifact(child, [...pathParts, key]);
  }
}

export async function writeNewPlannerRepairProbeArtifactV1(
  target: string,
  report: PlannerRepairProbeReportV1,
) {
  const parsed =
    PlannerRepairProbeReportV1Schema.parse(report);
  assertSafeArtifact(parsed);
  const resolved = path.resolve(target);
  await mkdir(path.dirname(resolved), {
    recursive: true,
  });
  const content = `${JSON.stringify(parsed, null, 2)}\n`;
  await writeFile(resolved, content, {
    encoding: "utf8",
    flag: "wx",
  });
  const observed = await readFile(resolved, "utf8");
  if (observed !== content) {
    throw new Error(
      `PLANNER_REPAIR_PROBE_ARTIFACT_BYTE_DRIFT:${resolved}`,
    );
  }
  PlannerRepairProbeReportV1Schema.parse(
    JSON.parse(observed) as unknown,
  );
  return {
    path: resolved,
    bytes: Buffer.byteLength(observed, "utf8"),
    sha256: sha256(observed),
  };
}

export async function runPlannerRepairProbeCliV1(
  argv: readonly string[],
  workspaceRoot = process.cwd(),
) {
  const parsed =
    parsePlannerRepairProbeArgumentsV1(argv);
  const profile =
    plannerProfileForRunId(parsed.runId);
  const artifactPath = path.resolve(
    workspaceRoot,
    ".runtime/mixed-retrieval",
    `planner-repair-probe-${parsed.runId}.json`,
  );
  try {
    await readFile(artifactPath);
    throw new Error(
      `PLANNER_REPAIR_PROBE_ARTIFACT_ALREADY_EXISTS:${artifactPath}`,
    );
  } catch (error) {
    if (
      !(error instanceof Error)
      || !("code" in error)
      || error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  const loadedEnvironment =
    await loadRuntimeEnvironment({
      cwd: workspaceRoot,
      mode: "SERVICE_REQUIRED",
      nodeEnv: "test",
    });
  const config = readEnv(
    loadedEnvironment.environment,
  );
  const plannerConfig =
    resolvePlannerModelConfiguration(config.ai);
  if (!plannerConfig.enabled) {
    throw new Error(
      "PLANNER_REPAIR_PROBE_SERVICE_MODEL_REQUIRED",
    );
  }
  if (!isGpt56ModelId(plannerConfig.model)) {
    throw new Error(
      "PLANNER_REPAIR_PROBE_GPT_5_6_REQUIRED",
    );
  }
  if (
    loadedEnvironment.provenance.model.source
      !== "service-env"
    || !loadedEnvironment.provenance.model.sourceFile
  ) {
    throw new Error(
      "PLANNER_REPAIR_PROBE_SERVICE_PROVENANCE_REQUIRED",
    );
  }
  const model = {
    environmentMode: "SERVICE_REQUIRED" as const,
    source: "service-env" as const,
    modelId: plannerConfig.model,
    endpointHash: sha256(
      new URL(plannerConfig.baseUrl).toString(),
    ),
  };
  ModelProvenanceSchema.parse(model);
  process.stderr.write(`${JSON.stringify({
    event: "planner-repair-probe-model-provenance",
    ...model,
    providerSelection: plannerConfig.selection,
    sourceFileName: path.basename(
      loadedEnvironment.provenance.model.sourceFile,
    ),
  })}\n`);

  const provider = guardModelProviderSecretOutputs(
    createOpenAICompatibleModelProvider({
      baseUrl: plannerConfig.baseUrl,
      apiKey: plannerConfig.apiKey,
      model: plannerConfig.model,
      maxOutputTokens: plannerConfig.maxOutputTokens,
      idleTimeoutMs:
        profile.idleTimeoutMs,
      totalTimeoutMs:
        profile.totalTimeoutMs,
      vision: plannerConfig.vision,
    }),
    plannerConfig.apiKey,
  );
  const planner = createQueryUnderstandingPlannerV1({
    model: provider,
    plannerVersion:
      profile.plannerVersion,
    totalTimeoutMs:
      profile.totalTimeoutMs,
  });
  const caseResults: PlannerRepairProbeCaseResultV1[] =
    [];
  for (const definition of PLANNER_REPAIR_PROBE_CASES_V1) {
    const request =
      buildPlannerRepairProbeRequestV1(definition);
    const result = await planner.plan(request);
    const projected = projectPlannerRepairProbeCaseV1({
      definition,
      request,
      result,
    });
    caseResults.push(projected);
    process.stderr.write(`${JSON.stringify({
      event: "planner-repair-probe-case",
      caseId: projected.caseId,
      status: projected.status,
      firstAttempt: projected.firstAttempt,
      repairAttempt: projected.repairAttempt,
      elapsedMs: projected.elapsedMs,
    })}\n`);
  }
  const report = evaluatePlannerRepairProbeV1({
    runId: parsed.runId,
    model,
    cases: caseResults,
  });
  const artifact =
    await writeNewPlannerRepairProbeArtifactV1(
      artifactPath,
      report,
    );
  return { report, artifact };
}

async function main() {
  const result = await runPlannerRepairProbeCliV1(
    process.argv.slice(2),
  );
  process.stdout.write(`${JSON.stringify({
    decision: result.report.decision,
    artifact: result.artifact,
    summary: result.report.summary,
    gateResults: result.report.gateResults,
    cases: result.report.cases,
    operations: result.report.operations,
  }, null, 2)}\n`);
  if (!result.report.passed) process.exitCode = 2;
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
        ? error.stack ?? error.message
        : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
