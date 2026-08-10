import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { BadRequestError, ForbiddenRequestError, PayloadTooLargeError, UnsupportedMediaTypeError } from "@/lib/auth/errors";
import { requireStudentSession, studentAwareForbiddenPayload, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { resolveKnowledgeV2CanaryScope } from "@/lib/knowledge/knowledge-v2-canary";
import { parseAgentTurnRequest } from "@/lib/agent/artwork-request";
import { DesignTaskArchivedError, DesignTaskForbiddenError, DesignTaskNotFoundError } from "@/lib/agent/design-project-task";
import { DesignAgentKernel } from "@/lib/agent/design-agent-kernel";
import { AgentConflictError, AgentForbiddenError, AgentNotFoundError } from "@/lib/agent/orchestrator";
import { getActiveAgentPolicy, resolveAgentPolicyTimeouts } from "@/lib/agent/policy-registry";
import { ImageTooLargeError, InvalidImageError } from "@/lib/security/uploads";

const HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: HEADERS });
    const session = await requireStudentSession(request, config.sessionSecret);
    const knowledgeV2 = resolveKnowledgeV2CanaryScope({
      userId: session.userId,
      canaryUserIds: config.knowledgeV2CanaryUserIds,
      flags: {
        knowledgeObjectV2: config.knowledgeObjectV2Enabled,
        visualRetrieval: config.visualRetrievalEnabled,
        evidenceBundleV2: config.evidenceBundleV2Enabled,
      },
    }).flags;
    const { input, artwork } = await parseAgentTurnRequest(request);
    connection = createDb(config.databasePath);
    const result = await new DesignAgentKernel(connection, session, {
      ai: config.ai,
      artworkRoot: config.evidenceRoot,
      policy: resolveAgentPolicyTimeouts(
        getActiveAgentPolicy(),
        config.agentTimeouts.online,
      ),
      knowledgeObjectV2Enabled: knowledgeV2.knowledgeObjectV2,
      visualRetrievalEnabled: knowledgeV2.visualRetrieval,
      evidenceBundleV2Enabled: knowledgeV2.evidenceBundleV2,
    }).run(input, artwork);
    return NextResponse.json(result, { status: 201, headers: HEADERS });
  } catch (error) {
    if (error instanceof BadRequestError) return NextResponse.json({ error: error.message }, { status: 400, headers: HEADERS });
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
    if (error instanceof ImageTooLargeError) return NextResponse.json({ error: error.message }, { status: 413, headers: HEADERS });
    if (error instanceof InvalidImageError) return NextResponse.json({ error: error.message }, { status: 400, headers: HEADERS });
    if (error instanceof UnsupportedMediaTypeError) return NextResponse.json({ error: error.message }, { status: 415, headers: HEADERS });
    if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: HEADERS });
    if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError || error instanceof AgentForbiddenError) return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: HEADERS });
    if (error instanceof AgentNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    if (error instanceof DesignTaskForbiddenError) return NextResponse.json({ error: error.message }, { status: 403, headers: HEADERS });
    if (error instanceof DesignTaskNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: HEADERS });
    if (error instanceof DesignTaskArchivedError) return NextResponse.json({ error: error.message }, { status: 409, headers: HEADERS });
    if (error instanceof AgentConflictError) return NextResponse.json({ error: error.message }, { status: 409, headers: HEADERS });
    console.error({ requestId, route: "agent-turn", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "智能体暂时不可用，输入已保留在当前页面" }, { status: 500, headers: HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}
