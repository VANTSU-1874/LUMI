import { z } from "zod";

import { GENERATIVE_TOOL_KINDS } from "@/lib/agent/skills/generative-tool-spec";

export const GenerativeToolKindSchema = z.enum(GENERATIVE_TOOL_KINDS);

export const GenerativeBuildRequestSchema = z.object({
  kind: GenerativeToolKindSchema,
  brief: z.string().trim().min(1).max(600),
}).strict();

export const GenerativeBuildCommandSchema = GenerativeBuildRequestSchema.extend({
  requestId: z.string().uuid().optional(),
}).strict();

const DataTypeSchema = z.enum(["REAL", "DEMONSTRATION_DATA"]);

export const GenerativeBuildRequestResponseSchema = GenerativeBuildRequestSchema.extend({
  id: z.string().uuid(),
  status: z.literal("REQUESTED"),
  createdAt: z.string().datetime(),
  dataType: DataTypeSchema,
}).strict();

export const GenerativeArtifactValidationSchema = z.object({
  safe: z.literal(true),
  violations: z.array(z.never()).max(0),
}).strict();

export const GenerativeArtifactSchema = GenerativeBuildRequestSchema.extend({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  html: z.string().min(1).max(512 * 1_024),
  validation: GenerativeArtifactValidationSchema,
  createdAt: z.string().datetime(),
  dataType: DataTypeSchema,
}).strict();

export const GenerativeWorkspaceResponseSchema = z.object({
  status: z.enum(["EMPTY", "REQUESTED", "READY"]),
  request: GenerativeBuildRequestResponseSchema.nullable(),
  artifact: GenerativeArtifactSchema.nullable(),
}).strict().superRefine((workspace, context) => {
  if (workspace.status === "EMPTY" && (workspace.request !== null || workspace.artifact !== null)) {
    context.addIssue({ code: "custom", message: "empty workspace cannot contain a request or artifact" });
  }
  if (workspace.status === "REQUESTED" && (workspace.request === null || workspace.artifact !== null)) {
    context.addIssue({ code: "custom", message: "requested workspace must contain only a request" });
  }
  if (
    workspace.status === "READY"
    && (
      workspace.request === null
      || workspace.artifact === null
      || workspace.artifact.requestId !== workspace.request.id
    )
  ) {
    context.addIssue({ code: "custom", message: "ready workspace must contain a matching request and artifact" });
  }
});

export const GenerativeResetCommandSchema = z.object({ reset: z.literal(true) }).strict();

export const GenerativeResetResponseSchema = z.object({
  reset: z.literal(true),
  workspace: GenerativeWorkspaceResponseSchema,
}).strict();

export type GenerativeToolKind = z.infer<typeof GenerativeToolKindSchema>;
export type GenerativeBuildRequest = z.infer<typeof GenerativeBuildRequestSchema>;
export type GenerativeBuildCommand = z.infer<typeof GenerativeBuildCommandSchema>;
export type GenerativeBuildRequestResponse = z.infer<typeof GenerativeBuildRequestResponseSchema>;
export type GenerativeArtifact = z.infer<typeof GenerativeArtifactSchema>;
export type GenerativeWorkspaceResponse = z.infer<typeof GenerativeWorkspaceResponseSchema>;
