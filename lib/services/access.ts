import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  InvalidClassCodeError,
  InvalidIdentityCodeError,
  InvalidTeacherCodeError,
} from "@/lib/auth/errors";
import {
  digestIdentityCode,
  normalizeIdentityCode,
} from "@/lib/auth/identity-code";
import type { DatabaseConnection } from "@/lib/db/client";
import { assignments, classes, projects, studentIdentityCodes, users } from "@/lib/db/schema";

const studentAccessSchema = z.object({
  classCode: z.string().trim().min(1).max(64),
  alias: z.string(),
});

const teacherCodeSchema = z.string().trim().min(1).max(128);

export type StudentIdentity = {
  userId: string;
  classId: string;
  alias: string;
  role: "STUDENT";
};

export type TeacherIdentity = {
  userId: "teacher";
  role: "TEACHER";
};

type CourseDatabase = DatabaseConnection["db"];

export function enterStudent(
  db: CourseDatabase,
  input: { classCode: string; alias: string },
  pepper: string,
): StudentIdentity {
  const parsedInput = studentAccessSchema.safeParse(input);
  if (!parsedInput.success) {
    if (parsedInput.error.issues.some(({ path }) => path[0] === "classCode")) {
      throw new InvalidClassCodeError();
    }
    throw new InvalidIdentityCodeError();
  }
  const { classCode } = parsedInput.data;
  const identityCode = normalizeIdentityCode(parsedInput.data.alias);
  const courseClass = db
    .select({ id: classes.id })
    .from(classes)
    .where(eq(classes.accessCode, classCode))
    .get();

  if (!courseClass) {
    throw new InvalidClassCodeError();
  }

  const codeDigest = digestIdentityCode(identityCode, pepper);
  return db.transaction((transaction) => {
    const issued = transaction
      .select()
      .from(studentIdentityCodes)
      .where(
        and(
          eq(studentIdentityCodes.codeDigest, codeDigest),
          eq(studentIdentityCodes.classId, courseClass.id),
        ),
      )
      .get();
    if (!issued) {
      throw new InvalidIdentityCodeError();
    }

    const userId = issued.claimedUserId ?? `student-${codeDigest}`;
    const safeAlias = `匿名-${codeDigest.slice(0, 16).toUpperCase()}`;
    const now = new Date();
    transaction
      .insert(users)
      .values({
        id: userId,
        classId: courseClass.id,
        role: "STUDENT",
        alias: safeAlias,
        createdAt: now,
      })
      .onConflictDoNothing({ target: users.id })
      .run();

    if (!issued.claimedUserId) {
      transaction
        .update(studentIdentityCodes)
        .set({ claimedUserId: userId, claimedAt: now })
        .where(
          and(
            eq(studentIdentityCodes.codeDigest, codeDigest),
            eq(studentIdentityCodes.classId, courseClass.id),
            isNull(studentIdentityCodes.claimedUserId),
          ),
        )
        .run();
    }

    const student = transaction
      .select({
        id: users.id,
        classId: users.classId,
        alias: users.alias,
        role: users.role,
      })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.classId, courseClass.id)))
      .get();
    if (!student || student.classId === null || student.role !== "STUDENT") {
      throw new Error("学生身份创建失败");
    }
    const existingProject = transaction.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.studentId, student.id), eq(projects.classId, student.classId)))
      .orderBy(desc(projects.updatedAt), desc(projects.createdAt), desc(projects.id)).limit(1).get();
    if (!existingProject) {
      const assignment = transaction.select({ id: assignments.id }).from(assignments)
        .where(eq(assignments.classId, student.classId))
        .orderBy(desc(assignments.createdAt), desc(assignments.id)).limit(1).get();
      if (assignment) {
        transaction.insert(projects).values({
          id: randomUUID(), classId: student.classId, assignmentId: assignment.id,
          studentId: student.id, stage: "DIAGNOSTIC", createdAt: now, updatedAt: now,
        }).run();
      }
    }
    return {
      userId: student.id,
      classId: student.classId,
      alias: student.alias,
      role: student.role,
    };
  }, { behavior: "immediate" });
}

export function enterTeacher(code: string, expectedCode: string): TeacherIdentity {
  const submitted = teacherCodeSchema.parse(code);
  const expected = teacherCodeSchema.parse(expectedCode);
  const submittedDigest = createHash("sha256").update(submitted, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();

  if (!timingSafeEqual(submittedDigest, expectedDigest)) {
    throw new InvalidTeacherCodeError();
  }

  return { userId: "teacher", role: "TEACHER" };
}

export function persistTeacherIdentity(db: CourseDatabase, identity: TeacherIdentity, now = new Date()) {
  return db.transaction((transaction) => {
    transaction.insert(users).values({
      id: identity.userId,
      classId: null,
      role: "TEACHER",
      alias: "课程负责人",
      createdAt: now,
    }).onConflictDoNothing({ target: users.id }).run();
    const stored = transaction.select({ id: users.id, role: users.role, classId: users.classId })
      .from(users).where(eq(users.id, identity.userId)).get();
    if (!stored || stored.id !== "teacher" || stored.role !== "TEACHER" || stored.classId !== null) {
      throw new Error("教师审计身份不可用");
    }
    return identity;
  }, { behavior: "immediate" });
}
