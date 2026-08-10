import { z } from "zod";

import { getCapability } from "../capability-registry";
import type { AgentToolDefinition } from "../tool-contract";

const DimensionSchema = z.number().min(0.1).max(100_000);
const ColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);

const ColorContrastInputSchema = z.object({
  kind: z.literal("COLOR_CONTRAST"),
  foreground: ColorSchema,
  background: ColorSchema,
}).strict();

const LayoutGridInputSchema = z.object({
  kind: z.literal("LAYOUT_GRID"),
  unit: z.enum(["MM", "PT", "PX"]),
  page: z.object({ width: DimensionSchema, height: DimensionSchema }).strict(),
  margins: z.object({
    top: z.number().min(0).max(100_000),
    right: z.number().min(0).max(100_000),
    bottom: z.number().min(0).max(100_000),
    left: z.number().min(0).max(100_000),
  }).strict(),
  columns: z.number().int().min(1).max(48),
  gutter: z.number().min(0).max(10_000),
}).strict();

const SheetYieldInputSchema = z.object({
  kind: z.literal("SHEET_YIELD"),
  sheet: z.object({ widthMm: DimensionSchema, heightMm: DimensionSchema }).strict(),
  item: z.object({ widthMm: DimensionSchema, heightMm: DimensionSchema }).strict(),
  edgeMarginMm: z.number().min(0).max(10_000),
  gapMm: z.number().min(0).max(1_000),
  allowRotate: z.boolean(),
}).strict();

const SheetCutGridInputSchema = z.object({
  kind: z.literal("SHEET_CUT_GRID"),
  sheet: z.object({ widthMm: DimensionSchema, heightMm: DimensionSchema }).strict(),
  trims: z.object({
    topMm: z.number().min(0).max(10_000),
    rightMm: z.number().min(0).max(10_000),
    bottomMm: z.number().min(0).max(10_000),
    leftMm: z.number().min(0).max(10_000),
  }).strict(),
  piecesAcross: z.number().int().min(1).max(128)
    .describe("横向成品列数，不是切刀次数；例如 4 列成品通常对应 3 条纵向分切线"),
  piecesDown: z.number().int().min(1).max(128)
    .describe("纵向成品行数，不是切刀次数；例如 4 行成品通常对应 3 条横向分切线"),
  horizontalGapMm: z.number().min(0).max(1_000),
  verticalGapMm: z.number().min(0).max(1_000),
}).strict();

const FrameRateSchema = z.object({
  numerator: z.number().int().min(1).max(1_000_000),
  denominator: z.number().int().min(1).max(1_000_000),
}).strict().describe("精确帧率分数，例如 24fps={numerator:24,denominator:1}，23.976fps={numerator:24000,denominator:1001}");

const FramesToDurationInputSchema = z.object({
  kind: z.literal("FRAMES_TO_DURATION"),
  frames: z.number().int().min(0).max(100_000_000),
  frameRate: FrameRateSchema,
}).strict();

const DurationToFramesInputSchema = z.object({
  kind: z.literal("DURATION_TO_FRAMES"),
  durationSeconds: z.number().min(0).max(10_000_000),
  frameRate: FrameRateSchema,
  rounding: z.enum(["FLOOR", "ROUND", "CEIL"]),
}).strict();

const ResolutionScaleInputSchema = z.object({
  kind: z.literal("RESOLUTION_SCALE"),
  source: z.object({
    width: z.number().int().min(1).max(100_000),
    height: z.number().int().min(1).max(100_000),
  }).strict(),
  targetAxis: z.enum(["WIDTH", "HEIGHT"]),
  targetValue: z.number().int().min(1).max(100_000),
  roundToMultiple: z.number().int().min(1).max(64),
}).strict();

const CalculationInputSchema = z.union([
  ColorContrastInputSchema,
  LayoutGridInputSchema,
  SheetYieldInputSchema,
  SheetCutGridInputSchema,
  FramesToDurationInputSchema,
  DurationToFramesInputSchema,
  ResolutionScaleInputSchema,
]);

