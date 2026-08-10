import { z } from "zod";

import { HANDWRITTEN_TITLE_STYLES, buildHandwrittenTitlePrompts } from "@/lib/agent/skills/handwritten-title-styles";

import type { AgentToolDefinition } from "../tool-contract";
import { getCapability } from "../capability-registry";

const HandwrittenTitleInputSchema = z.object({
  title: z.string().trim().min(1).max(24),
  background: z.enum(["WHITE", "BLACK"]).default("WHITE"),
}).strict();

const HandwrittenTitleOutputSchema = z.object({
  title: z.string(),
  background: z.enum(["WHITE", "BLACK"]),
  styleCount: z.number().int().min(1).max(20),
  styles: z.array(z.object({
    styleId: z.string(),
    label: z.string(),
    prompt: z.string(),
  }).strict()).max(20),
}).strict();

export const handwrittenTitlePromptsTool = {
  descriptor: {
    id: "handwritten-title.build-prompts",
    version: "1",
    adapterId: "handwritten-title",
    owner: getCapability("handwritten-title"),
    label: "生成手写标题字的设计提示词",
    description: "按给定标题产出多种手写标题字风格的图像生成提示词，供学生自行出图与对比。",
    inputHint: "arguments 形如 {\"title\":\"驼铃声响\",\"background\":\"WHITE\"}；background 可省略。",
    effect: "READ_CONTEXT",
    access: "READ_ONLY",
    timeoutMs: 2_000,
    recommendedByCoursePacks: [
      { id: "layout-design", version: "1" },
      { id: "general-design", version: "1" },
      { id: "brand-vi-design", version: "1" },
    ],
  },
  inputSchema: HandwrittenTitleInputSchema,
  outputSchema: HandwrittenTitleOutputSchema,
  strictInputSchema: true,
  execute(_context, rawInput) {
    const input = HandwrittenTitleInputSchema.parse(rawInput);
    const styles = buildHandwrittenTitlePrompts(input.title, input.background);
    return {
      title: input.title,
      background: input.background,
      styleCount: styles.length,
      styles,
    };
  },
  summarize(rawOutput) {
    const output = HandwrittenTitleOutputSchema.parse(rawOutput);
    return {
      summary: `已按「${output.title}」产出 ${output.styleCount} 种手写标题字风格提示词（${output.background === "WHITE" ? "白底" : "黑底"}）。`,
      facts: [
        ...output.styles.slice(0, 11).map(({ label }) => label),
        "提示词只是起点：让学生先说清标题的语气与使用场景，再挑 2–3 种去试，不要 11 种全试。",
      ].slice(0, 12),
      empty: output.styleCount === 0,
    };
  },
} satisfies AgentToolDefinition;

export const HANDWRITTEN_TITLE_STYLE_COUNT = HANDWRITTEN_TITLE_STYLES.length;
