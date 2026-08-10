// @vitest-environment node

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("design task migration", () => {
  it("moves legacy conversations and project brief memory into one compatible task", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tonggan-task-migration-"));
    roots.push(root);
    const partial = path.join(root, "migrations");
    const meta = path.join(partial, "meta");
    await mkdir(meta, { recursive: true });
    const source = path.resolve("drizzle");
    const journal = JSON.parse(await readFile(path.join(source, "meta", "_journal.json"), "utf8")) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string }>;
    };
    const throughKernel = journal.entries.filter(({ idx }) => idx <= 31);
    await Promise.all(throughKernel.map(({ tag }) => copyFile(path.join(source, `${tag}.sql`), path.join(partial, `${tag}.sql`))));
    await writeFile(path.join(meta, "_journal.json"), JSON.stringify({ ...journal, entries: throughKernel }), "utf8");

    const databasePath = path.join(root, "legacy.sqlite");
    runMigrations(databasePath, partial);
    const legacy = createDb(databasePath);
    legacy.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('c1','旧班级','LEGACY');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES('s1','c1','STUDENT','旧学生',1700000000);
      INSERT INTO agent_conversations(id,student_id,class_id,project_id,course_pack_id,course_pack_version,created_at,updated_at)
        VALUES('legacy-conversation','s1','c1',NULL,'general-design','1',1700000000,1700000300);
      INSERT INTO agent_project_briefs(id,student_id,class_id,brief_json,revision,created_at,updated_at,data_type)
        VALUES('legacy-brief','s1','c1','{"designGoal":{"value":"保留旧项目理解","status":"CONFIRMED","sourceTurnId":"11111111-1111-4111-8111-111111111111","updatedAt":"2026-07-16T00:00:00.000Z"}}',2,1700000000,1700000300,'REAL');
    `);
    legacy.sqlite.close();

    runMigrations(databasePath);
    const migrated = createDb(databasePath);
    try {
      const task = migrated.sqlite.prepare("SELECT id,title,status FROM design_project_tasks WHERE student_id='s1'").get() as { id: string; title: string; status: string };
      expect(task).toMatchObject({ title: "设计项目", status: "ACTIVE" });
      expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(migrated.sqlite.prepare("SELECT task_id taskId FROM agent_conversations WHERE id='legacy-conversation'").get()).toEqual({ taskId: task.id });
      expect(migrated.sqlite.prepare("SELECT task_id taskId,revision,brief_json briefJson FROM agent_project_briefs WHERE id='legacy-brief'").get()).toMatchObject({
        taskId: task.id,
        revision: 2,
        briefJson: expect.stringContaining("保留旧项目理解"),
      });
      expect(migrated.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally { migrated.sqlite.close(); }
  });
});
