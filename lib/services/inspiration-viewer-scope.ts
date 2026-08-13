import { and, eq } from "drizzle-orm";

import type { SessionPayload } from "@/lib/auth/session";
import { readTeacherScope, TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";
import type { DatabaseConnection } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

type CourseDb = DatabaseConnection["db"];
export type InspirationViewerActor = Pick<SessionPayload, "userId" | "role">;

export class InspirationViewerIdentityForbiddenError extends Error {
  constructor() { super("灵感 Wiki 身份不可用"); this.name = "InspirationViewerIdentityForbiddenError"; }
}

export type InspirationViewerScope = {
  userId: string;
  role: "STUDENT";
  classId: string | null;
} | {
  userId: string;
  role: "TEACHER";
  classId: string | null;
  teacherScope: "GLOBAL" | "CLASS";
};

/**
 * Shared DB-backed viewer scope for Browser, Preview, Context and Bridge.
 * A valid old cookie is insufficient after the persisted user is removed or
 * its role changes.
 */
export function readInspirationViewerScope(db: CourseDb, actor: InspirationViewerActor): InspirationViewerScope {
  if (actor.role === "TEACHER") {
    try {
      const scope = readTeacherScope(db, actor);
      return { userId: actor.userId, role: "TEACHER", classId: scope.classId, teacherScope: scope.kind };
    } catch (error) {
      if (error instanceof TeacherIdentityForbiddenError) throw new InspirationViewerIdentityForbiddenError();
      throw error;
    }
  }
  if (actor.role !== "STUDENT") throw new InspirationViewerIdentityForbiddenError();
  const row = db.select({ id: users.id, classId: users.classId }).from(users).where(and(
    eq(users.id, actor.userId),
    eq(users.role, "STUDENT"),
  )).get();
  if (!row) throw new InspirationViewerIdentityForbiddenError();
  return { userId: row.id, role: "STUDENT", classId: row.classId };
}

export function readStudentInspirationViewerScope(db: CourseDb, actor: InspirationViewerActor) {
  const scope = readInspirationViewerScope(db, actor);
  if (scope.role !== "STUDENT") throw new InspirationViewerIdentityForbiddenError();
  return scope;
}
