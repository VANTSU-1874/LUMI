import { z } from "zod";
import { AiModeSchema, DataTypeSchema } from "./data-provenance";
import { DiagnosticDimensionScoreSchema } from "./diagnostic";

import { PROJECT_STAGES } from "./stages";
import { AllowedToolPathsSchema, ToolPathMilestoneArraySchema, ToolPathReasonArraySchema, ToolPathRequirementsSchema } from "./tool-path";
import { ToolPathSchema } from "./schemas";
import { LogicCardSchema } from "./schemas";
import { TransferPublicStateSchema } from "./transfer";
import { TroubleshootingPublicStateSchema } from "../services/troubleshooting";

const DateTime = z.iso.datetime();
const ProfileSchema = z.object({
  level: z.enum(["L1", "L2", "L3", "L4"]),
  decomposition: DiagnosticDimensionScoreSchema,
  signalUnderstanding: DiagnosticDimensionScoreSchema,
  mappingDesign: DiagnosticDimensionScoreSchema,
  troubleshooting: DiagnosticDimensionScoreSchema,
  transfer: DiagnosticDimensionScoreSchema,
  updatedAt: DateTime,
  dataType: DataTypeSchema.default("REAL"),
}).strict();

const HintText = z.string().trim().min(1).max(300);
export const StudentHintPublicResponseSchema = z.object({
  hintLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  groundingStatus: z.enum(["GROUNDED", "NO_GROUNDING"]),
  confirmedFacts: z.array(z.string().trim().min(1).max(700)).max(8),
  hypotheses: z.array(HintText).max(5), questions: z.array(HintText).max(5),
  guidance: z.array(HintText).max(5), nextSteps: z.array(HintText).max(5),
  localExample: z.string().trim().min(1).max(600).nullable(),
  sourceTitles: z.array(z.string().trim().min(1).max(160)).max(5),
  sources: z.array(z.object({
    title: z.string().trim().min(1).max(160),
    authority: z.enum(["OFFICIAL", "COURSE_DESIGN", "TEACHER_EXPERIENCE", "ANONYMIZED_CASE"]),
  }).strict()).max(5),
  uncertainty: z.string().trim().min(1).max(300), fallback: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.groundingStatus === "NO_GROUNDING") {
    if (!value.fallback || value.sourceTitles.length || value.sources.length || !value.questions.length || value.confirmedFacts.length || value.hypotheses.length || value.guidance.length || value.nextSteps.length || value.localExample !== null) {
      context.addIssue({ code: "custom", message: "无依据提示只能请求更具体的证据" });
    }
    return;
  }
  if (value.sourceTitles.length !== 1 || value.sources.length !== 1 || value.sources[0]?.title !== value.sourceTitles[0]) context.addIssue({ code: "custom", message: "提示来源不一致" });
  if (value.hintLevel === 1 && (!value.questions.length || value.confirmedFacts.length || value.hypotheses.length || value.guidance.length || value.nextSteps.length || value.localExample !== null)) context.addIssue({ code: "custom", message: "一级提示只能提问" });
  if (value.hintLevel === 2 && (value.guidance.length !== 1 || value.nextSteps.length !== 1 || value.localExample !== null)) context.addIssue({ code: "custom", message: "二级提示需要一个原则和动作" });
  if (value.hintLevel === 3 && (value.guidance.length !== 1 || value.nextSteps.length !== 1 || value.localExample === null)) context.addIssue({ code: "custom", message: "三级提示需要一个有界示例" });
});

export const DashboardLogicCardSchema = z.object({
  payload: LogicCardSchema,
  revision: z.number().int().positive(),
  ruleReady: z.boolean(), semanticReady: z.boolean(),
  status: z.enum(["APPROVED", "NEEDS_REVISION", "PENDING"]),
  source: z.string().trim().min(1).max(64),
  issues: z.array(z.string().trim().min(1).max(200)).max(10),
  dataType: DataTypeSchema.default("REAL"),
}).strict();

export const StudentDashboardSchema = z.object({
  snapshotVersion: z.string().regex(/^[a-f0-9]{64}$/),
  updatedAt: DateTime,
  aiMode: AiModeSchema.default("DETERMINISTIC_FALLBACK"),
  dataType: DataTypeSchema.default("REAL"),
  student: z.object({ alias: z.string().trim().min(1).max(128), dataType: DataTypeSchema.default("REAL") }).strict(),
  profile: ProfileSchema.nullable(),
  course: z.object({
    totalHours: z.number().int().nonnegative(),
    modules: z.array(z.object({
      id: z.string().min(1), sequence: z.number().int().positive(), title: z.string().min(1),
      hours: z.number().int().positive(), focus: z.string().min(1),
    }).strict()).max(20),
  }).strict(),
  assignment: z.object({
    id: z.string().min(1), moduleId: z.string().min(1), title: z.string().min(1),
    brief: z.string().min(1), allowedTools: AllowedToolPathsSchema,
  }).strict().nullable(),
  project: z.object({
    id: z.string().min(1), stage: z.enum(PROJECT_STAGES), updatedAt: DateTime,
    dataType: DataTypeSchema.default("REAL"),
  }).strict().nullable(),
  logicCard: DashboardLogicCardSchema.nullable(),
  toolPath: z.object({
    path: ToolPathSchema, requirements: ToolPathRequirementsSchema,
    reasons: ToolPathReasonArraySchema, milestones: ToolPathMilestoneArraySchema,
    updatedAt: DateTime,
    dataType: DataTypeSchema.default("REAL"),
  }).strict().nullable(),
  evidence: z.object({ total: z.number().int().nonnegative(), verified: z.number().int().nonnegative(), recent: z.array(z.object({
    id: z.uuid(), kind: z.enum(["TEXT", "IMAGE", "VALUE", "VIDEO_LINK", "PROBE"]),
    layer: z.enum(["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"]),
    verification: z.enum(["SUBMITTED", "RULE_VERIFIED", "TEACHER_VERIFIED", "REJECTED"]),
    dataType: DataTypeSchema.default("REAL"),
    timestamp: DateTime,
  }).strict()).max(50) }).strict(),
  troubleshooting: z.object({
    id: z.uuid(), revision: z.number().int().positive(), updatedAt: DateTime,
    state: TroubleshootingPublicStateSchema,
    dataType: DataTypeSchema.default("REAL"),
  }).strict().nullable(),
  hints: z.object({
    count: z.number().int().nonnegative(), latestLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
    latestAt: DateTime.nullable(),
  }).strict(),
  latestHint: StudentHintPublicResponseSchema.nullable(),
  transfer: TransferPublicStateSchema.and(z.object({ dataType: DataTypeSchema.default("REAL") }).strict()).nullable(),
}).strict();

export type StudentDashboard = z.infer<typeof StudentDashboardSchema>;
