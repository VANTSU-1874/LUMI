import { z } from "zod";

import {
  ReleaseRuntimeBindingSchema,
  ReleaseSourceBindingSchema,
  type ReleaseRuntimeBinding,
  type ReleaseSourceBinding,
} from "./release-source-binding";
import {
  RagAgentHarnessModeSchema,
} from "./rag-harness-cli";

export const CURRENT_RAG_AGENT_HARNESS_VERSION =
  "2026-07-30.1" as const;

export const REQUIRED_RAG_AGENT_HARNESS_CASES =
  Object.freeze([
    "rag-standalone-text-evidence",
    "rag-context-reference-resolution",
    "rag-multi-obligation-coverage",
    "rag-visual-region-evidence",
    "rag-cross-modal-evidence",
    "rag-no-answer-no-fabrication",
    "rag-memory-conflict-course-wins",
    "rag-disputed-memory-excluded",
    "rag-cross-student-project-isolated",
    "rag-cross-pack-isolated",
    "rag-provider-failure-honest-degrade",
    "rag-v2-off-legacy-compatible",
  ] as const);

const IdSchema = z.string().trim().min(1).max(160);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);

const ProviderIdentitySchema = z.object({
  providerId: z.string().trim().min(1).max(100),
  modelId: z.string().trim().min(1).max(200),
  revision: z.string().trim().min(1).max(200),
}).strict();

export const RagAgentHarnessIdentitySchema = z.object({
  suiteHash: HashSchema,
  corpusBundleHash: HashSchema,
  activeIndexBundleHash: HashSchema,
  textProvider: ProviderIdentitySchema,
  visualProvider: ProviderIdentitySchema,
  answerModelId:
    z.string().trim().min(1).max(200),
  plannerModelId:
    z.string().trim().min(1).max(200),
  knowledgeObjectV2Enabled: z.boolean(),
}).strict();

const RequiredGroupResultSchema = z.object({
  groupId: IdSchema,
  expectedSourceIds:
    z.array(IdSchema).min(1).max(8),
  injected: z.boolean(),
  used: z.boolean(),
}).strict();

const RegionTraceSchema = z.object({
  regionId: IdSchema,
  assetId: IdSchema,
  nodeId: IdSchema.nullable(),
}).strict();

export const RagAgentHarnessCaseResultSchema =
  z.object({
    caseId: z.enum(
      REQUIRED_RAG_AGENT_HARNESS_CASES,
    ),
    passed: z.boolean(),
    durationMs:
      z.number().int().nonnegative().max(180_000),
    coursePackId: z.string()
      .regex(/^[a-z][a-z0-9-]{0,63}$/),
    modality: z.enum([
      "TEXT",
      "VISUAL",
      "MULTIMODAL",
      "NONE",
    ]),
    queryType: z.enum([
      "STANDALONE",
      "CONTEXTUAL",
      "NO_ANSWER",
      "FAILURE",
      "LEGACY",
    ]),
    caseFamily: z.enum([
      "EVIDENCE_CHAIN",
      "CONTEXT",
      "MEMORY",
      "ISOLATION",
      "DEGRADATION",
      "COMPATIBILITY",
    ]),
    rawQuestion:
      z.string().trim().min(1).max(1_000),
    selfContainedQuestion:
      z.string().trim().min(1).max(1_500),
    ambiguityStatus: z.enum([
      "NONE",
      "RESOLVED",
      "CLARIFY",
    ]),
    sourceTurnIds: z.array(IdSchema).max(8),
    planner: z.object({
      callCount: z.number().int().min(0).max(2),
      modelId:
        z.string().trim().min(1).max(200),
      latencyMs:
        z.number().int().nonnegative().max(180_000),
    }).strict(),
    answer: z.object({
      callCount: z.number().int().min(0).max(8),
      modelId:
        z.string().trim().min(1).max(200),
      latencyMs:
        z.number().int().nonnegative().max(180_000),
    }).strict(),
    degradationReason:
      z.string().trim().min(1).max(200).nullable(),
    returnedSourceIds:
      z.array(IdSchema).max(16),
    injectedSourceIds:
      z.array(IdSchema).max(16),
    usedSourceIds:
      z.array(IdSchema).max(16),
    persistedSourceIds:
      z.array(IdSchema).max(16),
    assetIds: z.array(IdSchema).max(8),
    regions: z.array(RegionTraceSchema).max(8),
    parentNodeIds: z.array(IdSchema).max(8),
    toolCallIds: z.array(IdSchema).max(8),
    persistenceTraceIds:
      z.array(IdSchema).max(8),
    requiredGroupResults:
      z.array(RequiredGroupResultSchema).max(8),
    failures:
      z.array(z.string().trim().min(1).max(240))
        .max(24),
    observed: z.record(z.string(), z.json()),
  }).strict().superRefine((value, context) => {
    for (
      const [field, values] of [
        ["returnedSourceIds", value.returnedSourceIds],
        ["injectedSourceIds", value.injectedSourceIds],
        ["usedSourceIds", value.usedSourceIds],
        ["persistedSourceIds", value.persistedSourceIds],
      ] as const
    ) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "source ids must be unique",
        });
      }
    }
    const returned =
      new Set(value.returnedSourceIds);
    const injected =
      new Set(value.injectedSourceIds);
    const used = new Set(value.usedSourceIds);
    if (
      value.injectedSourceIds.some(
        (id) => !returned.has(id),
      )
      || value.usedSourceIds.some(
        (id) => !injected.has(id),
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "used must be a subset of injected and injected a subset of returned",
      });
    }
    if (
      value.persistedSourceIds.length
        !== value.usedSourceIds.length
      || value.persistedSourceIds.some(
        (id, index) =>
          value.usedSourceIds[index] !== id,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["persistedSourceIds"],
        message:
          "persisted evidence must equal actual used evidence",
      });
    }
    const failuresMatch =
      value.passed === (value.failures.length === 0);
    if (!failuresMatch) {
      context.addIssue({
        code: "custom",
        message:
          "case pass state must match failures",
      });
    }
  });

