import { randomUUID } from "node:crypto";

import type { DatabaseConnection } from "@/lib/db/client";

import {
  PREVIEW_SESSION_MAX_AGE_SECONDS,
  type PreviewResponse,
  type PreviewScenarioId,
} from "./contracts";

type PreviewSessionRow = {
  id: string;
  createdAt: number;
  expiresAt: number;
};

const PREVIEW_RUN_STALE_AFTER_SECONDS = 2 * 60;
const PREVIEW_RUN_RATE_WINDOW_SECONDS = 60;
const PREVIEW_RUN_RATE_LIMIT = 12;
const PREVIEW_RUN_SESSION_LIMIT = 100;

export class PreviewSessionNotFoundError extends Error {
  constructor() {
    super("预览会话已失效，请刷新页面后重试");
    this.name = "PreviewSessionNotFoundError";
  }
}

export class PreviewRunBusyError extends Error {
  constructor() {
    super("上一条预览回答仍在生成，请稍候");
    this.name = "PreviewRunBusyError";
  }
}

export class PreviewRunRateLimitError extends Error {
  constructor() {
    super("预览请求过于频繁，请稍后再试");
    this.name = "PreviewRunRateLimitError";
  }
}

function epochSeconds(now: Date) {
  return Math.floor(now.getTime() / 1_000);
}

function sessionRow(
  connection: DatabaseConnection,
  sessionId: string,
  now: Date,
) {
  return connection.sqlite.prepare(`
    SELECT id, created_at createdAt, expires_at expiresAt
    FROM preview_sessions WHERE id=? AND expires_at>?
  `).get(sessionId, epochSeconds(now)) as PreviewSessionRow | undefined;
}

export function pruneExpiredPreviewData(connection: DatabaseConnection, now = new Date()) {
  return connection.sqlite.prepare("DELETE FROM preview_sessions WHERE expires_at<=?")
    .run(epochSeconds(now)).changes;
}

export function createPreviewSession(
  connection: DatabaseConnection,
  input: { sessionId?: string; now?: Date } = {},
) {
  const now = input.now ?? new Date();
  const createdAt = epochSeconds(now);
  const expiresAt = createdAt + PREVIEW_SESSION_MAX_AGE_SECONDS;
  const sessionId = input.sessionId ?? randomUUID();
  connection.sqlite.transaction(() => {
    pruneExpiredPreviewData(connection, now);
    connection.sqlite.prepare(`
      INSERT INTO preview_sessions(id,created_at,expires_at,data_type)
      VALUES(?,?,?,'DEMONSTRATION_DATA')
    `).run(sessionId, createdAt, expiresAt);
  }).immediate();
  return { id: sessionId, createdAt: new Date(createdAt * 1_000), expiresAt: new Date(expiresAt * 1_000) };
}

export function readPreviewSession(
  connection: DatabaseConnection,
  sessionId: string,
  now = new Date(),
) {
  const session = sessionRow(connection, sessionId, now);
  if (!session) return null;
  return {
    id: session.id,
    createdAt: new Date(session.createdAt * 1_000),
    expiresAt: new Date(session.expiresAt * 1_000),
  };
}

export function startPreviewRun(input: {
  connection: DatabaseConnection;
  sessionId: string;
  scenarioId: PreviewScenarioId;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const nowSeconds = epochSeconds(now);
  let runId = "";
  input.connection.sqlite.transaction(() => {
    pruneExpiredPreviewData(input.connection, now);
    const session = sessionRow(input.connection, input.sessionId, now);
    if (!session) throw new PreviewSessionNotFoundError();
    input.connection.sqlite.prepare(`
      UPDATE preview_runs
      SET status='FAILED',error_code='RUN_ABANDONED',updated_at=?
      WHERE session_id=? AND status='RUNNING' AND updated_at<=?
    `).run(
      nowSeconds,
      input.sessionId,
      nowSeconds - PREVIEW_RUN_STALE_AFTER_SECONDS,
    );
    const running = input.connection.sqlite.prepare(`
      SELECT 1 FROM preview_runs
      WHERE session_id=? AND status='RUNNING'
      LIMIT 1
    `).get(input.sessionId);
    if (running) throw new PreviewRunBusyError();
    const recent = input.connection.sqlite.prepare(`
      SELECT count(*) count FROM preview_runs
      WHERE session_id=? AND created_at>?
    `).get(
      input.sessionId,
      nowSeconds - PREVIEW_RUN_RATE_WINDOW_SECONDS,
    ) as { count: number };
    const total = input.connection.sqlite.prepare(`
      SELECT count(*) count FROM preview_runs WHERE session_id=?
    `).get(input.sessionId) as { count: number };
    if (recent.count >= PREVIEW_RUN_RATE_LIMIT || total.count >= PREVIEW_RUN_SESSION_LIMIT) {
      throw new PreviewRunRateLimitError();
    }
    // Every invocation is retained in preview_runs as demonstration data. The
    // legacy per-scenario counter is intentionally not updated: its database
    // constraint represented the retired three-run quota.
    runId = randomUUID();
    input.connection.sqlite.prepare(`
      INSERT INTO preview_runs(
        id,session_id,scenario_id,status,response_json,error_code,
        created_at,updated_at,expires_at,data_type
      ) VALUES(?,?,?,'RUNNING',NULL,NULL,?,?,?,'DEMONSTRATION_DATA')
    `).run(runId, input.sessionId, input.scenarioId, nowSeconds, nowSeconds, session.expiresAt);
  }).immediate();
  return { runId };
}

export function hasCompletedPreviewRun(input: {
  connection: DatabaseConnection;
  sessionId: string;
  scenarioId: PreviewScenarioId;
}) {
  const row = input.connection.sqlite.prepare(`
    SELECT 1
    FROM preview_runs
    WHERE session_id=? AND scenario_id=? AND status='COMPLETED'
    LIMIT 1
  `).get(input.sessionId, input.scenarioId) as { 1: number } | undefined;
  return Boolean(row);
}

export function completePreviewRun(input: {
  connection: DatabaseConnection;
  runId: string;
  sessionId: string;
  response: PreviewResponse;
  now?: Date;
}) {
  const result = input.connection.sqlite.prepare(`
    UPDATE preview_runs
    SET status='COMPLETED',response_json=?,error_code=NULL,updated_at=?
    WHERE id=? AND session_id=? AND status='RUNNING'
  `).run(JSON.stringify(input.response), epochSeconds(input.now ?? new Date()), input.runId, input.sessionId);
  if (result.changes !== 1) throw new PreviewSessionNotFoundError();
}

export function failPreviewRun(input: {
  connection: DatabaseConnection;
  runId: string;
  sessionId: string;
  errorCode: string;
  now?: Date;
}) {
  input.connection.sqlite.prepare(`
    UPDATE preview_runs
    SET status='FAILED',error_code=?,updated_at=?
    WHERE id=? AND session_id=? AND status='RUNNING'
  `).run(input.errorCode, epochSeconds(input.now ?? new Date()), input.runId, input.sessionId);
}
