import { and, eq } from "drizzle-orm";

import { readTeacherScope, TeacherIdentityForbiddenError } from "@/lib/auth/teacher-access";
import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import { evidence } from "@/lib/db/schema";
import { TeacherEvidenceDetailSchema } from "@/lib/domain/teacher-evidence";

type CourseDatabase = DatabaseConnection["db"];

export class TeacherEvidenceReviewForbiddenError extends TeacherIdentityForbiddenError {
  constructor() { super(); this.name = "TeacherEvidenceReviewForbiddenError"; }
}
export class TeacherEvidenceReviewNotFoundError extends Error {
  constructor() { super("证据不存在"); this.name = "TeacherEvidenceReviewNotFoundError"; }
}

export function readTeacherEvidenceDetail(db: CourseDatabase, actor: SessionPayload, evidenceId: string) {
  if (actor.role !== "TEACHER") throw new TeacherEvidenceReviewForbiddenError();
  let scope: ReturnType<typeof readTeacherScope>;
  try {
    scope = readTeacherScope(db, actor);
  } catch (error) {
    if (error instanceof TeacherIdentityForbiddenError) throw new TeacherEvidenceReviewForbiddenError();
    throw error;
  }
  const row = db.select().from(evidence).where(and(
    eq(evidence.id, evidenceId),
    eq(evidence.storageStatus, "READY"),
    scope.kind === "CLASS" ? eq(evidence.classId, scope.classId) : undefined,
  )).get();
  if (!row) throw new TeacherEvidenceReviewNotFoundError();
  const common = {
    id: row.id,
    label: row.label,
    signalLayer: row.signalLayer,
    verificationStatus: row.verificationStatus,
    confirmedCode: row.confirmedCode,
    evidenceSequence: row.evidenceSequence,
    createdAt: row.createdAt.toISOString(),
    dataType: row.dataType,
  };
  if (row.kind === "TEXT") return TeacherEvidenceDetailSchema.parse({ ...common, kind: row.kind, text: row.content });
  if (row.kind === "VALUE") {
    const numericText = row.content.trim();
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(numericText)) throw new Error("CORRUPT_NUMERIC_EVIDENCE");
    return TeacherEvidenceDetailSchema.parse({ ...common, kind: row.kind, value: Number(numericText) });
  }
  if (row.kind === "VIDEO_LINK") return TeacherEvidenceDetailSchema.parse({ ...common, kind: row.kind, url: row.content });
  if (row.kind === "PROBE") return TeacherEvidenceDetailSchema.parse({ ...common, kind: row.kind, probe: row.probeJson });
  return TeacherEvidenceDetailSchema.parse({ ...common, kind: "IMAGE", previewUrl: `/api/evidence/${row.id}` });
}
