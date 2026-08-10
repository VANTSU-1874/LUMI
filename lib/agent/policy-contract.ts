import { z } from "zod";

export const AgentPolicyRuleSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  description: z.string().trim().min(1).max(240),
  effect: z.enum(["ENFORCE", "NORMALIZE", "ESCALATE"]),
}).strict();

export const AgentPolicySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  version: z.string().regex(/^[1-9][0-9]{0,7}$/),
  label: z.string().trim().min(1).max(100),
  budgets: z.object({
    maxModelDecisions: z.number().int().min(1).max(8),
    maxToolCalls: z.number().int().min(1).max(12),
    turnTimeoutMs: z.number().int().min(5_000).max(900_000),
    modelIdleTimeoutMs: z.number().int().min(1_000).max(600_000),
    modelTimeoutMs: z.number().int().min(1_000).max(600_000),
    actionTtlMs: z.number().int().min(60_000).max(3_600_000),
    maxSources: z.number().int().min(1).max(8),
    maxActions: z.number().int().min(1).max(4),
    maxRecentTurns: z.number().int().min(1).max(30),
  }).strict(),
  autonomy: z.object({
    readOnlyTools: z.literal("AUTOMATIC"),
    studentMutations: z.literal("STUDENT_CONFIRMATION"),
    formalAuthority: z.literal("FORBIDDEN"),
  }).strict(),
  rules: z.array(AgentPolicyRuleSchema).min(1).max(20),
}).strict().superRefine((policy, context) => {
  const ids = policy.rules.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "policy rule ids must be unique" });
  if (policy.budgets.modelIdleTimeoutMs >= policy.budgets.modelTimeoutMs) {
    context.addIssue({ code: "custom", message: "model idle timeout must be lower than model total timeout" });
  }
  if (policy.budgets.modelTimeoutMs >= policy.budgets.turnTimeoutMs) {
    context.addIssue({ code: "custom", message: "model timeout must be lower than turn timeout" });
  }
});

export type AgentPolicy = z.infer<typeof AgentPolicySchema>;
