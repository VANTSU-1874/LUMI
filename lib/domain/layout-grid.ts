import { z } from "zod";

export const LayoutBlockRoleSchema = z.enum(["TITLE", "SUBTITLE", "BODY", "CAPTION"]);

/** 一块落在栅格上的文字。位置用 1 起的栏/行序号，不用像素——学生要学的是栅格关系，不是拖像素。 */
export const LayoutBlockSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  role: LayoutBlockRoleSchema,
  colStart: z.number().int().min(1).max(16),
  colSpan: z.number().int().min(1).max(16),
  rowStart: z.number().int().min(1).max(40),
  rowSpan: z.number().int().min(1).max(40),
  /** 相对正文的字号倍率，用于判断层级是否拉开。 */
  fontScale: z.number().min(0.5).max(8),
}).strict();

export const LayoutGridConfigSchema = z.object({
  pageWidthMm: z.number().min(50).max(1_000),
  pageHeightMm: z.number().min(50).max(1_000),
  columns: z.number().int().min(2).max(16),
  rows: z.number().int().min(4).max(40),
  gutterMm: z.number().min(0).max(50),
  marginTopMm: z.number().min(0).max(200),
  marginRightMm: z.number().min(0).max(200),
  marginBottomMm: z.number().min(0).max(200),
  marginLeftMm: z.number().min(0).max(200),
}).strict();

export const LayoutGridCriterionSchema = z.object({
  id: z.enum(["GRID_ADHERENCE", "HIERARCHY_DISTINCT", "READING_PATH", "MARGIN_INTEGRITY"]),
  passed: z.boolean(),
  label: z.string(),
  note: z.string(),
}).strict();

const blocksRule = (blocks: z.infer<typeof LayoutBlockSchema>[], context: z.RefinementCtx) => {
  if (new Set(blocks.map(({ id }) => id)).size !== blocks.length) {
    context.addIssue({ code: "custom", path: ["blocks"], message: "文字块 id 不能重复" });
  }
};

export const LayoutGridEvidenceRequestSchema = z
  .object({
    config: LayoutGridConfigSchema,
    blocks: z.array(LayoutBlockSchema).min(2).max(12),
  })
  .strict()
  .superRefine((input, context) => blocksRule(input.blocks, context));

export const LayoutGridDraftRequestSchema = z
  .object({
    config: LayoutGridConfigSchema,
    blocks: z.array(LayoutBlockSchema).max(12),
  })
  .strict()
  .superRefine((input, context) => blocksRule(input.blocks, context));

export const LayoutGridEvidenceResponseSchema = z.object({
  id: z.string().uuid(),
  config: LayoutGridConfigSchema,
  blocks: z.array(LayoutBlockSchema).min(2).max(12),
  criteria: z.array(LayoutGridCriterionSchema).length(4),
  score: z.number().int().min(0).max(4),
  passed: z.boolean(),
  createdAt: z.string().datetime(),
  dataType: z.enum(["REAL", "DEMONSTRATION_DATA"]),
}).strict();

export const LayoutGridDraftResponseSchema = z.object({
  id: z.string().uuid(),
  config: LayoutGridConfigSchema,
  blocks: z.array(LayoutBlockSchema).max(12),
  updatedAt: z.string().datetime(),
  dataType: z.enum(["REAL", "DEMONSTRATION_DATA"]),
}).strict();

export const LayoutGridWorkspaceResponseSchema = z.object({
  resume: z.union([LayoutGridDraftResponseSchema, LayoutGridEvidenceResponseSchema]).nullable(),
  latest: LayoutGridEvidenceResponseSchema.nullable(),
}).strict();

export const LayoutGridResetResponseSchema = z.object({
  reset: z.literal(true),
  resume: z.null(),
  latest: LayoutGridEvidenceResponseSchema.nullable(),
}).strict();

export type LayoutBlock = z.infer<typeof LayoutBlockSchema>;
export type LayoutGridConfig = z.infer<typeof LayoutGridConfigSchema>;
export type LayoutGridEvidenceRequest = z.infer<typeof LayoutGridEvidenceRequestSchema>;
export type LayoutGridEvidenceResponse = z.infer<typeof LayoutGridEvidenceResponseSchema>;
export type LayoutGridDraftRequest = z.infer<typeof LayoutGridDraftRequestSchema>;
export type LayoutGridDraftResponse = z.infer<typeof LayoutGridDraftResponseSchema>;
export type LayoutGridWorkspaceResponse = z.infer<typeof LayoutGridWorkspaceResponseSchema>;

export const A4_PORTRAIT_DEFAULT: LayoutGridConfig = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  columns: 12,
  rows: 22,
  gutterMm: 4,
  marginTopMm: 20,
  marginRightMm: 15,
  marginBottomMm: 20,
  marginLeftMm: 15,
};
