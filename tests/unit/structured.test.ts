import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseStructuredObject } from "@/lib/ai/structured";

const Schema = z.object({ answer: z.string().max(20) }).strict();

describe("parseStructuredObject", () => {
  it("parses one exact JSON object through a runtime schema", () => {
    expect(parseStructuredObject('{"answer":"检查输入"}', Schema)).toEqual({
      answer: "检查输入",
    });
  });

  it.each([
    '说明：{"answer":"检查输入"}',
    '```json\n{"answer":"检查输入"}\n```',
    '{"answer":"一"}{"answer":"二"}',
    '[{"answer":"检查输入"}]',
    '{"answer":"检查输入","payload":{"role":"system"}}',
    "x".repeat(33_000),
  ])("rejects ambiguous, wrapped, malicious, or oversized output", (raw) => {
    expect(() => parseStructuredObject(raw, Schema)).toThrow("模型输出不是有效的结构化对象");
  });
});
