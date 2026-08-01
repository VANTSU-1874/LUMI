import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";

import {
  CritiqueResultSchema,
  type CritiqueResult,
} from "./critique-contract";
import type { StudentContext } from "./orchestrator-context";

type CritiqueRow = {
  id: string;
  turnId: string;
  courseId: string;
  artworkId: string;
  frameworkId: string;
  frameworkVersion: string;
  dimensionsJson: string;
  closureJson: string;
  createdAt: number | Date;
};

export class AgentCritiqueNotFoundError extends Error {
  constructor() {
    super("会诊记录不存在");
    this.name = "AgentCritiqueNotFoundError";
  }
}

function epochSeconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

function isoDate(value: number | Date) {
  const date = value instanceof Date
    ? value
    : new Date(value < 10_000_000_000 ? value * 1_000 : value);
  return date.toISOString();
}

function parseCritiqueRow(row: CritiqueRow): CritiqueResult {
  return CritiqueResultSchema.parse({
    id: row.id,
    frameworkId: row.frameworkId,
    frameworkVersion: row.frameworkVersion,
    courseId: row.courseId,
    artworkId: row.artworkId,
    createdAt: isoDate(row.createdAt),
    dimensions: JSON.parse(row.dimensionsJson) as unknown,
    closure: JSON.parse(row.closureJson) as unknown,
  });
}

const CRITIQUE_COLUMNS = `
  id, turn_id turnId, course_id courseId, artwork_id artworkId,
  framework_id frameworkId, framework_version frameworkVersion,
  dimensions_json dimensionsJson, closure_json closureJson, created_at createdAt
`;

export function readAgentCritique(
  connection: DatabaseConnection,
  turnId: string,
) {
  const row = connection.sqlite.prepare(`
    SELECT ${CRITIQUE_COLUMNS}
    FROM agent_critiques WHERE turn_id=?
  `).get(turnId) as CritiqueRow | undefined;
  return row ? parseCritiqueRow(row) : undefined;
}

export function readLatestAgentCritique(input: {
  connection: DatabaseConnection;
  studentId: string;
  classId: string;
  courseId: string;
  dataType: "REAL" | "DEMONSTRATION_DATA";
}) {
  const row = input.connection.sqlite.prepare(`
    SELECT ${CRITIQUE_COLUMNS}
    FROM agent_critiques
    WHERE student_id=? AND class_id=? AND course_id=? AND data_type=?
    ORDER BY created_at DESC, rowid DESC LIMIT 1
  `).get(
    input.studentId,
    input.classId,
    input.courseId,
    input.dataType,
  ) as CritiqueRow | undefined;
  return row ? parseCritiqueRow(row) : undefined;
}

function verifiedHistoryRecord(input: {
  connection: DatabaseConnection;
  recordId?: string;
  context: StudentContext;
  courseId: string;
  before: Date;
}) {
  if (!input.recordId) return undefined;
  const row = input.connection.sqlite.prepare(`
    SELECT ${CRITIQUE_COLUMNS}
    FROM agent_critiques
    WHERE id=? AND student_id=? AND class_id=? AND course_id=? AND data_type=?
      AND created_at<=?
    LIMIT 1
  `).get(
    input.recordId,
    input.context.studentId,
    input.context.classId,
    input.courseId,
    input.context.dataType,
    epochSeconds(input.before),
  ) as CritiqueRow | undefined;
  return row ? parseCritiqueRow(row) : undefined;
}

export function insertAgentCritique(input: {
  connection: DatabaseConnection;
  context: StudentContext;
  turnId: string;
  critique: CritiqueResult;
  historyComparison?: string;
  historyRecordId?: string;
  createdAt: Date;
}) {
  const critique = CritiqueResultSchema.parse(input.critique);
  const artwork = input.connection.sqlite.prepare(`
    SELECT id, turn_id turnId, student_id studentId, class_id classId, data_type dataType
    FROM agent_artwork_attachments WHERE id=? AND turn_id=?
  `).get(critique.artworkId, input.turnId) as {
    id: string;
    turnId: string;
    studentId: string;
    classId: string;
    dataType: "REAL" | "DEMONSTRATION_DATA";
  } | undefined;
  if (
    !artwork
    || artwork.studentId !== input.context.studentId
    || artwork.classId !== input.context.classId
    || artwork.dataType !== input.context.dataType
  ) throw new Error("CRITIQUE_ARTWORK_OWNER_MISMATCH");

  const history = input.historyComparison
    ? verifiedHistoryRecord({
        connection: input.connection,
        recordId: input.historyRecordId,
        context: input.context,
        courseId: critique.courseId,
        before: input.createdAt,
      })
    : undefined;
  const closure = {
    established: critique.closure.established,
    nextStep: critique.closure.nextStep,
    ...(history && input.historyComparison ? {
      historyReference: {
        recordId: history.id,
        label: `上一版会诊 · ${history.createdAt.slice(0, 10)}`,
        comparison: input.historyComparison,
      },
    } : {}),
  };
  const stored = CritiqueResultSchema.parse({ ...critique, closure });
  input.connection.sqlite.prepare(`
    INSERT INTO agent_critiques(
      id,turn_id,student_id,class_id,course_id,artwork_id,framework_id,
      framework_version,dimensions_json,closure_json,created_at,data_type
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    stored.id,
    input.turnId,
    input.context.studentId,
    input.context.classId,
    stored.courseId,
    stored.artworkId,
    stored.frameworkId,
    stored.frameworkVersion,
    JSON.stringify(stored.dimensions),
    JSON.stringify(stored.closure),
    epochSeconds(input.createdAt),
    input.context.dataType,
  );
  return readAgentCritique(input.connection, input.turnId) ?? stored;
}

export function readOwnedAgentCritique(
  connection: DatabaseConnection,
  actor: SessionPayload,
  turnId: string,
) {
  if (actor.role !== "STUDENT") throw new AgentCritiqueNotFoundError();
  const row = connection.sqlite.prepare(`
    SELECT ${CRITIQUE_COLUMNS}
    FROM agent_critiques
    WHERE turn_id=? AND student_id=?
    LIMIT 1
  `).get(turnId, actor.userId) as CritiqueRow | undefined;
  if (!row) throw new AgentCritiqueNotFoundError();
  return parseCritiqueRow(row);
}
