import type {
  ReleaseInferenceConfig,
  ReleaseRuntimeBinding,
  ReleaseSourceBinding,
} from "@/lib/agent/release-source-binding";

export const CLEAN_RELEASE_SOURCE = Object.freeze({
  sourceCommit: "a".repeat(40),
  sourceStatusHash: "b".repeat(64),
  sourceTrackedTreeClean: true,
}) satisfies ReleaseSourceBinding;

export const DIRTY_RELEASE_SOURCE = Object.freeze({
  ...CLEAN_RELEASE_SOURCE,
  sourceStatusHash: "c".repeat(64),
  sourceTrackedTreeClean: false,
}) satisfies ReleaseSourceBinding;

export const V3_RELEASE_RUNTIME = Object.freeze({
  id: "current-agent-runtime",
  version: "1.0.0",
  generation: "V3",
  entrypoint: "runTutorTurn",
  agentV3Enabled: true,
}) satisfies ReleaseRuntimeBinding;

export const LIVE_RELEASE_INFERENCE = Object.freeze({
  providerMode: "OPENAI_COMPATIBLE",
  modelId: "gpt-5.6",
  endpointHash: "e".repeat(64),
  retrievalModelId: "text-embedding-3-large",
  maxOutputTokens: 2048,
  modelIdleTimeoutMs: 120_000,
  modelTotalTimeoutMs: 600_000,
  turnTotalTimeoutMs: 900_000,
  vision: true,
}) satisfies ReleaseInferenceConfig;
