import { z } from "zod";

import { DesignTaskSchema } from "./design-project-task-contract";

export const StudentProjectIconSchema = z.enum(["folder", "book", "palette", "sparkles", "graduation-cap", "presentation"]);
export const StudentProjectColorSchema = z.enum(["emerald", "blue", "violet", "amber", "rose", "slate"]);
export const StudentProjectStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);

export const StudentProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  icon: StudentProjectIconSchema,
  color: StudentProjectColorSchema,
  instructions: z.string().max(6000),
  memoryMode: z.literal("PROJECT_ONLY"),
  status: StudentProjectStatusSchema,
  threadCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const StudentProjectListSchema = z.object({ projects: z.array(StudentProjectSchema).max(100) }).strict();
export const StudentProjectDetailSchema = z.object({
  project: StudentProjectSchema,
  threads: z.array(DesignTaskSchema).max(100),
}).strict();

export const StudentProjectCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  icon: StudentProjectIconSchema.default("folder"),
  color: StudentProjectColorSchema.default("emerald"),
  instructions: z.string().trim().max(6000).default(""),
  initialTaskId: z.string().uuid().optional(),
}).strict();

export const StudentProjectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  icon: StudentProjectIconSchema.optional(),
  color: StudentProjectColorSchema.optional(),
  instructions: z.string().trim().max(6000).optional(),
  status: StudentProjectStatusSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "至少修改一项项目信息");

export const StudentProjectThreadMoveSchema = z.object({ taskId: z.string().uuid() }).strict();

export type StudentProject = z.infer<typeof StudentProjectSchema>;
export type StudentProjectDetail = z.infer<typeof StudentProjectDetailSchema>;
