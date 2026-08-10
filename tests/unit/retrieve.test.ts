import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  KnowledgeItemSchema,
  loadKnowledgeDirectory,
  parseKnowledgeMarkdown,
  rankKnowledge,
  type KnowledgeItem,
} from "@/lib/knowledge/retrieve";

const item = (overrides: Partial<KnowledgeItem>): KnowledgeItem => ({
  id: "course",
  title: "课程交互原则",
  topic: "COURSE_PRINCIPLES",
  tags: ["交互", "映射"],
  content: "先确认输入，再检查映射与输出。",
  facts: [{ id: "course-six-elements", text: "课程使用六要素组织交互逻辑。" }],
  actions: [{ id: "course-clarify-intent", text: "先写清文化意图。" }],
  source: {
    localDocument: "docs/course.md",
    authority: "COURSE_DESIGN",
    verifiedDate: "2026-07-12",
    scope: "触映课程流程",
  },
  ...overrides,
});

describe("rankKnowledge", () => {
  it("ranks mixed Chinese, English, and OSC terms deterministically", () => {
    const items = [
      item({ id: "z-color", title: "颜色", tags: ["视觉"], content: "颜色映射" }),
      item({
        id: "osc",
        title: "OSC连接",
        topic: "OSC_TROUBLESHOOTING",
        tags: ["OSC", "DigiShow", "TouchDesigner"],
        content: "检查 OSC 地址和端口。",
        facts: [{ id: "osc-port", text: "OSC接收端监听端口。" }],
        actions: [{ id: "osc-check-receiver", text: "检查接收端状态。" }],
      }),
    ];

    expect(rankKnowledge("DigiShow OSC 收不到", items)[0]?.id).toBe("osc");
    expect(rankKnowledge("TouchDesigner OSC", items)[0]?.id).toBe("osc");
  });

  it("uses the id as a stable tie-break and returns at most five entries", () => {
    const items = Array.from({ length: 7 }, (_, index) =>
      item({ id: `item-${6 - index}`, title: "OSC资料", tags: ["OSC"] }),
    );

    expect(rankKnowledge("OSC", items).map(({ id }) => id)).toEqual([
      "item-0",
      "item-1",
      "item-2",
      "item-3",
      "item-4",
    ]);
  });

  it("is safe for empty queries, unknown terms, and empty knowledge", () => {
    expect(rankKnowledge("", [item({})])).toEqual([]);
    expect(rankKnowledge("量子香蕉", [item({})])).toEqual([]);
    expect(rankKnowledge("OSC", [])).toEqual([]);
  });

  it("does not let weak Chinese character overlap contaminate a course-intent query", () => {
    const items = [
      item({
        id: "course",
        title: "文化意图与六要素",
        topic: "COURSE_PRINCIPLES",
        tags: ["文化意图", "六要素"],
      }),
      item({
        id: "digishow",
        title: "DigiShow信号映射",
        topic: "DIGISHOW_SIGNALS",
        tags: ["DigiShow", "信号映射"],
        facts: [{ id: "digishow-signals", text: "DigiShow区分基础信号类型。" }],
        actions: [{ id: "digishow-identify-signal", text: "检查输入信号类型。" }],
      }),
      item({
        id: "touchdesigner",
        title: "TouchDesigner输入处理输出",
        topic: "TOUCHDESIGNER_FOUNDATIONS",
        tags: ["TouchDesigner", "节点"],
        facts: [{ id: "td-flow", text: "operator连接形成数据流。" }],
        actions: [{ id: "td-observe-upstream", text: "观察节点输入和输出。" }],
      }),
      item({
        id: "osc",
        title: "OSC地址端口排查",
        topic: "OSC_TROUBLESHOOTING",
        tags: ["OSC", "地址", "端口"],
        facts: [{ id: "osc-port", text: "OSC接收端监听端口。" }],
        actions: [{ id: "osc-check-receiver", text: "核对发送和接收端口。" }],
      }),
    ];

    expect(rankKnowledge("文化意图怎么填写", items).map(({ id }) => id)).toEqual(["course"]);
    expect(rankKnowledge("量子香蕉", items)).toEqual([]);
    expect(rankKnowledge("DigiShow模拟信号映射", items)[0]?.id).toBe("digishow");
    expect(rankKnowledge("TouchDesigner节点输入输出", items)[0]?.id).toBe("touchdesigner");
    expect(rankKnowledge("OSC地址端口收不到", items)[0]?.id).toBe("osc");
  });
});

