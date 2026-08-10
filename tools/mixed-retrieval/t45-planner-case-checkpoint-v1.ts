import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  AnswerObligationSetV1Schema,
  QueryUnderstandingInputV1Schema,
  type QueryUnderstandingInputV1,
} from "../../lib/knowledge/answer-obligation-v1";
import {
  QueryUnderstandingPlannerAuditV1Schema,
  QueryUnderstandingPublicTraceV1Schema,
  type QueryUnderstandingPlannerResultV1,
} from "../../lib/knowledge/query-understanding-planner-v1";
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
const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

export const T45PlannerCheckpointModelBindingV1Schema =
z.object({
  modelId: z.string().trim().min(1).max(200),
  endpointHash: HashSchema,
  credentialSlotHash: HashSchema,
  configurationSource: z.literal("service-env"),
  providerSelection: z.string().trim().min(1).max(100),
  plannerVersion: VersionSchema,
  promptHash: HashSchema,
  configHash: HashSchema,
}).strict();

const PlannerResultSchema = z.object({
  obligationSet: AnswerObligationSetV1Schema,
  audit: QueryUnderstandingPlannerAuditV1Schema,
  publicTrace: QueryUnderstandingPublicTraceV1Schema,
}).strict();

export const T45PlannerCaseCheckpointV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("T45_PLANNER_CASE_CHECKPOINT"),
  runId: IdSchema,
  runtimeSuiteHash: HashSchema,
  caseId: IdSchema,
  requestHash: HashSchema,
  model: T45PlannerCheckpointModelBindingV1Schema,
  result: PlannerResultSchema,
  checkpointHash: HashSchema,
}).strict();

export type T45PlannerCheckpointModelBindingV1 = z.infer<
  typeof T45PlannerCheckpointModelBindingV1Schema
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
  return path.join(path.resolve(root), `${IdSchema.parse(caseId)}.json`);
}

async function readCheckpoint(input: {
  target: string;
  runId: string;
  runtimeSuiteHash: string;
  caseId: string;
  requestHash: string;
  model: T45PlannerCheckpointModelBindingV1;
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
  const parsed = T45PlannerCaseCheckpointV1Schema.parse(
    JSON.parse(raw) as unknown,
  );
  if (
    checkpointHash(parsed) !== parsed.checkpointHash
    || parsed.runId !== input.runId
    || parsed.runtimeSuiteHash !== input.runtimeSuiteHash
    || parsed.caseId !== input.caseId
    || parsed.requestHash !== input.requestHash
    || sha256StableJsonV2(parsed.model)
      !== sha256StableJsonV2(input.model)
  ) {
    throw new Error(
      `T45_PLANNER_CASE_CHECKPOINT_BINDING_DRIFT:${input.caseId}`,
    );
  }
  if (
    parsed.result.obligationSet.status === "DEGRADED"
    || parsed.result.audit.failureCategory !== null
  ) {
    throw new Error(
      `T45_PLANNER_CASE_CHECKPOINT_DEGRADED_RESULT:${input.caseId}`,
    );
  }
  return parsed.result;
}

export function createT45PlannerCaseCheckpointV1(input: {
  checkpointRoot: string;
  runId: string;
  runtimeSuiteHash: string;
  cases: readonly {
    caseId: string;
    currentMessageHash: string;
  }[];
  model: T45PlannerCheckpointModelBindingV1;
  planner: {
    plan(
      request: QueryUnderstandingInputV1,
      options?: {
        signal?: AbortSignal;
      },
    ): Promise<QueryUnderstandingPlannerResultV1>;
  };
  onEvent?: (event: {
    caseId: string;
    status: "HIT" | "PUBLISHED" | "NOT_PUBLISHED";
  }) => void;
}) {
  const runId = IdSchema.parse(input.runId);
  const runtimeSuiteHash = HashSchema.parse(
    input.runtimeSuiteHash,
  );
  const model =
    T45PlannerCheckpointModelBindingV1Schema.parse(input.model);
  const caseByMessageHash = new Map(
    input.cases.map((testCase) => [
      HashSchema.parse(testCase.currentMessageHash),
      IdSchema.parse(testCase.caseId),
    ]),
  );
  if (
    caseByMessageHash.size !== input.cases.length
    || caseByMessageHash.size < 1
  ) {
    throw new Error(
      "T45_PLANNER_CASE_CHECKPOINT_CASE_BINDING_INVALID",
    );
  }
  const notify = (
    caseId: string,
    status: "HIT" | "PUBLISHED" | "NOT_PUBLISHED",
  ) => {
    try {
      input.onEvent?.({ caseId, status });
    } catch {
      // Observability must not change evaluation behavior.
    }
  };

  return {
    async plan(
      rawRequest: QueryUnderstandingInputV1,
      options?: { signal?: AbortSignal },
    ) {
      const request = QueryUnderstandingInputV1Schema.parse(
        rawRequest,
      );
      const caseId = caseByMessageHash.get(
        request.currentMessage.messageHash,
      );
      if (!caseId) {
        throw new Error(
          "T45_PLANNER_CASE_CHECKPOINT_REQUEST_UNREGISTERED",
        );
      }
      const requestHash = sha256StableJsonV2(request);
      const target = checkpointPath(
        input.checkpointRoot,
        caseId,
      );
      const expected = {
        target,
        runId,
        runtimeSuiteHash,
        caseId,
        requestHash,
        model,
      };
      const existing = await readCheckpoint(expected);
      if (existing) {
        notify(caseId, "HIT");
        return existing;
      }

      const reservation =
        await acquireT45StageReservationV1({
          target: `${target}.reservation.json`,
          stage: `PLANNER_CASE:${caseId}`,
          runId,
          artifactId: caseId,
        });
      try {
        const raced = await readCheckpoint(expected);
        if (raced) {
          notify(caseId, "HIT");
          return raced;
        }
        const result = await input.planner.plan(
          request,
          options,
        );
        if (
          result.obligationSet.status === "DEGRADED"
          || result.audit.failureCategory !== null
        ) {
          notify(caseId, "NOT_PUBLISHED");
          return result;
        }
        const unsigned = {
          schemaVersion: 1 as const,
          kind: "T45_PLANNER_CASE_CHECKPOINT" as const,
          runId,
          runtimeSuiteHash,
          caseId,
          requestHash,
          model,
          result: PlannerResultSchema.parse(result),
        };
        const checkpoint =
          T45PlannerCaseCheckpointV1Schema.parse({
            ...unsigned,
            checkpointHash: checkpointHash(unsigned),
          });
        await publishT45SealedCheckpointV1({
          target,
          bytes: `${JSON.stringify(checkpoint, null, 2)}\n`,
          errorPrefix:
            `T45_PLANNER_CASE_CHECKPOINT:${caseId}`,
        });
        notify(caseId, "PUBLISHED");
        return checkpoint.result;
      } finally {
        await reservation.release();
      }
    },
  };
}
