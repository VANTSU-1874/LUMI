import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { ForbiddenRequestError } from "@/lib/auth/errors";
import { requireStudentSession, studentAwareForbiddenPayload, StudentRoleForbiddenError, StudentSessionRequiredError } from "@/lib/auth/project-session";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { AgentRunNotFoundError, readAgentRun, readAgentRunEvents } from "@/lib/agent/runtime/run-state-store";

const JSON_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const ParamsSchema = z.object({ runId: z.string().uuid() }).strict();
const QuerySchema = z.object({ after: z.coerce.number().int().min(0).default(0) }).strict();
const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

function encodeEvent(event: { sequence: number; [key: string]: unknown }) {
  return `id: ${event.sequence}\nevent: agent-run-event\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    if (!config.agentV2Enabled) return NextResponse.json({ error: "新版智能体暂未启用" }, { status: 404, headers: JSON_HEADERS });
    const actor = await requireStudentSession(request, config.sessionSecret);
    const { runId } = ParamsSchema.parse(await context.params);
    const query = QuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    const headerSequence = z.coerce.number().int().min(0).catch(0).parse(request.headers.get("last-event-id") ?? 0);
    let afterSequence = Math.max(query.after, headerSequence);
    connection = createDb(config.databasePath);
    readAgentRun(connection, actor, runId);
    connection.sqlite.close();
    connection = undefined;

    const encoder = new TextEncoder();
    let closeStream: () => void = () => undefined;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const streamConnection = createDb(config.databasePath);
        let closed = false;
        let heartbeatAt = Date.now();
        let consecutiveEmptyPages = 0;
        const close = () => {
          if (closed) return;
          closed = true;
          streamConnection.sqlite.close();
          try { controller.close(); } catch { /* the browser may have closed first */ }
        };
        closeStream = close;
        request.signal.addEventListener("abort", close, { once: true });
        try {
          while (!closed && !request.signal.aborted) {
            const page = readAgentRunEvents({
              connection: streamConnection,
              actor,
              runId,
              afterSequence,
              limit: 100,
            });
            for (const event of page.events) {
              if (closed) break;
              controller.enqueue(encoder.encode(encodeEvent(event)));
              afterSequence = event.sequence;
            }
            consecutiveEmptyPages = page.events.length === 0 ? consecutiveEmptyPages + 1 : 0;
            const run = readAgentRun(streamConnection, actor, runId);
            if (TERMINAL.has(run.status) && page.events.length === 0) break;
            if (Date.now() - heartbeatAt >= 10_000) {
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
              heartbeatAt = Date.now();
            }
            const pollDelay = page.events.length > 0 || consecutiveEmptyPages < 5
              ? 100
              : consecutiveEmptyPages < 15
                ? 250
                : 500;
            await new Promise<void>((resolve) => setTimeout(resolve, pollDelay));
          }
        } catch {
          if (!closed) controller.enqueue(encoder.encode("event: transport-error\ndata: {\"retry\":true}\n\n"));
        } finally {
          close();
        }
      },
      cancel() {
        closeStream();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "private, no-store, no-transform",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
        Vary: "Cookie",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "事件流参数无效" }, { status: 400, headers: JSON_HEADERS });
    if (error instanceof StudentSessionRequiredError) return NextResponse.json({ error: error.message }, { status: 401, headers: JSON_HEADERS });
    if (error instanceof StudentRoleForbiddenError || error instanceof ForbiddenRequestError) {
      return NextResponse.json(studentAwareForbiddenPayload(error), { status: 403, headers: JSON_HEADERS });
    }
    if (error instanceof AgentRunNotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers: JSON_HEADERS });
    console.error({ requestId, route: "agent-run-event-stream", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "暂时无法建立运行事件流" }, { status: 500, headers: JSON_HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}
