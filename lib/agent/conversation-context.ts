import type { DatabaseConnection } from "@/lib/db/client";
import type { LearningEpisode } from "@/lib/course-packs/contract";

export type RecentConversationTurn = {
  studentMessage: string;
  assistantTitle: string;
  assistantMessage: string;
  episode: LearningEpisode;
};

export function readRecentConversationTurns(
  connection: DatabaseConnection,
  input: {
    studentId: string;
    classId: string;
    coursePackId: string;
    coursePackVersion: string;
    projectId: string | null;
    limit?: number;
  },
): RecentConversationTurn[] {
  const conversation = connection.sqlite.prepare(`
    SELECT id FROM agent_conversations
    WHERE student_id=? AND class_id=? AND course_pack_id=? AND course_pack_version=?
      AND coalesce(project_id, '')=coalesce(?, '')
    ORDER BY updated_at DESC, id DESC LIMIT 1
  `).get(
    input.studentId,
    input.classId,
    input.coursePackId,
    input.coursePackVersion,
    input.projectId,
  ) as { id: string } | undefined;
  if (!conversation) return [];

  const rows = connection.sqlite.prepare(`
    SELECT student_message studentMessage, episode, reply_json replyJson
    FROM agent_turns WHERE conversation_id=?
    ORDER BY turn_sequence DESC LIMIT ?
  `).all(conversation.id, Math.min(Math.max(input.limit ?? 6, 1), 12)) as Array<{
    studentMessage: string;
    episode: LearningEpisode;
    replyJson: string;
  }>;

  return rows.reverse().map((row) => {
    const reply = JSON.parse(row.replyJson) as { title?: unknown; message?: unknown };
    return {
      studentMessage: row.studentMessage,
      episode: row.episode,
      assistantTitle: typeof reply.title === "string" ? reply.title : "",
      assistantMessage: typeof reply.message === "string" ? reply.message : "",
    };
  });
}
