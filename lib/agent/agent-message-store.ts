import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";

import {
  AgentMessageAppendRequestSchema,
  AgentMessageAppendResponseSchema,
  AgentMessageListResponseSchema,
  AgentMessageRecordSchema,
  AgentMessageStructureSchema,
  AgentMessageToolCallSchema,
  assistantMessageStructure,
  stableToolCallReference,
  userMessageStructure,
  type AgentMessageRecord,
  type AgentMessageStructure,
  type AgentMessageToolCall,
} from "./agent-message-contract";
import { readAgentArtworkAttachment } from "./artwork-attachment-store";
import { AgentTurnRequestSchema, type AgentTurnRequest, type AgentTurnResponse } from "./contracts";
import {
  DesignTaskForbiddenError,
  DesignTaskNotFoundError,
  readDesignTask,
} from "./design-project-task";
import { AgentConflictError } from "./orchestrator-errors";
import type { StudentContext } from "./orchestrator-context";
import type { AgentToolExecution } from "./tool-contract";

type DataType = "REAL" | "DEMONSTRATION_DATA";

type AgentMessageRow = {
  id: string;
  taskId: string;
  studentId: string;
  classId: string;
  role: "user" | "assistant";
  content: string;
  structureJson: string;
  attachmentId: string | null;
  toolCallRefsJson: string;
  turnId: string | null;
  runId: string | null;
  createdAt: number | Date;
  dataType: DataType;
};

type ToolCallRow = {
  callId: string;
  sequence: number;
  toolId: string;
  toolVersion: string;
  adapterId: string;
  inputJson: string;
  outputJson: string | null;
  status: "SUCCESS" | "EMPTY" | "ERROR";
  errorCode: string | null;
  latencyMs: number;
};

