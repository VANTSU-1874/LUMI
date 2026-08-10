import { z } from "zod";

export const ToolAdapterTargetSchema = z.enum([
  "NODE_CANVAS",
  "CASE_LIBRARY",
  "KNOWLEDGE_MAP",
  "PROJECT",
  "BOOK_LAYOUT_LAB",
  "LAYOUT_GRID_LAB",
  "GENERATIVE_LAB",
]);

export type ToolAdapterTarget = z.infer<typeof ToolAdapterTargetSchema>;

export const ToolAdapterDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  label: z.string().trim().min(1).max(80),
  target: ToolAdapterTargetSchema,
  capabilities: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).min(1).max(20),
}).strict();

export type ToolAdapterDescriptor = z.infer<typeof ToolAdapterDescriptorSchema>;
