import { describe, expect, it } from "vitest";

import {
  MAX_CONTINUATION_CONTEXT_CHARS,
  appendContinuationText,
  continuationContextTail,
} from "@/lib/agent/continuation-text";

describe("continuation learner-visible text", () => {
  it("removes only an exact interruption-boundary overlap", () => {
    expect(appendContinuationText(
      "先完成标题层级，再检查字距。",
      "再检查字距。接着统一留白。",
    )).toBe("先完成标题层级，再检查字距。接着统一留白。");
  });

  it("does not normalise or silently rewrite Markdown at the seam", () => {
    expect(appendContinuationText("- 第一项\n", "- 第二项\n")).toBe("- 第一项\n- 第二项\n");
  });

  it("limits model context to the tail of visible text", () => {
    const text = "a".repeat(MAX_CONTINUATION_CONTEXT_CHARS + 12);
    expect(continuationContextTail(text)).toBe("a".repeat(MAX_CONTINUATION_CONTEXT_CHARS));
  });
});
