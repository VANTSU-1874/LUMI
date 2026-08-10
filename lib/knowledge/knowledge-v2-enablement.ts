export type KnowledgeV2EnablementReason =
  | "ENABLED"
  | "DISABLED"
  | "DEPENDENCY_DISABLED";

export type KnowledgeV2RawFlags = {
  knowledgeObjectV2: boolean;
  visualRetrieval: boolean;
  evidenceBundleV2: boolean;
};

export type KnowledgeV2Enablement = {
  raw: KnowledgeV2RawFlags;
  effective: KnowledgeV2RawFlags;
  reasons: {
    knowledgeObjectV2: KnowledgeV2EnablementReason;
    visualRetrieval: KnowledgeV2EnablementReason;
    evidenceBundleV2: KnowledgeV2EnablementReason;
  };
};

export type KnowledgeV2OperatingMode =
  | "LEGACY_ONLY"
  | "CONTROL_PRESET"
  | "AGENT_EVIDENCE_TEXT"
  | "AGENT_EVIDENCE_VISUAL";

function dependentReason(
  requested: boolean,
  dependencyEnabled: boolean,
): KnowledgeV2EnablementReason {
  if (!requested) return "DISABLED";
  return dependencyEnabled
    ? "ENABLED"
    : "DEPENDENCY_DISABLED";
}

export function resolveKnowledgeV2Enablement(
  input: KnowledgeV2RawFlags,
): KnowledgeV2Enablement {
  const raw = { ...input };
  const knowledgeObjectV2 = raw.knowledgeObjectV2;
  return {
    raw,
    effective: {
      knowledgeObjectV2,
      visualRetrieval:
        knowledgeObjectV2 && raw.visualRetrieval,
      evidenceBundleV2:
        knowledgeObjectV2 && raw.evidenceBundleV2,
    },
    reasons: {
      knowledgeObjectV2: knowledgeObjectV2
        ? "ENABLED"
        : "DISABLED",
      visualRetrieval: dependentReason(
        raw.visualRetrieval,
        knowledgeObjectV2,
      ),
      evidenceBundleV2: dependentReason(
        raw.evidenceBundleV2,
        knowledgeObjectV2,
      ),
    },
  };
}

/**
 * Names what the ordinary Agent path actually does. CONTROL_PRESET is not a
 * shadow run: the V2 runtime is deliberately not loaded until the evidence
 * bundle gate opens.
 */
export function classifyKnowledgeV2OperatingMode(
  input: KnowledgeV2RawFlags,
): KnowledgeV2OperatingMode {
  const { effective } =
    resolveKnowledgeV2Enablement(input);
  if (!effective.knowledgeObjectV2) {
    return "LEGACY_ONLY";
  }
  if (!effective.evidenceBundleV2) {
    return "CONTROL_PRESET";
  }
  return effective.visualRetrieval
    ? "AGENT_EVIDENCE_VISUAL"
    : "AGENT_EVIDENCE_TEXT";
}

export function resolveAgentKnowledgeV2Enablement(
  input: {
    knowledgeObjectV2Enabled?: boolean;
    visualRetrievalEnabled?: boolean;
    evidenceBundleV2Enabled?: boolean;
  },
) {
  return resolveKnowledgeV2Enablement({
    knowledgeObjectV2:
      input.knowledgeObjectV2Enabled ?? false,
    visualRetrieval:
      input.visualRetrievalEnabled ?? false,
    evidenceBundleV2:
      input.evidenceBundleV2Enabled ?? false,
  });
}

export type AgentEvidenceRuntimeV2Status =
  | "READY"
  | "KNOWLEDGE_OBJECT_DISABLED"
  | "EVIDENCE_BUNDLE_DISABLED"
  | "RUNTIME_UNAVAILABLE";

export async function prepareAgentEvidenceRuntimeV2(
  input: {
    knowledgeObjectV2Enabled?: boolean;
    visualRetrievalEnabled?: boolean;
    evidenceBundleV2Enabled?: boolean;
    evidenceSearchV2?: AgentEvidenceSearchPortV2;
  },
  load: () => Promise<AgentEvidenceSearchPortV2>,
) {
  const enablement =
    resolveAgentKnowledgeV2Enablement(input);
  if (!enablement.effective.knowledgeObjectV2) {
    return {
      enablement,
      port: null,
      error: null,
      status:
        "KNOWLEDGE_OBJECT_DISABLED" as const,
    };
  }
  if (!enablement.effective.evidenceBundleV2) {
    return {
      enablement,
      port: null,
      error: null,
      status: "EVIDENCE_BUNDLE_DISABLED" as const,
    };
  }
  try {
    return {
      enablement,
      port: input.evidenceSearchV2 ?? await load(),
      error: null,
      status: "READY" as const,
    };
  } catch (error) {
    return {
      enablement,
      port: null,
      error,
      status: "RUNTIME_UNAVAILABLE" as const,
    };
  }
}
import type {
  AgentEvidenceSearchPortV2,
} from "@/lib/agent/evidence-tool-v2";
