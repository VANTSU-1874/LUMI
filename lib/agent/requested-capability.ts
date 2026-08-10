import { z } from "zod";

export const AgentRequestedCapabilityIdSchema = z.enum([
  "five-dimension",
  "course-reference",
  "book-design",
  "process-record",
  "evidence-troubleshooting",
  "touchdesigner-cases",
  "public-research",
  "design-calculation",
  "skill-installer",
  "skill-creator",
]);

export const AgentRequestedCapabilitySchema = z.object({
  id: AgentRequestedCapabilityIdSchema,
  source: z.literal("composer"),
}).strict();

export type AgentRequestedCapabilityId = z.infer<typeof AgentRequestedCapabilityIdSchema>;
export type AgentRequestedCapability = z.infer<typeof AgentRequestedCapabilitySchema>;
