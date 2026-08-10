// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { getCoursePack } from "@/lib/course-packs/registry";
import type { AgentEffect } from "@/lib/agent/action-policy";
import { getActiveAgentPolicy } from "@/lib/agent/policy-registry";
import { getCapability } from "@/lib/agent/capability-registry";
import {
  AgentToolCallRequestSchema,
  AgentToolDescriptorSchema,
  type AgentToolAccess,
  type AgentToolDefinition,
} from "@/lib/agent/tool-contract";
import { AgentToolRejectedError, agentToolCallFingerprint, executeAgentToolDefinition } from "@/lib/agent/tool-executor";
import {
  getAgentTool,
  listAgentTools,
  listAgentToolsForRequestedCapability,
  listRecommendedAgentTools,
} from "@/lib/agent/tool-registry";

function permissionDefinition(
  effect: AgentEffect,
  access: AgentToolAccess,
  execute: AgentToolDefinition["execute"],
): AgentToolDefinition {
  return {
    descriptor: {
      id: `permission-test.${effect.toLowerCase().replaceAll("_", "-")}`,
      version: "1",
      adapterId: "knowledge-map",
      owner: getCapability("course-reference"),
      label: `${effect} 权限测试`,
      description: "验证工具权限在执行前生效。",
      inputHint: "空对象",
      effect,
      access,
      timeoutMs: 500,
      recommendedByCoursePacks: [{ id: "digital-interaction", version: "1" }],
    },
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ ok: z.literal(true) }).strict(),
    execute,
    summarize: () => ({ summary: "执行完成。", facts: [], empty: false }),
  };
}

