import { z } from "zod";

import {
  AgentArtworkAttachmentSchema,
  AgentExecutionStepSchema,
  AgentReplySchema,
  DesignSpecialtySchema,
} from "./contracts";
import { AgentRequestedCapabilitySchema } from "./requested-capability";
import { LearningEpisodeSchema } from "@/lib/course-packs/contract";

export const AgentMessageIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:#-]{0,127}$/);

export const AgentMessageRoleSchema = z.enum(["user", "assistant"]);

export const AgentUserMessageStructureSchema = z.object({
  version: z.literal(1),
  kind: z.literal("user"),
  capability: AgentRequestedCapabilitySchema.optional(),
}).strict();

export const AgentAssistantMessageStructureSchema = z.object({
  version: z.literal(1),
  kind: z.literal("assistant"),
  reply: AgentReplySchema,
  episode: LearningEpisodeSchema,
  decisionCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  aiMode: z.enum(["MODEL_ASSISTED", "DETERMINISTIC_FALLBACK"]),
  specialty: z.object({
    id: DesignSpecialtySchema,
    label: z.string().min(1).max(100),
    enhanced: z.boolean(),
  }).strict().optional(),
  /** Links a rendered continuation back to the interrupted run it replaces. */
  continuationOfRunId: z.string().uuid().optional(),
  executionSteps: z.array(AgentExecutionStepSchema).max(24),
}).strict();

export const AgentMessageStructureSchema = z.discriminatedUnion("kind", [
  AgentUserMessageStructureSchema,
  AgentAssistantMessageStructureSchema,
]);

export const AgentMessageToolCallSchema = z.object({
  id: z.string().regex(/^[0-9a-f-]{36}:[1-9][0-9]*$/),
  callId: z.string().uuid(),
  sequence: z.number().int().min(1).max(12),
  toolId: z.string().min(1).max(80),
  toolVersion: z.string().min(1).max(32),
  adapterId: z.string().min(1).max(80),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).nullable(),
  status: z.enum(["SUCCESS", "EMPTY", "ERROR"]),
  errorCode: z.string().nullable(),
  latencyMs: z.number().int().min(0).max(60_000),
}).strict();

export const AgentMessageRecordSchema = z.object({
  id: AgentMessageIdSchema,
  taskId: z.string().uuid(),
  role: AgentMessageRoleSchema,
  content: z.string().trim().min(1).max(32_000),
  structure: AgentMessageStructureSchema,
  attachment: AgentArtworkAttachmentSchema.nullable(),
  toolCalls: z.array(AgentMessageToolCallSchema).max(12),
  turnId: z.string().uuid().nullable(),
  runId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
}).strict();

export const AgentMessageListResponseSchema = z.object({
  taskId: z.string().uuid(),
  messages: z.array(AgentMessageRecordSchema),
  pendingRun: z.object({
    userMessageId: AgentMessageIdSchema,
    runId: z.string().uuid(),
    status: z.enum(["QUEUED", "RUNNING", "WAITING_APPROVAL", "FAILED", "CANCELLED"]),
  }).strict().nullable(),
}).strict();

export const AgentMessageAppendRequestSchema = z.object({
  id: AgentMessageIdSchema,
  content: z.string().trim().min(1).max(2_000),
  capability: AgentRequestedCapabilitySchema.optional(),
}).strict();

export const AgentMessageAppendResponseSchema = z.object({
  message: AgentMessageRecordSchema,
  created: z.boolean(),
}).strict();

export type AgentMessageStructure = z.infer<typeof AgentMessageStructureSchema>;
export type AgentMessageRecord = z.infer<typeof AgentMessageRecordSchema>;
export type AgentMessageToolCall = z.infer<typeof AgentMessageToolCallSchema>;
export type AgentMessageListResponse = z.infer<typeof AgentMessageListResponseSchema>;

export function assistantMessageStructure(input: {
  reply: z.infer<typeof AgentReplySchema>;
  episode: z.infer<typeof LearningEpisodeSchema>;
  decisionCode: string;
  aiMode: "MODEL_ASSISTED" | "DETERMINISTIC_FALLBACK";
  specialty?: {
    id: z.infer<typeof DesignSpecialtySchema>;
    label: string;
    enhanced: boolean;
  };
  continuationOfRunId?: string;
  executionSteps: z.infer<typeof AgentExecutionStepSchema>[];
}) {
  return AgentAssistantMessageStructureSchema.parse({
    version: 1,
    kind: "assistant",
    ...input,
  });
}

export function userMessageStructure(
  capability?: z.infer<typeof AgentRequestedCapabilitySchema>,
) {
  return AgentUserMessageStructureSchema.parse({
    version: 1,
    kind: "user",
    ...(capability ? { capability } : {}),
  });
}

export function stableToolCallReference(turnId: string, sequence: number) {
  return `${z.string().uuid().parse(turnId)}:${z.number().int().min(1).max(12).parse(sequence)}`;
}
