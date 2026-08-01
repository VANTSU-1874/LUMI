// @vitest-environment node

import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadKnowledgeDirectory, rankKnowledge } from "@/lib/knowledge/retrieve";
import {
  createGroundedHintService,
  createHintPolicyContext,
} from "@/lib/services/hints";

const knowledgeDirectory = path.join(process.cwd(), "data", "knowledge");

describe("curated tutor knowledge corpus", () => {
  it("covers three packs with auditable authority levels and verifiable sources", async () => {
    const items = await loadKnowledgeDirectory(knowledgeDirectory);

    expect(items).toHaveLength(34);
    expect(new Set(items.map(({ source }) => source.authority))).toEqual(new Set([
      "OFFICIAL",
      "COURSE_DESIGN",
      "ANONYMIZED_CASE",
    ]));
    expect(new Set(items.map(({ topic }) => topic))).toEqual(new Set([
      "DESIGN_FOUNDATIONS",
      "COURSE_PRINCIPLES",
      "DIGISHOW_SIGNALS",
      "TOUCHDESIGNER_FOUNDATIONS",
      "OSC_TROUBLESHOOTING",
      "BOOK_DESIGN_PRINCIPLES",
      "INFORMATION_HIERARCHY",
      "LAYOUT_EVIDENCE",
    ]));

    const allowedOfficialHosts = new Set([
      "designcouncil.org.uk",
      "www.designcouncil.org.uk",
      "www.w3.org",
      "helpx.adobe.com",
      "docs.derivative.ca",
      "digishow.cc",
    ]);
    for (const item of items) {
      const verifiedAt = Date.parse(`${item.source.verifiedDate}T00:00:00.000Z`);
      expect(Number.isNaN(verifiedAt), item.id).toBe(false);
      expect(verifiedAt, item.id).toBeLessThanOrEqual(Date.now());
      if (item.source.authority === "OFFICIAL" && item.source.url) {
        expect(allowedOfficialHosts.has(new URL(item.source.url).hostname)).toBe(true);
      }
      if (item.source.localDocument) {
        expect(item.source.localDocument.replaceAll("\\", "/")).not.toMatch(/^data\/knowledge\//);
        await expect(access(path.resolve(item.source.localDocument))).resolves.toBeUndefined();
      }
    }
    await expect(access(path.resolve(
      "data/touchdesigner/structures/453c740b9575229c78d5b381a5ba4cc71432586fdfc24daae4df5d0b9508d141.json",
    ))).resolves.toBeUndefined();
    await expect(access(path.resolve(
      "data/touchdesigner/structures/1aede0184897ebd60ba81e56f9886415f8982b1118aa33249908f8ee6f5488f6.json",
    ))).resolves.toBeUndefined();
    const rawCaseIndex = await readFile(path.resolve(
      "data/touchdesigner/posters-cases.generated.json",
    ));
    const anonymizedAudit = await readFile(path.resolve(
      "docs/course-packs/digital-interaction/anonymized-case-version-comparison.md",
    ), "utf8");
    const canonicalCaseIndex = rawCaseIndex.toString("utf8").replace(/\r\n/g, "\n");
    expect(anonymizedAudit).toContain(
      createHash("sha256").update(canonicalCaseIndex).digest("hex").toUpperCase(),
    );
  });

  it("keeps all five persisted troubleshooting queries inside their server-approved topics", async () => {
    const items = await loadKnowledgeDirectory(knowledgeDirectory);
    const service = createGroundedHintService({ knowledge: items });
    const policy = createHintPolicyContext({
      previousHintRecords: [],
      currentEvidenceRecords: [],
      priorUsedEvidenceRecordIds: [],
      priorUsedEvidenceDigests: [],
    });
    const topicByTitle = new Map(items.map(({ title, topic }) => [title, topic]));
    const cases = [
      ["TouchDesigner输入信号观察与最小验证", ["TOUCHDESIGNER_FOUNDATIONS"], "TOUCHDESIGNER_FOUNDATIONS"],
      ["DigiShow输入输出范围与数值映射", ["DIGISHOW_SIGNALS", "TOUCHDESIGNER_FOUNDATIONS"], "DIGISHOW_SIGNALS"],
      ["OSC发送接收地址端口与Active状态", ["OSC_TROUBLESHOOTING"], "OSC_TROUBLESHOOTING"],
      ["TouchDesigner接收值与目标参数绑定", ["TOUCHDESIGNER_FOUNDATIONS"], "TOUCHDESIGNER_FOUNDATIONS"],
      ["TouchDesigner输出参数与节点状态观察", ["TOUCHDESIGNER_FOUNDATIONS"], "TOUCHDESIGNER_FOUNDATIONS"],
    ] as const;

    for (const [question, topicScope, expectedTopic] of cases) {
      const response = await service.generate({
        question,
        confirmedFacts: [],
        hypotheses: [],
        evidence: [],
        topicScope: [...topicScope],
      }, policy);
      expect(response.groundingStatus, question).toBe("GROUNDED");
      expect(topicByTitle.get(response.sourceTitles[0] ?? ""), question).toBe(expectedTopic);
      expect(response.sourceTitles, question).not.toContain("触映课程原则（本地设计说明）");
    }

    const unrelated = await service.generate({
      question: "量子香蕉",
      confirmedFacts: [],
      hypotheses: [],
      evidence: [],
      topicScope: ["TOUCHDESIGNER_FOUNDATIONS"],
    }, policy);
    expect(unrelated).toMatchObject({ groundingStatus: "NO_GROUNDING", sourceTitles: [] });
  });

  it("covers the four digital-interaction stages and high-frequency tutor questions", async () => {
    const items = await loadKnowledgeDirectory(knowledgeDirectory);
    const ids = new Set(items.map(({ id }) => id));

    for (const requiredId of [
      "course-four-stage-progression",
      "digishow-signals",
      "td-analyze-chop",
      "osc-out-chop",
      "audio-reactive-visual",
      "td-case-version-comparison",
    ]) expect(ids.has(requiredId)).toBe(true);

    const questions = [
      ["操作完成后用户不知道有没有成功提示", "design-status-feedback"],
      ["普通文字和背景的对比度是多少", "design-text-contrast"],
      ["颜色不能作为唯一错误提示", "design-color-redundancy"],
      ["双钻 Discover Define Develop Deliver", "design-double-diamond"],
      ["DigiShow 的 Analog Binary Note 怎么映射", "digishow-signals"],
      ["声音驱动画面太抖，Filter CHOP 怎么看", "td-filter-chop"],
      ["GLSL TOP 黑屏，Info DAT 有编译错误", "td-glsl-top"],
      ["OSC 发送端口和接收端口对不上", "osc-out-chop"],
      ["InDesign 图片模糊怎么查有效分辨率", "book-linked-assets"],
      ["印刷裁切后有白边，出血怎么设置", "book-bleed-output"],
      ["Kerning 和 Tracking 有什么区别", "book-kerning-tracking"],
    ] as const;
    for (const [question, expectedId] of questions) {
      expect(rankKnowledge(question, items).map(({ id }) => id), question).toContain(expectedId);
    }
  });
});
