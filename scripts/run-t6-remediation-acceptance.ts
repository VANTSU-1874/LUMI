import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { ModelServiceError } from "@/lib/ai/client";
import { isGpt56ModelId } from "@/lib/ai/model-id";
import type { AgentTurnResponse } from "@/lib/agent/contracts";
import { externalSearchMessageDigest } from "@/lib/agent/contracts";
import { createDesignTask } from "@/lib/agent/design-project-task";
import type {
  AgentEvidenceSearchPortV2,
  AgentEvidenceToolOutputV2,
} from "@/lib/agent/evidence-tool-v2";
import {
  assertEvaluationTextSafe,
  guardModelProviderSecretOutputs,
  safeEvaluationErrorCode,
} from "@/lib/agent/evaluation-safety";
import type { AgentOptions } from "@/lib/agent/orchestrator-context";
import {
  getActiveAgentPolicy,
  resolveAgentPolicyTimeouts,
} from "@/lib/agent/policy-registry";
import {
  readReleaseSourceBinding,
  sameReleaseSourceBinding,
  type ReleaseSourceBinding,
} from "@/lib/agent/release-source-binding";
import {
  createOpenAICompatibleModelProvider,
  type ModelProviderAdapter,
} from "@/lib/agent/model-provider-adapter";
import {
  createHostedWebModelProvider,
} from "@/lib/agent/hosted-web-model-provider";
import { CurrentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import {
  buildT6RemediationAcceptanceReport,
  createT6RemediationAcceptanceFixtureInput,
  T6RemediationAcceptanceArmResultSchema,
  t6RemediationFirstArm,
  type T6RemediationAcceptanceArm,
  type T6RemediationAcceptanceArmResult,
} from "@/lib/agent/t6-remediation-acceptance";
import {
  loadT6RemediationAcceptanceSuite,
  type T6RemediationAcceptanceSuite,
} from "@/lib/agent/t6-remediation-acceptance-suite";
import {
  judgeTutorQualityAnswer,
  observedTutorAnswer,
  TutorQualityJudgmentSchema,
  TutorQualityObservedAnswerSchema,
  type TutorQualityJudgment,
  type TutorQualityObservedAnswer,
} from "@/lib/agent/tutor-quality-evaluation";
import type {
  TutorQualityCase,
  TutorQualitySuite,
} from "@/lib/agent/tutor-quality-suite";
import {
  tutorQualityServiceFailure,
} from "@/lib/agent/tutor-quality-service-interruption";
import { readEnv } from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
} from "@/lib/config/runtime-environment";
import {
  createDb,
  type DatabaseConnection,
} from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  disposeAgentEvidenceRuntimeV2,
  getFixedAgentEvidenceSearchPortV2ForAudit,
} from "@/lib/knowledge/agent-evidence-runtime-v2";
import {
  ingestCoursePackKnowledge,
} from "@/lib/knowledge/course-pack-store";

const SUITE_PATH =
  "tests/tutor-quality/t6-remediation-acceptance.v1.json";
const CLASS_ID = "demo-class-t6-remediation-acceptance";
const RUNNER_VERSION = 1;
const SAFE_ERROR_CODES = [
  "T6_ACCEPTANCE_JUDGE_INVALID",
  "T6_ACCEPTANCE_MODEL_INTERRUPTED",
  "T6_ACCEPTANCE_RESPONSE_MISSING",
  "T6_ACCEPTANCE_SOURCE_CHANGED_DURING_RUN",
  "T6_ACCEPTANCE_WEB_PROVIDER_HOSTED_SEARCH_UNAVAILABLE",
] as const;

type Arguments = {
  fixture: boolean;
  realModel: boolean;
  outputPath: string;
  runId: string;
  deferCaseId?: string;
  probeCaseId?: string;
  probeArm?: T6RemediationAcceptanceArm;
  resumePriorEndpointHash?: string;
  resumePriorStatusHash?: string;
  importNonWebRunId?: string;
};

type ModelBinding = {
  provider: "OPENAI_COMPATIBLE";
  modelId: string;
  endpointHash: string;
  inferenceHash: string;
};

type AnswerObservation = {
  aiMode: "MODEL_ASSISTED" | "DETERMINISTIC_FALLBACK";
  answer: T6RemediationAcceptanceArmResult["answer"];
  operationalFailures: string[];
  v2: T6RemediationAcceptanceArmResult["v2"];
  web: T6RemediationAcceptanceArmResult["web"];
  toolSequence: T6RemediationAcceptanceArmResult["toolSequence"];
};

type AnswerCheckpoint = {
  schemaVersion: 1;
  kind: "T6_REMEDIATION_ANSWER";
  fingerprintHash: string;
  caseId: string;
  arm: T6RemediationAcceptanceArm;
  order: 1 | 2;
  modelBinding?: ModelBinding;
  observedAnswer: TutorQualityObservedAnswer;
  observation: AnswerObservation;
};

type JudgmentCheckpoint = {
  schemaVersion: 1;
  kind: "T6_REMEDIATION_JUDGMENT";
  fingerprintHash: string;
  caseId: string;
  arm: T6RemediationAcceptanceArm;
  modelBinding?: ModelBinding;
  judgment: TutorQualityJudgment | null;
  errorCode: string | null;
};

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedArguments(rawArguments: readonly string[]) {
  return rawArguments[0] === "--"
    ? rawArguments.slice(1)
    : [...rawArguments];
}

function safeRunId(value: string) {
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(value)) {
    throw new Error("T6_ACCEPTANCE_RUN_ID_INVALID");
  }
  return value;
}

function safeCaseId(value: string) {
  if (!/^[a-z0-9][a-z0-9-]{2,159}$/.test(value)) {
    throw new Error("T6_ACCEPTANCE_DEFER_CASE_INVALID");
  }
  return value;
}

function safeEndpointHash(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(
      "T6_ACCEPTANCE_PRIOR_ENDPOINT_HASH_INVALID",
    );
  }
  return value;
}

function safeStatusHash(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(
      "T6_ACCEPTANCE_PRIOR_STATUS_HASH_INVALID",
    );
  }
  return value;
}

