import { and, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  readTeacherScope,
  TeacherIdentityForbiddenError,
} from "@/lib/auth/teacher-access";
import type { SessionPayload } from "@/lib/auth/session";
import type { DatabaseConnection } from "@/lib/db/client";
import {
  agentConversations,
  agentRuntimeEvents,
  agentTurns,
  users,
} from "@/lib/db/schema";

type CourseDatabase = DatabaseConnection["db"];

export const KNOWLEDGE_V2_CANARY_ACTIVE =
  "KNOWLEDGE_V2_CANARY_ACTIVE" as const;
export const KNOWLEDGE_V2_CANARY_UNAVAILABLE =
  "KNOWLEDGE_V2_CANARY_UNAVAILABLE" as const;
export const KNOWLEDGE_V2_EVIDENCE_ADOPTED =
  "KNOWLEDGE_V2_EVIDENCE_ADOPTED" as const;

const OBSERVATION_WINDOW_MINUTES = 30;
const MAX_OBSERVATION_WINDOW_MINUTES = 240;

export const KnowledgeV2CanaryObservationOptionsSchema = z.object({
  canaryUserIds: z.array(z.string().trim().min(1).max(160)).max(8),
  now: z.coerce.date(),
  windowMinutes: z.number().int().min(1).max(MAX_OBSERVATION_WINDOW_MINUTES)
    .default(OBSERVATION_WINDOW_MINUTES),
}).strict();

const CountSchema = z.number().int().nonnegative();

export const KnowledgeV2CanaryObservationSchema = z.object({
  schemaVersion: z.literal(1),
  window: z.object({
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    minutes: z.number().int().min(1).max(MAX_OBSERVATION_WINDOW_MINUTES),
  }).strict(),
  scope: z.object({
    configuredCanaryAccounts: CountSchema,
    observableCanaryAccounts: CountSchema,
  }).strict(),
  turns: z.object({
    activeV2: CountSchema,
    unavailableV2: CountSchema,
  }).strict(),
  retrieval: z.object({
    calls: CountSchema,
    success: CountSchema,
    empty: CountSchema,
    failed: CountSchema,
    channelDegraded: CountSchema,
    circuitProtected: CountSchema,
    healthUnavailable: CountSchema,
    p95LatencyMs: z.number().int().nonnegative().nullable(),
  }).strict(),
  evidence: z.object({
    adoptedTurns: CountSchema,
  }).strict(),
  manualReview: z.object({
    studentVisibleErrorCheckRequired: z.literal(true),
    note: z.literal("需由观察人从内部学生会话核对可见错误提示；本接口不返回学生问题或回答。"),
  }).strict(),
}).strict();

export type KnowledgeV2CanaryObservation = z.infer<
  typeof KnowledgeV2CanaryObservationSchema
>;

