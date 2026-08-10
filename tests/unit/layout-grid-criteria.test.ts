import { describe, expect, it } from "vitest";

import { selectClarifyingFields } from "@/lib/agent/tools/tutor-tools";
import {
  A4_PORTRAIT_DEFAULT,
  type LayoutBlock,
  type LayoutGridEvidenceRequest,
} from "@/lib/domain/layout-grid";
import { evaluateLayoutGrid } from "@/lib/services/layout-grid";

const BASE_BLOCKS: LayoutBlock[] = [
  { id: "title", role: "TITLE", colStart: 1, colSpan: 8, rowStart: 1, rowSpan: 2, fontScale: 2 },
  { id: "body", role: "BODY", colStart: 1, colSpan: 6, rowStart: 5, rowSpan: 5, fontScale: 1 },
  { id: "caption", role: "CAPTION", colStart: 9, colSpan: 4, rowStart: 14, rowSpan: 1, fontScale: 0.8 },
];

function evidenceInput(input: {
  config?: Partial<LayoutGridEvidenceRequest["config"]>;
  blocks?: LayoutBlock[];
} = {}): LayoutGridEvidenceRequest {
  return {
    config: { ...A4_PORTRAIT_DEFAULT, ...input.config },
    blocks: (input.blocks ?? BASE_BLOCKS).map((block) => ({ ...block })),
  };
}

function criterion(
  result: ReturnType<typeof evaluateLayoutGrid>,
  id: ReturnType<typeof evaluateLayoutGrid>["criteria"][number]["id"],
) {
  const found = result.criteria.find((item) => item.id === id);
  if (!found) throw new Error(`missing criterion: ${id}`);
  return found;
}