export const DesignCalculatorInputSchema = z.object({
  calculation: CalculationInputSchema,
}).strict().superRefine((input, context) => {
  const calculation = input.calculation;
  if (calculation.kind === "LAYOUT_GRID") {
    const contentHeight = calculation.page.height - calculation.margins.top - calculation.margins.bottom;
    const columnsWidth = calculation.page.width
      - calculation.margins.left
      - calculation.margins.right
      - calculation.gutter * (calculation.columns - 1);
    if (contentHeight <= 0) {
      context.addIssue({
        code: "custom",
        path: ["calculation", "margins"],
        message: "top and bottom margins must leave positive content height",
      });
    }
    if (columnsWidth <= 0) {
      context.addIssue({
        code: "custom",
        path: ["calculation", "columns"],
        message: "margins and gutters must leave positive column width",
      });
    }
  }
  if (calculation.kind === "SHEET_YIELD") {
    if (calculation.sheet.widthMm - 2 * calculation.edgeMarginMm <= 0) {
      context.addIssue({
        code: "custom",
        path: ["calculation", "edgeMarginMm"],
        message: "edge margins must leave positive sheet width",
      });
    }
    if (calculation.sheet.heightMm - 2 * calculation.edgeMarginMm <= 0) {
      context.addIssue({
        code: "custom",
        path: ["calculation", "edgeMarginMm"],
        message: "edge margins must leave positive sheet height",
      });
    }
  }
  if (calculation.kind === "SHEET_CUT_GRID") {
    const usableWidth = calculation.sheet.widthMm - calculation.trims.leftMm - calculation.trims.rightMm;
    const usableHeight = calculation.sheet.heightMm - calculation.trims.topMm - calculation.trims.bottomMm;
    const piecesWidth = usableWidth - calculation.horizontalGapMm * (calculation.piecesAcross - 1);
    const piecesHeight = usableHeight - calculation.verticalGapMm * (calculation.piecesDown - 1);
    if (piecesWidth <= 0) {
      context.addIssue({
        code: "custom",
        path: ["calculation", "horizontalGapMm"],
        message: "trims and horizontal gaps must leave positive piece width",
      });
    }
    if (piecesHeight <= 0) {
      context.addIssue({
        code: "custom",
        path: ["calculation", "verticalGapMm"],
        message: "trims and vertical gaps must leave positive piece height",
      });
    }
  }
  if (calculation.kind === "FRAMES_TO_DURATION" || calculation.kind === "DURATION_TO_FRAMES") {
    const fps = calculation.frameRate.numerator / calculation.frameRate.denominator;
    if (fps < 0.001 || fps > 1_000) {
      context.addIssue({
        code: "custom",
        path: ["calculation", "frameRate"],
        message: "frame rate must be between 0.001 and 1000 fps",
      });
    }
  }
  if (calculation.kind === "RESOLUTION_SCALE") {
    const scale = calculation.targetAxis === "WIDTH"
      ? calculation.targetValue / calculation.source.width
      : calculation.targetValue / calculation.source.height;
    const dependent = calculation.targetAxis === "WIDTH"
      ? calculation.source.height * scale
      : calculation.source.width * scale;
    const roundedDependent = Math.max(
      calculation.roundToMultiple,
      Math.round(dependent / calculation.roundToMultiple) * calculation.roundToMultiple,
    );
    if (dependent < 1 || dependent > 100_000 || roundedDependent > 100_000) {
      context.addIssue({
        code: "custom",
        path: ["calculation", "targetValue"],
        message: "derived resolution dimension must remain between 1 and 100000 pixels",
      });
    }
  }
});

const ColorContrastOutputSchema = z.object({
  kind: z.literal("COLOR_CONTRAST"),
  foreground: z.string(),
  background: z.string(),
  foregroundLuminance: z.number().min(0).max(1),
  backgroundLuminance: z.number().min(0).max(1),
  ratio: z.number().min(1).max(21),
  scope: z.string().min(1).max(300),
  passes: z.object({
    normalTextAA: z.boolean(),
    normalTextAAA: z.boolean(),
    largeTextAA: z.boolean(),
    largeTextAAA: z.boolean(),
    nonTextUIAA: z.boolean(),
  }).strict(),
}).strict();

