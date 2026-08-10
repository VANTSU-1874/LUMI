// @vitest-environment node

import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CURRENT_QUESTION_SET_VERSION,
  QUESTION_SETS,
} from "@/data/diagnostic/questions";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { auditEvents, learnerProfiles, projects } from "@/lib/db/schema";
import { completeDiagnosticProfile } from "@/lib/services/diagnostic-profile";
import { readStudentDashboard } from "@/lib/services/student-dashboard";
import { readLearnerDetail } from "@/lib/services/teacher-analytics";

const QUESTIONS = QUESTION_SETS.v1;

function answersForScore(score: 1 | 2 | 3 | 4) {
  return QUESTIONS.map((question) => ({
    questionId: question.id,
    optionId: question.options.find((option) => option.score === score)!.id,
  }));
}

function answersForHalfScore(lower: 1 | 2 | 3, upper: 2 | 3 | 4) {
  const dimensionCounts = new Map<string, number>();
  return QUESTIONS.map((question) => {
    const occurrence = dimensionCounts.get(question.dimension) ?? 0;
    dimensionCounts.set(question.dimension, occurrence + 1);
    const score = occurrence === 0 ? lower : upper;
    return {
      questionId: question.id,
      optionId: question.options.find((option) => option.score === score)!.id,
    };
  });
}

function seedAssignment(connection: DatabaseConnection) {
  connection.sqlite.exec(`
    INSERT OR IGNORE INTO course_modules(id,class_id,sequence,title,hours,focus)
      VALUES('module-1','class-1',1,'学习诊断',8,'诊断后进入六元逻辑卡');
    INSERT OR IGNORE INTO assignments(id,class_id,module_id,title,brief,allowed_tools,created_at)
      VALUES('assignment-1','class-1','module-1','诊断任务','完成诊断后进入逻辑卡','["DIGISHOW"]',1700000000);
  `);
}

function insertProject(
  connection: DatabaseConnection,
  values: { id: string; studentId: string; stage?: string; createdAt?: number; updatedAt?: number },
) {
  seedAssignment(connection);
  connection.sqlite.prepare(`
    INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at)
    VALUES(?,'class-1','assignment-1',?,?,?,?)
  `).run(
    values.id,
    values.studentId,
    values.stage ?? "DIAGNOSTIC",
    values.createdAt ?? 1700000000,
    values.updatedAt ?? 1700000000,
  );
}

async function waitForFile(filePath: string) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      await access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function spawnDiagnosticWorker(
  databasePath: string,
  readyPath: string,
  startPath: string,
  score: 1 | 2 | 3 | 4,
) {
  const cliPath = path.resolve("node_modules/tsx/dist/cli.mjs");
  const workerPath = path.resolve("tests/helpers/diagnostic-profile-worker.ts");
  const child = spawn(process.execPath, [
    cliPath,
    workerPath,
    databasePath,
    readyPath,
    startPath,
    String(score),
  ]);
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  const completed = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`worker exited ${code}: ${stderr}`));
    });
  });
  return { completed };
}

