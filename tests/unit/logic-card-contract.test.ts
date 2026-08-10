import { describe, expect, it } from "vitest";

import { LogicCardResponseSchema } from "@/lib/domain/logic-card-contract";

const approved = {
  projectId: "project-1",
  revision: 1,
  cardHash: "a".repeat(64),
  ruleReady: true,
  semanticReady: true,
  status: "APPROVED",
  source: "test",
  issues: [],
  stage: "TOOL_PATH",
};

describe("LogicCardResponseSchema", () => {
  it("accepts a consistent approved response", () => {
    expect(LogicCardResponseSchema.parse(approved)).toEqual(approved);
  });

  it.each([
    { semanticReady: false },
    { ruleReady: false },
    { stage: "LOGIC_CARD" },
    { status: "PENDING" },
  ])("rejects a contradictory unlock response", (change) => {
    expect(LogicCardResponseSchema.safeParse({ ...approved, ...change }).success).toBe(false);
  });
});
