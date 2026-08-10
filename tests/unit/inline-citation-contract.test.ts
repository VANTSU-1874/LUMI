import { describe, expect, it } from "vitest";

import * as inlineCitationContract from "@/lib/agent/inline-citation-contract";
import type {
  InlineCitationManifest,
  InlineCitationViewer,
} from "@/lib/agent/inline-citation-contract";

type Viewer = { userId: string; role: "STUDENT" | "TEACHER" };
type Range = { startLine: number; endLine: number };
type Block = { blockId: string; range: Range; excerpt: string };
type Display = { title: string; label: string };
type SourceBase = { sourceId: string; display: Display; blocks: Block[] };
type Source =
  | SourceBase & { sourceKind: "MARKDOWN"; documentId: string }
  | SourceBase & { sourceKind: "FILE"; fileId: string }
  | SourceBase & { sourceKind: "WEB"; origin: string; pageUrl: string };
type CitationBase = {
  sourceId: string; title: string; label: string; blockId: string; range: Range; excerpt: string;
};
type Citation =
  | CitationBase & { sourceKind: "MARKDOWN"; documentId: string }
  | CitationBase & { sourceKind: "FILE"; fileId: string }
  | CitationBase & { sourceKind: "WEB"; origin: string; pageUrl: string };

const viewer: Viewer = {
  userId: "student-inline-1",
  role: "STUDENT",
} satisfies InlineCitationViewer;

function manifestFixture() {
  const manifest = {
    format: "INLINE_CITATION_MANIFEST_V1" as const,
    manifestId: "manifest-inline-1",
    revision: 7,
    viewer: { ...viewer },
    sources: [
      {
        sourceId: "source-markdown-1", sourceKind: "MARKDOWN", documentId: "document-course-1",
        display: { title: "版式层级课程说明", label: "课程说明" },
        blocks: [{ blockId: "block-markdown-1", range: { startLine: 10, endLine: 14 }, excerpt: "先明确读者任务，再用对齐关系组织主次信息。" }],
      },
      {
        sourceId: "source-file-1", sourceKind: "FILE", fileId: "file-teacher-1",
        display: { title: "教师提供的课堂材料", label: "课堂材料" },
        blocks: [{ blockId: "block-file-1", range: { startLine: 22, endLine: 25 }, excerpt: "修改前后应保留同一观察条件，才能比较层级变化。" }],
      },
      {
        sourceId: "source-web-1", sourceKind: "WEB", origin: "https://developers.openai.com",
        pageUrl: "https://developers.openai.com/api/docs/guides/tools-web-search",
        display: { title: "公开网页中的检索说明", label: "公开网页" },
        blocks: [{ blockId: "block-web-1", range: { startLine: 30, endLine: 33 }, excerpt: "联网材料需要保留精确页面范围，并在使用前复核原文。" }],
      },
    ] as Source[],
  };
  return manifest satisfies InlineCitationManifest;
}

function candidateFixture() {
  return {
    manifestBinding: { manifestId: "manifest-inline-1", revision: 7 },
    viewerBinding: { ...viewer },
    claims: [{
      claimId: "claim-1",
      claim: "第一段说明判断依据。\r\n\r\n- 第二段保留 Markdown 列表。\r\n- **加粗内容**也保持原样。",
      citations: [
        {
          sourceId: "source-markdown-1", sourceKind: "MARKDOWN", documentId: "document-course-1",
          title: "版式层级课程说明", label: "课程说明", blockId: "block-markdown-1",
          range: { startLine: 10, endLine: 14 }, excerpt: "先明确读者任务，再用对齐关系组织主次信息。",
        },
        {
          sourceId: "source-file-1", sourceKind: "FILE", fileId: "file-teacher-1",
          title: "教师提供的课堂材料", label: "课堂材料", blockId: "block-file-1",
          range: { startLine: 22, endLine: 25 }, excerpt: "修改前后应保留同一观察条件，才能比较层级变化。",
        },
        {
          sourceId: "source-web-1", sourceKind: "WEB", origin: "https://developers.openai.com",
          pageUrl: "https://developers.openai.com/api/docs/guides/tools-web-search",
          title: "公开网页中的检索说明", label: "公开网页", blockId: "block-web-1",
          range: { startLine: 30, endLine: 33 }, excerpt: "联网材料需要保留精确页面范围，并在使用前复核原文。",
        },
      ] as Citation[],
    }],
  };
}

function validInput() {
  return { manifest: manifestFixture(), viewer: { ...viewer }, candidateSet: candidateFixture() };
}

