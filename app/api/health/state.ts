export type PublicHealth = {
  status: "ok" | "degraded";
  database: { available: boolean };
  knowledge: {
    chunkCount: number | null;
    coursePacks: {
      "general-design@1": number | null;
      "digital-interaction@1": number | null;
      "book-design@1": number | null;
    };
  };
  aiConfigured: boolean;
  agentV2Enabled: boolean;
  agentQuality: {
    status: "not_run" | "passed" | "failed" | "stale" | "invalid";
    suiteVersion: string | null;
    evaluatedAt: string | null;
    caseCount: number | null;
    passedCaseCount: number | null;
    modelAssistedRate: number | null;
    metrics: {
      routing: number;
      answerRelevance: number;
      sourcePrecision: number;
      actionSafety: number;
      safety: number;
    } | null;
  };
  agentHarness: {
    status: "not_run" | "passed" | "failed" | "stale" | "invalid";
    harnessVersion: string | null;
    evaluatedAt: string | null;
    caseCount: number | null;
    passedCaseCount: number | null;
  };
  competitionReady: boolean;
};

type CachedHealth = { expiresAt: number; payload: PublicHealth };

export const healthCache = new Map<string, CachedHealth>();

export function resetPublicHealthCacheForTests() {
  healthCache.clear();
}
