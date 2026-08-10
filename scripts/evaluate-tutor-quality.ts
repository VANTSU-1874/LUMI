import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { ModelServiceError, type ModelResponseOptions } from "@/lib/ai/client";
import { isGpt56ModelId } from "@/lib/ai/model-id";
import { prepareAgentArtwork, type PreparedAgentArtwork } from "@/lib/agent/artwork-attachment";
import { externalSearchMessageDigest } from "@/lib/agent/contracts";
import { createDesignTask } from "@/lib/agent/design-project-task";
import {
  AgentEvidenceToolOutputV2Schema,
  type AgentEvidenceSearchPortV2,
} from "@/lib/agent/evidence-tool-v2";
import {
  assertEvaluationTextSafe,
  guardModelProviderSecretOutputs,
  safeEvaluationErrorCode,
} from "@/lib/agent/evaluation-safety";
import type { AgentOptions } from "@/lib/agent/orchestrator-context";
import {
  consoleModelErrorDiagnostics,
  createLocalModelErrorDiagnosticLog,
  createModelErrorDiagnostics,
  type ModelErrorDiagnosticsSnapshot,
} from "@/lib/agent/model-error-diagnostics";
import type { AgentPolicy } from "@/lib/agent/policy-contract";
import {
  readReleaseSourceBinding,
  sameReleaseSourceBinding,
} from "@/lib/agent/release-source-binding";
import {
  createOpenAICompatibleModelProvider,
  type ModelProviderAdapter,
} from "@/lib/agent/model-provider-adapter";
import { CurrentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import {
  buildTutorQualityReport,
  judgeTutorQualityAnswer,
  observedTutorAnswer,
  scoreTutorQualityCase,
  type TutorQualityCaseResult,
  type TutorQualityJudgment,
  type TutorQualityObservedAnswer,
} from "@/lib/agent/tutor-quality-evaluation";
import {
  clearTutorQualityProgress,
  hashTutorQualityProgressFingerprint,
  readTutorQualityProgress,
  tutorQualityProgressMatches,
  writeTutorQualityProgress,
  type TutorQualityProgress,
  type TutorQualityProgressEntry,
  type TutorQualityProgressFingerprint,
} from "@/lib/agent/tutor-quality-progress";
import { runTutorPrivacySentinelProbe } from "@/lib/agent/tutor-quality-privacy-probe";
import {
  parseTutorQualityPrivacyServiceFailure,
  tutorQualityServiceFailure,
  type TutorQualityServiceFailure,
} from "@/lib/agent/tutor-quality-service-interruption";
import {
  loadTutorQualitySuite,
  TUTOR_QUALITY_CASE_COUNT,
  type TutorQualityCase,
} from "@/lib/agent/tutor-quality-suite";
import {
  buildTutorQualityArmAttestation,
  parseTutorQualityRunArguments,
  type TutorQualityKnowledgeArm,
} from "@/lib/agent/tutor-quality-ab";
import {
  getActiveAgentPolicy,
  resolveAgentPolicyTimeouts,
} from "@/lib/agent/policy-registry";
import { readEnv } from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
  writeEffectiveDatabaseConfigNotice,
  writeEffectiveModelConfigNotice,
} from "@/lib/config/runtime-environment";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import {
  agentEvidenceRuntimeProfileV2,
  disposeAgentEvidenceRuntimeV2,
  getFixedAgentEvidenceSearchPortV2ForAudit,
} from "@/lib/knowledge/agent-evidence-runtime-v2";

const CLASS_ID = "demo-class-tutor-quality";
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
const SAFE_TUTOR_QUALITY_ERROR_CODES = [
  "TUTOR_QUALITY_ANSWER_MISSING",
  "TUTOR_QUALITY_ARGUMENT_DUPLICATE",
  "TUTOR_QUALITY_ARGUMENT_UNKNOWN",
  "TUTOR_QUALITY_ARTWORK_DIMENSION_MISMATCH",
  "TUTOR_QUALITY_ARTWORK_HASH_MISMATCH",
  "TUTOR_QUALITY_ARTWORK_JUDGE_REQUIRES_VISION",
  "TUTOR_QUALITY_JUDGE_INVALID_JSON",
  "TUTOR_QUALITY_JUDGE_INVALID_TOOL_RESPONSE",
  "TUTOR_QUALITY_JUDGE_REQUIRES_NATIVE_RESPONSE",
  "TUTOR_QUALITY_KNOWLEDGE_ARM_INVALID",
  "TUTOR_QUALITY_KNOWLEDGE_ARM_MISSING",
  "TUTOR_QUALITY_PROGRESS_CASE_ORDER_MISMATCH",
  "TUTOR_QUALITY_PROGRESS_FINGERPRINT_MISMATCH",
  "TUTOR_QUALITY_PROGRESS_SENSITIVE_TEXT_DETECTED",
  "TUTOR_QUALITY_REPORT_CASE_ORDER_MISMATCH",
  "TUTOR_QUALITY_REPORT_RUBRIC_VERSION_MISMATCH",
  "TUTOR_QUALITY_REPORT_SENSITIVE_TEXT_DETECTED",
  "TUTOR_QUALITY_REPORT_SUITE_VERSION_MISMATCH",
  "TUTOR_QUALITY_REQUIRES_GPT_5_6",
  "TUTOR_QUALITY_REQUIRES_MODEL_CONFIG",
  "TUTOR_QUALITY_REQUIRES_VISION_ENABLED",
  "TUTOR_QUALITY_RESULT_INCOMPLETE",
  "TUTOR_QUALITY_SOURCE_CHANGED_DURING_RUN",
] as const;

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function safeError(error: unknown) {
  return safeEvaluationErrorCode(
    error,
    "TUTOR_QUALITY_EXECUTION_FAILED",
    SAFE_TUTOR_QUALITY_ERROR_CODES,
  );
}

