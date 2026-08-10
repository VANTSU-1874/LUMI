import { and, eq } from "drizzle-orm";

import type { DatabaseConnection } from "@/lib/db/client";
import { evidence } from "@/lib/db/schema";

import { bumpEvidenceRevision, EvidenceRecordSchema } from "./evidence";

type CourseDatabase = DatabaseConnection["db"];
type CourseTransaction = Parameters<Parameters<CourseDatabase["transaction"]>[0]>[0];

const LAYER_CODE = {
  INPUT: "INPUT_OK",
  MAPPING: "MAPPING_OK",
  TRANSPORT: "TRANSPORT_OK",
  BINDING: "BINDING_OK",
  OUTPUT: "OUTPUT_OK",
} as const;

export class EvidenceVerificationNotFoundError extends Error {
  constructor() {
    super("证据不存在");
    this.name = "EvidenceVerificationNotFoundError";
  }
}

type TeacherEvidenceDecision = "CONFIRMED" | "CORRECTED" | "NEEDS_REVIEW";

function updateEvidenceVerification(
  transaction: CourseTransaction,
  row: typeof evidence.$inferSelect,
  decision: TeacherEvidenceDecision,
) {
  const nextStatus = decision === "CONFIRMED" ? "TEACHER_VERIFIED" : decision === "CORRECTED" ? "REJECTED" : "SUBMITTED";
  const nextCode = decision === "CONFIRMED" ? LAYER_CODE[row.signalLayer] : null;
  if (row.verificationStatus === nextStatus && row.confirmedCode === nextCode) return EvidenceRecordSchema.parse(row);
  const updated = transaction.update(evidence).set({ verificationStatus: nextStatus, confirmedCode: nextCode })
    .where(and(eq(evidence.id, row.id), eq(evidence.projectId, row.projectId), eq(evidence.classId, row.classId), eq(evidence.studentId, row.studentId), eq(evidence.storageStatus, "READY"))).run();
  if (updated.changes !== 1) throw new EvidenceVerificationNotFoundError();
  bumpEvidenceRevision(transaction, row.projectId);
  return EvidenceRecordSchema.parse(transaction.select().from(evidence).where(eq(evidence.id, row.id)).get());
}

export function applyTeacherEvidenceDecision(
  transaction: CourseTransaction,
  target: { evidenceId: string; projectId: string; classId: string; studentId: string },
  decision: TeacherEvidenceDecision,
) {
  const row = transaction.select().from(evidence).where(and(
    eq(evidence.id, target.evidenceId),
    eq(evidence.projectId, target.projectId),
    eq(evidence.classId, target.classId),
    eq(evidence.studentId, target.studentId),
    eq(evidence.storageStatus, "READY"),
  )).get();
  if (!row) throw new EvidenceVerificationNotFoundError();
  return updateEvidenceVerification(transaction, row, decision);
}
