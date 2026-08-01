import { z } from "zod";

import { LogicCardSchema } from "./schemas";

export const LogicCardFieldSchema = z.enum([
  "culturalIntent",
  "participantAction",
  "inputSignal",
  "mappingRule",
  "outputMedium",
  "experienceFeedback",
]);

export const LogicCardCoachRequestSchema = z.object({
  field: LogicCardFieldSchema,
  answer: z.string().trim().min(1).max(500),
  card: LogicCardSchema.strict(),
}).strict();

export const LogicCardCoachSuggestionSchema = z.object({
  field: LogicCardFieldSchema,
  mode: z.enum(["MODEL_ASSISTED", "DETERMINISTIC_FALLBACK"]),
  acknowledgement: z.string().trim().min(1).max(160),
  question: z.string().trim().min(1).max(160),
  options: z.array(z.object({
    id: z.string().regex(/^option-[1-3]$/),
    label: z.string().trim().min(1).max(100),
    value: z.string().trim().min(1).max(500),
  }).strict()).min(2).max(3),
  source: z.string().trim().min(1).max(64),
}).strict().superRefine((value, context) => {
  if (new Set(value.options.map((option) => option.id)).size !== value.options.length) {
    context.addIssue({ code: "custom", path: ["options"], message: "澄清选项编号必须唯一" });
  }
  if (new Set(value.options.map((option) => option.value)).size !== value.options.length) {
    context.addIssue({ code: "custom", path: ["options"], message: "澄清选项内容必须不同" });
  }
});

export const LogicCardCoachResponseSchema = LogicCardCoachSuggestionSchema.extend({
  projectId: z.string().trim().min(1).max(128),
}).strict();

export type LogicCardCoachInput = z.infer<typeof LogicCardCoachRequestSchema>;
export type LogicCardCoachSuggestion = z.infer<typeof LogicCardCoachSuggestionSchema>;
export type LogicCardCoachResponse = z.infer<typeof LogicCardCoachResponseSchema>;
