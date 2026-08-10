import { z } from "zod";

import type {
  DatabaseConnection,
} from "@/lib/db/client";

const InputSchema = z.object({
  memoryId: z.string().trim().min(1).max(128),
  studentId: z.string().trim().min(1).max(128),
  classId: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(1).max(500),
  now: z.date(),
}).strict();

export function recordStudentMemoryDispute(
  connection: DatabaseConnection,
  rawInput: z.input<typeof InputSchema>,
) {
  const input = InputSchema.parse(rawInput);
  const owned = connection.sqlite.prepare(`
    SELECT id
    FROM agent_student_memory
    WHERE id=? AND student_id=? AND class_id=?
  `).get(
    input.memoryId,
    input.studentId,
    input.classId,
  ) as { id: string } | undefined;
  if (!owned) {
    throw new Error(
      "STUDENT_MEMORY_DISPUTE_TARGET_NOT_FOUND",
    );
  }
  connection.sqlite.prepare(`
    INSERT INTO agent_student_memory_disputes(
      memory_id,student_id,class_id,reason,created_at
    ) VALUES(?,?,?,?,?)
    ON CONFLICT(memory_id) DO UPDATE SET
      reason=excluded.reason,
      created_at=excluded.created_at
    WHERE
      student_id=excluded.student_id
      AND class_id=excluded.class_id
  `).run(
    input.memoryId,
    input.studentId,
    input.classId,
    input.reason,
    Math.floor(input.now.getTime() / 1_000),
  );
  return {
    memoryId: input.memoryId,
    status: "DISPUTED" as const,
    reason: input.reason,
    createdAt: input.now.toISOString(),
  };
}
