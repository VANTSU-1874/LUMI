// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { auditEvents, logicCards, projects, toolPathPlans } from "@/lib/db/schema";
import type { LogicCard } from "@/lib/domain/schemas";
import {
  LogicCardForbiddenError,
  LogicCardNotFoundError,
  StaleLogicReviewError,
  submitLogicCard,
} from "@/lib/services/logic-card-service";
import { ProjectStageConflictError } from "@/lib/services/project-workflow";
import type { SemanticLogicReviewer } from "@/lib/services/semantic-logic-review";
import { planToolPath } from "@/lib/services/tool-path-plan";

const completeCard: LogicCard = {
  culturalIntent: "传播安岳石刻文化",
  participantAction: "观众触摸屏幕区域",
  inputSignal: "采集触摸位置坐标",
  mappingRule: "按区域映射不同故事",
  outputMedium: "投影画面和声音变化",
  experienceFeedback: "观众立即看到触摸结果",
};

const approvedReviewer: SemanticLogicReviewer = {
  review: vi.fn(async () => ({
    status: "APPROVED",
    ready: true,
    issues: [],
    source: "test-reviewer",
  })),
};

describe("submitLogicCard", () => {
  let directory: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-logic-service-"));
    const databasePath = path.join(directory, "course.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes VALUES ('class-1', '一班', 'CLASS001'), ('class-2', '二班', 'CLASS002');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('student-1', 'class-1', 'STUDENT', '匿名-1', 1700000000),
        ('student-2', 'class-1', 'STUDENT', '匿名-2', 1700000000),
        ('student-3', 'class-2', 'STUDENT', '匿名-3', 1700000000),
        ('teacher-1', 'class-1', 'TEACHER', '教师', 1700000000);
      INSERT INTO course_modules VALUES ('module-1', 'class-1', 1, '逻辑卡', 2, '逻辑');
      INSERT INTO assignments VALUES ('assignment-1', 'class-1', 'module-1', '作业', '简介', '["DIGISHOW"]', 1700000000);
      INSERT INTO projects VALUES ('project-1', 'class-1', 'assignment-1', 'student-1', 'LOGIC_CARD', 1700000000, 1700000000, 0);
      INSERT INTO learner_profiles VALUES ('student-1', 'L2', 3, 3, 3, 3, 3, 1700000000);
    `);
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("saves rule issues without invoking semantic review or unlocking the project", async () => {
    const reviewer: SemanticLogicReviewer = { review: vi.fn() };
    const result = await submitLogicCard(
      connection.db,
      { userId: "student-1", role: "STUDENT" },
      "project-1",
      { ...completeCard, inputSignal: "" },
      reviewer,
    );

    expect(reviewer.review).not.toHaveBeenCalled();
    expect(result.ruleReady).toBe(false);
    expect(result.semanticReady).toBe(false);
    expect(result.issues).toContain("输入信号不能为空");
    expect(connection.db.select().from(projects).get()?.stage).toBe("LOGIC_CARD");
    expect(connection.db.select().from(logicCards).get()).toMatchObject({ ruleReady: false, semanticReady: false });
    expect(connection.db.select().from(logicCards).get()).toMatchObject({
      revision: 1,
      cardHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("atomically upserts approval, unlocks TOOL_PATH, and writes a minimal audit", async () => {
    const result = await submitLogicCard(
      connection.db,
      { userId: "student-1", role: "STUDENT" },
      "project-1",
      completeCard,
      approvedReviewer,
    );

    expect(result).toMatchObject({ ruleReady: true, semanticReady: true, status: "APPROVED", stage: "TOOL_PATH" });
    expect(connection.db.select().from(projects).get()?.stage).toBe("TOOL_PATH");
    expect(connection.db.select().from(auditEvents).all()).toHaveLength(2);
    const audit = connection.db.select().from(auditEvents).all().find(({ type }) => type === "LOGIC_CARD_REVIEWED");
    expect(audit).toMatchObject({
      userId: "student-1",
      type: "LOGIC_CARD_REVIEWED",
      payloadJson: {
        projectId: "project-1",
        revision: 1,
        cardHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        semanticStatus: "APPROVED",
        semanticSource: "test-reviewer",
        stage: "TOOL_PATH",
      },
    });
    expect(JSON.stringify(audit)).not.toContain(completeCard.culturalIntent);
  });

  it("keeps revision and pending reviews locked", async () => {
    for (const status of ["NEEDS_REVISION", "PENDING"] as const) {
      const reviewer: SemanticLogicReviewer = {
        review: () => ({ status, ready: false, issues: ["需要修改"], source: "test" }),
      };
      const result = await submitLogicCard(
        connection.db,
        { userId: "student-1", role: "STUDENT" },
        "project-1",
        completeCard,
        reviewer,
      );
      expect(result.stage).toBe("LOGIC_CARD");
      expect(result.semanticReady).toBe(false);
    }
  });

  it("overwrites one card, appends audits, and relocks an edited approved card", async () => {
    const actor = { userId: "student-1", role: "STUDENT" } as const;
    await submitLogicCard(connection.db, actor, "project-1", completeCard, approvedReviewer);
    connection.db.insert(toolPathPlans).values({
      projectId: "project-1",
      path: "DIGISHOW",
      requirementsJson: { needsRealtimeVisuals: false, needsPhysicalControl: false, hasOsc: false },
      reasonsJson: ["旧推荐"],
      milestonesJson: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }).run();
    const pending: SemanticLogicReviewer = {
      review: () => ({ status: "PENDING", ready: false, issues: ["等待审查"], source: "pending" }),
    };
    await submitLogicCard(connection.db, actor, "project-1", { ...completeCard, mappingRule: "改为距离映射声音" }, pending);

    expect(connection.db.select().from(logicCards).all()).toHaveLength(1);
    expect(connection.db.select().from(logicCards).get()).toMatchObject({ semanticReady: false });
    expect(connection.db.select().from(auditEvents).all()).toHaveLength(4);
    expect(connection.db.select().from(projects).get()?.stage).toBe("LOGIC_CARD");
    expect(connection.db.select().from(toolPathPlans).all()).toEqual([]);
  });

  it.each(["BUILD", "TROUBLESHOOT", "TRANSFER", "COMPLETE"] as const)(
    "rejects editing in %s without changing downstream state",
    async (stage) => {
      connection.sqlite.prepare("UPDATE projects SET stage=? WHERE id='project-1'").run(stage);
      const before = connection.sqlite.prepare("SELECT * FROM projects WHERE id='project-1'").get();

      await expect(
        submitLogicCard(
          connection.db,
          { userId: "student-1", role: "STUDENT" },
          "project-1",
          completeCard,
          approvedReviewer,
        ),
      ).rejects.toBeInstanceOf(ProjectStageConflictError);

      expect(connection.sqlite.prepare("SELECT * FROM projects WHERE id='project-1'").get()).toEqual(before);
      expect(connection.db.select().from(logicCards).all()).toEqual([]);
      expect(connection.db.select().from(auditEvents).all()).toEqual([]);
    },
  );

  it("uses revision CAS so a slow old review cannot overwrite a newer build or delete its plan", async () => {
    const actor = { userId: "student-1", role: "STUDENT" } as const;
    let releaseOld!: (value: { status: "APPROVED"; ready: true; issues: []; source: string }) => void;
    const oldReviewer: SemanticLogicReviewer = {
      review: () => new Promise((resolve) => { releaseOld = resolve; }),
    };
    const oldCard = { ...completeCard, mappingRule: "旧规则根据触摸区域映射" };
    const newCard = { ...completeCard, mappingRule: "新规则根据距离连续映射" };

    const oldSubmission = submitLogicCard(connection.db, actor, "project-1", oldCard, oldReviewer, { timeoutMs: 60_000 });
    await expect.poll(() => connection.db.select().from(logicCards).get()?.revision).toBe(1);
    const newest = await submitLogicCard(connection.db, actor, "project-1", newCard, approvedReviewer);
    expect(newest.revision).toBe(2);
    planToolPath(connection.db, actor, "project-1", {
      needsRealtimeVisuals: false,
      needsPhysicalControl: false,
      hasOsc: false,
    });

    releaseOld({ status: "APPROVED", ready: true, issues: [], source: "slow-old" });
    await expect(oldSubmission).rejects.toBeInstanceOf(StaleLogicReviewError);

    expect(connection.db.select().from(logicCards).get()).toMatchObject({
      revision: 2,
      payloadJson: newCard,
      semanticReady: true,
    });
    expect(connection.db.select().from(projects).get()?.stage).toBe("BUILD");
    expect(connection.db.select().from(toolPathPlans).all()).toHaveLength(1);
    expect(connection.db.select().from(auditEvents).all().filter(({ type }) => type === "LOGIC_CARD_REVIEWED")).toHaveLength(1);
  });

  it("persists a bounded PENDING result when a reviewer times out", async () => {
    let signal: AbortSignal | undefined;
    const result = await submitLogicCard(
      connection.db,
      { userId: "student-1", role: "STUDENT" },
      "project-1",
      completeCard,
      {
        review: (_card, context) => {
          signal = context.signal;
          return new Promise(() => undefined);
        },
      },
      { timeoutMs: 5 },
    );

    expect(signal?.aborted).toBe(true);
    expect(result).toMatchObject({ status: "PENDING", semanticReady: false, source: "reviewer-fallback" });
    expect(connection.db.select().from(logicCards).get()).toMatchObject({
      revision: 1,
      semanticReady: false,
      semanticReviewJson: {
        status: "PENDING",
        ready: false,
        issues: ["语义审查暂不可用，已保存并等待后续确认"],
        source: "reviewer-fallback",
      },
    });
  });

  it.each([
    ["teacher", { userId: "teacher-1", role: "TEACHER" }],
    ["another student", { userId: "student-2", role: "STUDENT" }],
    ["another class", { userId: "student-3", role: "STUDENT" }],
  ] as const)("forbids %s and leaves no residue", async (_case, actor) => {
    await expect(submitLogicCard(connection.db, actor, "project-1", completeCard, approvedReviewer)).rejects.toBeInstanceOf(LogicCardForbiddenError);
    expect(connection.db.select().from(logicCards).all()).toEqual([]);
    expect(connection.db.select().from(auditEvents).all()).toEqual([]);
  });

  it("distinguishes an unknown project without leaking data", async () => {
    await expect(
      submitLogicCard(connection.db, { userId: "student-1", role: "STUDENT" }, "missing", completeCard, approvedReviewer),
    ).rejects.toBeInstanceOf(LogicCardNotFoundError);
  });

  it("rolls back initial card and stage if the submitted audit write fails", async () => {
    connection.sqlite.exec(`
      CREATE TRIGGER reject_logic_audit BEFORE INSERT ON audit_events
      WHEN NEW.type = 'LOGIC_CARD_SUBMITTED' BEGIN SELECT RAISE(ABORT, 'audit rejected'); END;
    `);
    await expect(
      submitLogicCard(connection.db, { userId: "student-1", role: "STUDENT" }, "project-1", completeCard, approvedReviewer),
    ).rejects.toThrow("audit rejected");
    expect(connection.db.select().from(logicCards).all()).toEqual([]);
    expect(connection.db.select().from(projects).where(eq(projects.id, "project-1")).get()?.stage).toBe("LOGIC_CARD");
  });

  it("keeps the submitted PENDING revision if the reviewed audit transaction fails", async () => {
    connection.sqlite.exec(`
      CREATE TRIGGER reject_review_audit BEFORE INSERT ON audit_events
      WHEN NEW.type = 'LOGIC_CARD_REVIEWED' BEGIN SELECT RAISE(ABORT, 'review audit rejected'); END;
    `);
    await expect(
      submitLogicCard(connection.db, { userId: "student-1", role: "STUDENT" }, "project-1", completeCard, approvedReviewer),
    ).rejects.toThrow("review audit rejected");
    expect(connection.db.select().from(logicCards).get()).toMatchObject({
      revision: 1,
      semanticReady: false,
      semanticReviewJson: expect.objectContaining({ status: "PENDING" }),
    });
    expect(connection.db.select().from(projects).get()?.stage).toBe("LOGIC_CARD");
    expect(connection.db.select().from(auditEvents).all()).toHaveLength(1);
  });
});
