// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as runPreviewRoute } from "@/app/api/preview/runs/route";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { PREVIEW_SESSION_COOKIE_NAME, issuePreviewSession } from "@/lib/preview/session";
import { createPreviewSession } from "@/lib/preview/store";

const SECRET = "preview-run-diagnostics-secret-at-least-32-characters";

function errorEvent(text: string) {
  const frame = text.split("\n\n").find((value) => value.startsWith("event: error\n"));
  if (!frame) throw new Error("preview error event was not emitted");
  const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  if (!data) throw new Error("preview error event has no data");
  return JSON.parse(data) as Record<string, unknown>;
}

describe("preview run failure diagnostics", () => {
  let root: string;
  let databasePath: string;
  let token: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "lumi-preview-diagnostics-"));
    databasePath = path.join(root, "preview.sqlite");
    runMigrations(databasePath);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("EVIDENCE_ROOT", path.join(root, "evidence"));
    vi.stubEnv("LLM_BASE_URL", undefined);
    vi.stubEnv("LLM_API_KEY", undefined);
    vi.stubEnv("LLM_MODEL", undefined);
    const connection = createDb(databasePath);
    try {
      const session = createPreviewSession(connection);
      token = await issuePreviewSession(session.id, SECRET);
    } finally {
      connection.sqlite.close();
    }
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it("returns and persists the exact safe failure classification and request id", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await runPreviewRoute(new NextRequest("http://localhost/api/preview/runs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${PREVIEW_SESSION_COOKIE_NAME}=${token}`,
        origin: "http://localhost",
      },
      body: JSON.stringify({
        scenarioId: "S1_DIGITAL_PRODUCT",
        suggestionId: "S1_PRODUCT_START",
      }),
    }));

    expect(response.status).toBe(200);
    const failure = errorEvent(await response.text());
    expect(failure).toMatchObject({
      code: "PREVIEW_MODEL_NOT_CONFIGURED",
      error: "现场模型尚未配置。请联系维护者检查模型设置后重新运行。",
      stage: "MODEL_SETUP",
      retryable: false,
    });
    expect(failure.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(failure.runId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.headers.get("x-lumi-request-id")).toBe(failure.requestId);
    expect(errorLog).toHaveBeenCalledWith(expect.objectContaining({
      requestId: failure.requestId,
      runId: failure.runId,
      route: "preview-run",
      errorCode: "PREVIEW_MODEL_NOT_CONFIGURED",
      failureStage: "MODEL_SETUP",
      retryable: false,
      errorName: "PreviewModelUnavailableError",
      httpStatus: null,
      transportCode: null,
      protocolCode: null,
    }));

    const connection = createDb(databasePath);
    try {
      expect(connection.sqlite.prepare(`
        SELECT status,error_code errorCode FROM preview_runs WHERE id=?
      `).get(failure.runId)).toEqual({
        status: "FAILED",
        errorCode: "PREVIEW_MODEL_NOT_CONFIGURED",
      });
    } finally {
      connection.sqlite.close();
    }
  });
});
