import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { parseServiceEnvironment } from "./service-environment";

export const INFERENCE_ENVIRONMENT_KEYS = [
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "LLM_EMBEDDING_BASE_URL",
  "LLM_EMBEDDING_API_KEY",
  "LLM_EMBEDDING_MODEL",
  "LLM_MAX_OUTPUT_TOKENS",
  "LLM_VISION_ENABLED",
  "AGENT_MODEL_IDLE_TIMEOUT_MS",
  "AGENT_MODEL_TOTAL_TIMEOUT_MS",
  "AGENT_TURN_TOTAL_TIMEOUT_MS",
  "AGENT_EVAL_MODEL_IDLE_TIMEOUT_MS",
  "AGENT_EVAL_MODEL_TOTAL_TIMEOUT_MS",
  "AGENT_EVAL_TURN_TOTAL_TIMEOUT_MS",
] as const;

export type RuntimeEnvironmentMode =
  | "PROJECT_ONLY"
  | "SERVICE_OPTIONAL"
  | "SERVICE_REQUIRED"
  | "EXPLICIT_SERVICE_OR_PROJECT";

export type RuntimeEnvironmentProvenance = {
  service: {
    status: "loaded" | "missing" | "disabled";
    selection: "explicit" | "default" | null;
    sourceFile: string | null;
  };
  model: {
    source: "service-env" | "process-env" | "project-env" | "unset";
    sourceFile: string | null;
    shadowedProjectModelConfig: boolean;
  };
};

type EnvironmentSnapshot = Record<string, string | undefined>;

type RuntimeEnvironmentOptions = {
  cwd?: string;
  mode: RuntimeEnvironmentMode;
  nodeEnv?: string;
  processEnvironment?: EnvironmentSnapshot;
};

type LoadedProjectEnvironment = {
  combinedEnv: EnvironmentSnapshot;
  loadedEnvFiles: Array<{ path: string; env?: Record<string, string | undefined> }>;
};

type EffectiveModelConfiguration = {
  ai: { baseUrl?: string };
};

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function displayPath(filePath: string, cwd: string, localAppData: string | undefined) {
  const resolved = path.resolve(cwd, filePath);
  if (localAppData && path.isAbsolute(localAppData) && isWithin(path.resolve(localAppData), resolved)) {
    const relative = path.relative(path.resolve(localAppData), resolved);
    return path.join("%LOCALAPPDATA%", relative);
  }
  if (isWithin(cwd, resolved)) {
    const relative = path.relative(cwd, resolved);
    return relative ? `.${path.sep}${relative}` : ".";
  }
  return path.join("<external>", path.basename(resolved));
}

function projectModelSource(
  incomingEnvironment: EnvironmentSnapshot,
  loadedEnvFiles: Array<{ path: string; env?: Record<string, string | undefined> }>,
) {
  if (incomingEnvironment.LLM_BASE_URL?.trim()) {
    return { source: "process-env" as const, sourceFile: null };
  }
  const source = loadedEnvFiles.find(({ env }) => env?.LLM_BASE_URL?.trim());
  return source
    ? { source: "project-env" as const, sourceFile: source.path }
    : { source: "unset" as const, sourceFile: null };
}

function resolveServiceSelection(
  mode: RuntimeEnvironmentMode,
  incomingEnvironment: EnvironmentSnapshot,
  cwd: string,
) {
  if (mode === "PROJECT_ONLY") return null;
  const explicit = incomingEnvironment.CHUYING_SERVICE_ENV?.trim();
  if (explicit) {
    return { path: path.resolve(cwd, explicit), selection: "explicit" as const };
  }
  if (mode === "EXPLICIT_SERVICE_OR_PROJECT") return null;
  const localAppData = incomingEnvironment.LOCALAPPDATA?.trim();
  if (!localAppData || !path.isAbsolute(localAppData)) {
    if (mode === "SERVICE_REQUIRED") throw new Error("SERVICE_ENV_LOCALAPPDATA_UNAVAILABLE");
    return null;
  }
  return {
    path: path.join(localAppData, "ChuyingAI", "config", "service.env"),
    selection: "default" as const,
  };
}

