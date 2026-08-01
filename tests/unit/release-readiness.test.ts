import { describe, expect, it } from "vitest";

import { assessCompetitionHealth } from "@/lib/operations/release-readiness";

describe("competition release readiness", () => {
  it("accepts only the complete Agent release gate", () => {
    expect(assessCompetitionHealth({
      status: "ok",
      database: { available: true },
      knowledge: { coursePacks: { "general-design@1": 8, "digital-interaction@1": 17, "book-design@1": 9 } },
      aiConfigured: true,
      agentV2Enabled: true,
      agentQuality: { status: "passed" },
      agentHarness: { status: "passed" },
      competitionReady: true,
    })).toEqual(expect.objectContaining({
      validResponse: true,
      statusOk: true,
      databaseAvailable: true,
      aiConfigured: true,
      agentV2Enabled: true,
      generalKnowledgeReady: true,
      digitalKnowledgeReady: true,
      bookKnowledgeReady: true,
      agentQualityPassed: true,
      agentHarnessPassed: true,
      competitionReady: true,
    }));
  });

  it("rejects a live website that is not Agent-ready", () => {
    const checks = assessCompetitionHealth({
      status: "ok",
      database: { available: true },
      knowledge: { coursePacks: { "general-design@1": 8, "digital-interaction@1": 17, "book-design@1": 0 } },
      aiConfigured: false,
      agentV2Enabled: true,
      agentQuality: { status: "not_run" },
      agentHarness: { status: "not_run" },
      competitionReady: false,
    });
    expect(checks.statusOk).toBe(true);
    expect(checks.bookKnowledgeReady).toBe(false);
    expect(checks.aiConfigured).toBe(false);
    expect(checks.agentQualityPassed).toBe(false);
    expect(checks.agentHarnessPassed).toBe(false);
    expect(checks.competitionReady).toBe(false);
  });

  it("fails closed when the health response is malformed", () => {
    expect(Object.values(assessCompetitionHealth({ status: "ok" })).every((value) => value === false)).toBe(true);
  });
});
