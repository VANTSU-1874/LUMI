// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { readAgentRunRow } from "@/lib/agent/runtime/agent-run-record";
import { createAgentRunStreamReporter } from "@/lib/agent/runtime/agent-run-stream-reporter";
import { currentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { createAgentRun, readAgentRunEvents } from "@/lib/agent/runtime/run-state-store";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];
const actor = { userId: "student-1", role: "STUDENT" as const };

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agent run stream reporter", () => {
  it("persists progressive text and tool progress while hiding tutor metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-stream-"));
    roots.push(root);
    const databasePath = path.join(root, "agent.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('class-1','测试班级','STREAM-TEST');
        INSERT INTO users(id,class_id,role,alias,created_at)
        VALUES('student-1','class-1','STUDENT','学生一',1700000000);
      `);
      const created = createAgentRun({
        connection,
        actor,
        request: { message: "怎么调整版式？", context: { view: "AGENT" } },
        idempotencyKey: "stream-test-1",
        runtime: currentAgentRuntime.descriptor,
      });
      const row = readAgentRunRow(connection, created.run.id);
      expect(row).toBeDefined();
      const reporter = createAgentRunStreamReporter({
        connection,
        row: row!,
        now: () => new Date("2026-07-17T12:00:00.000Z"),
      });

      reporter.onTextDelta("先把标题与正文拉开层级。<");
      reporter.onTextDelta("!--   TuToR-");
      reporter.onTextDelta("MeTa \n");
      reporter.onTextDelta('{"episode":"UNDERSTAND"}\n');
      reporter.onTextDelta("-->");
      reporter.onToolProgress({
        status: "RUNNING",
        toolId: "course-knowledge.search",
        label: "正在查阅：课程参考",
        summary: "导师正在读取与当前问题有关的课程资料。",
      });
      reporter.onToolProgress({
        status: "SUCCEEDED",
        toolId: "course-knowledge.search",
        label: "已查阅：课程参考",
        summary: "已找到与当前问题有关的课程资料。",
      });
      reporter.onToolProgress({
        status: "FAILED",
        toolId: "external-search.search",
        label: "联网检索未完成",
        summary: "本次联网检索没有返回可用结果。",
      });
      reporter.flush();

      const events = readAgentRunEvents({ connection, actor, runId: created.run.id }).events;
      expect(events.filter(({ kind }) => kind === "TOKEN").map(({ payload }) => payload.text).join(""))
        .toBe("先把标题与正文拉开层级。");
      expect(events.filter(({ kind }) => kind === "TOOL")).toMatchObject([
        {
          label: "正在查阅：课程参考",
          payload: { stepKind: "TOOL", toolId: "course-knowledge.search", toolStatus: "RUNNING" },
        },
        {
          label: "已查阅：课程参考",
          payload: { stepKind: "TOOL", toolId: "course-knowledge.search", toolStatus: "SUCCEEDED" },
        },
        {
          label: "联网检索未完成",
          payload: { stepKind: "TOOL", toolId: "external-search.search", toolStatus: "FAILED" },
        },
      ]);
      expect(JSON.stringify(events)).not.toContain("tutor-meta");
      expect(JSON.stringify(events)).not.toContain("UNDERSTAND");
    } finally {
      connection.sqlite.close();
    }
  });

  it("persists a short text fragment after the 40ms responsiveness interval", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-stream-timer-"));
    roots.push(root);
    const databasePath = path.join(root, "agent.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('class-1','测试班级','STREAM-TIMER');
        INSERT INTO users(id,class_id,role,alias,created_at)
        VALUES('student-1','class-1','STUDENT','学生一',1700000000);
      `);
      const created = createAgentRun({
        connection,
        actor,
        request: { message: "怎么调整版式？", context: { view: "AGENT" } },
        idempotencyKey: "stream-timer-test-1",
        runtime: currentAgentRuntime.descriptor,
      });
      const row = readAgentRunRow(connection, created.run.id);
      expect(row).toBeDefined();
      const reporter = createAgentRunStreamReporter({
        connection,
        row: row!,
        now: () => new Date("2026-07-17T12:00:00.000Z"),
      });
      const answer = "这是一段没有句末标点的短流式回答";

      vi.useFakeTimers();
      reporter.onTextDelta(answer);
      vi.advanceTimersByTime(39);
      expect(readAgentRunEvents({ connection, actor, runId: created.run.id }).events)
        .not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: "TOKEN" })]));

      vi.advanceTimersByTime(1);
      const responsiveEvents = readAgentRunEvents({ connection, actor, runId: created.run.id }).events;
      const responsiveText = responsiveEvents
        .filter(({ kind }) => kind === "TOKEN")
        .map(({ payload }) => payload.text ?? "")
        .join("");
      expect(responsiveText.length).toBeGreaterThan(0);
      expect(answer.startsWith(responsiveText)).toBe(true);

      reporter.flush();
      const completedText = readAgentRunEvents({ connection, actor, runId: created.run.id }).events
        .filter(({ kind }) => kind === "TOKEN")
        .map(({ payload }) => payload.text ?? "")
        .join("");
      expect(completedText).toBe(answer);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      connection.sqlite.close();
    }
  });

  it("records throttled model liveness without persisting hidden reasoning", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-stream-liveness-"));
    roots.push(root);
    const databasePath = path.join(root, "agent.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('class-1','测试班级','STREAM-LIVE');
        INSERT INTO users(id,class_id,role,alias,created_at)
        VALUES('student-1','class-1','STUDENT','学生一',1700000000);
      `);
      const created = createAgentRun({
        connection,
        actor,
        request: { message: "怎么调整版式？", context: { view: "AGENT" } },
        idempotencyKey: "stream-liveness-test-1",
        runtime: currentAgentRuntime.descriptor,
      });
      const timestamps = [
        new Date("2026-07-17T12:00:00.000Z"),
        new Date("2026-07-17T12:00:00.500Z"),
        new Date("2026-07-17T12:00:01.000Z"),
      ];
      const reporter = createAgentRunStreamReporter({
        connection,
        row: readAgentRunRow(connection, created.run.id)!,
        now: () => timestamps.shift() ?? new Date("2026-07-17T12:00:01.000Z"),
      });

      reporter.onModelActivity();
      reporter.onModelActivity();
      reporter.onModelActivity();

      const events = readAgentRunEvents({ connection, actor, runId: created.run.id }).events;
      expect(events.filter(({ kind }) => kind === "STEP")).toMatchObject([
        { label: "理解你的问题", payload: { stepKind: "MODEL" } },
        { label: "理解你的问题", payload: { stepKind: "MODEL" } },
      ]);
      expect(events.some(({ payload }) => payload.text)).toBe(false);
    } finally {
      connection.sqlite.close();
    }
  });
});