const LayoutGridOutputSchema = z.object({
  kind: z.literal("LAYOUT_GRID"),
  unit: z.enum(["MM", "PT", "PX"]),
  page: z.object({ width: z.number(), height: z.number() }).strict(),
  content: z.object({ width: z.number().positive(), height: z.number().positive() }).strict(),
  columns: z.number().int().positive(),
  gutter: z.number().nonnegative(),
  totalGutterWidth: z.number().nonnegative(),
  columnWidth: z.number().positive(),
}).strict();

const SheetOrientationSchema = z.object({
  orientation: z.enum(["NORMAL", "ROTATED"]),
  itemWidthMm: z.number().positive(),
  itemHeightMm: z.number().positive(),
  across: z.number().int().nonnegative(),
  down: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
}).strict();

const SheetYieldOutputSchema = z.object({
  kind: z.literal("SHEET_YIELD"),
  usableSheet: z.object({ widthMm: z.number().positive(), heightMm: z.number().positive() }).strict(),
  edgeMarginMm: z.number().nonnegative(),
  gapMm: z.number().nonnegative(),
  selected: SheetOrientationSchema,
  alternatives: z.array(SheetOrientationSchema).min(1).max(2),
  scope: z.string().min(1).max(300),
}).strict();

const SheetCutGridOutputSchema = z.object({
  kind: z.literal("SHEET_CUT_GRID"),
  usableSheet: z.object({ widthMm: z.number().positive(), heightMm: z.number().positive() }).strict(),
  piecesAcross: z.number().int().positive(),
  piecesDown: z.number().int().positive(),
  totalPieces: z.number().int().positive(),
  horizontalGapTotalMm: z.number().nonnegative(),
  verticalGapTotalMm: z.number().nonnegative(),
  piece: z.object({ widthMm: z.number().positive(), heightMm: z.number().positive() }).strict(),
  scope: z.string().min(1).max(300),
}).strict();

const FrameRateOutputSchema = z.object({
  numerator: z.number().int().positive(),
  denominator: z.number().int().positive(),
  fps: z.number().positive(),
}).strict();

const FramesToDurationOutputSchema = z.object({
  kind: z.literal("FRAMES_TO_DURATION"),
  frames: z.number().int().nonnegative(),
  frameRate: FrameRateOutputSchema,
  durationSeconds: z.number().nonnegative(),
  frameDurationMs: z.number().positive(),
}).strict();

const DurationToFramesOutputSchema = z.object({
  kind: z.literal("DURATION_TO_FRAMES"),
  durationSeconds: z.number().nonnegative(),
  frameRate: FrameRateOutputSchema,
  exactFrames: z.number().nonnegative(),
  rounding: z.enum(["FLOOR", "ROUND", "CEIL"]),
  frames: z.number().int().nonnegative(),
  resultingDurationSeconds: z.number().nonnegative(),
  timingErrorSeconds: z.number(),
}).strict();

const ResolutionScaleOutputSchema = z.object({
  kind: z.literal("RESOLUTION_SCALE"),
  source: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  output: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  targetAxis: z.enum(["WIDTH", "HEIGHT"]),
  scale: z.number().positive(),
  sourceAspectRatio: z.string(),
  exactDependentDimension: z.number().positive(),
  aspectErrorPercent: z.number().nonnegative(),
  megapixels: z.number().positive(),
}).strict();

export const DesignCalculatorOutputSchema = z.discriminatedUnion("kind", [
  ColorContrastOutputSchema,
  LayoutGridOutputSchema,
  SheetYieldOutputSchema,
  SheetCutGridOutputSchema,
  FramesToDurationOutputSchema,
  DurationToFramesOutputSchema,
  ResolutionScaleOutputSchema,
]);

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

function normalizeHex(value: string) {
  const raw = value.slice(1);
  const expanded = raw.length === 3
    ? [...raw].map((character) => character.repeat(2)).join("")
    : raw;
  return `#${expanded.toUpperCase()}`;
}

