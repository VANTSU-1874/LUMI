import { describe, expect, it } from "vitest";

import { isContinuationIntent } from "@/components/assistant-lab/continuation-intent";

describe("isContinuationIntent", () => {
  it.each(["继续", "继续生成", "继续写", "继续回答", "接着写", "接着生成", "续写。"])(
    "routes the bare command %s to the durable continuation run",
    (text) => {
      expect(isContinuationIntent(text)).toBe(true);
    },
  );

  it.each(["继续检索课程资料", "请继续", "继续生成一个新方案", "继续？为什么？"])(
    "keeps a substantive prompt %s as a new user turn",
    (text) => {
      expect(isContinuationIntent(text)).toBe(false);
    },
  );
});
