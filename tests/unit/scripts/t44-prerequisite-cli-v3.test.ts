// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  parseT44PrerequisiteArguments,
} from "@/scripts/evaluate-t44-prerequisite-v3";

describe("T4.4 prerequisite CLI arguments", () => {
  it("accepts only a visible DEV candidate and explicit output", () => {
    expect(parseT44PrerequisiteArguments([
      "--output",
      ".runtime/mixed-retrieval/t44-route-candidate-3.json",
      "--candidate",
      "route-candidate-3",
      "--split",
      "DEV",
    ])).toEqual({
      output:
        ".runtime/mixed-retrieval/t44-route-candidate-3.json",
      candidateId: "route-candidate-3",
      split: "DEV",
    });
  });

  it("rejects unauthorized splits, extra candidates, and unknown arguments", () => {
    expect(() => parseT44PrerequisiteArguments([
      "--output", "report.json",
      "--candidate", "route-candidate-3",
      "--split", "SEALED_EVAL",
    ])).toThrow(/ONLY_VISIBLE_DEV_IS_AUTHORIZED/);
    expect(() => parseT44PrerequisiteArguments([
      "--output", "report.json",
      "--candidate", "route-candidate-4",
    ])).toThrow();
    expect(() => parseT44PrerequisiteArguments([
      "--output", "report.json",
      "--candidate", "route-candidate-3",
      "--questions", "secret.json",
    ])).toThrow(/UNKNOWN_ARGUMENT/);
  });
});
