import { isGeneralDesignTechnicalToken, technicalTokens } from "./model-grounding";

// Legacy V2 rollback only. The V3 tutor must never gate learner text with a vocabulary allowlist.

type LearnerFacingText = {
  title: string;
  message: string;
  whyThisStep: string;
  uncertainty: string;
};

export function applyTechnicalVocabularyPolicy<T extends LearnerFacingText>(
  decision: T,
  groundingText: string,
  enabled: boolean,
): T {
  if (!enabled || decision.uncertainty.includes("通用设计建议")) return decision;
  const allowedTechnicalTokens = new Set(technicalTokens(groundingText));
  const unsupportedTechnicalTokens = technicalTokens([
    decision.title,
    decision.message,
    decision.whyThisStep,
    decision.uncertainty,
  ].join("\n")).filter((token) => !allowedTechnicalTokens.has(token));
  const unsupportedSpecificTokens = unsupportedTechnicalTokens.filter(
    (token) => !isGeneralDesignTechnicalToken(token),
  );
  if (unsupportedSpecificTokens.length > 0) {
    throw new Error(`MODEL_UNGROUNDED_TECHNICAL_TERM:${unsupportedSpecificTokens.slice(0, 8).join(",")}`);
  }
  return unsupportedTechnicalTokens.length === 0 ? decision : {
    ...decision,
    uncertainty: `通用设计建议（补充）：通用软硬件术语来自模型专业知识；${decision.uncertainty}`.slice(0, 500),
  };
}
