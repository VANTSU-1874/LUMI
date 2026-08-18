// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDesignTask } from "@/lib/agent/design-project-task";
import {
  createStudentProject,
  deleteStudentProject,
  listStudentProjects,
  moveTaskToStudentProject,
  projectContextForTask,
  removeTaskFromStudentProject,
  StudentProjectConflictError,
  updateStudentProject,
} from "@/lib/agent/student-project";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const roots: string[] = [];
const first = { userId: "s1", role: "STUDENT" as const };
const second = { userId: "s2", role: "STUDENT" as const };

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-projects-")); roots.push(root);
  const databasePath = path.join(root, "project.sqlite"); runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec(`
    INSERT INTO classes(id,name,access_code) VALUES('c1','测试班级','PROJECTS');
    INSERT INTO users(id,class_id,role,alias,created_at) VALUES
      ('s1','c1','STUDENT','学生一',1700000000),('s2','c1','STUDENT','学生二',1700000000);
  `);
  return connection;
}

describe("ChatGPT-style student projects", () => {
  it("keeps a project separate from its conversations and applies project-only context", async () => {
    const connection = await fixture();
    try {
      const detail = createStudentProject(connection, first, { name: "毕业展视觉", instructions: "使用简洁中文，并持续检查展示动线。" }, new Date("2026-08-17T08:00:00.000Z"));
      expect(detail.project).toMatchObject({ name: "毕业展视觉", memoryMode: "PROJECT_ONLY", threadCount: 1 });
      const firstThread = detail.threads[0]!;
      const secondThread = createDesignTask(connection, first, { title: "海报方向" });
      const moved = moveTaskToStudentProject(connection, first, detail.project.id, secondThread.id);
      expect(moved.threads.map(({ id }) => id)).toEqual(expect.arrayContaining([firstThread.id, secondThread.id]));

      connection.sqlite.prepare(`
        INSERT INTO agent_messages(id,task_id,student_id,class_id,role,content,structure_json,tool_call_refs_json,turn_id,created_at,data_type)
        VALUES('m1',?,'s1','c1','user','主视觉要保留红色斜线','{"version":1,"kind":"user","parts":[]}','[]',NULL,1700000000000,'REAL')
      `).run(secondThread.id);
      const context = projectContextForTask(connection, first, firstThread.id);
      expect(context?.project.instructions).toContain("展示动线");
      expect(context?.relatedConversationSummaries[0]).toMatchObject({ title: "海报方向", excerpt: "主视觉要保留红色斜线" });

      const renamed = updateStudentProject(connection, first, detail.project.id, { name: "毕业设计展", color: "violet" });
      expect(renamed.project).toMatchObject({ name: "毕业设计展", color: "violet" });
      expect(listStudentProjects(connection, first).projects).toHaveLength(1);
      expect(listStudentProjects(connection, second).projects).toHaveLength(0);
    } finally { connection.sqlite.close(); }
  });

  it("moves a conversation out, rejects double membership and cascades owned project conversations", async () => {
    const connection = await fixture();
    try {
      const firstProject = createStudentProject(connection, first, { name: "项目一" });
      const secondProject = createStudentProject(connection, first, { name: "项目二" });
      const task = createDesignTask(connection, first, { title: "已有对话" });
      moveTaskToStudentProject(connection, first, firstProject.project.id, task.id);
      expect(() => moveTaskToStudentProject(connection, first, secondProject.project.id, task.id)).toThrow(StudentProjectConflictError);
      removeTaskFromStudentProject(connection, first, firstProject.project.id, task.id);
      expect(moveTaskToStudentProject(connection, first, secondProject.project.id, task.id).threads.some(({ id }) => id === task.id)).toBe(true);
      deleteStudentProject(connection, first, secondProject.project.id);
      expect(connection.sqlite.prepare("SELECT 1 FROM design_project_tasks WHERE id=?").get(task.id)).toBeUndefined();
    } finally { connection.sqlite.close(); }
  });
});
