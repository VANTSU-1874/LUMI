// @vitest-environment node

import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/touchdesigner-node-catalog/route";
import { STUDIO_FAMILIES, type NodeCatalogResponse } from "@/lib/touchdesigner/node-catalog-shared";

describe("TouchDesigner node catalog route", () => {
  it("aggregates the active course projects and exposes all seven families", async () => {
    const response = await GET();
    const body = await response.json() as NodeCatalogResponse;

    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(body.totals.courseEntries).toBe(167);
    expect(body.totals.families).toBe(7);
    expect(body.entries.length).toBeGreaterThan(body.totals.courseEntries);
    expect(new Set(body.entries.map((entry) => entry.family))).toEqual(new Set(STUDIO_FAMILIES));
    expect(body.entries).toContainEqual(expect.objectContaining({ family: "CHOP", operatorType: "audiodevin", chineseName: "音频设备输入", browserRunnable: true }));
    expect(body.entries).toContainEqual(expect.objectContaining({ family: "POP", operatorType: "pointgenerator", chineseName: "点生成器", source: "POP_STARTER" }));
  });
});
