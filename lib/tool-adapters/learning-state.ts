import type { DatabaseConnection } from "@/lib/db/client";

export type ToolLearningState = {
  adapterId: string;
  status: "EMPTY" | "IN_PROGRESS" | "EVIDENCE_SUBMITTED";
  facts: string[];
};

type BookLayoutEvent = {
  type: "BOOK_LAYOUT_DRAFT_SAVED" | "BOOK_LAYOUT_DRAFT_RESET" | "BOOK_LAYOUT_EVIDENCE_SUBMITTED";
  payloadJson: string;
};

function bookLayoutState(connection: DatabaseConnection, studentId: string): ToolLearningState {
  const row = connection.sqlite.prepare(`
    SELECT type, payload_json payloadJson FROM audit_events
    WHERE user_id=? AND type IN ('BOOK_LAYOUT_DRAFT_SAVED','BOOK_LAYOUT_DRAFT_RESET','BOOK_LAYOUT_EVIDENCE_SUBMITTED')
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).get(studentId) as BookLayoutEvent | undefined;
  if (!row || row.type === "BOOK_LAYOUT_DRAFT_RESET") {
    return { adapterId: "book-layout-lab", status: "EMPTY", facts: ["当前没有可恢复的编排草稿"] };
  }
  const payload = JSON.parse(row.payloadJson) as {
    audience?: string;
    diagnosticAnswers?: Array<string | null>;
    transferChoices?: string[];
    score?: number;
    passed?: boolean;
  };
  const audience = payload.audience === "COMMUNITY_RESIDENTS" ? "社区居民" : "新生";
  const diagnosticCount = payload.diagnosticAnswers?.filter(Boolean).length ?? 0;
  const transferCount = payload.transferChoices?.length ?? 0;
  const facts = [
    `当前受众为${audience}`,
    `三个诊断判断已完成${diagnosticCount}项`,
    `受众迁移选择已确认${transferCount}项`,
  ];
  if (row.type === "BOOK_LAYOUT_EVIDENCE_SUBMITTED") {
    facts.push(`最近一次正式证据为${payload.score ?? 0}/4项通过${payload.passed ? "，已满足规则" : "，仍需修订"}`);
  }
  return {
    adapterId: "book-layout-lab",
    status: row.type === "BOOK_LAYOUT_DRAFT_SAVED" ? "IN_PROGRESS" : "EVIDENCE_SUBMITTED",
    facts,
  };
}

export function readToolLearningState(
  connection: DatabaseConnection,
  studentId: string,
  adapterId: string,
): ToolLearningState | null {
  if (adapterId === "book-layout-lab") return bookLayoutState(connection, studentId);
  return null;
}
