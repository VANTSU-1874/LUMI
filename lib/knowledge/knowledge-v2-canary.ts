import type {
  KnowledgeV2RawFlags,
} from "./knowledge-v2-enablement";

export type KnowledgeV2CanaryScope = {
  enrolled: boolean;
  flags: KnowledgeV2RawFlags;
};

const LEGACY_ONLY_FLAGS: KnowledgeV2RawFlags = {
  knowledgeObjectV2: false,
  visualRetrieval: false,
  evidenceBundleV2: false,
};

/**
 * Narrows process-wide V2 readiness flags to one authenticated account.
 * The allowlist is intentionally deny-by-default: an empty or non-matching
 * list preserves the legacy knowledge path without trusting browser state.
 */
export function resolveKnowledgeV2CanaryScope(input: {
  userId: string;
  canaryUserIds: readonly string[];
  flags: KnowledgeV2RawFlags;
}): KnowledgeV2CanaryScope {
  const enrolled = input.canaryUserIds.includes(input.userId);
  return {
    enrolled,
    flags: enrolled
      ? { ...input.flags }
      : { ...LEGACY_ONLY_FLAGS },
  };
}