export async function loadRuntimeEnvironment(options: RuntimeEnvironmentOptions) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const hasInjectedEnvironment = options.processEnvironment !== undefined;
  const incomingEnvironment = {
    ...(hasInjectedEnvironment ? options.processEnvironment : process.env),
  };
  const development = (options.nodeEnv ?? incomingEnvironment.NODE_ENV) !== "production";
  const loaded: LoadedProjectEnvironment = hasInjectedEnvironment
    ? { combinedEnv: { ...incomingEnvironment }, loadedEnvFiles: [] }
    : loadEnvConfig(cwd, development, console, true);
  const projectEnvironment: EnvironmentSnapshot = {
    ...loaded.combinedEnv,
    ...incomingEnvironment,
  };
  const projectSource = projectModelSource(incomingEnvironment, loaded.loadedEnvFiles);
  const serviceSelection = resolveServiceSelection(options.mode, incomingEnvironment, cwd);

  let serviceEnvironment: Record<string, string> | null = null;
  if (serviceSelection) {
    if (!existsSync(serviceSelection.path)) {
      if (serviceSelection.selection === "explicit" || options.mode === "SERVICE_REQUIRED") {
        throw new Error(`SERVICE_ENV_NOT_FOUND:${displayPath(
          serviceSelection.path,
          cwd,
          incomingEnvironment.LOCALAPPDATA,
        )}`);
      }
    } else {
      serviceEnvironment = parseServiceEnvironment(await readFile(serviceSelection.path, "utf8"));
    }
  }

  const projectHasInferenceConfiguration = INFERENCE_ENVIRONMENT_KEYS.some(
    (key) => projectEnvironment[key]?.trim(),
  );
  const environment: Record<string, string | undefined> = { ...projectEnvironment };
  if (serviceEnvironment) {
    for (const key of INFERENCE_ENVIRONMENT_KEYS) delete environment[key];
    Object.assign(environment, serviceEnvironment);
  }
  if (incomingEnvironment.CHUYING_SERVICE_ENV?.trim()) {
    environment.CHUYING_SERVICE_ENV = incomingEnvironment.CHUYING_SERVICE_ENV.trim();
  } else {
    delete environment.CHUYING_SERVICE_ENV;
  }
  if (options.nodeEnv) environment.NODE_ENV = options.nodeEnv;

  const serviceSourceFile = serviceSelection && serviceEnvironment
    ? displayPath(serviceSelection.path, cwd, incomingEnvironment.LOCALAPPDATA)
    : null;
  const serviceHasInferenceConfiguration = serviceEnvironment
    ? INFERENCE_ENVIRONMENT_KEYS.some((key) => serviceEnvironment![key]?.trim())
    : false;
  const modelSource = serviceEnvironment
    ? {
        source: serviceHasInferenceConfiguration ? "service-env" as const : "unset" as const,
        sourceFile: serviceHasInferenceConfiguration ? serviceSourceFile : null,
      }
    : {
        ...projectSource,
        sourceFile: projectSource.sourceFile
          ? displayPath(projectSource.sourceFile, cwd, incomingEnvironment.LOCALAPPDATA)
          : null,
      };

  return {
    environment,
    provenance: {
      service: serviceEnvironment && serviceSelection
        ? {
            status: "loaded" as const,
            selection: serviceSelection.selection,
            sourceFile: serviceSourceFile,
          }
        : {
            status: serviceSelection ? "missing" as const : "disabled" as const,
            selection: serviceSelection?.selection ?? null,
            sourceFile: serviceSelection
              ? displayPath(serviceSelection.path, cwd, incomingEnvironment.LOCALAPPDATA)
              : null,
          },
      model: {
        ...modelSource,
        shadowedProjectModelConfig: Boolean(serviceEnvironment && projectHasInferenceConfiguration),
      },
    } satisfies RuntimeEnvironmentProvenance,
  };
}

export function effectiveModelConfigNotice(
  config: EffectiveModelConfiguration,
  provenance: RuntimeEnvironmentProvenance,
) {
  return {
    event: "effective-model-config" as const,
    baseUrl: config.ai.baseUrl ?? null,
    source: provenance.model.source,
    sourceFile: provenance.model.sourceFile,
    shadowedProjectModelConfig: provenance.model.shadowedProjectModelConfig,
  };
}

export function writeEffectiveModelConfigNotice(
  config: EffectiveModelConfiguration,
  provenance: RuntimeEnvironmentProvenance,
  stream: Pick<NodeJS.WriteStream, "write"> = process.stderr,
) {
  stream.write(`${JSON.stringify(effectiveModelConfigNotice(config, provenance))}\n`);
}
