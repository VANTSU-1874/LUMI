import { and, eq } from "drizzle-orm";

import type { SessionPayload } from "./session";
import type { DatabaseConnection } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

type CourseDatabase = DatabaseConnection["db"];
type Executor = CourseDatabase | Parameters<Parameters<CourseDatabase["transaction"]>[0]>[0];

export class TeacherIdentityForbiddenError extends Error {
  constructor() { super("教师身份不可用"); this.name = "TeacherIdentityForbiddenError"; }
}

export class TeacherClassAccessNotFoundError extends Error {
  constructor() { super("班级或对象不存在"); this.name = "TeacherClassAccessNotFoundError"; }
}

export function readTeacherScope(db: Executor, actor: SessionPayload) {
  if (actor.role !== "TEACHER") throw new TeacherIdentityForbiddenError();
  const row = db.select({ id: users.id, classId: users.classId, role: users.role }).from(users)
    .where(and(eq(users.id, actor.userId), eq(users.role, "TEACHER"))).get();
  if (!row) throw new TeacherIdentityForbiddenError();
  if (row.id === "teacher" && row.classId === null) return { kind: "GLOBAL" as const, classId: null };
  if (row.classId) return { kind: "CLASS" as const, classId: row.classId };
  throw new TeacherIdentityForbiddenError();
}

export function assertTeacherClassAccess(db: Executor, actor: SessionPayload, classId: string) {
  const scope = readTeacherScope(db, actor);
  if (scope.kind === "CLASS" && scope.classId !== classId) throw new TeacherClassAccessNotFoundError();
  return scope;
}
