// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  parseT44SupportRerankerArguments,
} from "@/scripts/evaluate-t44-support-reranker-v3";

describe("T4.4 support reranker CLI arguments", () => {
  it("accepts only visible DEV with an explicit output", () => {
    const parsed = parseT44SupportRerankerArguments([
      "--output",
      ".runtime/mixed-retrieval/t44-support-reranker-base.json",
      "--split",
      "DEV",
    ]);

    expect(parsed.output).toBe(
      ".runtime/mixed-retrieval/t44-support-reranker-base.json",
    );
    expect(parsed.split).toBe("DEV");
    expect(parsed.device).toBe("cuda");
  });

  it("rejects unauthorized splits and unknown arguments", () => {
    expect(() => parseT44SupportRerankerArguments([
      "--output", "report.json",
      "--split", "SEALED_EVAL",
    ])).toThrow(/ONLY_VISIBLE_DEV_IS_AUTHORIZED/);
    expect(() => parseT44SupportRerankerArguments([
      "--output", "report.json",
      "--qrels", "labels.json",
    ])).toThrow(/UNKNOWN_ARGUMENT/);
  });

  it("rejects any heldout-named path before filesystem access", () => {
    expect(() => parseT44SupportRerankerArguments([
      "--output",
      ".runtime/mixed-retrieval/heldout-report.json",
    ])).toThrow(/HELDOUT_PATH_NOT_AUTHORIZED/);
  });
});