function rateLimitCooldown(error: unknown) {
  return error instanceof ModelServiceError && error.code === "RATE_LIMIT"
    ? error.retryAfterMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS
    : 0;
}

function fixtureJudgment(): TutorQualityJudgment {
  return {
    schemaVersion: 1,
    scores: {
      specificityAndUsefulness: 5,
      professionalCorrectness: 5,
      executableFirstStep: 5,
      followUpJudgment: 5,
      sourceAndUncertainty: 5,
    },
    hardFailures: {
      AUTHORITY_OVERREACH: { occurred: false, evidence: null },
      FABRICATED_SOURCE: { occurred: false, evidence: null },
      PRIVACY_LEAK: { occurred: false, evidence: null },
    },
    rationale: "Fixture 只验证评审管线、严格解析和报告派生，不代表真实回答质量。",
    evidence: ["fixture returned one schema-valid judgment tool call"],
  };
}

function createTutorQualityFixtureEvidencePort():
  AgentEvidenceSearchPortV2 {
  return {
    async search(input) {
      input.signal.throwIfAborted();
      const suffix = input.coursePackId
        .replace(/[^a-z0-9-]/g, "-")
        .slice(0, 40);
      return AgentEvidenceToolOutputV2Schema.parse({
        schemaVersion: 2,
        kind: "KNOWLEDGE_MAP_SEARCH_EVIDENCE",
        bundle: {
          bundleId: `fixture-bundle-${suffix}`,
          status: "SUCCESS",
          queryHash: sha256(input.query),
          corpusBundleHash: "a".repeat(64),
          activeIndexBundleHash: "b".repeat(64),
          capabilitiesLost: [],
        },
        channels: [
          {
            channel: "LEXICAL",
            status: "SUCCESS",
            hitCount: 1,
            indexVersionId: "fixture-lexical",
            modelId: null,
            modelRevision: null,
          },
          {
            channel: "TEXT_VECTOR",
            status: "SUCCESS",
            hitCount: 1,
            indexVersionId: "fixture-text-vector",
            modelId: "fixture-bge",
            modelRevision: "fixture-revision",
          },
          {
            channel: "VISUAL_VECTOR",
            status: "EMPTY",
            hitCount: 0,
            indexVersionId: "fixture-visual-vector",
            modelId: "fixture-siglip",
            modelRevision: "fixture-revision",
          },
        ],
        evidence: {
          nodes: [{
            nodeId: `fixture-node-${suffix}`,
            objectId: `fixture-object-${suffix}`,
            sourceId: `fixture-source-${suffix}`,
            kind: "TEXT",
            relation: "PRIMARY",
            evidenceKind: "KNOWLEDGE_FACT",
            excerpt:
              "Fixture 课程证据只验证 V2 工具链进入回答上下文，不代表真实专业结论。",
            assetId: null,
          }],
          assets: [],
          regions: [],
          sources: [{
            sourceId: `fixture-source-${suffix}`,
            objectId: `fixture-object-${suffix}`,
            title: "Tutor quality V2 fixture",
            authority: "COURSE_DESIGN",
            verifiedDate: "2026-07-30",
            scope:
              "仅验证 T6 A/B 运行臂与来源留痕。",
          }],
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
    },
  };
}

function createTutorQualityFixtureAdapter(): ModelProviderAdapter {
  return {
    provider: "TEST",
    modelId: "gpt-5.6-fixture",
    capabilities: { vision: true, webSearch: true },
    async complete() {
      return "这是本地 fixture 的合成回答；不包含真实学生数据，也不构成质量验收证据。";
    },
    async respond(messages, options?: ModelResponseOptions) {
      if (
        options?.structuredOutput?.name
          === "lumi_rag_source_attribution_v1"
      ) {
        const repair = JSON.parse(
          messages.findLast(
            ({ role }) => role === "user",
          )?.content ?? "{}",
        ) as {
          allowedEvidenceNodeIds?: unknown;
        };
        return {
          content: JSON.stringify({
            sourceIds: Array.isArray(
              repair.allowedEvidenceNodeIds,
            )
              ? repair.allowedEvidenceNodeIds
                .filter(
                  (value): value is string =>
                    typeof value === "string",
                )
              : [],
          }),
          toolCalls: [],
        };
      }
      const judgeTool = options?.tools?.find(({ name }) => name === "submit_tutor_quality_judgment");
      if (judgeTool) {
        return {
          content: null,
          toolCalls: [{
            id: `fixture-judge-${randomUUID()}`,
            name: judgeTool.name,
            arguments: JSON.stringify(fixtureJudgment()),
          }],
        };
      }
      if (options?.hostedTools?.some(({ type }) => type === "web_search")) {
        const content = "Fixture 公开资料检索结果：请以材料生产商技术数据表和窑炉厂商安全指南为准。";
        return {
          content,
          toolCalls: [],
          webSearch: {
            status: "SUCCEEDED",
            citations: [{
              url: "https://example.com/fixture-ceramic-guide",
              title: "Fixture ceramic technical guide",
              startIndex: 0,
              endIndex: content.length,
            }],
          },
        };
      }
      const toolNames = new Set(options?.tools?.map(({ name }) => name) ?? []);
      const serializedMessages = JSON.stringify(messages);
      const toolMessages = messages.filter(
        ({ role }) => role === "tool",
      );
      const hasToolObservation =
        toolMessages.length > 0;
      const hasEvidenceObservation =
        toolMessages.some(({ content }) =>
          content?.includes(
            "KNOWLEDGE_MAP_SEARCH_EVIDENCE",
          ) ?? false);
      const expectedObservationsBeforeSpecialTool =
        hasEvidenceObservation ? 1 : 0;
      const evidenceTool = options?.tools?.find(
        ({ name }) =>
          name.includes("search-evidence"),
      );
      if (
        !hasToolObservation
        && options?.toolChoice === "required"
        && evidenceTool
      ) {
        return {
          content: null,
          toolCalls: [{
            id: `fixture-evidence-${randomUUID()}`,
            name: evidenceTool.name,
            arguments: JSON.stringify({
              query: "当前仿真问题的课程证据",
            }),
          }],
        };
      }
      if (
        toolMessages.length
          === expectedObservationsBeforeSpecialTool
        && toolNames.has("tool_design-calculator_compute")
        && /#777777/i.test(serializedMessages)
        && /#FFFFFF/i.test(serializedMessages)
      ) {
        return {
          content: null,
          toolCalls: [{
            id: `fixture-calculator-${randomUUID()}`,
            name: "tool_design-calculator_compute",
            arguments: JSON.stringify({
              calculation: { kind: "COLOR_CONTRAST", foreground: "#777777", background: "#FFFFFF" },
            }),
          }],
        };
      }
      if (
        toolMessages.length
          === expectedObservationsBeforeSpecialTool
        && toolNames.has("tool_external-web_search")
      ) {
        return {
          content: null,
          toolCalls: [{
            id: `fixture-web-${randomUUID()}`,
            name: "tool_external-web_search",
            arguments: "{}",
          }],
        };
      }
      return {
        content: [
          "先把当前困惑拆成一个可以观察的设计变量，再做一份小范围 A/B 对照。",
          "第一步：复制当前版本，只改一个最影响观看顺序的变量，并在相同距离下比较。",
          "这只是管线 fixture 的合成正文；真实质量必须由同模型正式运行和人工场景验证。",
        ].join("\n\n"),
        toolCalls: [],
      };
    },
    async completeWithImage() {
      return "我只在本地 fixture 中确认图片输入管线存在，不对画面质量作真实判断。";
    },
  };
}

function insertSyntheticStudent(connection: DatabaseConnection, index: number) {
  const studentId = `demo-student-quality-${String(index + 1).padStart(2, "0")}`;
  connection.sqlite.prepare(`
    INSERT INTO users(id,class_id,role,alias,created_at)
    VALUES(?,?, 'STUDENT', ?, ?)
  `).run(studentId, CLASS_ID, `质量评测学生 ${index + 1}`, Math.floor(Date.now() / 1_000));
  return { userId: studentId, role: "STUDENT" as const };
}

async function prepareCaseArtwork(qualityCase: TutorQualityCase) {
  const fixture = qualityCase.artworkFixture;
  if (!fixture) return undefined;
  const bytes = new Uint8Array(await readFile(path.resolve(fixture.path)));
  if (sha256(bytes) !== fixture.sha256) throw new Error("TUTOR_QUALITY_ARTWORK_HASH_MISMATCH");
  const artwork = await prepareAgentArtwork({ bytes, declaredMime: fixture.mimeType });
  if (artwork.width !== fixture.width || artwork.height !== fixture.height) {
    throw new Error("TUTOR_QUALITY_ARTWORK_DIMENSION_MISMATCH");
  }
  return artwork;
}

type TutorQualityAnswerExecution = {
  answer: TutorQualityObservedAnswer | null;
  artwork: PreparedAgentArtwork | undefined;
  rateLimitMs: number;
  modelErrors: string[];
  serviceFailure: TutorQualityServiceFailure | null;
  diagnostics: ModelErrorDiagnosticsSnapshot;
};

async function runCaseAnswer(input: {
  connection: DatabaseConnection;
  runtime: CurrentAgentRuntime;
  adapter: ModelProviderAdapter;
  policy: AgentPolicy;
  ai?: AgentOptions["ai"];
  qualityCase: TutorQualityCase;
  index: number;
  artworkRoot: string;
  knowledgeArm:
    TutorQualityKnowledgeArm | null;
  evidenceSearchV2?:
    AgentEvidenceSearchPortV2;
}): Promise<TutorQualityAnswerExecution> {
  const actor = insertSyntheticStudent(input.connection, input.index);
  const task = createDesignTask(input.connection, actor, {
    title: `质量题 ${input.qualityCase.id}`,
  });
  const modelErrors: string[] = [];
  const diagnostics = createModelErrorDiagnostics({
    redactValues: [input.ai?.apiKey, input.ai?.baseUrl],
  });
  let rateLimitMs = 0;
  let serviceFailure: TutorQualityServiceFailure | null = null;
  const onModelError = (error: unknown, attempt: number) => {
    if (error instanceof ModelServiceError) diagnostics.record(error);
    const code = error instanceof ModelServiceError ? error.code : "MODEL_ERROR";
    modelErrors.push(`attempt-${attempt}:${code}:${safeError(error)}`.slice(0, 240));
    rateLimitMs = Math.max(rateLimitMs, rateLimitCooldown(error));
    serviceFailure ??= tutorQualityServiceFailure(error);
  };
  const options: AgentOptions = {
    modelProviderAdapter: input.adapter,
    policy: input.policy,
    ...(input.ai ? { ai: input.ai } : {}),
    artworkRoot: input.artworkRoot,
    onModelError,
    knowledgeObjectV2Enabled:
      input.knowledgeArm === "SELF_HOSTED_V2",
    ...(input.evidenceSearchV2
      ? {
          evidenceSearchV2:
            input.evidenceSearchV2,
        }
      : {}),
  };
  for (const prelude of input.qualityCase.prelude) {
    const response = await input.runtime.run({
      connection: input.connection,
      actor,
      input: {
        taskId: task.id,
        message: prelude.message,
        context: { view: prelude.view },
      },
      options,
    });
    if (rateLimitMs > 0) {
      return {
        answer: null,
        artwork: undefined,
        rateLimitMs,
        modelErrors,
        serviceFailure: null,
        diagnostics: diagnostics.snapshot(),
      };
    }
    if (response.aiMode !== "MODEL_ASSISTED" && serviceFailure) {
      return {
        answer: null,
        artwork: undefined,
        rateLimitMs,
        modelErrors,
        serviceFailure,
        diagnostics: diagnostics.snapshot(),
      };
    }
  }
  const artwork = await prepareCaseArtwork(input.qualityCase);
  const externalSearchConsent = input.qualityCase.webSearchConsent ? {
    nonce: randomUUID(),
    messageDigest: externalSearchMessageDigest(input.qualityCase.question),
    issuedAt: Date.now(),
  } : undefined;
  const started = performance.now();
  const response = await input.runtime.run({
    connection: input.connection,
    actor,
    input: {
      taskId: task.id,
      message: input.qualityCase.question,
      context: { view: input.qualityCase.view },
      ...(externalSearchConsent ? { externalSearchConsent } : {}),
    },
    options,
    artwork,
  });
  if (rateLimitMs > 0) {
    return {
      answer: null,
      artwork,
      rateLimitMs,
      modelErrors,
      serviceFailure: null,
      diagnostics: diagnostics.snapshot(),
    };
  }
  if (response.aiMode !== "MODEL_ASSISTED" && serviceFailure) {
    return {
      answer: null,
      artwork,
      rateLimitMs,
      modelErrors,
      serviceFailure,
      diagnostics: diagnostics.snapshot(),
    };
  }
  return {
    answer: observedTutorAnswer(response, performance.now() - started, modelErrors),
    artwork,
    rateLimitMs,
    modelErrors,
    serviceFailure: null,
    diagnostics: diagnostics.snapshot(),
  };
}

function missingAnswerResult(caseId: string, error: unknown) {
  return scoreTutorQualityCase({
    caseId,
    answer: null,
    judgment: null,
    answerError: safeError(error),
    judgeError: "JUDGE_SKIPPED_WITHOUT_ANSWER",
  });
}

function judgedResult(
  qualityCase: TutorQualityCase,
  answer: TutorQualityObservedAnswer,
  judgment: TutorQualityJudgment | null,
  judgeError: string | null,
) {
  return scoreTutorQualityCase({
    caseId: qualityCase.id,
    answer,
    judgment,
    judgeError,
  });
}

function assertProgressOrder(entries: readonly TutorQualityProgressEntry[], cases: readonly TutorQualityCase[]) {
  entries.forEach((entry, index) => {
    if (entry.caseId !== cases[index]?.id) throw new Error("TUTOR_QUALITY_PROGRESS_CASE_ORDER_MISMATCH");
  });
}

async function atomicLatest(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function main() {
  const runArguments =
    parseTutorQualityRunArguments(
      process.argv.slice(2),
    );
  const {
    fixture,
    restart,
    knowledgeArm,
  } = runArguments;
  const loadedEnvironment = fixture
    ? null
    : await loadRuntimeEnvironment({ mode: "SERVICE_OPTIONAL", nodeEnv: "test" });
  const environment: Record<string, string | undefined> = fixture
    ? { ...process.env, NODE_ENV: "test" }
    : loadedEnvironment!.environment;
  const config = fixture ? null : readEnv(environment);
  if (config && loadedEnvironment) {
    writeEffectiveModelConfigNotice(config, loadedEnvironment.provenance);
    writeEffectiveDatabaseConfigNotice(
      config,
      loadedEnvironment.provenance,
      loadedEnvironment.environment,
    );
  }
  if (!fixture && !config?.ai.enabled) throw new Error("TUTOR_QUALITY_REQUIRES_MODEL_CONFIG");
  const modelId = fixture ? "gpt-5.6-fixture" : config!.ai.model!;
  const configuredSecret = fixture ? undefined : config!.ai.apiKey!;
  if (!isGpt56ModelId(modelId)) throw new Error("TUTOR_QUALITY_REQUIRES_GPT_5_6");
  if (!fixture && !config!.ai.vision) throw new Error("TUTOR_QUALITY_REQUIRES_VISION_ENABLED");
  const evaluationPolicy = fixture
    ? getActiveAgentPolicy()
    : resolveAgentPolicyTimeouts(
        getActiveAgentPolicy(),
        config!.agentTimeouts.evaluation,
      );

  const startSource = readReleaseSourceBinding();
  const comparisonMode = fixture
    ? "FIXTURE_VALIDATION" as const
    : startSource.sourceTrackedTreeClean
      ? "REAL_MODEL_BASELINE" as const
      : "DEVELOPMENT_CHECK" as const;
  const inferenceConfig = fixture ? {
    providerMode: "TEST" as const,
    modelId,
    endpointHash: sha256("fixture://tutor-quality"),
    retrievalModelId: null,
    maxOutputTokens: null,
    modelIdleTimeoutMs: null,
    modelTotalTimeoutMs: null,
    turnTotalTimeoutMs: null,
    vision: true,
  } : {
    providerMode: "OPENAI_COMPATIBLE" as const,
    modelId,
    endpointHash: sha256(new URL(config!.ai.baseUrl!).toString()),
    retrievalModelId: config!.ai.embeddingModel ?? null,
    maxOutputTokens: config!.ai.maxOutputTokens,
    modelIdleTimeoutMs: config!.agentTimeouts.evaluation.modelIdleTimeoutMs,
    modelTotalTimeoutMs: config!.agentTimeouts.evaluation.modelTotalTimeoutMs,
    turnTotalTimeoutMs: config!.agentTimeouts.evaluation.turnTotalTimeoutMs,
    vision: config!.ai.vision,
  };
  const runtime = new CurrentAgentRuntime();
  const adapter = fixture
    ? createTutorQualityFixtureAdapter()
    : guardModelProviderSecretOutputs(createOpenAICompatibleModelProvider({
        baseUrl: config!.ai.baseUrl!,
        apiKey: config!.ai.apiKey!,
        model: modelId,
        maxOutputTokens: config!.ai.maxOutputTokens,
        idleTimeoutMs: evaluationPolicy.budgets.modelIdleTimeoutMs,
        totalTimeoutMs: evaluationPolicy.budgets.modelTimeoutMs,
        vision: config!.ai.vision,
      }), configuredSecret!);
  const suitePath = path.resolve("tests/tutor-quality/golden-suite.json");
  const { suite, suiteHash } = loadTutorQualitySuite(suitePath);
  const runtimeRoot = path.resolve(".runtime/tutor-quality");
  const reportPath = path.resolve(environment.TUTOR_QUALITY_REPORT_PATH?.trim()
    || path.join(runtimeRoot, "latest.json"));
  const progressPath = `${reportPath}.progress.json`;
  const diagnosticLog = createLocalModelErrorDiagnosticLog({
    runner: "tutor-quality",
    environment,
    repositoryRoot: process.cwd(),
  });
  const fingerprint: TutorQualityProgressFingerprint = {
    sourceCommit: startSource.sourceCommit,
    sourceStatusHash: startSource.sourceStatusHash,
    runtimeId: runtime.descriptor.id,
    runtimeVersion: runtime.descriptor.version,
    runtimeGeneration: "V3",
    inferenceConfig,
    suiteVersion: suite.version,
    suiteHash,
    rubricVersion: suite.rubricVersion,
    mode: comparisonMode,
    knowledgeArm,
  };
  if (restart) {
    await clearTutorQualityProgress(progressPath);
  }
  let restored = await readTutorQualityProgress(progressPath, { configuredSecret });
  if (restored && !tutorQualityProgressMatches(restored, fingerprint)) {
    throw new Error("TUTOR_QUALITY_PROGRESS_FINGERPRINT_MISMATCH; run again with --restart");
  }
  if (restored?.cooldownUntil && Date.parse(restored.cooldownUntil) > Date.now()) {
    process.stdout.write(`${JSON.stringify({
      status: "RATE_LIMITED",
      completedCaseCount: restored.entries.filter(({ stage }) => stage === "JUDGED").length,
      caseCount: TUTOR_QUALITY_CASE_COUNT,
      cooldownUntil: restored.cooldownUntil,
    })}\n`);
    process.exitCode = 75;
    return;
  }
  const startedAt = restored?.startedAt ?? new Date().toISOString();
  const entries: TutorQualityProgressEntry[] = [...(restored?.entries ?? [])];
  assertProgressOrder(entries, suite.cases);
  const saveProgress = async (
    status: TutorQualityProgress["status"],
    cooldownUntil: string | null,
  ) => {
    const progress: TutorQualityProgress = {
      schemaVersion: 5,
      fingerprint,
      fingerprintHash: hashTutorQualityProgressFingerprint(fingerprint),
      status,
      startedAt,
      updatedAt: new Date().toISOString(),
      cooldownUntil,
      entries,
    };
    await writeTutorQualityProgress(progressPath, progress, { configuredSecret });
    restored = progress;
  };
  const writeQualityDiagnostics = async (input: {
    stage: "ANSWER" | "JUDGE" | "PRIVACY_SENTINEL";
    caseId?: string;
    outcome: "INTERRUPTED" | "RATE_LIMITED" | "DEGRADED_CONTINUED" | "RECOVERED" | "FAILED_CONTINUED";
    errorCode: string | null;
    diagnostics: ModelErrorDiagnosticsSnapshot;
  }) => {
    const write = await diagnosticLog.append({
      recordedAt: new Date().toISOString(),
      runner: "TUTOR_QUALITY",
      stage: input.stage,
      caseId: input.caseId ?? null,
      outcome: input.outcome,
      errorCode: input.errorCode,
      requestMode: "NON_STREAMING",
      diagnostics: input.diagnostics,
    }, (text) => assertEvaluationTextSafe(
      text,
      configuredSecret,
      "TUTOR_QUALITY_DIAGNOSTIC_SENSITIVE_TEXT_DETECTED",
    ));
    return {
      ...consoleModelErrorDiagnostics(input.diagnostics),
      diagnosticLogStatus: write.status,
      ...(write.path ? { diagnosticLogPath: write.path } : {}),
    };
  };
  const stopForServiceFailure = async (input: {
    failure: TutorQualityServiceFailure;
    stage: "ANSWER" | "JUDGE" | "PRIVACY_SENTINEL";
    caseId?: string;
    diagnostics: ModelErrorDiagnosticsSnapshot;
    diagnosticWrite?: Awaited<ReturnType<typeof writeQualityDiagnostics>>;
  }) => {
    await saveProgress("RUNNING", null);
    const diagnosticWrite = input.diagnosticWrite ?? await writeQualityDiagnostics({
      stage: input.stage,
      ...(input.caseId ? { caseId: input.caseId } : {}),
      outcome: "INTERRUPTED",
      errorCode: input.failure.code,
      diagnostics: input.diagnostics,
    });
    process.stdout.write(`${JSON.stringify({
      status: input.failure.resumable ? "MODEL_UNAVAILABLE" : "MODEL_PROVIDER_REJECTED",
      stage: input.stage,
      ...(input.caseId ? { caseId: input.caseId } : {}),
      errorCode: input.failure.code,
      requestMode: "NON_STREAMING",
      ...diagnosticWrite,
      completedCaseCount: entries.filter(({ stage }) => stage === "JUDGED").length,
    })}\n`);
    process.exitCode = input.failure.resumable ? 75 : 1;
  };

  await mkdir(runtimeRoot, { recursive: true });
  const workRoot = await mkdtemp(path.join(runtimeRoot, "work-"));
  const databasePath = path.join(workRoot, "tutor-quality.sqlite");
  const artworkRoot = path.join(workRoot, "private-artworks");
  let evidenceSearchV2:
    AgentEvidenceSearchPortV2 | undefined;
  const previousV3 = process.env.AGENT_V3_ENABLED;
  const previousNodeEnv = process.env.NODE_ENV;
  Object.assign(process.env, { AGENT_V3_ENABLED: "true", NODE_ENV: "test" });
  try {
    evidenceSearchV2 =
      knowledgeArm === "SELF_HOSTED_V2"
        ? fixture
          ? createTutorQualityFixtureEvidencePort()
          : await getFixedAgentEvidenceSearchPortV2ForAudit()
        : undefined;
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.prepare("INSERT INTO classes(id,name,access_code) VALUES(?,?,?)")
        .run(CLASS_ID, "V3 导师质量评测班", `QUALITY-${randomUUID()}`);
      await ingestCoursePackKnowledge(connection);

      for (let index = 0; index < suite.cases.length; index += 1) {
        const qualityCase = suite.cases[index]!;
        const existing = entries[index];
        if (existing?.stage === "JUDGED") continue;

        let answer: TutorQualityObservedAnswer;
        let artwork: PreparedAgentArtwork | undefined;
        if (existing?.stage === "ANSWERED") {
          answer = existing.answer;
          artwork = await prepareCaseArtwork(qualityCase);
        } else {
          try {
            const execution = await runCaseAnswer({
              connection,
              runtime,
              adapter,
              policy: evaluationPolicy,
              ai: fixture ? undefined : config!.ai,
              qualityCase,
              index,
              artworkRoot,
              knowledgeArm,
              evidenceSearchV2,
            });
            const executionDiagnosticWrite = execution.diagnostics.errorCount > 0
              ? await writeQualityDiagnostics({
                  stage: "ANSWER",
                  caseId: qualityCase.id,
                  outcome: execution.rateLimitMs > 0
                    ? "RATE_LIMITED"
                    : execution.serviceFailure
                      ? "INTERRUPTED"
                      : execution.answer?.aiMode === "DETERMINISTIC_FALLBACK"
                        ? "DEGRADED_CONTINUED"
                        : "RECOVERED",
                  errorCode: execution.serviceFailure?.code
                    ?? execution.modelErrors.at(-1)?.split(":")[1]
                    ?? null,
                  diagnostics: execution.diagnostics,
                })
              : undefined;
            if (execution.rateLimitMs > 0) {
              const cooldownUntil = new Date(Date.now() + execution.rateLimitMs).toISOString();
              await saveProgress("RATE_LIMITED", cooldownUntil);
              process.stdout.write(`${JSON.stringify({
                status: "RATE_LIMITED", stage: "ANSWER", caseId: qualityCase.id, cooldownUntil,
                requestMode: "NON_STREAMING",
                ...(executionDiagnosticWrite ?? {}),
              })}\n`);
              process.exitCode = 75;
              return;
            }
            if (execution.serviceFailure) {
              await stopForServiceFailure({
                failure: execution.serviceFailure,
                stage: "ANSWER",
                caseId: qualityCase.id,
                diagnostics: execution.diagnostics,
                diagnosticWrite: executionDiagnosticWrite,
              });
              return;
            }
            if (!execution.answer) throw new Error("TUTOR_QUALITY_ANSWER_MISSING");
            answer = execution.answer;
            artwork = execution.artwork;
            entries.push({ caseId: qualityCase.id, stage: "ANSWERED", answer });
            await saveProgress("RUNNING", null);
          } catch (error) {
            const diagnostics = createModelErrorDiagnostics({
              redactValues: [configuredSecret, config?.ai.baseUrl],
            });
            if (error instanceof ModelServiceError) diagnostics.record(error);
            const snapshot = diagnostics.snapshot();
            const cooldownMs = rateLimitCooldown(error);
            if (cooldownMs > 0) {
              const diagnosticWrite = await writeQualityDiagnostics({
                stage: "ANSWER",
                caseId: qualityCase.id,
                outcome: "RATE_LIMITED",
                errorCode: error instanceof ModelServiceError ? error.code : null,
                diagnostics: snapshot,
              });
              const cooldownUntil = new Date(Date.now() + cooldownMs).toISOString();
              await saveProgress("RATE_LIMITED", cooldownUntil);
              process.stdout.write(`${JSON.stringify({
                status: "RATE_LIMITED", stage: "ANSWER", caseId: qualityCase.id, cooldownUntil,
                requestMode: "NON_STREAMING",
                ...diagnosticWrite,
              })}\n`);
              process.exitCode = 75;
              return;
            }
            const serviceFailure = tutorQualityServiceFailure(error);
            if (serviceFailure) {
              const diagnosticWrite = await writeQualityDiagnostics({
                stage: "ANSWER",
                caseId: qualityCase.id,
                outcome: "INTERRUPTED",
                errorCode: serviceFailure.code,
                diagnostics: snapshot,
              });
              await stopForServiceFailure({
                failure: serviceFailure,
                stage: "ANSWER",
                caseId: qualityCase.id,
                diagnostics: snapshot,
                diagnosticWrite,
              });
              return;
            }
            await writeQualityDiagnostics({
              stage: "ANSWER",
              caseId: qualityCase.id,
              outcome: "FAILED_CONTINUED",
              errorCode: error instanceof ModelServiceError ? error.code : null,
              diagnostics: snapshot,
            });
            entries.push({
              caseId: qualityCase.id,
              stage: "JUDGED",
              result: missingAnswerResult(qualityCase.id, error),
            });
            await saveProgress("RUNNING", null);
            process.stdout.write(`[${index + 1}/${TUTOR_QUALITY_CASE_COUNT}] ${qualityCase.id}: ANSWER_FAILED\n`);
            continue;
          }
        }

        let judgment: TutorQualityJudgment | null = null;
        let judgeError: string | null = null;
        try {
          judgment = await judgeTutorQualityAnswer({
            adapter,
            qualityCase,
            answer,
            suite,
            artwork: artwork ? {
              mimeType: artwork.mimeType,
              bytes: Uint8Array.from(artwork.bytes),
            } : undefined,
          });
        } catch (error) {
          const diagnostics = createModelErrorDiagnostics({
            redactValues: [configuredSecret, config?.ai.baseUrl],
          });
          if (error instanceof ModelServiceError) diagnostics.record(error);
          const snapshot = diagnostics.snapshot();
          const cooldownMs = rateLimitCooldown(error);
          if (cooldownMs > 0) {
            const diagnosticWrite = await writeQualityDiagnostics({
              stage: "JUDGE",
              caseId: qualityCase.id,
              outcome: "RATE_LIMITED",
              errorCode: error instanceof ModelServiceError ? error.code : null,
              diagnostics: snapshot,
            });
            const cooldownUntil = new Date(Date.now() + cooldownMs).toISOString();
            await saveProgress("RATE_LIMITED", cooldownUntil);
            process.stdout.write(`${JSON.stringify({
              status: "RATE_LIMITED", stage: "JUDGE", caseId: qualityCase.id, cooldownUntil,
              requestMode: "NON_STREAMING",
              ...diagnosticWrite,
            })}\n`);
            process.exitCode = 75;
            return;
          }
          const serviceFailure = tutorQualityServiceFailure(error);
          if (serviceFailure) {
            const diagnosticWrite = await writeQualityDiagnostics({
              stage: "JUDGE",
              caseId: qualityCase.id,
              outcome: "INTERRUPTED",
              errorCode: serviceFailure.code,
              diagnostics: snapshot,
            });
            await stopForServiceFailure({
              failure: serviceFailure,
              stage: "JUDGE",
              caseId: qualityCase.id,
              diagnostics: snapshot,
              diagnosticWrite,
            });
            return;
          }
          await writeQualityDiagnostics({
            stage: "JUDGE",
            caseId: qualityCase.id,
            outcome: "FAILED_CONTINUED",
            errorCode: error instanceof ModelServiceError ? error.code : null,
            diagnostics: snapshot,
          });
          judgeError = safeError(error);
        }
        const result = judgedResult(qualityCase, answer, judgment, judgeError);
        entries[index] = { caseId: qualityCase.id, stage: "JUDGED", result };
        await saveProgress("RUNNING", null);
        process.stdout.write(
          `[${index + 1}/${TUTOR_QUALITY_CASE_COUNT}] ${qualityCase.id}: ${result.passed ? "PASS" : "FAIL"}\n`,
        );
      }

      const results = entries.map((entry): TutorQualityCaseResult => {
        if (entry.stage !== "JUDGED") throw new Error("TUTOR_QUALITY_RESULT_INCOMPLETE");
        return entry.result;
      });
      const privacyDiagnostics = createModelErrorDiagnostics({
        redactValues: [configuredSecret, config?.ai.baseUrl],
      });
      const privacySentinel = await runTutorPrivacySentinelProbe({
        connection,
        runtime,
        upstream: adapter,
        policy: evaluationPolicy,
        classId: CLASS_ID,
        artworkRoot,
        onModelError: (error) => {
          if (error instanceof ModelServiceError) privacyDiagnostics.record(error);
        },
      });
      const privacyRateLimit = privacySentinel.error?.match(/^PRIVACY_PROBE_RATE_LIMITED:(\d+)$/);
      const privacyServiceFailure = parseTutorQualityPrivacyServiceFailure(privacySentinel.error);
      const privacySnapshot = privacyDiagnostics.snapshot();
      if (privacyRateLimit) {
        const privacyDiagnosticWrite = privacySnapshot.errorCount > 0
          ? await writeQualityDiagnostics({
              stage: "PRIVACY_SENTINEL",
              outcome: "RATE_LIMITED",
              errorCode: "RATE_LIMIT",
              diagnostics: privacySnapshot,
            })
          : undefined;
        const cooldownMs = Number(privacyRateLimit[1]) || DEFAULT_RATE_LIMIT_COOLDOWN_MS;
        const cooldownUntil = new Date(Date.now() + cooldownMs).toISOString();
        await saveProgress("RATE_LIMITED", cooldownUntil);
        process.stdout.write(`${JSON.stringify({
          status: "RATE_LIMITED", stage: "PRIVACY_SENTINEL", cooldownUntil,
          requestMode: "NON_STREAMING",
          ...(privacyDiagnosticWrite ?? {}),
        })}\n`);
        process.exitCode = 75;
        return;
      }
      const privacyDiagnosticWrite = privacySnapshot.errorCount > 0
        ? await writeQualityDiagnostics({
            stage: "PRIVACY_SENTINEL",
            outcome: privacyServiceFailure ? "INTERRUPTED" : "FAILED_CONTINUED",
            errorCode: privacyServiceFailure?.code ?? null,
            diagnostics: privacySnapshot,
          })
        : undefined;
      if (privacyServiceFailure) {
        await stopForServiceFailure({
          failure: privacyServiceFailure,
          stage: "PRIVACY_SENTINEL",
          diagnostics: privacySnapshot,
          diagnosticWrite: privacyDiagnosticWrite,
        });
        return;
      }
      const endSource = readReleaseSourceBinding();
      if (!sameReleaseSourceBinding(startSource, endSource)) {
        throw new Error("TUTOR_QUALITY_SOURCE_CHANGED_DURING_RUN");
      }
      const modelBinding = {
        provider: adapter.provider,
        id: modelId,
        endpointHash: inferenceConfig.endpointHash,
        identityVerification: fixture ? "FIXTURE" as const : "CONFIGURED_LABEL_ONLY" as const,
      };
      const report = buildTutorQualityReport({
        suite,
        suiteHash,
        sourceCommit: startSource.sourceCommit,
        sourceStatusHash: startSource.sourceStatusHash,
        sourceTrackedTreeClean: startSource.sourceTrackedTreeClean,
        comparisonMode,
        runtime: {
          id: runtime.descriptor.id,
          version: runtime.descriptor.version,
          generation: "V3",
          entrypoint: "runTutorTurn",
          agentV3Enabled: true,
        },
        inferenceConfig,
        answerModel: modelBinding,
        judgeModel: modelBinding,
        startedAt,
        completedAt: new Date().toISOString(),
        privacySentinel,
        results,
      });
      const reportJson = `${JSON.stringify(report, null, 2)}\n`;
      assertEvaluationTextSafe(
        reportJson,
        configuredSecret,
        "TUTOR_QUALITY_REPORT_SENSITIVE_TEXT_DETECTED",
      );
      const reportDirectory = path.dirname(reportPath);
      const runDirectory = path.join(reportDirectory, "runs");
      await mkdir(runDirectory, { recursive: true });
      const runPath = path.join(
        runDirectory,
        `${Date.now()}-${startSource.sourceCommit.slice(0, 12)}-${comparisonMode.toLowerCase()}.json`,
      );
      await writeFile(runPath, reportJson, { encoding: "utf8", flag: "wx" });
      await atomicLatest(reportPath, reportJson);
      let armAttestationPath: string | null =
        null;
      if (knowledgeArm) {
        const profile =
          knowledgeArm === "SELF_HOSTED_V2"
            ? agentEvidenceRuntimeProfileV2()
            : {
                id:
                  "lumi-legacy-course-knowledge-v1",
                hash: sha256(
                  "lumi-legacy-course-knowledge-v1",
                ),
              };
        const attestation =
          buildTutorQualityArmAttestation({
            knowledgeArm,
            reportText: reportJson,
            report,
            inferenceConfig,
            runtimeProfile: {
              id: profile.id,
              hash: profile.hash,
              verification:
                knowledgeArm === "LEGACY_V1"
                  ? "LEGACY"
                  : fixture
                    ? "FIXTURE"
                    : "PREWARMED",
            },
          });
        armAttestationPath =
          `${reportPath}.arm.json`;
        const attestationJson =
          `${JSON.stringify(
            attestation,
            null,
            2,
          )}\n`;
        assertEvaluationTextSafe(
          attestationJson,
          configuredSecret,
          "TUTOR_QUALITY_REPORT_SENSITIVE_TEXT_DETECTED",
        );
        await atomicLatest(
          armAttestationPath,
          attestationJson,
        );
      }
      await clearTutorQualityProgress(progressPath);
      process.stdout.write(`${JSON.stringify({
        passed: report.passed,
        releaseComparable: report.releaseComparable,
        comparisonMode: report.comparisonMode,
        caseCount: report.caseCount,
        passedCaseCount: report.passedCaseCount,
        passRate: report.passRate,
        dimensionAverages: report.dimensionAverages,
        hardFailureCounts: report.hardFailureCounts,
        privacySentinelPassed: report.privacySentinel.passed,
        reportPath,
        knowledgeArm,
        armAttestationPath,
      })}\n`);
      if (!report.passed) process.exitCode = 1;
    } finally {
      connection.sqlite.close();
    }
  } finally {
    if (previousV3 === undefined) delete process.env.AGENT_V3_ENABLED;
    else process.env.AGENT_V3_ENABLED = previousV3;
    if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: previousNodeEnv });
    if (
      knowledgeArm === "SELF_HOSTED_V2"
      && !fixture
    ) {
      await disposeAgentEvidenceRuntimeV2();
    }
    await rm(workRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${safeError(error)}\n`);
  process.exitCode = 1;
});
