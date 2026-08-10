import { randomUUID } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  BookLayoutEvidenceRequestSchema,
  BookLayoutEvidenceResponseSchema,
  BookLayoutDraftRequestSchema,
  BookLayoutDraftResponseSchema,
  BookLayoutWorkspaceResponseSchema,
  type BookLayoutEvidenceRequest,
  type BookLayoutEvidenceResponse,
  type BookLayoutDraftRequest,
  type BookLayoutDraftResponse,
  type BookLayoutWorkspaceResponse,
} from "@/lib/domain/book-layout";

export class BookLayoutForbiddenError extends Error {}
export class BookLayoutNotFoundError extends Error {}

function studentClass(connection: DatabaseConnection, actor: SessionPayload) {
  if (actor.role !== "STUDENT") throw new BookLayoutForbiddenError("仅学生可以提交书籍设计学习证据");
  const row = connection.sqlite.prepare(
    "SELECT class_id classId FROM users WHERE id=? AND role='STUDENT'",
  ).get(actor.userId) as { classId: string | null } | undefined;
  if (!row?.classId) throw new BookLayoutNotFoundError("学生身份不存在");
  return row.classId;
}

function evaluate(input: BookLayoutEvidenceRequest) {
  const diagnosticPassed = input.diagnosticAnswers.every((answer) => answer !== "DECORATION_FIRST");
  const pageBoundaryPassed = new Set(input.pageOrder).size === 8;
  const readingPathPassed = input.pageOrder[0] === "cover"
    && input.pageOrder.indexOf("quick-start") < input.pageOrder.indexOf("featured-activity")
    && input.pageOrder.indexOf("join-us") >= 5;
  const requiredTransfer = new Set<BookLayoutEvidenceRequest["transferChoices"][number]>(["COMMUNITY_ENTRY_FIRST", "VOLUNTEER_CALL_TO_ACTION", "RETAIN_ACTIVITY_CORE"]);
  const audienceTransferPassed = input.audience === "NEW_STUDENTS"
    || Array.from(requiredTransfer).every((choice) => input.transferChoices.includes(choice));
  const criteria = [
    { id: "DIAGNOSTIC" as const, passed: diagnosticPassed, label: "受众与任务诊断", note: diagnosticPassed ? "先判断读者与任务，再进入视觉装饰。" : "至少一项仍以装饰为起点。" },
    { id: "PAGE_BOUNDARY" as const, passed: pageBoundaryPassed, label: "8页边界", note: pageBoundaryPassed ? "八类内容各占一个页面位置。" : "存在重复或缺失页面。" },
    { id: "READING_PATH" as const, passed: readingPathPassed, label: "阅读路径", note: readingPathPassed ? "封面、导读、活动与行动信息形成先后。" : "先把封面放在开头、导读置于活动前，行动页放到后段。" },
    { id: "AUDIENCE_TRANSFER" as const, passed: audienceTransferPassed, label: "受众迁移", note: input.audience === "NEW_STUDENTS" ? "当前证据面向新生。" : audienceTransferPassed ? "已保留活动核心，并改写社区入口与行动召唤。" : "迁移到社区居民时还需确认三项结构变化。" },
  ];
  const score = criteria.filter(({ passed }) => passed).length;
  return { criteria, score, passed: score === 4 };
}

function capabilityProfile(input: BookLayoutEvidenceRequest, evaluation: ReturnType<typeof evaluate>) {
  const diagnosticScore = Math.max(1, Math.min(4, input.diagnosticAnswers.filter((answer) => answer !== "DECORATION_FIRST").length + 1));
  const criterion = (id: (typeof evaluation.criteria)[number]["id"]) => evaluation.criteria.find((item) => item.id === id)?.passed === true;
  const transferScore = input.audience === "NEW_STUDENTS" ? 1 : criterion("AUDIENCE_TRANSFER") ? 4 : 2;
  const dimensions = {
    "content-decomposition": diagnosticScore,
    "hierarchy-modeling": criterion("READING_PATH") ? 4 : 2,
    "layout-design": criterion("PAGE_BOUNDARY") ? 4 : 1,
    "evidence-revision": evaluation.passed ? 3 : 2,
    transfer: transferScore,
  };
  const average = Object.values(dimensions).reduce((sum, value) => sum + value, 0) / Object.keys(dimensions).length;
  const level = average >= 3.5 ? "L4" : average >= 2.5 ? "L3" : average >= 1.5 ? "L2" : "L1";
  return { dimensions, level };
}

function parseStored(row: { id: string; payloadJson: string; createdAt: number; dataType: "REAL" | "DEMONSTRATION_DATA" }) {
  const payload = JSON.parse(row.payloadJson) as Omit<BookLayoutEvidenceResponse, "id" | "createdAt" | "dataType">;
  return BookLayoutEvidenceResponseSchema.parse({
    id: row.id,
    ...payload,
    createdAt: new Date(row.createdAt * 1_000).toISOString(),
    dataType: row.dataType,
  });
}

function parseStoredDraft(row: { id: string; payloadJson: string; createdAt: number; dataType: "REAL" | "DEMONSTRATION_DATA" }) {
  const payload = JSON.parse(row.payloadJson) as BookLayoutDraftRequest;
  return BookLayoutDraftResponseSchema.parse({
    id: row.id,
    ...payload,
    updatedAt: new Date(row.createdAt * 1_000).toISOString(),
    dataType: row.dataType,
  });
}

