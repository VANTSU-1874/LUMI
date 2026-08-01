// @vitest-environment node

import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/route";
import { resetPublicHealthCacheForTests } from "@/app/api/health/state";
import { CURRENT_AGENT_HARNESS_VERSION, REQUIRED_AGENT_HARNESS_CASES } from "@/lib/agent/harness";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { agentHarnessNotRun, agentQualityNotRun, writePassingAgentHarnessReport, writePassingAgentQualityReport } from "@/tests/helpers/agent-release-report-fixtures";

const temporaryDirectories: string[] = [];
function validEnvironment(databasePath: string) {
  return {
    SESSION_SECRET: "health-session-secret-at-least-32-characters",
    DATABASE_PATH: databasePath,
    EVIDENCE_ROOT: path.join(path.dirname(databasePath), "evidence"),
    AGENT_EVAL_REPORT_PATH: path.join(path.dirname(databasePath), "missing-agent-eval.json"),
    AGENT_HARNESS_REPORT_PATH: path.join(path.dirname(databasePath), "missing-agent-harness.json"),
    TEACHER_ACCESS_CODE: "health-teacher-code",
  };
}

async function temporaryDatabase(name = "health.sqlite") {
  const directory = await mkdtemp(path.join(tmpdir(), "tonggan-health-"));
  temporaryDirectories.push(directory);
  return path.join(directory, name);
}

function setEnvironment(environment: Record<string, string>) {
  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
  for (const name of [
    "LLM_BASE_URL",
    "LLM_API_KEY",
    "LLM_MODEL",
    "LLM_EMBEDDING_BASE_URL",
    "LLM_EMBEDDING_API_KEY",
    "LLM_EMBEDDING_MODEL",
    "LLM_MAX_OUTPUT_TOKENS",
  ]) {
    if (!(name in environment)) vi.stubEnv(name, undefined);
  }
  if (!("AGENT_EVAL_REPORT_PATH" in environment)) vi.stubEnv("AGENT_EVAL_REPORT_PATH", undefined);
  if (!("AGENT_HARNESS_REPORT_PATH" in environment)) vi.stubEnv("AGENT_HARNESS_REPORT_PATH", undefined);
}