export type RagAgentHarnessCaseResult = z.infer<
  typeof RagAgentHarnessCaseResultSchema
>;

const CountBreakdownSchema = z.record(
  z.string(),
  z.number().int().nonnegative(),
);

export const RagAgentHarnessReportSchema =
  z.object({
    schemaVersion: z.literal(1),
    ...ReleaseSourceBindingSchema.shape,
    runtime: ReleaseRuntimeBindingSchema,
    harnessVersion: z.literal(
      CURRENT_RAG_AGENT_HARNESS_VERSION,
    ),
    mode: RagAgentHarnessModeSchema,
    evaluatedAt: z.string().datetime(),
    identity: RagAgentHarnessIdentitySchema,
    caseCount: z.literal(
      REQUIRED_RAG_AGENT_HARNESS_CASES.length,
    ),
    passedCaseCount:
      z.number().int().min(0).max(
        REQUIRED_RAG_AGENT_HARNESS_CASES.length,
      ),
    hardFailureCount:
      z.number().int().nonnegative(),
    counts: z.object({
      byCoursePack: CountBreakdownSchema,
      byModality: CountBreakdownSchema,
      byQueryType: CountBreakdownSchema,
      byCaseFamily: CountBreakdownSchema,
    }).strict(),
    passed: z.boolean(),
    results:
      z.array(RagAgentHarnessCaseResultSchema)
        .length(
          REQUIRED_RAG_AGENT_HARNESS_CASES.length,
        ),
  }).strict().superRefine((value, context) => {
    const ids = value.results.map(
      ({ caseId }) => caseId,
    );
    if (
      new Set(ids).size
        !== REQUIRED_RAG_AGENT_HARNESS_CASES.length
      || REQUIRED_RAG_AGENT_HARNESS_CASES.some(
        (id) => !ids.includes(id),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["results"],
        message:
          "RAG harness cases are incomplete or duplicated",
      });
    }
    const passedCaseCount = value.results.filter(
      ({ passed }) => passed,
    ).length;
    const hardFailureCount = value.results.reduce(
      (sum, result) =>
        sum + result.failures.length,
      0,
    );
    if (
      value.passedCaseCount !== passedCaseCount
      || value.hardFailureCount !== hardFailureCount
      || value.passed
        !== (
          passedCaseCount === value.caseCount
          && hardFailureCount === 0
        )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "RAG harness summary does not match case results",
      });
    }
  });

function countBy(
  results: readonly RagAgentHarnessCaseResult[],
  select: (
    result: RagAgentHarnessCaseResult,
  ) => string,
) {
  const counts: Record<string, number> = {};
  for (const result of results) {
    const key = select(result);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function buildRagAgentHarnessReport(input: {
  results: RagAgentHarnessCaseResult[];
  source: ReleaseSourceBinding;
  runtime: ReleaseRuntimeBinding;
  mode: z.infer<typeof RagAgentHarnessModeSchema>;
  identity: z.infer<
    typeof RagAgentHarnessIdentitySchema
  >;
  evaluatedAt?: Date;
}) {
  const results = input.results.map((result) =>
    RagAgentHarnessCaseResultSchema.parse(result));
  const passedCaseCount = results.filter(
    ({ passed }) => passed,
  ).length;
  const hardFailureCount = results.reduce(
    (sum, result) => sum + result.failures.length,
    0,
  );
  return RagAgentHarnessReportSchema.parse({
    schemaVersion: 1,
    ...ReleaseSourceBindingSchema.parse(input.source),
    runtime: ReleaseRuntimeBindingSchema.parse(
      input.runtime,
    ),
    harnessVersion:
      CURRENT_RAG_AGENT_HARNESS_VERSION,
    mode: input.mode,
    evaluatedAt:
      (input.evaluatedAt ?? new Date()).toISOString(),
    identity:
      RagAgentHarnessIdentitySchema.parse(
        input.identity,
      ),
    caseCount:
      REQUIRED_RAG_AGENT_HARNESS_CASES.length,
    passedCaseCount,
    hardFailureCount,
    counts: {
      byCoursePack: countBy(
        results,
        ({ coursePackId }) => coursePackId,
      ),
      byModality: countBy(
        results,
        ({ modality }) => modality,
      ),
      byQueryType: countBy(
        results,
        ({ queryType }) => queryType,
      ),
      byCaseFamily: countBy(
        results,
        ({ caseFamily }) => caseFamily,
      ),
    },
    passed:
      passedCaseCount === results.length
      && hardFailureCount === 0,
    results,
  });
}