export class KnowledgeV2CanaryObservationForbiddenError
  extends TeacherIdentityForbiddenError {
  constructor() {
    super();
    this.name = "KnowledgeV2CanaryObservationForbiddenError";
  }
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function percentile95(values: readonly number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
}

export function readKnowledgeV2CanaryObservation(
  db: CourseDatabase,
  actor: SessionPayload,
  rawOptions: z.input<typeof KnowledgeV2CanaryObservationOptionsSchema>,
): KnowledgeV2CanaryObservation {
  if (actor.role !== "TEACHER") {
    throw new KnowledgeV2CanaryObservationForbiddenError();
  }
  const options = KnowledgeV2CanaryObservationOptionsSchema.parse(rawOptions);
  let teacherScope: ReturnType<typeof readTeacherScope>;
  try {
    teacherScope = readTeacherScope(db, actor);
  } catch (error) {
    if (error instanceof TeacherIdentityForbiddenError) {
      throw new KnowledgeV2CanaryObservationForbiddenError();
    }
    throw error;
  }
  const canaryUserIds = unique(options.canaryUserIds);
  const startedAt = new Date(
    options.now.getTime() - options.windowMinutes * 60_000,
  );
  const empty = () => KnowledgeV2CanaryObservationSchema.parse({
    schemaVersion: 1,
    window: {
      startedAt: startedAt.toISOString(),
      endedAt: options.now.toISOString(),
      minutes: options.windowMinutes,
    },
    scope: {
      configuredCanaryAccounts: canaryUserIds.length,
      observableCanaryAccounts: 0,
    },
    turns: { activeV2: 0, unavailableV2: 0 },
    retrieval: {
      calls: 0,
      success: 0,
      empty: 0,
      failed: 0,
      channelDegraded: 0,
      circuitProtected: 0,
      healthUnavailable: 0,
      p95LatencyMs: null,
    },
    evidence: { adoptedTurns: 0 },
    manualReview: {
      studentVisibleErrorCheckRequired: true,
      note: "需由观察人从内部学生会话核对可见错误提示；本接口不返回学生问题或回答。",
    },
  });
  if (canaryUserIds.length === 0) return empty();

  const observableUserIds = db.select({ id: users.id })
    .from(users)
    .where(and(
      inArray(users.id, canaryUserIds),
      eq(users.role, "STUDENT"),
      teacherScope.kind === "CLASS" ? eq(users.classId, teacherScope.classId) : undefined,
    ))
    .all()
    .map(({ id }) => id);
  if (observableUserIds.length === 0) return empty();

  const markerEvents = db.select({
    turnId: agentRuntimeEvents.turnId,
    policyRule: agentRuntimeEvents.policyRule,
  })
    .from(agentRuntimeEvents)
    .innerJoin(agentTurns, eq(agentRuntimeEvents.turnId, agentTurns.id))
    .innerJoin(agentConversations, eq(agentTurns.conversationId, agentConversations.id))
    .where(and(
      inArray(agentConversations.studentId, observableUserIds),
      gte(agentRuntimeEvents.createdAt, startedAt),
      inArray(agentRuntimeEvents.policyRule, [
        KNOWLEDGE_V2_CANARY_ACTIVE,
        KNOWLEDGE_V2_CANARY_UNAVAILABLE,
      ]),
    ))
    .all();
  const activeTurnIds = new Set(markerEvents
    .filter(({ policyRule }) => policyRule === KNOWLEDGE_V2_CANARY_ACTIVE)
    .map(({ turnId }) => turnId));
  const unavailableTurnIds = new Set(markerEvents
    .filter(({ policyRule }) => policyRule === KNOWLEDGE_V2_CANARY_UNAVAILABLE)
    .map(({ turnId }) => turnId));
  const v2TurnIds = unique([
    ...activeTurnIds,
    ...unavailableTurnIds,
  ]);
  if (v2TurnIds.length === 0) {
    const result = empty();
    return KnowledgeV2CanaryObservationSchema.parse({
      ...result,
      scope: {
        ...result.scope,
        observableCanaryAccounts: observableUserIds.length,
      },
    });
  }

  const events = db.select({
    turnId: agentRuntimeEvents.turnId,
    kind: agentRuntimeEvents.kind,
    status: agentRuntimeEvents.status,
    toolId: agentRuntimeEvents.toolId,
    policyRule: agentRuntimeEvents.policyRule,
    errorCode: agentRuntimeEvents.errorCode,
    latencyMs: agentRuntimeEvents.latencyMs,
  })
    .from(agentRuntimeEvents)
    .where(inArray(agentRuntimeEvents.turnId, v2TurnIds))
    .all();
  const retrieval = events.filter(({ kind, toolId }) => (
    kind === "TOOL_OBSERVATION"
    && toolId === "knowledge-map.search-evidence"
  ));
  const adoptedTurns = new Set(events
    .filter(({ policyRule }) => policyRule === KNOWLEDGE_V2_EVIDENCE_ADOPTED)
    .map(({ turnId }) => turnId));
  const countErrorCode = (errorCode: string) => events.filter(
    (event) => event.errorCode === errorCode,
  ).length;

  return KnowledgeV2CanaryObservationSchema.parse({
    schemaVersion: 1,
    window: {
      startedAt: startedAt.toISOString(),
      endedAt: options.now.toISOString(),
      minutes: options.windowMinutes,
    },
    scope: {
      configuredCanaryAccounts: canaryUserIds.length,
      observableCanaryAccounts: observableUserIds.length,
    },
    turns: {
      activeV2: activeTurnIds.size,
      unavailableV2: unavailableTurnIds.size,
    },
    retrieval: {
      calls: retrieval.length,
      success: retrieval.filter(({ status }) => status === "SUCCEEDED").length,
      empty: retrieval.filter(({ status }) => status === "EMPTY").length,
      failed: retrieval.filter(({ status }) => status === "FAILED").length,
      channelDegraded: countErrorCode("KNOWLEDGE_RETRIEVAL_CHANNEL_DEGRADED"),
      circuitProtected: countErrorCode("KNOWLEDGE_RETRIEVAL_CIRCUIT_OPEN"),
      healthUnavailable: countErrorCode("KNOWLEDGE_RETRIEVAL_HEALTH_UNAVAILABLE"),
      p95LatencyMs: percentile95(retrieval.map(({ latencyMs }) => latencyMs)),
    },
    evidence: { adoptedTurns: adoptedTurns.size },
    manualReview: {
      studentVisibleErrorCheckRequired: true,
      note: "需由观察人从内部学生会话核对可见错误提示；本接口不返回学生问题或回答。",
    },
  });
}
