import { describe, expect, it } from "vitest";

import { capabilityForTool, listCapabilities } from "@/lib/agent/capability-registry";
import { listAgentTools } from "@/lib/agent/tool-registry";

describe("Plugin / Skill capability registry", () => {
  it("gives every executable tool a student-facing Plugin or Skill owner", () => {
    const tools = listAgentTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      const owner = capabilityForTool(tool.id);
      expect(tool.owner).toEqual({ type: owner.type, id: owner.id, label: owner.label });
      expect(["PLUGIN", "SKILL"]).toContain(owner.type);
      expect(owner.label).not.toMatch(/^[a-z0-9.-]+$/);
    }
    const capabilities = listCapabilities();
    expect(capabilities.find(({ id }) => id === "touchdesigner")?.studentSurfaces)
      .toEqual(["NODE_CANVAS", "CASE_LIBRARY"]);
    expect(capabilities.find(({ id }) => id === "book-design")?.studentSurfaces)
      .toEqual(["BOOK_LAYOUT_LAB"]);
    expect(capabilities.find(({ id }) => id === "skill-installer")).toMatchObject({
      type: "SKILL",
      toolIds: [],
    });
    expect(capabilities.find(({ id }) => id === "skill-creator")).toMatchObject({
      type: "SKILL",
      toolIds: [],
    });
    expect(capabilities.find(({ id }) => id === "generative-tool")).toMatchObject({
      studentSurfaces: ["GENERATIVE_LAB"],
      toolIds: ["generative-tool.start-build"],
    });
  });
});
