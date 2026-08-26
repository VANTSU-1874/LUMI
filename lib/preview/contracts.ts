import { z } from "zod";

export const PREVIEW_SCENARIO_IDS = [
  "S1_DIGITAL_PRODUCT",
  "S2_COURSE_DESIGN",
  "S3_DESIGN_KNOWLEDGE",
  "S4_PORTFOLIO_DIRECTION",
  "S5_LEARNING_EVIDENCE",
] as const;
export const PreviewScenarioIdSchema = z.enum(PREVIEW_SCENARIO_IDS);
export type PreviewScenarioId = z.infer<typeof PreviewScenarioIdSchema>;

export const PREVIEW_OUTCOME_CODES = [
  "STAGE_CONCLUSION",
  "NEXT_STEP",
  "EVIDENCE_NEEDED",
  "NEXT_EVALUATION",
] as const;
export const PreviewOutcomeSchema = z.object({
  code: z.enum(PREVIEW_OUTCOME_CODES),
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(240),
}).strict();
export type PreviewOutcome = z.infer<typeof PreviewOutcomeSchema>;

export const PREVIEW_SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

export const PreviewConversationTurnSchema = z.object({
  userMessage: z.string().trim().min(1).max(2_000),
  assistantMessage: z.string().trim().min(1).max(8_000),
}).strict();
export type PreviewConversationTurn = z.infer<typeof PreviewConversationTurnSchema>;

export const PreviewRunRequestSchema = z.object({
  scenarioId: PreviewScenarioIdSchema,
  suggestionId: z.string().min(1).max(80).optional(),
  message: z.string().trim().min(1).max(2_000).optional(),
  history: z.array(PreviewConversationTurnSchema).max(6).optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.suggestionId) === Boolean(value.message)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "choose exactly one preview input",
    });
  }
});

export const PreviewSourceSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(240),
  authority: z.string().min(1).max(80),
  scope: z.string().min(1).max(240),
}).strict();

export const PreviewResponseSchema = z.object({
  title: z.string().min(1).max(160),
  message: z.string().min(1).max(8_000),
  whyThisStep: z.string().min(1).max(800),
  uncertainty: z.string().min(1).max(800),
  sources: z.array(PreviewSourceSchema).max(5),
  branch: z.object({
    directionId: PreviewScenarioIdSchema,
    directionTitle: z.string().min(1).max(120),
    suggestionId: z.string().min(1).max(80),
    suggestionLabel: z.string().min(1).max(160),
    outcome: PreviewOutcomeSchema,
  }).strict(),
}).strict();

export type PreviewResponse = z.infer<typeof PreviewResponseSchema>;

export const PreviewRunStatusSchema = z.enum(["RUNNING", "COMPLETED", "FAILED"]);
export type PreviewRunStatus = z.infer<typeof PreviewRunStatusSchema>;

export const PreviewFailureStageSchema = z.enum([
  "MODEL_SETUP",
  "MODEL_REQUEST",
  "MODEL_RESPONSE",
]);
export type PreviewFailureStage = z.infer<typeof PreviewFailureStageSchema>;

export const PreviewRunFailureEventSchema = z.object({
  runId: z.string().uuid(),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  error: z.string().min(1).max(240),
  requestId: z.string().uuid(),
  stage: PreviewFailureStageSchema,
  retryable: z.boolean(),
}).strict();
export type PreviewRunFailureEvent = z.infer<typeof PreviewRunFailureEventSchema>;
