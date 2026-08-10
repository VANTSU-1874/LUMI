// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { readBookLayoutWorkspace, readLatestBookLayoutEvidence, resetBookLayoutDraft, saveBookLayoutDraft, saveBookLayoutEvidence } from "@/lib/services/book-layout";
import { readToolLearningState } from "@/lib/tool-adapters/learning-state";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-book-layout-"));
  roots.push(root);
  const databasePath = path.join(root, "book.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('c1','书籍班','BOOK-CLASS');
    INSERT INTO users(id,class_id,role,alias,created_at) VALUES
      ('s1','c1','STUDENT','学习者',1700000000),
      ('s2','c1','STUDENT','另一位学习者',1700000000);
  `);
  return connection;
}

const pageOrder = ["cover", "quick-start", "activity-map", "featured-activity", "calendar", "community-voices", "join-us", "contact"] as const;
const diagnosticAnswers = ["AUDIENCE_FIRST", "TASK_FIRST", "AUDIENCE_FIRST"] as const;

describe("book design micro loop", () => {
  it("persists diagnosis, eight-page evidence and audience transfer evaluation", async () => {
    const connection = await setup();
    try {
      const initial = saveBookLayoutEvidence(connection, { userId: "s1", role: "STUDENT" }, {
        audience: "NEW_STUDENTS", pageOrder: [...pageOrder], diagnosticAnswers: [...diagnosticAnswers], transferChoices: [],
      }, new Date("2026-07-14T08:00:00.000Z"));
      expect(initial).toMatchObject({ score: 4, passed: true, audience: "NEW_STUDENTS", dataType: "REAL" });

      const incompleteTransfer = saveBookLayoutEvidence(connection, { userId: "s1", role: "STUDENT" }, {
        audience: "COMMUNITY_RESIDENTS", pageOrder: [...pageOrder], diagnosticAnswers: [...diagnosticAnswers], transferChoices: ["RETAIN_ACTIVITY_CORE"],
      }, new Date("2026-07-14T08:01:00.000Z"));
      expect(incompleteTransfer).toMatchObject({ score: 3, passed: false });

      const transferred = saveBookLayoutEvidence(connection, { userId: "s1", role: "STUDENT" }, {
        audience: "COMMUNITY_RESIDENTS", pageOrder: [...pageOrder], diagnosticAnswers: [...diagnosticAnswers],
        transferChoices: ["COMMUNITY_ENTRY_FIRST", "VOLUNTEER_CALL_TO_ACTION", "RETAIN_ACTIVITY_CORE"],
      }, new Date("2026-07-14T08:02:00.000Z"));
      expect(transferred).toMatchObject({ score: 4, passed: true, audience: "COMMUNITY_RESIDENTS" });
      expect(readLatestBookLayoutEvidence(connection, { userId: "s1", role: "STUDENT" })?.id).toBe(transferred.id);
      expect(connection.sqlite.prepare("SELECT count(*) count FROM audit_events WHERE type='BOOK_LAYOUT_EVIDENCE_SUBMITTED'").get()).toEqual({ count: 3 });
      const profile = connection.sqlite.prepare(`
        SELECT course_pack_id coursePackId, course_pack_version coursePackVersion, level, dimensions_json dimensionsJson
        FROM course_pack_profiles WHERE user_id='s1' AND course_pack_id='book-design'
      `).get() as { coursePackId: string; coursePackVersion: string; level: string; dimensionsJson: string };
      expect(profile).toMatchObject({ coursePackId: "book-design", coursePackVersion: "1", level: "L4" });
      expect(JSON.parse(profile.dimensionsJson)).toMatchObject({ "content-decomposition": 4, "hierarchy-modeling": 4, "layout-design": 4, transfer: 4 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("restores a partial draft and keeps submitted evidence immutable after reset", async () => {
    const connection = await setup();
    try {
      const submitted = saveBookLayoutEvidence(connection, { userId: "s1", role: "STUDENT" }, {
        audience: "NEW_STUDENTS", pageOrder: [...pageOrder], diagnosticAnswers: [...diagnosticAnswers], transferChoices: [],
      }, new Date("2026-07-14T08:00:00.000Z"));
      const changedOrder = [...pageOrder];
      [changedOrder[1], changedOrder[2]] = [changedOrder[2], changedOrder[1]];
      const draft = saveBookLayoutDraft(connection, { userId: "s1", role: "STUDENT" }, {
        audience: "COMMUNITY_RESIDENTS",
        pageOrder: changedOrder,
        diagnosticAnswers: ["AUDIENCE_FIRST", null, null],
        transferChoices: ["COMMUNITY_ENTRY_FIRST"],
      }, new Date("2026-07-14T08:01:00.000Z"));
      expect(draft).toMatchObject({ audience: "COMMUNITY_RESIDENTS", diagnosticAnswers: ["AUDIENCE_FIRST", null, null] });
      expect(readBookLayoutWorkspace(connection, { userId: "s1", role: "STUDENT" })).toMatchObject({
        resume: { id: draft.id, audience: "COMMUNITY_RESIDENTS" },
        latest: { id: submitted.id, passed: true },
      });
      expect(readToolLearningState(connection, "s1", "book-layout-lab")).toEqual({
        adapterId: "book-layout-lab",
        status: "IN_PROGRESS",
        facts: ["当前受众为社区居民", "三个诊断判断已完成1项", "受众迁移选择已确认1项"],
      });

      const reset = resetBookLayoutDraft(connection, { userId: "s1", role: "STUDENT" }, new Date("2026-07-14T08:02:00.000Z"));
      expect(reset).toMatchObject({ reset: true, resume: null, latest: { id: submitted.id } });
      expect(readBookLayoutWorkspace(connection, { userId: "s1", role: "STUDENT" })).toMatchObject({ resume: null, latest: { id: submitted.id } });
      expect(readToolLearningState(connection, "s1", "book-layout-lab")).toMatchObject({ status: "EMPTY" });
      expect(readLatestBookLayoutEvidence(connection, { userId: "s1", role: "STUDENT" })?.id).toBe(submitted.id);
      expect(connection.sqlite.prepare("SELECT count(*) count FROM audit_events WHERE user_id='s1' AND type='BOOK_LAYOUT_EVIDENCE_SUBMITTED'").get()).toEqual({ count: 1 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("isolates drafts and reset markers between students", async () => {
    const connection = await setup();
    try {
      const draft = saveBookLayoutDraft(connection, { userId: "s1", role: "STUDENT" }, {
        audience: "NEW_STUDENTS", pageOrder: [...pageOrder], diagnosticAnswers: [null, null, null], transferChoices: [],
      });
      resetBookLayoutDraft(connection, { userId: "s2", role: "STUDENT" });
      expect(readBookLayoutWorkspace(connection, { userId: "s1", role: "STUDENT" }).resume?.id).toBe(draft.id);
      expect(readBookLayoutWorkspace(connection, { userId: "s2", role: "STUDENT" })).toEqual({ resume: null, latest: null });
    } finally {
      connection.sqlite.close();
    }
  });
});
