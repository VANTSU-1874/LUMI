import { z } from "zod";

export const LogicCardResponseSchema = z
  .object({
    projectId: z.string().min(1),
    revision: z.number().int().positive(),
    cardHash: z.string().regex(/^[a-f0-9]{64}$/),
    ruleReady: z.boolean(),
    semanticReady: z.boolean(),
    status: z.enum(["APPROVED", "NEEDS_REVISION", "PENDING"]),
    source: z.string().trim().min(1).max(64),
    issues: z.array(z.string().trim().min(1).max(200)).max(10),
    stage: z.enum(["LOGIC_CARD", "TOOL_PATH"]),
  })
  .strict()
  .superRefine((value, context) => {
    const approved = value.status === "APPROVED";
    const unlocked = value.ruleReady && value.semanticReady && value.stage === "TOOL_PATH";
    if (approved !== unlocked) {
      context.addIssue({
        code: "custom",
        message: "逻辑审查状态与项目阶段不一致",
      });
    }
    if (!approved && (value.semanticReady || value.stage !== "LOGIC_CARD")) {
      context.addIssue({
        code: "custom",
        message: "未批准的逻辑卡不能解锁",
      });
    }
  });

export type LogicCardResponse = z.infer<typeof LogicCardResponseSchema>;
