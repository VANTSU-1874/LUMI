import { z } from "zod";
import { AgentExecutionStepSchema, AgentPolicyTraceSchema, AgentSourceSchema } from "@/lib/agent/contracts";
import { MAX_AGENT_TURN_LATENCY_MS } from "@/lib/agent/latency-limits";
import { AiModeSchema, DataTypeSchema } from "./data-provenance";
import { DiagnosticDimensionScoreSchema } from "./diagnostic";
import { BookLayoutEvidenceResponseSchema } from "./book-layout";
import { StudentMemoryCollectionSchema } from "./student-memory";

import { PROJECT_STAGES } from "./stages";
import { TransferRubricSchema } from "./transfer";

export const TeacherDecisionInputSchema = z.object({
  classId: z.string().trim().min(1).max(128),
  studentId: z.string().trim().min(1).max(128),
  projectId: z.string().trim().min(1).max(128).nullable(),
  targetType: z.enum(["LOGIC_REVIEW", "EVIDENCE", "TRANSFER", "BOOK_LAYOUT_EVIDENCE"]),
  targetId: z.string().trim().min(1).max(128),
  originalRevision: z.number().int().positive(),
  decision: z.enum(["CONFIRMED", "CORRECTED", "NEEDS_REVIEW"]),
  reasonCode: z.string().trim().min(1).max(64),
  notes: z.string().trim().max(1000),
  idempotencyKey: z.string().min(8).max(128),
}).strict().superRefine((input, context) => {
  if (input.targetType === "BOOK_LAYOUT_EVIDENCE" && input.projectId !== null) {
    context.addIssue({ code: "custom", path: ["projectId"], message: "书籍版面证据使用独立课程包复核目标" });
  }
  if (input.targetType !== "BOOK_LAYOUT_EVIDENCE" && input.projectId === null) {
    context.addIssue({ code: "custom", path: ["projectId"], message: "项目型复核目标必须绑定项目" });
  }
});

export type TeacherDecisionInput = z.infer<typeof TeacherDecisionInputSchema>;

export const LogicReviewSnapshotSchema = z.object({
  targetType: z.literal("LOGIC_REVIEW"), revision: z.number().int().positive(),
  status: z.enum(["APPROVED", "NEEDS_REVISION", "PENDING"]),
  ruleReady: z.boolean(), semanticReady: z.boolean(), source: z.string().min(1).max(64),
  issues: z.array(z.string().min(1).max(200)).max(10),
}).strict();
export const EvidenceSnapshotSchema = z.object({
  targetType: z.literal("EVIDENCE"), id: z.string(), kind: z.enum(["TEXT", "IMAGE", "VALUE", "VIDEO_LINK", "PROBE"]),
  layer: z.enum(["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"]),
  verification: z.enum(["SUBMITTED", "RULE_VERIFIED", "TEACHER_VERIFIED", "REJECTED"]),
  code: z.enum(["INPUT_OK", "MAPPING_OK", "TRANSPORT_OK", "BINDING_OK", "OUTPUT_OK"]).nullable(),
  revision: z.number().int().positive(), sequence: z.number().int().positive(),
}).strict();
export const TransferSnapshotSchema = z.object({
  targetType: z.literal("TRANSFER"), revision: z.number().int().positive(),
  status: z.enum(["OPEN", "PASSED", "LOCKED"]), attemptCount: z.number().int().nonnegative(),
  latestRubric: TransferRubricSchema.nullable(), latestOutcome: z.enum(["RETRY", "PASSED", "LOCKED"]).nullable(),
}).strict();
export const BookLayoutEvidenceSnapshotSchema = BookLayoutEvidenceResponseSchema
  .omit({ createdAt: true, dataType: true })
  .extend({ targetType: z.literal("BOOK_LAYOUT_EVIDENCE"), revision: z.literal(1) })
  .strict();
export const TeacherOriginalSnapshotSchema = z.discriminatedUnion("targetType", [
  LogicReviewSnapshotSchema,
  EvidenceSnapshotSchema,
  TransferSnapshotSchema,
  BookLayoutEvidenceSnapshotSchema,
]);
export type TeacherOriginalSnapshot = z.infer<typeof TeacherOriginalSnapshotSchema>;
export const TeacherReviewTargetSchema = z.object({ targetId: z.string().min(1).max(128), snapshot: TeacherOriginalSnapshotSchema }).strict();

export const AgentDecisionReviewInputSchema = z.object({
  turnId: z.string().uuid(),
  decision: z.enum(["CONFIRMED", "CORRECTED", "NEEDS_REVIEW"]),
  notes: z.string().trim().min(1).max(1000),
}).strict();

export const AgentDecisionReviewPublicSchema = z.object({
  id: z.string().uuid(),
  turnId: z.string().uuid(),
  teacherId: z.string(),
  decision: z.enum(["CONFIRMED", "CORRECTED", "NEEDS_REVIEW"]),
  notes: z.string(),
  createdAt: z.string().datetime(),
  dataType: DataTypeSchema,
}).strict();

