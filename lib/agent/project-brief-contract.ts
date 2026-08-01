import { z } from "zod";

export const PROJECT_BRIEF_FIELD_IDS = [
  "designGoal",
  "audienceAndContext",
  "coreContent",
  "visualExperienceDirection",
  "mediumConstraints",
  "processPlan",
  "successCriteria",
  "nextStep",
] as const;

export const ProjectBriefFieldIdSchema = z.enum(PROJECT_BRIEF_FIELD_IDS);
export type ProjectBriefFieldId = z.infer<typeof ProjectBriefFieldIdSchema>;

export const ProjectBriefFieldUpdateSchema = z.object({
  value: z.string().trim().min(1).max(500),
  status: z.enum(["INFERRED", "CONFIRMED"]),
}).strict();

const optionalUpdate = ProjectBriefFieldUpdateSchema.optional();

export const ProjectBriefPatchSchema = z.object({
  designGoal: optionalUpdate,
  audienceAndContext: optionalUpdate,
  coreContent: optionalUpdate,
  visualExperienceDirection: optionalUpdate,
  mediumConstraints: optionalUpdate,
  processPlan: optionalUpdate,
  successCriteria: optionalUpdate,
  nextStep: optionalUpdate,
}).strict().default({});

export const ProjectBriefFieldSchema = ProjectBriefFieldUpdateSchema.extend({
  sourceTurnId: z.string().uuid(),
  updatedAt: z.string().datetime(),
}).strict();

const optionalField = ProjectBriefFieldSchema.optional();

export const ProjectBriefSchema = z.object({
  revision: z.number().int().nonnegative(),
  fields: z.object({
    designGoal: optionalField,
    audienceAndContext: optionalField,
    coreContent: optionalField,
    visualExperienceDirection: optionalField,
    mediumConstraints: optionalField,
    processPlan: optionalField,
    successCriteria: optionalField,
    nextStep: optionalField,
  }).strict(),
  updatedAt: z.string().datetime().nullable(),
}).strict();

export type ProjectBrief = z.infer<typeof ProjectBriefSchema>;
export type ProjectBriefPatch = z.infer<typeof ProjectBriefPatchSchema>;
