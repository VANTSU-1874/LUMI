import { z } from "zod";

export const STUDENT_DECLARED_MAJORS = [
  "general-design",
  "digital-interaction",
  "book-design",
] as const;

export const STUDENT_SELF_ASSESSED_LEVELS = [
  "BEGINNER",
  "FOUNDATION",
  "EXPERIENCED",
] as const;

export const StudentDeclaredMajorSchema = z.enum(STUDENT_DECLARED_MAJORS);
export const StudentSelfAssessedLevelSchema = z.enum(STUDENT_SELF_ASSESSED_LEVELS);
export const StudentNicknameSchema = z.string().trim().min(1).max(40);
export const StudentInterestsSchema = z.string().trim().min(1).max(300);
const StudentDisplayNameSchema = z.string().trim().min(1).max(80);

export const StudentOnboardingUpdateSchema = z.object({
  nickname: StudentNicknameSchema.nullable(),
  major: StudentDeclaredMajorSchema.nullable(),
  selfAssessedLevel: StudentSelfAssessedLevelSchema.nullable(),
  interests: StudentInterestsSchema.nullable(),
  markCompleted: z.boolean(),
}).strict();

export const StudentOnboardingProfileSchema = z.object({
  nickname: StudentNicknameSchema.nullable(),
  displayName: StudentDisplayNameSchema,
  major: StudentDeclaredMajorSchema.nullable(),
  selfAssessedLevel: StudentSelfAssessedLevelSchema.nullable(),
  interests: StudentInterestsSchema.nullable(),
  completedAt: z.string().datetime().nullable(),
  completed: z.boolean(),
}).strict();

export type StudentDeclaredMajor = z.infer<typeof StudentDeclaredMajorSchema>;
export type StudentSelfAssessedLevel = z.infer<typeof StudentSelfAssessedLevelSchema>;
export type StudentOnboardingUpdate = z.infer<typeof StudentOnboardingUpdateSchema>;
export type StudentOnboardingProfile = z.infer<typeof StudentOnboardingProfileSchema>;
