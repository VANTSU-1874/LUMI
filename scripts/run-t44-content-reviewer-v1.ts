import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  guardModelProviderSecretOutputs,
} from "@/lib/agent/evaluation-safety";
import {
  createOpenAICompatibleModelProvider,
} from "@/lib/agent/model-provider-adapter";
import { isGpt56ModelId } from "@/lib/ai/model-id";
import {
  readEnv,
  resolvePlannerModelConfiguration,
} from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
} from "@/lib/config/runtime-environment";
import {
  loadT44ContentRerankerSourceBundleV1,
  runT44ContentRerankerModelBatchV1,
} from "@/scripts/run-t44-content-reranker-v1";
import {
  T44_CONTENT_REVIEWER_CONFIG_HASH_V1,
  T44_CONTENT_REVIEWER_CONFIG_V1,
  T44ContentReviewerSelectionArtifactV1Schema,
  applyT44ContentReviewerCompletionV1,
  buildT44ContentReviewerPromptV1,
  sealT44ContentReviewerSelectionArtifactV1,
} from "@/tools/mixed-retrieval/t44-content-reviewer-v1";
import {
  T44ContentRerankerSelectionArtifactV1Schema,
  T44ContentRerankerSelectionCaseV1Schema,
  verifyT44ContentRerankerSelectionSealV1,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";

const RUN_ID_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARTIFACT_ID_PATTERN =
  /^(?:pilot|full)-v[1-9][0-9]*$/;
const ARTIFACT_ROOT = ".runtime/mixed-retrieval";

function sha256Utf8(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

export function parseT44ContentReviewerRunArguments(
  argv: readonly string[],
) {
  let runId: string | null = null;
  let draftArtifactId: string | null = null;
  let artifactId: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (index === 0 && token === "--") continue;
    if (token === "--run-id" && value) {
      runId = value;
      index += 1;
      continue;
    }
    if (token === "--draft-artifact-id" && value) {
      draftArtifactId = value;
      index += 1;
      continue;
    }
    if (token === "--artifact-id" && value) {
      artifactId = value;
      index += 1;
      continue;
    }
    throw new Error(
      `T44_CONTENT_REVIEWER_ARGUMENT_INVALID:${token ?? "<missing>"}`,
    );
  }
  if (
    !runId
    || !RUN_ID_PATTERN.test(runId)
    || !draftArtifactId
    || !ARTIFACT_ID_PATTERN.test(draftArtifactId)
    || !artifactId
    || !ARTIFACT_ID_PATTERN.test(artifactId)
  ) {
    throw new Error(
      "T44_CONTENT_REVIEWER_ARGUMENTS_REQUIRED",
    );
  }
  if (draftArtifactId === artifactId) {
    throw new Error(
      "T44_CONTENT_REVIEWER_ARTIFACT_IDS_INVALID",
    );
  }
  const draftScope = draftArtifactId.startsWith(
    "pilot-",
  ) ? "PILOT" : "FULL";
  const outputScope = artifactId.startsWith(
    "pilot-",
  ) ? "PILOT" : "FULL";
  if (draftScope !== outputScope) {
    throw new Error(
      "T44_CONTENT_REVIEWER_ARTIFACT_SCOPE_MISMATCH",
    );
  }
  return {
    runId,
    draftArtifactId,
    artifactId,
    scope: outputScope as "PILOT" | "FULL",
  };
}

function mapUnique<T extends { caseId: string }>(
  rows: readonly T[],
  label: string,
) {
  const result = new Map(
    rows.map((row) => [row.caseId, row]),
  );
  if (result.size !== rows.length) {
    throw new Error(
      `T44_CONTENT_REVIEWER_${label}_CASE_DUPLICATE`,
    );
  }
  return result;
}

export async function loadT44ContentReviewerSourceBundleV1(
  input: {
    workspaceRoot: string;
    runId: string;
    draftArtifactId: string;
  },
) {
  const draftPath = path.resolve(
    input.workspaceRoot,
    ARTIFACT_ROOT,
    `t44-obligation-${input.runId}.content-reranker-${input.draftArtifactId}.selection.json`,
  );
  const draftSerialized = await readFile(
    draftPath,
    "utf8",
  );
  const draftSha256 = sha256Utf8(draftSerialized);
  const unverified =
    T44ContentRerankerSelectionArtifactV1Schema
      .parse(JSON.parse(draftSerialized) as unknown);
  if (unverified.artifactId !== input.draftArtifactId) {
    throw new Error(
      "T44_CONTENT_REVIEWER_DRAFT_ARTIFACT_ID_DRIFT",
    );
  }
  const source =
    await loadT44ContentRerankerSourceBundleV1({
      workspaceRoot: input.workspaceRoot,
      runId: input.runId,
      scope: unverified.scope,
    });
  const draft =
    verifyT44ContentRerankerSelectionSealV1({
      seal: {
        serialized: draftSerialized,
        sha256: draftSha256,
        bytes: Buffer.byteLength(
          draftSerialized,
          "utf8",
        ),
      },
      expectedInputs: source.inputSeals,
    });
  const draftById = mapUnique(
    draft.cases,
    "DRAFT",
  );
  const prompts = source.prompts.map(
    (sourcePrompt) => {
      const draftCase =
        draftById.get(sourcePrompt.caseId);
      if (!draftCase) {
        throw new Error(
          `T44_CONTENT_REVIEWER_DRAFT_CASE_MISSING:${sourcePrompt.caseId}`,
        );
      }
      return buildT44ContentReviewerPromptV1({
        sourcePrompt,
        draftCase,
      });
    },
  );
  if (prompts.length !== draft.cases.length) {
    throw new Error(
      "T44_CONTENT_REVIEWER_DRAFT_CASE_COUNT_DRIFT",
    );
  }
  return {
    source,
    draft,
    draftPath,
    draftSeal: {
      sha256: draftSha256,
      bytes: Buffer.byteLength(
        draftSerialized,
        "utf8",
      ),
    },
    prompts,
    inputSeals: {
      ...source.inputSeals,
      draftSelectionSha256: draftSha256,
    },
  };
}

async function writeNewArtifact(
  filePath: string,
  content: string,
) {
  await mkdir(path.dirname(filePath), {
    recursive: true,
  });
  await writeFile(filePath, content, {
    encoding: "utf8",
    flag: "wx",
  });
  const observed = await readFile(filePath, "utf8");
  if (observed !== content) {
    throw new Error(
      "T44_CONTENT_REVIEWER_ARTIFACT_BYTE_DRIFT",
    );
  }
  return {
    path: filePath,
    bytes: Buffer.byteLength(observed, "utf8"),
    sha256: sha256Utf8(observed),
  };
}

export async function runT44ContentReviewerCli(
  argv: readonly string[],
  workspaceRoot = process.cwd(),
) {
  const parsed =
    parseT44ContentReviewerRunArguments(argv);
  const loaded =
    await loadT44ContentReviewerSourceBundleV1({
      workspaceRoot,
      runId: parsed.runId,
      draftArtifactId: parsed.draftArtifactId,
    });
  if (loaded.draft.scope !== parsed.scope) {
    throw new Error(
      "T44_CONTENT_REVIEWER_DRAFT_SCOPE_DRIFT",
    );
  }
  const runtimeEnvironment =
    await loadRuntimeEnvironment({
      cwd: workspaceRoot,
      mode: "SERVICE_REQUIRED",
      nodeEnv: "test",
    });
  const config = readEnv(
    runtimeEnvironment.environment,
  );
  const plannerConfig =
    resolvePlannerModelConfiguration(config.ai);
  if (!plannerConfig.enabled) {
    throw new Error(
      "T44_CONTENT_REVIEWER_SERVICE_MODEL_REQUIRED",
    );
  }
  if (!isGpt56ModelId(plannerConfig.model)) {
    throw new Error(
      "T44_CONTENT_REVIEWER_GPT_5_6_REQUIRED",
    );
  }
  if (
    runtimeEnvironment.provenance.model.source
      !== "service-env"
  ) {
    throw new Error(
      "T44_CONTENT_REVIEWER_SERVICE_PROVENANCE_REQUIRED",
    );
  }
  const modelProvenance = {
    source: "service-env" as const,
    modelId: plannerConfig.model,
    endpointHash: sha256Utf8(
      new URL(plannerConfig.baseUrl).toString(),
    ),
  };
  process.stderr.write(
    `${JSON.stringify({
      event:
        "t44-content-reviewer-model-provenance",
      environmentMode: "SERVICE_REQUIRED",
      ...modelProvenance,
      providerSelection:
        plannerConfig.selection,
      configHash:
        T44_CONTENT_REVIEWER_CONFIG_HASH_V1,
      draftArtifactId:
        loaded.draft.artifactId,
      draftSelectionSha256:
        loaded.draftSeal.sha256,
    })}\n`,
  );
  const model = guardModelProviderSecretOutputs(
    createOpenAICompatibleModelProvider({
      baseUrl: plannerConfig.baseUrl,
      apiKey: plannerConfig.apiKey,
      model: plannerConfig.model,
      maxOutputTokens:
        plannerConfig.maxOutputTokens,
      idleTimeoutMs:
        T44_CONTENT_REVIEWER_CONFIG_V1
          .modelCall.idleTimeoutMs,
      totalTimeoutMs:
        T44_CONTENT_REVIEWER_CONFIG_V1
          .modelCall.totalTimeoutMs,
      vision: false,
    }),
    plannerConfig.apiKey,
  );
  const reviewCases =
    await runT44ContentRerankerModelBatchV1({
      prompts: loaded.prompts,
      model,
    });
  const draftById = mapUnique(
    loaded.draft.cases,
    "DRAFT_USAGE",
  );
  const promptById = mapUnique(
    loaded.prompts,
    "PROMPT_USAGE",
  );
  const cases = reviewCases.map((reviewCase) => {
    const draftCase =
      draftById.get(reviewCase.caseId);
    if (!draftCase) {
      throw new Error(
        `T44_CONTENT_REVIEWER_DRAFT_USAGE_MISSING:${reviewCase.caseId}`,
      );
    }
    const prompt =
      promptById.get(reviewCase.caseId);
    if (!prompt) {
      throw new Error(
        `T44_CONTENT_REVIEWER_PROMPT_USAGE_MISSING:${reviewCase.caseId}`,
      );
    }
    const combined =
      T44ContentRerankerSelectionCaseV1Schema
        .parse({
          ...reviewCase,
          audit: {
            ...reviewCase.audit,
            elapsedMs:
              draftCase.audit.elapsedMs
              + reviewCase.audit.elapsedMs,
            usage: {
              inputTokens:
                draftCase.audit.usage.inputTokens
                + reviewCase.audit.usage.inputTokens,
              outputTokens:
                draftCase.audit.usage.outputTokens
                + reviewCase.audit.usage.outputTokens,
              totalTokens:
                draftCase.audit.usage.totalTokens
                + reviewCase.audit.usage.totalTokens,
            },
          },
        });
    const completed =
      applyT44ContentReviewerCompletionV1({
        prompt,
        reviewCase: combined,
      });
    process.stderr.write(
      `${JSON.stringify({
        event:
          "t44-content-reviewer-progress",
        caseId: completed.testCase.caseId,
        status: completed.testCase.status,
        endToEndElapsedMs:
          completed.testCase.audit.elapsedMs,
        completionAdded:
          completed.completion.added,
        completionDropped:
          completed.completion.dropped,
      })}\n`,
    );
    return completed.testCase;
  });
  const valid = cases.filter(
    (testCase) => testCase.status === "VALID",
  ).length;
  const artifact =
    T44ContentReviewerSelectionArtifactV1Schema
      .parse({
        schemaVersion: 1,
        kind:
          "T44_CONTENT_REVIEWER_SELECTIONS",
        artifactId: parsed.artifactId,
        scope: parsed.scope,
        runtimeSuite:
          loaded.source.runtimeSuite,
        inputs: loaded.inputSeals,
        draft: {
          artifactId:
            loaded.draft.artifactId,
          configHash:
            loaded.draft.configHash,
        },
        config:
          T44_CONTENT_REVIEWER_CONFIG_V1,
        configHash:
          T44_CONTENT_REVIEWER_CONFIG_HASH_V1,
        model: modelProvenance,
        graphifyInvocationCount: 0,
        cases,
        summary: {
          total: cases.length,
          valid,
          invalid: cases.length - valid,
        },
        generatedAt: new Date().toISOString(),
        operations: {
          graphify: "NOT_USED",
          database: "NOT_USED",
          web: "NOT_USED",
          deployment: "NOT_PERFORMED",
        },
      });
  const seal =
    sealT44ContentReviewerSelectionArtifactV1(
      artifact,
    );
  const outputPath = path.resolve(
    workspaceRoot,
    ARTIFACT_ROOT,
    `t44-obligation-${parsed.runId}.content-reviewer-${parsed.artifactId}.selection.json`,
  );
  const output = await writeNewArtifact(
    outputPath,
    seal.serialized,
  );
  if (
    output.sha256 !== seal.sha256
    || output.bytes !== seal.bytes
  ) {
    throw new Error(
      "T44_CONTENT_REVIEWER_WRITTEN_SEAL_DRIFT",
    );
  }
  return { artifact, output };
}

async function main() {
  const result = await runT44ContentReviewerCli(
    process.argv.slice(2),
  );
  process.stdout.write(
    `${JSON.stringify({
      selectionPath: result.output.path,
      selectionBytes: result.output.bytes,
      selectionSha256: result.output.sha256,
      scope: result.artifact.scope,
      artifactId: result.artifact.artifactId,
      draft: result.artifact.draft,
      model: result.artifact.model,
      configHash: result.artifact.configHash,
      summary: result.artifact.summary,
      operations: result.artifact.operations,
    }, null, 2)}\n`,
  );
}

const entryPoint = process.argv[1];
if (
  entryPoint
  && import.meta.url
    === pathToFileURL(path.resolve(entryPoint)).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error
        ? error.stack ?? error.message
        : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
