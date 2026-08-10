import { z } from "zod";

import { DataTypeSchema } from "./data-provenance";

export const STUDENT_MEMORY_KINDS = [
  "LEARNED_CONCEPT",
  "RECURRING_STRUGGLE",
  "PREFERENCE",
  "PROJECT_FACT",
  "MISCONCEPTION_CORRECTED",
] as const;

export const StudentMemoryKindSchema = z.enum(STUDENT_MEMORY_KINDS);
export const StudentMemoryContentSchema = z.string().trim().min(1).max(2000);
export const STUDENT_MEMORY_TIER_1_KINDS = [
  "PREFERENCE",
  "PROJECT_FACT",
] as const;
export const STUDENT_MEMORY_TIER_2_KINDS = [
  "LEARNED_CONCEPT",
  "RECURRING_STRUGGLE",
  "MISCONCEPTION_CORRECTED",
] as const;
export const StudentMemoryTierOneKindSchema = z.enum(STUDENT_MEMORY_TIER_1_KINDS);
export const StudentMemoryTierTwoKindSchema = z.enum(STUDENT_MEMORY_TIER_2_KINDS);
export const StudentMemoryDisputeNoteSchema = z.string().trim().min(1).max(500);

export function isStudentMemoryTierOneKind(
  kind: z.infer<typeof StudentMemoryKindSchema>,
): kind is z.infer<typeof StudentMemoryTierOneKindSchema> {
  return (STUDENT_MEMORY_TIER_1_KINDS as readonly string[]).includes(kind);
}

export function isStudentMemoryTierTwoKind(
  kind: z.infer<typeof StudentMemoryKindSchema>,
): kind is z.infer<typeof StudentMemoryTierTwoKindSchema> {
  return (STUDENT_MEMORY_TIER_2_KINDS as readonly string[]).includes(kind);
}

export const StudentMemoryCandidateSchema = z.object({
  kind: StudentMemoryKindSchema,
  evidenceQuote: z.string().trim().min(1).max(500),
  salience: z.number().int().min(1).max(3).default(1),
}).strict();

export const StudentMemoryCreateInputSchema = z.object({
  studentId: z.string().trim().min(1).max(128),
  classId: z.string().trim().min(1).max(128),
  kind: StudentMemoryKindSchema,
  content: StudentMemoryContentSchema,
  salience: z.number().int().min(1).max(10).default(1),
  sourceTurnId: z.string().trim().min(1).max(128).nullable().optional(),
}).strict();

export const StudentMemoryDeleteInputSchema = z.object({
  classId: z.string().trim().min(1).max(128),
  studentId: z.string().trim().min(1).max(128),
  memoryId: z.string().uuid(),
}).strict();

export const StudentMemoryStudentDeleteInputSchema = z.object({
  memoryId: z.string().uuid(),
  kind: StudentMemoryKindSchema,
}).strict();

export const StudentMemoryDisputeInputSchema = z.object({
  memoryId: z.string().uuid(),
  kind: StudentMemoryKindSchema,
  note: StudentMemoryDisputeNoteSchema.nullable().optional().default(null),
}).strict();

export const StudentMemoryPublicSchema = z.object({
  id: z.string().uuid(),
  studentId: z.string().min(1).max(128),
  classId: z.string().min(1).max(128),
  kind: StudentMemoryKindSchema,
  content: StudentMemoryContentSchema,
  salience: z.number().int().min(1).max(10),
  sourceTurnId: z.string().min(1).max(128).nullable(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  studentDisputed: z.boolean(),
  studentDisputeNote: StudentMemoryDisputeNoteSchema.nullable(),
  studentDisputedAt: z.string().datetime().nullable(),
  dataType: DataTypeSchema,
}).strict();

export const StudentMemoryCollectionSchema = z.object({
  items: z.array(StudentMemoryPublicSchema).max(100),
  meta: z.object({
    total: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }).strict(),
}).strict();

export type StudentMemoryCreateInput = z.input<typeof StudentMemoryCreateInputSchema>;
export type StudentMemoryCandidate = z.input<typeof StudentMemoryCandidateSchema>;
export type StudentMemoryDeleteInput = z.infer<typeof StudentMemoryDeleteInputSchema>;
export type StudentMemoryStudentDeleteInput = z.infer<typeof StudentMemoryStudentDeleteInputSchema>;
export type StudentMemoryDisputeInput = z.infer<typeof StudentMemoryDisputeInputSchema>;
export type StudentMemoryPublic = z.infer<typeof StudentMemoryPublicSchema>;
export type StudentMemoryCollection = z.infer<typeof StudentMemoryCollectionSchema>;
