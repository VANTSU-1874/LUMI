// @vitest-environment node

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DesignCalculatorInputSchema,
  DesignCalculatorOutputSchema,
  designCalculatorTool,
} from "@/lib/agent/tools/calculation-tools";

function calculate(input: unknown) {
  return DesignCalculatorOutputSchema.parse(
    designCalculatorTool.execute({} as never, { calculation: input }),
  );
}

describe("design parameter calculator", () => {
  it("computes opaque sRGB contrast and evaluates thresholds without model arithmetic", () => {
    expect(calculate({
      kind: "COLOR_CONTRAST",
      foreground: "#000",
      background: "#ffffff",
    })).toEqual({
      kind: "COLOR_CONTRAST",
      foreground: "#000000",
      background: "#FFFFFF",
      foregroundLuminance: 0,
      backgroundLuminance: 1,
      ratio: 21,
      scope: expect.stringContaining("不透明 sRGB"),
      passes: {
        normalTextAA: true,
        normalTextAAA: true,
        largeTextAA: true,
        largeTextAAA: true,
        nonTextUIAA: true,
      },
    });
    const nearTextThreshold = calculate({
      kind: "COLOR_CONTRAST",
      foreground: "#777777",
      background: "#FFFFFF",
    });
    expect(nearTextThreshold).toMatchObject({
      passes: { normalTextAA: false, largeTextAA: true },
    });
    expect(nearTextThreshold.kind === "COLOR_CONTRAST" ? nearTextThreshold.ratio : 0)
      .toBeCloseTo(4.478089454, 9);
    const belowThreshold = calculate({
      kind: "COLOR_CONTRAST",
      foreground: "#9A6C5A",
      background: "#FFFFFF",
    });
    expect(belowThreshold).toMatchObject({ passes: { normalTextAA: false } });
    expect(belowThreshold.kind === "COLOR_CONTRAST" ? belowThreshold.ratio : 0)
      .toBeLessThan(4.5);
  });

  it("computes a bounded multi-column layout grid", () => {
    expect(calculate({
      kind: "LAYOUT_GRID",
      unit: "MM",
      page: { width: 210, height: 297 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      columns: 12,
      gutter: 4,
    })).toEqual({
      kind: "LAYOUT_GRID",
      unit: "MM",
      page: { width: 210, height: 297 },
      content: { width: 170, height: 257 },
      columns: 12,
      gutter: 4,
      totalGutterWidth: 44,
      columnWidth: 10.5,
    });
    const tinyPositiveGrid = calculate({
      kind: "LAYOUT_GRID",
      unit: "MM",
      page: { width: 1, height: 1 },
      margins: { top: 0, right: 0.4999999, bottom: 0, left: 0.5 },
      columns: 1,
      gutter: 0,
    });
    expect(tinyPositiveGrid.kind === "LAYOUT_GRID" ? tinyPositiveGrid.content.width : 0)
      .toBeGreaterThan(0);
    expect(tinyPositiveGrid.kind === "LAYOUT_GRID" ? tinyPositiveGrid.columnWidth : 0)
      .toBeGreaterThan(0);
  });

  it("compares normal and rotated uniform sheet imposition", () => {
    const result = calculate({
      kind: "SHEET_YIELD",
      sheet: { widthMm: 889, heightMm: 1194 },
      item: { widthMm: 210, heightMm: 285 },
      edgeMarginMm: 10,
      gapMm: 3,
      allowRotate: true,
    });
    expect(result).toMatchObject({
      kind: "SHEET_YIELD",
      usableSheet: { widthMm: 869, heightMm: 1174 },
      selected: { orientation: "NORMAL", across: 4, down: 4, count: 16 },
    });
    expect(result.kind === "SHEET_YIELD" ? result.alternatives : []).toContainEqual(
      expect.objectContaining({ orientation: "ROTATED", across: 3, down: 5, count: 15 }),
    );
    expect(result.kind === "SHEET_YIELD" ? result.scope : "").toContain("不含混排");
    expect(calculate({
      kind: "SHEET_YIELD",
      sheet: { widthMm: 0.3, heightMm: 0.3 },
      item: { widthMm: 0.1, heightMm: 0.1 },
      edgeMarginMm: 0,
      gapMm: 0,
      allowRotate: false,
    })).toMatchObject({
      selected: { across: 3, down: 3, count: 9 },
    });
    expect(calculate({
      kind: "SHEET_YIELD",
      sheet: { widthMm: 100, heightMm: 100 },
      item: { widthMm: 120, heightMm: 120 },
      edgeMarginMm: 0,
      gapMm: 0,
      allowRotate: true,
    })).toMatchObject({
      selected: { count: 0 },
      alternatives: [{ count: 0 }, { count: 0 }],
    });
    const tinyPositiveSheet = calculate({
      kind: "SHEET_YIELD",
      sheet: { widthMm: 0.1, heightMm: 0.1 },
      item: { widthMm: 0.1, heightMm: 0.1 },
      edgeMarginMm: 0.04999995,
      gapMm: 0,
      allowRotate: false,
    });
    expect(tinyPositiveSheet.kind === "SHEET_YIELD" ? tinyPositiveSheet.usableSheet.widthMm : 0)
      .toBeGreaterThan(0);
  });

  it("converts an explicit cut grid into theoretical opening dimensions", () => {
    expect(calculate({
      kind: "SHEET_CUT_GRID",
      sheet: { widthMm: 787, heightMm: 1092 },
      trims: { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 },
      piecesAcross: 4,
      piecesDown: 4,
      horizontalGapMm: 0,
      verticalGapMm: 0,
    })).toMatchObject({
      kind: "SHEET_CUT_GRID",
      totalPieces: 16,
      piece: { widthMm: 196.75, heightMm: 273 },
      scope: expect.stringContaining("开数本身不能唯一决定切法"),
    });
    const tinyPositiveCut = calculate({
      kind: "SHEET_CUT_GRID",
      sheet: { widthMm: 1, heightMm: 1 },
      trims: { topMm: 0, rightMm: 0.4999999, bottomMm: 0, leftMm: 0.5 },
      piecesAcross: 1,
      piecesDown: 1,
      horizontalGapMm: 0,
      verticalGapMm: 0,
    });
    expect(tinyPositiveCut.kind === "SHEET_CUT_GRID" ? tinyPositiveCut.piece.widthMm : 0)
      .toBeGreaterThan(0);
  });

  it("converts frames and duration with an explicit rounding policy", () => {
    expect(calculate({
      kind: "FRAMES_TO_DURATION",
      frames: 240,
      frameRate: { numerator: 24, denominator: 1 },
    })).toMatchObject({
      durationSeconds: 10,
      frameDurationMs: 41.666667,
      frameRate: { numerator: 24, denominator: 1, fps: 24 },
    });
    const fractionalFrameRate = calculate({
      kind: "DURATION_TO_FRAMES",
      durationSeconds: 10,
      frameRate: { numerator: 24_000, denominator: 1_001 },
      rounding: "ROUND",
    });
    expect(fractionalFrameRate).toMatchObject({
      frames: 240,
      resultingDurationSeconds: 10.01,
      timingErrorSeconds: 0.01,
    });
    expect(fractionalFrameRate.kind === "DURATION_TO_FRAMES" ? fractionalFrameRate.exactFrames : 0)
      .toBeCloseTo(239.76023976024, 11);
    const justBelowOneSecond = calculate({
      kind: "DURATION_TO_FRAMES",
      durationSeconds: 0.999999999,
      frameRate: { numerator: 24, denominator: 1 },
      rounding: "FLOOR",
    });
    expect(justBelowOneSecond).toMatchObject({ frames: 23 });
    expect(justBelowOneSecond.kind === "DURATION_TO_FRAMES" ? justBelowOneSecond.exactFrames : 24)
      .toBeLessThan(24);
  });

  it("scales a resolution while reporting rounding drift", () => {
    expect(calculate({
      kind: "RESOLUTION_SCALE",
      source: { width: 1920, height: 1080 },
      targetAxis: "WIDTH",
      targetValue: 1280,
      roundToMultiple: 2,
    })).toEqual({
      kind: "RESOLUTION_SCALE",
      source: { width: 1920, height: 1080 },
      output: { width: 1280, height: 720 },
      targetAxis: "WIDTH",
      scale: 0.666667,
      sourceAspectRatio: "16:9",
      exactDependentDimension: 720,
      aspectErrorPercent: 0,
      megapixels: 0.9216,
    });
    const rounded = calculate({
      kind: "RESOLUTION_SCALE",
      source: { width: 1920, height: 1080 },
      targetAxis: "WIDTH",
      targetValue: 1000,
      roundToMultiple: 2,
    });
    expect(rounded).toMatchObject({ output: { width: 1000, height: 562 } });
    expect(rounded.kind === "RESOLUTION_SCALE" ? rounded.aspectErrorPercent : 0).toBeGreaterThan(0);
  });

  it("rejects impossible layout and sheet dimensions instead of returning negative values", () => {
    expect(() => calculate({
      kind: "LAYOUT_GRID",
      unit: "MM",
      page: { width: 100, height: 100 },
      margins: { top: 60, right: 10, bottom: 60, left: 10 },
      columns: 2,
      gutter: 5,
    })).toThrow();
    expect(() => calculate({
      kind: "SHEET_YIELD",
      sheet: { widthMm: 100, heightMm: 100 },
      item: { widthMm: 20, heightMm: 20 },
      edgeMarginMm: 50,
      gapMm: 0,
      allowRotate: false,
    })).toThrow();
    expect(() => calculate({
      kind: "RESOLUTION_SCALE",
      source: { width: 100_000, height: 1 },
      targetAxis: "HEIGHT",
      targetValue: 100_000,
      roundToMultiple: 1,
    })).toThrow();
  });

  it("exports a function parameter schema with an object root", () => {
    const schema = z.toJSONSchema(DesignCalculatorInputSchema) as Record<string, unknown>;
    expect(schema.type).toBe("object");
    expect(schema.properties).toMatchObject({ calculation: expect.any(Object) });
    expect(JSON.stringify(schema)).toContain('"anyOf"');
    expect(JSON.stringify(schema)).not.toContain('"oneOf"');

    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      if (record.type === "object" && record.properties && typeof record.properties === "object") {
        const propertyNames = Object.keys(record.properties);
        expect(record.additionalProperties).toBe(false);
        expect(record.required).toEqual(expect.arrayContaining(propertyNames));
        expect((record.required as unknown[]).length).toBe(propertyNames.length);
      }
      Object.values(record).forEach(visit);
    };
    visit(schema);
  });
});