export function parseT6RemediationAcceptanceArguments(
  rawArguments: readonly string[],
): Arguments {
  const values = normalizedArguments(rawArguments);
  let fixture = false;
  let realModel = false;
  let outputPath: string | null = null;
  let runId: string | null = null;
  let deferCaseId: string | null = null;
  let probeCaseId: string | null = null;
  let resumePriorEndpointHash: string | null = null;
  let resumePriorStatusHash: string | null = null;
  let importNonWebRunId: string | null = null;
  let probeArm:
    | T6RemediationAcceptanceArm
    | null = null;
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index]!;
    if (argument === "--fixture" || argument === "--real-model") {
      if (seen.has(argument)) {
        throw new Error("T6_ACCEPTANCE_ARGUMENT_DUPLICATE");
      }
      seen.add(argument);
      if (argument === "--fixture") fixture = true;
      else realModel = true;
      continue;
    }
    if (
      argument === "--output"
      || argument === "--run-id"
      || argument === "--defer-case"
      || argument === "--probe-case"
      || argument === "--probe-arm"
      || argument === "--resume-prior-endpoint-hash"
      || argument === "--resume-prior-status-hash"
      || argument === "--import-non-web-run"
    ) {
      if (seen.has(argument)) {
        throw new Error("T6_ACCEPTANCE_ARGUMENT_DUPLICATE");
      }
      seen.add(argument);
      const value = values[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(
          argument === "--output"
            ? "T6_ACCEPTANCE_OUTPUT_MISSING"
            : argument === "--run-id"
              ? "T6_ACCEPTANCE_RUN_ID_MISSING"
              : argument === "--defer-case"
                ? "T6_ACCEPTANCE_DEFER_CASE_MISSING"
              : argument === "--probe-case"
                  ? "T6_ACCEPTANCE_PROBE_CASE_MISSING"
                  : argument === "--probe-arm"
                    ? "T6_ACCEPTANCE_PROBE_ARM_MISSING"
                    : argument
                        === "--resume-prior-endpoint-hash"
                      ? "T6_ACCEPTANCE_PRIOR_ENDPOINT_HASH_MISSING"
                      : argument
                          === "--resume-prior-status-hash"
                        ? "T6_ACCEPTANCE_PRIOR_STATUS_HASH_MISSING"
                      : "T6_ACCEPTANCE_IMPORT_RUN_MISSING",
        );
      }
      if (argument === "--output") outputPath = value;
      else if (argument === "--run-id") runId = safeRunId(value);
      else if (argument === "--defer-case") {
        deferCaseId = safeCaseId(value);
      } else if (argument === "--probe-case") {
        probeCaseId = safeCaseId(value);
      } else if (
        argument === "--resume-prior-endpoint-hash"
      ) {
        resumePriorEndpointHash = safeEndpointHash(value);
      } else if (
        argument === "--resume-prior-status-hash"
      ) {
        resumePriorStatusHash = safeStatusHash(value);
      } else if (argument === "--import-non-web-run") {
        importNonWebRunId = safeRunId(value);
      } else if (
        value === "LEGACY_V1"
        || value === "SELF_HOSTED_V2"
      ) {
        probeArm = value;
      } else {
        throw new Error(
          "T6_ACCEPTANCE_PROBE_ARM_INVALID",
        );
      }
      index += 1;
      continue;
    }
    throw new Error("T6_ACCEPTANCE_ARGUMENT_UNKNOWN");
  }
  if (fixture === realModel) {
    throw new Error("T6_ACCEPTANCE_MODE_REQUIRED");
  }
  if (fixture) {
    if (
      deferCaseId
      || probeCaseId
      || probeArm
      || resumePriorEndpointHash
      || resumePriorStatusHash
      || importNonWebRunId
    ) {
      throw new Error(
        "T6_ACCEPTANCE_DEFER_REQUIRES_REAL_MODEL",
      );
    }
    return {
      fixture: true,
      realModel: false,
      runId: runId ?? "fixture",
      outputPath: outputPath
        ?? ".runtime/tutor-quality/t6-remediation-acceptance/fixture/report.json",
    };
  }
  if (!runId) throw new Error("T6_ACCEPTANCE_RUN_ID_MISSING");
  if (Boolean(probeCaseId) !== Boolean(probeArm)) {
    throw new Error(
      "T6_ACCEPTANCE_PROBE_INCOMPLETE",
    );
  }
  if (deferCaseId && probeCaseId) {
    throw new Error(
      "T6_ACCEPTANCE_PROBE_DEFER_CONFLICT",
    );
  }
  if (probeCaseId && resumePriorEndpointHash) {
    throw new Error(
      "T6_ACCEPTANCE_PROBE_CUTOVER_CONFLICT",
    );
  }
  if (probeCaseId && resumePriorStatusHash) {
    throw new Error(
      "T6_ACCEPTANCE_PROBE_SOURCE_CUTOVER_CONFLICT",
    );
  }
  if (probeCaseId && importNonWebRunId) {
    throw new Error(
      "T6_ACCEPTANCE_PROBE_IMPORT_CONFLICT",
    );
  }
  if (importNonWebRunId === runId) {
    throw new Error(
      "T6_ACCEPTANCE_IMPORT_RUN_NOT_DISTINCT",
    );
  }
  if (resumePriorStatusHash && !importNonWebRunId) {
    throw new Error(
      "T6_ACCEPTANCE_PRIOR_STATUS_REQUIRES_IMPORT",
    );
  }
  return {
    fixture: false,
    realModel: true,
    runId,
    ...(deferCaseId ? { deferCaseId } : {}),
    ...(probeCaseId && probeArm
      ? { probeCaseId, probeArm }
      : {}),
    ...(resumePriorEndpointHash
      ? { resumePriorEndpointHash }
      : {}),
    ...(resumePriorStatusHash
      ? { resumePriorStatusHash }
      : {}),
    ...(importNonWebRunId
      ? { importNonWebRunId }
      : {}),
    outputPath: outputPath
      ?? `.runtime/tutor-quality/t6-remediation-acceptance/${runId}/report.json`,
  };
}

export function deferT6RemediationCaseToEnd(
  cases: T6RemediationAcceptanceSuite["cases"],
  deferCaseId?: string,
) {
  if (!deferCaseId) return [...cases];
  const deferred = cases.find(
    ({ case: qualityCase }) =>
      qualityCase.id === deferCaseId,
  );
  if (!deferred) {
    throw new Error(
      "T6_ACCEPTANCE_DEFER_CASE_NOT_FOUND",
    );
  }
  return [
    ...cases.filter(
      ({ case: qualityCase }) =>
        qualityCase.id !== deferCaseId,
    ),
    deferred,
  ];
}

const T6_PROVIDER_TRANSIENT_BACKOFF_MS = [
  5_000,
  15_000,
] as const;

const T6_PROVIDER_TRANSIENT_HTTP_STATUSES =
  new Set([408, 429, 502, 503, 524]);

function waitForT6ProviderRetry(
  delayMs: number,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ModelServiceError("CANCELLED"));
      return;
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(new ModelServiceError("CANCELLED"));
    };
    signal?.addEventListener("abort", abort, {
      once: true,
    });
  });
}

export function t6RemediationProviderTransientRetry(
  adapter: ModelProviderAdapter,
  dependencies: {
    wait?: (
      delayMs: number,
      signal?: AbortSignal,
    ) => Promise<void>;
  } = {},
): ModelProviderAdapter {
  const wait = dependencies.wait
    ?? waitForT6ProviderRetry;
  async function execute<T>(input: {
    stage:
      | "complete"
      | "respond"
      | "completeWithImage";
    signal?: AbortSignal;
    operation: () => Promise<T>;
  }) {
    for (
      let attempt = 1;
      attempt <= T6_PROVIDER_TRANSIENT_BACKOFF_MS.length + 1;
      attempt += 1
    ) {
      try {
        return await input.operation();
      } catch (error) {
        const retryable =
          error instanceof ModelServiceError
          && (
            error.code === "PROVIDER_STATUS"
            || error.code === "RATE_LIMIT"
          )
          && error.httpStatus !== null
          && T6_PROVIDER_TRANSIENT_HTTP_STATUSES.has(
            error.httpStatus,
          )
          && attempt
            <= T6_PROVIDER_TRANSIENT_BACKOFF_MS.length
          && !input.signal?.aborted;
        if (!retryable) throw error;
        const configuredDelay =
          T6_PROVIDER_TRANSIENT_BACKOFF_MS[
            attempt - 1
          ]!;
        const delayMs = Math.max(
          configuredDelay,
          error.retryAfterMs ?? 0,
        );
        process.stderr.write(`${JSON.stringify({
          event:
            "t6-remediation-provider-transient-retry",
          stage: input.stage,
          attempt,
          maxAttempts:
            T6_PROVIDER_TRANSIENT_BACKOFF_MS.length + 1,
          delayMs,
          httpStatus: error.httpStatus,
          errorCode: error.code,
        })}\n`);
        await wait(delayMs, input.signal);
      }
    }
    throw new ModelServiceError(
      "PROVIDER_STATUS",
      null,
      408,
    );
  }
  return {
    ...adapter,
    complete: (messages, options) =>
      execute({
        stage: "complete",
        signal: options?.signal,
        operation: () =>
          adapter.complete(messages, options),
      }),
    ...(adapter.respond
      ? {
          respond: (messages, options) =>
            execute({
              stage: "respond",
              signal: options?.signal,
              operation: () =>
                adapter.respond!(
                  messages,
                  options,
                ),
            }),
        }
      : {}),
    ...(adapter.completeWithImage
      ? {
          completeWithImage: (
            messages,
            image,
            options,
          ) =>
            execute({
              stage: "completeWithImage",
              signal: options?.signal,
              operation: () =>
                adapter.completeWithImage!(
                  messages,
                  image,
                  options,
                ),
            }),
        }
      : {}),
  };
}

export function resolveT6RemediationModelOverride(
  environment: Record<
    string,
    string | undefined
  >,
) {
  const baseUrl =
    environment.T6_LLM_BASE_URL?.trim();
  const apiKey =
    environment.T6_LLM_API_KEY?.trim();
  const model =
    environment.T6_LLM_MODEL?.trim();
  const configured = [
    baseUrl,
    apiKey,
    model,
  ].filter(Boolean).length;
  if (configured === 0) return null;
  if (configured !== 3) {
    throw new Error(
      "T6_ACCEPTANCE_MODEL_OVERRIDE_INCOMPLETE",
    );
  }
  return {
    baseUrl: baseUrl!,
    apiKey: apiKey!,
    model: model!,
  };
}

function judgeSuite(
  suite: T6RemediationAcceptanceSuite,
): TutorQualitySuite {
  return {
    schemaVersion: suite.schemaVersion,
    version: suite.version,
    rubricVersion: suite.rubricVersion,
    description: suite.description,
    scoringDimensions: suite.scoringDimensions,
    hardFailures: suite.hardFailures,
    cases: suite.cases.map(({ case: qualityCase }) => qualityCase),
  } as TutorQualitySuite;
}

function firstArmOrder(
  suiteHash: string,
  caseId: string,
) {
  const first = t6RemediationFirstArm(suiteHash, caseId);
  const second = first === "LEGACY_V1"
    ? "SELF_HOSTED_V2" as const
    : "LEGACY_V1" as const;
  return [first, second] as const;
}

