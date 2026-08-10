import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { ModelServiceError } from "@/lib/ai/client";
import { buildGenerativePrompt } from "@/lib/agent/skills/generative-tool-spec";
import { GenerativeArtifactRejectedError } from "@/lib/agent/skills/generative-html-guard";
import { buildModelClient } from "@/lib/agent/orchestrator-context";
import { getActiveAgentPolicy, resolveAgentPolicyTimeouts } from "@/lib/agent/policy-registry";
import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { requireStudentSession, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { parseLimitedRequestBody, validateRequestProtocol, validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { GenerativeBuildCommandSchema, GenerativeResetCommandSchema } from "@/lib/domain/generative-tool";
import {
  buildGenerativeArtifact,
  GenerativeBuildConflictError,
  GenerativeModelUnavailableError,
  GenerativeToolForbiddenError,
  GenerativeToolNotFoundError,
  readGenerativeWorkspace,
  resetGenerativeWorkspace,
} from "@/lib/services/generative-tool";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

function failure(error: unknown, requestId: string) {
  if (error instanceof BadRequestError) return NextResponse.json({ error: error.message }, { status: 400, headers: HEADERS });
  if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
  if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: HEADERS });
  if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
  if (
    error instanceof StudentRoleForbiddenError
    || error instanceof ForbiddenRequestError
    || error instanceof GenerativeToolForbiddenError
  ) {
    return NextResponse.json({ error: error.message }, { status: 403, headers: HEADERS });
  }
  if (error instanceof GenerativeToolNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
  if (error instanceof GenerativeBuildConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers: HEADERS });
  if (error instanceof GenerativeArtifactRejectedError) {
    return NextResponse.json({
      error: "生成结果未通过零外链安全校验，请调整要求后重试",
      violations: error.violations.map(({ code }) => code),
    }, { status: 422, headers: HEADERS });
  }
  if (error instanceof GenerativeModelUnavailableError) {
    return NextResponse.json({ error: error.message }, { status: 503, headers: HEADERS });
  }
  if (error instanceof ModelServiceError) {
    return NextResponse.json({ error: "文本模型暂时无法完成生成，请稍后重试" }, { status: 502, headers: HEADERS });
  }
  console.error({ requestId, route: "generative-tool", errorName: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "现场生成实验台暂时不可用" }, { status: 500, headers: HEADERS });
}

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const session = await requireStudentSession(request, config.sessionSecret);
    connection = createDb(config.databasePath);
    return NextResponse.json(readGenerativeWorkspace(connection, session), { headers: HEADERS });
  } catch (error) {
    return failure(error, requestId);
  } finally {
    connection?.sqlite.close();
  }
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    const session = await requireStudentSession(request, config.sessionSecret);
    const input = await parseLimitedRequestBody(request, GenerativeBuildCommandSchema, 8 * 1_024);
    const policy = resolveAgentPolicyTimeouts(getActiveAgentPolicy(), config.agentTimeouts.online);
    const client = buildModelClient({ ai: config.ai }, policy);
    if (!client) throw new GenerativeModelUnavailableError("文本模型尚未配置，当前不能构建 HTML 生成器");
    connection = createDb(config.databasePath);
    const artifact = await buildGenerativeArtifact(connection, session, input, ({ kind, brief }) => (
      client.complete([
        {
          role: "system",
          content: "你是 Lumi 的安全单文件 HTML 生成器。严格遵守用户消息中的创作规范，只返回完整 HTML 文档。",
        },
        { role: "user", content: buildGenerativePrompt({ kind, brief }) },
      ], {
        signal: request.signal,
        totalTimeoutMs: config.agentTimeouts.online.modelTotalTimeoutMs,
      })
    ));
    return NextResponse.json(artifact, { status: 201, headers: HEADERS });
  } catch (error) {
    return failure(error, requestId);
  } finally {
    connection?.sqlite.close();
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestProtocol(request);
    const config = readEnv(process.env);
    const session = await requireStudentSession(request, config.sessionSecret);
    await parseLimitedRequestBody(request, GenerativeResetCommandSchema, 1_024);
    connection = createDb(config.databasePath);
    return NextResponse.json(resetGenerativeWorkspace(connection, session), { headers: HEADERS });
  } catch (error) {
    return failure(error, requestId);
  } finally {
    connection?.sqlite.close();
  }
}
