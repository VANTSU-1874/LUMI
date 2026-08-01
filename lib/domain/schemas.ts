import { z } from "zod";

export const LogicCardSchema = z.object({
  culturalIntent: z.string().trim().max(500),
  participantAction: z.string().trim().max(500),
  inputSignal: z.string().trim().max(500),
  mappingRule: z.string().trim().max(500),
  outputMedium: z.string().trim().max(500),
  experienceFeedback: z.string().trim().max(500),
});

export type LogicCard = z.infer<typeof LogicCardSchema>;

export const LearnerLevelSchema = z.enum(["L1", "L2", "L3", "L4"]);

export type LearnerLevel = z.infer<typeof LearnerLevelSchema>;

export const ToolPathSchema = z.enum([
  "DIGISHOW",
  "TOUCHDESIGNER",
  "COLLABORATIVE",
]);

export type ToolPath = z.infer<typeof ToolPathSchema>;
