import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";

import { ForbiddenRequestError } from "@/lib/auth/errors";
import { validateRequestSource } from "@/lib/auth/route-handler";
import {
  requireTeacherSession,
  TeacherRoleForbiddenError,
  TeacherSessionRequiredError,
} from "@/lib/auth/teacher-session";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import {
  getAgentEvidenceRuntimeResourceReportV2,
} from "@/lib/knowledge/agent-evidence-runtime-v2";
import {
  KnowledgeV2CanaryObservationForbiddenError,
  readKnowledgeV2CanaryObservation,
} from "@/lib/knowledge/knowledge-v2-canary-observability";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};
const DEFAULT_WINDOW_MINUTES = 30;
const MAX_WINDOW_MINUTES = 240;

class InvalidCanaryWindowError extends Error {
  constructor() {
    super("windowMinutes参数无效");
    this.name = "InvalidCanaryWindowError";
  }
}

function windowMinutesFromQuery(value: string | null) {
  if (value === null) return DEFAULT_WINDOW_MINUTES;
  if (!/^[1-9]\d*$/.test(value)) throw new InvalidCanaryWindowError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_WINDOW_MINUTES) {
    throw new InvalidCanaryWindowError();
  }
  return parsed;
}

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  let connection: DatabaseConnection | undefined;
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    const session = await requireTeacherSession(request, config.sessionSecret);
    connection = createDb(config.databasePath);
    const observation = readKnowledgeV2CanaryObservation(
      connection.db,
      session,
      {
        canaryUserIds: config.knowledgeV2CanaryUserIds,
        now: new Date(),
        windowMinutes: windowMinutesFromQuery(
          request.nextUrl.searchParams.get("windowMinutes"),
        ),
      },
    );
    let liveRuntime: {
      status: "AVAILABLE" | "NOT_INITIALIZED" | "UNAVAILABLE";
      cacheEntries: number;
      circuitStates: Array<{
        text: "CLOSED" | "OPEN" | "HALF_OPEN";
        visual: "CLOSED" | "OPEN" | "HALF_OPEN" | null;
      }>;
    };
    try {
      const resources = await getAgentEvidenceRuntimeResourceReportV2();
      liveRuntime = {
        status: resources.runtimeCacheEntries > 0 ? "AVAILABLE" : "NOT_INITIALIZED",
        cacheEntries: resources.runtimeCacheEntries,
        circuitStates: resources.runtimes.map(({ channels }) => ({
          text: channels.TEXT_VECTOR.state,
          visual: channels.VISUAL_VECTOR?.state ?? null,
        })),
      };
    } catch {
      liveRuntime = {
        status: "UNAVAILABLE",
        cacheEntries: 0,
        circuitStates: [],
      };
    }
    return NextResponse.json({ observation, liveRuntime }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof TeacherSessionRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401, headers: PRIVATE_HEADERS });
    }
    if (
      error instanceof TeacherRoleForbiddenError
      || error instanceof KnowledgeV2CanaryObservationForbiddenError
      || error instanceof ForbiddenRequestError
    ) {
      return NextResponse.json({ error: error.message }, { status: 403, headers: PRIVATE_HEADERS });
    }
    if (error instanceof InvalidCanaryWindowError || error instanceof ZodError) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: PRIVATE_HEADERS });
    }
    console.error({
      requestId,
      route: "teacher-knowledge-canary",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "知识灰度观察暂时不可用" }, { status: 500, headers: PRIVATE_HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}
