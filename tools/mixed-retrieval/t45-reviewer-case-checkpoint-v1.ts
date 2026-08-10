import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  T44ContentRerankerSelectionCaseV1Schema,
  type T44ContentRerankerPromptV1,
} from "./t44-content-reranker-v1";
import {
  sha256StableJsonV2,
} from "../../lib/knowledge/knowledge-object-v2";
import {
  acquireT45StageReservationV1,
  publishT45SealedCheckpointV1,
} from "./t45-sealed-checkpoint-v1";

type ErrorWithCode = Error & { code?: string };

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const IdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const ModelBindingSchema = z.object({
  source: z.literal("service-env"),
  modelId: z.string().trim().min(1).max(200),
  endpointHash: HashSchema,
  configHash: HashSchema,
}).strict();

const StageSchema = z.enum([
  "CONTENT_DRAFT",
  "MULTI_ANCHOR_REVIEWER",
]);

export const T45ReviewerCaseCheckpointV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("T45_REVIEWER_CASE_CHECKPOINT"),
  runId: IdSchema,
  attemptId: IdSchema,
  runtimeSuiteHash: HashSchema,
  stage: StageSchema,
  caseId: IdSchema,
  promptHash: HashSchema,
  candidateMapHash: HashSchema,
  model: ModelBindingSchema,
  result: T44ContentRerankerSelectionCaseV1Schema,
  checkpointHash: HashSchema,
}).strict();

type ReviewerModelBindingV1 = z.infer<
  typeof ModelBindingSchema
>;

function checkpointHash(
  value: Record<string, unknown>,
) {
  const projection = { ...value };
  delete projection.checkpointHash;
  return sha256StableJsonV2(projection);
}

function checkpointPath(
  root: string,
  caseId: string,
) {
  return path.join(
    path.resolve(root),
    `${IdSchema.parse(caseId)}.json`,
  );
}

function isInfrastructureFailure(
  value: z.infer<
    typeof T44ContentRerankerSelectionCaseV1Schema
  >,
) {
  return value.status === "INVALID"
    && value.failureCategory?.startsWith(
      "MODEL_SERVICE_",
    ) === true;
}

