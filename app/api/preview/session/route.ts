import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { ForbiddenRequestError } from "@/lib/auth/errors";
import { validateRequestSource } from "@/lib/auth/route-handler";
import { readEnv } from "@/lib/config/env";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { PREVIEW_SESSION_MAX_AGE_SECONDS } from "@/lib/preview/contracts";
import { listPreviewScenarios } from "@/lib/preview/scenarios";
import {
  createPreviewSession,
  readPreviewSession,
} from "@/lib/preview/store";
import {
  issuePreviewSession,
  PREVIEW_SESSION_COOKIE_NAME,
  verifyPreviewSession,
} from "@/lib/preview/session";

export const runtime = "nodejs";

const HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "x-lumi-data-type": "DEMONSTRATION_DATA",
};

function publicSession(session: NonNullable<ReturnType<typeof readPreviewSession>>) {
  return {
    expiresAt: session.expiresAt.toISOString(),
    scenarios: listPreviewScenarios(session.id).map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      capability: scenario.capability,
      description: scenario.description,
      sourceLabel: scenario.sourceLabel,
      initial: {
        ...scenario.initial,
        attachments: scenario.initial.attachments?.map(({ id, label, alt, url }) => ({ id, label, alt, url })) ?? [],
      },
      suggestions: scenario.suggestions.map((suggestion) => ({
        id: suggestion.id,
        label: suggestion.label,
        prompt: suggestion.prompt,
        outcome: suggestion.outcome,
        attachments: suggestion.attachments?.map(({ id, label, alt, url }) => ({ id, label, alt, url })) ?? [],
      })),
    })),
  };
}
export async function POST(request: NextRequest) {
  let connection: DatabaseConnection | undefined;
  const requestId = randomUUID();
  try {
    validateRequestSource(request);
    const config = readEnv(process.env);
    connection = createDb(config.databasePath);
    const now = new Date();
    const token = request.cookies.get(PREVIEW_SESSION_COOKIE_NAME)?.value;
    let session = null;
    if (token) {
      try {
        const payload = await verifyPreviewSession(token, config.sessionSecret, now);
        session = readPreviewSession(connection, payload.sessionId, now);
      } catch {
        // An expired or malformed anonymous cookie simply starts a fresh,
        // non-identifying preview session.
      }
    }
    let issuedToken: string | null = null;
    if (!session) {
      const created = createPreviewSession(connection, { now });
      session = readPreviewSession(connection, created.id, now);
      if (!session) throw new Error("preview session was not persisted");
      issuedToken = await issuePreviewSession(created.id, config.sessionSecret, now);
    }
    const response = NextResponse.json(publicSession(session), { headers: HEADERS });
    if (issuedToken) {
      response.cookies.set(PREVIEW_SESSION_COOKIE_NAME, issuedToken, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: PREVIEW_SESSION_MAX_AGE_SECONDS,
        secure: process.env.NODE_ENV === "production",
      });
    }
    return response;
  } catch (error) {
    if (error instanceof ForbiddenRequestError) {
      return NextResponse.json({ error: error.message }, { status: 403, headers: HEADERS });
    }
    console.error({ requestId, route: "preview-session", errorName: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "预览会话暂时不可用" }, { status: 500, headers: HEADERS });
  } finally {
    connection?.sqlite.close();
  }
}
