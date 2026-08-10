import { z } from "zod";

export const CRITIQUE_FRAMEWORK_ID = "critique-framework-five-plus-closure" as const;
export const CRITIQUE_FRAMEWORK_VERSION = "1.0" as const;

export const CRITIQUE_DIMENSION_IDS = [
  "goal",
  "translation",
  "structure_hierarchy",
  "formal_language",
  "craft_standards",
] as const;

export const CritiqueDimensionIdSchema = z.enum(CRITIQUE_DIMENSION_IDS);

export const CritiqueEvidenceSchema = z.object({
  kind: z.enum(["ARTWORK_REGION", "STUDENT_STATEMENT", "COURSE_REFERENCE", "HISTORY_RECORD"]),
  label: z.string().trim().min(1).max(240),
  reference: z.string().trim().min(1).max(160).optional(),
}).strict();

export const CritiqueDimensionSchema = z.object({
  id: CritiqueDimensionIdSchema,
  label: z.string().trim().min(1).max(40),
  displayOrder: z.union([
    z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
  ]),
  status: z.enum(["ESTABLISHED", "DEVELOPING", "NEEDS_EVIDENCE"]),
  observation: z.string().trim().min(1).max(1_200),
  evidence: z.array(CritiqueEvidenceSchema).min(1).max(6),
  guidance: z.object({
    level: z.enum(["QUESTION", "HINT", "DEMONSTRATION"]),
    message: z.string().trim().min(1).max(1_200),
    understandingCheck: z.string().trim().min(1).max(500).optional(),
  }).strict(),
  isDeepDive: z.boolean(),
}).strict().superRefine((dimension, context) => {
  const expectedIndex = CRITIQUE_DIMENSION_IDS.indexOf(dimension.id);
  if (dimension.displayOrder !== expectedIndex + 1) {
    context.addIssue({
      code: "custom",
      path: ["displayOrder"],
      message: "critique dimension order must match the five-dimension contract",
    });
  }
  if (dimension.guidance.level === "DEMONSTRATION" && !dimension.guidance.understandingCheck) {
    context.addIssue({
      code: "custom",
      path: ["guidance", "understandingCheck"],
      message: "demonstration guidance requires an understanding check",
    });
  }
});

export const CritiqueClosureSchema = z.object({
  established: z.string().trim().min(1).max(1_200),
  nextStep: z.string().trim().min(1).max(1_200),
  historyReference: z.object({
    recordId: z.string().uuid(),
    label: z.string().trim().min(1).max(120),
    comparison: z.string().trim().min(1).max(1_200),
  }).strict().optional(),
}).strict();

export const CritiqueDimensionsSchema = z.array(CritiqueDimensionSchema)
  .length(CRITIQUE_DIMENSION_IDS.length)
  .superRefine((dimensions, context) => {
  dimensions.forEach((dimension, index) => {
    if (dimension.id !== CRITIQUE_DIMENSION_IDS[index]) {
      context.addIssue({
        code: "custom",
        path: ["dimensions", index, "id"],
        message: "critique must contain the five canonical dimensions exactly once and in order",
      });
    }
  });
  const deepDiveCount = dimensions.filter(({ isDeepDive }) => isDeepDive).length;
  if (deepDiveCount < 1 || deepDiveCount > 2) {
    context.addIssue({
      code: "custom",
      path: ["dimensions"],
      message: "critique must deepen one or two dimensions",
    });
  }
  });

const CritiqueBodySchema = z.object({
  dimensions: CritiqueDimensionsSchema,
  closure: CritiqueClosureSchema,
}).strict();

export const CritiqueResultSchema = CritiqueBodySchema.extend({
  id: z.string().uuid(),
  frameworkId: z.literal(CRITIQUE_FRAMEWORK_ID),
  frameworkVersion: z.literal(CRITIQUE_FRAMEWORK_VERSION),
  courseId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  artworkId: z.string().uuid(),
  createdAt: z.string().datetime(),
}).strict();

export type CritiqueDimensionId = z.infer<typeof CritiqueDimensionIdSchema>;
export type CritiqueEvidence = z.infer<typeof CritiqueEvidenceSchema>;
export type CritiqueDimension = z.infer<typeof CritiqueDimensionSchema>;
export type CritiqueClosure = z.infer<typeof CritiqueClosureSchema>;
export type CritiqueResult = z.infer<typeof CritiqueResultSchema>;
