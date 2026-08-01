import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import { ModelServiceError } from "@/lib/ai/client";

import { createDesignTask } from "./design-project-task";
import type { AgentHarnessCaseResult } from "./harness";
import type { ModelProviderAdapter } from "./model-provider-adapter";
import { readAgentConversation } from "./orchestrator";
import type { AgentRuntimePort } from "./runtime/agent-runtime-port";
import { currentAgentRuntime } from "./runtime/current-agent-runtime";
import type { FreshProcessRecoveryResult } from "./runtime-benchmark-restart";
import {
  RuntimeBenchmarkCaseResultSchema,
  type AgentRuntimeBenchmarkSuite,
  type RuntimeBenchmarkCaseResult,
} from "./runtime-benchmark";

function includesNormalized(haystack: string, needle: string) {
  return haystack.normalize("NFKC").toLowerCase().includes(needle.normalize("NFKC").toLowerCase());
}

function safeRuntimeErrorCode(error: unknown) {
  if (error instanceof ModelServiceError) return error.code;
  if (error instanceof Error) {
    if (/^[A-Z][A-Z0-9_:-]{2,80}$/.test(error.message)) return error.message;
    if (/^[A-Z][A-Za-z0-9]{2,80}$/.test(error.name)) return error.name;
  }
  return "UNKNOWN_RUNTIME_ERROR";
}

export function countNovelProfessionalConceptGroups(
  learnerMessage: string,
  professionalAnswer: string,
  conceptGroups: readonly (readonly string[])[],
) {
  return conceptGroups.filter((group) => group.some(
    (term) => !includesNormalized(learnerMessage, term) && includesNormalized(professionalAnswer, term),
  )).length;
}

function result(input: Omit<RuntimeBenchmarkCaseResult, "latencyMs"> & { started: number }) {
  const { started, ...payload } = input;
  return RuntimeBenchmarkCaseResultSchema.parse({
    ...payload,
    latencyMs: Math.max(0, Math.round(performance.now() - started)),
  });
}

function runRuntimeTurn(input: {
  runtime?: AgentRuntimePort;
  connection: DatabaseConnection;
  actor: SessionPayload;
  adapter: ModelProviderAdapter;
  turn: Parameters<AgentRuntimePort["run"]>[0]["input"];
  onModelError?: (error: unknown, attempt: number) => void;
}) {
  return (input.runtime ?? currentAgentRuntime).run({
    connection: input.connection,
    actor: input.actor,
    input: input.turn,
    options: { modelProviderAdapter: input.adapter, onModelError: input.onModelError },
  });
}

export async function runDesignBenchmarkCases(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  suite: AgentRuntimeBenchmarkSuite;
  adapter: ModelProviderAdapter;
  runtime?: AgentRuntimePort;
}) {
  const results: RuntimeBenchmarkCaseResult[] = [];
  for (const benchmarkCase of input.suite.designCases) {
    const started = performance.now();
    try {
      const modelErrors: string[] = [];
      const task = createDesignTask(input.connection, input.actor, { title: benchmarkCase.discipline });
      const response = await runRuntimeTurn({ ...input, turn: {
        taskId: task.id,
        message: benchmarkCase.message,
        context: { view: "AGENT" },
      }, onModelError: (error, attempt) => {
        modelErrors.push(`attempt-${attempt}:${safeRuntimeErrorCode(error)}`);
      } });
      const professionalAnswer = [response.reply.title, response.reply.message, response.reply.whyThisStep].join("\n");
      const answer = [professionalAnswer, response.reply.uncertainty].join("\n");
      const coveredConceptGroups = countNovelProfessionalConceptGroups(
        benchmarkCase.message,
        professionalAnswer,
        benchmarkCase.expected.conceptGroups,
      );
      const failures = [
        response.coursePack.id === "general-design" ? null : `COURSE_SCOPE:${response.coursePack.id}`,
        benchmarkCase.expected.episodes.includes(response.episode) ? null : `EPISODE:${response.episode}`,
        response.aiMode === "MODEL_ASSISTED" ? null : "MODEL_NOT_USED",
        response.reply.basis?.some(({ kind }) => kind === "GENERAL_DESIGN") ? null : "GENERAL_BASIS_MISSING",
        includesNormalized(response.reply.uncertainty, "通用设计建议") ? null : "GENERAL_ADVICE_LABEL_MISSING",
        response.reply.actions.every(({ target }) => target !== "NODE_CANVAS" && target !== "BOOK_LAYOUT_LAB")
          ? null : "GENERAL_ACTION_WRONG_SPECIALTY",
        (answer.match(/[？?]/g)?.length ?? 0) <= benchmarkCase.expected.maxQuestions ? null : "TOO_MANY_QUESTIONS",
        coveredConceptGroups >= benchmarkCase.expected.minimumConceptGroups
          ? null
          : `ANSWER_CONCEPT_COVERAGE:${coveredConceptGroups}/${benchmarkCase.expected.minimumConceptGroups}`,
        ...benchmarkCase.expected.forbiddenTerms.map((term) => includesNormalized(answer, term)
          ? `ANSWER_FORBIDDEN:${term}` : null),
      ].filter((failure): failure is string => failure !== null);
      results.push(result({
        id: benchmarkCase.id,
        kind: "DESIGN",
        passed: failures.length === 0,
        failures,
        observed: {
          discipline: benchmarkCase.discipline,
          coursePackId: response.coursePack.id,
          episode: response.episode,
          aiMode: response.aiMode,
          questionCount: answer.match(/[？?]/g)?.length ?? 0,
          coveredConceptGroups,
          modelErrors,
          answerExcerpt: answer.slice(0, 900),
        },
        started,
      }));
    } catch (error) {
      results.push(result({
        id: benchmarkCase.id,
        kind: "DESIGN",
        passed: false,
        failures: [`UNCAUGHT:${safeRuntimeErrorCode(error)}`],
        observed: { discipline: benchmarkCase.discipline },
        started,
      }));
    }
  }
  return results;
}

