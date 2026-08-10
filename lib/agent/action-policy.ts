import { z } from "zod";

import type { AgentPolicy } from "./policy-contract";

export const AgentEffectSchema = z.enum([
  "READ_CONTEXT",
  "NAVIGATE",
  "WRITE_PROJECT",
  "CHANGE_TOOL_STATE",
  "EXTERNAL_CALL",
  "SUBMIT_EVALUATION",
  "FORMAL_AUTHORITY",
]);

export const ActionPolicyDecisionSchema = z.object({
  mode: z.enum(["AUTOMATIC", "REQUIRES_CONFIRMATION", "FORBIDDEN"]),
  reason: z.string().min(1).max(240),
}).strict();

export type AgentEffect = z.infer<typeof AgentEffectSchema>;
export type ActionPolicyDecision = z.infer<typeof ActionPolicyDecisionSchema>;

export function decideActionPolicy(effect: AgentEffect, policy: AgentPolicy): ActionPolicyDecision {
  if (effect === "SUBMIT_EVALUATION" || effect === "FORMAL_AUTHORITY") {
    return ActionPolicyDecisionSchema.parse({
      mode: "FORBIDDEN",
      reason: effect === "SUBMIT_EVALUATION"
        ? "正式成果提交和评价状态变更不能由 Agent 代替学生完成。"
        : "评分、过关和教师复核不能由 Agent 完成。",
    });
  }
  if (effect === "READ_CONTEXT") {
    return ActionPolicyDecisionSchema.parse({
      mode: policy.autonomy.readOnlyTools === "AUTOMATIC" ? "AUTOMATIC" : "FORBIDDEN",
      reason: "只读工具可自动读取，但不得改变学生项目或软件状态。",
    });
  }
  return ActionPolicyDecisionSchema.parse({
    mode: "REQUIRES_CONFIRMATION",
    reason: effect === "NAVIGATE"
      ? "打开工具或进入下一学习情境前由学生确认。"
      : effect === "EXTERNAL_CALL"
        ? "向外部服务发送请求前必须由学生确认。"
        : "写入项目或修改软件状态前必须由学生确认。",
  });
}
