import {
  ReviewPackDecisionInputSchema,
  ReviewPackPreparationSchema,
  ReviewPackSourceSchema,
  StrictReviewPackSchema,
  type ReviewPackDecisionInput,
  type ReviewPackPreparation,
  type ReviewPackStage,
  type StrictReviewPack,
} from "./review-pack-contracts";

const REQUIRED_GATES: Array<keyof ReviewPackPreparation> = [
  "controlledMediaGroup",
  "workSourceMatch",
  "sourceRole",
  "rightsEvidence",
  "normalizedClassification",
  "visualDescription",
  "duplicateRelationship",
  "curationRecommendation",
  "teachingRecommendation",
];

export function deriveReviewPackStage(rawPreparation: ReviewPackPreparation): ReviewPackStage {
  const preparation = ReviewPackPreparationSchema.parse(rawPreparation);
  return REQUIRED_GATES.every((gate) => preparation[gate]) ? "READY_FOR_TEACHER_REVIEW" : "PACKAGING";
}

export function parseStrictReviewPack(value: unknown): StrictReviewPack {
  return StrictReviewPackSchema.parse(value);
}

export function validateReviewPackSource(value: unknown) {
  return ReviewPackSourceSchema.parse(value);
}

export function transitionReviewPack(
  current: StrictReviewPack,
  rawDecision: ReviewPackDecisionInput,
) {
  const reviewPack = StrictReviewPackSchema.parse(current);
  const decision = ReviewPackDecisionInputSchema.parse(rawDecision);
  if (decision.reviewPackId !== reviewPack.reviewPackId || decision.reviewPackRevision !== reviewPack.revision) {
    throw new Error("REVIEW_PACK_REVISION_CONFLICT");
  }
  return {
    reviewPackId: reviewPack.reviewPackId,
    previousRevision: reviewPack.revision,
    revision: reviewPack.revision + 1,
    finalAction: decision.finalAction,
    stage: {
      RETURN_TO_CODEX: "RETURNED_TO_CODEX",
      REJECT_CANDIDATE: "REJECTED",
      ENTER_PRIVATE_WIKIDRAFT: "PRIVATE_WIKIDRAFT",
    }[decision.finalAction] as ReviewPackStage,
    capabilityBoundary: reviewPack.capabilityBoundary,
  };
}

export const REVIEW_PACK_REQUIRED_GATES = [...REQUIRED_GATES] as const;
