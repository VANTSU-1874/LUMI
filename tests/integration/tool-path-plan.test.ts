// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { auditEvents, projects, toolPathPlans } from "@/lib/db/schema";
import { ProjectStageConflictError } from "@/lib/services/project-workflow";
import {
  InvalidStoredToolConfigurationError,
  InvalidStoredToolPlanError,
  MissingLearnerProfileError,
  NoAllowedToolPathError,
  SemanticLogicGateError,
  ToolPathForbiddenError,
  planToolPath,
} from "@/lib/services/tool-path-plan";

const requirements = {
  needsRealtimeVisuals: true,
  needsPhysicalControl: true,
  hasOsc: true,
};

describe("planToolPath", () => {
  let directory: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-tool-plan-"));
    const databasePath = path.join(directory, "course.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes VALUES ('class-1', '一班', 'CLASS001');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('student-1', 'class-1', 'STUDENT', '匿名-1', 1700000000),
        ('student-2', 'class-1', 'STUDENT', '匿名-2', 1700000000),
        ('teacher-1', 'class-1', 'TEACHER', '教师', 1700000000);
      INSERT INTO course_modules VALUES ('module-1', 'class-1', 1, '逻辑卡', 2, '逻辑');
      INSERT INTO assignments VALUES ('assignment-1', 'class-1', 'module-1', '作业', '简介', '["DIGISHOW","TOUCHDESIGNER","COLLABORATIVE"]', 1700000000);
      INSERT INTO projects VALUES ('project-1', 'class-1', 'assignment-1', 'student-1', 'TOOL_PATH', 1700000000, 1700000000, 0);
      INSERT INTO learner_profiles VALUES ('student-1', 'L2', 3, 3, 3, 3, 3, 1700000000);
      INSERT INTO logic_cards (project_id, payload_json, rule_ready, semantic_ready, semantic_review_json)
        VALUES ('project-1', '{}', 1, 1, '{"status":"APPROVED","ready":true,"issues":[],"source":"test"}');
    `);
  });

  afterEach(async () => {
    vi.useRealTimers();
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps the original createdAt when an upsert updates a persisted plan", () => {
    vi.useFakeTimers();
    const actor = { userId: "student-1", role: "STUDENT" } as const;
    vi.setSystemTime(new Date("2026-07-12T01:00:00.000Z"));
    const first = planToolPath(connection.db, actor, "project-1", requirements);
    connection.sqlite.prepare("UPDATE projects SET stage='TOOL_PATH' WHERE id='project-1'").run();
    vi.setSystemTime(new Date("2026-07-12T02:00:00.000Z"));
    const second = planToolPath(connection.db, actor, "project-1", requirements);

    expect(first.createdAt).toEqual(new Date("2026-07-12T01:00:00.000Z"));
    expect(second.createdAt).toEqual(first.createdAt);
    expect(second.updatedAt).toEqual(new Date("2026-07-12T02:00:00.000Z"));
  });

  it("rejects dual physical and realtime needs when the teacher disallows collaboration", () => {
    connection.sqlite.prepare("UPDATE assignments SET allowed_tools='[\"DIGISHOW\",\"TOUCHDESIGNER\"]' WHERE id='assignment-1'").run();
    expect(() => planToolPath(
      connection.db,
      { userId: "student-1", role: "STUDENT" },
      "project-1",
      { ...requirements, hasOsc: false },
    )).toThrow(NoAllowedToolPathError);
    expect(connection.db.select().from(toolPathPlans).all()).toEqual([]);
    expect(connection.db.select().from(projects).get()?.stage).toBe("TOOL_PATH");
  });

  it("uses an allowed TouchDesigner path and learning support for L1", () => {
    connection.sqlite.prepare("UPDATE assignments SET allowed_tools='[\"TOUCHDESIGNER\"]' WHERE id='assignment-1'").run();
    connection.sqlite.prepare("UPDATE learner_profiles SET level='L1' WHERE user_id='student-1'").run();
    const result = planToolPath(
      connection.db,
      { userId: "student-1", role: "STUDENT" },
      "project-1",
      { needsRealtimeVisuals: true, needsPhysicalControl: false, hasOsc: false },
    );
    expect(result.path).toBe("TOUCHDESIGNER");
    expect(result.reasons.join(" ")).toContain("学习支撑");
  });

  it("rejects a stored allowedTools value with a valid JSON but invalid shape", () => {
    connection.sqlite.prepare("UPDATE assignments SET allowed_tools='{}' WHERE id='assignment-1'").run();
    expect(() => planToolPath(
      connection.db,
      { userId: "student-1", role: "STUDENT" },
      "project-1",
      requirements,
    )).toThrow(InvalidStoredToolConfigurationError);
    expect(connection.db.select().from(toolPathPlans).all()).toEqual([]);
    expect(connection.db.select().from(projects).get()?.stage).toBe("TOOL_PATH");
  });

  it("rolls back with a typed error when the persisted plan shape is corrupted", () => {
    connection.sqlite.exec(`
      CREATE TRIGGER corrupt_tool_plan AFTER INSERT ON tool_path_plans
      BEGIN
        UPDATE tool_path_plans SET milestones_json='[{}]' WHERE project_id=NEW.project_id;
      END;
    `);
    expect(() => planToolPath(
      connection.db,
      { userId: "student-1", role: "STUDENT" },
      "project-1",
      requirements,
    )).toThrow(InvalidStoredToolPlanError);
    expect(connection.db.select().from(toolPathPlans).all()).toEqual([]);
    expect(connection.db.select().from(auditEvents).all()).toEqual([]);
    expect(connection.db.select().from(projects).get()?.stage).toBe("TOOL_PATH");
  });

  it("chooses, persists, explains, and advances an eligible owner to BUILD", () => {
    const result = planToolPath(
      connection.db,
      { userId: "student-1", role: "STUDENT" },
      "project-1",
      requirements,
    );

    expect(result).toMatchObject({ projectId: "project-1", path: "COLLABORATIVE", stage: "BUILD" });
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.milestones.length).toBeGreaterThanOrEqual(3);
    expect(connection.db.select().from(toolPathPlans).get()).toMatchObject({
      projectId: "project-1",
      path: "COLLABORATIVE",
      requirementsJson: requirements,
    });
    expect(connection.db.select().from(projects).get()?.stage).toBe("BUILD");
    expect(connection.db.select().from(auditEvents).get()).toMatchObject({
      userId: "student-1",
      type: "TOOL_PATH_PLANNED",
      payloadJson: { projectId: "project-1", path: "COLLABORATIVE", milestoneCount: 3 },
    });
  });

  it("upserts the same plan after the workflow explicitly returns to TOOL_PATH", () => {
    const actor = { userId: "student-1", role: "STUDENT" } as const;
    planToolPath(connection.db, actor, "project-1", requirements);
    connection.sqlite.prepare("UPDATE projects SET stage='TOOL_PATH' WHERE id='project-1'").run();
    const changed = { needsRealtimeVisuals: true, needsPhysicalControl: false, hasOsc: false };
    planToolPath(connection.db, actor, "project-1", changed);

    expect(connection.db.select().from(toolPathPlans).all()).toHaveLength(1);
    expect(connection.db.select().from(toolPathPlans).get()).toMatchObject({ path: "TOUCHDESIGNER", requirementsJson: changed });
    expect(connection.db.select().from(auditEvents).all()).toHaveLength(2);
  });

  it("rejects a direct stage bypass without creating a plan", () => {
    connection.sqlite.prepare("UPDATE projects SET stage='LOGIC_CARD' WHERE id='project-1'").run();
    expect(() => planToolPath(connection.db, { userId: "student-1", role: "STUDENT" }, "project-1", requirements)).toThrow(ProjectStageConflictError);
    expect(connection.db.select().from(toolPathPlans).all()).toEqual([]);
  });

  it("rejects another student and teacher", () => {
    for (const actor of [
      { userId: "student-2", role: "STUDENT" as const },
      { userId: "teacher-1", role: "TEACHER" as const },
    ]) {
      expect(() => planToolPath(connection.db, actor, "project-1", requirements)).toThrow(ToolPathForbiddenError);
    }
    expect(connection.db.select().from(toolPathPlans).all()).toEqual([]);
  });

  it("rejects a missing learner profile", () => {
    connection.sqlite.prepare("DELETE FROM learner_profiles WHERE user_id='student-1'").run();
    expect(() => planToolPath(connection.db, { userId: "student-1", role: "STUDENT" }, "project-1", requirements)).toThrow(MissingLearnerProfileError);
    expect(connection.db.select().from(toolPathPlans).all()).toEqual([]);
  });

  it.each([
    [0, 0],
    [1, 0],
  ])("rejects a card without both gates (%s/%s)", (ruleReady, semanticReady) => {
    connection.sqlite.prepare("UPDATE logic_cards SET rule_ready=?, semantic_ready=? WHERE project_id='project-1'").run(ruleReady, semanticReady);
    expect(() => planToolPath(connection.db, { userId: "student-1", role: "STUDENT" }, "project-1", requirements)).toThrow(SemanticLogicGateError);
    expect(connection.db.select().from(toolPathPlans).all()).toEqual([]);
  });

  it("rolls back plan and stage when audit insertion fails", () => {
    connection.sqlite.exec(`
      CREATE TRIGGER reject_tool_audit BEFORE INSERT ON audit_events
      WHEN NEW.type='TOOL_PATH_PLANNED' BEGIN SELECT RAISE(ABORT, 'audit rejected'); END;
    `);
    expect(() => planToolPath(connection.db, { userId: "student-1", role: "STUDENT" }, "project-1", requirements)).toThrow("audit rejected");
    expect(connection.db.select().from(toolPathPlans).all()).toEqual([]);
    expect(connection.db.select().from(projects).get()?.stage).toBe("TOOL_PATH");
  });
});
