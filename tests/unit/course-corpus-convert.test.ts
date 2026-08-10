// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  convertCourseCorpus,
  convertCourseCorpusDocument,
} from "@/scripts/convert-course-corpus";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sourceDocument(overrides: {
  sourceCategory?: string;
  confidence?: string;
  scope?: string;
  core?: string;
  facts?: string[];
  questions?: string[];
  demonstration?: string;
} = {}) {
  const facts = overrides.facts ?? ["只靠放大制造重点：其他信息没有形成层级证据。"];
  const questions = overrides.questions ?? [
    "读者三秒内必须先看到哪条信息？",
    "哪些内容应该共享同一条对齐线？",
  ];
  return `---
课程标签: "版式设计"
内容类型: "学理内容"
标题: "用栅格建立信息层级"
来源出处: "旧课程设计文档"
来源类别: "${overrides.sourceCategory ?? "旧课程设计文档"}"
可信度: "${overrides.confidence ?? "教师经验"}"
事实边界: "${overrides.scope ?? "本条只覆盖基础版式关系。"}"
适用问题:
  - "版面内容很多，不知道从哪里排"
  - "做了对齐还是没有重点"
关键词:
  - "信息层级"
  - "栅格"
---

## 核心内容

${overrides.core ?? "先区分主要、次要和支撑信息，再建立对齐关系。"}

## 导师可先追问

${questions.map((question) => `- "${question}"`).join("\n")}

## 提示与局部示范

${overrides.demonstration ?? "只选一条左对齐线，保留修改前后截图作比较。"}

## 常见误区与证据

${facts.map((fact) => `- ${fact}`).join("\n")}

## 使用边界

本条不提供唯一正确的栏数。

## 术语待议

- 无。
`;
}

function convertFixture(markdown: string) {
  return convertCourseCorpusDocument({
    markdown,
    courseDirectory: "layout-design",
    filename: "001-grid-and-hierarchy.md",
    sourceAbsolutePath: path.join(process.cwd(), "data", "courses", "layout-design", "001-grid-and-hierarchy.md"),
  });
}

