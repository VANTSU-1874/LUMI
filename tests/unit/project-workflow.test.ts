import { describe, expect, it } from "vitest";

import {
  canEnterTransfer,
  nextStageAfterLogicReview,
} from "@/lib/services/project-workflow";

describe("project workflow gates", () => {
  it.each([
    [true, true, "TOOL_PATH"],
    [true, false, "LOGIC_CARD"],
    [false, true, "LOGIC_CARD"],
    [false, false, "LOGIC_CARD"],
  ] as const)(
    "moves from logic review with ruleReady=%s and semanticReady=%s",
    (ruleReady, semanticReady, expected) => {
      expect(nextStageAfterLogicReview(ruleReady, semanticReady)).toBe(expected);
    },
  );

  it.each([
    ["BUILD", 3, true],
    ["TROUBLESHOOT", 4, true],
    ["BUILD", 2, false],
    ["TOOL_PATH", 3, false],
    ["TRANSFER", 3, false],
  ] as const)("checks transfer entry from %s with %s evidence", (stage, count, expected) => {
    expect(canEnterTransfer(stage, count)).toBe(expected);
  });
});
