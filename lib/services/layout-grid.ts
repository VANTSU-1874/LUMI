import { randomUUID } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  LayoutGridDraftRequestSchema,
  LayoutGridDraftResponseSchema,
  LayoutGridEvidenceRequestSchema,
  LayoutGridEvidenceResponseSchema,
  LayoutGridWorkspaceResponseSchema,
  type LayoutBlock,
  type LayoutGridDraftRequest,
  type LayoutGridDraftResponse,
  type LayoutGridEvidenceRequest,
  type LayoutGridEvidenceResponse,
  type LayoutGridWorkspaceResponse,
} from "@/lib/domain/layout-grid";

export class LayoutGridForbiddenError extends Error {}
export class LayoutGridNotFoundError extends Error {}

/** 主标题相对正文至少要拉开的字号倍率。低于它，远看就分不出主次。 */
const TITLE_BODY_RATIO = 1.3;
/** 版心在任一方向上至少要占到页面的一半，否则边距已经吃掉版面。 */
const MIN_CONTENT_RATIO = 0.5;

function studentClass(connection: DatabaseConnection, actor: SessionPayload) {
  if (actor.role !== "STUDENT") throw new LayoutGridForbiddenError("仅学生可以提交排版栅格学习证据");
  const row = connection.sqlite.prepare(
    "SELECT class_id classId FROM users WHERE id=? AND role='STUDENT'",
  ).get(actor.userId) as { classId: string | null } | undefined;
  if (!row?.classId) throw new LayoutGridNotFoundError("学生身份不存在");
  return row.classId;
}

/** 阅读顺序：先上后下，同一行再从左到右。与中文横排的实际阅读路径一致。 */
function readingOrder(blocks: readonly LayoutBlock[]) {
  return [...blocks].sort((left, right) =>
    left.rowStart - right.rowStart || left.colStart - right.colStart || left.id.localeCompare(right.id));
}

function maxScale(blocks: readonly LayoutBlock[], role: LayoutBlock["role"]) {
  const scales = blocks.filter((block) => block.role === role).map(({ fontScale }) => fontScale);
  return scales.length > 0 ? Math.max(...scales) : null;
}

/**
 * 四条判据全部由几何与数值直接判定，不经过模型。
 * 判定结果既是学生看到的验证反馈，也是导师会诊时引用的可观察证据。
 */
export function evaluateLayoutGrid(input: LayoutGridEvidenceRequest) {
  const { config, blocks } = input;

  const outOfBounds = blocks.filter((block) =>
    block.colStart + block.colSpan - 1 > config.columns
    || block.rowStart + block.rowSpan - 1 > config.rows);
  const gridPassed = outOfBounds.length === 0;

  const titleScale = maxScale(blocks, "TITLE");
  const bodyScale = maxScale(blocks, "BODY");
  const hierarchyPassed = titleScale !== null
    && bodyScale !== null
    && titleScale / bodyScale >= TITLE_BODY_RATIO;

  const ordered = readingOrder(blocks);
  const firstBodyIndex = ordered.findIndex(({ role }) => role === "BODY");
  const firstCaptionIndex = ordered.findIndex(({ role }) => role === "CAPTION");
  const captionBeforeBody = firstCaptionIndex !== -1
    && firstBodyIndex !== -1
    && firstCaptionIndex < firstBodyIndex;
  const readingPassed = ordered[0]?.role === "TITLE" && !captionBeforeBody;

  const contentWidth = config.pageWidthMm - config.marginLeftMm - config.marginRightMm;
  const contentHeight = config.pageHeightMm - config.marginTopMm - config.marginBottomMm;
  const marginPassed = config.marginTopMm > 0
    && config.marginRightMm > 0
    && config.marginBottomMm > 0
    && config.marginLeftMm > 0
    && contentWidth >= config.pageWidthMm * MIN_CONTENT_RATIO
    && contentHeight >= config.pageHeightMm * MIN_CONTENT_RATIO;

  const criteria = [
    {
      id: "GRID_ADHERENCE" as const,
      passed: gridPassed,
      label: "栅格归位",
      note: gridPassed
        ? "所有文字块都落在栏行范围内。"
        : `有 ${outOfBounds.length} 块越出栅格：${outOfBounds.map(({ id }) => id).join("、")}。`,
    },
    {
      id: "HIERARCHY_DISTINCT" as const,
      passed: hierarchyPassed,
      label: "层级可分",
      note: titleScale === null || bodyScale === null
        ? "缺少主标题或正文，主次无从比较。"
        : hierarchyPassed
          ? `主标题是正文的 ${(titleScale / bodyScale).toFixed(2)} 倍，远看能分出先后。`
          : `主标题只有正文的 ${(titleScale / bodyScale).toFixed(2)} 倍，缩小后对比会被抹平。`,
    },
    {
      id: "READING_PATH" as const,
      passed: readingPassed,
      label: "阅读动线",
      note: readingPassed
        ? "先读到主标题，说明性文字排在正文之后。"
        : ordered[0]?.role !== "TITLE"
          ? `按先上后下的顺序，最先读到的是${ordered[0]?.role ?? "空"}而不是主标题。`
          : "说明性文字出现在正文之前，动线被打断。",
    },
    {
      id: "MARGIN_INTEGRITY" as const,
      passed: marginPassed,
      label: "版心完整",
      note: marginPassed
        ? `版心 ${contentWidth.toFixed(0)}×${contentHeight.toFixed(0)}mm，四边留白都成立。`
        : "边距为零或版心不足页面一半，内容会顶到页边。",
    },
  ];

  const score = criteria.filter(({ passed }) => passed).length;
  return { criteria, score, passed: score === 4 };
}