export const AgentDecisionToolCallSchema = z.object({
  id: z.string().uuid(),
  sequence: z.number().int().min(1).max(12),
  toolId: z.string().min(1).max(80),
  toolVersion: z.string().min(1).max(32),
  adapterId: z.string().min(1).max(80),
  input: z.record(z.string(), z.unknown()),
  status: z.enum(["SUCCESS", "EMPTY", "ERROR"]),
  errorCode: z.string().max(100).nullable(),
  latencyMs: z.number().int().min(0).max(60_000),
  createdAt: z.string().datetime(),
  dataType: DataTypeSchema,
}).strict();

export const AgentDecisionTimelineItemSchema = z.object({
  turnId: z.string().uuid(),
  conversationId: z.string().uuid(),
  coursePackId: z.string(),
  coursePackVersion: z.string(),
  coursePackLabel: z.string(),
  studentMessage: z.string(),
  episode: z.enum(["EXPLORE", "UNDERSTAND", "BUILD", "DEBUG", "TRANSFER", "REFLECT"]),
  decisionCode: z.string(),
  responseStrategy: z.enum(["DIRECT_INSTRUCTION", "CONCEPT_EXPLANATION", "DIAGNOSTIC_GUIDANCE", "TRANSFER_COACHING", "REFLECTION_PROMPT", "CLARIFY", "OUT_OF_SCOPE"]),
  responseLatencyMs: z.number().int().nonnegative().max(MAX_AGENT_TURN_LATENCY_MS),
  aiMode: AiModeSchema,
  policy: AgentPolicyTraceSchema,
  executionSteps: z.array(AgentExecutionStepSchema).max(24),
  toolCalls: z.array(AgentDecisionToolCallSchema).max(12),
  sourceIds: z.array(z.string()),
  reply: z.object({
    title: z.string(),
    message: z.string(),
    whyThisStep: z.string(),
    uncertainty: z.string(),
    sources: z.array(AgentSourceSchema).max(5),
    actions: z.array(z.object({ id: z.string().uuid(), label: z.string(), description: z.string(), status: z.enum(["PROPOSED", "EXECUTED", "EXPIRED"]) }).strict()).max(3),
  }).strict(),
  createdAt: z.string().datetime(),
  dataType: DataTypeSchema,
  review: AgentDecisionReviewPublicSchema.nullable(),
}).strict();

const CountItemSchema = z.object({ key: z.string(), count: z.number().int().nonnegative() });
const DiagnosticScoreCountItemSchema = z.object({
  key: z.enum(["1", "1.5", "2", "2.5", "3", "3.5", "4"]),
  count: z.number().int().nonnegative(),
}).strict();
const StageCountSchema = z.object({ stage: z.enum(PROJECT_STAGES), count: z.number().int().nonnegative() });

const ClassMetricsSchema = z.object({
  stages: z.array(StageCountSchema).length(7),
  supportNeeded: z.number().int().nonnegative(),
  profiles: z.object({
    levels: z.array(CountItemSchema),
    dimensions: z.array(z.object({ dimension: z.string(), scores: z.array(DiagnosticScoreCountItemSchema), support: z.number().int().nonnegative() })),
  }),
  logicIssues: z.array(CountItemSchema),
  troubleshooting: z.object({ byLayer: z.array(z.object({ layer: z.string(), count: z.number().int().nonnegative() })), escalated: z.number().int().nonnegative() }),
  hints: z.object({ students: z.number().int().nonnegative(), total: z.number().int().nonnegative(), latestL3: z.number().int().nonnegative(), maxL3: z.number().int().nonnegative() }),
  transfer: z.object({ active: z.number().int().nonnegative(), passed: z.number().int().nonnegative(), locked: z.number().int().nonnegative() }),
  evidence: z.object({ byVerification: z.array(CountItemSchema), byAuthority: z.array(CountItemSchema) }),
}).strict();

export const TeacherDecisionPublicSchema = z.object({
  id: z.string(), targetType: z.enum(["LOGIC_REVIEW", "EVIDENCE", "TRANSFER", "BOOK_LAYOUT_EVIDENCE"]),
  targetId: z.string(), originalRevision: z.number().int().positive(),
  decision: z.enum(["CONFIRMED", "CORRECTED", "NEEDS_REVIEW"]),
  reasonCode: z.string(), notes: z.string(), sequence: z.number().int().positive(), timelineSequence: z.number().int().positive(), createdAt: z.string().datetime(),
  originalSnapshot: TeacherOriginalSnapshotSchema,
});

