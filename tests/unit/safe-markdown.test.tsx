import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SafeMarkdown } from "@/components/common/SafeMarkdown";

afterEach(cleanup);

describe("SafeMarkdown", () => {
  it("renders teaching structure, lists, inline emphasis, and code without executing HTML", () => {
    const { container } = render(<SafeMarkdown>{[
      "## 先检查信息层级",
      "",
      "1. **主标题**先建立视觉锚点",
      "2. 用 `line-height` 拉开正文节奏",
      "",
      "> 这是诊断顺序，不是唯一答案。",
      "",
      "```css",
      ".title { line-height: 1.1; }",
      "```",
      "",
      "[查看规范](https://example.com/guide)",
      "<script>window.hacked = true</script>",
    ].join("\n")}</SafeMarkdown>);

    expect(screen.getByRole("heading", { name: "先检查信息层级", level: 4 })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("主标题").tagName).toBe("STRONG");
    expect(screen.getByText("line-height").tagName).toBe("CODE");
    expect(screen.getByText(".title { line-height: 1.1; }")).toBeInTheDocument();
    expect(screen.getByText("代码示例")).toBeInTheDocument();
    expect(screen.getByText("查看规范").tagName).toBe("SPAN");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>window.hacked = true</script>")).toBeInTheDocument();
  });

  it("does not turn unsafe or credential-bearing URLs into links", () => {
    render(<SafeMarkdown>{[
      "[危险链接](javascript:alert(1))",
      "[带凭据链接](https://user:secret@example.com/private)",
    ].join("\n")}</SafeMarkdown>);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/危险链接/)).toBeInTheDocument();
    expect(screen.getByText(/带凭据链接/)).toBeInTheDocument();
  });

  it("keeps an unfinished streamed code fence readable until the final chunk arrives", () => {
    render(<SafeMarkdown>{"```js\nconst frame = 24;"}</SafeMarkdown>);

    expect(screen.getByText("const frame = 24;")).toBeInTheDocument();
    expect(screen.getByText("js")).toBeInTheDocument();
  });
});
