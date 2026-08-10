import { z } from "zod";

import {
  mapProjectContextIntentForHarnessV1,
  ProjectContextHarnessScopeV1Schema,
  type ProjectContextHarnessIntentV1,
} from "./project-context-intent-boundary";

const StableIdSchema = z.string().trim().min(1).max(128);
const ResolutionHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const MemoryIntentResolutionSchema = z.object({
  hash: ResolutionHashSchema,
  studentId: StableIdSchema,
  classId: StableIdSchema,
  taskId: StableIdSchema,
  projectId: StableIdSchema.nullable(),
  coursePackId: StableIdSchema,
  coursePackVersion: StableIdSchema,
  trigger: z.enum([
    "TASK_RESUMED",
    "TASK_CHANGED",
    "EXPLICIT_MEMORY_INTENT",
    "APPLIES_TO_MATCH",
  ]),
  appliesTo: z.array(StableIdSchema).min(1).max(8),
}).strict();

const MemoryHarnessAggregateSchema = z.object({
  resolutionHash: ResolutionHashSchema,
  snapshotCardCount: z.number().int().min(0).max(4),
  checkpointOutcome: z.enum(["NOT_REQUESTED", "SUCCEEDED", "FAILED"]),
  latencyMs: z.number().int().min(0).max(300),
}).strict();

export const MEMORY_HARNESS_ADAPTER_VERSION = "memory-harness-observation/v1";

export const MemoryHarnessObservationSchema = MemoryHarnessAggregateSchema.extend({
  kind: z.literal("MEMORY_OBSERVATION"),
}).strict();

export type MemoryHarnessObservation = z.infer<
  typeof MemoryHarnessObservationSchema
>;

const ContextMemoryEvidenceScopeSchema = z.object({
  studentId: StableIdSchema,
  classId: StableIdSchema,
  taskId: StableIdSchema,
  projectId: StableIdSchema.nullable(),
  coursePackId: StableIdSchema,
  coursePackVersion: StableIdSchema,
}).strict();

export type ContextMemoryEvidenceScope = z.infer<
  typeof ContextMemoryEvidenceScopeSchema
>;

export type ContextMemoryEvidenceStep =
  | "CONTEXT_BOUNDARY"
  | "MEMORY_READ"
  | "COURSE_EVIDENCE";

export type ProjectContextHarnessAdapterPortV1 = {
  version: "project-context-intent-adapter/v1";
  resolve(input: {
    expectedScope: z.infer<typeof ProjectContextHarnessScopeV1Schema>;
    originalQuestion: string;
  }): Promise<unknown>;
};

/** This validates a separately owned adapter without importing its runtime types. */
export type MemoryHarnessAdapterPortV1 = {
  version: typeof MEMORY_HARNESS_ADAPTER_VERSION;
  afterResolvedIntent(raw: unknown): Promise<unknown>;
};

/** Memory owns trigger selection; the Harness verifies scope and resolution identity. */
export type MemoryIntentResolutionPortV1 = {
  version: "memory-intent-resolution/v1";
  resolve(input: {
    contextIntent: ProjectContextHarnessIntentV1;
    scope: ContextMemoryEvidenceScope;
  }): Promise<unknown>;
};

export type ContextMemoryEvidenceChainPorts = {
  projectContext?: ProjectContextHarnessAdapterPortV1;
  memoryAdapter?: MemoryHarnessAdapterPortV1;
  memoryIntentResolution?: MemoryIntentResolutionPortV1;
  onStep?(step: ContextMemoryEvidenceStep): void;
  onMemoryObservation?(observation: MemoryHarnessObservation): void;
};

export type ContextMemoryEvidencePreparation = {
  contextStatus: "SKIPPED" | "SUCCEEDED" | "REJECTED";
  memoryStatus: "SKIPPED" | "SUCCEEDED" | "EMPTY";
};

function sameMemoryScope(
  resolution: z.infer<typeof MemoryIntentResolutionSchema>,
  scope: ContextMemoryEvidenceScope,
  contextIntent: ProjectContextHarnessIntentV1,
) {
  return resolution.hash === contextIntent.resolutionReceipt.resolutionHash
    && resolution.studentId === scope.studentId
    && resolution.classId === scope.classId
    && resolution.taskId === scope.taskId
    && resolution.projectId === scope.projectId
    && resolution.coursePackId === scope.coursePackId
    && resolution.coursePackVersion === scope.coursePackVersion;
}

