import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Streamdown } from "streamdown";

import {
  LUMI_TEXT_FENCE_CLASS,
  assistantMarkdownRehypePlugins,
} from "@/components/assistant-lab/markdown-code-blocks";

afterEach(cleanup);

function renderMarkdown(markdown: string) {
  return render(
    <Streamdown
      controls={false}
      mode="static"
      rehypePlugins={assistantMarkdownRehypePlugins}
    >
      {markdown}
    </Streamdown>,
  );
}

function renderedCodeBlocks(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(
    '[data-streamdown="code-block"]',
  ));
}

function isTextFence(block: HTMLElement) {
  return Boolean(block.querySelector(
    `[data-streamdown="code-block-body"].${LUMI_TEXT_FENCE_CLASS}`,
  ));
}

describe("assistant Markdown fenced containers", () => {
  it("only classifies explicit prose aliases while keeping untyped and real code dark", async () => {
    const { container } = renderMarkdown([
      "```",
      "没有语言标识的代码",
      "```",
      "",
      "    四空格缩进代码",
      "",
      "```   text   ",
      "text 标识",
      "```",
      "",
      "~~~ ProSe",
      "prose 标识",
      "~~~",
      "",
      "```plaintext",
      "plaintext 标识",
      "```",
      "",
      "```plain",
      "plain 标识",
      "```",
      "",
      "```txt",
      "txt 标识",
      "```",
      "",
      "```text/plain",
      "text/plain 标识",
      "```",
      "",
      "```unknown-display-language",
      "未知语言保持代码语义",
      "```",
      "",
      "```powershell",
      "Get-ChildItem",
      "```",
      "",
      "```bash",
      "printf '%s\\n' ok",
      "```",
      "",
      "```json",
      '{"ok":true}',
      "```",
    ].join("\n"));

    await waitFor(() => expect(renderedCodeBlocks(container)).toHaveLength(12));
    const blocks = renderedCodeBlocks(container);
    expect(blocks.slice(0, 2).some(isTextFence)).toBe(false);
    expect(blocks.slice(2, 8).every(isTextFence)).toBe(true);
    expect(blocks.slice(8).some(isTextFence)).toBe(false);
  });

  it("keeps native pre/code dark even when raw HTML declares language-text", async () => {
    const { container } = renderMarkdown([
      '<pre><code class="language-text language-lumi-explicit-prose-fence">raw language-text</code></pre>',
      "",
      "<pre><code>raw unlabelled</code></pre>",
      "",
      "## Raw 后标题",
      "",
      "- Raw 后列表",
    ].join("\n"));

    await waitFor(() => expect(renderedCodeBlocks(container)).toHaveLength(2));
    expect(renderedCodeBlocks(container).some(isTextFence)).toBe(false);
    expect(screen.getByRole("heading", { name: "Raw 后标题" })).toBeInTheDocument();
    expect(screen.getByText("Raw 后列表", { selector: "li" })).toBeInTheDocument();
  });

  const containerCases = [
    {
      name: "root",
      markdown: [
        "```   text",
        "根级第一行",
        "根级第二行",
        "```",
        "",
        "## Root 后标题",
        "",
        "- Root 后列表",
      ].join("\n"),
      assertContainer: (block: HTMLElement) => {
        expect(block.closest("li, blockquote")).toBeNull();
      },
      heading: "Root 后标题",
      listItem: "Root 后列表",
      textFence: true,
    },
    {
      name: "unordered list",
      markdown: [
        "- 无序容器",
        "  ```prose",
        "  无序第一行",
        "  无序第二行",
        "  ```",
        "- 无序容器后项目",
        "",
        "## 无序后标题",
        "",
        "- 无序后列表",
      ].join("\n"),
      assertContainer: (block: HTMLElement) => {
        expect(block.closest("li")).not.toBeNull();
      },
      heading: "无序后标题",
      listItem: "无序后列表",
      textFence: true,
    },
    {
      name: "ordered list",
      markdown: [
        "1. 有序容器",
        "   ``` text",
        "   有序第一行",
        "   有序第二行",
        "   ```",
        "2. 有序容器后项目",
        "",
        "## 有序后标题",
        "",
        "- 有序后列表",
      ].join("\n"),
      assertContainer: (block: HTMLElement) => {
        expect(block.closest("ol")).not.toBeNull();
      },
      heading: "有序后标题",
      listItem: "有序后列表",
      textFence: true,
    },
    {
      name: "blockquote",
      markdown: [
        "> 引用容器",
        ">",
        "> ```prose",
        "> 引用第一行",
        "> 引用第二行",
        "> ```",
        ">",
        "> 引用内后续正文",
        "",
        "## 引用后标题",
        "",
        "- 引用后列表",
      ].join("\n"),
      assertContainer: (block: HTMLElement) => {
        expect(block.closest("blockquote")).not.toBeNull();
      },
      heading: "引用后标题",
      listItem: "引用后列表",
      textFence: true,
    },
    {
      name: "nested indentation",
      markdown: [
        "- 外层容器",
        "  1. 内层容器",
        "     ```   text",
        "     嵌套第一行",
        "     嵌套第二行",
        "     ```",
        "  2. 内层容器后项目",
        "",
        "## 嵌套后标题",
        "",
        "- 嵌套后列表",
      ].join("\n"),
      assertContainer: (block: HTMLElement) => {
        expect(block.closest("ol")).not.toBeNull();
        expect(block.closest("ul")).not.toBeNull();
      },
      heading: "嵌套后标题",
      listItem: "嵌套后列表",
      textFence: true,
    },
    {
      name: "unlabelled root code",
      markdown: [
        "```",
        "无语言第一行",
        "无语言第二行",
        "```",
        "",
        "## 无语言后标题",
        "",
        "- 无语言后列表",
      ].join("\n"),
      assertContainer: (block: HTMLElement) => {
        expect(block.closest("li, blockquote")).toBeNull();
      },
      heading: "无语言后标题",
      listItem: "无语言后列表",
      textFence: false,
    },
    {
      name: "indented code",
      markdown: [
        "    缩进第一行",
        "    缩进第二行",
        "",
        "## 缩进后标题",
        "",
        "- 缩进后列表",
      ].join("\n"),
      assertContainer: (block: HTMLElement) => {
        expect(block.closest("li, blockquote")).toBeNull();
      },
      heading: "缩进后标题",
      listItem: "缩进后列表",
      textFence: false,
    },
    {
      name: "unlabelled blockquote code",
      markdown: [
        "> 引用无语言容器",
        ">",
        "> ```",
        "> 引用无语言第一行",
        "> 引用无语言第二行",
        "> ```",
        "",
        "## 引用无语言后标题",
        "",
        "- 引用无语言后列表",
      ].join("\n"),
      assertContainer: (block: HTMLElement) => {
        expect(block.closest("blockquote")).not.toBeNull();
      },
      heading: "引用无语言后标题",
      listItem: "引用无语言后列表",
      textFence: false,
    },
  ] as const;

  it.each(containerCases)(
    "keeps the $name closing fence and following Markdown hierarchy intact",
    async ({ assertContainer, heading, listItem, markdown, textFence }) => {
      const { container } = renderMarkdown(markdown);

      await waitFor(() => expect(renderedCodeBlocks(container)).toHaveLength(1));
      const block = renderedCodeBlocks(container)[0]!;
      expect(isTextFence(block)).toBe(textFence);
      assertContainer(block);
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      expect(screen.getByText(listItem, { selector: "li" })).toHaveAttribute(
        "data-streamdown",
        "list-item",
      );
    },
  );
});
