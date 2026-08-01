import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import { designProjectTasks, users } from "@/lib/db/schema";
import {
  DesignTaskListResponseSchema,
  DesignTaskSchema,
  DesignTaskUpdateRequestSchema,
  type DesignTask,
  type DesignTaskMode,
} from "./design-project-task-contract";

export {
  DesignTaskCreateRequestSchema,
  DesignTaskListResponseSchema,
  DesignTaskModeSchema,
  DesignTaskSchema,
  DesignTaskStatusSchema,
  DesignTaskUpdateRequestSchema,
} from "./design-project-task-contract";
export type { DesignTask } from "./design-project-task-contract";

export class DesignTaskNotFoundError extends Error {
  constructor() { super("设计任务不存在"); this.name = "DesignTaskNotFoundError"; }
}

export class DesignTaskForbiddenError extends Error {
  constructor() { super("无权访问这个设计任务"); this.name = "DesignTaskForbiddenError"; }
}

export class DesignTaskArchivedError extends Error {
  constructor() { super("任务已归档，请恢复后继续对话"); this.name = "DesignTaskArchivedError"; }
}

function studentIdentity(connection: DatabaseConnection, actor: SessionPayload) {
  if (actor.role !== "STUDENT") throw new DesignTaskForbiddenError();
  const student = connection.db.select({ id: users.id, classId: users.classId })
    .from(users).where(and(eq(users.id, actor.userId), eq(users.role, "STUDENT"))).get();
  if (!student?.classId) throw new DesignTaskNotFoundError();
  return {
    studentId: student.id,
    classId: student.classId,
    dataType: student.id.startsWith("demo-student-")
      ? "DEMONSTRATION_DATA" as const
      : "REAL" as const,
  };
}

function publicTask(row: typeof designProjectTasks.$inferSelect): DesignTask {
  return DesignTaskSchema.parse({
    id: row.id,
    title: row.title,
    status: row.status,
    mode: row.mode,
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function createDesignTask(
  connection: DatabaseConnection,
  actor: SessionPayload,
  input: { title?: string; mode?: DesignTaskMode } = {},
  now = new Date(),
) {
  const student = studentIdentity(connection, actor);
  const id = randomUUID();
  const title = input.title?.trim() || "未命名设计任务";
  connection.db.insert(designProjectTasks).values({
    id,
    ...student,
    title,
    status: "ACTIVE",
    mode: input.mode ?? "conversation",
    pinned: false,
    createdAt: now,
    updatedAt: now,
  }).run();
  return publicTask(connection.db.select().from(designProjectTasks)
    .where(eq(designProjectTasks.id, id)).get()!);
}

export function listDesignTasks(connection: DatabaseConnection, actor: SessionPayload) {
  const student = studentIdentity(connection, actor);
  const rows = connection.db.select().from(designProjectTasks).where(and(
    eq(designProjectTasks.studentId, student.studentId),
    eq(designProjectTasks.classId, student.classId),
  )).orderBy(
    desc(designProjectTasks.pinned),
    desc(designProjectTasks.updatedAt),
    desc(designProjectTasks.id),
  ).limit(50).all();
  return DesignTaskListResponseSchema.parse({ tasks: rows.map(publicTask) });
}

export function readDesignTask(
  connection: DatabaseConnection,
  actor: SessionPayload,
  taskId: string,
) {
  const student = studentIdentity(connection, actor);
  const row = connection.db.select().from(designProjectTasks).where(and(
    eq(designProjectTasks.id, taskId),
    eq(designProjectTasks.studentId, student.studentId),
    eq(designProjectTasks.classId, student.classId),
  )).get();
  if (!row) throw new DesignTaskNotFoundError();
  return { task: publicTask(row), student };
}

export function resolveActiveDesignTask(
  connection: DatabaseConnection,
  actor: SessionPayload,
  taskId?: string,
) {
  if (taskId) {
    const result = readDesignTask(connection, actor, taskId);
    if (result.task.status === "ARCHIVED") throw new DesignTaskArchivedError();
    return result;
  }
  const tasks = listDesignTasks(connection, actor).tasks;
  const active = tasks.find(({ status }) => status === "ACTIVE");
  const task = active ?? createDesignTask(connection, actor);
  return readDesignTask(connection, actor, task.id);
}

export function updateDesignTask(
  connection: DatabaseConnection,
  actor: SessionPayload,
  taskId: string,
  input: z.infer<typeof DesignTaskUpdateRequestSchema>,
  now = new Date(),
) {
  const current = readDesignTask(connection, actor, taskId);
  const update = DesignTaskUpdateRequestSchema.parse(input);
  connection.db.update(designProjectTasks).set({
    ...(update.title === undefined ? {} : { title: update.title }),
    ...(update.status === undefined ? {} : { status: update.status }),
    ...(update.mode === undefined ? {} : { mode: update.mode }),
    ...(update.pinned === undefined ? {} : { pinned: update.pinned }),
    updatedAt: now,
  }).where(and(
    eq(designProjectTasks.id, taskId),
    eq(designProjectTasks.studentId, current.student.studentId),
    eq(designProjectTasks.classId, current.student.classId),
  )).run();
  return readDesignTask(connection, actor, taskId).task;
}

export function deleteDesignTask(
  connection: DatabaseConnection,
  actor: SessionPayload,
  taskId: string,
) {
  const current = readDesignTask(connection, actor, taskId);
  const result = connection.db.delete(designProjectTasks).where(and(
    eq(designProjectTasks.id, taskId),
    eq(designProjectTasks.studentId, current.student.studentId),
    eq(designProjectTasks.classId, current.student.classId),
  )).run();
  if (result.changes !== 1) throw new DesignTaskNotFoundError();
  return current.task;
}

export function touchDesignTaskAfterTurn(
  connection: DatabaseConnection,
  taskId: string,
  message: string,
  now: Date,
) {
  const row = connection.db.select({ id: designProjectTasks.id })
    .from(designProjectTasks).where(eq(designProjectTasks.id, taskId)).get();
  if (!row) throw new DesignTaskNotFoundError();
  void message;
  connection.db.update(designProjectTasks).set({
    updatedAt: now,
  }).where(eq(designProjectTasks.id, taskId)).run();
}
