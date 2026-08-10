import { randomUUID } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  AgentDecisionReviewInputSchema,
  AgentDecisionReviewPublicSchema,
  type AgentDecisionReviewInput,
} from "@/lib/domain/teacher";

export class AgentReviewForbiddenError extends Error {}
export class AgentReviewNotFoundError extends Error {}

export function saveAgentDecisionReview(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawInput: AgentDecisionReviewInput,
  now = new Date(),
) {
  if (actor.role !== "TEACHER") throw new AgentReviewForbiddenError("仅教师可以复核智能体判断");
  const input = AgentDecisionReviewInputSchema.parse(rawInput);
  const turn = connection.sqlite.prepare(`
    SELECT t.id, t.data_type dataType FROM agent_turns t WHERE t.id=?
  `).get(input.turnId) as { id: string; dataType: "REAL" | "DEMONSTRATION_DATA" } | undefined;
  if (!turn) throw new AgentReviewNotFoundError("智能体判断不存在");
  const existing = connection.sqlite.prepare(
    "SELECT id FROM agent_decision_reviews WHERE turn_id=? AND teacher_id=?",
  ).get(input.turnId, actor.userId) as { id: string } | undefined;
  const id = existing?.id ?? randomUUID();
  connection.sqlite.prepare(`
    INSERT INTO agent_decision_reviews(id,turn_id,teacher_id,decision,notes,created_at,data_type)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(turn_id,teacher_id) DO UPDATE SET
      decision=excluded.decision, notes=excluded.notes, created_at=excluded.created_at, data_type=excluded.data_type
  `).run(id, input.turnId, actor.userId, input.decision, input.notes, Math.floor(now.getTime() / 1_000), turn.dataType);
  return AgentDecisionReviewPublicSchema.parse({
    id, turnId: input.turnId, teacherId: actor.userId, decision: input.decision,
    notes: input.notes, createdAt: now.toISOString(), dataType: turn.dataType,
  });
}
