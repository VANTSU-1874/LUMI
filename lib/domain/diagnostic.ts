import { z } from "zod";

export const DIAGNOSTIC_QUESTION_COUNT = 10;

export const DiagnosticDimensionScoreSchema = z
  .number()
  .min(1)
  .max(4)
  .refine((value) => Number.isSafeInteger(value * 2), {
    message: "诊断维度分数必须以0.5为步进",
  });

export const DiagnosticAverageScoreSchema = z
  .number()
  .min(1)
  .max(4)
  .refine(
    (value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-9,
    { message: "诊断平均分必须来自五个合法维度分数" },
  );

export const DiagnosticAnswerSchema = z
  .object({
    questionId: z.string().min(1).max(128),
    optionId: z.string().min(1).max(128),
  })
  .strict();

export const DiagnosticAnswersSchema = z
  .array(DiagnosticAnswerSchema)
  .length(DIAGNOSTIC_QUESTION_COUNT);

export const DiagnosticSubmissionSchema = z
  .object({
    questionSetVersion: z.string().trim().min(1).max(32),
    answers: DiagnosticAnswersSchema,
  })
  .strict();

export const DiagnosticProfileSchema = z
  .object({
    decomposition: DiagnosticDimensionScoreSchema,
    signalUnderstanding: DiagnosticDimensionScoreSchema,
    mappingDesign: DiagnosticDimensionScoreSchema,
    troubleshooting: DiagnosticDimensionScoreSchema,
    transfer: DiagnosticDimensionScoreSchema,
    average: DiagnosticAverageScoreSchema,
    level: z.enum(["L1", "L2", "L3", "L4"]),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const DiagnosticProfileResponseSchema = z
  .object({
    profile: DiagnosticProfileSchema,
  })
  .strict();

export type DiagnosticAnswer = z.infer<typeof DiagnosticAnswerSchema>;
export type DiagnosticSubmission = z.infer<typeof DiagnosticSubmissionSchema>;
export type DiagnosticProfileResponse = z.infer<
  typeof DiagnosticProfileResponseSchema
>;
export type LearnerProfile = z.infer<typeof DiagnosticProfileSchema>;