describe("completeDiagnosticProfile", () => {
  let temporaryDirectory: string;
  let databasePath: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "tonggan-diagnostic-profile-"));
    databasePath = path.join(temporaryDirectory, "profile.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite
      .prepare("INSERT INTO classes (id, name, access_code) VALUES (?, ?, ?)")
      .run("class-1", "一班", "CLASS001");
    connection.sqlite
      .prepare(
        "INSERT INTO users (id, class_id, role, alias, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("student-1", "class-1", "STUDENT", "匿名-001", Date.now());
    connection.sqlite
      .prepare(
        "INSERT INTO users (id, class_id, role, alias, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("teacher-1", "class-1", "TEACHER", "教师", Date.now());
  });

  afterEach(async () => {
    vi.useRealTimers();
    connection.sqlite.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("creates a learner profile and a minimal diagnostic audit event atomically", () => {
    const now = new Date("2026-07-12T04:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const result = completeDiagnosticProfile(
      connection.db,
      "student-1",
      CURRENT_QUESTION_SET_VERSION,
      answersForScore(4),
    );

    expect(result).toEqual({
      decomposition: 4,
      signalUnderstanding: 4,
      mappingDesign: 4,
      troubleshooting: 4,
      transfer: 4,
      average: 4,
      level: "L4",
      updatedAt: now,
    });
    const profile = connection.db.select().from(learnerProfiles).get();
    expect(profile).toMatchObject({
      userId: "student-1",
      level: "L4",
      decomposition: 4,
      transfer: 4,
      updatedAt: now,
    });
    const audit = connection.db.select().from(auditEvents).get();
    expect(audit).toMatchObject({
      userId: "student-1",
      type: "DIAGNOSTIC_COMPLETED",
      createdAt: now,
      payloadJson: {
        level: "L4",
        decomposition: 4,
        signalUnderstanding: 4,
        mappingDesign: 4,
        troubleshooting: 4,
        transfer: 4,
        questionSetVersion: CURRENT_QUESTION_SET_VERSION,
      },
    });
    expect(JSON.stringify(audit?.payloadJson)).not.toContain("匿名-001");
    expect(Object.keys(audit?.payloadJson ?? {}).sort()).toEqual(
      [
        "level",
        "decomposition",
        "signalUnderstanding",
        "mappingDesign",
        "troubleshooting",
        "transfer",
        "questionSetVersion",
        "stageTransition",
      ].sort(),
    );
    expect(audit?.payloadJson.stageTransition).toBeNull();
  });

  it("preserves 3.5 scores and advances only the deterministic current demo project", () => {
    const now = new Date("2026-07-12T06:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    connection.sqlite.prepare(
      "INSERT INTO users(id,class_id,role,alias,created_at) VALUES(?,?,?,?,?)",
    ).run("demo-student-d", "class-1", "STUDENT", "演示学习者D", 1700000000);
    insertProject(connection, { id: "demo-project-a", studentId: "demo-student-d", updatedAt: 1700000100 });
    insertProject(connection, { id: "demo-project-z", studentId: "demo-student-d", updatedAt: 1700000100 });
    insertProject(connection, { id: "other-project", studentId: "student-1", updatedAt: 1700000200 });

    const result = completeDiagnosticProfile(
      connection.db,
      "demo-student-d",
      CURRENT_QUESTION_SET_VERSION,
      answersForHalfScore(3, 4),
    );
    const dashboard = readStudentDashboard(connection.db, {
      userId: "demo-student-d",
      role: "STUDENT",
    });
    const teacherDetail = readLearnerDetail(
      connection.db,
      "class-1",
      "demo-student-d",
      { includeDemo: true },
    );

    expect(result).toMatchObject({
      decomposition: 3.5,
      signalUnderstanding: 3.5,
      mappingDesign: 3.5,
      troubleshooting: 3.5,
      transfer: 3.5,
      average: 3.5,
      level: "L3",
    });
    expect(dashboard).toMatchObject({
      dataType: "DEMONSTRATION_DATA",
      profile: { decomposition: 3.5, dataType: "DEMONSTRATION_DATA" },
      project: { id: "demo-project-z", stage: "LOGIC_CARD", dataType: "DEMONSTRATION_DATA" },
    });
    expect(teacherDetail.profile).toMatchObject({
      decomposition: 3.5,
      signalUnderstanding: 3.5,
      mappingDesign: 3.5,
      troubleshooting: 3.5,
      transfer: 3.5,
      dataType: "DEMONSTRATION_DATA",
    });
    expect(connection.db.select({ id: projects.id, stage: projects.stage }).from(projects).all())
      .toEqual(expect.arrayContaining([
        { id: "demo-project-a", stage: "DIAGNOSTIC" },
        { id: "demo-project-z", stage: "LOGIC_CARD" },
        { id: "other-project", stage: "DIAGNOSTIC" },
      ]));
    const audit = connection.db.select().from(auditEvents)
      .where(eq(auditEvents.userId, "demo-student-d")).get();
    expect(audit?.payloadJson.stageTransition).toEqual({
      projectId: "demo-project-z",
      from: "DIAGNOSTIC",
      to: "LOGIC_CARD",
    });
    expect(JSON.stringify(audit?.payloadJson)).not.toMatch(/answer|option/i);
  });

  it("never regresses a current project after repeated diagnosis", () => {
    insertProject(connection, { id: "project-current", studentId: "student-1" });
    completeDiagnosticProfile(connection.db, "student-1", CURRENT_QUESTION_SET_VERSION, answersForScore(2));
    connection.sqlite.prepare("UPDATE projects SET stage='TOOL_PATH' WHERE id='project-current'").run();

    completeDiagnosticProfile(connection.db, "student-1", CURRENT_QUESTION_SET_VERSION, answersForScore(3));

    expect(connection.db.select().from(projects).where(eq(projects.id, "project-current")).get()?.stage)
      .toBe("TOOL_PATH");
    const audits = connection.db.select().from(auditEvents)
      .where(eq(auditEvents.userId, "student-1")).all();
    expect(audits.map(({ payloadJson }) => payloadJson.stageTransition)).toEqual([
      { projectId: "project-current", from: "DIAGNOSTIC", to: "LOGIC_CARD" },
      null,
    ]);
  });

  it("advances the same current project selected by every dashboard tie-breaker", () => {
    const sharedUpdatedAt = 1700000300;
    connection.sqlite.prepare("UPDATE users SET created_at=1700000000 WHERE id='student-1'").run();
    insertProject(connection, {
      id: "project-z-older",
      studentId: "student-1",
      createdAt: 1700000100,
      updatedAt: sharedUpdatedAt,
    });
    insertProject(connection, {
      id: "project-a-newer",
      studentId: "student-1",
      createdAt: 1700000200,
      updatedAt: sharedUpdatedAt,
    });

    completeDiagnosticProfile(
      connection.db,
      "student-1",
      CURRENT_QUESTION_SET_VERSION,
      answersForScore(3),
    );

    expect(readStudentDashboard(connection.db, { userId: "student-1", role: "STUDENT" }).project)
      .toMatchObject({ id: "project-a-newer", stage: "LOGIC_CARD" });
    expect(connection.db.select({ id: projects.id, stage: projects.stage }).from(projects).all())
      .toEqual(expect.arrayContaining([
        { id: "project-a-newer", stage: "LOGIC_CARD" },
        { id: "project-z-older", stage: "DIAGNOSTIC" },
      ]));
  });

  it("does not audit a stage transition when the guarded update changes no row", () => {
    insertProject(connection, { id: "project-ignored", studentId: "student-1" });
    connection.sqlite.exec(`
      CREATE TRIGGER ignore_diagnostic_stage_update
      BEFORE UPDATE OF stage ON projects
      WHEN OLD.stage='DIAGNOSTIC' AND NEW.stage='LOGIC_CARD'
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);

    completeDiagnosticProfile(
      connection.db,
      "student-1",
      CURRENT_QUESTION_SET_VERSION,
      answersForScore(3),
    );

    expect(connection.db.select().from(projects).where(eq(projects.id, "project-ignored")).get()?.stage)
      .toBe("DIAGNOSTIC");
    expect(connection.db.select().from(auditEvents).get()?.payloadJson.stageTransition).toBeNull();
  });

  it("updates the same profile and appends a new audit event on repeat submission", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T04:00:00.000Z"));
    completeDiagnosticProfile(
      connection.db,
      "student-1",
      CURRENT_QUESTION_SET_VERSION,
      answersForScore(1),
    );
    vi.setSystemTime(new Date("2026-07-12T05:00:00.000Z"));

    const result = completeDiagnosticProfile(
      connection.db,
      "student-1",
      CURRENT_QUESTION_SET_VERSION,
      answersForScore(3),
    );

    expect(result).toMatchObject({ average: 3, level: "L2" });
    expect(connection.db.select().from(learnerProfiles).all()).toHaveLength(1);
    expect(connection.db.select().from(learnerProfiles).get()).toMatchObject({
      level: "L2",
      decomposition: 3,
      updatedAt: new Date("2026-07-12T05:00:00.000Z"),
    });
    const audits = connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.userId, "student-1"))
      .all();
    expect(audits).toHaveLength(2);
    expect(audits.map(({ payloadJson }) => payloadJson.level)).toEqual(["L1", "L2"]);
  });

  it.each([
    ["teacher", "teacher-1"],
    ["unknown user", "missing-user"],
  ])("rejects %s and leaves no profile or audit residue", (_case, userId) => {
    expect(() =>
      completeDiagnosticProfile(
        connection.db,
        userId,
        CURRENT_QUESTION_SET_VERSION,
        answersForScore(4),
      ),
    ).toThrow();

    expect(connection.db.select().from(learnerProfiles).all()).toEqual([]);
    expect(connection.db.select().from(auditEvents).all()).toEqual([]);
  });

  it("rolls back profile changes when the audit insert fails", () => {
    insertProject(connection, { id: "project-rollback", studentId: "student-1" });
    connection.sqlite.exec(`
      CREATE TRIGGER reject_diagnostic_audit
      BEFORE INSERT ON audit_events
      WHEN NEW.type = 'DIAGNOSTIC_COMPLETED'
      BEGIN
        SELECT RAISE(ABORT, 'audit rejected');
      END;
    `);

    expect(() =>
      completeDiagnosticProfile(
        connection.db,
        "student-1",
        CURRENT_QUESTION_SET_VERSION,
        answersForScore(4),
      ),
    ).toThrow("audit rejected");
    expect(connection.db.select().from(learnerProfiles).all()).toEqual([]);
    expect(connection.db.select().from(auditEvents).all()).toEqual([]);
    expect(connection.db.select().from(projects).where(eq(projects.id, "project-rollback")).get()?.stage)
      .toBe("DIAGNOSTIC");
  });

  it("configures each SQLite connection to wait briefly for a writer", () => {
    expect(connection.sqlite.pragma("busy_timeout", { simple: true })).toBe(5_000);
  });

  it("serializes simultaneous submissions from independent processes without SQLITE_BUSY", async () => {
    insertProject(connection, { id: "project-concurrent", studentId: "student-1" });
    connection.sqlite.close();
    const startPath = path.join(temporaryDirectory, "start.signal");
    const readyOne = path.join(temporaryDirectory, "worker-one.ready");
    const readyTwo = path.join(temporaryDirectory, "worker-two.ready");
    const workerOne = spawnDiagnosticWorker(databasePath, readyOne, startPath, 1);
    const workerTwo = spawnDiagnosticWorker(databasePath, readyTwo, startPath, 4);

    await Promise.all([waitForFile(readyOne), waitForFile(readyTwo)]);
    await writeFile(startPath, "start", "utf8");
    const results = await Promise.all([workerOne.completed, workerTwo.completed]);

    expect(results.map(({ stderr }) => stderr)).toEqual(["", ""]);
    expect(results.map(({ stdout }) => JSON.parse(stdout))).toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
    ]);
    connection = createDb(databasePath);
    expect(connection.db.select().from(learnerProfiles).all()).toHaveLength(1);
    expect(connection.db.select().from(auditEvents).all()).toHaveLength(2);
    expect(connection.db.select().from(projects).get()?.stage).toBe("LOGIC_CARD");
    expect(connection.db.select().from(auditEvents).all()
      .filter(({ payloadJson }) => payloadJson.stageTransition !== null)).toHaveLength(1);
  });
});
