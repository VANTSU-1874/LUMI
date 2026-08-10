import type { DatabaseConnection } from "@/lib/db/client";

import type { RecentConversationTurn } from "./conversation-context";

export type ConversationSessionTurn = RecentConversationTurn & {
  coursePackId: string;
  coursePackVersion: string;
};

export function readConversationSessionTurns(
  connection: DatabaseConnection,
  input: { studentId: string; classId: string; taskId: string; limit?: number },
): ConversationSessionTurn[] {
  const rows = connection.sqlite.prepare(`
    SELECT t.student_message studentMessage, t.episode, t.reply_json replyJson,
      c.course_pack_id coursePackId, c.course_pack_version coursePackVersion
    FROM agent_turns t
    JOIN agent_conversations c ON c.id=t.conversation_id
    WHERE c.student_id=? AND c.class_id=? AND c.task_id=?
    ORDER BY t.created_at DESC, t.rowid DESC
    LIMIT ?
  `).all(
    input.studentId,
    input.classId,
    input.taskId,
    Math.min(Math.max(input.limit ?? 8, 1), 30),
  ) as Array<{
    studentMessage: string;
    episode: RecentConversationTurn["episode"];
    replyJson: string;
    coursePackId: string;
    coursePackVersion: string;
  }>;

  return rows.reverse().map((row) => {
    const reply = JSON.parse(row.replyJson) as { title?: unknown; message?: unknown };
    return {
      studentMessage: row.studentMessage,
      episode: row.episode,
      assistantTitle: typeof reply.title === "string" ? reply.title : "",
      assistantMessage: typeof reply.message === "string" ? reply.message : "",
      coursePackId: row.coursePackId,
      coursePackVersion: row.coursePackVersion,
    };
  });
}
