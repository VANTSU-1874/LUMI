import { z } from "zod";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";

import { readDesignTask } from "./design-project-task";
import { readAgentConversation } from "./orchestrator";
import { readProjectBrief } from "./project-brief-memory";

export const FreshProcessRecoveryResultSchema = z.object({
  taskRecovered: z.boolean(),
  conversationRecovered: z.boolean(),
  turnCount: z.number().int().nonnegative(),
  briefRecovered: z.boolean(),
}).strict();

export type FreshProcessRecoveryResult = z.infer<typeof FreshProcessRecoveryResultSchema>;

export function inspectPersistedAgentState(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  taskId: string;
  conversationId: string;
  goalIncludes: string;
}) {
  const recoveredTask = readDesignTask(input.connection, input.actor, input.taskId).task;
  const conversation = readAgentConversation(input.connection, input.actor, "AGENT", input.taskId);
  const student = input.connection.sqlite.prepare("SELECT class_id classId FROM users WHERE id=?")
    .get(input.actor.userId) as { classId: string } | undefined;
  if (!student?.classId) throw new Error("BENCHMARK_STUDENT_CLASS_MISSING");
  const brief = readProjectBrief(input.connection, input.actor.userId, student.classId, input.taskId);
  return FreshProcessRecoveryResultSchema.parse({
    taskRecovered: recoveredTask.id === input.taskId,
    conversationRecovered: conversation.conversationId === input.conversationId,
    turnCount: conversation.turns.length,
    briefRecovered: brief.fields.designGoal?.value.includes(input.goalIncludes) === true,
  });
}