afterEach(async () => {
  resetPublicHealthCacheForTests();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("GET /api/health", () => {
  it("reports a migrated empty database with a stable public shape and no-store caching", async () => {
    const databasePath = await temporaryDatabase();
    runMigrations(databasePath);
    setEnvironment(validEnvironment(databasePath));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      database: { available: true },
      knowledge: {
        chunkCount: 0,
        coursePacks: { "general-design@1": 0, "digital-interaction@1": 0, "book-design@1": 0 },
      },
      aiConfigured: false,
      agentV2Enabled: true,
      agentQuality: agentQualityNotRun,
      agentHarness: agentHarnessNotRun,
      competitionReady: false,
    });
  });

  it("counts knowledge chunks and reports only whether a complete AI configuration exists", async () => {
    const databasePath = await temporaryDatabase();
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO knowledge_chunks (id, source, title, tags, content)
      VALUES ('health-1', 'course', 'one', '[]', 'one'),
             ('health-2', 'course', 'two', '[]', 'two');
    `);
    connection.sqlite.close();
    const environment = {
      ...validEnvironment(databasePath),
      LLM_BASE_URL: "https://model.example.edu/v1",
      LLM_API_KEY: "health-model-secret-value",
      LLM_MODEL: "course-model",
    };
    setEnvironment(environment);

    const response = await GET();
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(JSON.parse(serialized)).toEqual({
      status: "ok",
      database: { available: true },
      knowledge: {
        chunkCount: 2,
        coursePacks: { "general-design@1": 0, "digital-interaction@1": 2, "book-design@1": 0 },
      },
      aiConfigured: true,
      agentV2Enabled: true,
      agentQuality: agentQualityNotRun,
      agentHarness: agentHarnessNotRun,
      competitionReady: false,
    });
    for (const sensitive of Object.values(environment)) {
      expect(serialized).not.toContain(sensitive);
    }
  });

  it("marks the competition runtime ready only when AI, all course packs, Eval and Harness are available", async () => {
    const databasePath = await temporaryDatabase();
    const qualityReportPath = await writePassingAgentQualityReport(path.dirname(databasePath));
    const harnessReportPath = await writePassingAgentHarnessReport(path.dirname(databasePath));
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO knowledge_chunks (id, source, title, tags, content, course_pack_id, course_pack_version, namespace)
      VALUES ('ready-general', 'course', 'general', '[]', 'general', 'general-design', '1', 'design-foundations'),
             ('ready-digital', 'course', 'digital', '[]', 'digital', 'digital-interaction', '1', 'interaction-principles'),
             ('ready-book', 'course', 'book', '[]', 'book', 'book-design', '1', 'book-design-principles');
    `);
    connection.sqlite.close();
    setEnvironment({
      ...validEnvironment(databasePath),
      LLM_BASE_URL: "https://model.example.edu/v1",
      LLM_API_KEY: "health-model-secret-value",
      LLM_MODEL: "course-model",
      AGENT_EVAL_REPORT_PATH: qualityReportPath,
      AGENT_HARNESS_REPORT_PATH: harnessReportPath,
    });

    expect(await (await GET()).json()).toMatchObject({
      knowledge: { coursePacks: { "general-design@1": 1, "digital-interaction@1": 1, "book-design@1": 1 } },
      aiConfigured: true,
      agentV2Enabled: true,
      agentQuality: { status: "passed", caseCount: 30, passedCaseCount: 30, modelAssistedRate: 1 },
      agentHarness: {
        status: "passed",
        harnessVersion: CURRENT_AGENT_HARNESS_VERSION,
        caseCount: REQUIRED_AGENT_HARNESS_CASES.length,
        passedCaseCount: REQUIRED_AGENT_HARNESS_CASES.length,
      },
      competitionReady: true,
    });
  });

  it("keeps competition readiness closed when Eval passes but the Harness report is missing", async () => {
    const databasePath = await temporaryDatabase();
    const qualityReportPath = await writePassingAgentQualityReport(path.dirname(databasePath));
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO knowledge_chunks (id, source, title, tags, content, course_pack_id, course_pack_version, namespace)
      VALUES ('closed-general', 'course', 'general', '[]', 'general', 'general-design', '1', 'design-foundations'),
             ('closed-digital', 'course', 'digital', '[]', 'digital', 'digital-interaction', '1', 'interaction-principles'),
             ('closed-book', 'course', 'book', '[]', 'book', 'book-design', '1', 'book-design-principles');
    `);
    connection.sqlite.close();
    setEnvironment({
      ...validEnvironment(databasePath),
      LLM_BASE_URL: "https://model.example.edu/v1",
      LLM_API_KEY: "health-model-secret-value",
      LLM_MODEL: "course-model",
      AGENT_EVAL_REPORT_PATH: qualityReportPath,
    });

    expect(await (await GET()).json()).toMatchObject({
      agentQuality: { status: "passed" },
      agentHarness: { status: "not_run" },
      competitionReady: false,
    });
  });

  it("returns a stable degraded response when the database cannot be opened", async () => {
    const databasePath = path.join(await temporaryDatabase("missing"), "course.sqlite");
    setEnvironment(validEnvironment(databasePath));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "degraded",
      database: { available: false },
      knowledge: {
        chunkCount: null,
        coursePacks: { "general-design@1": null, "digital-interaction@1": null, "book-design@1": null },
      },
      aiConfigured: false,
      agentV2Enabled: true,
      agentQuality: agentQualityNotRun,
      agentHarness: agentHarnessNotRun,
      competitionReady: false,
    });
  });

  it("keeps database availability separate when the knowledge query fails", async () => {
    const databasePath = await temporaryDatabase();
    new Database(databasePath).close();
    setEnvironment(validEnvironment(databasePath));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "degraded",
      database: { available: true },
      knowledge: {
        chunkCount: null,
        coursePacks: { "general-design@1": null, "digital-interaction@1": null, "book-design@1": null },
      },
      aiConfigured: false,
      agentV2Enabled: true,
      agentQuality: agentQualityNotRun,
      agentHarness: agentHarnessNotRun,
      competitionReady: false,
    });
  });

  it("fails fast rather than waiting on a locked database", async () => {
    const databasePath = await temporaryDatabase();
    runMigrations(databasePath);
    const locker = new Database(databasePath);
    locker.pragma("journal_mode = DELETE");
    locker.exec("BEGIN EXCLUSIVE");
    setEnvironment(validEnvironment(databasePath));
    const started = performance.now();
    try {
      const response = await GET();
      expect(response.status).toBe(503);
      expect(performance.now() - started).toBeLessThan(1_500);
      expect(await response.json()).toMatchObject({ status: "degraded" });
    } finally {
      locker.exec("ROLLBACK");
      locker.close();
    }
  });

  it("bounds eight locked-database checks by probing once and caching the degraded result", async () => {
    const databasePath = await temporaryDatabase();
    runMigrations(databasePath);
    const locker = new Database(databasePath);
    locker.pragma("journal_mode = DELETE");
    locker.exec("BEGIN EXCLUSIVE");
    setEnvironment(validEnvironment(databasePath));
    const started = performance.now();
    try {
      const responses = [];
      for (let index = 0; index < 8; index += 1) responses.push(await GET());
      expect(responses.every((response) => response.status === 503)).toBe(true);
      expect(performance.now() - started).toBeLessThan(500);
    } finally {
      locker.exec("ROLLBACK");
      locker.close();
    }

    // The unlocked database is deliberately not re-probed inside the short degraded TTL.
    expect((await GET()).status).toBe(503);
    resetPublicHealthCacheForTests();
    expect((await GET()).status).toBe(200);
  });

  it("separates cache entries by resolved database path and AI-enabled state", async () => {
    const firstPath = await temporaryDatabase("first.sqlite");
    const secondPath = await temporaryDatabase("second.sqlite");
    runMigrations(firstPath);
    runMigrations(secondPath);
    const connection = createDb(secondPath);
    connection.sqlite.exec(`
      INSERT INTO knowledge_chunks (id, source, title, tags, content)
      VALUES ('cache-key', 'course', 'one', '[]', 'one');
    `);
    connection.sqlite.close();

    setEnvironment(validEnvironment(firstPath));
    expect(await (await GET()).json()).toMatchObject({ knowledge: { chunkCount: 0 }, aiConfigured: false });

    setEnvironment({
      ...validEnvironment(secondPath),
      LLM_BASE_URL: "https://model.example.edu/v1",
      LLM_API_KEY: "health-model-secret-value",
      LLM_MODEL: "course-model",
    });
    expect(await (await GET()).json()).toMatchObject({ knowledge: { chunkCount: 1 }, aiConfigured: true });

    setEnvironment(validEnvironment(secondPath));
    expect(await (await GET()).json()).toMatchObject({ knowledge: { chunkCount: 1 }, aiConfigured: false });
  });

  it("recovers from a cached degraded result after its one-second TTL", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const databasePath = await temporaryDatabase();
    setEnvironment(validEnvironment(databasePath));

    expect((await GET()).status).toBe(503);
    runMigrations(databasePath);
    now = 1_999;
    expect((await GET()).status).toBe(503);
    now = 2_001;
    expect((await GET()).status).toBe(200);
  });
});
