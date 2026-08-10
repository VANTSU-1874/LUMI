import { describe, expect, it } from "vitest";

import { chooseToolPath } from "@/lib/services/tool-path";

describe("chooseToolPath", () => {
  it("prioritizes collaboration when physical, realtime, and OSC are all required", () => {
    expect(
      chooseToolPath("L1", {
        needsRealtimeVisuals: true,
        needsPhysicalControl: true,
        hasOsc: true,
      }).path,
    ).toBe("COLLABORATIVE");
  });

  it("keeps collaboration for physical plus realtime without OSC and adds setup evidence", () => {
    const result = chooseToolPath("L2", {
      needsRealtimeVisuals: true,
      needsPhysicalControl: true,
      hasOsc: false,
    });

    expect(result.path).toBe("COLLABORATIVE");
    expect(result.reasons.join(" ")).toContain("配置 OSC");
    expect(result.milestones).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "collab-osc-setup", requiredEvidenceLabel: expect.stringContaining("OSC") }),
    ]));
  });

  it("uses an allowed realtime path with learning support when L1 cannot use DigiShow", () => {
    const result = chooseToolPath(
      "L1",
      { needsRealtimeVisuals: true, needsPhysicalControl: false, hasOsc: false },
      ["TOUCHDESIGNER"],
    );
    expect(result.path).toBe("TOUCHDESIGNER");
    expect(result.reasons.join(" ")).toContain("学习支撑");
  });

  it.each([
    ["L4", { needsRealtimeVisuals: false, needsPhysicalControl: true, hasOsc: false }],
    ["L1", { needsRealtimeVisuals: true, needsPhysicalControl: false, hasOsc: false }],
  ] as const)("uses DigiShow for physical work or L1 learners", (level, requirements) => {
    expect(chooseToolPath(level, requirements).path).toBe("DIGISHOW");
  });

  it("uses TouchDesigner for realtime visuals when collaboration is unnecessary", () => {
    expect(
      chooseToolPath("L3", {
        needsRealtimeVisuals: true,
        needsPhysicalControl: false,
        hasOsc: true,
      }).path,
    ).toBe("TOUCHDESIGNER");
  });

  it("defaults an L2 project without realtime or physical needs to DigiShow", () => {
    expect(
      chooseToolPath("L2", {
        needsRealtimeVisuals: false,
        needsPhysicalControl: false,
        hasOsc: false,
      }).path,
    ).toBe("DIGISHOW");
  });

  it.each(["DIGISHOW", "TOUCHDESIGNER", "COLLABORATIVE"] as const)(
    "returns explainable reasons and evidence milestones for %s",
    (expectedPath) => {
      const requirements =
        expectedPath === "COLLABORATIVE"
          ? { needsRealtimeVisuals: true, needsPhysicalControl: true, hasOsc: true }
          : expectedPath === "TOUCHDESIGNER"
            ? { needsRealtimeVisuals: true, needsPhysicalControl: false, hasOsc: false }
            : { needsRealtimeVisuals: false, needsPhysicalControl: false, hasOsc: false };
      const result = chooseToolPath("L3", requirements);

      expect(result.path).toBe(expectedPath);
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(result.reasons.every((reason) => reason.trim().length > 0)).toBe(true);
      expect(result.milestones.length).toBeGreaterThanOrEqual(3);
      expect(result.milestones).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            title: expect.any(String),
            requiredEvidenceLabel: expect.any(String),
          }),
        ]),
      );
      expect(result.milestones.every((item) => item.requiredEvidenceLabel.length > 0)).toBe(true);
    },
  );
});