describe("knowledge markdown", () => {
  const valid = `---
id: digishow-signals
title: DigiShow官方信号基础
topic: DIGISHOW_SIGNALS
authority: OFFICIAL
url: https://digishow.cc/
verifiedDate: 2026-07-12
scope: DigiShow信号类型与映射入门
tags: ["DigiShow", "OSC", "信号映射"]
facts: [{"id":"digishow-signal-types","text":"DigiShow教程区分三类基础信号。"}]
actions: [{"id":"digishow-identify-signal","text":"先确认输入信号类型。"}]
---
DigiShow官方教程将信号分为模拟、二进制和音符三类。`;

  it("parses and validates source metadata at runtime", () => {
    expect(parseKnowledgeMarkdown(valid, "digishow-signals.md")).toMatchObject({
      id: "digishow-signals",
      topic: "DIGISHOW_SIGNALS",
      source: {
        url: "https://digishow.cc/",
        authority: "OFFICIAL",
        verifiedDate: "2026-07-12",
      },
    });
  });

  it("canonicalizes Windows line endings before producing persisted knowledge content", () => {
    expect(parseKnowledgeMarkdown(valid.replace(/\n/g, "\r\n"), "digishow-signals.md"))
      .toEqual(parseKnowledgeMarkdown(valid, "digishow-signals.md"));
  });

  it("redacts normalized phones, email and configured student ids before material enters the knowledge index", () => {
    vi.stubEnv("STUDENT_NUMBER_PREFIX", "ABC");
    vi.stubEnv("STUDENT_NUMBER_DIGITS", "4");
    const parsed = parseKnowledgeMarkdown(valid
      .replace("DigiShow官方信号基础", "＋８６-１３８ １２３４-５６７８ 的 DigiShow案例")
      .replace("DigiShow教程区分三类基础信号。", "Student@Example.com 记录三类基础信号。")
      .replace("DigiShow官方教程将", "ABC1234 的历史作业将"), "anonymous-case.md");
    const indexed = JSON.stringify(parsed).toLowerCase();
    expect(indexed).toContain("历史作业");
    expect(indexed).not.toContain("138 1234-5678");
    expect(indexed).not.toContain("student@example.com");
    expect(indexed).not.toContain("abc1234");
    vi.unstubAllEnvs();
  });

  it("preserves original Unicode outside redacted spans and does not partially redact combining-mark identifiers in knowledge", () => {
    vi.stubEnv("STUDENT_NUMBER_PREFIX", "ABC");
    vi.stubEnv("STUDENT_NUMBER_DIGITS", "4");
    const parsed = parseKnowledgeMarkdown(valid
      .replace("DigiShow官方信号基础", "阶段①：＋８６ １３８－１２３４－５６７８ 的案例")
      .replace(
        "DigiShow官方教程将信号分为模拟、二进制和音符三类。",
        "型号 ABC1234\u0301 保留，学号 ABC1234 应遮蔽。",
      ), "unicode-boundary.md");
    expect(parsed.title).toBe("阶段①：[已遮蔽手机号] 的案例");
    expect(parsed.content).toContain("ABC1234\u0301 保留");
    expect(parsed.content).toContain("学号 [已遮蔽学号] 应遮蔽");
    vi.unstubAllEnvs();
  });

  it("rejects fact and action IDs that do not belong to the declared topic", () => {
    expect(() =>
      KnowledgeItemSchema.parse(
        item({
          topic: "OSC_TROUBLESHOOTING",
          facts: [{ id: "course-six-elements", text: "错误主题事实。" }],
          actions: [{ id: "course-clarify-intent", text: "错误主题动作。" }],
        }),
      ),
    ).toThrow("declared topic");
  });

  it.each([
    valid.replace("verifiedDate: 2026-07-12\n", ""),
    valid.replace("authority: OFFICIAL\n", ""),
    valid.replace("url: https://digishow.cc/\n", ""),
    valid.replace("scope: DigiShow信号类型与映射入门", "scope: "),
    valid.replace("url: https://digishow.cc/", "url: javascript:alert(1)"),
  ])("rejects malformed or incomplete metadata", (markdown) => {
    expect(() => parseKnowledgeMarkdown(markdown, "bad.md")).toThrow();
  });

  it("rejects unregistered external sources embedded in the content", () => {
    const withExtraSource = valid.replace(
      "DigiShow官方教程将信号分为模拟、二进制和音符三类。",
      "另见 https://unregistered.example.test/ 的操作结论。",
    );

    expect(() => parseKnowledgeMarkdown(withExtraSource, "bad-source.md")).toThrow(
      "content must be attributable",
    );
  });

  it("loads markdown files in stable filename order", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-knowledge-"));
    await writeFile(path.join(directory, "b.md"), valid.replaceAll("digishow-signals", "b"));
    await writeFile(path.join(directory, "a.md"), valid.replaceAll("digishow-signals", "a"));

    const loaded = await loadKnowledgeDirectory(directory);

    expect(loaded.map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("loads all four course packs with verified provenance", async () => {
    const loaded = await loadKnowledgeDirectory(path.join(process.cwd(), "data", "knowledge"));
    const conversionReport = JSON.parse(await readFile(
      path.join(process.cwd(), "data", "knowledge", "course-corpus-conversion-report.json"),
      "utf8",
    )) as { generatedCount: number; generatedIds: string[] };

    expect(loaded).toHaveLength(34 + conversionReport.generatedCount);
    expect(conversionReport.generatedIds.every((id) => loaded.some((item) => item.id === id))).toBe(true);
    expect(loaded.every(({ source }) => source.verifiedDate >= "2026-07-12")).toBe(true);
    expect(loaded.every(({ source }) => Boolean(source.url || source.localDocument))).toBe(true);
    expect(
      loaded.find(({ id }) => id === "course-principles")?.source.authority,
    ).toBe("COURSE_DESIGN");
    expect(
      loaded
        .filter(({ id }) => ["digishow-signals", "touchdesigner-foundations", "osc-troubleshooting"].includes(id))
        .every(({ source }) => source.authority === "OFFICIAL"),
    ).toBe(true);
    expect(loaded.find(({ id }) => id === "audio-reactive-visual")?.source.authority).toBe("ANONYMIZED_CASE");
    expect(loaded.find(({ id }) => id === "td-case-version-comparison")?.source.authority).toBe("ANONYMIZED_CASE");
    expect(loaded.some(({ tags }) => tags.includes("DigiShow"))).toBe(true);
    expect(loaded.some(({ tags }) => tags.includes("TouchDesigner"))).toBe(true);
    expect(loaded.some(({ tags }) => tags.includes("OSC"))).toBe(true);
    expect(new Set(loaded.map(({ topic }) => topic))).toEqual(
      new Set([
        "DESIGN_FOUNDATIONS",
        "COURSE_PRINCIPLES",
        "DIGISHOW_SIGNALS",
        "TOUCHDESIGNER_FOUNDATIONS",
        "OSC_TROUBLESHOOTING",
        "BOOK_DESIGN_PRINCIPLES",
        "INFORMATION_HIERARCHY",
        "LAYOUT_EVIDENCE",
        "LAYOUT_DESIGN_PRINCIPLES",
        "TYPOGRAPHY_BASICS",
        "BRAND_IDENTITY",
      ]),
    );
    expect(loaded.every(({ facts, actions }) => facts.length > 0 && actions.length > 0)).toBe(true);
    expect(loaded.every(({ content }) => !/https?:\/\//i.test(content))).toBe(true);
  });
});
