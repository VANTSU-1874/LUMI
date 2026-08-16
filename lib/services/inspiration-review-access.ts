import { and, eq } from "drizzle-orm";

import type { SessionPayload } from "@/lib/auth/session";
import { readTeacherScope, TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";
import type { DatabaseConnection } from "@/lib/db/client";
import { inspirationCandidates } from "@/lib/db/schema";

type CourseDb = DatabaseConnection["db"];
export type InspirationReviewActor = SessionPayload;

/** The DB-backed identity check shared by every teacher-review read path. */
export function assertTeacherInspirationReviewAccess(db: CourseDb, actor: InspirationReviewActor) {
  if (actor.role !== "TEACHER") throw new TeacherIdentityForbiddenError();
  return readTeacherScope(db, actor);
}

/** A held, frozen, withdrawn, or otherwise non-ready candidate is never reviewable. */
export function isTeacherReviewableInspirationCandidate(row: { state: string; withdrawalStatus: string }) {
  return row.state === "READY_FOR_TEACHER_REVIEW" && row.withdrawalStatus === "READY";
}

export function teacherReviewableInspirationCandidateCondition() {
  return and(
    eq(inspirationCandidates.state, "READY_FOR_TEACHER_REVIEW"),
    eq(inspirationCandidates.withdrawalStatus, "READY"),
  );
}

/**
 * Fetches a candidate only after the same database identity and eligibility
 * checks used by the teacher queue. The caller must not serialize this row.
 */
export function readTeacherReviewableInspirationCandidate(
  db: CourseDb,
  actor: InspirationReviewActor,
  candidateId: string,
) {
  assertTeacherInspirationReviewAccess(db, actor);
  return db.select().from(inspirationCandidates).where(and(
    eq(inspirationCandidates.id, candidateId),
    teacherReviewableInspirationCandidateCondition(),
  )).get() ?? null;
}