async function readCheckpoint(input: {
  target: string;
  runId: string;
  attemptId: string;
  runtimeSuiteHash: string;
  stage: z.infer<typeof StageSchema>;
  prompt: T44ContentRerankerPromptV1;
  model: ReviewerModelBindingV1;
}) {
  let raw: string;
  try {
    raw = await readFile(input.target, "utf8");
  } catch (error) {
    if ((error as ErrorWithCode).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const parsed =
    T45ReviewerCaseCheckpointV1Schema.parse(
      JSON.parse(raw) as unknown,
    );
  if (
    checkpointHash(parsed) !== parsed.checkpointHash
    || parsed.runId !== input.runId
    || parsed.attemptId !== input.attemptId
    || parsed.runtimeSuiteHash !== input.runtimeSuiteHash
    || parsed.stage !== input.stage
    || parsed.caseId !== input.prompt.caseId
    || parsed.promptHash !== input.prompt.promptHash
    || parsed.candidateMapHash
      !== input.prompt.candidateMapHash
    || sha256StableJsonV2(parsed.model)
      !== sha256StableJsonV2(input.model)
  ) {
    throw new Error(
      `T45_REVIEWER_CASE_CHECKPOINT_BINDING_DRIFT:${input.prompt.caseId}`,
    );
  }
  if (isInfrastructureFailure(parsed.result)) {
    throw new Error(
      `T45_REVIEWER_CASE_CHECKPOINT_INFRASTRUCTURE_RESULT:${input.prompt.caseId}`,
    );
  }
  return parsed.result;
}

export async function runT45ReviewerCheckpointedBatchV1(
  input: {
    checkpointRoot: string;
    runId: string;
    attemptId: string;
    runtimeSuiteHash: string;
    stage: z.infer<typeof StageSchema>;
    prompts: readonly T44ContentRerankerPromptV1[];
    model: ReviewerModelBindingV1;
    runModelBatch(
      input: {
        prompts: readonly T44ContentRerankerPromptV1[];
      },
    ): Promise<z.infer<
      typeof T44ContentRerankerSelectionCaseV1Schema
    >[]>;
    onEvent?: (event: {
      caseId: string;
      stage: z.infer<typeof StageSchema>;
      status: "HIT" | "PUBLISHED" | "NOT_PUBLISHED";
      failureCategory: string | null;
    }) => void;
  },
) {
  const runId = IdSchema.parse(input.runId);
  const attemptId = IdSchema.parse(input.attemptId);
  const runtimeSuiteHash = HashSchema.parse(
    input.runtimeSuiteHash,
  );
  const stage = StageSchema.parse(input.stage);
  const model = ModelBindingSchema.parse(input.model);
  const seen = new Set<string>();
  for (const prompt of input.prompts) {
    if (seen.has(prompt.caseId)) {
      throw new Error(
        `T45_REVIEWER_CASE_CHECKPOINT_CASE_DUPLICATE:${prompt.caseId}`,
      );
    }
    seen.add(prompt.caseId);
  }

  const notify = (
    caseId: string,
    status: "HIT" | "PUBLISHED" | "NOT_PUBLISHED",
    failureCategory: string | null,
  ) => {
    try {
      input.onEvent?.({
        caseId,
        stage,
        status,
        failureCategory,
      });
    } catch {
      // Observability must not change evaluation behavior.
    }
  };

  const results: z.infer<
    typeof T44ContentRerankerSelectionCaseV1Schema
  >[] = [];
  for (const prompt of input.prompts) {
    const target = checkpointPath(
      input.checkpointRoot,
      prompt.caseId,
    );
    const expected = {
      target,
      runId,
      attemptId,
      runtimeSuiteHash,
      stage,
      prompt,
      model,
    };
    const existing = await readCheckpoint(expected);
    if (existing) {
      notify(
        prompt.caseId,
        "HIT",
        existing.failureCategory,
      );
      results.push(existing);
      continue;
    }

    const reservation =
      await acquireT45StageReservationV1({
        target: `${target}.reservation.json`,
        stage: `${stage}:${prompt.caseId}`,
        runId,
        artifactId: prompt.caseId,
      });
    try {
      const raced = await readCheckpoint(expected);
      if (raced) {
        notify(
          prompt.caseId,
          "HIT",
          raced.failureCategory,
        );
        results.push(raced);
        continue;
      }
      const observed = await input.runModelBatch({
        prompts: [prompt],
      });
      if (observed.length !== 1) {
        throw new Error(
          `T45_REVIEWER_CASE_CHECKPOINT_RESULT_COUNT_INVALID:${prompt.caseId}`,
        );
      }
      const result =
        T44ContentRerankerSelectionCaseV1Schema.parse(
          observed[0],
        );
      if (
        result.caseId !== prompt.caseId
        || result.promptHash !== prompt.promptHash
        || result.candidateMapHash
          !== prompt.candidateMapHash
      ) {
        throw new Error(
          `T45_REVIEWER_CASE_CHECKPOINT_RESULT_BINDING_DRIFT:${prompt.caseId}`,
        );
      }
      if (isInfrastructureFailure(result)) {
        notify(
          prompt.caseId,
          "NOT_PUBLISHED",
          result.failureCategory,
        );
        throw new Error(
          `T45_REVIEWER_INFRASTRUCTURE_NOT_READY:${stage}:${prompt.caseId}:${result.failureCategory}`,
        );
      }
      const unsigned = {
        schemaVersion: 1 as const,
        kind:
          "T45_REVIEWER_CASE_CHECKPOINT" as const,
        runId,
        attemptId,
        runtimeSuiteHash,
        stage,
        caseId: prompt.caseId,
        promptHash: prompt.promptHash,
        candidateMapHash:
          prompt.candidateMapHash,
        model,
        result,
      };
      const checkpoint =
        T45ReviewerCaseCheckpointV1Schema.parse({
          ...unsigned,
          checkpointHash:
            checkpointHash(unsigned),
        });
      await publishT45SealedCheckpointV1({
        target,
        bytes:
          `${JSON.stringify(checkpoint, null, 2)}\n`,
        errorPrefix:
          `T45_REVIEWER_CASE_CHECKPOINT:${stage}:${prompt.caseId}`,
      });
      notify(
        prompt.caseId,
        "PUBLISHED",
        result.failureCategory,
      );
      results.push(checkpoint.result);
    } finally {
      await reservation.release();
    }
  }
  return results;
}