function armOrder(
  suiteHash: string,
  caseId: string,
  arm: T6RemediationAcceptanceArm,
) {
  return firstArmOrder(suiteHash, caseId)[0] === arm
    ? 1 as const
    : 2 as const;
}

function checkpointFingerprint(input: {
  suiteHash: string;
  sourceBinding: ReleaseSourceBinding;
  modelBinding: ModelBinding;
  qualityCase: TutorQualityCase;
  arm: T6RemediationAcceptanceArm;
  order: 1 | 2;
}) {
  return sha256(JSON.stringify({
    runnerVersion: RUNNER_VERSION,
    suiteHash: input.suiteHash,
    sourceCommit: input.sourceBinding.sourceCommit,
    sourceStatusHash: input.sourceBinding.sourceStatusHash,
    modelBinding: input.modelBinding,
    caseId: input.qualityCase.id,
    arm: input.arm,
    order: input.order,
    inputHash: sha256(JSON.stringify({
      question: input.qualityCase.question,
      prelude: input.qualityCase.prelude,
      coursePackId: input.qualityCase.coursePackId,
      view: input.qualityCase.view,
      rubric: input.qualityCase.rubric,
      webSearchConsent: input.qualityCase.webSearchConsent,
    })),
  }));
}

function importedReportSourceBinding(
  raw: unknown,
  expectedSuiteHash: string,
) {
  if (!raw || typeof raw !== "object") {
    throw new Error(
      "T6_ACCEPTANCE_IMPORT_REPORT_INVALID",
    );
  }
  const value = raw as {
    suiteHash?: unknown;
    sourceBinding?: unknown;
  };
  if (value.suiteHash !== expectedSuiteHash) {
    throw new Error(
      "T6_ACCEPTANCE_IMPORT_SUITE_MISMATCH",
    );
  }
  const source = value.sourceBinding;
  if (!source || typeof source !== "object") {
    throw new Error(
      "T6_ACCEPTANCE_IMPORT_SOURCE_BINDING_INVALID",
    );
  }
  const binding = source as {
    commit?: unknown;
    statusHash?: unknown;
  };
  if (
    typeof binding.commit !== "string"
    || !/^[a-f0-9]{40}$/.test(binding.commit)
    || typeof binding.statusHash !== "string"
    || !/^[a-f0-9]{64}$/.test(binding.statusHash)
  ) {
    throw new Error(
      "T6_ACCEPTANCE_IMPORT_SOURCE_BINDING_INVALID",
    );
  }
  return {
    sourceCommit: binding.commit,
    sourceStatusHash: binding.statusHash,
    sourceTrackedTreeClean: false,
  } satisfies ReleaseSourceBinding;
}

function checkpointPaths(
  outputPath: string,
  caseId: string,
  arm: T6RemediationAcceptanceArm,
) {
  const root = path.join(
    path.dirname(outputPath),
    "checkpoints",
  );
  const base = `${caseId}-${arm.toLowerCase()}`;
  return {
    answer: path.join(root, `${base}.answer.json`),
    judgment: path.join(root, `${base}.judgment.json`),
  };
}

async function readJsonIfPresent(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

async function writeSealedJson(input: {
  filePath: string;
  value: unknown;
  configuredSecret: string;
}) {
  const text = `${JSON.stringify(input.value, null, 2)}\n`;
  assertEvaluationTextSafe(
    text,
    input.configuredSecret,
    "T6_ACCEPTANCE_CHECKPOINT_SENSITIVE_TEXT",
  );
  await mkdir(path.dirname(input.filePath), { recursive: true });
  await writeFile(input.filePath, text, {
    encoding: "utf8",
    flag: "wx",
  });
}

function parseAnswerCheckpoint(
  raw: unknown,
  fingerprintHash: string,
) {
  if (!raw || typeof raw !== "object") {
    throw new Error("T6_ACCEPTANCE_ANSWER_CHECKPOINT_INVALID");
  }
  const value = raw as Partial<AnswerCheckpoint>;
  if (
    value.schemaVersion !== 1
    || value.kind !== "T6_REMEDIATION_ANSWER"
    || value.fingerprintHash !== fingerprintHash
    || typeof value.caseId !== "string"
    || !["LEGACY_V1", "SELF_HOSTED_V2"].includes(value.arm ?? "")
    || ![1, 2].includes(value.order ?? 0)
  ) {
    throw new Error("T6_ACCEPTANCE_CHECKPOINT_FINGERPRINT_MISMATCH");
  }
  const observedAnswer = TutorQualityObservedAnswerSchema.parse(
    value.observedAnswer,
  );
  const observation = value.observation as AnswerObservation;
  const validation = T6RemediationAcceptanceArmResultSchema.safeParse({
    caseId: value.caseId,
    arm: value.arm,
    order: value.order,
    aiMode: observation.aiMode,
    judgmentValid: true,
    answer: observation.answer,
    scores: {
      specificityAndUsefulness: 1,
      professionalCorrectness: 1,
      executableFirstStep: 1,
      followUpJudgment: 1,
      sourceAndUncertainty: 1,
    },
    hardFailures: {
      AUTHORITY_OVERREACH: false,
      FABRICATED_SOURCE: false,
      PRIVACY_LEAK: false,
    },
    operationalFailures: observation.operationalFailures,
    v2: observation.v2,
    web: observation.web,
    toolSequence: observation.toolSequence,
  });
  if (!validation.success) {
    throw new Error("T6_ACCEPTANCE_ANSWER_CHECKPOINT_INVALID");
  }
  return {
    ...value,
    arm: value.arm as T6RemediationAcceptanceArm,
    order: value.order as 1 | 2,
    modelBinding: parseCheckpointModelBinding(
      value.modelBinding,
    ),
    observedAnswer,
    observation,
  } as AnswerCheckpoint;
}

function parseJudgmentCheckpoint(
  raw: unknown,
  fingerprintHash: string,
) {
  if (!raw || typeof raw !== "object") {
    throw new Error("T6_ACCEPTANCE_JUDGMENT_CHECKPOINT_INVALID");
  }
  const value = raw as Partial<JudgmentCheckpoint>;
  if (
    value.schemaVersion !== 1
    || value.kind !== "T6_REMEDIATION_JUDGMENT"
    || value.fingerprintHash !== fingerprintHash
    || typeof value.caseId !== "string"
    || !["LEGACY_V1", "SELF_HOSTED_V2"].includes(value.arm ?? "")
    || (
      value.errorCode !== null
      && typeof value.errorCode !== "string"
    )
  ) {
    throw new Error("T6_ACCEPTANCE_CHECKPOINT_FINGERPRINT_MISMATCH");
  }
  return {
    ...value,
    arm: value.arm as T6RemediationAcceptanceArm,
    modelBinding: parseCheckpointModelBinding(
      value.modelBinding,
    ),
    judgment: value.judgment === null
      ? null
      : TutorQualityJudgmentSchema.parse(value.judgment),
  } as JudgmentCheckpoint;
}

function modelBinding(input: {
  modelId: string;
  baseUrl: string;
  maxOutputTokens: number;
  idleTimeoutMs: number;
  modelTotalTimeoutMs: number;
  turnTotalTimeoutMs: number;
  vision: boolean;
}) {
  const endpointHash = sha256(new URL(input.baseUrl).toString());
  return {
    provider: "OPENAI_COMPATIBLE" as const,
    modelId: input.modelId,
    endpointHash,
    inferenceHash: sha256(JSON.stringify({
      modelId: input.modelId,
      maxOutputTokens: input.maxOutputTokens,
      idleTimeoutMs: input.idleTimeoutMs,
      modelTotalTimeoutMs: input.modelTotalTimeoutMs,
      turnTotalTimeoutMs: input.turnTotalTimeoutMs,
      vision: input.vision,
    })),
  };
}

function parseCheckpointModelBinding(
  value: unknown,
): ModelBinding | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    throw new Error(
      "T6_ACCEPTANCE_CHECKPOINT_MODEL_BINDING_INVALID",
    );
  }
  const binding = value as Partial<ModelBinding>;
  if (
    binding.provider !== "OPENAI_COMPATIBLE"
    || typeof binding.modelId !== "string"
    || !/^[a-f0-9]{64}$/.test(
      binding.endpointHash ?? "",
    )
    || !/^[a-f0-9]{64}$/.test(
      binding.inferenceHash ?? "",
    )
  ) {
    throw new Error(
      "T6_ACCEPTANCE_CHECKPOINT_MODEL_BINDING_INVALID",
    );
  }
  return binding as ModelBinding;
}

