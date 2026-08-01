import { z } from "zod";

export const BookAudienceSchema = z.enum(["NEW_STUDENTS", "COMMUNITY_RESIDENTS"]);

export const BookPageIdSchema = z.enum([
  "cover",
  "quick-start",
  "activity-map",
  "featured-activity",
  "calendar",
  "community-voices",
  "join-us",
  "contact",
]);

export const BookDiagnosticAnswerSchema = z.enum(["AUDIENCE_FIRST", "TASK_FIRST", "DECORATION_FIRST"]);

export const BookTransferChoiceSchema = z.enum([
  "COMMUNITY_ENTRY_FIRST",
  "VOLUNTEER_CALL_TO_ACTION",
  "RETAIN_ACTIVITY_CORE",
]);

export const BookLayoutEvidenceRequestSchema = z
  .object({
    audience: BookAudienceSchema,
    pageOrder: z.array(BookPageIdSchema).length(8),
    diagnosticAnswers: z.array(BookDiagnosticAnswerSchema).length(3),
    transferChoices: z.array(BookTransferChoiceSchema).max(3),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.pageOrder).size !== 8) context.addIssue({ code: "custom", path: ["pageOrder"], message: "八页内容不能重复" });
    if (new Set(input.transferChoices).size !== input.transferChoices.length) context.addIssue({ code: "custom", path: ["transferChoices"], message: "迁移选择不能重复" });
  });

export const BookLayoutDraftRequestSchema = z
  .object({
    audience: BookAudienceSchema,
    pageOrder: z.array(BookPageIdSchema).length(8),
    diagnosticAnswers: z.array(BookDiagnosticAnswerSchema.nullable()).length(3),
    transferChoices: z.array(BookTransferChoiceSchema).max(3),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.pageOrder).size !== 8) context.addIssue({ code: "custom", path: ["pageOrder"], message: "八页内容不能重复" });
    if (new Set(input.transferChoices).size !== input.transferChoices.length) context.addIssue({ code: "custom", path: ["transferChoices"], message: "迁移选择不能重复" });
  });

export const BookLayoutCriterionSchema = z.object({
  id: z.enum(["DIAGNOSTIC", "PAGE_BOUNDARY", "READING_PATH", "AUDIENCE_TRANSFER"]),
  passed: z.boolean(),
  label: z.string(),
  note: z.string(),
}).strict();

export const BookLayoutEvidenceResponseSchema = z.object({
  id: z.string().uuid(),
  audience: BookAudienceSchema,
  pageOrder: z.array(BookPageIdSchema).length(8),
  diagnosticAnswers: z.array(BookDiagnosticAnswerSchema).length(3),
  transferChoices: z.array(BookTransferChoiceSchema).max(3),
  criteria: z.array(BookLayoutCriterionSchema).length(4),
  score: z.number().int().min(0).max(4),
  passed: z.boolean(),
  createdAt: z.string().datetime(),
  dataType: z.enum(["REAL", "DEMONSTRATION_DATA"]),
}).strict();

export const BookLayoutDraftResponseSchema = z
  .object({
    id: z.string().uuid(),
    audience: BookAudienceSchema,
    pageOrder: z.array(BookPageIdSchema).length(8),
    diagnosticAnswers: z.array(BookDiagnosticAnswerSchema.nullable()).length(3),
    transferChoices: z.array(BookTransferChoiceSchema).max(3),
    updatedAt: z.string().datetime(),
    dataType: z.enum(["REAL", "DEMONSTRATION_DATA"]),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.pageOrder).size !== 8) context.addIssue({ code: "custom", path: ["pageOrder"], message: "八页内容不能重复" });
    if (new Set(input.transferChoices).size !== input.transferChoices.length) context.addIssue({ code: "custom", path: ["transferChoices"], message: "迁移选择不能重复" });
  });

export const BookLayoutWorkspaceResponseSchema = z.object({
  resume: z.union([BookLayoutDraftResponseSchema, BookLayoutEvidenceResponseSchema]).nullable(),
  latest: BookLayoutEvidenceResponseSchema.nullable(),
}).strict();

export const BookLayoutResetResponseSchema = z.object({
  reset: z.literal(true),
  resume: z.null(),
  latest: BookLayoutEvidenceResponseSchema.nullable(),
}).strict();

export type BookLayoutEvidenceRequest = z.infer<typeof BookLayoutEvidenceRequestSchema>;
export type BookLayoutEvidenceResponse = z.infer<typeof BookLayoutEvidenceResponseSchema>;
export type BookLayoutDraftRequest = z.infer<typeof BookLayoutDraftRequestSchema>;
export type BookLayoutDraftResponse = z.infer<typeof BookLayoutDraftResponseSchema>;
export type BookLayoutWorkspaceResponse = z.infer<typeof BookLayoutWorkspaceResponseSchema>;
