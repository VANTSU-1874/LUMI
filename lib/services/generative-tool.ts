import { randomUUID } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  GenerativeArtifactSchema,
  GenerativeBuildCommandSchema,
  GenerativeBuildRequestResponseSchema,
  GenerativeBuildRequestSchema,
  GenerativeResetResponseSchema,
  GenerativeWorkspaceResponseSchema,
  type GenerativeArtifact,
  type GenerativeBuildCommand,
  type GenerativeBuildRequest,
  type GenerativeBuildRequestResponse,
  type GenerativeWorkspaceResponse,
} from "@/lib/domain/generative-tool";
import { hardenGenerativeArtifact } from "@/lib/agent/skills/generative-html-guard";

export class GenerativeToolForbiddenError extends Error {}
export class GenerativeToolNotFoundError extends Error {}
export class GenerativeBuildConflictError extends Error {}
export class GenerativeModelUnavailableError extends Error {}

export type GenerativeHtmlGenerator = (input: GenerativeBuildRequest) => Promise<string>;

const EVENT_TYPES = {
  request: "GENERATIVE_BUILD_REQUESTED",
  artifact: "GENERATIVE_ARTIFACT_STORED",
  reset: "GENERATIVE_WORKSPACE_RESET",
} as const;

type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
type StoredEventRow = {
  id: string;
  type: EventType;
  payloadJson: string;
  createdAt: number;
  dataType: "REAL" | "DEMONSTRATION_DATA";
};

function requireStudent(connection: DatabaseConnection, actor: SessionPayload) {
  if (actor.role !== "STUDENT") {
    throw new GenerativeToolForbiddenError("仅学生可以使用现场生成实验台");
  }
  const row = connection.sqlite.prepare(
    "SELECT class_id classId FROM users WHERE id=? AND role='STUDENT'",
  ).get(actor.userId) as { classId: string | null } | undefined;
  if (!row?.classId) throw new GenerativeToolNotFoundError("学生身份不存在");
}

function timestamp(now: Date) {
  return Math.floor(now.getTime() / 1_000);
}

function readLatestEvent(connection: DatabaseConnection, studentId: string) {
  return connection.sqlite.prepare(`
    SELECT id,type,payload_json payloadJson,created_at createdAt,data_type dataType
    FROM audit_events
    WHERE user_id=? AND type IN (?,?,?)
    ORDER BY created_at DESC,rowid DESC LIMIT 1
  `).get(
    studentId,
    EVENT_TYPES.request,
    EVENT_TYPES.artifact,
    EVENT_TYPES.reset,
  ) as StoredEventRow | undefined;
}

function readRequestRow(connection: DatabaseConnection, studentId: string, requestId: string) {
  const row = connection.sqlite.prepare(`
    SELECT id,type,payload_json payloadJson,created_at createdAt,data_type dataType
    FROM audit_events
    WHERE id=? AND user_id=? AND type=?
  `).get(requestId, studentId, EVENT_TYPES.request) as StoredEventRow | undefined;
  if (!row) throw new GenerativeToolNotFoundError("生成请求不存在");
  return row;
}

function parseRequest(row: StoredEventRow): GenerativeBuildRequestResponse {
  const input = GenerativeBuildRequestSchema.parse(JSON.parse(row.payloadJson));
  return GenerativeBuildRequestResponseSchema.parse({
    id: row.id,
    ...input,
    status: "REQUESTED",
    createdAt: new Date(row.createdAt * 1_000).toISOString(),
    dataType: row.dataType,
  });
}

function parseArtifact(row: StoredEventRow): GenerativeArtifact {
  const payload = JSON.parse(row.payloadJson) as Omit<GenerativeArtifact, "id" | "createdAt" | "dataType">;
  return GenerativeArtifactSchema.parse({
    id: row.id,
    ...payload,
    createdAt: new Date(row.createdAt * 1_000).toISOString(),
    dataType: row.dataType,
  });
}

function emptyWorkspace(): GenerativeWorkspaceResponse {
  return GenerativeWorkspaceResponseSchema.parse({
    status: "EMPTY",
    request: null,
    artifact: null,
  });
}

export function requestGenerativeBuild(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawInput: GenerativeBuildRequest,
  now = new Date(),
) {
  requireStudent(connection, actor);
  const input = GenerativeBuildRequestSchema.parse(rawInput);
  const id = randomUUID();
  connection.sqlite.prepare(`
    INSERT INTO audit_events(id,user_id,type,payload_json,created_at)
    VALUES(?,?,?,?,?)
  `).run(id, actor.userId, EVENT_TYPES.request, JSON.stringify(input), timestamp(now));
  return parseRequest(readRequestRow(connection, actor.userId, id));
}

