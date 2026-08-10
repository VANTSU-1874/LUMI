// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { evidence, projects, troubleshootingRuns } from "@/lib/db/schema";
import { saveEvidence } from "@/lib/services/evidence";
import {
  TroubleshootingEvidenceError,
  advanceTroubleshooting,
} from "@/lib/services/troubleshooting-service";
import { appendTeacherDecision } from "@/lib/services/teacher-decisions";
import { readStudentDashboard } from "@/lib/services/student-dashboard";

const actor = { userId: "student-1", role: "STUDENT" } as const;

describe("persisted troubleshooting", () => {
  let directory: string;
  let databasePath: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-troubleshoot-"));
    databasePath = path.join(directory, "course.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes VALUES ('class-1', '一班', 'CLASS001');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('student-1', 'class-1', 'STUDENT', '匿名-1', 1700000000),
        ('student-2', 'class-1', 'STUDENT', '匿名-2', 1700000000),
        ('teacher-1', 'class-1', 'TEACHER', '教师', 1700000000);
      INSERT INTO course_modules VALUES ('module-1', 'class-1', 1, '搭建', 2, '信号');
      INSERT INTO assignments VALUES ('assignment-1', 'class-1', 'module-1', '作业', '简介', '["DIGISHOW"]', 1700000000);
      INSERT INTO projects VALUES
        ('project-1', 'class-1', 'assignment-1', 'student-1', 'BUILD', 1700000000, 1700000000, 0),
        ('project-2', 'class-1', 'assignment-1', 'student-2', 'BUILD', 1700000000, 1700000000, 0);
    `);
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function add(layer: "INPUT" | "MAPPING" | "TRANSPORT" | "BINDING" | "OUTPUT", value: number) {
    if (layer === "INPUT") {
      return saveEvidence(connection.db, actor, "project-1", {
        kind: "PROBE", label: `${layer}值`, signalLayer: layer,
        probe: { type: "INPUT_MEASUREMENT", firstCondition: "靠近", firstValue: value, secondCondition: "远离", secondValue: value + 1, unit: "cm" },
      }, { root: path.join(directory, "private") });
    }
    if (layer === "MAPPING") {
      return saveEvidence(connection.db, actor, "project-1", {
        kind: "PROBE", label: `${layer}值`, signalLayer: layer,
        probe: { type: "MAPPING_RANGE", inputMin: value, inputMax: value + 1, outputMin: 0, outputMax: 1, relationship: "DIRECT" },
      }, { root: path.join(directory, "private") });
    }
    throw new Error("test helper only supports used layers");
  }

  function decideEvidence(db: DatabaseConnection["db"], evidenceId: string, decision: "CONFIRMED" | "CORRECTED", idempotencyKey: string, originalRevision?: number) {
    const row = db.select().from(evidence).where(eq(evidence.id, evidenceId)).get()!;
    const revision = db.select({ value: projects.evidenceRevision }).from(projects).where(eq(projects.id, row.projectId)).get()!.value;
    appendTeacherDecision(db, { userId: "teacher-1", role: "TEACHER" }, {
      classId: row.classId, studentId: row.studentId, projectId: row.projectId, targetType: "EVIDENCE", targetId: row.id,
      originalRevision: originalRevision ?? Math.max(1, revision), decision, reasonCode: "EVIDENCE_TEST", notes: "测试教师复核", idempotencyKey,
    });
    return db.select().from(evidence).where(eq(evidence.id, evidenceId)).get()!;
  }

  it("advances only with same-owner, same-project evidence in strict order", async () => {
    const mapping = await add("MAPPING", 2);
    const input = await add("INPUT", 1);
    const outOfOrder = advanceTroubleshooting(connection.db, actor, "project-1", { evidenceRecordId: mapping.id });
    expect(outOfOrder.currentLayer).toBe("INPUT");
    const advanced = advanceTroubleshooting(connection.db, actor, "project-1", { evidenceRecordId: input.id });
    expect(advanced).toMatchObject({ currentLayer: "MAPPING", status: "ACTIVE", confirmedCodes: ["INPUT_OK"] });
    expect(connection.db.select().from(projects).all().find(({ id }) => id === "project-1")?.stage).toBe("TROUBLESHOOT");
  });

  it("rejects cross-project and unknown evidence with one typed error", async () => {
    const foreign = connection.db.insert(evidence).values({
      id: "00000000-0000-4000-8000-000000000001", projectId: "project-2", classId: "class-1", studentId: "student-2",
      evidenceSequence: 1, kind: "PROBE", signalLayer: "INPUT", confirmedCode: "INPUT_OK",
      verificationStatus: "RULE_VERIFIED", storageStatus: "READY", label: "别人", content: "{}",
      contentDigest: "a".repeat(64), probeJson: { type: "INPUT_MEASUREMENT", firstCondition: "a", firstValue: 1, secondCondition: "b", secondValue: 2, unit: "cm" }, originalName: null, createdAt: new Date(),
    }).returning().get();
    expect(() => advanceTroubleshooting(connection.db, actor, "project-1", { evidenceRecordId: foreign.id }))
      .toThrow(TroubleshootingEvidenceError);
    expect(() => advanceTroubleshooting(connection.db, actor, "project-1", { evidenceRecordId: "00000000-0000-4000-8000-000000000099" }))
      .toThrow(TroubleshootingEvidenceError);
  });

  it("escalates after three no-new-evidence rounds and persists one run", () => {
    for (let round = 0; round < 3; round += 1) {
      advanceTroubleshooting(connection.db, actor, "project-1", {});
    }
    const run = connection.db.select().from(troubleshootingRuns).get();
    expect(run?.status).toBe("ESCALATED");
    expect(connection.db.select().from(troubleshootingRuns).all()).toHaveLength(1);
  });

  it("does not advance from ordinary submitted evidence", async () => {
    const submitted = await saveEvidence(connection.db, actor, "project-1", {
      kind: "TEXT", label: "我觉得输入正常", signalLayer: "INPUT", text: "看起来应该没问题",
    }, { root: path.join(directory, "private") });
    connection.sqlite.prepare("UPDATE projects SET updated_at = 1700000000 WHERE id='project-1'").run();
    expect(submitted).toMatchObject({ verificationStatus: "SUBMITTED", confirmedCode: null });
    const result = advanceTroubleshooting(connection.db, actor, "project-1", { evidenceRecordId: submitted.id });
    expect(result.currentLayer).toBe("INPUT");
    expect(result.confirmedCodes).toEqual([]);
  });

  it("advances from a rule-verified structured probe", async () => {
    const verified = await saveEvidence(connection.db, actor, "project-1", {
      kind: "PROBE",
      label: "输入对照测量",
      signalLayer: "INPUT",
      probe: {
        type: "INPUT_MEASUREMENT",
        firstCondition: "靠近",
        firstValue: 10,
        secondCondition: "远离",
        secondValue: 80,
        unit: "cm",
      },
    }, { root: path.join(directory, "private") });
    expect(verified).toMatchObject({ verificationStatus: "RULE_VERIFIED", confirmedCode: "INPUT_OK" });
    expect(advanceTroubleshooting(connection.db, actor, "project-1", { evidenceRecordId: verified.id }))
      .toMatchObject({ currentLayer: "MAPPING", confirmedCodes: ["INPUT_OK"] });
  });

  it("lets a same-class teacher verify ordinary evidence transactionally", async () => {
    const submitted = await saveEvidence(connection.db, actor, "project-1", {
      kind: "TEXT", label: "教师待确认", signalLayer: "INPUT", text: "教师已线下检查数值对照",
    }, { root: path.join(directory, "private") });
    const verified = decideEvidence(connection.db, submitted.id, "CONFIRMED", "verify-submitted-evidence");
    expect(verified).toMatchObject({ verificationStatus: "TEACHER_VERIFIED", confirmedCode: "INPUT_OK" });
    const updatedProject = connection.db.select().from(projects).all().find(({ id }) => id === "project-1");
    expect(updatedProject?.evidenceRevision).toBe(2);
    expect(updatedProject!.updatedAt.getTime()).toBeGreaterThan(1_700_000_000_000);
    expect(advanceTroubleshooting(connection.db, actor, "project-1", { evidenceRecordId: submitted.id })).toMatchObject({ currentLayer: "MAPPING", confirmedCodes: ["INPUT_OK"] });
    decideEvidence(connection.db, submitted.id, "CONFIRMED", "verify-submitted-evidence", 1);
    expect(connection.db.select().from(projects).all().find(({ id }) => id === "project-1")?.evidenceRevision).toBe(2);
    expect(() => appendTeacherDecision(connection.db, actor, { classId: "class-1", studentId: "student-1", projectId: "project-1", targetType: "EVIDENCE", targetId: submitted.id, originalRevision: 2, decision: "CONFIRMED", reasonCode: "INVALID", notes: "", idempotencyKey: "student-cannot-verify" })).toThrow();
  });

  it("changes snapshotVersion for evidence status changes even when counts and timestamps are unchanged", async () => {
    const submitted = await saveEvidence(connection.db, actor, "project-1", { kind: "TEXT", label: "待拒绝", signalLayer: "INPUT", text: "同一条证据" }, { root: path.join(directory, "private") });
    const beforeReject = readStudentDashboard(connection.db, actor);
    decideEvidence(connection.db, submitted.id, "CORRECTED", "reject-dashboard-evidence");
    const afterReject = readStudentDashboard(connection.db, actor);
    expect(afterReject.evidence).toMatchObject({ total: beforeReject.evidence.total, verified: beforeReject.evidence.verified });
    expect(afterReject.snapshotVersion).not.toBe(beforeReject.snapshotVersion);

    const rule = await add("INPUT", 10);
    const beforeTeacher = readStudentDashboard(connection.db, actor);
    decideEvidence(connection.db, rule.id, "CONFIRMED", "confirm-rule-evidence");
    const afterTeacher = readStudentDashboard(connection.db, actor);
    expect(afterTeacher.evidence.verified).toBe(beforeTeacher.evidence.verified);
    expect(afterTeacher.snapshotVersion).not.toBe(beforeTeacher.snapshotVersion);
  });

  it("increments revisions atomically across two database connections", async () => {
    const first = await saveEvidence(connection.db, actor, "project-1", { kind: "TEXT", label: "一", signalLayer: "INPUT", text: "第一条" }, { root: path.join(directory, "private") });
    const second = await saveEvidence(connection.db, actor, "project-1", { kind: "TEXT", label: "二", signalLayer: "INPUT", text: "第二条" }, { root: path.join(directory, "private") });
    const other = createDb(databasePath);
    try {
      await Promise.all([
        new Promise<void>((resolve) => setImmediate(() => { decideEvidence(connection.db, first.id, "CONFIRMED", "concurrent-first"); resolve(); })),
        new Promise<void>((resolve) => setImmediate(() => { decideEvidence(other.db, second.id, "CONFIRMED", "concurrent-second"); resolve(); })),
      ]);
      expect(connection.db.select().from(projects).where(eq(projects.id, "project-1")).get()?.evidenceRevision).toBe(4);
    } finally { other.sqlite.close(); }
  });

  it("increments the persisted troubleshooting revision on every round", () => {
    advanceTroubleshooting(connection.db, actor, "project-1", {});
    advanceTroubleshooting(connection.db, actor, "project-1", {});
    expect(connection.db.select().from(troubleshootingRuns).get()?.revision).toBe(2);
  });
});
