import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import { z } from "zod";

export const ALLOWED_UNTRACKED_TUTOR_PLAN =
  "?? docs/superpowers/plans/2026-07-17-tonggan-agent-v3-tutor-rebuild.md";

export const ReleaseSourceBindingSchema = z.object({
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  sourceStatusHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceTrackedTreeClean: z.boolean(),
}).strict();

export type ReleaseSourceBinding = z.infer<typeof ReleaseSourceBindingSchema>;

export const ReleaseRuntimeBindingSchema = z.object({
  id: z.string().trim().min(1).max(80),
  version: z.string().trim().min(1).max(40),
  generation: z.literal("V3"),
  entrypoint: z.literal("runTutorTurn"),
  agentV3Enabled: z.literal(true),
}).strict();

export type ReleaseRuntimeBinding = z.infer<typeof ReleaseRuntimeBindingSchema>;

export const ReleaseInferenceConfigSchema = z.object({
  providerMode: z.enum(["OPENAI_COMPATIBLE", "DETERMINISTIC", "TEST"]),
  modelId: z.string().trim().min(1).max(200),
  endpointHash: z.string().regex(/^[a-f0-9]{64}$/),
  retrievalModelId: z.string().trim().min(1).max(200).nullable(),
  maxOutputTokens: z.number().int().min(1).max(4096).nullable(),
  modelIdleTimeoutMs: z.number().int().min(1).max(600_000).nullable(),
  modelTotalTimeoutMs: z.number().int().min(1).max(600_000).nullable(),
  turnTotalTimeoutMs: z.number().int().min(1).max(900_000).nullable(),
  vision: z.boolean(),
}).strict().superRefine((config, context) => {
  if (config.providerMode === "OPENAI_COMPATIBLE" && config.maxOutputTokens === null) {
    context.addIssue({
      code: "custom",
      path: ["maxOutputTokens"],
      message: "live inference requires an output-token budget",
    });
  }
  if (config.providerMode === "OPENAI_COMPATIBLE" && config.modelTotalTimeoutMs === null) {
    context.addIssue({
      code: "custom",
      path: ["modelTotalTimeoutMs"],
      message: "live inference requires a model total-timeout budget",
    });
  }
  if (config.providerMode === "OPENAI_COMPATIBLE" && config.modelIdleTimeoutMs === null) {
    context.addIssue({
      code: "custom",
      path: ["modelIdleTimeoutMs"],
      message: "live inference requires a model idle-timeout budget",
    });
  }
  if (config.providerMode === "OPENAI_COMPATIBLE" && config.turnTotalTimeoutMs === null) {
    context.addIssue({
      code: "custom",
      path: ["turnTotalTimeoutMs"],
      message: "live inference requires a turn total-timeout budget",
    });
  }
  if (
    config.modelIdleTimeoutMs !== null
    && config.modelTotalTimeoutMs !== null
    && config.modelIdleTimeoutMs >= config.modelTotalTimeoutMs
  ) {
    context.addIssue({
      code: "custom",
      path: ["modelIdleTimeoutMs"],
      message: "model idle-timeout must be lower than model total-timeout",
    });
  }
  if (
    config.modelTotalTimeoutMs !== null
    && config.turnTotalTimeoutMs !== null
    && config.modelTotalTimeoutMs >= config.turnTotalTimeoutMs
  ) {
    context.addIssue({
      code: "custom",
      path: ["turnTotalTimeoutMs"],
      message: "turn total-timeout must exceed model total-timeout",
    });
  }
  if (config.providerMode === "DETERMINISTIC" && (
    config.retrievalModelId !== null
    || config.maxOutputTokens !== null
    || config.modelIdleTimeoutMs !== null
    || config.modelTotalTimeoutMs !== null
    || config.turnTotalTimeoutMs !== null
    || config.vision
  )) {
    context.addIssue({
      code: "custom",
      message: "deterministic inference cannot claim model-only capabilities",
    });
  }
});

export type ReleaseInferenceConfig = z.infer<typeof ReleaseInferenceConfigSchema>;

export function normalizeReleaseGitStatus(rawStatus: string) {
  return rawStatus.replaceAll("\r\n", "\n").replace(/\n+$/, "");
}

export function buildReleaseSourceBinding(
  sourceCommit: string,
  rawStatus: string,
): ReleaseSourceBinding {
  const status = normalizeReleaseGitStatus(rawStatus);
  const statusLines = status ? status.split("\n") : [];
  return ReleaseSourceBindingSchema.parse({
    sourceCommit: sourceCommit.trim(),
    sourceStatusHash: createHash("sha256").update(status, "utf8").digest("hex"),
    sourceTrackedTreeClean: statusLines.every((line) => line === ALLOWED_UNTRACKED_TUTOR_PLAN),
  });
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (
      relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

export function readReleaseSourceBinding(
  cwd = process.cwd(),
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const configuredBindingPath = environment.RELEASE_SOURCE_BINDING_PATH?.trim();
  if (configuredBindingPath) {
    const releaseRoot = realpathSync(path.resolve(cwd));
    const bindingPath = path.resolve(releaseRoot, configuredBindingPath);
    const bindingInfo = lstatSync(bindingPath);
    const bindingRealPath = realpathSync(bindingPath);
    if (
      bindingInfo.isSymbolicLink()
      || !bindingInfo.isFile()
      || !isWithin(releaseRoot, bindingRealPath)
    ) {
      throw new Error("RELEASE_SOURCE_BINDING_FILE_INVALID");
    }
    const binding = ReleaseSourceBindingSchema.parse(
      JSON.parse(readFileSync(bindingRealPath, "utf8")),
    );
    if (!binding.sourceTrackedTreeClean) {
      throw new Error("RELEASE_SOURCE_BINDING_FILE_NOT_CLEAN");
    }
    return binding;
  }
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  const rawStatus = execFileSync("git", ["status", "--porcelain=v1"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return buildReleaseSourceBinding(sourceCommit, rawStatus);
}

export function sameReleaseSourceBinding(
  left: ReleaseSourceBinding,
  right: ReleaseSourceBinding,
) {
  return left.sourceCommit === right.sourceCommit
    && left.sourceStatusHash === right.sourceStatusHash
    && left.sourceTrackedTreeClean === right.sourceTrackedTreeClean;
}

export function sameReleaseRuntimeBinding(
  left: ReleaseRuntimeBinding,
  right: ReleaseRuntimeBinding,
) {
  return left.id === right.id
    && left.version === right.version
    && left.generation === right.generation
    && left.entrypoint === right.entrypoint
    && left.agentV3Enabled === right.agentV3Enabled;
}

export function sameReleaseInferenceConfig(
  left: ReleaseInferenceConfig,
  right: ReleaseInferenceConfig,
) {
  return left.providerMode === right.providerMode
    && left.modelId === right.modelId
    && left.endpointHash === right.endpointHash
    && left.retrievalModelId === right.retrievalModelId
    && left.maxOutputTokens === right.maxOutputTokens
    && left.modelIdleTimeoutMs === right.modelIdleTimeoutMs
    && left.modelTotalTimeoutMs === right.modelTotalTimeoutMs
    && left.turnTotalTimeoutMs === right.turnTotalTimeoutMs
    && left.vision === right.vision;
}
