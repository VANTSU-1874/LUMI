import { z } from "zod";

export const DesignTaskStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export const DesignTaskModeSchema = z.enum(["conversation", "engineering"]);

export const DesignTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(80),
  status: DesignTaskStatusSchema,
  mode: DesignTaskModeSchema,
  pinned: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const DesignTaskListResponseSchema = z.object({
  tasks: z.array(DesignTaskSchema).max(50),
}).strict();

export const DesignTaskCreateRequestSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  mode: DesignTaskModeSchema.optional(),
}).strict();

export const DesignTaskUpdateRequestSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  status: DesignTaskStatusSchema.optional(),
  mode: DesignTaskModeSchema.optional(),
  pinned: z.boolean().optional(),
}).strict().refine((value) => Object.values(value).some((item) => item !== undefined), {
  message: "至少修改一项任务信息",
});

export type DesignTask = z.infer<typeof DesignTaskSchema>;
export type DesignTaskMode = z.infer<typeof DesignTaskModeSchema>;
