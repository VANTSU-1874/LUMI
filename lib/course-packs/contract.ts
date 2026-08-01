import { z } from "zod";

export const LearningEpisodeSchema = z.enum([
  "EXPLORE",
  "UNDERSTAND",
  "BUILD",
  "DEBUG",
  "TRANSFER",
  "REFLECT",
]);

export type LearningEpisode = z.infer<typeof LearningEpisodeSchema>;

export const DimensionDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
}).strict();

export const ConceptFieldDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z][a-zA-Z0-9-]{0,63}$/),
  label: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(300),
}).strict();

export const EvidencePolicySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  label: z.string().trim().min(1).max(100),
  acceptedKinds: z.array(z.enum(["TEXT", "IMAGE", "VALUE", "VIDEO_LINK", "PROBE"])).min(1),
}).strict();

export const TransferPolicySchema = z.object({
  retain: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  change: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  successStatement: z.string().trim().min(1).max(300),
}).strict();

export const CoursePackSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  version: z.string().regex(/^\d+$/),
  label: z.string().trim().min(1).max(100),
  summary: z.string().trim().min(1).max(400),
  capabilityDimensions: z.array(DimensionDefinitionSchema).min(3).max(10),
  diagnostic: z.object({
    questionSetVersion: z.string().trim().min(1).max(32),
    questionCount: z.number().int().positive().max(50),
  }).strict(),
  conceptModel: z.object({
    label: z.string().trim().min(1).max(100),
    fields: z.array(ConceptFieldDefinitionSchema).min(3).max(12),
  }).strict(),
  evidencePolicies: z.array(EvidencePolicySchema).min(1).max(12),
  transferPolicy: TransferPolicySchema,
  knowledgeNamespaces: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).max(20),
  toolAdapterIds: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).max(20),
  supportedEpisodes: z.array(LearningEpisodeSchema).min(1).max(6),
}).strict().superRefine((pack, context) => {
  const collections = [
    [pack.capabilityDimensions.map(({ id }) => id), "capabilityDimensions"],
    [pack.conceptModel.fields.map(({ id }) => id), "conceptModel"],
    [pack.evidencePolicies.map(({ id }) => id), "evidencePolicies"],
    [pack.knowledgeNamespaces, "knowledgeNamespaces"],
    [pack.toolAdapterIds, "toolAdapterIds"],
    [pack.supportedEpisodes, "supportedEpisodes"],
  ] as const;
  for (const [values, path] of collections) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: [path], message: `${path} must be unique` });
    }
  }
});

export type CoursePack = z.infer<typeof CoursePackSchema>;

export function coursePackKey(pack: Pick<CoursePack, "id" | "version">) {
  return `${pack.id}@${pack.version}`;
}