/**
 * Context receipt validation then optional same-scope Memory observation then
 * CourseEvidence start marker. This never rewrites the original question,
 * persists an observation, or affects the legacy course retrieval result.
 */
export class ContextMemoryEvidenceChain {
  private readonly observations: MemoryHarnessObservation[] = [];

  constructor(
    private readonly mode: "OFF" | "SHADOW" | "ON",
    private readonly ports: ContextMemoryEvidenceChainPorts = {},
  ) {}

  async prepare(input: {
    scope: ContextMemoryEvidenceScope;
    originalQuestion: string;
  }): Promise<ContextMemoryEvidencePreparation> {
    if (this.mode === "OFF" || !this.ports.projectContext) {
      return { contextStatus: "SKIPPED", memoryStatus: "SKIPPED" };
    }

    const scope = ContextMemoryEvidenceScopeSchema.parse(input.scope);
    const expectedScope = ProjectContextHarnessScopeV1Schema.parse({
      studentId: scope.studentId,
      projectId: scope.projectId,
      taskId: scope.taskId,
    });
    let contextIntent: ProjectContextHarnessIntentV1;
    try {
      this.ports.onStep?.("CONTEXT_BOUNDARY");
      const adapterResult = await this.ports.projectContext.resolve({
        expectedScope,
        originalQuestion: input.originalQuestion,
      });
      contextIntent = mapProjectContextIntentForHarnessV1({
        expectedScope,
        adapterResult,
      });
      if (contextIntent.originalQuestion !== input.originalQuestion) {
        return { contextStatus: "REJECTED", memoryStatus: "SKIPPED" };
      }
    } catch {
      return { contextStatus: "REJECTED", memoryStatus: "SKIPPED" };
    }

    if (
      this.mode !== "ON"
      || !this.ports.memoryAdapter
      || !this.ports.memoryIntentResolution
      || this.ports.memoryAdapter.version !== MEMORY_HARNESS_ADAPTER_VERSION
      || this.ports.memoryIntentResolution.version !== "memory-intent-resolution/v1"
    ) {
      return { contextStatus: "SUCCEEDED", memoryStatus: "SKIPPED" };
    }

    try {
      const rawResolution = await this.ports.memoryIntentResolution.resolve({
        contextIntent,
        scope,
      });
      const resolution = MemoryIntentResolutionSchema.parse(rawResolution);
      if (!sameMemoryScope(resolution, scope, contextIntent)) {
        return { contextStatus: "SUCCEEDED", memoryStatus: "EMPTY" };
      }
      this.ports.onStep?.("MEMORY_READ");
      const aggregate = await this.ports.memoryAdapter.afterResolvedIntent(
        Object.freeze({ ...resolution }),
      );
      if (aggregate === null) {
        return { contextStatus: "SUCCEEDED", memoryStatus: "EMPTY" };
      }
      const parsedAggregate = MemoryHarnessAggregateSchema.parse(aggregate);
      if (parsedAggregate.resolutionHash !== contextIntent.resolutionReceipt.resolutionHash) {
        return { contextStatus: "SUCCEEDED", memoryStatus: "EMPTY" };
      }
      const observation = MemoryHarnessObservationSchema.parse({
        kind: "MEMORY_OBSERVATION",
        ...parsedAggregate,
      });
      this.observations.push(observation);
      this.ports.onMemoryObservation?.({ ...observation });
      return { contextStatus: "SUCCEEDED", memoryStatus: "SUCCEEDED" };
    } catch {
      return { contextStatus: "SUCCEEDED", memoryStatus: "EMPTY" };
    }
  }

  markCourseEvidenceStart() {
    if (this.mode !== "OFF") this.ports.onStep?.("COURSE_EVIDENCE");
  }

  snapshotMemoryObservations() {
    return this.observations.map((observation) => ({ ...observation }));
  }
}

export function createContextMemoryEvidenceChain(input: {
  mode: "OFF" | "SHADOW" | "ON";
  ports?: ContextMemoryEvidenceChainPorts;
}) {
  return new ContextMemoryEvidenceChain(input.mode, input.ports);
}