export async function runLongSessionProbe(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  suite: AgentRuntimeBenchmarkSuite;
  adapter: ModelProviderAdapter;
  runtime?: AgentRuntimePort;
}) {
  const started = performance.now();
  const scenario = input.suite.longSession;
  try {
    const task = createDesignTask(input.connection, input.actor, { title: "20回合连续项目" });
    const questionCounts: number[] = [];
    for (const turn of scenario.turns) {
      const response = await runRuntimeTurn({ ...input, turn: {
        taskId: task.id,
        message: turn.message,
        context: { view: "AGENT" },
      } });
      questionCounts.push([response.reply.message, response.reply.whyThisStep].join("\n").match(/[？?]/g)?.length ?? 0);
    }
    const conversation = readAgentConversation(input.connection, input.actor, "AGENT", task.id);
    const brief = conversation.projectBrief;
    const failures = [
      conversation.turns.length === 20 ? null : `TURN_COUNT:${conversation.turns.length}`,
      brief && Object.keys(brief.fields).length >= scenario.minimumBriefFields ? null : "BRIEF_FIELDS_INCOMPLETE",
      brief?.fields.designGoal?.value.includes(scenario.goalIncludes) ? null : "INITIAL_GOAL_LOST",
      questionCounts.every((count) => count <= scenario.maxQuestionsPerTurn) ? null : "TOO_MANY_QUESTIONS",
      conversation.turns.every(({ taskId }) => taskId === task.id) ? null : "TASK_ID_DRIFT",
    ].filter((failure): failure is string => failure !== null);
    return result({
      id: scenario.id, kind: "LONG_SESSION", passed: failures.length === 0, failures,
      observed: {
        turnCount: conversation.turns.length,
        briefFieldCount: brief ? Object.keys(brief.fields).length : 0,
        maximumQuestionCount: Math.max(...questionCounts),
      },
      started,
    });
  } catch (error) {
    return result({
      id: scenario.id, kind: "LONG_SESSION", passed: false,
      failures: [`UNCAUGHT:${safeRuntimeErrorCode(error)}`],
      observed: {}, started,
    });
  }
}