function capabilityProfile(evaluation: ReturnType<typeof evaluateLayoutGrid>) {
  const criterion = (id: (typeof evaluation.criteria)[number]["id"]) =>
    evaluation.criteria.find((item) => item.id === id)?.passed === true;
  const dimensions = {
    "reading-task": criterion("READING_PATH") ? 4 : 2,
    "grid-structure": criterion("GRID_ADHERENCE") ? 4 : 1,
    "hierarchy-modeling": criterion("HIERARCHY_DISTINCT") ? 4 : 2,
    "whitespace-rhythm": criterion("MARGIN_INTEGRITY") ? 4 : 2,
    transfer: evaluation.passed ? 3 : 1,
  };
  const average = Object.values(dimensions).reduce((sum, value) => sum + value, 0) / Object.keys(dimensions).length;
  const level = average >= 3.5 ? "L4" : average >= 2.5 ? "L3" : average >= 1.5 ? "L2" : "L1";
  return { dimensions, level };
}

type StoredRow = { id: string; payloadJson: string; createdAt: number; dataType: "REAL" | "DEMONSTRATION_DATA" };

function parseStored(row: StoredRow) {
  const payload = JSON.parse(row.payloadJson) as Omit<LayoutGridEvidenceResponse, "id" | "createdAt" | "dataType">;
  return LayoutGridEvidenceResponseSchema.parse({
    id: row.id,
    ...payload,
    createdAt: new Date(row.createdAt * 1_000).toISOString(),
    dataType: row.dataType,
  });
}

function parseStoredDraft(row: StoredRow) {
  const payload = JSON.parse(row.payloadJson) as LayoutGridDraftRequest;
  return LayoutGridDraftResponseSchema.parse({
    id: row.id,
    ...payload,
    updatedAt: new Date(row.createdAt * 1_000).toISOString(),
    dataType: row.dataType,
  });
}

export function saveLayoutGridDraft(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawInput: LayoutGridDraftRequest,
  now = new Date(),
): LayoutGridDraftResponse {
  studentClass(connection, actor);
  const input = LayoutGridDraftRequestSchema.parse(rawInput);
  const id = randomUUID();
  connection.sqlite.prepare(`
    INSERT INTO audit_events(id,user_id,type,payload_json,created_at)
    VALUES(?,?,'LAYOUT_GRID_DRAFT_SAVED',?,?)
  `).run(id, actor.userId, JSON.stringify(input), Math.floor(now.getTime() / 1_000));
  const row = connection.sqlite.prepare(`
    SELECT id, payload_json payloadJson, created_at createdAt, data_type dataType
    FROM audit_events WHERE id=? AND user_id=? AND type='LAYOUT_GRID_DRAFT_SAVED'
  `).get(id, actor.userId) as StoredRow;
  return parseStoredDraft(row);
}