describe("course corpus conversion", () => {
  it("maps stable ids, topics, provenance, statement prefixes and the required default action", () => {
    const artifact = convertFixture(sourceDocument());

    expect(artifact.item).toMatchObject({
      id: "layout-001-grid-and-hierarchy",
      topic: "LAYOUT_DESIGN_PRINCIPLES",
      source: {
        authority: "COURSE_DESIGN",
        localDocument: "data/courses/layout-design/001-grid-and-hierarchy.md",
        verifiedDate: "2026-07-27",
      },
    });
    expect(artifact.item.facts.every(({ id }) => id.startsWith("layoutprin-"))).toBe(true);
    expect(artifact.item.actions[0]?.id).toBe("layoutprin-clarify-reading-task");
    expect(artifact.item.actions.every(({ id }) => id.startsWith("layoutprin-"))).toBe(true);
    expect(artifact.item.content).toContain("版面内容很多，不知道从哪里排");
  });

  it("produces byte-identical artifacts from LF and CRLF source documents", () => {
    const lfSource = sourceDocument();
    const lfArtifact = convertFixture(lfSource);
    const crlfArtifact = convertFixture(lfSource.replaceAll("\n", "\r\n"));

    expect(Buffer.from(crlfArtifact.markdown).equals(Buffer.from(lfArtifact.markdown))).toBe(true);
    expect(crlfArtifact.markdown).not.toContain("\r");
    expect(crlfArtifact.item).toEqual(lfArtifact.item);
  });

  it.each([
    ["官方资料", "官方事实", "OFFICIAL"],
    ["第三方教研资料", "教师经验", "TEACHER_EXPERIENCE"],
    ["匿名学生作品", "教师经验", "ANONYMIZED_CASE"],
  ] as const)("maps %s / %s to %s", (sourceCategory, confidence, authority) => {
    expect(convertFixture(sourceDocument({ sourceCategory, confidence })).item.source.authority).toBe(authority);
  });

  it("strips URLs, retains only the first source URL, truncates scope and reports every fallback", () => {
    const artifact = convertFixture(sourceDocument({
      scope: "边".repeat(305),
      core: "先看 https://first.example/a ，再看 https://second.example/b 。",
      facts: ["证据见 https://third.example/c ，正文不能保留链接。"],
    }));

    expect(artifact.item.source.url).toBe("https://first.example/a");
    expect(artifact.item.source.scope).toHaveLength(300);
    expect(JSON.stringify(artifact.item)).not.toContain("https://second.example/b");
    expect(JSON.stringify(artifact.item)).not.toContain("https://third.example/c");
    expect(artifact.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "VERIFIED_DATE_FALLBACK" }),
      expect.objectContaining({ kind: "SCOPE_TRUNCATED", originalLength: 305 }),
      expect.objectContaining({
        kind: "EXTRA_URLS_REMOVED",
        retainedUrl: "https://first.example/a",
        removedUrls: ["https://second.example/b", "https://third.example/c"],
      }),
    ]));
  });

  it("fails the whole item with its source path and rejected schema field", () => {
    expect(() => convertFixture(sourceDocument({ facts: ["过".repeat(301)] }))).toThrow(
      /data\/courses\/layout-design\/001-grid-and-hierarchy\.md:.*facts\.0\.text/,
    );
  });

  it("rejects an unknown numbered route instead of silently using a generic topic", () => {
    expect(() => convertCourseCorpusDocument({
      markdown: sourceDocument(),
      courseDirectory: "layout-design",
      filename: "009-unmapped.md",
      sourceAbsolutePath: path.join(process.cwd(), "data", "courses", "layout-design", "009-unmapped.md"),
    })).toThrow("no knowledge topic mapping");
  });

  it("routes the existing brand source documents to BRAND_IDENTITY with brand statement ids", async () => {
    const sourceAbsolutePath = path.join(
      process.cwd(),
      "data",
      "courses",
      "brand-vi-design",
      "001-assess-wordmark-fit.md",
    );
    const artifact = convertCourseCorpusDocument({
      markdown: await readFile(sourceAbsolutePath, "utf8"),
      courseDirectory: "brand-vi-design",
      filename: "001-assess-wordmark-fit.md",
      sourceAbsolutePath,
    });

    expect(artifact.item).toMatchObject({
      id: "brandvi-001-assess-wordmark-fit",
      topic: "BRAND_IDENTITY",
    });
    expect(artifact.item.actions[0]?.id).toBe("brand-clarify-identity-task");
    expect([...artifact.item.facts, ...artifact.item.actions].every(({ id }) => id.startsWith("brand-"))).toBe(true);
  });

  it("reconverts the numbered source corpus byte-for-byte", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lumi-course-corpus-"));
    roots.push(root);
    const outputDirectory = path.join(root, "knowledge");
    const report = await convertCourseCorpus({
      coursesDirectory: path.join(process.cwd(), "data", "courses"),
      knowledgeDirectory: outputDirectory,
    });

    const files = [...report.managedFiles, "course-corpus-conversion-report.json"];
    for (const filename of files) {
      const [actual, committed] = await Promise.all([
        readFile(path.join(outputDirectory, filename)),
        readFile(path.join(process.cwd(), "data", "knowledge", filename)),
      ]);
      expect(actual.equals(committed), filename).toBe(true);
    }
  });

  it("does not write any artifact when one source document is invalid", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lumi-course-corpus-invalid-"));
    roots.push(root);
    const coursesDirectory = path.join(root, "courses");
    const outputDirectory = path.join(root, "knowledge");
    const layoutDirectory = path.join(coursesDirectory, "layout-design");
    await mkdir(layoutDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(layoutDirectory, "001-valid.md"), sourceDocument(), "utf8"),
      writeFile(path.join(layoutDirectory, "002-invalid.md"), sourceDocument({ facts: ["坏".repeat(301)] }), "utf8"),
    ]);

    await expect(convertCourseCorpus({ coursesDirectory, knowledgeDirectory: outputDirectory })).rejects.toThrow(
      "KnowledgeItemSchema rejected conversion",
    );
    await expect(readFile(path.join(outputDirectory, "layout-001-valid.md"))).rejects.toThrow();
  });
});
