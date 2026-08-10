import { describe, expect, it } from "vitest";

import {
  createContextMemoryEvidenceChain,
  MEMORY_HARNESS_ADAPTER_VERSION,
  type ContextMemoryEvidenceScope,
} from "@/lib/agent/runtime/harness/context-memory-evidence-chain";

const scope: ContextMemoryEvidenceScope = {
  studentId: "student-a",
  classId: "class-a",
  taskId: "task-a",
  projectId: null,
  coursePackId: "general-design",
  coursePackVersion: "1",
};
const originalQuestion = "我想先聊聊这个设计想法";
const resolutionHash = "e".repeat(64);

function fakeReceipt() {
  return {
    contractVersion: "project-context-intent-adapter/v1" as const,
    contextResolutionInput: {
      studentId: scope.studentId,
      projectId: scope.projectId,
      taskId: scope.taskId,
      currentTurn: { text: originalQuestion },
      sourceTurnIds: [],
    },
    resolvedUserIntent: {
      originalQuestion,
      standaloneQuestion: originalQuestion,
      ambiguityStatus: "SELF_CONTAINED" as const,
      clarificationCandidate: null,
      initialRetrieval: {
        mustRun: true as const,
        baselineQuestion: originalQuestion,
        supplementalQuestion: null,
      },
      coursePackCandidates: [],
      knowledgeQuery: null,
      memoryQuery: null,
      contextManifest: { resolutionHash },
      sourceTurnIds: [],
      resolutionHash,
    },
    contextManifest: { resolutionHash },
    executionTrace: {
      resolutionHash,
      projectContextRemoteCallCount: 0 as const,
      plannerCallCount: 0 as const,
      plannerModel: null,
      answerCallCount: 0 as const,
      answerModel: null,
      degraded: false as const,
      degradationReason: null,
    },
  };
}

describe("Context -> Memory -> CourseEvidence boundary", () => {
  it.each([
    ["OFF", [], 0, 0],
    ["SHADOW", ["CONTEXT_BOUNDARY", "COURSE_EVIDENCE"], 1, 0],
    ["ON", ["CONTEXT_BOUNDARY", "MEMORY_READ", "COURSE_EVIDENCE"], 1, 1],
  ] as const)("keeps %s mode bounded and ordered", async (mode, expectedSteps, expectedContextCalls, expectedMemoryCalls) => {
    const steps: string[] = [];
    let contextCalls = 0;
    let memoryCalls = 0;
    const chain = createContextMemoryEvidenceChain({
      mode,
      ports: {
        projectContext: {
          version: "project-context-intent-adapter/v1",
          async resolve() {
            contextCalls += 1;
            return fakeReceipt();
          },
        },
        memoryIntentResolution: {
          version: "memory-intent-resolution/v1",
          async resolve({ contextIntent, scope: inputScope }) {
            return {
              hash: contextIntent.resolutionReceipt.resolutionHash,
              ...inputScope,
              trigger: "TASK_RESUMED",
              appliesTo: ["CURRENT_TASK"],
            };
          },
        },
        memoryAdapter: {
          version: MEMORY_HARNESS_ADAPTER_VERSION,
          async afterResolvedIntent(raw) {
            memoryCalls += 1;
            return {
              resolutionHash: (raw as { hash: string }).hash,
              snapshotCardCount: 1,
              checkpointOutcome: "NOT_REQUESTED",
              latencyMs: 1,
            };
          },
        },
        onStep: (step) => steps.push(step),
      },
    });

    const result = await chain.prepare({ scope, originalQuestion });
    chain.markCourseEvidenceStart();

    expect(steps).toEqual(expectedSteps);
    expect(contextCalls).toBe(expectedContextCalls);
    expect(memoryCalls).toBe(expectedMemoryCalls);
    expect(result).toEqual(mode === "OFF"
      ? { contextStatus: "SKIPPED", memoryStatus: "SKIPPED" }
      : mode === "SHADOW"
        ? { contextStatus: "SUCCEEDED", memoryStatus: "SKIPPED" }
        : { contextStatus: "SUCCEEDED", memoryStatus: "SUCCEEDED" });
    expect(chain.snapshotMemoryObservations()).toHaveLength(mode === "ON" ? 1 : 0);
  });

  it("rejects a mismatched Context receipt before Memory can run", async () => {
    let memoryCalls = 0;
    const chain = createContextMemoryEvidenceChain({
      mode: "ON",
      ports: {
        projectContext: {
          version: "project-context-intent-adapter/v1",
          async resolve() {
            return {
              ...fakeReceipt(),
              resolvedUserIntent: {
                ...fakeReceipt().resolvedUserIntent,
                originalQuestion: "不允许替换的问句",
              },
            };
          },
        },
        memoryAdapter: {
          version: MEMORY_HARNESS_ADAPTER_VERSION,
          async afterResolvedIntent() {
            memoryCalls += 1;
            return null;
          },
        },
      },
    });
    expect(await chain.prepare({ scope, originalQuestion }))
      .toEqual({ contextStatus: "REJECTED", memoryStatus: "SKIPPED" });
    expect(memoryCalls).toBe(0);
  });
});