describe("agent tool runtime", () => {
  it("registers versioned server tools and keeps course-pack affinity as recommendation metadata", () => {
    expect(listAgentTools().map(({ id }) => id)).toEqual([
      "project-evidence.read-state",
      "project-evidence.read-troubleshooting",
      "knowledge-map.search-concepts",
      "knowledge-map.search-evidence",
      "touchdesigner-cases.search-network",
      "book-layout-lab.read-state",
      "external-web.search",
      "design-calculator.compute",
      "layout-grid-lab.read-state",
      "tutor.ask-clarifying",
      "handwritten-title.build-prompts",
      "generative-tool.start-build",
    ]);
    expect(listRecommendedAgentTools(getCoursePack("digital-interaction", "1")).map(({ descriptor }) => descriptor.id))
      .toEqual([
        "project-evidence.read-state",
        "project-evidence.read-troubleshooting",
        "knowledge-map.search-concepts",
        "touchdesigner-cases.search-network",
        "design-calculator.compute",
        "tutor.ask-clarifying",
        "generative-tool.start-build",
      ]);
    expect(listRecommendedAgentTools(getCoursePack("book-design", "1")).map(({ descriptor }) => descriptor.id))
      .toEqual(["knowledge-map.search-concepts", "book-layout-lab.read-state", "design-calculator.compute", "tutor.ask-clarifying", "generative-tool.start-build"]);
    expect(listRecommendedAgentTools(getCoursePack("general-design", "1")).map(({ descriptor }) => descriptor.id))
      .toEqual(["knowledge-map.search-concepts", "design-calculator.compute", "tutor.ask-clarifying", "handwritten-title.build-prompts", "generative-tool.start-build"]);
    expect(listRecommendedAgentTools(getCoursePack("layout-design", "1")).map(({ descriptor }) => descriptor.id))
      .toEqual([
        "knowledge-map.search-concepts",
        "design-calculator.compute",
        "layout-grid-lab.read-state",
        "tutor.ask-clarifying",
        "handwritten-title.build-prompts",
        "generative-tool.start-build",
      ]);
    expect(listRecommendedAgentTools(getCoursePack("brand-vi-design", "1")).map(({ descriptor }) => descriptor.id))
      .toEqual([
        "project-evidence.read-state",
        "project-evidence.read-troubleshooting",
        "knowledge-map.search-concepts",
        "design-calculator.compute",
        "tutor.ask-clarifying",
        "handwritten-title.build-prompts",
        "generative-tool.start-build",
      ]);
    expect(listRecommendedAgentTools(
      getCoursePack("digital-interaction", "1"),
      { knowledgeObjectV2Enabled: true },
    ).map(({ descriptor }) => descriptor.id))
      .toEqual([
        "project-evidence.read-state",
        "project-evidence.read-troubleshooting",
        "knowledge-map.search-evidence",
        "touchdesigner-cases.search-network",
        "design-calculator.compute",
        "tutor.ask-clarifying",
        "generative-tool.start-build",
      ]);
    expect(listRecommendedAgentTools(
      getCoursePack("layout-design", "1"),
      { knowledgeObjectV2Enabled: true },
    ).map(({ descriptor }) => descriptor.id))
      .toContain("knowledge-map.search-evidence");
    const registered = getAgentTool("knowledge-map.search-concepts");
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered.descriptor)).toBe(true);
    expect(Object.isFrozen(registered.descriptor.recommendedByCoursePacks)).toBe(true);
    expect(Object.isFrozen(registered.descriptor.recommendedByCoursePacks[0])).toBe(true);
    expect(listAgentTools().filter(({ id }) => !["external-web.search", "generative-tool.start-build"].includes(id)).every(({ effect, access }) => (
      effect === "READ_CONTEXT" && access === "READ_ONLY"
    ))).toBe(true);
    expect(getAgentTool("external-web.search").descriptor).toMatchObject({
      effect: "EXTERNAL_CALL",
      access: "STUDENT_CONFIRMATION",
      timeoutMs: 60_000,
    });
    expect(getAgentTool("generative-tool.start-build").descriptor).toMatchObject({
      effect: "CHANGE_TOOL_STATE",
      access: "STUDENT_CONFIRMATION",
      timeoutMs: 2_000,
    });
    expect(() => getAgentTool("shell.execute")).toThrow("unknown agent tool");
  });

  it("narrows tools to the selected capability and keeps public research consent-gated", () => {
    const pack = getCoursePack("digital-interaction", "1");
    expect(listAgentToolsForRequestedCapability({
      pack,
      capabilityId: "touchdesigner-cases",
    }).map(({ descriptor }) => descriptor.id)).toEqual([
      "knowledge-map.search-concepts",
      "touchdesigner-cases.search-network",
      "design-calculator.compute",
    ]);
    expect(listAgentToolsForRequestedCapability({
      pack,
      capabilityId: "public-research",
    })).toEqual([]);
    expect(listAgentToolsForRequestedCapability({
      pack,
      capabilityId: "public-research",
      externalSearchConfirmed: true,
    }).map(({ descriptor }) => descriptor.id)).toEqual(["external-web.search"]);
    expect(listAgentToolsForRequestedCapability({
      pack,
      externalSearchConfirmed: true,
    }).map(({ descriptor }) => descriptor.id)).toContain("external-web.search");
    expect(listAgentToolsForRequestedCapability({
      pack,
      capabilityId: "skill-installer",
    })).toEqual([]);
    expect(listAgentToolsForRequestedCapability({
      pack,
      capabilityId: "skill-creator",
    })).toEqual([]);
  });

  it.each([
    ["READ_CONTEXT", "READ_ONLY"],
    ["NAVIGATE", "STUDENT_CONFIRMATION"],
    ["WRITE_PROJECT", "STUDENT_CONFIRMATION"],
    ["CHANGE_TOOL_STATE", "STUDENT_CONFIRMATION"],
    ["EXTERNAL_CALL", "STUDENT_CONFIRMATION"],
    ["SUBMIT_EVALUATION", "FORBIDDEN"],
    ["FORMAL_AUTHORITY", "FORBIDDEN"],
  ] as const)("accepts the matching %s tool permission declaration", (effect, access) => {
    const definition = permissionDefinition(effect, access, () => ({ ok: true }));
    expect(AgentToolDescriptorSchema.parse(definition.descriptor)).toMatchObject({ effect, access });
  });

  it("rejects a descriptor that disguises a side effect as read-only", () => {
    const definition = permissionDefinition("WRITE_PROJECT", "STUDENT_CONFIRMATION", () => ({ ok: true }));
    expect(() => AgentToolDescriptorSchema.parse({
      ...definition.descriptor,
      access: "READ_ONLY",
    })).toThrow("WRITE_PROJECT tools must declare STUDENT_CONFIRMATION access");
  });

  it("executes an automatic read-only tool", async () => {
    const execute = vi.fn(() => ({ ok: true as const }));
    const definition = permissionDefinition("READ_CONTEXT", "READ_ONLY", execute);
    const result = await executeAgentToolDefinition({
      definition,
      call: { toolId: definition.descriptor.id, arguments: {} },
      context: {
        connection: {} as never,
        actor: { userId: "s1", role: "STUDENT" },
        pack: getCoursePack("digital-interaction", "1"),
        student: {} as never,
        question: "测试",
        signal: new AbortController().signal,
      },
      policy: getActiveAgentPolicy(),
      seenFingerprints: new Set(),
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(result.observation).toMatchObject({ status: "SUCCESS", errorCode: null });
  });

  it.each([
    ["WRITE_PROJECT", "STUDENT_CONFIRMATION", "TOOL_CONFIRMATION_REQUIRED"],
    ["CHANGE_TOOL_STATE", "STUDENT_CONFIRMATION", "TOOL_CONFIRMATION_REQUIRED"],
    ["EXTERNAL_CALL", "STUDENT_CONFIRMATION", "TOOL_CONFIRMATION_REQUIRED"],
    ["SUBMIT_EVALUATION", "FORBIDDEN", "TOOL_FORBIDDEN"],
    ["FORMAL_AUTHORITY", "FORBIDDEN", "TOOL_FORBIDDEN"],
  ] as const)("rejects %s before executing it", async (effect, access, errorCode) => {
    const execute = vi.fn(() => ({ ok: true as const }));
    const definition = permissionDefinition(effect, access, execute);
    const seenFingerprints = new Set<string>();
    await expect(executeAgentToolDefinition({
      definition,
      call: { toolId: definition.descriptor.id, arguments: {} },
      context: {
        connection: {} as never,
        actor: { userId: "s1", role: "STUDENT" },
        pack: getCoursePack("digital-interaction", "1"),
        student: {} as never,
        question: "测试",
        signal: new AbortController().signal,
      },
      policy: getActiveAgentPolicy(),
      seenFingerprints,
    })).rejects.toMatchObject({ code: errorCode });
    expect(execute).not.toHaveBeenCalled();
    expect(seenFingerprints.size).toBe(0);
  });

  it("executes an external tool only when that exact tool was confirmed for the turn", async () => {
    const execute = vi.fn(() => ({ ok: true as const }));
    const definition = permissionDefinition("EXTERNAL_CALL", "STUDENT_CONFIRMATION", execute);
    const result = await executeAgentToolDefinition({
      definition,
      call: { toolId: definition.descriptor.id, arguments: {} },
      context: {
        connection: {} as never,
        actor: { userId: "s1", role: "STUDENT" },
        pack: getCoursePack("digital-interaction", "1"),
        student: {} as never,
        question: "测试",
        signal: new AbortController().signal,
      },
      policy: getActiveAgentPolicy(),
      seenFingerprints: new Set(),
      confirmedToolIds: new Set([definition.descriptor.id]),
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(result.observation).toMatchObject({ status: "SUCCESS", errorCode: null });

    const writeDefinition = permissionDefinition("WRITE_PROJECT", "STUDENT_CONFIRMATION", execute);
    await expect(executeAgentToolDefinition({
      definition: writeDefinition,
      call: { toolId: writeDefinition.descriptor.id, arguments: {} },
      context: {
        connection: {} as never,
        actor: { userId: "s1", role: "STUDENT" },
        pack: getCoursePack("digital-interaction", "1"),
        student: {} as never,
        question: "测试",
        signal: new AbortController().signal,
      },
      policy: getActiveAgentPolicy(),
      seenFingerprints: new Set(),
      confirmedToolIds: new Set([writeDefinition.descriptor.id]),
    })).rejects.toMatchObject({ code: "TOOL_CONFIRMATION_REQUIRED" });
  });

  it("accepts only a tool id and bounded JSON arguments from a model decision", () => {
    expect(AgentToolCallRequestSchema.parse({ toolId: "knowledge-map.search-concepts", arguments: { query: "映射" } }))
      .toEqual({ toolId: "knowledge-map.search-concepts", arguments: { query: "映射" } });
    expect(() => AgentToolCallRequestSchema.parse({
      toolId: "knowledge-map.search-concepts",
      arguments: {},
      executable: "remove files",
    })).toThrow();
  });

  it("executes the V2 evidence tool only through the injected local port", async () => {
    const definition = getAgentTool(
      "knowledge-map.search-evidence",
    );
    const search = vi.fn(async () => ({
      schemaVersion: 2 as const,
      kind:
        "KNOWLEDGE_MAP_SEARCH_EVIDENCE" as const,
      bundle: {
        bundleId: "bundle-test",
        status: "SUCCESS" as const,
        queryHash: "a".repeat(64),
        corpusBundleHash: "b".repeat(64),
        activeIndexBundleHash: "c".repeat(64),
        capabilitiesLost: [],
      },
      channels: [
        {
          channel: "LEXICAL" as const,
          status: "SUCCESS" as const,
          hitCount: 1,
          indexVersionId: "lexical-v2",
          modelId: null,
          modelRevision: null,
        },
        {
          channel: "TEXT_VECTOR" as const,
          status: "SUCCESS" as const,
          hitCount: 1,
          indexVersionId: "text-v2",
          modelId: "BAAI/bge-small-zh-v1.5",
          modelRevision: "revision-1",
        },
        {
          channel: "VISUAL_VECTOR" as const,
          status: "EMPTY" as const,
          hitCount: 0,
          indexVersionId: "visual-v2",
          modelId: "google/siglip2",
          modelRevision: "revision-2",
        },
      ],
      evidence: {
        nodes: [{
          nodeId: "node-evidence",
          objectId: "object-evidence",
          sourceId: "source-evidence",
          kind: "TEXT" as const,
          relation: "PRIMARY" as const,
          evidenceKind:
            "KNOWLEDGE_FACT" as const,
          excerpt: "层级冲突应先判断视觉主次。",
          assetId: null,
        }],
        assets: [],
        regions: [],
        sources: [{
          sourceId: "source-evidence",
          objectId: "object-evidence",
          title: "视觉层级",
          authority: "COURSE_DESIGN" as const,
          verifiedDate: "2026-07-30",
          scope: "版式设计课程资料",
        }],
      },
      usageRules: {
        knowledgeFacts:
          "只把带 excerpt 的课程节点作为课程知识事实。" as const,
        visualReferences:
          "图片和区域是课程参考图，只描述其中可见内容，不当作学生当前作品。" as const,
        inference:
          "超出节点文字或参考图可见内容的判断必须明确标为推断。" as const,
        uncertainty:
          "证据不足或通道降级时要说明不确定性，不得补造来源。" as const,
      },
    }));
    const result =
      await executeAgentToolDefinition({
        definition,
        call: {
          toolId: definition.descriptor.id,
          arguments: {
            query: "标题图片色彩都抢",
          },
        },
        context: {
          connection: {} as never,
          actor: {
            userId: "s1",
            role: "STUDENT",
          },
          pack: getCoursePack(
            "layout-design",
            "1",
          ),
          student: {} as never,
          question: "先判断什么？",
          evidenceSearchV2: { search },
          signal:
            new AbortController().signal,
        },
        policy: getActiveAgentPolicy(),
        seenFingerprints: new Set(),
      });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "标题图片色彩都抢",
        coursePackId: "layout-design",
        coursePackVersion: "1",
      }),
    );
    expect(result.observation).toMatchObject({
      status: "SUCCESS",
      errorCode: null,
    });
    expect(result.output).toMatchObject({
      schemaVersion: 2,
      kind: "KNOWLEDGE_MAP_SEARCH_EVIDENCE",
    });
  });

  it("canonicalizes argument order so a repeated call cannot bypass detection", () => {
    expect(agentToolCallFingerprint({ toolId: "knowledge-map.search-concepts", arguments: { query: "映射", page: 1 } }))
      .toBe(agentToolCallFingerprint({ toolId: "knowledge-map.search-concepts", arguments: { page: 1, query: "映射" } }));
  });

  it("bounds a stalled tool and returns an auditable timeout observation", async () => {
    const definition = {
      descriptor: {
        id: "knowledge-map.test-timeout",
        version: "1",
        adapterId: "knowledge-map",
        owner: getCapability("course-reference"),
        label: "超时测试",
        description: "验证工具超时不会卡住回合。",
        inputHint: "空对象",
        effect: "READ_CONTEXT",
        access: "READ_ONLY",
        timeoutMs: 100,
        recommendedByCoursePacks: [{ id: "digital-interaction", version: "1" }],
      },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      execute: () => new Promise(() => undefined),
      summarize: () => ({ summary: "不会到达", facts: [], empty: false }),
    } satisfies AgentToolDefinition;
    const result = await executeAgentToolDefinition({
      definition,
      call: { toolId: definition.descriptor.id, arguments: {} },
      context: {
        connection: {} as never,
        actor: { userId: "s1", role: "STUDENT" },
        pack: getCoursePack("digital-interaction", "1"),
        student: {} as never,
        question: "测试",
        signal: new AbortController().signal,
      },
      policy: getActiveAgentPolicy(),
      seenFingerprints: new Set(),
    });
    expect(result).toMatchObject({
      output: null,
      observation: { status: "ERROR", errorCode: "TOOL_TIMEOUT" },
    });
    expect(result.observation.latencyMs).toBeGreaterThanOrEqual(90);
  });

  it("rejects an invalid argument before executing a registered tool", async () => {
    const definition = getAgentTool("knowledge-map.search-concepts");
    await expect(executeAgentToolDefinition({
      definition,
      call: { toolId: definition.descriptor.id, arguments: {} },
      context: {
        connection: {} as never,
        actor: { userId: "s1", role: "STUDENT" },
        pack: getCoursePack("digital-interaction", "1"),
        student: {} as never,
        question: "测试",
        signal: new AbortController().signal,
      },
      policy: getActiveAgentPolicy(),
      seenFingerprints: new Set(),
    })).rejects.toBeInstanceOf(AgentToolRejectedError);
  });

  it("does not use course-pack affinity as a final execution permission gate", async () => {
    const definition = {
      descriptor: {
        id: "book-layout-lab.test-general-context",
        version: "1",
        adapterId: "book-layout-lab",
        owner: getCapability("book-design"),
        label: "课程无关执行测试",
        description: "验证已注册 Skill 可以按学生目标执行。",
        inputHint: "空对象",
        effect: "READ_CONTEXT",
        access: "READ_ONLY",
        timeoutMs: 500,
        recommendedByCoursePacks: [{ id: "book-design", version: "1" }],
      },
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ ok: z.literal(true) }).strict(),
      execute: () => ({ ok: true as const }),
      summarize: () => ({ summary: "书籍设计 Skill 已读取。", facts: ["允许按目标跨课程使用"], empty: false }),
    } satisfies AgentToolDefinition;
    const result = await executeAgentToolDefinition({
      definition,
      call: { toolId: definition.descriptor.id, arguments: {} },
      context: {
        connection: {} as never,
        actor: { userId: "s1", role: "STUDENT" },
        pack: getCoursePack("digital-interaction", "1"),
        student: {} as never,
        question: "我在交互项目中还要做一本过程书",
        signal: new AbortController().signal,
      },
      policy: getActiveAgentPolicy(),
      seenFingerprints: new Set(),
    });
    expect(result.observation).toMatchObject({ status: "SUCCESS", errorCode: null });
  });
});
