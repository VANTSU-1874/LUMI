import { z } from "zod";

const CountSchema = z.object({ key: z.string().min(1), count: z.number().int().nonnegative() }).strict();

const ReviewSummarySchema = z.object({
  reviewed: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  corrected: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  correctionRate: z.number().min(0).max(1).nullable(),
}).strict();

export const PilotReportSchema = z.object({
  schemaVersion: z.literal("1"),
  generatedAt: z.string().datetime(),
  scope: z.object({
    className: z.string().min(1).max(200),
    dataBoundary: z.literal("REAL_ONLY"),
    participantCount: z.number().int().nonnegative(),
  }).strict(),
  automatic: z.object({
    agent: z.object({
      turns: z.number().int().nonnegative(),
      modelAssisted: z.number().int().nonnegative(),
      deterministicFallback: z.number().int().nonnegative(),
      sourceGrounded: z.number().int().nonnegative(),
      sourceGroundingRate: z.number().min(0).max(1).nullable(),
      averageResponseLatencyMs: z.number().int().nonnegative().nullable(),
      actions: z.object({
        proposed: z.number().int().nonnegative(),
        executed: z.number().int().nonnegative(),
        expired: z.number().int().nonnegative(),
      }).strict(),
      byCoursePack: z.array(z.object({
        coursePackId: z.string().min(1),
        coursePackVersion: z.string().min(1),
        turns: z.number().int().nonnegative(),
      }).strict()),
      teacherReviews: ReviewSummarySchema,
    }).strict(),
    learning: z.object({
      currentProjects: z.number().int().nonnegative(),
      completedProjects: z.number().int().nonnegative(),
      projectsByStage: z.array(CountSchema),
      projectsByCoursePack: z.array(z.object({
        coursePackId: z.string().min(1),
        coursePackVersion: z.string().min(1),
        count: z.number().int().nonnegative(),
      }).strict()),
      evidence: z.object({ total: z.number().int().nonnegative(), byVerification: z.array(CountSchema) }).strict(),
      transfer: z.object({ open: z.number().int().nonnegative(), passed: z.number().int().nonnegative(), locked: z.number().int().nonnegative() }).strict(),
      bookDesign: z.object({
        submissions: z.number().int().nonnegative(),
        passedSubmissions: z.number().int().nonnegative(),
        participants: z.number().int().nonnegative(),
        latestPassedParticipants: z.number().int().nonnegative(),
      }).strict(),
      teacherReviews: ReviewSummarySchema,
    }).strict(),
  }).strict(),
  manualRequired: z.array(z.object({
    id: z.enum(["TASK_COMPLETION", "FIRST_NEXT_STEP", "COGNITIVE_ENGAGEMENT", "SUBJECTIVE_FEEDBACK"]),
    label: z.string().min(1),
    status: z.literal("PENDING_MANUAL_OBSERVATION"),
    instruction: z.string().min(1),
  }).strict()).length(4),
  interpretationBoundary: z.array(z.string().min(1)).min(3),
}).strict();

export type PilotReport = z.infer<typeof PilotReportSchema>;
