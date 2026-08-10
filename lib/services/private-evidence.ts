import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import path from "node:path";

import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import { auditEvents, evidence, hintEvidenceConsumptions, projects, users } from "@/lib/db/schema";
import { EvidenceRecordSchema } from "@/lib/services/evidence";
import { resolveStoredEvidence, streamStoredEvidence, UnsafeEvidencePathError } from "@/lib/security/uploads";

type CourseDatabase = DatabaseConnection["db"];

const EvidenceCursorSchema = z.object({ createdAt: z.number().int().nonnegative(), id: z.uuid() }).strict();

export class InvalidEvidenceListQueryError extends Error {
  constructor() { super("证据列表参数无效"); this.name = "InvalidEvidenceListQueryError"; }
}

export class PrivateEvidenceNotFoundError extends Error {
  constructor() { super("证据不存在"); this.name = "PrivateEvidenceNotFoundError"; }
}

export class EvidenceCleanupPendingError extends Error {
  constructor(readonly retryCleanup: () => Promise<void>) {
    super("证据已删除，私有存储清理待重试");
    this.name = "EvidenceCleanupPendingError";
  }
}

function expectedDataType(studentId: string) {
  return studentId.startsWith("demo-student-") ? "DEMONSTRATION_DATA" : "REAL";
}

