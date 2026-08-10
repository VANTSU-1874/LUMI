import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { SessionPayload } from "@/lib/auth/session";
import { assertTeacherClassAccess, TeacherClassAccessNotFoundError, TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";
import type { DatabaseConnection } from "@/lib/db/client";
import { auditEvents, evidence, logicCards, projects, teacherDecisions, transferAttempts, transferChallenges, users } from "@/lib/db/schema";
import { BookLayoutEvidenceResponseSchema } from "@/lib/domain/book-layout";
import { TransferRubricSchema } from "@/lib/domain/transfer";
import { TeacherDecisionInputSchema, TeacherDecisionPublicSchema, TeacherOriginalSnapshotSchema, type TeacherDecisionInput, type TeacherOriginalSnapshot } from "@/lib/domain/teacher";
import { SemanticLogicReviewSchema } from "./semantic-logic-review";
import { applyTeacherEvidenceDecision, EvidenceVerificationNotFoundError } from "./evidence-verification";

type CourseDatabase = DatabaseConnection["db"];

export class TeacherDecisionNotFoundError extends Error {
  constructor() { super("NOT_FOUND"); this.name = "TeacherDecisionNotFoundError"; }
}
export class TeacherDecisionRevisionConflictError extends Error {
  constructor() { super("REVISION_CONFLICT"); this.name = "TeacherDecisionRevisionConflictError"; }
}
export class TeacherDecisionForbiddenError extends Error {
  constructor() { super("FORBIDDEN"); this.name = "TeacherDecisionForbiddenError"; }
}
export class TeacherDecisionRequestConflictError extends Error {
  constructor() { super("REQUEST_CONFLICT"); this.name = "TeacherDecisionRequestConflictError"; }
}
export class TeacherDecisionCorruptionError extends Error {
  constructor() { super("CORRUPT_DECISION"); this.name = "TeacherDecisionCorruptionError"; }
}

function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex"); }

function canonicalRequest(input: Pick<TeacherDecisionInput, "classId" | "studentId" | "projectId" | "targetType" | "targetId" | "originalRevision" | "decision" | "reasonCode" | "notes">) {
  return [input.classId, input.studentId, input.projectId, input.targetType, input.targetId, input.originalRevision, input.decision, input.reasonCode, input.notes] as const;
}

export function publicTeacherDecision(row: typeof teacherDecisions.$inferSelect) {
  const originalSnapshot = TeacherOriginalSnapshotSchema.parse(row.originalSnapshotJson);
  const snapshotHash = digest(originalSnapshot);
  const requestHash = digest(canonicalRequest(row));
  if (snapshotHash !== row.originalSnapshotHash || requestHash !== row.requestHash) throw new TeacherDecisionCorruptionError();
  return TeacherDecisionPublicSchema.parse({
    id: row.id, targetType: row.targetType, targetId: row.targetId,
    originalRevision: row.originalRevision, decision: row.decision,
    reasonCode: row.reasonCode, notes: row.notes, sequence: row.sequence, timelineSequence: row.timelineSequence,
    createdAt: row.createdAt.toISOString(),
    originalSnapshot,
  });
}

function readSnapshot(transaction: Parameters<Parameters<CourseDatabase["transaction"]>[0]>[0], input: TeacherDecisionInput): TeacherOriginalSnapshot {
  if (input.targetType === "BOOK_LAYOUT_EVIDENCE") {
    const row = transaction.select().from(auditEvents).where(and(
      eq(auditEvents.id, input.targetId),
      eq(auditEvents.userId, input.studentId),
      eq(auditEvents.type, "BOOK_LAYOUT_EVIDENCE_SUBMITTED"),
    )).get();
    if (!row) throw new TeacherDecisionNotFoundError();
    const evidenceResponse = BookLayoutEvidenceResponseSchema.parse({
      id: row.id,
      ...row.payloadJson,
      createdAt: row.createdAt.toISOString(),
      dataType: row.dataType,
    });
    return TeacherOriginalSnapshotSchema.parse({
      targetType: "BOOK_LAYOUT_EVIDENCE",
      revision: 1,
      id: evidenceResponse.id,
      audience: evidenceResponse.audience,
      pageOrder: evidenceResponse.pageOrder,
      diagnosticAnswers: evidenceResponse.diagnosticAnswers,
      transferChoices: evidenceResponse.transferChoices,
      criteria: evidenceResponse.criteria,
      score: evidenceResponse.score,
      passed: evidenceResponse.passed,
    });
  }
  if (input.targetType === "LOGIC_REVIEW") {
    if (!input.projectId) throw new TeacherDecisionNotFoundError();
    if (input.targetId !== input.projectId) throw new TeacherDecisionNotFoundError();
    const row = transaction.select().from(logicCards).where(eq(logicCards.projectId, input.projectId)).get();
    if (!row) throw new TeacherDecisionNotFoundError();
    const review = SemanticLogicReviewSchema.parse(row.semanticReviewJson);
    return TeacherOriginalSnapshotSchema.parse({ targetType: "LOGIC_REVIEW", revision: row.revision, status: review.status, ruleReady: row.ruleReady, semanticReady: row.semanticReady, source: review.source, issues: review.issues });
  }
  if (input.targetType === "EVIDENCE") {
    if (!input.projectId) throw new TeacherDecisionNotFoundError();
    const row = transaction.select().from(evidence).where(and(eq(evidence.id, input.targetId), eq(evidence.projectId, input.projectId), eq(evidence.classId, input.classId), eq(evidence.studentId, input.studentId), eq(evidence.storageStatus, "READY"))).get();
    if (!row) throw new TeacherDecisionNotFoundError();
    const evidenceRevision = transaction.select({ value: projects.evidenceRevision }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.classId, input.classId), eq(projects.studentId, input.studentId))).get()?.value;
    if (evidenceRevision === undefined) throw new TeacherDecisionNotFoundError();
    return TeacherOriginalSnapshotSchema.parse({ targetType: "EVIDENCE", id: row.id, kind: row.kind, layer: row.signalLayer, verification: row.verificationStatus, code: row.confirmedCode, revision: Math.max(1, evidenceRevision), sequence: row.evidenceSequence });
  }
  if (!input.projectId) throw new TeacherDecisionNotFoundError();
  const challenge = transaction.select().from(transferChallenges).where(and(eq(transferChallenges.id, input.targetId), eq(transferChallenges.projectId, input.projectId), eq(transferChallenges.classId, input.classId), eq(transferChallenges.studentId, input.studentId))).get();
  if (!challenge) throw new TeacherDecisionNotFoundError();
  const attempt = transaction.select({ rubric: transferAttempts.rubricJson }).from(transferAttempts).where(eq(transferAttempts.challengeId, challenge.id)).orderBy(desc(transferAttempts.attemptNumber)).limit(1).get();
  const rubric = attempt ? TransferRubricSchema.parse(attempt.rubric) : null;
  return TeacherOriginalSnapshotSchema.parse({ targetType: "TRANSFER", revision: challenge.revision, status: challenge.status, attemptCount: challenge.attemptCount, latestRubric: rubric, latestOutcome: rubric?.outcome ?? null });
}

