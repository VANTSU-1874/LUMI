import { z } from "zod";

import { readBookLayoutWorkspace } from "@/lib/services/book-layout";

import type { AgentToolDefinition } from "../tool-contract";
import { getCapability } from "../capability-registry";

const EmptyInputSchema = z.object({}).strict();
const BookStateOutputSchema = z.object({
  exists: z.boolean(),
  audience: z.enum(["NEW_STUDENTS", "COMMUNITY_RESIDENTS"]).nullable(),
  pageOrder: z.array(z.string()).max(8),
  diagnosticCompleted: z.number().int().min(0).max(3),
  transferChoices: z.array(z.string()).max(3),
  latestEvidence: z.object({
    score: z.number().int().min(0).max(4),
    criteria: z.array(z.object({ label: z.string(), passed: z.boolean(), note: z.string() }).strict()).length(4),
  }).strict().nullable(),
}).strict();

export const bookLayoutStateTool = {
  descriptor: {
    id: "book-layout-lab.read-state",
    version: "1",
    adapterId: "book-layout-lab",
    owner: getCapability("book-design"),
    label: "读取8页编排与受众迁移状态",
    description: "读取当前受众、八页顺序、诊断完成度、迁移选择和最近一次版面证据。",
    inputHint: "不需要参数，arguments 必须是空对象。",
    effect: "READ_CONTEXT",
    access: "READ_ONLY",
    timeoutMs: 2_000,
    recommendedByCoursePacks: [{ id: "book-design", version: "1" }],
  },
  inputSchema: EmptyInputSchema,
  outputSchema: BookStateOutputSchema,
  execute(context) {
    const workspace = readBookLayoutWorkspace(context.connection, context.actor);
    const active = workspace.resume ?? workspace.latest;
    return {
      exists: active !== null,
      audience: active?.audience ?? null,
      pageOrder: active?.pageOrder ?? [],
      diagnosticCompleted: active?.diagnosticAnswers.filter(Boolean).length ?? 0,
      transferChoices: active?.transferChoices ?? [],
      latestEvidence: workspace.latest ? {
        score: workspace.latest.score,
        criteria: workspace.latest.criteria.map(({ label, passed, note }) => ({ label, passed, note })),
      } : null,
    };
  },
  summarize(rawOutput) {
    const output = BookStateOutputSchema.parse(rawOutput);
    if (!output.exists) return { summary: "当前没有可恢复的书籍编排。", facts: ["编排草稿与正式证据均为空"], empty: true };
    return {
      summary: `当前面向${output.audience === "COMMUNITY_RESIDENTS" ? "社区居民" : "新生"}，诊断完成 ${output.diagnosticCompleted}/3。`,
      facts: [
        `八页顺序：${output.pageOrder.join(" → ")}`,
        `迁移选择：${output.transferChoices.join("、") || "暂无"}`,
        output.latestEvidence
          ? `最近证据：${output.latestEvidence.score}/4，未通过项：${output.latestEvidence.criteria.filter(({ passed }) => !passed).map(({ label }) => label).join("、") || "无"}`
          : "尚未提交正式版面证据",
      ],
      empty: false,
    };
  },
} satisfies AgentToolDefinition;