function decodeCursor(value: string | null) {
  if (!value) return undefined;
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw new InvalidEvidenceListQueryError();
  try {
    return EvidenceCursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch { throw new InvalidEvidenceListQueryError(); }
}

function encodeCursor(row: { createdAt: Date; id: string }) {
  return Buffer.from(JSON.stringify({ createdAt: row.createdAt.getTime(), id: row.id }), "utf8").toString("base64url");
}

export function listPrivateEvidence(
  db: CourseDatabase,
  actor: SessionPayload,
  raw: { limit?: string | null; cursor?: string | null; studentId?: string | null },
) {
  const limit = raw.limit == null || raw.limit === "" ? 20 : Number(raw.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new InvalidEvidenceListQueryError();
  const cursor = decodeCursor(raw.cursor ?? null);
  const actorUser = db.select({ id: users.id, role: users.role, classId: users.classId }).from(users).where(eq(users.id, actor.userId)).get();
  if (!actorUser || actorUser.role !== actor.role) throw new PrivateEvidenceNotFoundError();
  const requestedStudent = raw.studentId?.trim() || undefined;
  if (actor.role === "STUDENT" && requestedStudent) throw new InvalidEvidenceListQueryError();
  if (requestedStudent && requestedStudent.length > 128) throw new InvalidEvidenceListQueryError();

  const isGlobalTeacher = actor.userId === "teacher" && actorUser.role === "TEACHER" && actorUser.classId === null;
  const owner = actor.role === "STUDENT"
    ? eq(evidence.studentId, actor.userId)
    : isGlobalTeacher
      ? requestedStudent ? eq(evidence.studentId, requestedStudent) : undefined
      : and(eq(evidence.classId, actorUser.classId ?? ""), requestedStudent ? eq(evidence.studentId, requestedStudent) : undefined);
  const cursorWhere = cursor ? or(
    lt(evidence.createdAt, new Date(cursor.createdAt)),
    and(eq(evidence.createdAt, new Date(cursor.createdAt)), lt(evidence.id, cursor.id)),
  ) : undefined;
  const rows = db.select({
    id: evidence.id,
    projectId: evidence.projectId,
    classId: evidence.classId,
    studentId: evidence.studentId,
    ownerAlias: users.alias,
    kind: evidence.kind,
    signalLayer: evidence.signalLayer,
    label: evidence.label,
    verificationStatus: evidence.verificationStatus,
    createdAt: evidence.createdAt,
    dataType: evidence.dataType,
  }).from(evidence).innerJoin(users, and(eq(users.id, evidence.studentId), eq(users.classId, evidence.classId)))
    .where(and(eq(evidence.storageStatus, "READY"), owner, cursorWhere))
    .orderBy(desc(evidence.createdAt), desc(evidence.id)).limit(limit + 1).all();
  const visible = rows.slice(0, limit);
  return {
    items: visible.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    nextCursor: rows.length > limit && visible.length ? encodeCursor(visible[visible.length - 1]) : null,
  };
}

function authorizedRow(db: CourseDatabase, actor: SessionPayload, evidenceId: string) {
  const raw = db.select().from(evidence).where(and(eq(evidence.id, evidenceId), eq(evidence.storageStatus, "READY"))).get();
  const parsed = EvidenceRecordSchema.safeParse(raw);
  if (!parsed.success || parsed.data.dataType !== expectedDataType(parsed.data.studentId)) return undefined;
  const row = parsed.data;
  if (actor.role === "STUDENT") return row.studentId === actor.userId ? row : undefined;
  const teacher = db.select({ classId: users.classId, role: users.role }).from(users)
    .where(and(eq(users.id, actor.userId), eq(users.role, "TEACHER"))).get();
  if (actor.userId === "teacher" && teacher?.classId === null) return row; // Only the persisted unscoped course owner manages all classes.
  return teacher?.classId === row.classId ? row : undefined;
}

function assertBoundImagePath(row: ReturnType<typeof EvidenceRecordSchema.parse>) {
  if (row.kind !== "IMAGE" || !row.content.startsWith(`${row.projectId}/${row.id}.`)) throw new PrivateEvidenceNotFoundError();
  return row;
}

export async function openPrivateEvidence(db: CourseDatabase, actor: SessionPayload, evidenceId: string, root: string) {
  const row = authorizedRow(db, actor, evidenceId);
  if (!row) throw new PrivateEvidenceNotFoundError();
  assertBoundImagePath(row);
  try {
    const file = await resolveStoredEvidence(root, row.content);
    const extension = path.extname(row.content).toLowerCase();
    const contentType = extension === ".png" ? "image/png" : extension === ".jpg" ? "image/jpeg" : "image/webp";
    return { stream: streamStoredEvidence(file.absolutePath), size: file.size, contentType };
  } catch (error) {
    if (error instanceof UnsafeEvidencePathError || (error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PrivateEvidenceNotFoundError();
    }
    throw error;
  }
}

export async function deletePrivateEvidence(
  db: CourseDatabase,
  actor: SessionPayload,
  evidenceId: string,
  root: string,
  options: {
    rename?: typeof rename;
    remove?: typeof rm;
    beforeDeleteTransaction?: () => void;
  } = {},
) {
  const row = authorizedRow(db, actor, evidenceId);
  if (!row) return false;
  let originalPath: string | undefined;
  let tombstonePath: string | undefined;
  if (row.kind === "IMAGE") {
    assertBoundImagePath(row);
    try {
      const file = await resolveStoredEvidence(root, row.content);
      originalPath = file.absolutePath;
      const extension = path.extname(originalPath).toLowerCase();
      tombstonePath = path.join(path.dirname(originalPath), `.deleting-${row.id}-${randomUUID()}${extension}`);
      await (options.rename ?? rename)(originalPath, tombstonePath);
    } catch (error) {
      if (!(error instanceof UnsafeEvidencePathError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (error instanceof UnsafeEvidencePathError) throw new PrivateEvidenceNotFoundError();
    }
  }

  let databaseCommitted = false;
  try {
    options.beforeDeleteTransaction?.();
    const deleted = db.transaction((transaction) => {
      transaction.delete(hintEvidenceConsumptions).where(eq(hintEvidenceConsumptions.evidenceId, row.id)).run();
      const result = transaction.delete(evidence).where(and(
        eq(evidence.id, row.id), eq(evidence.projectId, row.projectId), eq(evidence.classId, row.classId), eq(evidence.studentId, row.studentId),
      )).run();
      if (result.changes === 0) return false;
      transaction.update(projects).set({ evidenceRevision: sql`${projects.evidenceRevision} + 1`, updatedAt: new Date() })
        .where(and(eq(projects.id, row.projectId), eq(projects.classId, row.classId), eq(projects.studentId, row.studentId))).run();
      transaction.insert(auditEvents).values({
        id: randomUUID(),
        userId: actor.userId,
        type: "EVIDENCE_DELETED",
        payloadJson: { evidenceId: row.id, projectId: row.projectId, actorRole: actor.role },
        createdAt: new Date(),
      }).run();
      return true;
    }, { behavior: "immediate" });
    databaseCommitted = true;
    if (tombstonePath) {
      try { await (options.remove ?? rm)(tombstonePath, { force: true }); }
      catch {
        const ownedTombstone = tombstonePath;
        throw new EvidenceCleanupPendingError(async () => {
          await rm(ownedTombstone, { force: true });
        });
      }
    }
    return deleted;
  } catch (error) {
    if (!databaseCommitted && originalPath && tombstonePath) {
      try { await (options.rename ?? rename)(tombstonePath, originalPath); } catch { /* recovery restores a tombstone whose READY row still exists */ }
    }
    throw error;
  }
}
