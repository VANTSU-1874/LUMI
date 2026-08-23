// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { PREVIEW_SESSION_MAX_AGE_SECONDS } from "@/lib/preview/contracts";
import {
  createPreviewSession,
  failPreviewRun,
  PreviewRunBusyError,
  PreviewRunRateLimitError,
  pruneExpiredPreviewData,
  readPreviewSession,
  startPreviewRun,
} from "@/lib/preview/store";

describe("anonymous evaluator preview store", () => {
  let root: string;
  let databasePath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "lumi-preview-store-"));
    databasePath = path.join(root, "preview.sqlite");
    runMigrations(databasePath);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("records repeated fixed-scenario runs without imposing a quota", () => {
    const connection = createDb(databasePath);
    const now = new Date("2026-07-30T00:00:00.000Z");
    try {
      const session = createPreviewSession(connection, { now });
      const runs = Array.from({ length: 4 }, () => {
        const run = startPreviewRun({
          connection,
          sessionId: session.id,
          scenarioId: "S1_DIGITAL_PRODUCT",
          now,
        });
        failPreviewRun({
          connection,
          runId: run.runId,
          sessionId: session.id,
          errorCode: "TEST_COMPLETED",
          now,
        });
        return run;
      });
      expect(runs.map(({ runId }) => runId)).toHaveLength(4);
      expect(new Set(runs.map(({ runId }) => runId)).size).toBe(4);
      expect(connection.sqlite.prepare("SELECT data_type dataType FROM preview_runs").all())
        .toEqual([
          { dataType: "DEMONSTRATION_DATA" },
          { dataType: "DEMONSTRATION_DATA" },
          { dataType: "DEMONSTRATION_DATA" },
          { dataType: "DEMONSTRATION_DATA" },
        ]);
      expect(connection.sqlite.prepare("SELECT count(*) count FROM preview_scenario_usage").get())
        .toEqual({ count: 0 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM users").get()).toEqual({ count: 0 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps anonymous safety limits server-side without exposing a scenario quota", () => {
    const connection = createDb(databasePath);
    const now = new Date("2026-07-30T00:00:00.000Z");
    try {
      const session = createPreviewSession(connection, { now });
      const active = startPreviewRun({
        connection,
        sessionId: session.id,
        scenarioId: "S1_DIGITAL_PRODUCT",
        now,
      });
      expect(() => startPreviewRun({
        connection,
        sessionId: session.id,
        scenarioId: "S2_COURSE_DESIGN",
        now,
      })).toThrow(PreviewRunBusyError);
      failPreviewRun({
        connection,
        runId: active.runId,
        sessionId: session.id,
        errorCode: "TEST_COMPLETED",
        now,
      });
      for (let index = 1; index < 12; index += 1) {
        const run = startPreviewRun({
          connection,
          sessionId: session.id,
          scenarioId: "S2_COURSE_DESIGN",
          now,
        });
        failPreviewRun({
          connection,
          runId: run.runId,
          sessionId: session.id,
          errorCode: "TEST_COMPLETED",
          now,
        });
      }
      expect(() => startPreviewRun({
        connection,
        sessionId: session.id,
        scenarioId: "S3_DESIGN_KNOWLEDGE",
        now,
      })).toThrow(PreviewRunRateLimitError);
    } finally {
      connection.sqlite.close();
    }
  });

  it("reclaims an abandoned run before accepting a new preview request", () => {
    const connection = createDb(databasePath);
    const now = new Date("2026-07-30T00:00:00.000Z");
    try {
      const session = createPreviewSession(connection, { now });
      const abandoned = startPreviewRun({
        connection,
        sessionId: session.id,
        scenarioId: "S1_DIGITAL_PRODUCT",
        now,
      });
      const later = new Date(now.getTime() + 121_000);
      const next = startPreviewRun({
        connection,
        sessionId: session.id,
        scenarioId: "S2_COURSE_DESIGN",
        now: later,
      });
      expect(next.runId).not.toBe(abandoned.runId);
      expect(connection.sqlite.prepare("SELECT status,error_code errorCode FROM preview_runs WHERE id=?").get(abandoned.runId))
        .toEqual({ status: "FAILED", errorCode: "RUN_ABANDONED" });
    } finally {
      connection.sqlite.close();
    }
  });

  it("expires a preview session and all of its transcript rows as one unit", () => {
    const connection = createDb(databasePath);
    const now = new Date("2026-07-30T00:00:00.000Z");
    try {
      const session = createPreviewSession(connection, { now });
      startPreviewRun({ connection, sessionId: session.id, scenarioId: "S5_LEARNING_EVIDENCE", now });
      const expiredAt = new Date(now.getTime() + (PREVIEW_SESSION_MAX_AGE_SECONDS + 1) * 1_000);
      expect(pruneExpiredPreviewData(connection, expiredAt)).toBe(1);
      expect(readPreviewSession(connection, session.id, expiredAt)).toBeNull();
      expect(connection.sqlite.prepare("SELECT count(*) count FROM preview_runs").get()).toEqual({ count: 0 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM preview_scenario_usage").get()).toEqual({ count: 0 });
    } finally {
      connection.sqlite.close();
    }
  });
});