export function readGenerativeWorkspace(
  connection: DatabaseConnection,
  actor: SessionPayload,
): GenerativeWorkspaceResponse {
  requireStudent(connection, actor);
  const latest = readLatestEvent(connection, actor.userId);
  if (!latest || latest.type === EVENT_TYPES.reset) return emptyWorkspace();
  if (latest.type === EVENT_TYPES.request) {
    return GenerativeWorkspaceResponseSchema.parse({
      status: "REQUESTED",
      request: parseRequest(latest),
      artifact: null,
    });
  }
  const artifact = parseArtifact(latest);
  const request = parseRequest(readRequestRow(connection, actor.userId, artifact.requestId));
  return GenerativeWorkspaceResponseSchema.parse({
    status: "READY",
    request,
    artifact,
  });
}

function resolveRequestForBuild(
  connection: DatabaseConnection,
  actor: SessionPayload,
  command: GenerativeBuildCommand,
  now: Date,
) {
  if (!command.requestId) return requestGenerativeBuild(connection, actor, command, now);
  const workspace = readGenerativeWorkspace(connection, actor);
  if (workspace.status === "READY" && workspace.request?.id === command.requestId) {
    return workspace.request;
  }
  if (workspace.status !== "REQUESTED" || workspace.request?.id !== command.requestId) {
    throw new GenerativeBuildConflictError("生成请求已被更新或重置，请恢复最新工作区");
  }
  if (workspace.request.kind !== command.kind || workspace.request.brief !== command.brief) {
    throw new GenerativeBuildConflictError("生成请求内容与已确认内容不一致");
  }
  return workspace.request;
}

export async function buildGenerativeArtifact(
  connection: DatabaseConnection,
  actor: SessionPayload,
  rawCommand: GenerativeBuildCommand,
  generateHtml: GenerativeHtmlGenerator,
  now = new Date(),
): Promise<GenerativeArtifact> {
  requireStudent(connection, actor);
  const command = GenerativeBuildCommandSchema.parse(rawCommand);
  const before = readGenerativeWorkspace(connection, actor);
  if (
    command.requestId
    && before.status === "READY"
    && before.request?.id === command.requestId
    && before.artifact
  ) {
    if (before.request.kind !== command.kind || before.request.brief !== command.brief) {
      throw new GenerativeBuildConflictError("生成请求内容与已完成产物不一致");
    }
    return before.artifact;
  }
  const request = resolveRequestForBuild(connection, actor, command, now);
  const rawHtml = await generateHtml({ kind: request.kind, brief: request.brief });
  const html = hardenGenerativeArtifact(rawHtml);

  return connection.sqlite.transaction(() => {
    const latest = readLatestEvent(connection, actor.userId);
    if (latest?.type === EVENT_TYPES.artifact) {
      const existing = parseArtifact(latest);
      if (existing.requestId === request.id) return existing;
    }
    if (!latest || latest.type !== EVENT_TYPES.request || latest.id !== request.id) {
      throw new GenerativeBuildConflictError("生成期间工作区已变化，旧产物未入库");
    }
    const id = randomUUID();
    connection.sqlite.prepare(`
      INSERT INTO audit_events(id,user_id,type,payload_json,created_at)
      VALUES(?,?,?,?,?)
    `).run(id, actor.userId, EVENT_TYPES.artifact, JSON.stringify({
      requestId: request.id,
      kind: request.kind,
      brief: request.brief,
      html,
      validation: { safe: true, violations: [] },
    }), timestamp(now));
    const stored = readLatestEvent(connection, actor.userId);
    if (!stored || stored.id !== id || stored.type !== EVENT_TYPES.artifact) {
      throw new GenerativeBuildConflictError("生成产物入库状态不一致");
    }
    return parseArtifact(stored);
  }).immediate();
}

export function resetGenerativeWorkspace(
  connection: DatabaseConnection,
  actor: SessionPayload,
  now = new Date(),
) {
  requireStudent(connection, actor);
  connection.sqlite.prepare(`
    INSERT INTO audit_events(id,user_id,type,payload_json,created_at)
    VALUES(?,?,?,?,?)
  `).run(
    randomUUID(),
    actor.userId,
    EVENT_TYPES.reset,
    JSON.stringify({ reset: true }),
    timestamp(now),
  );
  return GenerativeResetResponseSchema.parse({
    reset: true,
    workspace: emptyWorkspace(),
  });
}