type Input = ReturnType<typeof validInput>;
const parse = inlineCitationContract.parseManifestBoundInlineCitationCandidateSet;
const STAGE_ZERO_ERROR_CODE = "INLINE_CITATION_STAGE_0_REJECTED";

function expectStageZeroRejection(operation: () => unknown, reason?: string) {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({
    name: "InlineCitationStage0Error",
    code: STAGE_ZERO_ERROR_CODE,
    message: STAGE_ZERO_ERROR_CODE,
    ...(reason ? { reason } : {}),
  });
}

function source(input: Input, index: number) {
  return input.manifest.sources[index]!;
}

function citation(input: Input, index: number) {
  return input.candidateSet.claims[0]!.citations[index]!;
}

describe("inline citation Stage 0 contract", () => {
  it("has one runtime export and rejects an unbound raw candidate", () => {
    expect(Object.keys(inlineCitationContract)).toEqual(["parseManifestBoundInlineCitationCandidateSet"]);
    expectStageZeroRejection(
      () => (parse as (input: unknown) => unknown)(candidateFixture()),
      "INVALID_INPUT",
    );
    type RuntimeExport = keyof typeof inlineCitationContract;
    const publicEntry: RuntimeExport = "parseManifestBoundInlineCitationCandidateSet";
    // @ts-expect-error raw executable schemas must remain private
    const forbiddenEntry: RuntimeExport = "RawCandidateSetSchema";
    expect([publicEntry, forbiddenEntry]).toEqual([
      "parseManifestBoundInlineCitationCandidateSet", "RawCandidateSetSchema",
    ]);
  });

  it("returns only manifest/viewer-bound, frozen Stage 0 no-render candidates", () => {
    const parsed = parse(validInput());
    expect(parsed).toMatchObject({
      stage: "STAGE_0_CANDIDATE", renderPolicy: "DO_NOT_RENDER", viewerBinding: viewer,
      manifestBinding: {
        manifestId: "manifest-inline-1", revision: 7,
        manifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    expect(parsed.claims[0]!.claim).toContain("\n\n- 第二段");
    expect(parsed.claims[0]!.citations.map(({ sourceKind }) => sourceKind)).toEqual(["MARKDOWN", "FILE", "WEB"]);
    for (const guarded of [parsed, parsed.claims[0]!, ...parsed.claims[0]!.citations]) {
      expect(guarded).toMatchObject({ stage: "STAGE_0_CANDIDATE", renderPolicy: "DO_NOT_RENDER" });
      expect(Object.isFrozen(guarded)).toBe(true);
    }
    expect(Object.isFrozen(parsed.claims[0]!.citations[0]!.range)).toBe(true);
    expect(parse(validInput()).manifestBinding.manifestDigest).toBe(parsed.manifestBinding.manifestDigest);
  });

  it.each([
    ["manifest revision", (input: Input) => { input.candidateSet.manifestBinding.revision = 6; }, "MANIFEST"],
    ["external viewer", (input: Input) => { input.viewer.userId = "student-other"; }, "VIEWER"],
    ["declared viewer", (input: Input) => { input.candidateSet.viewerBinding.role = "TEACHER"; }, "VIEWER"],
    ["source", (input: Input) => { citation(input, 0).sourceId = "source-other"; }, "SOURCE"],
    ["title", (input: Input) => { citation(input, 0).title = "另一标题"; }, "DISPLAY"],
    ["label", (input: Input) => { citation(input, 0).label = "另一标签"; }, "DISPLAY"],
    ["block", (input: Input) => { citation(input, 0).blockId = "block-other"; }, "BLOCK"],
    ["range", (input: Input) => { citation(input, 0).range.endLine = 13; }, "RANGE"],
    ["excerpt", (input: Input) => { citation(input, 0).excerpt = "另一段摘录"; }, "EXCERPT"],
    ["document", (input: Input) => { (citation(input, 0) as Extract<Citation, { sourceKind: "MARKDOWN" }>).documentId = "document-other"; }, "DOCUMENT"],
    ["file", (input: Input) => { (citation(input, 1) as Extract<Citation, { sourceKind: "FILE" }>).fileId = "file-other"; }, "FILE"],
    ["web origin", (input: Input) => {
      const web = citation(input, 2) as Extract<Citation, { sourceKind: "WEB" }>;
      web.origin = "https://platform.openai.com"; web.pageUrl = "https://platform.openai.com/docs";
    }, "WEB_ORIGIN"],
    ["web page", (input: Input) => {
      (citation(input, 2) as Extract<Citation, { sourceKind: "WEB" }>).pageUrl = "https://developers.openai.com/api/docs";
    }, "WEB_PAGE"],
  ] as const)("rejects unauthorized %s drift", (_name, mutate, code) => {
    const input = validInput();
    mutate(input);
    expectStageZeroRejection(() => parse(input), `${code}_NOT_AUTHORIZED`);
  });

  it("binds block/range/source membership to the exact manifest revision", () => {
    const old = validInput();
    old.manifest.revision = 6;
    old.manifest.sources = old.manifest.sources.slice(0, 1);
    old.candidateSet.manifestBinding.revision = 6;
    old.candidateSet.claims[0]!.citations = old.candidateSet.claims[0]!.citations.slice(0, 1);
    expect(() => parse(old)).not.toThrow();

    const unlisted = validInput();
    unlisted.manifest.revision = 6;
    unlisted.manifest.sources = unlisted.manifest.sources.slice(0, 1);
    unlisted.candidateSet.manifestBinding.revision = 6;
    unlisted.candidateSet.claims[0]!.citations = unlisted.candidateSet.claims[0]!.citations.slice(2);
    expectStageZeroRejection(() => parse(unlisted), "SOURCE_NOT_AUTHORIZED");
  });

  it.each([
    ["origin path", (input: Input) => {
      (source(input, 2) as Extract<Source, { sourceKind: "WEB" }>).origin = "https://developers.openai.com/api";
    }],
    ["HTTP page", (input: Input) => {
      (source(input, 2) as Extract<Source, { sourceKind: "WEB" }>).pageUrl = "http://developers.openai.com/api";
    }],
    ["private host", (input: Input) => {
      const web = source(input, 2) as Extract<Source, { sourceKind: "WEB" }>;
      web.origin = "https://127.0.0.1"; web.pageUrl = "https://127.0.0.1/private";
    }],
    ["cross-origin page", (input: Input) => {
      (source(input, 2) as Extract<Source, { sourceKind: "WEB" }>).pageUrl = "https://platform.openai.com/docs";
    }],
    ["malformed percent escape", (input: Input) => { (source(input, 2) as Extract<Source, { sourceKind: "WEB" }>).pageUrl += "/%zz"; }],
  ] as const)("rejects invalid web %s without leaking schema diagnostics", (_name, mutate) => {
    const input = validInput();
    mutate(input);
    expectStageZeroRejection(() => parse(input), "INVALID_INPUT");
  });

  it("canonicalizes percent hex case and unreserved escapes before exact web-page binding", () => {
    const input = validInput();
    const manifestWeb = source(input, 2) as Extract<Source, { sourceKind: "WEB" }>;
    const candidateWeb = citation(input, 2) as Extract<Citation, { sourceKind: "WEB" }>;
    manifestWeb.pageUrl = "https://developers.openai.com/api/%7euser/%e4%b8%ad/%2fasset?q=%7e&plus=%2b";
    candidateWeb.pageUrl = "https://developers.openai.com/api/~user/%E4%B8%AD/%2Fasset?q=~&plus=%2B";

    const parsed = parse(input);
    expect(parsed.claims[0]!.citations[2]).toMatchObject({
      pageUrl: "https://developers.openai.com/api/~user/%E4%B8%AD/%2Fasset?q=~&plus=%2B",
    });
  });

  const locators = [
    "请阅读 设计稿.psd 再继续", "请阅读guide.md再继续", "请阅读 资产.abc123 再继续",
    "请查看 草图.源文件 再继续", "设计稿..psd", "file..psd", "file。。psd", "file．。psd", "file。．psd", "请阅读 🎨.7z 再继续", "请阅读 .env 再继续", "请阅读 a/b 再继续",
    "请阅读 课程/讲义 再继续", "请阅读 作品/✨ 再继续", "请阅读 a\\b 再继续",
    "请阅读 a/b\\c 再继续", "请阅读 /a 再继续", "请阅读 ./a 再继续",
    "请阅读 ../课程 再继续", "请阅读 C:\\课\\a 再继续", "请阅读 \\\\server\\a 再继续",
    "请阅读 课程／讲义 再继续", "请阅读 a/\u200bb 再继续", "请访问 例子.中国 再继续",
    "请访问 例子。中国 再继续", "www。例子。中国", "例子。рф", "www。例子。рф", "例子内容。한국주소", "デザイン例。한국주소", "请访问：例子网站。中国域名", "请访问 明暗层级。视觉节奏", "设计稿。psd", "请阅读 设计稿。psd 再继续",
    "C:课程", "请打开 C:课程", "请打开C:课程", "请从vscode:workspace打开", "example.\u180Ecom", "[课程]: guide", "请阅读 3.5psd 和 file1.2", "请访问 203.0.113.8 再继续",
    "请访问 उदाहरण.भारत 再继续", "请访问 xn--fsqu00a.xn--fiqs8s 再继续",
    "请核对 developers.openai.com/docs 中的说明", "请核对 //developers.openai.com/docs",
    "请从 obsidian://open?vault=course 打开", "请从 vscode:workspace 打开",
    "请用 mailto:teacher@school.edu 联系", "请发给 teacher@school 联系",
    "请解码 docs%2Fguide 后继续", "a&amp;#x2f;b", "a&amp;#47;b", "a&amp;sol;b", "请从vscode&amp;#58;workspace打开", "a%EF%BC%8Fb", "file%EF%BC%8Epsd", "a%252Fb", "a%2525252Fb", "a%2F%FFb", "a%FF%2Fb", "file%2E%FFpsd", "a%252F%25FFb", "a%2Gb", "file%ZZpsd", "请阅读 [课程说明](guide)", "[外层 [内层]](guide)", "![外层 [内层]](guide)", "[说明](guide_(v2))", "[例子内容。한국주소](guide)", "请阅读 [[课程讲义]]", "[课程\n说明]: guide\n\n[课程\n说明]",
    "请阅读 <a href=\"guide\">课程说明</a>",
  ];
  const displayTargets = [
    ["claim", (input: Input, value: string) => { input.candidateSet.claims[0]!.claim = value; }],
    ["candidate title", (input: Input, value: string) => { citation(input, 0).title = value; }],
    ["candidate label", (input: Input, value: string) => { citation(input, 0).label = value; }],
    ["candidate excerpt", (input: Input, value: string) => { citation(input, 0).excerpt = value; }],
    ["manifest title", (input: Input, value: string) => { source(input, 0).display.title = value; }],
    ["manifest label", (input: Input, value: string) => { source(input, 0).display.label = value; }],
    ["manifest excerpt", (input: Input, value: string) => { source(input, 0).blocks[0]!.excerpt = value; }],
  ] as const;

  it.each(locators)("rejects multilingual locator token: %s", (locator) => {
    for (const [target, inject] of displayTargets) {
      const input = validInput(); inject(input, locator);
      try {
        parse(input);
        throw new Error(`expected ${target} to reject a locator`);
      } catch (error) {
        expect(error, target).toMatchObject({
          code: STAGE_ZERO_ERROR_CODE,
          reason: "INVALID_INPUT",
          message: STAGE_ZERO_ERROR_CODE,
        });
      }
    }
  });

  it.each([
    "明暗层级观察说明",
    "先观察明暗层级，再用小范围对照验证判断。下一步比较留白与字号。",
    "Observe contrast, hierarchy, and alignment before revising the composition.",
    "版本 1.2 使用 1.5 倍行距，尺寸为 8.5 × 11 英寸。",
    "版本 v1.2 已发布", "尺寸为 3.5mm",
    "版本v1.2已发布，尺寸为3.5mm并已确认。",
    "图1.2 构图关系；第1.2节讲解明暗层级；编号 1.2.3 与编号A1.2。",
    "明暗层级。视觉节奏", "你好。世界", "光。影", "目标。方法。结果", "例子。中国",
    "普通中文。下一句仍然是设计说明。", "普通文字保留 &amp; 和 50% 标记", "完成度50%且保持原文", "编码示例 %E4%B8%AD 仅作文字说明",
    "色彩可以从 #FFFFFF 调整到 #111111，并用 A—B 对照记录变化。", "方案A:先观察层级，方案B:再调整留白。", "练习A:明暗层级",
    "## 观察步骤\n\n1. 先看视觉重心。\n2. 再比较字号与留白。",
  ])("keeps ordinary multilingual course/design text legal: %s", (text) => {
    const input = validInput();
    input.candidateSet.claims[0]!.claim = text;
    input.candidateSet.claims[0]!.citations[0]!.title = "明暗层级观察说明";
    input.manifest.sources[0]!.display.title = "明暗层级观察说明";
    expect(parse(input).claims[0]!.claim).toBe(text);
  });

  it("fails closed on duplicate manifest membership and raw extra fields", () => {
    const duplicate = validInput();
    duplicate.manifest.sources.push(structuredClone(duplicate.manifest.sources[0]!));
    expectStageZeroRejection(() => parse(duplicate), "INVALID_INPUT");

    const extra = validInput();
    Object.assign(extra.candidateSet.claims[0]!, { href: "hidden" });
    expectStageZeroRejection(() => parse(extra), "INVALID_INPUT");
  });
});
