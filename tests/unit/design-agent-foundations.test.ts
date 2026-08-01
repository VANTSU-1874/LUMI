import { describe, expect, it } from "vitest";

import { decideActionPolicy } from "@/lib/agent/action-policy";
import { buildDesignAgentSystemPrompt } from "@/lib/agent/design-agent-prompt";
import { routeDesignSpecialty } from "@/lib/agent/specialty-router";
import { selectAgentToolsForTurn } from "@/lib/agent/tool-registry";
import { getCoursePack } from "@/lib/course-packs/registry";
import { getActiveAgentPolicy } from "@/lib/agent/policy-registry";
import { actionForType, inferLearningEpisode } from "@/lib/agent/router";

describe("Design Agent foundations", () => {
  it("defaults ordinary design requests to general design and only adds specialties when useful", () => {
    expect(routeDesignSpecialty("我想做一张酷一点的海报", "AGENT")).toMatchObject({
      specialty: "GENERAL_DESIGN",
      coursePackId: "general-design",
      enhanced: false,
    });
    expect(routeDesignSpecialty("声音有数值但画面不动", "AGENT")).toMatchObject({
      specialty: "DIGITAL_INTERACTION",
      enhanced: true,
    });
    expect(routeDesignSpecialty("这本导览册的阅读路径不清楚", "AGENT")).toMatchObject({
      specialty: "BOOK_DESIGN",
      enhanced: true,
    });
    expect(routeDesignSpecialty("输入、映射和输出到底是什么关系？", "AGENT")).toMatchObject({
      specialty: "DIGITAL_INTERACTION",
      enhanced: true,
    });
    expect(routeDesignSpecialty("我想做一个挥手后出现故事的互动作品", "AGENT")).toMatchObject({
      specialty: "DIGITAL_INTERACTION",
      enhanced: true,
    });
    expect(routeDesignSpecialty("公益海报的信息层级和阅读路径不清楚", "AGENT")).toMatchObject({
      specialty: "GENERAL_DESIGN",
      enhanced: false,
    });
  });

  it.each([
    ["请点评这张数字交互作品", "DIGITAL_INTERACTION", "digital-interaction"],
    ["请点评这张数字交互文创作品", "DIGITAL_INTERACTION", "digital-interaction"],
    ["请点评这张版式设计作品", "BOOK_DESIGN", "book-design"],
    ["请点评这张书籍设计作品", "BOOK_DESIGN", "book-design"],
  ] as const)("routes canonical course wording: %s", (message, specialty, coursePackId) => {
    expect(routeDesignSpecialty(message, "AGENT")).toMatchObject({
      specialty,
      coursePackId,
      enhanced: true,
      reason: "MESSAGE_MATCH",
    });
  });

  it("inherits the current task specialty without treating shared learning spaces as digital-only", () => {
    expect(routeDesignSpecialty("我怎么解释为什么把报名方式放在活动介绍后面？", "EVIDENCE", "book-design"))
      .toMatchObject({ specialty: "BOOK_DESIGN", reason: "INTERFACE_CONTEXT" });
    expect(routeDesignSpecialty("帮我梳理这个概念", "KNOWLEDGE_MAP"))
      .toMatchObject({ specialty: "GENERAL_DESIGN", reason: "GENERAL_DEFAULT" });
    expect(routeDesignSpecialty("接下来用 TouchDesigner 怎么做？", "EVIDENCE", "book-design"))
      .toMatchObject({ specialty: "DIGITAL_INTERACTION", reason: "MESSAGE_MATCH" });
    expect(routeDesignSpecialty("现在改做包装设计，货架识别太弱", "AGENT", "digital-interaction"))
      .toMatchObject({ specialty: "GENERAL_DESIGN", reason: "MESSAGE_MATCH" });
    expect(routeDesignSpecialty("改成服装项目，先看面料垂感", "AGENT", "book-design"))
      .toMatchObject({ specialty: "GENERAL_DESIGN", reason: "MESSAGE_MATCH" });
    expect(routeDesignSpecialty("继续检查刚才的节点", "AGENT", "digital-interaction"))
      .toMatchObject({ specialty: "DIGITAL_INTERACTION", reason: "MESSAGE_MATCH" });
  });

  it("uses the declared major only after message, view, and previous-turn signals", () => {
    expect(routeDesignSpecialty(
      "我想先聊聊这个想法",
      "AGENT",
      undefined,
      "book-design",
    )).toMatchObject({
      coursePackId: "book-design",
      reason: "STUDENT_DECLARED",
    });
    expect(routeDesignSpecialty(
      "我想先聊聊这个想法",
      "AGENT",
    )).toMatchObject({
      coursePackId: "general-design",
      reason: "GENERAL_DEFAULT",
    });

    expect(routeDesignSpecialty(
      "这个 TouchDesigner 画面为什么不动？",
      "AGENT",
      undefined,
      "book-design",
    )).toMatchObject({
      coursePackId: "digital-interaction",
      reason: "MESSAGE_MATCH",
    });
    expect(routeDesignSpecialty(
      "我想先聊聊这个想法",
      "NODE_CANVAS",
      undefined,
      "book-design",
    )).toMatchObject({
      coursePackId: "digital-interaction",
      reason: "INTERFACE_CONTEXT",
    });
    expect(routeDesignSpecialty(
      "我想先聊聊这个想法",
      "AGENT",
      "digital-interaction",
      "book-design",
    )).toMatchObject({
      coursePackId: "digital-interaction",
      reason: "INTERFACE_CONTEXT",
    });
    expect(routeDesignSpecialty(
      "我想先聊聊这个想法",
      "AGENT",
      "general-design",
      "book-design",
    )).toMatchObject({
      coursePackId: "general-design",
      reason: "INTERFACE_CONTEXT",
    });
    expect(routeDesignSpecialty(
      "现在改做包装设计，货架识别太弱",
      "AGENT",
      undefined,
      "book-design",
    )).toMatchObject({
      coursePackId: "general-design",
      reason: "MESSAGE_MATCH",
    });
  });

  it.each([
    "产品设计的人机尺寸应该怎么验证？",
    "展陈空间的参观动线怎样避免回流？",
    "服装设计里如何把面料垂感转成廓形？",
    "摄影作品怎样用光线建立叙事层次？",
    "品牌字体怎样兼顾识别性和延展性？",
    "首饰设计如何从材料特性发展结构？",
  ])("keeps unlisted art-design disciplines inside the general professional scope: %s", (message) => {
    expect(routeDesignSpecialty(message, "AGENT")).toMatchObject({
      specialty: "GENERAL_DESIGN",
      coursePackId: "general-design",
      enhanced: false,
    });
  });

  it("defines a doctoral-level all-discipline identity and treats current examples as non-exhaustive", () => {
    const prompt = buildDesignAgentSystemPrompt(getCoursePack("general-design", "1"));
    expect(prompt).toContain("艺术设计博士层级");
    expect(prompt).toContain("艺术设计专业全领域");
    expect(prompt).toContain("包括但不限于");
    expect(prompt).toContain("绝不是能力清单或回答白名单");
    expect(prompt).toContain("至少两个互补的专业判断维度");
  });

  it("allows read-only context automatically and requires confirmation for changes", () => {
    const policy = getActiveAgentPolicy();
    expect(decideActionPolicy("READ_CONTEXT", policy).mode).toBe("AUTOMATIC");
    expect(decideActionPolicy("NAVIGATE", policy).mode).toBe("REQUIRES_CONFIRMATION");
    expect(decideActionPolicy("WRITE_PROJECT", policy).mode).toBe("REQUIRES_CONFIRMATION");
    expect(decideActionPolicy("CHANGE_TOOL_STATE", policy).mode).toBe("REQUIRES_CONFIRMATION");
    expect(decideActionPolicy("EXTERNAL_CALL", policy).mode).toBe("REQUIRES_CONFIRMATION");
    expect(decideActionPolicy("SUBMIT_EVALUATION", policy).mode).toBe("FORBIDDEN");
    expect(decideActionPolicy("FORMAL_AUTHORITY", policy).mode).toBe("FORBIDDEN");
  });

  it("uses cross-discipline problem signals without sending general work to the node canvas", () => {
    expect(inferLearningEpisode("展览入口容易堵，动线应该怎么改？", "AGENT")).toBe("DEBUG");
    expect(inferLearningEpisode("陶瓷灯罩怎样安排材料和烧成试样？", "AGENT")).toBe("BUILD");
    expect(inferLearningEpisode("角色落地动画很轻飘，关键动作怎样调整？", "AGENT")).toBe("DEBUG");
    expect(actionForType(getCoursePack("general-design", "1"), "BUILD", "OPEN_WORKSPACE"))
      .toMatchObject({ target: "PROJECT", label: "进入项目工作区" });
    expect(actionForType(getCoursePack("digital-interaction", "1"), "BUILD", "OPEN_WORKSPACE"))
      .toMatchObject({ target: "NODE_CANVAS" });
  });

  it("selects tools from the current goal instead of exposing every pack tool", () => {
    const pack = getCoursePack("digital-interaction", "1");
    const tools = selectAgentToolsForTurn({
      pack,
      specialty: "DIGITAL_INTERACTION",
      episode: "DEBUG",
      view: "AGENT",
      message: "声音有数值但画面不动，怎么排查？",
    });
    expect(tools.map(({ descriptor }) => descriptor.id)).toEqual(expect.arrayContaining([
      "knowledge-map.search-concepts",
      "project-evidence.read-troubleshooting",
    ]));
    expect(tools.map(({ descriptor }) => descriptor.id)).not.toContain("touchdesigner-cases.search-network");
    expect(tools.map(({ descriptor }) => descriptor.id)).not.toContain("design-calculator.compute");
  });
});
