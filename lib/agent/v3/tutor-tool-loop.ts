import { z } from "zod";

import {
  ModelServiceError,
  type ModelConversationMessage,
  type ModelResponse,
  type ModelResponseOptions,
  type ModelToolDefinition,
  type ModelUsage,
} from "@/lib/ai/client";
import type { EmbeddingProvider } from "@/lib/ai/embeddings";
import type { SessionPayload } from "@/lib/auth/session";
import type { CoursePack } from "@/lib/course-packs/contract";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  redactSensitiveText,
  studentNumberPolicyFromEnvironment,
} from "@/lib/security/redaction";

import type { PreparedAgentArtwork } from "../artwork-attachment";
import { capabilityActionLabel } from "../capability-registry";
import type { AgentExecutionTrace } from "../execution-trace";
import type { ExternalWebResearchRunner } from "../external-web-research";
import {
  runModelCallWithRetry,
  type ModelRetryContext,
} from "../model-call-retry";
import type { ModelProviderAdapter } from "../model-provider-adapter";
import type { AgentOptions, StudentContext } from "../orchestrator-context";
import type { AgentPolicy } from "../policy-contract";
import {
  AgentToolCallRequestSchema,
  type AgentToolDefinition,
  type AgentToolExecution,
} from "../tool-contract";
import {
  AgentToolRejectedError,
  decideAgentToolPermission,
  executeRegisteredAgentTool,
  type AgentToolExecutor,
} from "../tool-executor";
import { canNativeTutorObserveArtwork } from "./tutor-artwork";

function publicUsage(usage: ModelUsage | null) {
  return usage ? { status: "RECORDED" as const, ...usage } : {
    status: "UNAVAILABLE" as const,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  };
}