export const ClassAnalyticsSchema = z.object({
  class: z.object({ id: z.string(), name: z.string(), dataType: z.literal("REAL") }),
  aiMode: AiModeSchema.default("DETERMINISTIC_FALLBACK"),
  dataCounts: z.object({ real: z.number().int().nonnegative(), demonstration: z.number().int().nonnegative(), included: z.number().int().nonnegative() }).strict().default({ real: 0, demonstration: 0, included: 0 }),
  updatedAt: z.string().datetime(),
  stages: z.array(StageCountSchema).length(7),
  supportNeeded: z.number().int().nonnegative(),
  profiles: z.object({
    levels: z.array(CountItemSchema),
    dimensions: z.array(z.object({ dimension: z.string(), scores: z.array(DiagnosticScoreCountItemSchema), support: z.number().int().nonnegative() })),
  }),
  logicIssues: z.array(CountItemSchema),
  troubleshooting: z.object({ byLayer: z.array(z.object({ layer: z.string(), count: z.number().int().nonnegative() })), escalated: z.number().int().nonnegative() }),
  hints: z.object({ students: z.number().int().nonnegative(), total: z.number().int().nonnegative(), latestL3: z.number().int().nonnegative(), maxL3: z.number().int().nonnegative() }),
  transfer: z.object({ active: z.number().int().nonnegative(), passed: z.number().int().nonnegative(), locked: z.number().int().nonnegative() }),
  evidence: z.object({ byVerification: z.array(CountItemSchema), byAuthority: z.array(CountItemSchema) }),
  metricsByDataType: z.object({
    REAL: ClassMetricsSchema,
    DEMONSTRATION_DATA: ClassMetricsSchema,
  }).strict(),
  students: z.array(z.object({ id: z.string(), alias: z.string(), dataType: DataTypeSchema.default("REAL"), stage: z.enum(PROJECT_STAGES).nullable(), needsSupport: z.boolean(), updatedAt: z.string().datetime() })),
  studentsMeta: z.object({ total: z.number().int().nonnegative(), returned: z.number().int().nonnegative(), truncated: z.boolean(), aggregateScope: z.literal("ALL_CLASS_STUDENTS") }),
});

export const LearnerDetailSchema = z.object({
  aiMode: AiModeSchema.default("DETERMINISTIC_FALLBACK"),
  student: z.object({ id: z.string(), alias: z.string(), dataType: DataTypeSchema.default("REAL") }),
  profile: z.object({
    level: z.enum(["L1", "L2", "L3", "L4"]),
    decomposition: DiagnosticDimensionScoreSchema,
    signalUnderstanding: DiagnosticDimensionScoreSchema,
    mappingDesign: DiagnosticDimensionScoreSchema,
    troubleshooting: DiagnosticDimensionScoreSchema,
    transfer: DiagnosticDimensionScoreSchema,
    updatedAt: z.string().datetime(),
    dataType: DataTypeSchema.default("REAL"),
  }).strict().nullable(),
  project: z.object({ id: z.string(), stage: z.enum(PROJECT_STAGES), updatedAt: z.string().datetime(), dataType: DataTypeSchema.default("REAL") }).nullable(),
  logic: z.object({ status: z.string(), source: z.string(), issues: z.array(z.string()), revision: z.number().int().positive(), ruleReady: z.boolean(), semanticReady: z.boolean(), dataType: DataTypeSchema.default("REAL") }).nullable(),
  path: z.object({ value: z.string(), updatedAt: z.string().datetime(), dataType: DataTypeSchema.default("REAL") }).nullable(),
  evidence: z.object({ total: z.number().int(), dataType: DataTypeSchema.default("REAL"), byVerification: z.array(CountItemSchema), byAuthority: z.array(CountItemSchema) }),
  troubleshooting: z.object({ layer: z.string(), status: z.string(), revision: z.number(), updatedAt: z.string().datetime(), dataType: DataTypeSchema.default("REAL") }).nullable(),
  hints: z.object({ latestLevel: z.number().int().nullable(), maxLevel: z.number().int().nullable(), count: z.number().int() }),
  transfer: z.object({ status: z.string(), revision: z.number(), attemptCount: z.number(), latestOutcome: z.string().nullable(), latestRubric: z.unknown().nullable(), updatedAt: z.string().datetime(), dataType: DataTypeSchema.default("REAL") }).nullable(),
  reviewTargets: z.array(TeacherReviewTargetSchema).max(23),
  decisions: z.array(TeacherDecisionPublicSchema),
  latestDecisionByTarget: z.record(z.string(), TeacherDecisionPublicSchema),
  agentTimeline: z.array(AgentDecisionTimelineItemSchema).max(30).optional(),
  memories: StudentMemoryCollectionSchema.default({
    items: [],
    meta: { total: 0, returned: 0, truncated: false },
  }),
  bookLayoutEvidence: z.object({
    id: z.string().uuid(), audience: z.enum(["NEW_STUDENTS", "COMMUNITY_RESIDENTS"]),
    score: z.number().int().min(0).max(4), passed: z.boolean(), createdAt: z.string().datetime(), dataType: DataTypeSchema,
  }).strict().nullable().optional(),
});

export type ClassAnalytics = z.infer<typeof ClassAnalyticsSchema>;
export type LearnerDetail = z.infer<typeof LearnerDetailSchema>;
export type AgentDecisionReviewInput = z.infer<typeof AgentDecisionReviewInputSchema>;
export type AgentDecisionReviewPublic = z.infer<typeof AgentDecisionReviewPublicSchema>;
