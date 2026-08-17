import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import { designProjectTasks, studentLibraryAssets, studentProjects, studentProjectThreads, users } from "@/lib/db/schema";
import { DesignTaskSchema } from "./design-project-task-contract";
import { createDesignTask, readDesignTask } from "./design-project-task";
import {
  StudentProjectCreateSchema,
  StudentProjectDetailSchema,
  StudentProjectListSchema,
  StudentProjectSchema,
  StudentProjectUpdateSchema,
} from "./student-project-contract";

export class StudentProjectNotFoundError extends Error {
  constructor() { super("项目不存在"); this.name = "StudentProjectNotFoundError"; }
}
export class StudentProjectForbiddenError extends Error {
  constructor() { super("无权访问这个项目"); this.name = "StudentProjectForbiddenError"; }
}
export class StudentProjectConflictError extends Error {
  constructor(message = "这条对话已在其他项目中"){ super(message); this.name = "StudentProjectConflictError"; }
}

function studentIdentity(connection: DatabaseConnection, actor: SessionPayload) {
  if (actor.role !== "STUDENT") throw new StudentProjectForbiddenError();
  const student = connection.db.select({ id: users.id, classId: users.classId }).from(users)
    .where(and(eq(users.id, actor.userId), eq(users.role, "STUDENT"))).get();
  if (!student?.classId) throw new StudentProjectNotFoundError();
  return { studentId: student.id, classId: student.classId, dataType: student.id.startsWith("demo-student-") ? "DEMONSTRATION_DATA" as const : "REAL" as const };
}

function readOwnedRow(connection: DatabaseConnection, actor: SessionPayload, projectId: string) {
  const owner = studentIdentity(connection, actor);
  const row = connection.db.select().from(studentProjects).where(and(
    eq(studentProjects.id, projectId), eq(studentProjects.studentId, owner.studentId), eq(studentProjects.classId, owner.classId),
  )).get();
  if (!row) throw new StudentProjectNotFoundError();
  return { row, owner };
}

function publicProject(connection: DatabaseConnection, row: typeof studentProjects.$inferSelect) {
  const threadCount = connection.db.select({ count: sql<number>`count(*)` }).from(studentProjectThreads)
    .where(eq(studentProjectThreads.projectId, row.id)).get()?.count ?? 0;
  const fileCount = connection.db.select({ count: sql<number>`count(*)` }).from(studentLibraryAssets)
    .where(eq(studentLibraryAssets.projectId, row.id)).get()?.count ?? 0;
  return StudentProjectSchema.parse({
    id: row.id, name: row.name, icon: row.icon, color: row.color, instructions: row.instructions,
    memoryMode: row.memoryMode, status: row.status, threadCount, fileCount,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  });
}

export function listStudentProjects(connection: DatabaseConnection, actor: SessionPayload) {
  const owner = studentIdentity(connection, actor);
  const rows = connection.db.select().from(studentProjects).where(and(
    eq(studentProjects.studentId, owner.studentId), eq(studentProjects.classId, owner.classId),
  )).orderBy(desc(studentProjects.updatedAt)).limit(100).all();
  return StudentProjectListSchema.parse({ projects: rows.map((row) => publicProject(connection, row)) });
}

export function createStudentProject(connection: DatabaseConnection, actor: SessionPayload, raw: z.input<typeof StudentProjectCreateSchema>, now = new Date()) {
  const input = StudentProjectCreateSchema.parse(raw);
  const owner = studentIdentity(connection, actor);
  const id = randomUUID();
  connection.sqlite.transaction(() => {
    connection.db.insert(studentProjects).values({ id, ...owner, name: input.name, icon: input.icon, color: input.color, instructions: input.instructions, memoryMode: "PROJECT_ONLY", status: "ACTIVE", createdAt: now, updatedAt: now }).run();
    const taskId = input.initialTaskId ?? createDesignTask(connection, actor, { title: input.name }).id;
    moveTaskToStudentProject(connection, actor, id, taskId, now);
  })();
  return readStudentProject(connection, actor, id);
}

export function readStudentProject(connection: DatabaseConnection, actor: SessionPayload, projectId: string) {
  const { row, owner } = readOwnedRow(connection, actor, projectId);
  const threads = connection.db.select({ task: designProjectTasks }).from(studentProjectThreads)
    .innerJoin(designProjectTasks, eq(studentProjectThreads.taskId, designProjectTasks.id))
    .where(and(eq(studentProjectThreads.projectId, projectId), eq(studentProjectThreads.studentId, owner.studentId), eq(studentProjectThreads.classId, owner.classId)))
    .orderBy(desc(designProjectTasks.updatedAt)).all().map(({ task }) => DesignTaskSchema.parse({
      id: task.id, title: task.title, status: task.status, mode: task.mode, pinned: task.pinned,
      createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
    }));
  return StudentProjectDetailSchema.parse({ project: publicProject(connection, row), threads });
}