function relativeLuminance(value: string) {
  const hex = normalizeHex(value).slice(1);
  const components = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = components.map((component) => component <= 0.04045
    ? component / 12.92
    : ((component + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function sheetOrientation(input: {
  orientation: "NORMAL" | "ROTATED";
  usableWidth: number;
  usableHeight: number;
  itemWidth: number;
  itemHeight: number;
  gap: number;
}) {
  const stableFloor = (value: number) => {
    const nearest = Math.round(value);
    return Math.abs(value - nearest) <= 1e-10 * Math.max(1, Math.abs(value))
      ? nearest
      : Math.floor(value);
  };
  const across = Math.max(0, stableFloor((input.usableWidth + input.gap) / (input.itemWidth + input.gap)));
  const down = Math.max(0, stableFloor((input.usableHeight + input.gap) / (input.itemHeight + input.gap)));
  return {
    orientation: input.orientation,
    itemWidthMm: input.itemWidth,
    itemHeightMm: input.itemHeight,
    across,
    down,
    count: across * down,
  };
}

function gcd(left: number, right: number): number {
  return right === 0 ? left : gcd(right, left % right);
}

function roundToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function executeCalculation(rawInput: unknown) {
  const { calculation: input } = DesignCalculatorInputSchema.parse(rawInput);
  switch (input.kind) {
    case "COLOR_CONTRAST": {
      const foregroundLuminance = relativeLuminance(input.foreground);
      const backgroundLuminance = relativeLuminance(input.background);
      const lighter = Math.max(foregroundLuminance, backgroundLuminance);
      const darker = Math.min(foregroundLuminance, backgroundLuminance);
      const ratio = (lighter + 0.05) / (darker + 0.05);
      return {
        kind: input.kind,
        foreground: normalizeHex(input.foreground),
        background: normalizeHex(input.background),
        foregroundLuminance,
        backgroundLuminance,
        ratio,
        scope: "仅按不透明 sRGB 十六进制颜色计算 WCAG 2.x 相对亮度；不包含透明度、渐变、P3、CMYK 或实际显示环境。",
        passes: {
          normalTextAA: ratio >= 4.5,
          normalTextAAA: ratio >= 7,
          largeTextAA: ratio >= 3,
          largeTextAAA: ratio >= 4.5,
          nonTextUIAA: ratio >= 3,
        },
      };
    }
    case "LAYOUT_GRID": {
      const contentWidth = input.page.width - input.margins.left - input.margins.right;
      const contentHeight = input.page.height - input.margins.top - input.margins.bottom;
      const totalGutterWidth = input.gutter * (input.columns - 1);
      return {
        kind: input.kind,
        unit: input.unit,
        page: input.page,
        content: { width: contentWidth, height: contentHeight },
        columns: input.columns,
        gutter: input.gutter,
        totalGutterWidth,
        columnWidth: (contentWidth - totalGutterWidth) / input.columns,
      };
    }
    case "SHEET_YIELD": {
      const usableWidth = input.sheet.widthMm - 2 * input.edgeMarginMm;
      const usableHeight = input.sheet.heightMm - 2 * input.edgeMarginMm;
      const normal = sheetOrientation({
        orientation: "NORMAL",
        usableWidth,
        usableHeight,
        itemWidth: input.item.widthMm,
        itemHeight: input.item.heightMm,
        gap: input.gapMm,
      });
      const rotated = sheetOrientation({
        orientation: "ROTATED",
        usableWidth,
        usableHeight,
        itemWidth: input.item.heightMm,
        itemHeight: input.item.widthMm,
        gap: input.gapMm,
      });
      const alternatives = input.allowRotate ? [normal, rotated] : [normal];
      const selected = alternatives.reduce((best, candidate) => (
        candidate.count > best.count ? candidate : best
      ));
      return {
        kind: input.kind,
        usableSheet: { widthMm: usableWidth, heightMm: usableHeight },
        edgeMarginMm: input.edgeMarginMm,
        gapMm: input.gapMm,
        selected,
        alternatives,
        scope: "矩形项目统一朝向规则直排的理论最大数；边距和间隙按输入扣除，不含混排、咬口、出血、纸纹、折手、刀缝与印机限制。",
      };
    }
    case "SHEET_CUT_GRID": {
      const usableWidth = input.sheet.widthMm - input.trims.leftMm - input.trims.rightMm;
      const usableHeight = input.sheet.heightMm - input.trims.topMm - input.trims.bottomMm;
      const horizontalGapTotal = input.horizontalGapMm * (input.piecesAcross - 1);
      const verticalGapTotal = input.verticalGapMm * (input.piecesDown - 1);
      return {
        kind: input.kind,
        usableSheet: { widthMm: usableWidth, heightMm: usableHeight },
        piecesAcross: input.piecesAcross,
        piecesDown: input.piecesDown,
        totalPieces: input.piecesAcross * input.piecesDown,
        horizontalGapTotalMm: round(horizontalGapTotal),
        verticalGapTotalMm: round(verticalGapTotal),
        piece: {
          widthMm: (usableWidth - horizontalGapTotal) / input.piecesAcross,
          heightMm: (usableHeight - verticalGapTotal) / input.piecesDown,
        },
        scope: "按明确横纵切分数等分得到的理论净尺寸；开数本身不能唯一决定切法，不含出血、咬口、纸纹、折手、刀缝与印机限制。",
      };
    }
    case "FRAMES_TO_DURATION": {
      const fps = input.frameRate.numerator / input.frameRate.denominator;
      return {
        kind: input.kind,
        frames: input.frames,
        frameRate: { ...input.frameRate, fps: round(fps) },
        durationSeconds: round(input.frames * input.frameRate.denominator / input.frameRate.numerator),
        frameDurationMs: round(1_000 * input.frameRate.denominator / input.frameRate.numerator),
      };
    }
    case "DURATION_TO_FRAMES": {
      const fps = input.frameRate.numerator / input.frameRate.denominator;
      const exactFrames = input.durationSeconds * input.frameRate.numerator / input.frameRate.denominator;
      const rounding = {
        FLOOR: Math.floor,
        ROUND: Math.round,
        CEIL: Math.ceil,
      }[input.rounding];
      const frames = rounding(exactFrames);
      return {
        kind: input.kind,
        durationSeconds: input.durationSeconds,
        frameRate: { ...input.frameRate, fps: round(fps) },
        exactFrames,
        rounding: input.rounding,
        frames,
        resultingDurationSeconds: round(frames * input.frameRate.denominator / input.frameRate.numerator),
        timingErrorSeconds: round(
          frames * input.frameRate.denominator / input.frameRate.numerator - input.durationSeconds,
        ),
      };
    }
    case "RESOLUTION_SCALE": {
      const divisor = gcd(input.source.width, input.source.height);
      const sourceRatio = input.source.width / input.source.height;
      const scale = input.targetAxis === "WIDTH"
        ? input.targetValue / input.source.width
        : input.targetValue / input.source.height;
      const exactDependentDimension = input.targetAxis === "WIDTH"
        ? input.source.height * scale
        : input.source.width * scale;
      const dependent = roundToMultiple(exactDependentDimension, input.roundToMultiple);
      const output = input.targetAxis === "WIDTH"
        ? { width: input.targetValue, height: dependent }
        : { width: dependent, height: input.targetValue };
      const outputRatio = output.width / output.height;
      return {
        kind: input.kind,
        source: input.source,
        output,
        targetAxis: input.targetAxis,
        scale: round(scale),
        sourceAspectRatio: `${input.source.width / divisor}:${input.source.height / divisor}`,
        exactDependentDimension: round(exactDependentDimension),
        aspectErrorPercent: round(Math.abs(outputRatio - sourceRatio) / sourceRatio * 100),
        megapixels: round(output.width * output.height / 1_000_000),
      };
    }
  }
}

export const designCalculatorTool = {
  descriptor: {
    id: "design-calculator.compute",
    version: "1",
    adapterId: "design-calculator",
    owner: getCapability("design-calculation"),
    label: "计算设计参数",
    description: "用确定性公式计算色彩对比度、版面网格、纸张规则开数、帧数时长和等比例分辨率，不依赖模型心算。",
    inputHint: "arguments 根对象只含 calculation；kind 可选 COLOR_CONTRAST、LAYOUT_GRID、SHEET_YIELD、SHEET_CUT_GRID、FRAMES_TO_DURATION、DURATION_TO_FRAMES、RESOLUTION_SCALE。帧率用 numerator/denominator；纸张等分用 piecesAcross/piecesDown 成品列/行数；对比度只接受不透明 hex。",
    effect: "READ_CONTEXT",
    access: "READ_ONLY",
    timeoutMs: 1_000,
    recommendedByCoursePacks: [
      { id: "general-design", version: "1" },
      { id: "digital-interaction", version: "1" },
      { id: "book-design", version: "1" },
      { id: "layout-design", version: "1" },
      { id: "brand-vi-design", version: "1" },
    ],
  },
  inputSchema: DesignCalculatorInputSchema,
  outputSchema: DesignCalculatorOutputSchema,
  strictInputSchema: true,
  execute(_context, rawInput) {
    return executeCalculation(rawInput);
  },
  summarize(rawOutput) {
    const output = DesignCalculatorOutputSchema.parse(rawOutput);
    switch (output.kind) {
      case "COLOR_CONTRAST":
        return {
          summary: `${output.foreground} 与 ${output.background} 的对比度为 ${output.ratio}:1。`,
          facts: [
            `普通文本 AA：${output.passes.normalTextAA ? "通过" : "未通过"}（阈值 4.5:1）`,
            `大文本 AA：${output.passes.largeTextAA ? "通过" : "未通过"}（阈值 3:1）`,
            output.scope,
          ],
          empty: false,
        };
      case "LAYOUT_GRID":
        return {
          summary: `${output.columns} 栏网格的单栏宽为 ${output.columnWidth} ${output.unit}。`,
          facts: [
            `内容区：${output.content.width} × ${output.content.height} ${output.unit}`,
            `栏间距合计：${output.totalGutterWidth} ${output.unit}`,
          ],
          empty: false,
        };
      case "SHEET_YIELD":
        return {
          summary: `规则直排理论最多 ${output.selected.count} 个（横向 ${output.selected.across} × 纵向 ${output.selected.down}）。`,
          facts: [output.scope],
          empty: false,
        };
      case "SHEET_CUT_GRID":
        return {
          summary: `${output.piecesAcross} 列 × ${output.piecesDown} 行得到 ${output.totalPieces} 开，单片理论净尺寸为 ${output.piece.widthMm} × ${output.piece.heightMm} mm。`,
          facts: [output.scope],
          empty: false,
        };
      case "FRAMES_TO_DURATION":
        return {
          summary: `${output.frames} 帧在 ${output.frameRate.numerator}/${output.frameRate.denominator} fps（约 ${output.frameRate.fps}）下为 ${output.durationSeconds} 秒。`,
          facts: [`单帧时长：${output.frameDurationMs} 毫秒`],
          empty: false,
        };
      case "DURATION_TO_FRAMES":
        return {
          summary: `${output.durationSeconds} 秒在 ${output.frameRate.numerator}/${output.frameRate.denominator} fps（约 ${output.frameRate.fps}）下按 ${output.rounding} 得到 ${output.frames} 帧。`,
          facts: [
            `未取整帧数：${output.exactFrames}`,
            `取整后的实际时长：${output.resultingDurationSeconds} 秒`,
            `取整时长误差：${output.timingErrorSeconds} 秒`,
          ],
          empty: false,
        };
      case "RESOLUTION_SCALE":
        return {
          summary: `${output.source.width}×${output.source.height} 等比例换算为 ${output.output.width}×${output.output.height}。`,
          facts: [
            `原始宽高比：${output.sourceAspectRatio}`,
            `自动计算的另一轴取整后，宽高比误差：${output.aspectErrorPercent}%`,
          ],
          empty: false,
        };
    }
  },
} satisfies AgentToolDefinition;
