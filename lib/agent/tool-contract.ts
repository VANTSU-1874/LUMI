import { z } from "zod";

import type { EmbeddingProvider } from "@/lib/ai/embeddings";
import type { SessionPayload } from "@/lib/auth/session";
import type { CoursePack } from "@/lib/course-packs/contract";
import type { DatabaseConnection } from "@/lib/db/client";

import type { StudentContext } from "./orchestrator-context";
import { AgentEffectSchema, type AgentEffect } from "./action-policy";
import { CapabilityOwnerSchema } from "./capability-registry";
import type { ExternalWebResearchRunner } from "./external-web-research";
import type {
  AgentEvidenceSearchPortV2,
} from "./evidence-tool-v2";

const CoursePackRefSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  version: z.string().regex(/^\d+$/),
}).strict();

export const AgentToolAccessSchema = z.enum([
  "READ_ONLY",
  "STUDENT_CONFIRMATION",
  "FORBIDDEN",
]);

export type AgentToolAccess = z.infer<typeof AgentToolAccessSchema>;

export class AgentToolExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly safeSummary: string,
  ) {
    super(code);
    this.name = "AgentToolExecutionError";
  }
}

export function agentToolAccessForEffect(effect: AgentEffect): AgentToolAccess {
  if (effect === "READ_CONTEXT") return "READ_ONLY";
  if (effect === "SUBMIT_EVALUATION" || effect === "FORMAL_AUTHORITY") return "FORBIDDEN";
  return "STUDENT_CONFIRMATION";
}

export const AgentToolDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9.-]{2,79}$/),
  version: z.string().regex(/^[1-9][0-9]{0,7}$/),
  adapterId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  owner: CapabilityOwnerSchema,
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(300),
  inputHint: z.string().trim().min(1).max(300),
  effect: AgentEffectSchema,
  access: AgentToolAccessSchema,
  timeoutMs: z.number().int().min(100).max(60_000),
  recommendedByCoursePacks: z.array(CoursePackRefSchema).min(1).max(11),
}).strict().superRefine((descriptor, context) => {
  const expected = agentToolAccessForEffect(descriptor.effect);
  if (descriptor.access !== expected) {
    context.addIssue({
      code: "custom",
      path: ["access"],
      message: `${descriptor.effect} tools must declare ${expected} access`,
    });
  }
});

export const AgentToolCallRequestSchema = z.object({
  toolId: z.string().regex(/^[a-z][a-z0-9.-]{2,79}$/),
  arguments: z.record(z.string(), z.json()),
}).strict().superRefine((call, context) => {
  if (Object.keys(call.arguments).length > 8) {
    context.addIssue({ code: "custom", path: ["arguments"], message: "too many tool arguments" });
  }
  if (JSON.stringify(call.arguments).length > 4_000) {
    context.addIssue({ code: "custom", path: ["arguments"], message: "tool arguments too large" });
  }
});

export const AgentToolObservationSchema = z.object({
  callId: z.string().uuid(),
  toolId: z.string(),
  toolVersion: z.string(),
  adapterId: z.string(),
  status: z.enum(["SUCCESS", "EMPTY", "ERROR"]),
  summary: z.string().trim().min(1).max(300),
  facts: z.array(z.string().trim().min(1).max(300)).max(12),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/).nullable(),
  latencyMs: z.number().int().min(0).max(60_000),
}).strict();

export type AgentToolDescriptor = z.infer<typeof AgentToolDescriptorSchema>;
export type AgentToolCallRequest = z.infer<typeof AgentToolCallRequestSchema>;
export type AgentToolObservation = z.infer<typeof AgentToolObservationSchema>;

export type AgentToolContext = {
  connection: DatabaseConnection;
  actor: SessionPayload;
  pack: CoursePack;
  student: StudentContext;
  question: string;
  embeddingProvider?: EmbeddingProvider | null;
  externalWebResearch?: ExternalWebResearchRunner;
  evidenceSearchV2?: AgentEvidenceSearchPortV2;
  signal: AbortSignal;
};

export type AgentToolDefinition = {
  descriptor: AgentToolDescriptor;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  strictInputSchema?: boolean;
  execute: (context: AgentToolContext, input: unknown) => unknown | Promise<unknown>;
  summarize: (output: unknown) => { summary: string; facts: string[]; empty: boolean };
};

export type AgentToolExecution = {
  call: AgentToolCallRequest;
  observation: AgentToolObservation;
  output: z.infer<typeof z.json> | null;
};