export async function runTaskIsolationProbe(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  suite: AgentRuntimeBenchmarkSuite;
  adapter: ModelProviderAdapter;
  runtime?: AgentRuntimePort;
}) {
  const started = performance.now();
  const scenario = input.suite.taskIsolation;
  try {
    const taskA = createDesignTask(input.connection, input.actor, { title: scenario.taskA.title });
    const taskB = createDesignTask(input.connection, input.actor, { title: scenario.taskB.title });
    for (const [task, turns] of [[taskA, scenario.taskA.turns], [taskB, scenario.taskB.turns]] as const) {
      for (const turn of turns) {
        await runRuntimeTurn({ ...input, turn: {
          taskId: task.id, message: turn.message, context: { view: "AGENT" },
        } });
      }
    }
    const conversationA = readAgentConversation(input.connection, input.actor, "AGENT", taskA.id);
    const conversationB = readAgentConversation(input.connection, input.actor, "AGENT", taskB.id);
    const messagesA = new Set(conversationA.turns.map(({ studentMessage }) => studentMessage));
    const messagesB = new Set(conversationB.turns.map(({ studentMessage }) => studentMessage));
    const failures = [
      conversationA.turns.length === scenario.taskA.turns.length ? null : "TASK_A_TURN_COUNT",
      conversationB.turns.length === scenario.taskB.turns.length ? null : "TASK_B_TURN_COUNT",
      conversationA.projectBrief?.fields.designGoal?.value.includes(scenario.taskA.goalIncludes) ? null : "TASK_A_GOAL_LOST",
      conversationB.projectBrief?.fields.designGoal?.value.includes(scenario.taskB.goalIncludes) ? null : "TASK_B_GOAL_LOST",
      [...messagesA].every((message) => !messagesB.has(message)) ? null : "TASK_MESSAGES_CROSSED",
      conversationA.conversationId !== conversationB.conversationId ? null : "CONVERSATION_ID_SHARED",
    ].filter((failure): failure is string => failure !== null);
    return result({
      id: scenario.id, kind: "TASK_ISOLATION", passed: failures.length === 0, failures,
      observed: {
        taskATurns: conversationA.turns.length,
        taskBTurns: conversationB.turns.length,
        distinctConversations: conversationA.conversationId !== conversationB.conversationId,
      },
      started,
    });
  } catch (error) {
    return result({
      id: scenario.id, kind: "TASK_ISOLATION", passed: false,
      failures: [`UNCAUGHT:${safeRuntimeErrorCode(error)}`],
      observed: {}, started,
    });
  }
}

export async function runRestartRecoveryProbe(input: {
  openConnection: () => DatabaseConnection;
  actor: SessionPayload;
  suite: AgentRuntimeBenchmarkSuite;
  adapter: ModelProviderAdapter;
  runtime?: AgentRuntimePort;
  freshProcessCheck: (expectation: {
    taskId: string;
    conversationId: string;
    goalIncludes: string;
  }) => Promise<FreshProcessRecoveryResult>;
}) {
  const started = performance.now();
  const scenario = input.suite.restartRecovery;
  let connection: DatabaseConnection | null = null;
  try {
    connection = input.openConnection();
    const task = createDesignTask(connection, input.actor, { title: "重启恢复探针" });
    const response = await runRuntimeTurn({ ...input, connection, turn: {
      taskId: task.id, message: scenario.message, context: { view: "AGENT" },
    } });
    const conversationId = response.conversationId;
    connection.sqlite.close();
    connection = null;
    const recovered = await input.freshProcessCheck({
      taskId: task.id,
      conversationId,
      goalIncludes: scenario.goalIncludes,
    });
    const failures = [
      recovered.taskRecovered ? null : "TASK_NOT_RECOVERED",
      recovered.conversationRecovered ? null : "CONVERSATION_NOT_RECOVERED",
      recovered.turnCount === 1 ? null : `RECOVERED_TURN_COUNT:${recovered.turnCount}`,
      recovered.briefRecovered ? null : "BRIEF_NOT_RECOVERED",
    ].filter((failure): failure is string => failure !== null);
    return result({
      id: scenario.id, kind: "RESTART_RECOVERY", passed: failures.length === 0, failures,
      observed: { ...recovered, freshProcessBoundary: true },
      started,
    });
  } catch (error) {
    return result({
      id: scenario.id, kind: "RESTART_RECOVERY", passed: false,
      failures: [`UNCAUGHT:${safeRuntimeErrorCode(error)}`],
      observed: {}, started,
    });
  } finally {
    if (connection?.sqlite.open) connection.sqlite.close();
  }
}

export function harnessBenchmarkResults(results: AgentHarnessCaseResult[]): RuntimeBenchmarkCaseResult[] {
  return results.map((item) => RuntimeBenchmarkCaseResultSchema.parse({
    id: `harness:${item.caseId}`,
    kind: "FAULT_INJECTION",
    passed: item.passed,
    failures: item.failures,
    latencyMs: item.durationMs,
    observed: item.observed,
  }));
}
