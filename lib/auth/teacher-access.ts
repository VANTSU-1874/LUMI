import { and, eq } from "drizzle-orm";

import type { SessionPayload } from "./session";
import type { DatabaseConnection } from "@/lib/db/client";
import { classes, teacherAccessScopes, users } from "@/lib/db/schema";

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
  const row = db.select({
    id: users.id,
    legacyClassId: users.classId,
    role: users.role,
    scopeKind: teacherAccessScopes.scopeKind,
    scopedClassId: teacherAccessScopes.classId,
  }).from(users)
    .leftJoin(teacherAccessScopes, eq(teacherAccessScopes.teacherId, users.id))
    .where(and(eq(users.id, actor.userId), eq(users.role, "TEACHER"))).get();
  if (!row) throw new TeacherIdentityForbiddenError();
  if (row.scopeKind === "GLOBAL" && row.scopedClassId === null) {
    return { kind: "GLOBAL" as const, classId: null };
  }
  if (row.scopeKind === "CLASS" && row.scopedClassId) {
    return { kind: "CLASS" as const, classId: row.scopedClassId };
  }
  // Existing class-bound teachers already have an explicit, least-privilege
  // scope. Only the old null-to-GLOBAL shortcut is retired.
  if (row.legacyClassId) return { kind: "CLASS" as const, classId: row.legacyClassId };
  throw new TeacherIdentityForbiddenError();
}

export function grantTeacherAccessScope(
  db: Executor,
  input: {
    teacherId: string;
    scope: { kind: "GLOBAL" } | { kind: "CLASS"; classId: string };
    grantedBy: string;
    grantReason: string;
    now?: Date;
  },
) {
  const teacher = db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, input.teacherId), eq(users.role, "TEACHER"))).get();
  if (!teacher) throw new TeacherIdentityForbiddenError();
  if (input.scope.kind === "CLASS") {
    const courseClass = db.select({ id: classes.id }).from(classes)
      .where(eq(classes.id, input.scope.classId)).get();
    if (!courseClass) throw new TeacherClassAccessNotFoundError();
  }
  const values = {
    teacherId: input.teacherId,
    scopeKind: input.scope.kind,
    classId: input.scope.kind === "CLASS" ? input.scope.classId : null,
    grantedBy: input.grantedBy.trim(),
    grantReason: input.grantReason.trim(),
    createdAt: input.now ?? new Date(),
  };
  db.insert(teacherAccessScopes).values(values).onConflictDoUpdate({
    target: teacherAccessScopes.teacherId,
    set: values,
  }).run();
  return readTeacherScope(db, { userId: input.teacherId, role: "TEACHER" });
}

export function assertTeacherClassAccess(db: Executor, actor: SessionPayload, classId: string) {
  const scope = readTeacherScope(db, actor);
  if (scope.kind === "CLASS" && scope.classId !== classId) throw new TeacherClassAccessNotFoundError();
  return scope;
}
