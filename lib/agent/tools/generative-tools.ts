import {
  GenerativeBuildRequestResponseSchema,
  GenerativeBuildRequestSchema,
} from "@/lib/domain/generative-tool";
import { GENERATIVE_TOOL_KIND_LABELS } from "@/lib/agent/skills/generative-tool-spec";
import { requestGenerativeBuild } from "@/lib/services/generative-tool";

import type { AgentToolDefinition } from "../tool-contract";
import { getCapability } from "../capability-registry";

export const generativeStartBuildTool = {
  descriptor: {
    id: "generative-tool.start-build",
    version: "1",
    adapterId: "generative-lab",
    owner: getCapability("generative-tool"),
    label: "发起现场生成器构建",
    description: "记录学生已确认的生成器类型与要求，供视觉生成器实验台继续构建；工具本身不等待模型生成。",
    inputHint: "arguments 形如 {\"kind\":\"DOT_MATRIX\",\"brief\":\"做一个可调密度与点大小的点阵实验\"}。",
    effect: "CHANGE_TOOL_STATE",
    access: "STUDENT_CONFIRMATION",
    timeoutMs: 2_000,
    recommendedByCoursePacks: [
      { id: "general-design", version: "1" },
      { id: "digital-interaction", version: "1" },
      { id: "book-design", version: "1" },
      { id: "layout-design", version: "1" },
      { id: "brand-vi-design", version: "1" },
    ],
  },
  inputSchema: GenerativeBuildRequestSchema,
  outputSchema: GenerativeBuildRequestResponseSchema,
  strictInputSchema: true,
  execute(context, rawInput) {
    const input = GenerativeBuildRequestSchema.parse(rawInput);
    return requestGenerativeBuild(context.connection, context.actor, input);
  },
  summarize(rawOutput) {
    const output = GenerativeBuildRequestResponseSchema.parse(rawOutput);
    return {
      summary: `已记录${GENERATIVE_TOOL_KIND_LABELS[output.kind]}生成器请求，打开视觉生成器实验台即可继续构建。`,
      facts: [
        `请求编号：${output.id}`,
        `类型：${GENERATIVE_TOOL_KIND_LABELS[output.kind]}`,
        `要求：${output.brief}`,
        "这里只记录请求并秒回；HTML 生成与安全校验在实验台的受限 POST 中完成。",
      ],
      empty: false,
    };
  },
} satisfies AgentToolDefinition;
