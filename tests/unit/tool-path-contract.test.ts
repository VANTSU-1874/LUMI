import { describe, expect, it } from "vitest";

import {
  AllowedToolPathsSchema,
  ToolPathPlanResponseSchema,
  ToolPathRequirementsSchema,
} from "@/lib/domain/tool-path";

describe("tool path contracts", () => {
  it("requires exactly the three boolean requirements", () => {
    expect(ToolPathRequirementsSchema.safeParse({
      needsRealtimeVisuals: true,
      needsPhysicalControl: false,
      hasOsc: false,
    }).success).toBe(true);
    expect(ToolPathRequirementsSchema.safeParse({ needsRealtimeVisuals: true }).success).toBe(false);
    expect(ToolPathRequirementsSchema.safeParse({
      needsRealtimeVisuals: true,
      needsPhysicalControl: false,
      hasOsc: false,
      path: "DIGISHOW",
    }).success).toBe(false);
  });

  it("rejects malformed or duplicate teacher tool restrictions", () => {
    expect(AllowedToolPathsSchema.safeParse(["DIGISHOW", "TOUCHDESIGNER"]).success).toBe(true);
    expect(AllowedToolPathsSchema.safeParse({ path: "DIGISHOW" }).success).toBe(false);
    expect(AllowedToolPathsSchema.safeParse(["DIGISHOW", "DIGISHOW"]).success).toBe(false);
  });

  it("rejects malformed reasons, milestones, and timestamps in a response", () => {
    const valid = {
      plan: {
        projectId: "project-1",
        path: "DIGISHOW",
        requirements: { needsRealtimeVisuals: false, needsPhysicalControl: false, hasOsc: false },
        reasons: ["原因"],
        milestones: [
          { id: "m1", title: "完成输入", requiredEvidenceLabel: "输入截图" },
          { id: "m2", title: "完成映射", requiredEvidenceLabel: "映射截图" },
          { id: "m3", title: "完成原型", requiredEvidenceLabel: "原型截图" },
        ],
        stage: "BUILD",
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
    };
    expect(ToolPathPlanResponseSchema.safeParse(valid).success).toBe(true);
    expect(ToolPathPlanResponseSchema.safeParse({ ...valid, plan: { ...valid.plan, reasons: {} } }).success).toBe(false);
    expect(ToolPathPlanResponseSchema.safeParse({ ...valid, plan: { ...valid.plan, milestones: [{ id: "m1" }] } }).success).toBe(false);
    expect(ToolPathPlanResponseSchema.safeParse({ ...valid, plan: { ...valid.plan, createdAt: "today" } }).success).toBe(false);
  });

  it.each([1, 2])("rejects a plan with only %s milestones", (count) => {
    const milestones = Array.from({ length: count }, (_, index) => ({
      id: `m${index}`,
      title: `里程碑${index}`,
      requiredEvidenceLabel: `证据${index}`,
    }));
    expect(ToolPathPlanResponseSchema.safeParse({
      plan: {
        projectId: "project-1",
        path: "DIGISHOW",
        requirements: { needsRealtimeVisuals: false, needsPhysicalControl: false, hasOsc: false },
        reasons: ["原因"],
        milestones,
        stage: "BUILD",
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
    }).success).toBe(false);
  });
});