export function resetLayoutGridDraft(
  connection: DatabaseConnection,
  actor: SessionPayload,
  now = new Date(),
) {
  studentClass(connection, actor);
  connection.sqlite.prepare(`
    INSERT INTO audit_events(id,user_id,type,payload_json,created_at)
    VALUES(?,?,'LAYOUT_GRID_DRAFT_RESET',?,?)
  `).run(randomUUID(), actor.userId, JSON.stringify({ reset: true }), Math.floor(now.getTime() / 1_000));
  return { reset: true as const, resume: null, latest: readLatestLayoutGridEvidence(connection, actor) };
}

export function saveLayoutGridEvidence(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawInput: LayoutGridEvidenceRequest,
  now = new Date(),
) {
  const classId = studentClass(connection, actor);
  const input = LayoutGridEvidenceRequestSchema.parse(rawInput);
  const evaluation = evaluateLayoutGrid(input);
  const profile = capabilityProfile(evaluation);
  const id = randomUUID();
  const timestamp = Math.floor(now.getTime() / 1_000);
  connection.sqlite.transaction(() => {
    connection.sqlite.prepare(`
      INSERT INTO audit_events(id,user_id,type,payload_json,created_at)
      VALUES(?,?,'LAYOUT_GRID_EVIDENCE_SUBMITTED',?,?)
    `).run(id, actor.userId, JSON.stringify({ ...input, ...evaluation }), timestamp);
    connection.sqlite.prepare(`
      INSERT INTO course_pack_profiles(id,user_id,class_id,course_pack_id,course_pack_version,level,dimensions_json,updated_at)
      VALUES(?,?,?,'layout-design','1',?,?,?)
      ON CONFLICT(user_id,course_pack_id,course_pack_version) DO UPDATE SET
        class_id=excluded.class_id,
        level=excluded.level,
        dimensions_json=excluded.dimensions_json,
        updated_at=excluded.updated_at
    `).run(randomUUID(), actor.userId, classId, profile.level, JSON.stringify(profile.dimensions), timestamp);
  })();
  return readLayoutGridEvidenceById(connection, actor, id);
}

function readLayoutGridEvidenceById(connection: DatabaseConnection, actor: SessionPayload, id: string) {
  const row = connection.sqlite.prepare(`
    SELECT id, payload_json payloadJson, created_at createdAt, data_type dataType
    FROM audit_events WHERE id=? AND user_id=? AND type='LAYOUT_GRID_EVIDENCE_SUBMITTED'
  `).get(id, actor.userId) as StoredRow | undefined;
  if (!row) throw new LayoutGridNotFoundError("排版栅格学习证据不存在");
  return parseStored(row);
}

export function readLatestLayoutGridEvidence(
  connection: DatabaseConnection,
  actor: SessionPayload,
): LayoutGridEvidenceResponse | null {
  studentClass(connection, actor);
  const row = connection.sqlite.prepare(`
    SELECT id, payload_json payloadJson, created_at createdAt, data_type dataType
    FROM audit_events WHERE user_id=? AND type='LAYOUT_GRID_EVIDENCE_SUBMITTED'
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(actor.userId) as StoredRow | undefined;
  return row ? parseStored(row) : null;
}

export function readLayoutGridWorkspace(
  connection: DatabaseConnection,
  actor: SessionPayload,
): LayoutGridWorkspaceResponse {
  const latest = readLatestLayoutGridEvidence(connection, actor);
  const row = connection.sqlite.prepare(`
    SELECT id, type, payload_json payloadJson, created_at createdAt, data_type dataType
    FROM audit_events
    WHERE user_id=? AND type IN ('LAYOUT_GRID_DRAFT_SAVED','LAYOUT_GRID_DRAFT_RESET','LAYOUT_GRID_EVIDENCE_SUBMITTED')
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).get(actor.userId) as (StoredRow & {
    type: "LAYOUT_GRID_DRAFT_SAVED" | "LAYOUT_GRID_DRAFT_RESET" | "LAYOUT_GRID_EVIDENCE_SUBMITTED";
  }) | undefined;
  const resume = !row || row.type === "LAYOUT_GRID_DRAFT_RESET"
    ? null
    : row.type === "LAYOUT_GRID_DRAFT_SAVED"
      ? parseStoredDraft(row)
      : parseStored(row);
  return LayoutGridWorkspaceResponseSchema.parse({ resume, latest });
}
