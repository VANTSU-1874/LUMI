import type { DatabaseConnection } from "@/lib/db/client";
import {
  redactSensitiveText,
  studentNumberPolicyFromEnvironment,
} from "@/lib/security/redaction";

export const SESSION_RECENT_TURN_LIMIT = 8;
const MAX_SUMMARY_LENGTH = 5_900;

export type AgentSessionSummary = {
  summary: string;
  coveredTurnCount: number;
  updatedAt: string;
};

type SummaryRow = {
  id: string;
  createdAt: number;
  studentMessage: string;
  replyJson: string;
};

type StoredSummary = {
  summary: string;
  throughTurnId: string;
  throughCreatedAt: number;
  coveredTurnCount: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
};

function epochSeconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

function isoFromEpochSeconds(value: number) {
  return new Date(value * 1_000).toISOString();
}

function compact(value: string, limit: number) {
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function summaryLine(
  row: SummaryRow,
  environment: Record<string, string | undefined>,
) {
  const studentNumber = studentNumberPolicyFromEnvironment(environment);
  const protect = (value: string) => redactSensitiveText(value, { studentNumber });
  let reply: { title?: unknown; message?: unknown } = {};
  try {
    reply = JSON.parse(row.replyJson) as typeof reply;
  } catch {
    // A malformed historic reply should not block newer turns from being saved.
  }
  const student = compact(protect(row.studentMessage), 220);
  const title = typeof reply.title === "string" ? compact(protect(reply.title), 80) : "";
  const message = typeof reply.message === "string" ? compact(protect(reply.message), 260) : "";
  const tutor = [title, message].filter(Boolean).join("：");
  return `- 学生：${student}${tutor ? `｜导师：${tutor}` : ""}`;
}

function rollSummary(existing: string | null, rows: readonly SummaryRow[], coveredTurnCount: number, environment: Record<string, string | undefined>) {
  const previousLines = existing?.split("\n").filter((line) => line.startsWith("- ")) ?? [];
  const lines = [...previousLines, ...rows.map((row) => summaryLine(row, environment))];
  const header = `已压缩 ${coveredTurnCount} 个较早回合。以下是脱敏后的历史要点；当前学生表述优先于旧摘要：`;
  while (lines.length > 1 && `${header}\n${lines.join("\n")}`.length > MAX_SUMMARY_LENGTH) {
    lines.shift();
  }
  const summary = `${header}\n${lines.join("\n")}`.trim();
  return summary.length <= MAX_SUMMARY_LENGTH ? summary : summary.slice(0, MAX_SUMMARY_LENGTH);
}

export function readAgentSessionSummary(
  connection: DatabaseConnection,
  input: { taskId: string; studentId: string; classId: string },
): AgentSessionSummary | null {
  const row = connection.sqlite.prepare(`
    SELECT summary,covered_turn_count coveredTurnCount,updated_at updatedAt
    FROM agent_session_summaries
    WHERE task_id=? AND student_id=? AND class_id=?
  `).get(input.taskId, input.studentId, input.classId) as {
    summary: string;
    coveredTurnCount: number;
    updatedAt: number;
  } | undefined;
  return row ? {
    summary: row.summary,
    coveredTurnCount: row.coveredTurnCount,
    updatedAt: isoFromEpochSeconds(row.updatedAt),
  } : null;
}

export function applyAgentSessionSummaryWriteback(input: {
  connection: DatabaseConnection;
  taskId: string;
  studentId: string;
  classId: string;
  now: Date;
  environment?: Record<string, string | undefined>;
  recentTurnLimit?: number;
}) {
  const recentTurnLimit = Math.min(Math.max(input.recentTurnLimit ?? SESSION_RECENT_TURN_LIMIT, 1), 30);
  const totalTurns = (input.connection.sqlite.prepare(`
    SELECT count(*) count FROM agent_turns t
    JOIN agent_conversations c ON c.id=t.conversation_id
    WHERE c.task_id=? AND c.student_id=? AND c.class_id=?
  `).get(input.taskId, input.studentId, input.classId) as { count: number }).count;
  const targetCoveredCount = Math.max(0, totalTurns - recentTurnLimit);
  const existing = input.connection.sqlite.prepare(`
    SELECT summary,through_turn_id throughTurnId,through_created_at throughCreatedAt,
      covered_turn_count coveredTurnCount,revision,created_at createdAt,updated_at updatedAt
    FROM agent_session_summaries
    WHERE task_id=? AND student_id=? AND class_id=?
  `).get(input.taskId, input.studentId, input.classId) as StoredSummary | undefined;
  const alreadyCovered = existing?.coveredTurnCount ?? 0;
  if (targetCoveredCount <= alreadyCovered) return false;
  const foldCount = targetCoveredCount - alreadyCovered;
  const rows = (existing
    ? input.connection.sqlite.prepare(`
        SELECT t.id,t.created_at createdAt,t.student_message studentMessage,t.reply_json replyJson
        FROM agent_turns t JOIN agent_conversations c ON c.id=t.conversation_id
        WHERE c.task_id=? AND c.student_id=? AND c.class_id=?
          AND t.rowid>(SELECT rowid FROM agent_turns WHERE id=?)
        ORDER BY t.rowid ASC LIMIT ?
      `).all(
        input.taskId,
        input.studentId,
        input.classId,
        existing.throughTurnId,
        foldCount,
      )
    : input.connection.sqlite.prepare(`
        SELECT t.id,t.created_at createdAt,t.student_message studentMessage,t.reply_json replyJson
        FROM agent_turns t JOIN agent_conversations c ON c.id=t.conversation_id
        WHERE c.task_id=? AND c.student_id=? AND c.class_id=?
        ORDER BY t.rowid ASC LIMIT ?
      `).all(input.taskId, input.studentId, input.classId, foldCount)) as SummaryRow[];
  if (rows.length === 0) return false;

  const coveredTurnCount = alreadyCovered + rows.length;
  const through = rows.at(-1)!;
  const now = epochSeconds(input.now);
  const summary = rollSummary(
    existing?.summary ?? null,
    rows,
    coveredTurnCount,
    input.environment ?? process.env,
  );
  if (!existing) {
    input.connection.sqlite.prepare(`
      INSERT INTO agent_session_summaries(
        task_id,student_id,class_id,summary,through_turn_id,through_created_at,
        covered_turn_count,revision,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,1,?,?)
    `).run(
      input.taskId,
      input.studentId,
      input.classId,
      summary,
      through.id,
      through.createdAt,
      coveredTurnCount,
      now,
      now,
    );
    return true;
  }
  const updated = input.connection.sqlite.prepare(`
    UPDATE agent_session_summaries SET
      summary=?,through_turn_id=?,through_created_at=?,covered_turn_count=?,
      revision=revision+1,updated_at=?
    WHERE task_id=? AND student_id=? AND class_id=? AND revision=?
  `).run(
    summary,
    through.id,
    through.createdAt,
    coveredTurnCount,
    now,
    input.taskId,
    input.studentId,
    input.classId,
    existing.revision,
  );
  return updated.changes === 1;
}
