import { z } from "zod";

import { readLayoutGridWorkspace } from "@/lib/services/layout-grid";

import type { AgentToolDefinition } from "../tool-contract";
import { getCapability } from "../capability-registry";

const EmptyInputSchema = z.object({}).strict();

const LayoutGridStateOutputSchema = z.object({
  exists: z.boolean(),
  grid: z.object({ columns: z.number().int(), rows: z.number().int() }).strict().nullable(),
  blockCount: z.number().int().min(0).max(12),
  roles: z.array(z.string()).max(4),
  latestEvidence: z.object({
    score: z.number().int().min(0).max(4),
    criteria: z.array(z.object({ label: z.string(), passed: z.boolean(), note: z.string() }).strict()).length(4),
  }).strict().nullable(),
}).strict();

export const layoutGridStateTool = {
  descriptor: {
    id: "layout-grid-lab.read-state",
    version: "1",
    adapterId: "layout-grid-lab",
    owner: getCapability("layout-design"),
    label: "读取栅格设置与网格验证状态",
    description: "读取当前栏行设置、已放置的文字块角色，以及最近一次网格验证的四条判据。",
    inputHint: "不需要参数，arguments 必须是空对象。",
    effect: "READ_CONTEXT",
    access: "READ_ONLY",
    timeoutMs: 2_000,
    recommendedByCoursePacks: [{ id: "layout-design", version: "1" }],
  },
  inputSchema: EmptyInputSchema,
  outputSchema: LayoutGridStateOutputSchema,
  execute(context) {
    const workspace = readLayoutGridWorkspace(context.connection, context.actor);
    const active = workspace.resume ?? workspace.latest;
    return {
      exists: active !== null,
      grid: active ? { columns: active.config.columns, rows: active.config.rows } : null,
      blockCount: active?.blocks.length ?? 0,
      roles: [...new Set(active?.blocks.map(({ role }) => role) ?? [])],
      latestEvidence: workspace.latest
        ? {
          score: workspace.latest.score,
          criteria: workspace.latest.criteria.map(({ label, passed, note }) => ({ label, passed, note })),
        }
        : null,
    };
  },
  summarize(rawOutput) {
    const output = LayoutGridStateOutputSchema.parse(rawOutput);
    if (!output.exists) return { summary: "当前没有可恢复的排版栅格。", facts: ["栅格草稿与验证证据均为空"], empty: true };
    const failed = output.latestEvidence?.criteria.filter(({ passed }) => !passed) ?? [];
    return {
      summary: `当前栅格 ${output.grid?.columns ?? "?"} 栏 × ${output.grid?.rows ?? "?"} 行，已放置 ${output.blockCount} 块文字。`,
      facts: [
        `文字角色：${output.roles.join("、") || "暂无"}`,
        output.latestEvidence
          ? `最近验证：${output.latestEvidence.score}/4，未通过项：${failed.map(({ label }) => label).join("、") || "无"}`
          : "尚未运行网格验证",
        ...failed.map(({ label, note }) => `${label} — ${note}`),
      ].slice(0, 12),
      empty: false,
    };
  },
} satisfies AgentToolDefinition;
