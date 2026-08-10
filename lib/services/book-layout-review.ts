import { BookLayoutEvidenceResponseSchema, type BookLayoutEvidenceResponse } from "@/lib/domain/book-layout";
import { TeacherOriginalSnapshotSchema } from "@/lib/domain/teacher";

export type BookLayoutEvidenceAuditRow = {
  id: string;
  payloadJson: string;
  createdAt: number;
  dataType: "REAL" | "DEMONSTRATION_DATA";
};

export function parseBookLayoutEvidenceAuditRow(row: BookLayoutEvidenceAuditRow) {
  return BookLayoutEvidenceResponseSchema.parse({
    id: row.id,
    ...JSON.parse(row.payloadJson) as Record<string, unknown>,
    createdAt: new Date(row.createdAt * 1_000).toISOString(),
    dataType: row.dataType,
  });
}

export function bookLayoutReviewTarget(value: BookLayoutEvidenceResponse) {
  return {
    targetId: value.id,
    snapshot: TeacherOriginalSnapshotSchema.parse({
      targetType: "BOOK_LAYOUT_EVIDENCE",
      revision: 1,
      id: value.id,
      audience: value.audience,
      pageOrder: value.pageOrder,
      diagnosticAnswers: value.diagnosticAnswers,
      transferChoices: value.transferChoices,
      criteria: value.criteria,
      score: value.score,
      passed: value.passed,
    }),
  };
}
