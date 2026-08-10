import { z } from "zod";

const StableIdSchema = z.string().trim().min(1).max(128);
const ExactQuestionSchema = z.string().min(1).max(1_000)
  .refine((value) => value.trim().length > 0, "question must contain visible text");
const ResolutionHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

function compareCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

const SourceTurnIdsSchema = z.array(StableIdSchema).max(32)
  .superRefine((value, context) => {
    const canonical = [...new Set(value)].sort(compareCodePoints);
    if (
      canonical.length !== value.length
      || canonical.some((sourceTurnId, index) => sourceTurnId !== value[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "PROJECT_CONTEXT_SOURCE_TURNS_NOT_CANONICAL",
      });
    }
  });

export const ProjectContextHarnessScopeV1Schema = z.object({
  studentId: StableIdSchema,
  projectId: StableIdSchema.nullable(),
  taskId: StableIdSchema,
}).strict();

export type ProjectContextHarnessScopeV1 = z.infer<
  typeof ProjectContextHarnessScopeV1Schema
>;

const ProjectContextAdapterReceiptSchema = z.object({
  contractVersion: z.literal("project-context-intent-adapter/v1"),
  contextResolutionInput: z.object({
    studentId: StableIdSchema,
    projectId: StableIdSchema.nullable(),
    taskId: StableIdSchema,
    currentTurn: z.object({ text: ExactQuestionSchema }).passthrough(),
    sourceTurnIds: SourceTurnIdsSchema,
  }).passthrough(),
  resolvedUserIntent: z.object({
    originalQuestion: ExactQuestionSchema,
    standaloneQuestion: z.string().min(1).max(1_500)
      .refine((value) => value.trim().length > 0)
      .nullable(),
    ambiguityStatus: z.enum(["SELF_CONTAINED", "RESOLVED", "AMBIGUOUS"]),
    clarificationCandidate: z.string().trim().min(1).max(500).nullable(),
    initialRetrieval: z.object({
      mustRun: z.literal(true),
      baselineQuestion: ExactQuestionSchema,
      supplementalQuestion: z.string().min(1).max(1_500)
        .refine((value) => value.trim().length > 0)
        .nullable(),
    }).strict(),
    coursePackCandidates: z.array(z.unknown()).length(0),
    knowledgeQuery: z.null(),
    memoryQuery: z.null(),
    contextManifest: z.object({ resolutionHash: ResolutionHashSchema }).passthrough(),
    sourceTurnIds: SourceTurnIdsSchema,
    resolutionHash: ResolutionHashSchema,
  }).passthrough(),
  contextManifest: z.object({ resolutionHash: ResolutionHashSchema }).passthrough(),
  executionTrace: z.object({
    resolutionHash: ResolutionHashSchema,
    projectContextRemoteCallCount: z.literal(0),
    plannerCallCount: z.literal(0),
    plannerModel: z.null(),
    answerCallCount: z.literal(0),
    answerModel: z.null(),
    degraded: z.literal(false),
    degradationReason: z.null(),
  }).passthrough(),
}).passthrough();

export const ProjectContextHarnessIntentV1Schema = z.object({
  schemaVersion: z.literal(1),
  contractVersion: z.literal("project-context-harness-intent/v1"),
  originalQuestion: ExactQuestionSchema,
  initialRetrieval: z.object({
    mustRun: z.literal(true),
    baselineQuestion: ExactQuestionSchema,
    supplementalQuestion: z.string().min(1).max(1_500)
      .refine((value) => value.trim().length > 0)
      .nullable(),
  }).strict(),
  ambiguity: z.object({
    status: z.enum(["SELF_CONTAINED", "RESOLVED", "AMBIGUOUS"]),
    clarificationCandidate: z.string().trim().min(1).max(500).nullable(),
  }).strict(),
  sourceScope: ProjectContextHarnessScopeV1Schema.extend({
    sourceTurnIds: SourceTurnIdsSchema,
  }).strict(),
  resolutionReceipt: z.object({
    resolutionHash: ResolutionHashSchema,
    projectContextRemoteCallCount: z.literal(0),
  }).strict(),
}).strict().superRefine((value, context) => {
  if (value.originalQuestion !== value.initialRetrieval.baselineQuestion) {
    context.addIssue({
      code: "custom",
      path: ["initialRetrieval", "baselineQuestion"],
      message: "PROJECT_CONTEXT_BASELINE_MISMATCH",
    });
  }
  if (
    (value.ambiguity.status === "AMBIGUOUS")
    !== (value.ambiguity.clarificationCandidate !== null)
  ) {
    context.addIssue({
      code: "custom",
      path: ["ambiguity"],
      message: "PROJECT_CONTEXT_AMBIGUITY_MISMATCH",
    });
  }
  if (
    value.ambiguity.status === "RESOLVED"
    !== (value.initialRetrieval.supplementalQuestion !== null)
  ) {
    context.addIssue({
      code: "custom",
      path: ["initialRetrieval", "supplementalQuestion"],
      message: "PROJECT_CONTEXT_SUPPLEMENT_MISMATCH",
    });
  }
});

export type ProjectContextHarnessIntentV1 = z.infer<
  typeof ProjectContextHarnessIntentV1Schema
>;

export function mapProjectContextIntentForHarnessV1(input: {
  expectedScope: ProjectContextHarnessScopeV1;
  adapterResult: unknown;
}): ProjectContextHarnessIntentV1 {
  const expectedScope = ProjectContextHarnessScopeV1Schema.parse(input.expectedScope);
  const adapter = ProjectContextAdapterReceiptSchema.parse(input.adapterResult);
  const resolved = adapter.resolvedUserIntent;
  const actualScope = adapter.contextResolutionInput;

  if (
    actualScope.studentId !== expectedScope.studentId
    || actualScope.projectId !== expectedScope.projectId
    || actualScope.taskId !== expectedScope.taskId
  ) {
    throw new Error("PROJECT_CONTEXT_SCOPE_MISMATCH");
  }
  if (
    resolved.originalQuestion !== actualScope.currentTurn.text
    || resolved.originalQuestion !== resolved.initialRetrieval.baselineQuestion
  ) {
    throw new Error("PROJECT_CONTEXT_BASELINE_MISMATCH");
  }
  if (
    resolved.contextManifest.resolutionHash !== resolved.resolutionHash
    || adapter.contextManifest.resolutionHash !== resolved.resolutionHash
    || adapter.executionTrace.resolutionHash !== resolved.resolutionHash
  ) {
    throw new Error("PROJECT_CONTEXT_RESOLUTION_HASH_MISMATCH");
  }
  if (resolved.sourceTurnIds.some(
    (sourceTurnId) => !actualScope.sourceTurnIds.includes(sourceTurnId),
  )) {
    throw new Error("PROJECT_CONTEXT_SOURCE_SCOPE_MISMATCH");
  }

  return ProjectContextHarnessIntentV1Schema.parse({
    schemaVersion: 1,
    contractVersion: "project-context-harness-intent/v1",
    originalQuestion: resolved.originalQuestion,
    initialRetrieval: resolved.initialRetrieval,
    ambiguity: {
      status: resolved.ambiguityStatus,
      clarificationCandidate: resolved.clarificationCandidate,
    },
    sourceScope: { ...expectedScope, sourceTurnIds: resolved.sourceTurnIds },
    resolutionReceipt: {
      resolutionHash: resolved.resolutionHash,
      projectContextRemoteCallCount: adapter.executionTrace.projectContextRemoteCallCount,
    },
  });
}