export function updateStudentProject(connection: DatabaseConnection, actor: SessionPayload, projectId: string, raw: z.input<typeof StudentProjectUpdateSchema>, now = new Date()) {
  const input = StudentProjectUpdateSchema.parse(raw);
  const { owner } = readOwnedRow(connection, actor, projectId);
  connection.db.update(studentProjects).set({ ...input, updatedAt: now }).where(and(eq(studentProjects.id, projectId), eq(studentProjects.studentId, owner.studentId), eq(studentProjects.classId, owner.classId))).run();
  return readStudentProject(connection, actor, projectId);
}

export function moveTaskToStudentProject(connection: DatabaseConnection, actor: SessionPayload, projectId: string, taskId: string, now = new Date()) {
  const { owner } = readOwnedRow(connection, actor, projectId);
  readDesignTask(connection, actor, taskId);
  const current = connection.db.select().from(studentProjectThreads).where(eq(studentProjectThreads.taskId, taskId)).get();
  if (current && current.projectId !== projectId) throw new StudentProjectConflictError();
  if (!current) connection.db.insert(studentProjectThreads).values({ projectId, taskId, studentId: owner.studentId, classId: owner.classId, createdAt: now }).run();
  connection.db.update(studentProjects).set({ updatedAt: now }).where(eq(studentProjects.id, projectId)).run();
  return readStudentProject(connection, actor, projectId);
}

export function removeTaskFromStudentProject(connection: DatabaseConnection, actor: SessionPayload, projectId: string, taskId: string, now = new Date()) {
  const { owner } = readOwnedRow(connection, actor, projectId);
  const result = connection.db.delete(studentProjectThreads).where(and(eq(studentProjectThreads.projectId, projectId), eq(studentProjectThreads.taskId, taskId), eq(studentProjectThreads.studentId, owner.studentId), eq(studentProjectThreads.classId, owner.classId))).run();
  if (result.changes !== 1) throw new StudentProjectNotFoundError();
  connection.db.update(studentProjects).set({ updatedAt: now }).where(eq(studentProjects.id, projectId)).run();
  return readStudentProject(connection, actor, projectId);
}

export function deleteStudentProject(connection: DatabaseConnection, actor: SessionPayload, projectId: string) {
  const detail = readStudentProject(connection, actor, projectId);
  const { owner } = readOwnedRow(connection, actor, projectId);
  connection.sqlite.transaction(() => {
    for (const thread of detail.threads) {
      connection.db.delete(designProjectTasks).where(and(eq(designProjectTasks.id, thread.id), eq(designProjectTasks.studentId, owner.studentId), eq(designProjectTasks.classId, owner.classId))).run();
    }
    connection.db.delete(studentProjects).where(and(eq(studentProjects.id, projectId), eq(studentProjects.studentId, owner.studentId), eq(studentProjects.classId, owner.classId))).run();
  })();
  return detail.project;
}

export function projectContextForTask(connection: DatabaseConnection, actor: SessionPayload, taskId: string) {
  const owner = studentIdentity(connection, actor);
  const membership = connection.db.select({ projectId: studentProjectThreads.projectId }).from(studentProjectThreads).where(and(eq(studentProjectThreads.taskId, taskId), eq(studentProjectThreads.studentId, owner.studentId), eq(studentProjectThreads.classId, owner.classId))).get();
  if (!membership) return null;
  const detail = readStudentProject(connection, actor, membership.projectId);
  const files = connection.db.select({ id: studentLibraryAssets.id, name: studentLibraryAssets.originalName, mimeType: studentLibraryAssets.mimeType }).from(studentLibraryAssets).where(eq(studentLibraryAssets.projectId, membership.projectId)).all();
  const relatedConversationSummaries = connection.sqlite.prepare(`
    SELECT t.id taskId, t.title, substr(m.content,1,600) excerpt
    FROM student_project_threads pt
    JOIN design_project_tasks t ON t.id=pt.task_id
    JOIN agent_messages m ON m.task_id=t.id
    WHERE pt.project_id=? AND pt.student_id=? AND pt.class_id=? AND t.id<>?
    ORDER BY m.created_at DESC LIMIT 12
  `).all(membership.projectId, owner.studentId, owner.classId, taskId) as Array<{ taskId: string; title: string; excerpt: string }>;
  return { project: detail.project, files, relatedConversationSummaries };
}
