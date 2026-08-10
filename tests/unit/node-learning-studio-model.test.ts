import { describe, expect, it } from "vitest";

import { buildNodeAgentFocus, type StudioFlowEdge, type StudioFlowNode } from "@/components/student/node-learning-studio-model";
import type { NodeCatalogEntry } from "@/lib/touchdesigner/node-catalog-shared";

function entry(operatorType: string, chineseName: string): NodeCatalogEntry {
  return {
    id: `CHOP:${operatorType}`,
    family: "CHOP",
    operatorType,
    englishName: operatorType,
    chineseName,
    description: "课程节点",
    useCount: 1,
    courseCases: ["声音驱动画面"],
    parameters: [],
    browserRunnable: true,
    source: "COURSE",
  };
}

function node(id: string, operatorType: string, chineseName: string, state: "placed" | "suggested"): StudioFlowNode {
  return {
    id,
    type: "studio",
    position: { x: 0, y: 0 },
    data: { entry: entry(operatorType, chineseName), state },
  };
}

describe("node learning Agent focus", () => {
  it("summarizes the selected node and real canvas state within the public API limit", () => {
    const selected = node("math", "math", "数值范围映射", "placed");
    const suggested = node("filter", "filter", "平滑数值", "suggested");
    const edge: StudioFlowEdge = {
      id: "edge-math-filter",
      source: selected.id,
      target: suggested.id,
      data: { relation: "wire" },
    };

    const focus = buildNodeAgentFocus(selected, [selected, suggested], [edge], "build");

    expect(focus).toContain("选中math1（CHOP·数值范围映射）");
    expect(focus).toContain("已加入1个、建议1个、连线1条");
    expect(focus.length).toBeLessThanOrEqual(160);
  });
});