function functionName(toolId: string) {
  return `tool_${toolId.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);
}

function modelTool(definition: AgentToolDefinition): ModelToolDefinition {
  const rawSchema = z.toJSONSchema(definition.inputSchema) as Record<string, unknown>;
  delete rawSchema.$schema;
  return {
    name: functionName(definition.descriptor.id),
    description: `${definition.descriptor.label}。${definition.descriptor.description} ${definition.descriptor.inputHint}`,
    parameters: rawSchema,
    ...(definition.strictInputSchema ? { strict: true } : {}),
  };
}

async function respond(
  client: ModelProviderAdapter,
  messages: ModelConversationMessage[],
  options: ModelResponseOptions,
): Promise<ModelResponse> {
  if (client.respond) return client.respond(messages, options);
  const compatibleMessages = messages.flatMap((message) => {
    if (message.role === "tool") return [];
    if (message.role === "assistant" && !message.content) return [];
    return [{ role: message.role, content: message.content }] as Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
  });
  const content = options.image && client.completeWithImage
    ? await client.completeWithImage(compatibleMessages, options.image, options)
    : await client.complete(compatibleMessages, options);
  return {
    content,
    toolCalls: [],
  };
}

function toolErrorCode(error: unknown) {
  if (error instanceof AgentToolRejectedError) return error.code;
  if (error instanceof SyntaxError) return "TOOL_ARGUMENTS_INVALID";
  if (error instanceof z.ZodError) return "TOOL_ARGUMENTS_INVALID";
  return "TOOL_EXECUTION_REJECTED";
}

function toolFailureCopy(errorCode: string) {
  if (errorCode === "TOOL_CONFIRMATION_REQUIRED") {
    return {
      label: "工具调用等待学生确认",
      traceSummary: "该工具会写入项目、修改软件状态或调用外部服务；尚未获得学生确认，因此没有执行。",
      progressSummary: "该操作需要你先确认，本轮没有执行；导师会继续回答并说明拟执行内容。",
      modelSummary: "该工具需要学生先确认，本轮没有执行。请继续回答，并在确有必要时说明拟执行的具体操作。",
    };
  }
  if (errorCode === "TOOL_FORBIDDEN") {
    return {
      label: "工具调用超出当前权限",
      traceSummary: "该工具涉及正式提交、评分、过关或评价状态变更，导师无权执行。",
      progressSummary: "该正式动作不能由导师代办；导师会继续提供分析和建议。",
      modelSummary: "该工具涉及禁止代办的正式动作，未执行。请继续提供辅导，不得声称已经提交、评分或改变评价状态。",
    };
  }
  if (errorCode === "TOOL_FINAL_ANSWER_REQUIRED") {
    return {
      label: "工具调用未在收尾阶段执行",
      traceSummary: "本轮已进入无工具收尾阶段；该调用没有执行，结果交还模型完成正文。",
      progressSummary: "本轮已进入回答收尾，导师将基于已有信息完成正文。",
      modelSummary: "本轮已进入最终回答阶段，该工具没有执行。请立即基于已有信息完成自然语言回答。",
    };
  }
  return {
    label: "工具参数不可执行",
    traceSummary: "工具参数无效或调用重复；错误作为工具结果交还模型继续回答。",
    progressSummary: "工具参数无效或调用重复，导师将基于已有信息继续回答。",
    modelSummary: "工具参数无效或调用重复，请基于已有信息继续回答。",
  };
}

function toolResultContent(input: {
  status: "SUCCESS" | "EMPTY" | "ERROR";
  summary: string;
  facts?: string[];
  output?: unknown;
  errorCode?: string | null;
}) {
  const maxToolMessageCharacters = 15_500;
  const studentNumber = studentNumberPolicyFromEnvironment();
  const redactValue = (value: unknown): unknown => {
    if (typeof value === "string") return redactSensitiveText(value, { studentNumber });
    if (Array.isArray(value)) return value.map(redactValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, redactValue(nested)]),
      );
    }
    return value;
  };
  const payload = redactValue({
    status: input.status,
    summary: input.summary,
    facts: input.facts ?? [],
    output: input.output ?? null,
    errorCode: input.errorCode ?? null,
  }) as Record<string, unknown>;
  const serialized = JSON.stringify(payload);
  if (serialized.length <= maxToolMessageCharacters) return serialized;

  const compactValue = (value: unknown, depth = 0): unknown => {
    if (typeof value === "string") return value.slice(0, 1_000);
    if (Array.isArray(value)) return value.slice(0, 5).map((item) => compactValue(item, depth + 1));
    if (value && typeof value === "object" && depth < 4) {
      return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, nested]) => [
        key,
        compactValue(nested, depth + 1),
      ]));
    }
    return value;
  };
  const compact = JSON.stringify({
    ...payload,
    summary: `${String(payload.summary).slice(0, 240)}（详细工具输出已压缩。）`,
    facts: Array.isArray(payload.facts) ? payload.facts.slice(0, 6) : [],
    output: compactValue(payload.output),
  });
  if (compact.length <= maxToolMessageCharacters) return compact;
  return JSON.stringify({
    status: input.status,
    summary: `${input.summary.slice(0, 240)}（详细工具输出过大，未注入模型上下文。）`,
    facts: (input.facts ?? []).slice(0, 4),
    output: null,
    errorCode: input.errorCode ?? null,
  });
}

export async function runTutorToolLoop(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  pack: CoursePack;
  context: StudentContext;
  question: string;
  client: ModelProviderAdapter;
  messages: ModelConversationMessage[];
  availableTools: readonly AgentToolDefinition[];
  policy: AgentPolicy;
  turnDeadline: number;
  trace: AgentExecutionTrace;
  artwork?: PreparedAgentArtwork;
  embeddingProvider?: EmbeddingProvider | null;
  signal?: AbortSignal;
  onModelError?: AgentOptions["onModelError"];
  onTextDelta?: (delta: string, attempt: number) => void;
  onModelActivity?: AgentOptions["onModelActivity"];
  allowRetryAfterTextDelta?: AgentOptions["allowRetryAfterTextDelta"];
  onToolProgress?: AgentOptions["onToolProgress"];
  toolExecutor?: AgentToolExecutor;
  progress?: { modelDecisions: number; toolCallCount: number; modelRetries?: number };
  toolExecutions?: AgentToolExecution[];
  confirmedToolIds?: ReadonlySet<string>;
  externalWebResearch?: ExternalWebResearchRunner;
  retryContext?: ModelRetryContext;
}) {
  const toolPermissions = new Map(input.availableTools.map((definition) => [
    definition.descriptor.id,
    (() => {
      const permission = decideAgentToolPermission(definition, input.policy);
      if (
        permission.mode === "REQUIRES_CONFIRMATION"
        && definition.descriptor.effect === "EXTERNAL_CALL"
        && input.confirmedToolIds?.has(definition.descriptor.id)
      ) {
        return {
          mode: "AUTOMATIC" as const,
          reason: "学生已为本条消息显式确认该外呼工具。",
        };
      }
      return permission;
    })(),
  ]));
  const automaticTools = input.availableTools.filter((definition) => (
    toolPermissions.get(definition.descriptor.id)?.mode === "AUTOMATIC"
  ));
  const reservePermissionRecovery = automaticTools.length < input.availableTools.length;
  const toolDefinitions = automaticTools.map(modelTool);
  const toolsByFunctionName = new Map(
    input.availableTools.map((definition) => [functionName(definition.descriptor.id), definition]),
  );
  if (toolsByFunctionName.size !== input.availableTools.length) {
    throw new Error("V3_TOOL_FUNCTION_NAME_COLLISION");
  }
  const messages = [...input.messages];
  const toolExecutions = input.toolExecutions ?? [];
  const seenFingerprints = new Set<string>();
  const artworkImage = input.artwork && canNativeTutorObserveArtwork(input.client, input.artwork)
    ? {
        mimeType: input.artwork.mimeType,
        bytes: new Uint8Array(input.artwork.bytes),
      }
    : undefined;
  let modelDecisions = 0;
  let modelRetries = 0;
  let toolCallCount = 0;
  let artworkDelivered = false;
  let artworkProgressStarted = false;
  let artworkProgressFinished = false;

  const failArtworkProgress = (label: string, summary: string) => {
    if (!artworkImage || artworkProgressFinished) return;
    artworkProgressFinished = true;
    input.onToolProgress?.({
      status: "FAILED",
      toolId: "student-artwork.inspect",
      label,
      summary,
    });
  };

  const markArtworkDelivered = () => {
    if (!artworkImage || artworkProgressFinished) return;
    artworkProgressFinished = true;
    artworkDelivered = true;
  };

  if (input.artwork && !artworkImage) {
    input.onToolProgress?.({
      status: "FAILED",
      toolId: "student-artwork.inspect",
      label: "未读取作品图片",
      summary: "当前模型没有可用的视觉输入能力；导师会明确这一点，并继续基于文字提供帮助。",
    });
  }

  while (modelDecisions < input.policy.budgets.maxModelDecisions) {
    input.signal?.throwIfAborted();
    const remainingMs = Math.floor(input.turnDeadline - performance.now());
    if (remainingMs <= 0) {
      failArtworkProgress(
        "作品图片读取超时",
        "视觉模型未能形成最终回答；本轮不会把这张图片标记为已观察依据。",
      );
      throw new ModelServiceError("TIMEOUT");
    }
    const isLastDecision = modelDecisions === input.policy.budgets.maxModelDecisions - 1;
    const finalResponseOnly = isLastDecision || (
      reservePermissionRecovery
      && input.policy.budgets.maxModelDecisions > 1
      && modelDecisions === input.policy.budgets.maxModelDecisions - 2
    );
    const responseStarted = performance.now();
    let responseUsage: ModelUsage | null = null;
    if (artworkImage && !artworkProgressStarted) {
      artworkProgressStarted = true;
      input.onToolProgress?.({
        status: "RUNNING",
        toolId: "student-artwork.inspect",
        label: "正在读取你的作品",
        summary: "导师正在查看这张作品的静态画面；不会据此臆断动态、材质、交互或使用效果。",
      });
    }
    let response: ModelResponse;
    let responseRetryCount = 0;
    try {
      const retried = await runModelCallWithRetry({
        totalBudgetMs: input.policy.budgets.modelTimeoutMs,
        turnDeadline: input.turnDeadline,
        signal: input.signal,
        onTextDelta: input.onTextDelta,
        allowRetryAfterTextDelta: input.allowRetryAfterTextDelta,
        onAttemptError: input.onModelError,
        onRetry: () => {
          modelRetries += 1;
          if (input.progress) input.progress.modelRetries = modelRetries;
        },
        context: {
          ...input.retryContext,
          modelDecision: modelDecisions + 1,
        },
        execute: async ({ signal, totalTimeoutMs, onTextDelta }) => {
          responseUsage = null;
          return respond(input.client, messages, {
            signal,
            idleTimeoutMs: input.policy.budgets.modelIdleTimeoutMs,
            totalTimeoutMs,
            ...(input.retryContext?.runId ? { runId: input.retryContext.runId } : {}),
            onUsage: (usage) => { responseUsage = usage; },
            ...(onTextDelta ? { onTextDelta } : {}),
            ...(input.onModelActivity ? { onStreamActivity: input.onModelActivity } : {}),
            image: artworkImage,
            tools: finalResponseOnly ? [] : toolDefinitions,
            toolChoice: finalResponseOnly ? "none" : "auto",
          });
        },
      });
      response = retried.value;
      responseRetryCount = retried.retryCount;
    } catch (rawError) {
      failArtworkProgress(
        "作品图片读取失败",
        "视觉模型请求未成功；最终回答不会把这张图片标记为已观察依据。",
      );
      throw rawError;
    }
    modelDecisions += 1;
    if (input.progress) input.progress.modelDecisions = modelDecisions;

    // A token-cap terminal response can contain a partial body alongside an
    // unfinished tool-call plan. Never execute that partial plan; preserve the
    // body and let the explicit continuation path finish the answer instead.
    if (response.toolCalls.length === 0 || (response.outputTruncated && response.content?.trim())) {
      if (!response.content?.trim()) {
        failArtworkProgress(
          "作品图片未形成有效回答",
          "视觉模型没有返回可交付正文；本轮不会把这张图片标记为已观察依据。",
        );
        throw new ModelServiceError("INVALID_RESPONSE");
      }
      markArtworkDelivered();
      input.trace.add({
        kind: "MODEL_DECISION",
        status: "SUCCEEDED",
        label: response.outputTruncated ? "模型输出达到长度上限" : "形成自然语言辅导",
        summary: response.outputTruncated
          ? "模型输出达到长度上限；保留已收到的正文，并交给继续生成路径完成后续内容。"
          : responseRetryCount > 0
            ? `模型调用重试 ${responseRetryCount} 次后形成学生可读正文；未拼接失败尝试内容。`
            : "模型直接形成学生可读正文；未经过刚性JSON或词汇白名单裁决。",
        toolCallId: null,
        toolId: null,
        latencyMs: Math.round(performance.now() - responseStarted),
      }, {
        modelProvider: input.client.provider,
        modelId: input.client.modelId ?? null,
        usage: publicUsage(responseUsage),
      });
      return {
        text: response.content,
        toolExecutions,
        modelDecisions,
        modelRetries,
        toolCallCount,
        artworkDelivered,
        ...(response.outputTruncated ? { outputTruncated: true } : {}),
      };
    }

    if (isLastDecision) {
      failArtworkProgress(
        "作品图片未形成最终回答",
        "视觉模型在收尾阶段仍只请求工具；本轮不会把这张图片标记为已观察依据。",
      );
      throw new ModelServiceError("INVALID_RESPONSE");
    }
    input.trace.add({
      kind: "MODEL_DECISION",
      status: "SUCCEEDED",
      label: "模型主动调用辅导工具",
      summary: responseRetryCount > 0
        ? `模型调用重试 ${responseRetryCount} 次后请求 ${response.toolCalls.length} 次工具调用；已完成的工具没有重放。`
        : `模型请求 ${response.toolCalls.length} 次工具调用；运行时按权限逐项处理后继续组织回答。`,
      toolCallId: null,
      toolId: null,
      latencyMs: Math.round(performance.now() - responseStarted),
    }, {
      modelProvider: input.client.provider,
      modelId: input.client.modelId ?? null,
      usage: publicUsage(responseUsage),
    });
    messages.push({
      role: "assistant",
      content: response.content,
      toolCalls: response.toolCalls,
      providerOutput: response.providerOutput,
    });

    for (const modelCall of response.toolCalls) {
      toolCallCount += 1;
      if (input.progress) input.progress.toolCallCount = toolCallCount;
      const definition = toolsByFunctionName.get(modelCall.name);
      if (!definition || toolCallCount > input.policy.budgets.maxToolCalls) {
        const errorCode = definition ? "TOOL_CALL_BUDGET_EXCEEDED" : "TOOL_NOT_AVAILABLE";
        input.trace.add({
          kind: "TOOL_CALL",
          status: "FAILED",
          label: "工具调用未执行",
          summary: definition ? "本轮工具调用已达到预算上限。" : "模型请求了本轮未提供的工具。",
          toolCallId: null,
          toolId: definition?.descriptor.id ?? null,
          latencyMs: 0,
        }, { errorCode });
        if (definition) {
          input.onToolProgress?.({
            status: "FAILED",
            toolId: definition.descriptor.id,
            label: `未执行：${definition.descriptor.label}`,
            summary: "本轮工具调用已达到预算上限，导师将基于已有信息继续回答。",
          });
        }
        messages.push({
          role: "tool",
          toolCallId: modelCall.id,
          content: toolResultContent({
            status: "ERROR",
            summary: "该工具调用未执行，请基于已有信息继续回答。",
            errorCode,
          }),
        });
        continue;
      }

      const permission = toolPermissions.get(definition.descriptor.id);
      if (finalResponseOnly && permission?.mode === "AUTOMATIC") {
        const errorCode = "TOOL_FINAL_ANSWER_REQUIRED";
        const copy = toolFailureCopy(errorCode);
        input.trace.add({
          kind: "TOOL_CALL",
          status: "FAILED",
          label: copy.label,
          summary: copy.traceSummary,
          toolCallId: null,
          toolId: definition.descriptor.id,
          latencyMs: 0,
        }, { errorCode });
        input.onToolProgress?.({
          status: "FAILED",
          toolId: definition.descriptor.id,
          label: `未执行：${definition.descriptor.label}`,
          summary: copy.progressSummary,
        });
        messages.push({
          role: "tool",
          toolCallId: modelCall.id,
          content: toolResultContent({
            status: "ERROR",
            summary: copy.modelSummary,
            errorCode,
          }),
        });
        continue;
      }
      if (!permission || permission.mode !== "AUTOMATIC") {
        const errorCode = permission?.mode === "REQUIRES_CONFIRMATION"
          ? "TOOL_CONFIRMATION_REQUIRED"
          : permission?.mode === "FORBIDDEN"
            ? "TOOL_FORBIDDEN"
            : "TOOL_PERMISSION_INVALID";
        const copy = toolFailureCopy(errorCode);
        input.trace.add({
          kind: "TOOL_CALL",
          status: "FAILED",
          label: copy.label,
          summary: copy.traceSummary,
          toolCallId: null,
          toolId: definition.descriptor.id,
          latencyMs: 0,
        }, { errorCode });
        input.onToolProgress?.({
          status: "FAILED",
          toolId: definition.descriptor.id,
          label: `未执行：${definition.descriptor.label}`,
          summary: copy.progressSummary,
        });
        messages.push({
          role: "tool",
          toolCallId: modelCall.id,
          content: toolResultContent({
            status: "ERROR",
            summary: copy.modelSummary,
            errorCode,
          }),
        });
        continue;
      }

      const callStarted = performance.now();
      const isExternalCall = definition.descriptor.effect === "EXTERNAL_CALL";
      const isCalculation = definition.descriptor.adapterId === "design-calculator";
      input.onToolProgress?.({
        status: "RUNNING",
        toolId: definition.descriptor.id,
        label: isExternalCall
          ? `正在联网：${definition.descriptor.label}`
          : isCalculation
            ? `正在计算：${definition.descriptor.label}`
          : `正在查阅：${definition.descriptor.label}`,
        summary: isExternalCall
          ? "导师正在执行本条消息已确认的公开网页检索；只发送脱敏后的当前问题。"
          : isCalculation
            ? "导师正在用确定性公式计算本题参数；不会联网、写入项目或改变评价状态。"
          : "导师正在读取与当前问题有关的学习资料；不会修改学生项目或评价状态。",
      });
      try {
        const rawArguments = JSON.parse(modelCall.arguments) as unknown;
        const call = AgentToolCallRequestSchema.parse({
          toolId: definition.descriptor.id,
          arguments: rawArguments,
        });
        const toolRemainingMs = Math.max(1, Math.floor(input.turnDeadline - performance.now()));
        const toolSignal = input.signal
          ? AbortSignal.any([input.signal, AbortSignal.timeout(toolRemainingMs)])
          : AbortSignal.timeout(toolRemainingMs);
        const execution = await (input.toolExecutor ?? executeRegisteredAgentTool)({
          call,
          context: {
            connection: input.connection,
            actor: input.actor,
            pack: input.pack,
            student: input.context,
            question: input.question,
            embeddingProvider: input.embeddingProvider,
            externalWebResearch: input.externalWebResearch,
            signal: toolSignal,
          },
          policy: input.policy,
          seenFingerprints,
          confirmedToolIds: input.confirmedToolIds,
        });
        toolExecutions.push(execution);
        const executionFailed = execution.observation.status === "ERROR";
        const actionLabel = capabilityActionLabel(
          execution.observation.toolId,
          definition.descriptor.label,
        );
        input.trace.add({
          kind: "TOOL_CALL",
          status: executionFailed ? "FAILED" : "SUCCEEDED",
          label: executionFailed
            ? isExternalCall ? "联网检索执行失败" : isCalculation ? "确定性计算执行失败" : "只读工具执行失败"
            : isExternalCall
              ? "执行学生已确认的联网检索"
              : isCalculation ? "执行模型选择的确定性计算" : "执行模型选择的只读工具",
          summary: executionFailed
            ? `“${actionLabel}”未完成；${execution.observation.summary}`.slice(0, 300)
            : isExternalCall
              ? `已完成“${actionLabel}”；只发送了脱敏后的当前问题，未修改学生项目或评价状态。`
              : isCalculation
                ? `已完成“${actionLabel}”；结果来自确定性公式，未联网或修改学生项目。`
                : `已完成“${actionLabel}”，未修改学生项目或评价状态。`,
          toolCallId: execution.observation.callId,
          toolId: execution.observation.toolId,
          latencyMs: Math.round(performance.now() - callStarted),
        }, executionFailed ? { errorCode: execution.observation.errorCode } : {});
        input.trace.add({
          kind: "TOOL_OBSERVATION",
          status: execution.observation.status === "ERROR" ? "FAILED"
            : execution.observation.status === "EMPTY" ? "EMPTY" : "SUCCEEDED",
          label: execution.observation.status === "ERROR"
            ? isExternalCall ? "联网检索失败" : isCalculation ? "参数计算失败" : "工具读取失败"
            : isExternalCall
              ? "获得公开网页检索结果"
              : isCalculation ? "获得确定性计算结果" : "获得工具观察",
          summary: execution.observation.summary,
          toolCallId: execution.observation.callId,
          toolId: execution.observation.toolId,
          latencyMs: execution.observation.latencyMs,
        }, { errorCode: execution.observation.errorCode });
        input.onToolProgress?.({
          status: execution.observation.status === "ERROR" ? "FAILED" : "SUCCEEDED",
          toolId: execution.observation.toolId,
          label: execution.observation.status === "ERROR"
            ? `${isExternalCall ? "联网" : isCalculation ? "计算" : "查阅"}失败：${definition.descriptor.label}`
            : `${isExternalCall ? "已联网核对" : isCalculation ? "已计算" : "已查阅"}：${definition.descriptor.label}`,
          summary: execution.observation.summary,
        });
        messages.push({
          role: "tool",
          toolCallId: modelCall.id,
          content: toolResultContent({
            status: execution.observation.status,
            summary: execution.observation.summary,
            facts: execution.observation.facts,
            output: execution.output,
            errorCode: execution.observation.errorCode,
          }),
        });
      } catch (error) {
        if (error instanceof ModelServiceError) {
          input.trace.add({
            kind: "TOOL_CALL",
            status: "FAILED",
            label: isExternalCall
              ? "联网检索服务中断"
              : isCalculation ? "确定性计算服务中断" : "只读工具服务中断",
            summary: "工具依赖的模型服务未完成请求；本轮已停止，未使用不完整结果。",
            toolCallId: null,
            toolId: definition.descriptor.id,
            latencyMs: Math.round(performance.now() - callStarted),
          }, { errorCode: error.code });
          input.onToolProgress?.({
            status: "FAILED",
            toolId: definition.descriptor.id,
            label: `服务中断：${definition.descriptor.label}`,
            summary: "模型服务未完成请求，本轮已停止；不会使用不完整的工具结果。",
          });
          input.onModelError?.(error, modelDecisions + 1);
          throw error;
        }
        const errorCode = toolErrorCode(error);
        const copy = toolFailureCopy(errorCode);
        input.trace.add({
          kind: "TOOL_CALL",
          status: "FAILED",
          label: copy.label,
          summary: copy.traceSummary,
          toolCallId: null,
          toolId: definition.descriptor.id,
          latencyMs: Math.round(performance.now() - callStarted),
        }, { errorCode });
        input.onToolProgress?.({
          status: "FAILED",
          toolId: definition.descriptor.id,
          label: `未执行：${definition.descriptor.label}`,
          summary: copy.progressSummary,
        });
        messages.push({
          role: "tool",
          toolCallId: modelCall.id,
          content: toolResultContent({
            status: "ERROR",
            summary: copy.modelSummary,
            errorCode,
          }),
        });
      }
    }
  }

  failArtworkProgress(
    "作品图片未形成最终回答",
    "视觉模型没有在本轮预算内形成最终正文；不会把这张图片标记为已观察依据。",
  );
  throw new ModelServiceError("INVALID_RESPONSE");
}
