import { z } from "zod";

const CompetitionHealthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  database: z.object({ available: z.boolean() }),
  knowledge: z.object({
    coursePacks: z.object({
      "general-design@1": z.number().int().nonnegative().nullable(),
      "digital-interaction@1": z.number().int().nonnegative().nullable(),
      "book-design@1": z.number().int().nonnegative().nullable(),
    }),
  }),
  aiConfigured: z.boolean(),
  agentV2Enabled: z.boolean(),
  agentQuality: z.object({ status: z.enum(["not_run", "passed", "failed", "stale", "invalid"]) }),
  agentHarness: z.object({ status: z.enum(["not_run", "passed", "failed", "stale", "invalid"]) }),
  competitionReady: z.boolean(),
}).passthrough();

export function assessCompetitionHealth(input: unknown) {
  const parsed = CompetitionHealthSchema.safeParse(input);
  if (!parsed.success) {
    return {
      validResponse: false,
      statusOk: false,
      databaseAvailable: false,
      aiConfigured: false,
      agentV2Enabled: false,
      generalKnowledgeReady: false,
      digitalKnowledgeReady: false,
      bookKnowledgeReady: false,
      agentQualityPassed: false,
      agentHarnessPassed: false,
      competitionReady: false,
    };
  }
  const health = parsed.data;
  return {
    validResponse: true,
    statusOk: health.status === "ok",
    databaseAvailable: health.database.available,
    aiConfigured: health.aiConfigured,
    agentV2Enabled: health.agentV2Enabled,
    generalKnowledgeReady: (health.knowledge.coursePacks["general-design@1"] ?? 0) > 0,
    digitalKnowledgeReady: (health.knowledge.coursePacks["digital-interaction@1"] ?? 0) > 0,
    bookKnowledgeReady: (health.knowledge.coursePacks["book-design@1"] ?? 0) > 0,
    agentQualityPassed: health.agentQuality.status === "passed",
    agentHarnessPassed: health.agentHarness.status === "passed",
    competitionReady: health.competitionReady,
  };
}