export class AgentMessageConflictError extends Error {
  constructor(message = "消息状态已变化，请刷新后重试") {
    super(message);
    this.name = "AgentMessageConflictError";
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

function messageRows(connection: DatabaseConnection, taskId: string) {
  return connection.sqlite.prepare(`
    SELECT m.id, m.task_id taskId, m.student_id studentId, m.class_id classId,
      m.role, m.content, m.structure_json structureJson,
      m.attachment_id attachmentId, m.tool_call_refs_json toolCallRefsJson,
      m.turn_id turnId, t.run_id runId, m.created_at createdAt, m.data_type dataType
    FROM agent_messages m
    LEFT JOIN agent_turns t ON t.id=m.turn_id
    WHERE m.task_id=?
    ORDER BY m.created_at ASC,
      CASE m.role WHEN 'user' THEN 0 ELSE 1 END ASC,
      m.rowid ASC
  `).all(taskId) as AgentMessageRow[];
}

function toolCallsForTurn(
  connection: DatabaseConnection,
  turnId: string | null,
  expectedReferences: readonly string[],
) {
  if (!turnId) return [];
  const rows = connection.sqlite.prepare(`
    SELECT id callId, call_sequence sequence, tool_id toolId, tool_version toolVersion,
      adapter_id adapterId, input_json inputJson, output_json outputJson,
      status, error_code errorCode, latency_ms latencyMs
    FROM agent_tool_calls
    WHERE turn_id=?
    ORDER BY call_sequence ASC
  `).all(turnId) as ToolCallRow[];
  const tools = rows.map((row): AgentMessageToolCall => AgentMessageToolCallSchema.parse({
    id: stableToolCallReference(turnId, row.sequence),
    callId: row.callId,
    sequence: row.sequence,
    toolId: row.toolId,
    toolVersion: row.toolVersion,
    adapterId: row.adapterId,
    input: JSON.parse(row.inputJson),
    output: row.outputJson ? JSON.parse(row.outputJson) : null,
    status: row.status,
    errorCode: row.errorCode,
    latencyMs: row.latencyMs,
  }));
  const actualReferences = tools.map(({ id }) => id);
  if (
    actualReferences.length !== expectedReferences.length
    || actualReferences.some((id, index) => id !== expectedReferences[index])
  ) {
    throw new AgentMessageConflictError("消息中的工具引用与教学事实不一致");
  }
  return tools;
}

function publicMessage(
  connection: DatabaseConnection,
  row: AgentMessageRow,
): AgentMessageRecord {
  const structure = AgentMessageStructureSchema.parse(JSON.parse(row.structureJson));
  const refs = JSON.parse(row.toolCallRefsJson) as unknown;
  if (!Array.isArray(refs) || refs.some((value) => typeof value !== "string")) {
    throw new AgentMessageConflictError("消息中的工具引用格式无效");
  }
  return AgentMessageRecordSchema.parse({
    id: row.id,
    taskId: row.taskId,
    role: row.role,
    content: row.content,
    structure,
    attachment: row.attachmentId && row.turnId
      ? readAgentArtworkAttachment(connection, row.turnId) ?? null
      : null,
    toolCalls: row.role === "assistant"
      ? toolCallsForTurn(connection, row.turnId, refs)
      : [],
    turnId: row.turnId,
    runId: row.runId,
    createdAt: isoDate(row.createdAt),
  });
}

function pendingRun(
  connection: DatabaseConnection,
  taskId: string,
  studentId: string,
  rows: readonly AgentMessageRow[],
) {
  const run = connection.sqlite.prepare(`
    SELECT id runId, status, request_json requestJson
    FROM agent_runs
    WHERE task_id=? AND student_id=?
      AND status IN ('QUEUED','RUNNING','WAITING_APPROVAL','FAILED','CANCELLED')
    ORDER BY updated_at DESC, rowid DESC
    LIMIT 1
  `).get(taskId, studentId) as {
    runId: string;
    status: "QUEUED" | "RUNNING" | "WAITING_APPROVAL" | "FAILED" | "CANCELLED";
    requestJson: string;
  } | undefined;
  if (!run) return null;

  let requestJson = run.requestJson;
  let userMessageId: string | undefined;
  for (let depth = 0; depth < 4; depth += 1) {
    let request: AgentTurnRequest;
    try {
      request = AgentTurnRequestSchema.parse(JSON.parse(requestJson));
    } catch {
      return null;
    }
    if (request.clientMessageId) {
      userMessageId = request.clientMessageId;
      break;
    }
    if (!request.continuation) return null;
    const source = connection.sqlite.prepare(`
      SELECT request_json requestJson
      FROM agent_runs WHERE id=? AND task_id=? AND student_id=?
    `).get(request.continuation.sourceRunId, taskId, studentId) as { requestJson: string } | undefined;
    if (!source) return null;
    requestJson = source.requestJson;
  }
  if (!userMessageId || !rows.some((row) => row.role === "user" && row.id === userMessageId)) {
    return null;
  }

  return { userMessageId, runId: run.runId, status: run.status };
}

function listOwnedAgentMessages(
  connection: DatabaseConnection,
  owner: { taskId: string; studentId: string },
) {
  const rows = messageRows(connection, owner.taskId);
  return AgentMessageListResponseSchema.parse({
    taskId: owner.taskId,
    messages: rows.map((row) => publicMessage(connection, row)),
    pendingRun: pendingRun(connection, owner.taskId, owner.studentId, rows),
  });
}

export function listStudentAgentMessages(
  connection: DatabaseConnection,
  actor: SessionPayload,
  taskId: string,
) {
  const { task, student } = readDesignTask(connection, actor, taskId);
  return listOwnedAgentMessages(connection, {
    taskId: task.id,
    studentId: student.studentId,
  });
}

export function listTeacherAgentMessages(
  connection: DatabaseConnection,
  actor: SessionPayload,
  taskId: string,
) {
  if (actor.role !== "TEACHER") throw new DesignTaskForbiddenError();
  const owner = connection.sqlite.prepare(`
    SELECT id taskId, student_id studentId
    FROM design_project_tasks
    WHERE id=?
  `).get(taskId) as { taskId: string; studentId: string } | undefined;
  if (!owner) throw new DesignTaskNotFoundError();
  return listOwnedAgentMessages(connection, owner);
}

export function appendStudentAgentMessage(input: {
  connection: DatabaseConnection;
  actor: SessionPayload;
  taskId: string;
  message: unknown;
  now?: Date;
}) {
  const message = AgentMessageAppendRequestSchema.parse(input.message);
  const { task, student } = readDesignTask(input.connection, input.actor, input.taskId);
  if (task.status === "ARCHIVED") throw new AgentMessageConflictError("任务已归档，请恢复后继续对话");
  const existing = input.connection.sqlite.prepare(`
    SELECT m.id, m.task_id taskId, m.student_id studentId, m.class_id classId,
      m.role, m.content, m.structure_json structureJson,
      m.attachment_id attachmentId, m.tool_call_refs_json toolCallRefsJson,
      m.turn_id turnId, t.run_id runId, m.created_at createdAt, m.data_type dataType
    FROM agent_messages m
    LEFT JOIN agent_turns t ON t.id=m.turn_id
    WHERE m.id=?
  `).get(message.id) as AgentMessageRow | undefined;
  if (existing) {
    const expectedStructure = userMessageStructure(message.capability);
    if (
      existing.taskId !== task.id
      || existing.studentId !== student.studentId
      || existing.role !== "user"
      || existing.content !== message.content
      || existing.structureJson !== JSON.stringify(expectedStructure)
    ) {
      throw new AgentMessageConflictError("消息 ID 已被其他内容使用");
    }
    return AgentMessageAppendResponseSchema.parse({
      message: publicMessage(input.connection, existing),
      created: false,
    });
  }
  const now = input.now ?? new Date();
  input.connection.sqlite.transaction(() => {
    input.connection.sqlite.prepare(`
      INSERT INTO agent_messages(
        id,task_id,student_id,class_id,role,content,structure_json,
        attachment_id,tool_call_refs_json,turn_id,created_at,data_type
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      message.id,
      task.id,
      student.studentId,
      student.classId,
      "user",
      message.content,
      JSON.stringify(userMessageStructure(message.capability)),
      null,
      "[]",
      null,
      epochSeconds(now),
      student.dataType,
    );
    input.connection.sqlite.prepare(
      "UPDATE design_project_tasks SET updated_at=? WHERE id=?",
    ).run(epochSeconds(now), task.id);
  }).immediate();
  const created = messageRows(input.connection, task.id)
    .find((row) => row.id === message.id);
  if (!created) throw new AgentMessageConflictError("消息写入失败");
  return AgentMessageAppendResponseSchema.parse({
    message: publicMessage(input.connection, created),
    created: true,
  });
}

export function persistAssistantAgentMessage(input: {
  connection: DatabaseConnection;
  context: StudentContext;
  request: AgentTurnRequest;
  response: Pick<
    AgentTurnResponse,
    "reply" | "episode" | "decisionCode" | "aiMode" | "routingReceipt" | "specialty" | "executionSteps"
  > & { toolExecutions: readonly AgentToolExecution[]; artwork?: { id: string } };
  turnId: string;
  createdAt: Date;
}) {
  const structure = assistantMessageStructure({
    reply: input.response.reply,
    episode: input.response.episode,
    decisionCode: input.response.decisionCode,
    aiMode: input.response.aiMode,
    routingReceipt: input.response.routingReceipt,
    specialty: input.response.specialty,
    continuationOfRunId: input.request.continuation?.sourceRunId,
    executionSteps: [...input.response.executionSteps],
  });
  const toolReferences = input.response.toolExecutions.map((_, index) =>
    stableToolCallReference(input.turnId, index + 1));
  if (input.request.clientMessageId) {
    const result = input.connection.sqlite.prepare(`
      UPDATE agent_messages
      SET turn_id=?, attachment_id=?
      WHERE id=? AND task_id=? AND student_id=? AND class_id=?
        AND role='user' AND content=? AND turn_id IS NULL
    `).run(
      input.turnId,
      input.response.artwork?.id ?? null,
      input.request.clientMessageId,
      input.context.taskId,
      input.context.studentId,
      input.context.classId,
      input.request.message,
    );
    if (result.changes !== 1) {
      throw new AgentConflictError("学生消息尚未完成持久化，回合未写入");
    }
  }
  input.connection.sqlite.prepare(`
    INSERT INTO agent_messages(
      id,task_id,student_id,class_id,role,content,structure_json,
      attachment_id,tool_call_refs_json,turn_id,created_at,data_type
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    `${input.turnId}#a`,
    input.context.taskId,
    input.context.studentId,
    input.context.classId,
    "assistant",
    input.response.reply.message,
    JSON.stringify(structure),
    null,
    JSON.stringify(toolReferences),
    input.turnId,
    epochSeconds(input.createdAt),
    input.context.dataType,
  );
}

type BackfillTurnRow = {
  turnId: string;
  taskId: string;
  studentId: string;
  classId: string;
  studentMessage: string;
  episode: AgentTurnResponse["episode"];
  decisionCode: string;
  aiMode: AgentTurnResponse["aiMode"];
  replyJson: string;
  createdAt: number | Date;
  dataType: DataType;
};

function backfillStructure(
  connection: DatabaseConnection,
  turn: BackfillTurnRow,
): AgentMessageStructure {
  const executionSteps = connection.sqlite.prepare(`
    SELECT id, step_sequence sequence, kind, status, label, summary,
      tool_call_id toolCallId, tool_id toolId, latency_ms latencyMs
    FROM agent_steps WHERE turn_id=? ORDER BY step_sequence
  `).all(turn.turnId);
  return assistantMessageStructure({
    reply: JSON.parse(turn.replyJson),
    episode: turn.episode,
    decisionCode: turn.decisionCode,
    aiMode: turn.aiMode,
    executionSteps: executionSteps as AgentTurnResponse["executionSteps"],
  });
}

export function backfillAgentMessages(connection: DatabaseConnection) {
  const turns = connection.sqlite.prepare(`
    SELECT t.id turnId, c.task_id taskId, c.student_id studentId, c.class_id classId,
      t.student_message studentMessage, t.episode, t.decision_code decisionCode,
      t.ai_mode aiMode, t.reply_json replyJson, t.created_at createdAt, t.data_type dataType
    FROM agent_turns t
    JOIN agent_conversations c ON c.id=t.conversation_id
    ORDER BY t.created_at ASC, t.rowid ASC
  `).all() as BackfillTurnRow[];
  let inserted = 0;
  connection.sqlite.transaction(() => {
    const statement = connection.sqlite.prepare(`
      INSERT OR IGNORE INTO agent_messages(
        id,task_id,student_id,class_id,role,content,structure_json,
        attachment_id,tool_call_refs_json,turn_id,created_at,data_type
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const turn of turns) {
      const attachment = connection.sqlite.prepare(
        "SELECT id FROM agent_artwork_attachments WHERE turn_id=?",
      ).get(turn.turnId) as { id: string } | undefined;
      const refs = (connection.sqlite.prepare(`
        SELECT call_sequence sequence FROM agent_tool_calls
        WHERE turn_id=? ORDER BY call_sequence
      `).all(turn.turnId) as Array<{ sequence: number }>).map(({ sequence }) =>
        stableToolCallReference(turn.turnId, sequence));
      const structure = backfillStructure(connection, turn);
      inserted += statement.run(
        `${turn.turnId}#u`, turn.taskId, turn.studentId, turn.classId, "user",
        turn.studentMessage, JSON.stringify(userMessageStructure()), attachment?.id ?? null,
        "[]", turn.turnId, turn.createdAt, turn.dataType,
      ).changes;
      inserted += statement.run(
        `${turn.turnId}#a`, turn.taskId, turn.studentId, turn.classId, "assistant",
        structure.kind === "assistant" ? structure.reply.message : "",
        JSON.stringify(structure), null, JSON.stringify(refs),
        turn.turnId, turn.createdAt, turn.dataType,
      ).changes;
    }
  }).immediate();
  return { scannedTurns: turns.length, insertedMessages: inserted };
}