export function appendTeacherDecision(
  db: CourseDatabase,
  actor: SessionPayload,
  rawInput: TeacherDecisionInput,
) {
  if (actor.role !== "TEACHER") throw new TeacherDecisionForbiddenError();
  const input = TeacherDecisionInputSchema.parse(rawInput);
  const requestHash = digest(canonicalRequest(input));
  return db.transaction((transaction) => {
    try {
      assertTeacherClassAccess(transaction, actor, input.classId);
    } catch (error) {
      if (error instanceof TeacherIdentityForbiddenError) throw new TeacherDecisionForbiddenError();
      if (error instanceof TeacherClassAccessNotFoundError) throw new TeacherDecisionNotFoundError();
      throw error;
    }
    const previous = transaction.select().from(teacherDecisions).where(and(
      eq(teacherDecisions.teacherId, actor.userId),
      eq(teacherDecisions.classId, input.classId),
      eq(teacherDecisions.idempotencyKey, input.idempotencyKey),
    )).get();
    if (previous) {
      if (previous.requestHash !== requestHash) throw new TeacherDecisionRequestConflictError();
      return publicTeacherDecision(previous);
    }
    const student = transaction.select({ id: users.id }).from(users).where(and(
      eq(users.id, input.studentId), eq(users.classId, input.classId), eq(users.role, "STUDENT"),
    )).get();
    if (!student) throw new TeacherDecisionNotFoundError();
    if (input.targetType !== "BOOK_LAYOUT_EVIDENCE") {
      if (!input.projectId) throw new TeacherDecisionNotFoundError();
      const project = transaction.select({ id: projects.id }).from(projects).where(and(
        eq(projects.id, input.projectId), eq(projects.classId, input.classId), eq(projects.studentId, input.studentId),
      )).get();
      if (!project) throw new TeacherDecisionNotFoundError();
    }

    const originalSnapshot = readSnapshot(transaction, input);
    if (originalSnapshot.revision !== input.originalRevision) throw new TeacherDecisionRevisionConflictError();
    const originalSnapshotHash = digest(originalSnapshot);

    const sequence = (transaction.select({ value: sql<number>`coalesce(max(${teacherDecisions.sequence}), 0)` })
      .from(teacherDecisions).where(and(
        eq(teacherDecisions.classId, input.classId), eq(teacherDecisions.targetType, input.targetType),
        eq(teacherDecisions.targetId, input.targetId),
      )).get()?.value ?? 0) + 1;
    const timelineSequence = (transaction.select({ value: sql<number>`coalesce(max(${teacherDecisions.timelineSequence}), 0)` })
      .from(teacherDecisions).where(and(eq(teacherDecisions.classId, input.classId), eq(teacherDecisions.studentId, input.studentId))).get()?.value ?? 0) + 1;
    const now = new Date();
    transaction.insert(teacherDecisions).values({
      id: randomUUID(), teacherId: actor.userId, classId: input.classId,
      studentId: input.studentId, projectId: input.projectId,
      targetType: input.targetType, targetId: input.targetId,
      originalRevision: input.originalRevision, decision: input.decision,
      reasonCode: input.reasonCode, notes: input.notes, sequence, timelineSequence,
      idempotencyKey: input.idempotencyKey, requestHash,
      originalSnapshotJson: originalSnapshot, originalSnapshotHash, createdAt: now,
    }).run();
    if (input.targetType === "EVIDENCE") {
      if (!input.projectId) throw new TeacherDecisionNotFoundError();
      try {
        applyTeacherEvidenceDecision(transaction, { evidenceId: input.targetId, projectId: input.projectId, classId: input.classId, studentId: input.studentId }, input.decision);
      } catch (error) {
        if (error instanceof EvidenceVerificationNotFoundError) throw new TeacherDecisionNotFoundError();
        throw error;
      }
    }
    const inserted = transaction.select().from(teacherDecisions).where(and(
      eq(teacherDecisions.teacherId, actor.userId), eq(teacherDecisions.classId, input.classId),
      eq(teacherDecisions.idempotencyKey, input.idempotencyKey),
    )).get();
    if (!inserted) throw new Error("teacher decision insert failed");
    return publicTeacherDecision(inserted);
  }, { behavior: "immediate" });
}

export function readTeacherDecisions(db: CourseDatabase, classId: string, studentId: string, projectId: string | null, limit = 20) {
  return db.select().from(teacherDecisions).where(and(
    eq(teacherDecisions.classId, classId), eq(teacherDecisions.studentId, studentId),
    projectId === null ? isNull(teacherDecisions.projectId) : eq(teacherDecisions.projectId, projectId),
  )).orderBy(desc(teacherDecisions.timelineSequence)).limit(Math.min(Math.max(limit, 1), 50)).all().map(publicTeacherDecision);
}