describe("evaluateLayoutGrid", () => {
  it("passes GRID_ADHERENCE when every block stays inside the configured rows and columns", () => {
    const result = evaluateLayoutGrid(evidenceInput());
    expect(criterion(result, "GRID_ADHERENCE")).toMatchObject({ passed: true });
  });

  it("fails GRID_ADHERENCE and names every out-of-bounds block", () => {
    const result = evaluateLayoutGrid(evidenceInput({
      blocks: BASE_BLOCKS.map((block) => block.id === "body"
        ? { ...block, id: "body-overflow", colStart: 11, colSpan: 3 }
        : block),
    }));
    expect(criterion(result, "GRID_ADHERENCE")).toMatchObject({ passed: false });
    expect(criterion(result, "GRID_ADHERENCE").note).toContain("body-overflow");
  });

  it("passes HIERARCHY_DISTINCT at a title-to-body ratio of at least 1.3", () => {
    const result = evaluateLayoutGrid(evidenceInput({
      blocks: BASE_BLOCKS.map((block) => block.role === "TITLE" ? { ...block, fontScale: 1.3 } : block),
    }));
    expect(criterion(result, "HIERARCHY_DISTINCT")).toMatchObject({ passed: true });
  });

  it("fails HIERARCHY_DISTINCT below a title-to-body ratio of 1.3", () => {
    const result = evaluateLayoutGrid(evidenceInput({
      blocks: BASE_BLOCKS.map((block) => block.role === "TITLE" ? { ...block, fontScale: 1.2 } : block),
    }));
    expect(criterion(result, "HIERARCHY_DISTINCT")).toMatchObject({ passed: false });
    expect(criterion(result, "HIERARCHY_DISTINCT").note).toContain("1.20");
  });

  it.each(["TITLE", "BODY"] as const)(
    "fails HIERARCHY_DISTINCT when %s is missing and explains that comparison is impossible",
    (role) => {
      const result = evaluateLayoutGrid(evidenceInput({
        blocks: BASE_BLOCKS.filter((block) => block.role !== role),
      }));
      expect(criterion(result, "HIERARCHY_DISTINCT")).toMatchObject({ passed: false });
      expect(criterion(result, "HIERARCHY_DISTINCT").note).toContain("无从比较");
    },
  );

  it("passes READING_PATH when TITLE is first and CAPTION follows BODY", () => {
    const result = evaluateLayoutGrid(evidenceInput());
    expect(criterion(result, "READING_PATH")).toMatchObject({ passed: true });
  });

  it("fails READING_PATH when the first block is not TITLE", () => {
    const result = evaluateLayoutGrid(evidenceInput({
      blocks: BASE_BLOCKS.map((block) => block.role === "BODY" ? { ...block, rowStart: 1, colStart: 1 } : block),
    }));
    expect(criterion(result, "READING_PATH")).toMatchObject({ passed: false });
    expect(criterion(result, "READING_PATH").note).toContain("BODY");
    expect(criterion(result, "READING_PATH").note).toContain("主标题");
  });

  it("fails READING_PATH when CAPTION appears before the first BODY", () => {
    const result = evaluateLayoutGrid(evidenceInput({
      blocks: BASE_BLOCKS.map((block) => block.role === "CAPTION" ? { ...block, rowStart: 3 } : block),
    }));
    expect(criterion(result, "READING_PATH")).toMatchObject({ passed: false });
    expect(criterion(result, "READING_PATH").note).toContain("说明性文字");
  });

  it("passes MARGIN_INTEGRITY when all margins are positive and the content area stays large enough", () => {
    const result = evaluateLayoutGrid(evidenceInput());
    expect(criterion(result, "MARGIN_INTEGRITY")).toMatchObject({ passed: true });
  });

  it.each([
    "marginTopMm",
    "marginRightMm",
    "marginBottomMm",
    "marginLeftMm",
  ] as const)("fails MARGIN_INTEGRITY when %s is zero", (margin) => {
    const result = evaluateLayoutGrid(evidenceInput({ config: { [margin]: 0 } }));
    expect(criterion(result, "MARGIN_INTEGRITY")).toMatchObject({ passed: false });
    expect(criterion(result, "MARGIN_INTEGRITY").note).toContain("边距为零");
  });

  it("fails MARGIN_INTEGRITY when the content area is less than half the page width", () => {
    const result = evaluateLayoutGrid(evidenceInput({
      config: { marginLeftMm: 60, marginRightMm: 60 },
    }));
    expect(criterion(result, "MARGIN_INTEGRITY")).toMatchObject({ passed: false });
    expect(criterion(result, "MARGIN_INTEGRITY").note).toContain("不足页面一半");
  });

  it("derives score from passed criteria and only marks a 4/4 result as passed", () => {
    const complete = evaluateLayoutGrid(evidenceInput());
    const partial = evaluateLayoutGrid(evidenceInput({
      blocks: BASE_BLOCKS.map((block) => block.role === "TITLE" ? { ...block, fontScale: 1.2 } : block),
    }));
    expect(complete).toMatchObject({ score: 4, passed: true });
    expect(partial).toMatchObject({ score: 3, passed: false });
    expect(partial.score).toBe(partial.criteria.filter(({ passed }) => passed).length);
  });
});

describe("selectClarifyingFields", () => {
  const fields = [
    { id: "audience", label: "受众", prompt: "谁会阅读？" },
    { id: "readingGoal", label: "阅读目标", prompt: "读者先要得到什么？" },
    { id: "hierarchy", label: "信息层级", prompt: "信息如何分主次？" },
    { id: "medium", label: "媒介约束", prompt: "最终在哪种媒介上呈现？" },
  ] as const;

  it("skips addressed fields, preserves course-pack order, and returns at most two pending fields", () => {
    const result = selectClarifyingFields("受众是新生，信息层级已经分成标题与正文。", fields);
    expect(result.addressed).toEqual(["audience", "hierarchy"]);
    expect(result.pending.map(({ id }) => id)).toEqual(["readingGoal", "medium"]);
    expect(result.pending).toHaveLength(2);
  });
});
