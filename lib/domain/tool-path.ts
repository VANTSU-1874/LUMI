import { z } from "zod";

import { ToolPathSchema } from "@/lib/domain/schemas";
import { DataTypeSchema } from "@/lib/domain/data-provenance";

export const ToolPathRequirementsSchema = z.object({
  needsRealtimeVisuals: z.boolean(),
  needsPhysicalControl: z.boolean(),
  hasOsc: z.boolean(),
}).strict();

export const ToolPathReasonArraySchema = z
  .array(z.string().trim().min(1).max(300))
  .min(1)
  .max(10);

export const ToolPathMilestoneSchema = z.object({
  id: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  requiredEvidenceLabel: z.string().trim().min(1).max(200),
}).strict();

export const ToolPathMilestoneArraySchema = z.array(ToolPathMilestoneSchema).min(3).max(10);

export const AllowedToolPathsSchema = z
  .array(ToolPathSchema)
  .min(1)
  .max(3)
  .superRefine((items, context) => {
    if (new Set(items).size !== items.length) {
      context.addIssue({ code: "custom", message: "允许工具路径不能重复" });
    }
  });

export const ToolPathPlanRecordSchema = z.object({
  projectId: z.string().min(1),
  path: ToolPathSchema,
  requirementsJson: ToolPathRequirementsSchema,
  reasonsJson: ToolPathReasonArraySchema,
  milestonesJson: ToolPathMilestoneArraySchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  dataType: DataTypeSchema.default("REAL"),
}).strict();

export const ToolPathPlanResponseSchema = z.object({
  plan: z.object({
    projectId: z.string().min(1),
    path: ToolPathSchema,
    requirements: ToolPathRequirementsSchema,
    reasons: ToolPathReasonArraySchema,
    milestones: ToolPathMilestoneArraySchema,
    stage: z.literal("BUILD"),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    dataType: DataTypeSchema.default("REAL"),
  }).strict(),
}).strict();

export type ToolPathRequirements = z.infer<typeof ToolPathRequirementsSchema>;
export type ToolPathMilestone = z.infer<typeof ToolPathMilestoneSchema>;
export type ToolPathPlanRecord = z.infer<typeof ToolPathPlanRecordSchema>;
