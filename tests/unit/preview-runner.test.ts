// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getActiveAgentPolicy } from "@/lib/agent/policy-registry";
import type { ModelProviderAdapter } from "@/lib/agent/model-provider-adapter";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  PreviewMessageDeltaDecoder,
  PreviewModelUnavailableError,
  runPreviewScenario,
} from "@/lib/preview/preview-runner";
import { getPreviewSuggestion, listPreviewScenarios } from "@/lib/preview/scenarios";

describe("evaluator preview runner", () => {
  let root: string;
  let databasePath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "lumi-preview-runner-"));
    databasePath = path.join(root, "preview.sqlite");
    runMigrations(databasePath);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("registers five distinct evaluation themes and resolves every fixed branch", () => {
    const sessionId = "preview-session-for-random-cover";
    const scenarios = listPreviewScenarios(sessionId);
    expect(scenarios.map(({ id }) => id)).toEqual([
      "S1_DIGITAL_PRODUCT",
      "S2_COURSE_DESIGN",
      "S3_DESIGN_KNOWLEDGE",
      "S4_PORTFOLIO_DIRECTION",
      "S5_LEARNING_EVIDENCE",
    ]);
    expect(new Set(scenarios.map(({ coursePackId, focus }) => `${coursePackId}:${focus}`)).size).toBe(5);
    for (const scenario of scenarios) {
      expect(scenario.suggestions).toHaveLength(4);
      const initial = getPreviewSuggestion(scenario.id, scenario.initial.id, sessionId);
      expect(initial.scenario).toMatchObject({ id: scenario.id });
      expect(initial.suggestion.prompt).toBeTruthy();
      for (const suggestion of scenario.suggestions) {
        const resolved = getPreviewSuggestion(scenario.id, suggestion.id, sessionId);
        expect(resolved.scenario).toMatchObject({ id: scenario.id });
        expect(resolved.suggestion.outcome.description).toBeTruthy();
        expect(resolved.suggestion.prompt).toBeTruthy();
      }
    }
    const coverScenario = scenarios.find(({ id }) => id === "S3_DESIGN_KNOWLEDGE")!;
    expect(coverScenario.title).toBe("封面版式设计分析");
    expect(coverScenario.initial.attachments).toHaveLength(1);
    expect(getPreviewSuggestion("S3_DESIGN_KNOWLEDGE", "S3_KNOWLEDGE_START", sessionId).suggestion.attachments)
      .toEqual(coverScenario.initial.attachments);
    const posterScenario = scenarios.find(({ id }) => id === "S5_LEARNING_EVIDENCE")!;
    expect(posterScenario.title).toBe("海报风格融合设计");
    expect(posterScenario.initial.attachments).toHaveLength(3);
  });

  it("streams the validated learner-facing message without exposing model JSON", async () => {
    const connection = createDb(databasePath);
    const decoder = new PreviewMessageDeltaDecoder();
    const visible: string[] = [];
    const raw = JSON.stringify({
      step: "ANSWER",
      episode: "DEBUG",
      decisionCode: "DEBUG_TRACE_SIGNAL",
      responseStrategy: "DIRECT_INSTRUCTION",
      sourceIds: [],
      actionType: null,
      title: "先确认参与动作",
      message: "先把靠近写成观众能完成的动作，再让一位同学不听讲解地试一次。有两种可选方向：①靠近后立即显影；②先出现轮廓再完整显影。",
      whyThisStep: "参与动作和反馈必须同时成立，互动意图才会被观众读到。",
      uncertainty: "通用设计建议：尚未看到草图与现场交互。",
      briefPatch: {},
    });
    const adapter: ModelProviderAdapter = {
      provider: "TEST",
      capabilities: { vision: false },
      async complete(_messages, options) {
        options?.onTextDelta?.(raw.slice(0, 88));
        options?.onTextDelta?.(raw.slice(88));
        return raw;
      },
    };
    try {
      const response = await runPreviewScenario({
        connection,
        ...getPreviewSuggestion("S1_DIGITAL_PRODUCT", "S1_PRODUCT_FEEDBACK"),
        ai: undefined,
        modelProviderAdapter: adapter,
        policy: getActiveAgentPolicy(),
        onModelJsonDelta(delta) {
          const messageDelta = decoder.push(delta);
          if (messageDelta) visible.push(messageDelta);
        },
      });
      expect(response.message).toBe("先把靠近写成观众能完成的动作，再让一位同学不听讲解地试一次。有两种可选方向：①靠近后立即显影；②先出现轮廓再完整显影。");
      expect(visible.join("")).toBe(response.message);
      expect(visible.join("")).not.toContain('"message"');
      expect(response.branch).toMatchObject({
        directionId: "S1_DIGITAL_PRODUCT",
        suggestionId: "S1_PRODUCT_FEEDBACK",
        outcome: { code: "NEXT_STEP" },
      });
    } finally {
      connection.sqlite.close();
    }
  });

  it("sends all three poster references to the vision model for the fusion-design first question", async () => {
    const connection = createDb(databasePath);
    const raw = JSON.stringify({
      step: "ANSWER",
      episode: "EXPLORE",
      decisionCode: "EXPLORE_CLARIFY_GOAL",
      responseStrategy: "DIRECT_INSTRUCTION",
      sourceIds: [],
      actionType: null,
      title: "先确定融合主线",
      message: "先选定一种信息秩序作为主线，再把其余两张图的色彩或图形语言控制在辅助位置。",
      whyThisStep: "多张参考图先建立优先级，才能避免视觉元素平均叠加。",
      uncertainty: "通用设计建议：尚未看到你的活动主题和最终信息内容。",
      briefPatch: {},
    });
    let receivedImages: Array<{ mimeType: string; bytes: Uint8Array }> = [];
    const adapter: ModelProviderAdapter = {
      provider: "TEST",
      capabilities: { vision: true },
      async complete() { throw new Error("text completion should not be used for poster references"); },
      async completeWithImages(_messages, images) {
        receivedImages = images;
        return raw;
      },
    };
    try {
      const response = await runPreviewScenario({
        connection,
        ...getPreviewSuggestion("S5_LEARNING_EVIDENCE", "S5_EVIDENCE_START", "poster-reference-session"),
        ai: undefined,
        modelProviderAdapter: adapter,
        policy: getActiveAgentPolicy(),
      });
      expect(receivedImages).toHaveLength(3);
      expect(receivedImages.map(({ mimeType }) => mimeType)).toEqual(["image/png", "image/png", "image/png"]);
      expect(receivedImages.every(({ bytes }) => bytes.byteLength > 0)).toBe(true);
      expect(response.branch.directionTitle).toBe("海报风格融合设计");
    } finally {
      connection.sqlite.close();
    }
  });

  it("classifies a missing multi-image capability before the model request", async () => {
    const connection = createDb(databasePath);
    const adapter: ModelProviderAdapter = {
      provider: "TEST",
      capabilities: { vision: false },
      async complete() { throw new Error("text completion must not run for poster references"); },
    };
    try {
      await expect(runPreviewScenario({
        connection,
        ...getPreviewSuggestion("S5_LEARNING_EVIDENCE", "S5_EVIDENCE_START", "poster-diagnostic-session"),
        ai: undefined,
        modelProviderAdapter: adapter,
        policy: getActiveAgentPolicy(),
      })).rejects.toMatchObject({
        name: PreviewModelUnavailableError.name,
        code: "PREVIEW_VISION_UNAVAILABLE",
        stage: "MODEL_SETUP",
        retryable: false,
      });
    } finally {
      connection.sqlite.close();
    }
  });
});