function insertSyntheticStudent(
  connection: DatabaseConnection,
  input: {
    caseId: string;
    arm: T6RemediationAcceptanceArm;
  },
) {
  const identity = t6RemediationSyntheticStudentIdentity(
    input.caseId,
    input.arm,
  );
  connection.sqlite.prepare(`
    INSERT INTO users(id,class_id,role,alias,created_at)
    VALUES(?,?, 'STUDENT', ?, ?)
  `).run(
    identity.studentId,
    CLASS_ID,
    identity.alias,
    Math.floor(Date.now() / 1_000),
  );
  return {
    userId: identity.studentId,
    role: "STUDENT" as const,
  };
}

export function t6RemediationSyntheticStudentIdentity(
  caseId: string,
  arm: T6RemediationAcceptanceArm,
) {
  return {
    studentId:
      `demo-student-t6r-${caseId}-${arm.toLowerCase()}`,
    alias: `T6 仿真 ${caseId} ${arm}`,
  };
}

function courseRetrievalEvents(response: AgentTurnResponse) {
  return response.runtimeEvents.filter(({ kind, label }) =>
    kind === "RETRIEVAL"
    && !label.includes("学生记忆"));
}

function derivedV2Status(
  outputs: readonly AgentEvidenceToolOutputV2[],
) {
  const status = outputs.at(-1)?.bundle.status;
  if (status === "EMPTY") return "EMPTY" as const;
  if (
    (status === "SUCCESS" || status === "DEGRADED")
    && (outputs.at(-1)?.evidence.nodes.length ?? 0) > 0
  ) {
    return "SUCCESS" as const;
  }
  return "ERROR" as const;
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function answerObservation(input: {
  response: AgentTurnResponse;
  observedAnswer: TutorQualityObservedAnswer;
  qualityCase: TutorQualityCase;
  arm: T6RemediationAcceptanceArm;
  evidenceOutputs: readonly AgentEvidenceToolOutputV2[];
}) {
  const events = [...input.response.runtimeEvents]
    .sort((left, right) => left.sequence - right.sequence);
  const v2Calls = events.filter(({ kind, toolId }) =>
    kind === "TOOL_CALL"
    && toolId === "knowledge-map.search-evidence");
  const webCalls = events.filter(({ kind, toolId }) =>
    kind === "TOOL_CALL"
    && toolId === "external-web.search");
  const consentValidated = events.some(({ kind, status, label, toolId }) =>
    kind === "POLICY_CHECK"
    && status === "SUCCEEDED"
    && label === "确认本轮联网授权"
    && toolId === "external-web.search");
  const baselineReuse = events.find(({ kind, status, label }) =>
    kind === "DEGRADED"
    && status === "SUCCEEDED"
    && label === "复用旧课程基线");
  const retrievalEvents = courseRetrievalEvents(input.response);
  const baselineIds = baselineReuse?.sourceIds
    ?? retrievalEvents.at(-1)?.sourceIds
    ?? [];
  const v2Status = input.arm === "LEGACY_V1"
    ? "NOT_APPLICABLE" as const
    : derivedV2Status(input.evidenceOutputs);
  const evidenceSourceIds = unique(
    input.evidenceOutputs.flatMap(({ evidence }) =>
      evidence.nodes.map(({ nodeId }) => nodeId)),
  ).slice(0, 16);
  const declaredSourceIds = input.response.reply.sources
    .map(({ id }) => id);
  const toolSequence: Array<
    "COURSE_EVIDENCE" | "PUBLIC_WEB" | "FINAL_ANSWER"
  > = events.flatMap(({ kind, status, toolId }) => {
    if (kind !== "TOOL_CALL" || status !== "SUCCEEDED") return [];
    if (toolId === "knowledge-map.search-evidence") {
      return ["COURSE_EVIDENCE" as const];
    }
    if (toolId === "external-web.search") {
      return ["PUBLIC_WEB" as const];
    }
    return [];
  });
  toolSequence.push("FINAL_ANSWER");
  const operationalFailures: string[] = [];
  if (input.response.aiMode !== "MODEL_ASSISTED") {
    operationalFailures.push("AI_NOT_MODEL_ASSISTED");
  }
  if (!input.observedAnswer.v3PathObserved) {
    operationalFailures.push("V3_PATH_NOT_OBSERVED");
  }
  if (
    input.response.coursePack.id
    !== input.qualityCase.coursePackId
  ) {
    operationalFailures.push("COURSE_PACK_MISMATCH");
  }
  return {
    aiMode: input.response.aiMode,
    answer: {
      title: input.observedAnswer.title,
      message: input.observedAnswer.message,
      uncertainty: input.observedAnswer.uncertainty,
      sources: input.observedAnswer.sources,
      latencyMs: input.observedAnswer.latencyMs,
    },
    operationalFailures,
    v2: {
      status: v2Status,
      toolCallCount: v2Calls.length,
      baselineAvailable: baselineIds.length > 0,
      baselineReused: Boolean(baselineReuse),
      reason: input.arm === "LEGACY_V1"
        ? "NOT_APPLICABLE" as const
        : baselineReuse
          ? "V2_HEALTHY_EMPTY" as const
          : "NONE" as const,
      injectedBaselineSourceIds:
        baselineReuse?.sourceIds ?? [],
      evidenceSourceIds,
      declaredSourceIds,
      secondLegacySearchCount: Math.max(
        0,
        retrievalEvents.length - 1,
      ),
    },
    web: {
      consentValidated,
      toolCallCount: webCalls.length,
      publicSourceCount: input.response.reply.sources
        .filter(({ authority, url }) =>
          authority === "PUBLIC_WEB"
          && Boolean(url)).length,
    },
    toolSequence,
  } satisfies AnswerObservation;
}

async function runAnswer(input: {
  connection: DatabaseConnection;
  runtime: CurrentAgentRuntime;
  adapter: ModelProviderAdapter;
  policy: ReturnType<typeof getActiveAgentPolicy>;
  ai: AgentOptions["ai"];
  artworkRoot: string;
  qualityCase: TutorQualityCase;
  arm: T6RemediationAcceptanceArm;
  evidenceSearchV2: AgentEvidenceSearchPortV2;
  webSearchAdapter?: ModelProviderAdapter;
}) {
  const actor = insertSyntheticStudent(input.connection, {
    caseId: input.qualityCase.id,
    arm: input.arm,
  });
  const task = createDesignTask(input.connection, actor, {
    title: `T6 验收 ${input.qualityCase.id} ${input.arm}`,
  });
  const modelErrors: string[] = [];
  let serviceError: ModelServiceError | null = null;
  const evidenceOutputs: AgentEvidenceToolOutputV2[] = [];
  const evidenceSearchV2: AgentEvidenceSearchPortV2 = {
    async search(searchInput) {
      const output = await input.evidenceSearchV2.search(searchInput);
      evidenceOutputs.push(output);
      return output;
    },
  };
  const options: AgentOptions = {
    modelProviderAdapter: input.adapter,
    ...(input.webSearchAdapter
      ? {
          webSearchModelProviderAdapter:
            input.webSearchAdapter,
        }
      : {}),
    policy: input.policy,
    ai: input.ai,
    artworkRoot: input.artworkRoot,
    knowledgeObjectV2Enabled: input.arm === "SELF_HOSTED_V2",
    ...(input.arm === "SELF_HOSTED_V2"
      ? { evidenceSearchV2 }
      : {}),
    onModelError(error, attempt) {
      if (error instanceof ModelServiceError) serviceError = error;
      const code = error instanceof ModelServiceError
        ? error.code
        : "MODEL_ERROR";
      modelErrors.push(`attempt-${attempt}:${code}`);
    },
  };
  const externalSearchConsent =
    input.qualityCase.webSearchConsent
      ? {
          nonce: randomUUID(),
          messageDigest: externalSearchMessageDigest(
            input.qualityCase.question,
          ),
          issuedAt: Date.now(),
        }
      : undefined;
  const started = performance.now();
  const response = await input.runtime.run({
    connection: input.connection,
    actor,
    input: {
      taskId: task.id,
      message: input.qualityCase.question,
      context: { view: input.qualityCase.view },
      ...(externalSearchConsent
        ? { externalSearchConsent }
        : {}),
    },
    options,
  });
  if (
    response.aiMode !== "MODEL_ASSISTED"
    && serviceError
  ) {
    throw serviceError;
  }
  const observedAnswer = observedTutorAnswer(
    response,
    performance.now() - started,
    modelErrors,
  );
  return {
    observedAnswer,
    observation: answerObservation({
      response,
      observedAnswer,
      qualityCase: input.qualityCase,
      arm: input.arm,
      evidenceOutputs,
    }),
  };
}

function invalidJudgmentResult(
  answerCheckpoint: AnswerCheckpoint,
) {
  return T6RemediationAcceptanceArmResultSchema.parse({
    caseId: answerCheckpoint.caseId,
    arm: answerCheckpoint.arm,
    order: answerCheckpoint.order,
    aiMode: answerCheckpoint.observation.aiMode,
    judgmentValid: false,
    answer: answerCheckpoint.observation.answer,
    scores: {
      specificityAndUsefulness: 1,
      professionalCorrectness: 1,
      executableFirstStep: 1,
      followUpJudgment: 1,
      sourceAndUncertainty: 1,
    },
    hardFailures: {
      AUTHORITY_OVERREACH: false,
      FABRICATED_SOURCE: false,
      PRIVACY_LEAK: false,
    },
    operationalFailures: unique([
      ...answerCheckpoint.observation.operationalFailures,
      "JUDGMENT_INVALID",
    ]),
    v2: answerCheckpoint.observation.v2,
    web: answerCheckpoint.observation.web,
    toolSequence: answerCheckpoint.observation.toolSequence,
  });
}

function resultFromCheckpoints(
  answerCheckpoint: AnswerCheckpoint,
  judgmentCheckpoint: JudgmentCheckpoint,
) {
  if (!judgmentCheckpoint.judgment) {
    return invalidJudgmentResult(answerCheckpoint);
  }
  const judgment = judgmentCheckpoint.judgment;
  return T6RemediationAcceptanceArmResultSchema.parse({
    caseId: answerCheckpoint.caseId,
    arm: answerCheckpoint.arm,
    order: answerCheckpoint.order,
    aiMode: answerCheckpoint.observation.aiMode,
    judgmentValid: true,
    answer: answerCheckpoint.observation.answer,
    scores: judgment.scores,
    hardFailures: Object.fromEntries(
      Object.entries(judgment.hardFailures)
        .map(([id, finding]) => [id, finding.occurred]),
    ),
    operationalFailures:
      answerCheckpoint.observation.operationalFailures,
    v2: answerCheckpoint.observation.v2,
    web: answerCheckpoint.observation.web,
    toolSequence: answerCheckpoint.observation.toolSequence,
  });
}

function safeError(error: unknown) {
  return safeEvaluationErrorCode(
    error,
    "T6_ACCEPTANCE_JUDGE_INVALID",
    SAFE_ERROR_CODES,
  );
}

function blindLabelOrder(
  suiteHash: string,
  caseId: string,
) {
  return sha256(`${suiteHash}:blind:${caseId}`).charCodeAt(0) % 2 === 0
    ? ["LEGACY_V1", "SELF_HOSTED_V2"] as const
    : ["SELF_HOSTED_V2", "LEGACY_V1"] as const;
}

async function writeBlindReviewPack(input: {
  outputPath: string;
  suite: T6RemediationAcceptanceSuite;
  suiteHash: string;
  results: readonly T6RemediationAcceptanceArmResult[];
  configuredSecret: string;
}) {
  const byKey = new Map(input.results.map((result) => [
    `${result.caseId}:${result.arm}`,
    result,
  ]));
  const mapping = input.suite.cases.map(({ case: qualityCase }) => {
    const order = blindLabelOrder(input.suiteHash, qualityCase.id);
    return {
      caseId: qualityCase.id,
      A: order[0],
      B: order[1],
    };
  });
  const sections = input.suite.cases.map(
    ({ case: qualityCase }, index) => {
      const labels = mapping[index]!;
      const answerA = byKey.get(
        `${qualityCase.id}:${labels.A}`,
      )!;
      const answerB = byKey.get(
        `${qualityCase.id}:${labels.B}`,
      )!;
      return [
        `## ${index + 1}. ${qualityCase.id}`,
        "",
        `问题：${qualityCase.question}`,
        "",
        "### 回答 A",
        "",
        answerA.answer.message,
        ...(answerA.answer.uncertainty
          ? ["", `不确定性：${answerA.answer.uncertainty}`]
          : []),
        "",
        "### 回答 B",
        "",
        answerB.answer.message,
        ...(answerB.answer.uncertainty
          ? ["", `不确定性：${answerB.answer.uncertainty}`]
          : []),
        "",
        "人工选择：`A / B / 持平 / 两者均不合格`",
      ].join("\n");
    },
  );
  const reviewText = [
    "# T6 补救后匿名专业复核",
    "",
    "这是仿真导师回答的技术复核，不是真实学生或教学成效证据。",
    "请只根据问题、回答专业性、边界与可执行性选择，不查看 mapping.json。",
    "",
    ...sections,
    "",
  ].join("\n");
  const mappingText = `${JSON.stringify({
    schemaVersion: 1,
    suiteHash: input.suiteHash,
    mapping,
  }, null, 2)}\n`;
  assertEvaluationTextSafe(
    reviewText,
    input.configuredSecret,
    "T6_ACCEPTANCE_BLIND_PACK_SENSITIVE_TEXT",
  );
  const root = path.dirname(input.outputPath);
  await writeFile(
    path.join(root, "blind-review.md"),
    reviewText,
    { encoding: "utf8", flag: "wx" },
  );
  await writeFile(
    path.join(root, "blind-mapping.json"),
    mappingText,
    { encoding: "utf8", flag: "wx" },
  );
}

async function runRealModel(input: {
  arguments: Arguments;
  suite: T6RemediationAcceptanceSuite;
  suiteHash: string;
}) {
  const loadedEnvironment = await loadRuntimeEnvironment({
    mode: "SERVICE_REQUIRED",
    nodeEnv: "test",
  });
  const config = readEnv(loadedEnvironment.environment);
  const modelOverride =
    resolveT6RemediationModelOverride(
      loadedEnvironment.environment,
    );
  const evaluationAi = modelOverride
    ? {
        ...config.ai,
        enabled: true as const,
        baseUrl: modelOverride.baseUrl,
        apiKey: modelOverride.apiKey,
        model: modelOverride.model,
      }
    : config.ai;
  if (!evaluationAi.enabled) {
    throw new Error("T6_ACCEPTANCE_REQUIRES_MODEL_CONFIG");
  }
  const modelId = evaluationAi.model!;
  if (!isGpt56ModelId(modelId)) {
    throw new Error("T6_ACCEPTANCE_REQUIRES_GPT_5_6");
  }
  if (!evaluationAi.vision) {
    throw new Error("T6_ACCEPTANCE_REQUIRES_VISION_ENABLED");
  }
  const policy = resolveAgentPolicyTimeouts(
    getActiveAgentPolicy(),
    config.agentTimeouts.evaluation,
  );
  const binding = modelBinding({
    modelId,
    baseUrl: evaluationAi.baseUrl!,
    maxOutputTokens:
      evaluationAi.maxOutputTokens,
    idleTimeoutMs:
      config.agentTimeouts.evaluation.modelIdleTimeoutMs,
    modelTotalTimeoutMs:
      config.agentTimeouts.evaluation.modelTotalTimeoutMs,
    turnTotalTimeoutMs:
      config.agentTimeouts.evaluation.turnTotalTimeoutMs,
    vision: evaluationAi.vision,
  });
  const priorBinding =
    input.arguments.resumePriorEndpointHash
      ? {
          ...binding,
          endpointHash:
            input.arguments.resumePriorEndpointHash,
        }
      : null;
  if (
    priorBinding
    && priorBinding.endpointHash === binding.endpointHash
  ) {
    throw new Error(
      "T6_ACCEPTANCE_PRIOR_ENDPOINT_NOT_DISTINCT",
    );
  }
  process.stderr.write(`${JSON.stringify({
    event: "t6-remediation-effective-model-config",
    source: modelOverride
      ? "t6-evaluation-override"
      : loadedEnvironment.provenance.model.source,
    sourceFile: loadedEnvironment.provenance.model.sourceFile,
    modelId,
    endpointHash: binding.endpointHash,
  })}\n`);
  if (priorBinding) {
    process.stderr.write(`${JSON.stringify({
      event: "t6-remediation-model-pool-cutover",
      priorEndpointHash: priorBinding.endpointHash,
      activeEndpointHash: binding.endpointHash,
      modelId: binding.modelId,
      inferenceHash: binding.inferenceHash,
      checkpointPolicy:
        "REUSE_PRIOR_BINDING_AND_SEAL_NEW_WITH_ACTIVE_BINDING",
    })}\n`);
  }
  const configuredSecret = evaluationAi.apiKey!;
  const adapter = t6RemediationProviderTransientRetry(
    guardModelProviderSecretOutputs(
      createOpenAICompatibleModelProvider({
        baseUrl: evaluationAi.baseUrl!,
        apiKey: configuredSecret,
        model: modelId,
        maxOutputTokens:
          evaluationAi.maxOutputTokens,
        idleTimeoutMs:
          policy.budgets.modelIdleTimeoutMs,
        totalTimeoutMs:
          policy.budgets.modelTimeoutMs,
        vision: evaluationAi.vision,
      }),
      configuredSecret,
    ),
  );
  const webAi = config.ai.web ?? (
    config.ai.enabled
    && config.ai.baseUrl
    && config.ai.apiKey
    && config.ai.model
      ? {
          baseUrl: config.ai.baseUrl,
          apiKey: config.ai.apiKey,
          model: config.ai.model,
        }
      : null
  );
  if (!webAi) {
    throw new Error(
      "T6_ACCEPTANCE_WEB_PROVIDER_CONFIG_MISSING",
    );
  }
  const webSearchBinding = modelBinding({
    modelId: webAi.model,
    baseUrl: webAi.baseUrl,
    maxOutputTokens:
      config.ai.maxOutputTokens,
    idleTimeoutMs:
      config.agentTimeouts.evaluation.modelIdleTimeoutMs,
    modelTotalTimeoutMs:
      config.agentTimeouts.evaluation.modelTotalTimeoutMs,
    turnTotalTimeoutMs:
      config.agentTimeouts.evaluation.turnTotalTimeoutMs,
    vision: false,
  });
  const rawWebSearchAdapter =
    createHostedWebModelProvider({
      baseUrl: webAi.baseUrl,
      apiKey: webAi.apiKey,
      model: webAi.model,
      maxOutputTokens:
        config.ai.maxOutputTokens,
      idleTimeoutMs:
        policy.budgets.modelIdleTimeoutMs,
      totalTimeoutMs:
        policy.budgets.modelTimeoutMs,
    });
  const webSearchAdapter =
    t6RemediationProviderTransientRetry(
      guardModelProviderSecretOutputs(
        rawWebSearchAdapter,
        webAi.apiKey,
      ),
    );
  if (
    webSearchAdapter.capabilities.webSearch
      !== true
  ) {
    throw new Error(
      "T6_ACCEPTANCE_WEB_PROVIDER_HOSTED_SEARCH_UNAVAILABLE",
    );
  }
  process.stderr.write(`${JSON.stringify({
    event: "t6-remediation-web-provider-config",
    source:
      config.ai.web
        ? "dedicated-web-override"
        : loadedEnvironment.provenance.model.source,
    sourceFile:
      loadedEnvironment.provenance.model.sourceFile,
    modelId: webSearchBinding.modelId,
    endpointHash: webSearchBinding.endpointHash,
    provider: rawWebSearchAdapter.protocol
      === "DEEPSEEK_ANTHROPIC"
      ? "DEEPSEEK"
      : rawWebSearchAdapter.provider,
    protocol:
      rawWebSearchAdapter.protocol ?? "OPENAI",
    role: "HOSTED_WEB_SEARCH_ONLY",
  })}\n`);
  const startSource = readReleaseSourceBinding();
  const outputPath = path.resolve(input.arguments.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const workRoot = await mkdtemp(path.join(
    path.dirname(outputPath),
    "work-",
  ));
  const databasePath = path.join(workRoot, "acceptance.sqlite");
  const artworkRoot = path.join(workRoot, "private-artworks");
  const runtime = new CurrentAgentRuntime();
  const previousV3 = process.env.AGENT_V3_ENABLED;
  const previousNodeEnv = process.env.NODE_ENV;
  Object.assign(process.env, {
    AGENT_V3_ENABLED: "true",
    NODE_ENV: "test",
  });
  let connection: DatabaseConnection | null = null;
  let activeEvaluationStage: {
    kind: "ANSWER" | "JUDGMENT";
    caseId: string;
    arm: T6RemediationAcceptanceArm;
  } | null = null;
  try {
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.prepare(
      "INSERT INTO classes(id,name,access_code) VALUES(?,?,?)",
    ).run(
      CLASS_ID,
      "T6 补救后独立验收班",
      `T6R-${randomUUID()}`,
    );
    await ingestCoursePackKnowledge(connection);
    const baseEvidenceSearch =
      await getFixedAgentEvidenceSearchPortV2ForAudit();
    if (
      input.arguments.probeCaseId
      && input.arguments.probeArm
    ) {
      const qualityCase = input.suite.cases.find(
        ({ case: candidate }) =>
          candidate.id
          === input.arguments.probeCaseId,
      )?.case;
      if (!qualityCase) {
        throw new Error(
          "T6_ACCEPTANCE_PROBE_CASE_NOT_FOUND",
        );
      }
      const execution = await runAnswer({
        connection,
        runtime,
        adapter,
        policy,
        ai: evaluationAi,
        artworkRoot,
        qualityCase,
        arm: input.arguments.probeArm,
        evidenceSearchV2: baseEvidenceSearch,
        webSearchAdapter:
          qualityCase.webSearchConsent
            ? webSearchAdapter
            : undefined,
      });
      const expectedProbeSequence =
        qualityCase.webSearchConsent
          ? input.arguments.probeArm
              === "SELF_HOSTED_V2"
            ? [
                "COURSE_EVIDENCE",
                "PUBLIC_WEB",
                "FINAL_ANSWER",
              ]
            : [
                "PUBLIC_WEB",
                "FINAL_ANSWER",
              ]
          : null;
      const probeContractPassed = (
        execution.observation
          .operationalFailures.length === 0
        && (
          !qualityCase.webSearchConsent
          || (
            execution.observation.web
              .consentValidated
            && execution.observation.web
              .toolCallCount === 1
            && execution.observation.web
              .publicSourceCount > 0
            && JSON.stringify(
              execution.observation
                .toolSequence,
            ) === JSON.stringify(
              expectedProbeSequence,
            )
          )
        )
      );
      process.stdout.write(`${JSON.stringify({
        status: probeContractPassed
          ? "T6_PROBE_CONTRACT_PASS"
          : "T6_PROBE_CONTRACT_FAIL",
        runId: input.arguments.runId,
        caseId: qualityCase.id,
        arm: input.arguments.probeArm,
        aiMode: execution.observation.aiMode,
        latencyMs:
          execution.observedAnswer.latencyMs,
        toolSequence:
          execution.observation.toolSequence,
        v2Status:
          execution.observation.v2.status,
        sourceCount:
          execution.observedAnswer.sources.length,
        publicSourceCount:
          execution.observation.web
            .publicSourceCount,
        contractPassed:
          probeContractPassed,
        answerCharacters: [
          ...execution.observedAnswer.message,
        ].length,
        checkpointWritten: false,
        reportWritten: false,
      })}\n`);
      if (!probeContractPassed) {
        process.exitCode = 1;
      }
      return;
    }
    const answerCheckpoints = new Map<
      string,
      AnswerCheckpoint
    >();
    const judgmentCheckpoints = new Map<
      string,
      JudgmentCheckpoint
    >();
    const checkpointSourceRoles = new Map<
      string,
      "prior" | "active"
    >();
    const totalCalls = input.suite.cases.length * 4;
    let completedCalls = 0;
    const bindingUsage = {
      prior: {
        answerCheckpointCount: 0,
        judgmentCheckpointCount: 0,
      },
      active: {
        answerCheckpointCount: 0,
        judgmentCheckpointCount: 0,
      },
    };
    const executionCases = deferT6RemediationCaseToEnd(
      input.suite.cases,
      input.arguments.deferCaseId,
    );
    const importedOutputPath =
      input.arguments.importNonWebRunId
        ? path.join(
            path.dirname(path.dirname(outputPath)),
            input.arguments.importNonWebRunId,
            "report.json",
          )
        : null;
    const importedReport = importedOutputPath
      ? await readJsonIfPresent(importedOutputPath)
      : null;
    if (importedOutputPath && !importedReport) {
      throw new Error(
        "T6_ACCEPTANCE_IMPORT_REPORT_MISSING",
      );
    }
    const importedSource = importedReport
      ? importedReportSourceBinding(
          importedReport,
          input.suiteHash,
        )
      : null;
    if (
      importedSource
      && importedSource.sourceCommit
        !== startSource.sourceCommit
    ) {
      throw new Error(
        "T6_ACCEPTANCE_IMPORT_SOURCE_COMMIT_MISMATCH",
      );
    }
    const priorSourceBinding =
      importedSource
      && importedSource.sourceStatusHash
        !== startSource.sourceStatusHash
        ? importedSource
        : null;
    if (priorSourceBinding) {
      if (
        input.arguments.resumePriorStatusHash
          !== priorSourceBinding.sourceStatusHash
      ) {
        throw new Error(
          "T6_ACCEPTANCE_PRIOR_STATUS_HASH_MISMATCH",
        );
      }
    } else if (input.arguments.resumePriorStatusHash) {
      throw new Error(
        "T6_ACCEPTANCE_PRIOR_STATUS_NOT_DISTINCT",
      );
    }
    const sourceBindingUsage = {
      prior: {
        answerCheckpointCount: 0,
        judgmentCheckpointCount: 0,
      },
      active: {
        answerCheckpointCount: 0,
        judgmentCheckpointCount: 0,
      },
    };
    if (importedOutputPath) {
      process.stderr.write(`${JSON.stringify({
        event: "t6-remediation-import-non-web-run",
        sourceRunId:
          input.arguments.importNonWebRunId,
        targetRunId: input.arguments.runId,
        policy:
          "IMPORT_ONLY_CASES_WITHOUT_WEB_SEARCH_CONSENT",
      })}\n`);
    }
    if (priorSourceBinding) {
      process.stderr.write(`${JSON.stringify({
        event: "t6-remediation-source-status-cutover",
        sourceCommit: startSource.sourceCommit,
        priorStatusHash:
          priorSourceBinding.sourceStatusHash,
        activeStatusHash:
          startSource.sourceStatusHash,
        checkpointPolicy:
          "IMPORT_PRIOR_SOURCE_ONLY_FOR_NON_WEB_CASES_AND_SEAL_WEB_WITH_ACTIVE_SOURCE",
      })}\n`);
    }
    if (input.arguments.deferCaseId) {
      process.stderr.write(`${JSON.stringify({
        event: "t6-remediation-execution-order",
        deferredCaseId: input.arguments.deferCaseId,
        caseIds: executionCases.map(
          ({ case: qualityCase }) => qualityCase.id,
        ),
      })}\n`);
    }

    for (const { case: qualityCase } of executionCases) {
      for (
        const arm of firstArmOrder(
          input.suiteHash,
          qualityCase.id,
        )
      ) {
        const order = armOrder(
          input.suiteHash,
          qualityCase.id,
          arm,
        );
        const fingerprintHash = checkpointFingerprint({
          suiteHash: input.suiteHash,
          sourceBinding: startSource,
          modelBinding: binding,
          qualityCase,
          arm,
          order,
        });
        const files = checkpointPaths(
          outputPath,
          qualityCase.id,
          arm,
        );
        let existing = await readJsonIfPresent(files.answer);
        let imported = false;
        if (
          !existing
          && importedOutputPath
          && !qualityCase.webSearchConsent
        ) {
          const importedFiles = checkpointPaths(
            importedOutputPath,
            qualityCase.id,
            arm,
          );
          existing = await readJsonIfPresent(
            importedFiles.answer,
          );
          imported = Boolean(existing);
        }
        let checkpoint: AnswerCheckpoint;
        if (existing) {
          const existingFingerprint =
            typeof existing === "object"
              && existing !== null
              && "fingerprintHash" in existing
              && typeof existing.fingerprintHash === "string"
              ? existing.fingerprintHash
              : null;
          const fingerprintCandidates = [
            {
              hash: fingerprintHash,
              sourceRole: "active" as const,
              modelRole: "active" as const,
            },
            ...(priorBinding
              ? [{
                  hash: checkpointFingerprint({
                    suiteHash: input.suiteHash,
                    sourceBinding: startSource,
                    modelBinding: priorBinding,
                    qualityCase,
                    arm,
                    order,
                  }),
                  sourceRole: "active" as const,
                  modelRole: "prior" as const,
                }]
              : []),
            ...(priorSourceBinding
              ? [{
                  hash: checkpointFingerprint({
                    suiteHash: input.suiteHash,
                    sourceBinding: priorSourceBinding,
                    modelBinding: binding,
                    qualityCase,
                    arm,
                    order,
                  }),
                  sourceRole: "prior" as const,
                  modelRole: "active" as const,
                }]
              : []),
            ...(priorSourceBinding && priorBinding
              ? [{
                  hash: checkpointFingerprint({
                    suiteHash: input.suiteHash,
                    sourceBinding: priorSourceBinding,
                    modelBinding: priorBinding,
                    qualityCase,
                    arm,
                    order,
                  }),
                  sourceRole: "prior" as const,
                  modelRole: "prior" as const,
                }]
              : []),
          ];
          const acceptedFingerprint =
            fingerprintCandidates.find(
              ({ hash }) => hash === existingFingerprint,
            );
          if (!acceptedFingerprint) {
            throw new Error(
              "T6_ACCEPTANCE_CHECKPOINT_FINGERPRINT_MISMATCH",
            );
          }
          checkpoint = parseAnswerCheckpoint(
            existing,
            acceptedFingerprint.hash,
          );
          bindingUsage[
            acceptedFingerprint.modelRole
          ].answerCheckpointCount += 1;
          sourceBindingUsage[
            acceptedFingerprint.sourceRole
          ].answerCheckpointCount += 1;
          checkpointSourceRoles.set(
            `${qualityCase.id}:${arm}`,
            acceptedFingerprint.sourceRole,
          );
          completedCalls += 1;
          process.stdout.write(`${JSON.stringify({
            status: imported
              ? "ANSWER_IMPORTED"
              : "ANSWER_REUSED",
            caseId: qualityCase.id,
            arm,
            completedCalls,
            totalCalls,
          })}\n`);
        } else {
          activeEvaluationStage = {
            kind: "ANSWER",
            caseId: qualityCase.id,
            arm,
          };
          const execution = await runAnswer({
            connection,
            runtime,
            adapter,
            policy,
            ai: evaluationAi,
            artworkRoot,
            qualityCase,
            arm,
            evidenceSearchV2: baseEvidenceSearch,
            webSearchAdapter:
              qualityCase.webSearchConsent
                ? webSearchAdapter
                : undefined,
          });
          activeEvaluationStage = null;
          checkpoint = {
            schemaVersion: 1,
            kind: "T6_REMEDIATION_ANSWER",
            fingerprintHash,
            caseId: qualityCase.id,
            arm,
            order,
            modelBinding: binding,
            ...execution,
          };
          await writeSealedJson({
            filePath: files.answer,
            value: checkpoint,
            configuredSecret,
          });
          bindingUsage.active.answerCheckpointCount += 1;
          sourceBindingUsage.active
            .answerCheckpointCount += 1;
          checkpointSourceRoles.set(
            `${qualityCase.id}:${arm}`,
            "active",
          );
          completedCalls += 1;
          process.stdout.write(`${JSON.stringify({
            status: "ANSWER_CHECKPOINTED",
            caseId: qualityCase.id,
            arm,
            aiMode: checkpoint.observation.aiMode,
            v2Status: checkpoint.observation.v2.status,
            completedCalls,
            totalCalls,
          })}\n`);
        }
        answerCheckpoints.set(
          `${qualityCase.id}:${arm}`,
          checkpoint,
        );
      }

      for (
        const arm of firstArmOrder(
          input.suiteHash,
          qualityCase.id,
        )
      ) {
        const answerCheckpoint = answerCheckpoints.get(
          `${qualityCase.id}:${arm}`,
        )!;
        const files = checkpointPaths(
          outputPath,
          qualityCase.id,
          arm,
        );
        let existing = await readJsonIfPresent(files.judgment);
        let imported = false;
        if (
          !existing
          && importedOutputPath
          && !qualityCase.webSearchConsent
        ) {
          const importedFiles = checkpointPaths(
            importedOutputPath,
            qualityCase.id,
            arm,
          );
          existing = await readJsonIfPresent(
            importedFiles.judgment,
          );
          imported = Boolean(existing);
        }
        let checkpoint: JudgmentCheckpoint;
        if (existing) {
          checkpoint = parseJudgmentCheckpoint(
            existing,
            answerCheckpoint.fingerprintHash,
          );
          if (
            checkpoint.modelBinding?.endpointHash
              === binding.endpointHash
            || !priorBinding
          ) {
            bindingUsage.active.judgmentCheckpointCount += 1;
          } else {
            bindingUsage.prior.judgmentCheckpointCount += 1;
          }
          sourceBindingUsage[
            checkpointSourceRoles.get(
              `${qualityCase.id}:${arm}`,
            ) ?? "active"
          ].judgmentCheckpointCount += 1;
          completedCalls += 1;
          process.stdout.write(`${JSON.stringify({
            status: imported
              ? "JUDGMENT_IMPORTED"
              : "JUDGMENT_REUSED",
            caseId: qualityCase.id,
            arm,
            completedCalls,
            totalCalls,
          })}\n`);
        } else {
          let judgment: TutorQualityJudgment | null = null;
          let errorCode: string | null = null;
          try {
            activeEvaluationStage = {
              kind: "JUDGMENT",
              caseId: qualityCase.id,
              arm,
            };
            judgment = await judgeTutorQualityAnswer({
              adapter,
              qualityCase,
              answer: answerCheckpoint.observedAnswer,
              suite: judgeSuite(input.suite),
            });
            activeEvaluationStage = null;
          } catch (error) {
            const failure = tutorQualityServiceFailure(error);
            if (failure) throw error;
            activeEvaluationStage = null;
            errorCode = safeError(error);
          }
          checkpoint = {
            schemaVersion: 1,
            kind: "T6_REMEDIATION_JUDGMENT",
            fingerprintHash:
              answerCheckpoint.fingerprintHash,
            caseId: qualityCase.id,
            arm,
            modelBinding: binding,
            judgment,
            errorCode,
          };
          await writeSealedJson({
            filePath: files.judgment,
            value: checkpoint,
            configuredSecret,
          });
          bindingUsage.active.judgmentCheckpointCount += 1;
          sourceBindingUsage.active
            .judgmentCheckpointCount += 1;
          completedCalls += 1;
          process.stdout.write(`${JSON.stringify({
            status: "JUDGMENT_CHECKPOINTED",
            caseId: qualityCase.id,
            arm,
            judgmentValid: Boolean(judgment),
            errorCode,
            completedCalls,
            totalCalls,
          })}\n`);
        }
        judgmentCheckpoints.set(
          `${qualityCase.id}:${arm}`,
          checkpoint,
        );
      }
    }

    const finishSource = readReleaseSourceBinding();
    const finishSuite = loadT6RemediationAcceptanceSuite(
      path.resolve(SUITE_PATH),
    );
    if (
      !sameReleaseSourceBinding(startSource, finishSource)
      || finishSuite.suiteHash !== input.suiteHash
    ) {
      throw new Error(
        "T6_ACCEPTANCE_SOURCE_CHANGED_DURING_RUN",
      );
    }
    const results = input.suite.cases.flatMap(
      ({ case: qualityCase }) =>
        (["LEGACY_V1", "SELF_HOSTED_V2"] as const)
          .map((arm) => resultFromCheckpoints(
            answerCheckpoints.get(
              `${qualityCase.id}:${arm}`,
            )!,
            judgmentCheckpoints.get(
              `${qualityCase.id}:${arm}`,
            )!,
          )),
    );
    const report = buildT6RemediationAcceptanceReport({
      suite: input.suite,
      suiteHash: input.suiteHash,
      fixture: false,
      sourceBinding: {
        commit: startSource.sourceCommit,
        statusHash: startSource.sourceStatusHash,
      },
      ...(priorSourceBinding
        ? {
            sourceBindingHistory: [
              {
                role: "PRIOR" as const,
                sourceBinding: {
                  commit:
                    priorSourceBinding.sourceCommit,
                  statusHash:
                    priorSourceBinding.sourceStatusHash,
                },
                ...sourceBindingUsage.prior,
              },
              {
                role: "ACTIVE" as const,
                sourceBinding: {
                  commit: startSource.sourceCommit,
                  statusHash:
                    startSource.sourceStatusHash,
                },
                ...sourceBindingUsage.active,
              },
            ],
          }
        : {}),
      modelBinding: binding,
      ...(priorBinding
        ? {
            modelBindingHistory: [
              {
                role: "PRIOR" as const,
                modelBinding: priorBinding,
                ...bindingUsage.prior,
              },
              {
                role: "ACTIVE" as const,
                modelBinding: binding,
                ...bindingUsage.active,
              },
            ],
          }
        : {}),
      webResearchBinding: {
        mode:
          rawWebSearchAdapter.protocol
            === "DEEPSEEK_ANTHROPIC"
            ? "SEPARATE_ANTHROPIC_COMPATIBLE_HOSTED_WEB" as const
            : "SEPARATE_OPENAI_COMPATIBLE_HOSTED_WEB" as const,
        provider:
          rawWebSearchAdapter.protocol
            === "DEEPSEEK_ANTHROPIC"
            ? "DEEPSEEK" as const
            : "OPENAI_COMPATIBLE" as const,
        modelId: webSearchBinding.modelId,
        endpointHash:
          webSearchBinding.endpointHash,
        inferenceHash:
          webSearchBinding.inferenceHash,
        caseIds: input.suite.cases
          .filter(({ case: qualityCase }) =>
            qualityCase.webSearchConsent)
          .map(({ case: qualityCase }) =>
            qualityCase.id)
          .sort(),
      },
      results,
    });
    const reportText = `${JSON.stringify(report, null, 2)}\n`;
    assertEvaluationTextSafe(
      reportText,
      configuredSecret,
      "T6_ACCEPTANCE_REPORT_SENSITIVE_TEXT",
    );
    if (report.decision === "T6_REMEDIATION_AUTOMATED_GO") {
      await writeBlindReviewPack({
        outputPath,
        suite: input.suite,
        suiteHash: input.suiteHash,
        results,
        configuredSecret,
      });
    }
    await writeFile(outputPath, reportText, {
      encoding: "utf8",
      flag: "wx",
    });
    process.stdout.write(`${JSON.stringify({
      status: "COMPLETE",
      fixture: false,
      suiteHash: report.suiteHash,
      caseCount: report.cases.length,
      gates: report.gates,
      metrics: report.metrics,
      modelBindingHistory:
        report.modelBindingHistory,
      sourceBindingHistory:
        report.sourceBindingHistory,
      webResearchBinding:
        report.webResearchBinding,
      decision: report.decision,
      t7: report.t7,
      reportPath: outputPath,
      blindReviewCreated:
        report.decision ===
        "T6_REMEDIATION_AUTOMATED_GO",
    })}\n`);
    if (!report.gates.allPassed) process.exitCode = 1;
  } catch (error) {
    const failure = tutorQualityServiceFailure(error);
    if (failure) {
      const modelError =
        error instanceof ModelServiceError
          ? error
          : null;
      process.stderr.write(`${JSON.stringify({
        event: "t6-remediation-service-failure",
        runId: input.arguments.runId,
        stage: activeEvaluationStage,
        code: modelError?.code ?? failure.code,
        httpStatus:
          modelError?.httpStatus ?? null,
        transportCode:
          modelError?.transportCode ?? null,
        protocolCode:
          modelError?.protocolCode ?? null,
        resumable: failure.resumable,
      })}\n`);
      process.stdout.write(`${JSON.stringify({
        status: failure.resumable
          ? "MODEL_UNAVAILABLE"
          : "MODEL_PROVIDER_REJECTED",
        errorCode: failure.code,
        resumable: failure.resumable,
        runId: input.arguments.runId,
      })}\n`);
      process.exitCode = failure.resumable ? 75 : 1;
      return;
    }
    throw error;
  } finally {
    connection?.sqlite.close();
    await disposeAgentEvidenceRuntimeV2().catch(() => undefined);
    await rm(workRoot, { recursive: true, force: true });
    if (previousV3 === undefined) {
      delete process.env.AGENT_V3_ENABLED;
    } else {
      process.env.AGENT_V3_ENABLED = previousV3;
    }
    if (previousNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, "NODE_ENV");
    } else {
      Object.assign(process.env, {
        NODE_ENV: previousNodeEnv,
      });
    }
  }
}

async function runFixture(input: {
  arguments: Arguments;
  suite: T6RemediationAcceptanceSuite;
  suiteHash: string;
}) {
  const report = buildT6RemediationAcceptanceReport(
    createT6RemediationAcceptanceFixtureInput({
      suite: input.suite,
      suiteHash: input.suiteHash,
    }),
  );
  const outputPath = path.resolve(input.arguments.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(report, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  process.stdout.write(`${JSON.stringify({
    fixture: report.fixture,
    suiteHash: report.suiteHash,
    caseCount: report.cases.length,
    gates: report.gates,
    decision: report.decision,
    t7: report.t7,
    reportPath: outputPath,
  })}\n`);
  if (!report.gates.allPassed) process.exitCode = 1;
}

async function main() {
  const arguments_ = parseT6RemediationAcceptanceArguments(
    process.argv.slice(2),
  );
  const { suite, suiteHash } =
    loadT6RemediationAcceptanceSuite(
      path.resolve(SUITE_PATH),
    );
  if (arguments_.fixture) {
    await runFixture({
      arguments: arguments_,
      suite,
      suiteHash,
    });
    return;
  }
  await runRealModel({
    arguments: arguments_,
    suite,
    suiteHash,
  });
}

const invokedPath = process.argv[1]
  ? path.resolve(process.argv[1])
  : null;
if (
  invokedPath === path.resolve(
    "scripts/run-t6-remediation-acceptance.ts",
  )
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${safeError(error)}\n`,
    );
    process.exitCode = 1;
  });
}
