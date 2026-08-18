import { z } from "zod";

import { AgentMessageAppendRequestSchema } from "../agent-message-contract";
import { AgentRunSchema } from "./agent-run-event";

export const AgentRunInterventionModeSchema = z.enum(["FOLLOW_UP", "STEER"]);
export const AgentRunInterventionStatusSchema = z.enum([
  "QUEUED",
  "ACTIVE",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const AgentRunInterventionRequestSchema = z.object({
  mode: AgentRunInterventionModeSchema,
  message: AgentMessageAppendRequestSchema,
}).strict();

export const AgentRunInterventionSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  sourceRunId: z.string().uuid(),
  predecessorRunId: z.string().uuid(),
  userMessageId: z.string().min(1).max(128),
  requestedMode: AgentRunInterventionModeSchema,
  actualMode: AgentRunInterventionModeSchema,
  queueSequence: z.number().int().min(1),
  nextRunId: z.string().uuid(),
  status: AgentRunInterventionStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  activatedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
}).strict();

export const AgentRunInterventionCreateResponseSchema = z.object({
  intervention: AgentRunInterventionSchema,
  nextRun: AgentRunSchema,
  created: z.boolean(),
  steerShouldCancel: z.boolean(),
}).strict();

export const AgentRunInterventionListResponseSchema = z.object({
  taskId: z.string().uuid(),
  interventions: z.array(AgentRunInterventionSchema).max(200),
}).strict();

export type AgentRunInterventionMode = z.infer<typeof AgentRunInterventionModeSchema>;
export type AgentRunInterventionStatus = z.infer<typeof AgentRunInterventionStatusSchema>;
export type AgentRunIntervention = z.infer<typeof AgentRunInterventionSchema>;
export type AgentRunInterventionRequest = z.infer<typeof AgentRunInterventionRequestSchema>;
