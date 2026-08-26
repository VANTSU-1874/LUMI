import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { BadRequestError, ForbiddenRequestError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { parseRequestBody, validateRequestProtocol } from "@/lib/auth/route-handler";
import { getActiveAgentPolicy, resolveAgentPolicyTimeouts } from "@/lib/agent/policy-registry";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { PreviewRunRequestSchema } from "@/lib/preview/contracts";
import { describePreviewFailure } from "@/lib/preview/failure";
import { PreviewMessageDeltaDecoder, runPreviewScenario } from "@/lib/preview/preview-runner";
import {
  createPreviewFreeInput,
  getPreviewScenario,
  getPreviewSuggestion,
  isPreviewInitialSuggestion,
  PreviewSuggestionNotFoundError,
} from "@/lib/preview/scenarios";
import {
  completePreviewRun,
  failPreviewRun,
  hasCompletedPreviewRun,
  PreviewRunBusyError,
  PreviewRunRateLimitError,
  PreviewSessionNotFoundError,
  readPreviewSession,
  startPreviewRun,
} from "@/lib/preview/store";
import { PREVIEW_SESSION_COOKIE_NAME, verifyPreviewSession } from "@/lib/preview/session";

export const runtime = "nodejs";

const HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "Content-Type": "text/event-stream; charset=utf-8",
  Connection: "keep-alive",
  "x-lumi-data-type": "DEMONSTRATION_DATA",
};

function jsonError(message: string, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie", "x-lumi-data-type": "DEMONSTRATION_DATA", ...headers },
  });
}

export async function POST(request: NextRequest) {
  let connection: DatabaseConnection | undefined;
  const requestId = randomUUID();
  try {
    validateRequestProtocol(request);
    const input = await parseRequestBody(request, PreviewRunRequestSchema);
    // Keep malformed or cross-theme suggestion IDs on the public 400 boundary
    // before inspecting the anonymous-session cookie.
    getPreviewScenario(input.scenarioId);
    if (input.suggestionId) getPreviewSuggestion(input.scenarioId, input.suggestionId);
    const config = readEnv(process.env);
    const token = request.cookies.get(PREVIEW_SESSION_COOKIE_NAME)?.value;
    if (!token) return jsonError("预览会话已失效，请刷新页面后重试", 401);
    let payload;
    try {
      payload = await verifyPreviewSession(token, config.sessionSecret);
    } catch {
      return jsonError("预览会话已失效，请刷新页面后重试", 401);
    }
    connection = createDb(config.databasePath);
    if (!readPreviewSession(connection, payload.sessionId)) {
      return jsonError("预览会话已失效，请刷新页面后重试", 401);
    }
    const scenario = getPreviewScenario(input.scenarioId, payload.sessionId);
    const suggestion = input.suggestionId
      ? getPreviewSuggestion(input.scenarioId, input.suggestionId, payload.sessionId).suggestion
      : createPreviewFreeInput(scenario, input.message!);
    const hasInitialAnswer = hasCompletedPreviewRun({
      connection,
      sessionId: payload.sessionId,
      scenarioId: input.scenarioId,
    });
    if (
      (!input.suggestionId || !isPreviewInitialSuggestion(scenario, input.suggestionId))
      && !hasInitialAnswer
    ) {
      return jsonError("请先完成本主题的预设首问", 409);
    }
    const started = startPreviewRun({
      connection,
      sessionId: payload.sessionId,
      scenarioId: input.scenarioId,
    });
    const streamConnection = connection;
    connection = undefined;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, value: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
        };
        const decoder = new PreviewMessageDeltaDecoder();
        try {
          send("status", { runId: started.runId, status: "MODEL_STREAMING" });
          const response = await runPreviewScenario({
            connection: streamConnection,
            scenario,
            suggestion,
            ai: config.ai,
            policy: resolveAgentPolicyTimeouts(getActiveAgentPolicy(), config.agentTimeouts.online),
            previousTurns: input.history,
            onModelJsonDelta(delta) {
              const visibleDelta = decoder.push(delta);
              if (visibleDelta) send("text", { delta: visibleDelta });
            },
          });
          completePreviewRun({
            connection: streamConnection,
            runId: started.runId,
            sessionId: payload.sessionId,
            response,
          });
          send("complete", { runId: started.runId, response });
        } catch (error) {
          const failure = describePreviewFailure(error);
          try {
            failPreviewRun({
              connection: streamConnection,
              runId: started.runId,
              sessionId: payload.sessionId,
              errorCode: failure.code,
            });
          } catch {
            // The client still receives the stable failure boundary below.
          }
          console.error({
            requestId,
            runId: started.runId,
            route: "preview-run",
            errorCode: failure.code,
            failureStage: failure.stage,
            retryable: failure.retryable,
            ...failure.log,
          });
          send("error", {
            runId: started.runId,
            code: failure.code,
            error: failure.publicMessage,
            requestId,
            stage: failure.stage,
            retryable: failure.retryable,
          });
        } finally {
          streamConnection.sqlite.close();
          controller.close();
        }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { ...HEADERS, "x-lumi-request-id": requestId },
    });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof BadRequestError || error instanceof UnsupportedMediaTypeError || error instanceof PreviewSuggestionNotFoundError) {
      return jsonError("预览场景参数无效", 400);
    }
    if (error instanceof ForbiddenRequestError) return jsonError(error.message, 403);
    if (error instanceof PreviewRunBusyError) return jsonError(error.message, 409);
    if (error instanceof PreviewRunRateLimitError) {
      return jsonError(error.message, 429, { "Retry-After": "60" });
    }
    if (error instanceof PreviewSessionNotFoundError) return jsonError(error.message, 401);
    console.error({ requestId, route: "preview-run-create", errorName: error instanceof Error ? error.name : "UnknownError" });
    return jsonError("预览运行暂时不可用", 500);
  } finally {
    connection?.sqlite.close();
  }
}
