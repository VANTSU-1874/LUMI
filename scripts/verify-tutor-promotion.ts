import { createHash } from "node:crypto";
import path from "node:path";

import { isGpt56ModelId } from "@/lib/ai/model-id";
import { CURRENT_AGENT_RUNTIME } from "@/lib/agent/runtime/current-agent-runtime";
import { safeEvaluationErrorCode } from "@/lib/agent/evaluation-safety";
import { readReleaseSourceBinding } from "@/lib/agent/release-source-binding";
import { verifyTutorPromotionEvidence } from "@/lib/agent/tutor-quality-promotion";
import { readEnv } from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
  writeEffectiveModelConfigNotice,
} from "@/lib/config/runtime-environment";

async function main() {
  const loadedEnvironment = await loadRuntimeEnvironment({
    mode: "SERVICE_OPTIONAL",
    nodeEnv: "test",
  });
  const environment = loadedEnvironment.environment;
  const config = readEnv(environment);
  writeEffectiveModelConfigNotice(config, loadedEnvironment.provenance);
  if (!config.ai.enabled) throw new Error("TUTOR_PROMOTION_REQUIRES_MODEL_CONFIG");
  if (!isGpt56ModelId(config.ai.model!)) {
    throw new Error("TUTOR_PROMOTION_REQUIRES_GPT_5_6");
  }
  if (!config.ai.vision) throw new Error("TUTOR_PROMOTION_REQUIRES_VISION_ENABLED");
  const endpointHash = createHash("sha256")
    .update(new URL(config.ai.baseUrl!).toString(), "utf8")
    .digest("hex");
  const source = readReleaseSourceBinding();
  const inferenceConfig = {
    providerMode: "OPENAI_COMPATIBLE" as const,
    modelId: config.ai.model!,
    endpointHash,
    retrievalModelId: config.ai.embeddingModel ?? null,
    maxOutputTokens: config.ai.maxOutputTokens,
    modelIdleTimeoutMs: config.agentTimeouts.evaluation.modelIdleTimeoutMs,
    modelTotalTimeoutMs: config.agentTimeouts.evaluation.modelTotalTimeoutMs,
    turnTotalTimeoutMs: config.agentTimeouts.evaluation.turnTotalTimeoutMs,
    vision: config.ai.vision,
  };
  const result = verifyTutorPromotionEvidence({
    agentEvaluationSuitePath: path.resolve("data/evals/agent-core.json"),
    agentEvaluationReportPath: path.resolve(environment.AGENT_EVAL_REPORT_PATH?.trim()
      || ".runtime/agent-eval/latest.json"),
    harnessReportPath: path.resolve(environment.AGENT_HARNESS_REPORT_PATH?.trim()
      || ".runtime/agent-harness/latest.json"),
    tutorQualitySuitePath: path.resolve("tests/tutor-quality/golden-suite.json"),
    tutorQualityReportPath: path.resolve(environment.TUTOR_QUALITY_REPORT_PATH?.trim()
      || ".runtime/tutor-quality/latest.json"),
    humanScenarioSuitePath: path.resolve("tests/tutor-quality/human-scenarios.json"),
    humanValidationReportPath: path.resolve(environment.TUTOR_HUMAN_REPORT_PATH?.trim()
      || ".runtime/tutor-quality/human-latest.json"),
    ...source,
    runtime: {
      ...CURRENT_AGENT_RUNTIME,
      generation: "V3",
      entrypoint: "runTutorTurn",
      agentV3Enabled: true,
    },
    inferenceConfig,
    configuredSecret: config.ai.apiKey!,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${safeEvaluationErrorCode(
    error,
    "TUTOR_PROMOTION_EXECUTION_FAILED",
    [
      "TUTOR_PROMOTION_REQUIRES_GPT_5_6",
      "TUTOR_PROMOTION_REQUIRES_MODEL_CONFIG",
      "TUTOR_PROMOTION_REQUIRES_VISION_ENABLED",
    ],
  )}\n`);
  process.exitCode = 1;
});
