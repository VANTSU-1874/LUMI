import { z } from "zod";

import { ToolAdapterTargetSchema } from "@/lib/tool-adapters/contract";
import { AgentTurnRequestSchema, AgentTurnResponseSchema } from "../contracts";
import { AgentRuntimeDescriptorSchema } from "./trace-contract";

export const AgentRunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "WAITING_APPROVAL",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const AgentRunEventKindSchema = z.enum([
  "RUN_CREATED",
  "STATUS_CHANGED",
  "RUN_CLAIMED",
  "STEP",
  "TOOL",
  "APPROVAL",
  "COMPLETION",
  "ERROR",
  "CANCELLED",
  "TOKEN",
]);

export const AgentRunCheckpointSchema = z.object({
  stage: z.enum([
    "CREATED", "CLAIMED", "CANCEL_REQUESTED", "CANCELLED", "RETRY_QUEUED",
    "TURN_PERSISTED", "WAITING_APPROVAL", "COMPLETED", "FAILED",
  ]),
  turnId: z.string().uuid().optional(),
  approvalId: z.string().uuid().optional(),
}).strict();

export const AgentRunEventPayloadSchema = z.object({
  status: AgentRunStatusSchema.optional(),
  previousStatus: AgentRunStatusSchema.optional(),
  attempt: z.number().int().min(0).max(100).optional(),
  runtime: AgentRuntimeDescriptorSchema.optional(),
  checkpoint: AgentRunCheckpointSchema.optional(),
  turnId: z.string().uuid().optional(),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/).optional(),
  stepKind: z.enum(["CONTEXT", "RETRIEVAL", "MODEL", "TOOL", "PERSISTENCE", "RESPONSE"]).optional(),
  toolId: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/).optional(),
  toolStatus: z.enum(["RUNNING", "SUCCEEDED", "FAILED"]).optional(),
  approvalId: z.string().uuid().optional(),
  decision: z.enum(["APPROVE", "REJECT"]).optional(),
  cancelRequested: z.boolean().optional(),
  retryQueued: z.boolean().optional(),
  text: z.string().min(1).max(2_000).optional(),
}).strict();

export const AgentRunEventSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  sequence: z.number().int().min(1),
  kind: AgentRunEventKindSchema,
  label: z.string().trim().min(1).max(100),
  summary: z.string().trim().min(1).max(300),
  payload: AgentRunEventPayloadSchema,
  createdAt: z.string().datetime(),
}).strict().superRefine((event, context) => {
  if (event.kind === "TOKEN" && event.payload.text === undefined) {
    context.addIssue({ code: "custom", path: ["payload", "text"], message: "TOKEN event requires learner-visible text" });
  }
  if (event.kind !== "TOKEN" && event.payload.text !== undefined) {
    context.addIssue({ code: "custom", path: ["payload", "text"], message: "Only TOKEN events may carry text" });
  }
});

export const AgentRunSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  request: AgentTurnRequestSchema.optional(),
  status: AgentRunStatusSchema,
  runtime: AgentRuntimeDescriptorSchema,
  attempt: z.number().int().min(0).max(100),
  checkpoint: AgentRunCheckpointSchema,
  result: AgentTurnResponseSchema.nullable(),
  lastErrorCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/).nullable(),
  cancelRequestedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
}).strict();

export const AgentRunCreateResponseSchema = z.object({
  run: AgentRunSchema,
  created: z.boolean(),
  nextEventSequence: z.number().int().min(1),
}).strict();

export const AgentRunEventsResponseSchema = z.object({
  runId: z.string().uuid(),
  events: z.array(AgentRunEventSchema).max(200),
  nextEventSequence: z.number().int().min(1),
}).strict();

export const AgentRunCurrentResponseSchema = z.object({
  run: AgentRunSchema.nullable(),
  nextEventSequence: z.number().int().min(1),
}).strict();

export const AgentRunCancelResponseSchema = z.object({
  run: AgentRunSchema,
  alreadyApplied: z.boolean(),
  abortRequested: z.boolean(),
}).strict();

export const AgentRunRetryResponseSchema = z.object({
  run: AgentRunSchema,
  alreadyApplied: z.boolean(),
}).strict();

export const AgentRunApprovalRequestSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  idempotencyKey: z.string().uuid(),
}).strict();

export const AgentRunApprovalResponseSchema = z.object({
  run: AgentRunSchema,
  action: z.object({
    id: z.string().uuid(),
    status: z.enum(["EXECUTED", "REJECTED"]),
    alreadyApplied: z.boolean(),
    navigation: z.object({
      target: ToolAdapterTargetSchema,
      focus: z.string().nullable(),
    }).strict().nullable(),
  }).strict(),
}).strict();

export type AgentRun = z.infer<typeof AgentRunSchema>;
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;
export type AgentRunEvent = z.infer<typeof AgentRunEventSchema>;
export type AgentRunEventKind = z.infer<typeof AgentRunEventKindSchema>;
export type AgentRunEventPayload = z.infer<typeof AgentRunEventPayloadSchema>;
export type AgentRunCheckpoint = z.infer<typeof AgentRunCheckpointSchema>;