export function saveBookLayoutDraft(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawInput: BookLayoutDraftRequest,
  now = new Date(),
): BookLayoutDraftResponse {
  studentClass(connection, actor);
  const input = BookLayoutDraftRequestSchema.parse(rawInput);
  const id = randomUUID();
  const timestamp = Math.floor(now.getTime() / 1_000);
  connection.sqlite.prepare(`
    INSERT INTO audit_events(id,user_id,type,payload_json,created_at)
    VALUES(?,?,'BOOK_LAYOUT_DRAFT_SAVED',?,?)
  `).run(id, actor.userId, JSON.stringify(input), timestamp);
  const row = connection.sqlite.prepare(`
    SELECT id, payload_json payloadJson, created_at createdAt, data_type dataType
    FROM audit_events WHERE id=? AND user_id=? AND type='BOOK_LAYOUT_DRAFT_SAVED'
  `).get(id, actor.userId) as { id: string; payloadJson: string; createdAt: number; dataType: "REAL" | "DEMONSTRATION_DATA" };
  return parseStoredDraft(row);
}

export function resetBookLayoutDraft(
  connection: DatabaseConnection,
  actor: SessionPayload,
  now = new Date(),
) {
  studentClass(connection, actor);
  connection.sqlite.prepare(`
    INSERT INTO audit_events(id,user_id,type,payload_json,created_at)
    VALUES(?,?,'BOOK_LAYOUT_DRAFT_RESET',?,?)
  `).run(randomUUID(), actor.userId, JSON.stringify({ reset: true }), Math.floor(now.getTime() / 1_000));
  return { reset: true as const, resume: null, latest: readLatestBookLayoutEvidence(connection, actor) };
}

export function saveBookLayoutEvidence(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawInput: BookLayoutEvidenceRequest,
  now = new Date(),
) {
  const classId = studentClass(connection, actor);
  const input = BookLayoutEvidenceRequestSchema.parse(rawInput);
  const evaluation = evaluate(input);
  const profile = capabilityProfile(input, evaluation);
  const id = randomUUID();
  const timestamp = Math.floor(now.getTime() / 1_000);
  connection.sqlite.transaction(() => {
    connection.sqlite.prepare(`
      INSERT INTO audit_events(id,user_id,type,payload_json,created_at)
      VALUES(?,?,'BOOK_LAYOUT_EVIDENCE_SUBMITTED',?,?)
    `).run(id, actor.userId, JSON.stringify({ ...input, ...evaluation }), timestamp);
    connection.sqlite.prepare(`
      INSERT INTO course_pack_profiles(id,user_id,class_id,course_pack_id,course_pack_version,level,dimensions_json,updated_at)
      VALUES(?,?,?,'book-design','1',?,?,?)
      ON CONFLICT(user_id,course_pack_id,course_pack_version) DO UPDATE SET
        class_id=excluded.class_id,
        level=excluded.level,
        dimensions_json=excluded.dimensions_json,
        updated_at=excluded.updated_at
    `).run(randomUUID(), actor.userId, classId, profile.level, JSON.stringify(profile.dimensions), timestamp);
  })();
  return readBookLayoutEvidenceById(connection, actor, id);
}

function readBookLayoutEvidenceById(connection: DatabaseConnection, actor: SessionPayload, id: string) {
  const row = connection.sqlite.prepare(`
    SELECT id, payload_json payloadJson, created_at createdAt, data_type dataType
    FROM audit_events WHERE id=? AND user_id=? AND type='BOOK_LAYOUT_EVIDENCE_SUBMITTED'
  `).get(id, actor.userId) as { id: string; payloadJson: string; createdAt: number; dataType: "REAL" | "DEMONSTRATION_DATA" } | undefined;
  if (!row) throw new BookLayoutNotFoundError("书籍设计学习证据不存在");
  return parseStored(row);
}

export function readLatestBookLayoutEvidence(
  connection: DatabaseConnection,
  actor: SessionPayload,
): BookLayoutEvidenceResponse | null {
  studentClass(connection, actor);
  const row = connection.sqlite.prepare(`
    SELECT id, payload_json payloadJson, created_at createdAt, data_type dataType
    FROM audit_events WHERE user_id=? AND type='BOOK_LAYOUT_EVIDENCE_SUBMITTED'
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(actor.userId) as { id: string; payloadJson: string; createdAt: number; dataType: "REAL" | "DEMONSTRATION_DATA" } | undefined;
  return row ? parseStored(row) : null;
}

export function readBookLayoutWorkspace(
  connection: DatabaseConnection,
  actor: SessionPayload,
): BookLayoutWorkspaceResponse {
  const latest = readLatestBookLayoutEvidence(connection, actor);
  const row = connection.sqlite.prepare(`
    SELECT id, type, payload_json payloadJson, created_at createdAt, data_type dataType
    FROM audit_events
    WHERE user_id=? AND type IN ('BOOK_LAYOUT_DRAFT_SAVED','BOOK_LAYOUT_DRAFT_RESET','BOOK_LAYOUT_EVIDENCE_SUBMITTED')
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).get(actor.userId) as {
    id: string;
    type: "BOOK_LAYOUT_DRAFT_SAVED" | "BOOK_LAYOUT_DRAFT_RESET" | "BOOK_LAYOUT_EVIDENCE_SUBMITTED";
    payloadJson: string;
    createdAt: number;
    dataType: "REAL" | "DEMONSTRATION_DATA";
  } | undefined;
  const resume = !row || row.type === "BOOK_LAYOUT_DRAFT_RESET"
    ? null
    : row.type === "BOOK_LAYOUT_DRAFT_SAVED"
      ? parseStoredDraft(row)
      : parseStored(row);
  return BookLayoutWorkspaceResponseSchema.parse({ resume, latest });
}
