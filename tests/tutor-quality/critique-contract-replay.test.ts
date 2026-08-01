// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CRITIQUE_DIMENSION_IDS } from "@/lib/agent/critique-contract";
import { parseTutorSidecar } from "@/lib/agent/v3/tutor-sidecar";

type VisualContractCase = {
  id: string;
  question: string;
  artworkFixture?: { expectedVisibleFacts: string[] };
};

const suite = JSON.parse(
  readFileSync(path.resolve("tests/tutor-quality/golden-suite.json"), "utf8"),
) as { cases: VisualContractCase[] };
const visualCase = suite.cases.find(({ id }) => id === "v3-artwork-poster-hierarchy");
if (!visualCase?.artworkFixture) throw new Error("缺少作品会诊契约图及可见事实");

const artworkSourceId = "artwork:20000000-0000-4000-8000-000000000091";
const studentQuestion = visualCase.question;
const visibleFacts = visualCase.artworkFixture.expectedVisibleFacts;
const labels = ["目标", "创意转译", "构成与层级", "形式语言", "工艺与规范"];
const statuses = ["NEEDS_EVIDENCE", "NEEDS_EVIDENCE", "DEVELOPING", "DEVELOPING", "NEEDS_EVIDENCE"];
const observations = [
  [
    "学生要求检查标题、时间和地点的层级，但还没有说明这张海报最先要传达的活动信息。",
    "两个英文标题形成竞争入口；仅凭画面还不能确认它们与非遗主题的转译关系。",
    "两个近似重量的英文标题与黄色日期块共同争夺第一层级。",
    "白色粗体标题与高对比色块形成统一强调，但右侧裁切降低了文字完整性。",
    "底部时间地点处于明显次级；缺少成品尺寸，不能据此断言实际观看距离下的可读性。",
  ],
  [
    "当前问题明确要核对信息层级，目标受众、观看场景和首要活动信息仍需学生确认。",
    "画面能证明两个英文词都很突出，不能证明这种并置已经承载了非遗节的内容逻辑。",
    "标题色块和日期色块面积接近，第一眼入口尚未收束为单一主层。",
    "粗体白字与色块的视觉语言一致，不过两组文字被边界截断，识读关系仍不完整。",
    "时间地点相对较小这一关系可见；实际字号、出血和输出条件仍没有证据。",
  ],
] as const;
const guidance = [
  [
    "先补一句谁在什么场景要先读到什么。",
    "先说明两个英文词分别承担什么内容关系。",
    "先只降低日期块的视觉重量，再做缩略图检查。",
    "先修正右侧裁切，不同时增加新的强调手段。",
    "先确认成品尺寸与观看距离，再判断实际字号。",
  ],
  [
    "先写清受众、场景和第一信息，其他判断再跟随这个目标。",
    "先用一句话解释英文并置如何服务非遗节主题。",
    "只改日期块面积，检查第一眼是否回到活动标题。",
    "先让两组标题完整进入画布，再比较形式统一性。",
    "先记录输出媒介、尺寸和观看距离，暂不猜实际可读性。",
  ],
] as const;

function draft(replay: 0 | 1) {
  return {
    frameworkId: "critique-framework-five-plus-closure",
    frameworkVersion: "1.0",
    dimensions: CRITIQUE_DIMENSION_IDS.map((id, index) => ({
      id,
      label: labels[index],
      displayOrder: index + 1,
      status: statuses[index],
      observation: observations[replay][index],
      evidence: index === 0
        ? [{
            kind: "STUDENT_STATEMENT",
            label: studentQuestion,
            reference: "student-message",
          }]
        : [{
            kind: "ARTWORK_REGION",
            label: visibleFacts[[0, 0, 2, 1, 3][index]],
            reference: artworkSourceId,
          }],
      guidance: {
        level: index < 2 || index === 4 ? "QUESTION" : "HINT",
        message: guidance[replay][index],
      },
      isDeepDive: index === 2 || index === 3,
    })),
    closure: replay === 0
      ? {
          established: "底部时间地点已经与大标题形成次级区分。",
          nextStep: "下一步只降低日期块的视觉重量，再检查第一眼是否回到活动标题。",
        }
      : {
          established: "时间与地点已经被组织在主标题之后，基础层级关系可见。",
          nextStep: "先只缩小日期色块，缩略预览时确认活动标题成为唯一入口。",
        },
  };
}

function parseReplay(replay: 0 | 1) {
  const body = replay === 0
    ? "先看层级：目前两个英文标题和日期块都在争第一眼，先只降低日期块重量。"
    : "这次仍先收入口，不改全部元素；把日期块退到第二层后再看标题是否清楚。";
  return parseTutorSidecar(
    `${body}\n\n<!-- tutor-meta ${JSON.stringify({ critique: draft(replay) })} -->`,
    {
      enabled: true,
      courseId: "general-design",
      studentMessage: studentQuestion,
      artworkSourceId,
    },
  );
}

function structuralSignature(critique: NonNullable<ReturnType<typeof parseReplay>["sidecar"]>["critique"]) {
  return critique?.dimensions.map((dimension) => ({
    id: dimension.id,
    displayOrder: dimension.displayOrder,
    status: dimension.status,
    isDeepDive: dimension.isDeepDive,
    evidence: dimension.evidence.map(({ kind, label, reference }) => ({ kind, label, reference })),
  }));
}

describe("five-dimension critique contract replay", () => {
  it("replays two fixture-shaped outputs against the declared evidence boundaries", () => {
    for (const replay of [parseReplay(0), parseReplay(1)]) {
      expect(replay.critiqueStatus).toBe("PARSED");
      const critique = replay.sidecar?.critique;
      expect(critique?.dimensions.map(({ id }) => id)).toEqual(CRITIQUE_DIMENSION_IDS);
      expect(critique?.dimensions.filter(({ isDeepDive }) => isDeepDive)).toHaveLength(2);
      expect(critique?.closure.established).toBeTruthy();
      expect(critique?.closure.nextStep).toBeTruthy();
      expect(critique?.closure.historyComparison).toBeUndefined();

      for (const dimension of critique?.dimensions ?? []) {
        for (const evidence of dimension.evidence) {
          if (evidence.kind === "ARTWORK_REGION") {
            expect(visibleFacts, evidence.label).toContain(evidence.label);
            expect(evidence.reference).toBe(artworkSourceId);
          } else {
            expect(evidence).toEqual({
              kind: "STUDENT_STATEMENT",
              label: studentQuestion,
              reference: "student-message",
            });
          }
        }
      }

      const rendered = JSON.stringify(critique);
      for (const unsupportedClaim of ["铜版纸", "烫金", "动画已运行", "交互反馈正常", "两米可读", "比上次进步"]) {
        expect(rendered).not.toContain(unsupportedClaim);
      }
    }
  });

  it("allows natural wording to vary while the same image keeps one structural judgment", () => {
    const first = parseReplay(0);
    const second = parseReplay(1);
    expect(first.text).not.toBe(second.text);
    expect(structuralSignature(first.sidecar?.critique)).toEqual(
      structuralSignature(second.sidecar?.critique),
    );
  });
});
