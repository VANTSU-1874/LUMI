import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import type {
  T44ContentRerankerPromptV1,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import type {
  T44ObligationCandidateArtifactV1,
} from "@/tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import type {
  T44ObligationSelectionArtifactV1,
} from "@/tools/mixed-retrieval/t44-obligation-label-blind-v2";
import {
  applyT45MultiAnchorCompletionV1,
  buildT45MultiAnchorPromptV1,
  resolveT45DefaultBaselineReservationV1,
  selectT45DiverseCompletionCandidatesV1,
} from "@/tools/mixed-retrieval/t45-multi-anchor-reviewer-v1";

type Usage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type DraftCase = {
  caseId: string;
  coursePackId: string;
  candidateMapHash: string;
  promptHash: string;
  status: "VALID" | "INVALID";
  failureCategory: string | null;
  selected: Array<Record<string, unknown> & {
    candidateIndex: number;
    nodeId: string;
    objectId: string;
    coursePackId: string;
    nodeContentHash: string;
  }>;
  audit: {
    elapsedMs: number;
    rawOutputHash: string | null;
    usage: Usage;
  };
};

type FinalCase = Omit<DraftCase, "selected"> & {
  selected: Array<Record<string, unknown> & {
    candidateIndex: number;
    nodeId: string;
    objectId: string;
    coursePackId: string;
    role: "FACT" | "ACTION" | "TABLE";
    text: string;
    nodeContentHash: string;
    baselineRank: number | null;
    wholeQueryRank: number | null;
    obligationRanks: Array<{
      obligationId: string;
      rank: number;
    }>;
    obligationIds: string[];
    evidenceRole:
      | "DIRECT"
      | "COMPLEMENT"
      | "CONTEXT";
    protectedBaseline: boolean;
    protectedBaselineOrder: number | null;
  }>;
  stageAudit: {
    draft: { elapsedMs: number; usage: Usage };
    reviewer: { elapsedMs: number; usage: Usage };
    endToEnd: { elapsedMs: number; usage: Usage };
  };
  completion: {
    modelSelectionLedger: Array<{
      nodeId: string;
      obligationIds: string[];
      evidenceRole:
        | "DIRECT"
        | "COMPLEMENT"
        | "CONTEXT";
    }>;
    obligationAnchors: Array<{
      obligationId: string;
      nodeId: string;
    }>;
    protectedKept: string[];
    modelSelectedBaselineKept: string[];
    baselineRejected: Array<{
      nodeId: string;
      reason:
        "EXPLICIT_STUDENT_PREMISE_OR_EXCLUSION";
    }>;
    modelAdded: string[];
    deterministicAdded: string[];
    unprotectedDropped: string[];
  };
  bindingViolations: string[];
};

type Artifact<T> = {
  cases: T[];
  summary: {
    total: number;
    valid: number;
    invalid: number;
  };
};

function same(left: unknown, right: unknown) {
  return sha256StableJsonV2(left)
    === sha256StableJsonV2(right);
}

function assertUnique(
  values: readonly string[],
  code: string,
) {
  if (new Set(values).size !== values.length) {
    throw new Error(code);
  }
}

function addUsage(left: Usage, right: Usage) {
  return {
    inputTokens:
      left.inputTokens + right.inputTokens,
    outputTokens:
      left.outputTokens + right.outputTokens,
    totalTokens:
      left.totalTokens + right.totalTokens,
  };
}

function expectedSummary(
  cases: readonly { status: "VALID" | "INVALID" }[],
) {
  const valid = cases.filter(
    ({ status }) => status === "VALID",
  ).length;
  return {
    total: cases.length,
    valid,
    invalid: cases.length - valid,
  };
}

function candidateProjection(
  candidate: {
    candidateIndex: number;
    nodeId: string;
    objectId: string;
    coursePackId: string;
    role: "FACT" | "ACTION" | "TABLE";
    text: string;
    nodeContentHash: string;
    baselineRank: number | null;
    wholeQueryRank: number | null;
    obligationRanks: Array<{
      obligationId: string;
      rank: number;
    }>;
    protectedBaseline: boolean;
    protectedBaselineOrder: number | null;
  },
) {
  return {
    candidateIndex: candidate.candidateIndex,
    nodeId: candidate.nodeId,
    objectId: candidate.objectId,
    coursePackId: candidate.coursePackId,
    role: candidate.role,
    text: candidate.text,
    nodeContentHash: candidate.nodeContentHash,
    baselineRank: candidate.baselineRank,
    wholeQueryRank: candidate.wholeQueryRank,
    obligationRanks: candidate.obligationRanks,
    protectedBaseline:
      candidate.protectedBaseline,
    protectedBaselineOrder:
      candidate.protectedBaselineOrder,
  };
}

export function validateT45FinalArtifactV1(
  input: {
    prompts: readonly T44ContentRerankerPromptV1[];
    candidate:
      T44ObligationCandidateArtifactV1;
    baselineSelection:
      T44ObligationSelectionArtifactV1;
    draft: Artifact<DraftCase>;
    final: Artifact<FinalCase>;
  },
) {
  const promptIds = input.prompts.map(
    ({ caseId }) => caseId,
  );
  const draftIds = input.draft.cases.map(
    ({ caseId }) => caseId,
  );
  const finalIds = input.final.cases.map(
    ({ caseId }) => caseId,
  );
  if (
    !same(promptIds, draftIds)
    || !same(promptIds, finalIds)
    || !same(
      input.draft.summary,
      expectedSummary(input.draft.cases),
    )
    || !same(
      input.final.summary,
      expectedSummary(input.final.cases),
    )
  ) {
    throw new Error(
      "T45_FINAL_ARTIFACT_ORDER_OR_SUMMARY_DRIFT",
    );
  }
  for (
    const [index, sourcePrompt]
    of input.prompts.entries()
  ) {
    const draft = input.draft.cases[index]!;
    const final = input.final.cases[index]!;
    if (
      draft.caseId !== sourcePrompt.caseId
      || final.caseId !== sourcePrompt.caseId
      || draft.coursePackId
        !== sourcePrompt.coursePackId
      || final.coursePackId
        !== sourcePrompt.coursePackId
      || draft.candidateMapHash
        !== sourcePrompt.candidateMapHash
      || draft.promptHash !== sourcePrompt.promptHash
    ) {
      throw new Error(
        `T45_FINAL_ARTIFACT_DRAFT_BINDING_DRIFT:${sourcePrompt.caseId}`,
      );
    }
    const sourceByNode = new Map(
      sourcePrompt.candidates.map(
        (candidate) => [
          candidate.nodeId,
          candidate,
        ],
      ),
    );
    if (
      draft.selected.some((selected) => {
        const source = sourceByNode.get(
          selected.nodeId,
        );
        return (
          !source
          || source.candidateIndex
            !== selected.candidateIndex
          || source.objectId !== selected.objectId
          || source.coursePackId
            !== selected.coursePackId
          || source.nodeContentHash
            !== selected.nodeContentHash
        );
      })
    ) {
      throw new Error(
        `T45_FINAL_ARTIFACT_DRAFT_CANDIDATE_DRIFT:${sourcePrompt.caseId}`,
      );
    }
    if (
      !same(final.stageAudit.draft, {
        elapsedMs: draft.audit.elapsedMs,
        usage: draft.audit.usage,
      })
      || final.stageAudit.endToEnd.elapsedMs
        !== final.stageAudit.draft.elapsedMs
          + final.stageAudit.reviewer.elapsedMs
      || !same(
        final.stageAudit.endToEnd.usage,
        addUsage(
          final.stageAudit.draft.usage,
          final.stageAudit.reviewer.usage,
        ),
      )
      || final.audit.elapsedMs
        !== final.stageAudit.endToEnd.elapsedMs
      || !same(
        final.audit.usage,
        final.stageAudit.endToEnd.usage,
      )
      || final.bindingViolations.length !== 0
    ) {
      throw new Error(
        `T45_FINAL_ARTIFACT_AUDIT_DRIFT:${sourcePrompt.caseId}`,
      );
    }
    if (draft.status === "INVALID") {
      if (
        final.status !== "INVALID"
        || final.candidateMapHash
          !== draft.candidateMapHash
        || final.promptHash !== draft.promptHash
        || final.failureCategory
          !== draft.failureCategory
        || final.selected.length !== 0
        || final.stageAudit.reviewer.elapsedMs !== 0
        || !same(
          final.stageAudit.reviewer.usage,
          {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          },
        )
        || Object.values(final.completion).some(
          (values) => values.length !== 0,
        )
      ) {
        throw new Error(
          `T45_FINAL_ARTIFACT_INVALID_CASE_DRIFT:${sourcePrompt.caseId}`,
        );
      }
      continue;
    }
    const rebuilt = buildT45MultiAnchorPromptV1({
      sourcePrompt,
      draftCase: draft as never,
      baselineProtectedSelection:
        input.baselineSelection,
      candidateArtifact: input.candidate,
    });
    if (
      final.candidateMapHash
        !== rebuilt.candidateMapHash
      || final.promptHash !== rebuilt.promptHash
    ) {
      throw new Error(
        `T45_FINAL_ARTIFACT_PROMPT_BINDING_DRIFT:${sourcePrompt.caseId}`,
      );
    }
    if (final.status === "INVALID") {
      if (
        final.failureCategory === null
        || final.selected.length !== 0
        || Object.values(final.completion).some(
          (values) => values.length !== 0,
        )
      ) {
        throw new Error(
          `T45_FINAL_ARTIFACT_INVALID_REVIEW_DRIFT:${sourcePrompt.caseId}`,
        );
      }
      continue;
    }
    if (
      final.failureCategory !== null
      || final.selected.length
        !== rebuilt.selectionBudget
    ) {
      throw new Error(
        `T45_FINAL_ARTIFACT_PROMPT_BINDING_DRIFT:${sourcePrompt.caseId}`,
      );
    }
    const rebuiltByNode = new Map(
      rebuilt.candidates.map((candidate) => [
        candidate.nodeId,
        candidate,
      ]),
    );
    const obligationIds = new Set(
      rebuilt.obligationIds,
    );
    for (const selected of final.selected) {
      const candidate = rebuiltByNode.get(
        selected.nodeId,
      );
      if (
        !candidate
        || !same(
          candidateProjection(selected),
          candidateProjection(candidate),
        )
        || selected.obligationIds.length < 1
        || new Set(selected.obligationIds).size
          !== selected.obligationIds.length
        || selected.obligationIds.some(
          (obligationId) =>
            !obligationIds.has(obligationId),
        )
      ) {
        throw new Error(
          `T45_FINAL_ARTIFACT_SELECTED_OUTSIDE_PROMPT:${sourcePrompt.caseId}:${selected.nodeId}`,
        );
      }
    }
    const {
      modelSelectionLedger,
      obligationAnchors,
      protectedKept,
      modelSelectedBaselineKept,
      baselineRejected,
      modelAdded,
      deterministicAdded,
      unprotectedDropped,
    } = final.completion;
    assertUnique(
      modelSelectionLedger.map(
        ({ nodeId }) => nodeId,
      ),
      `T45_FINAL_ARTIFACT_COMPLETION_DUPLICATE:${sourcePrompt.caseId}:MODEL_SELECTION_LEDGER`,
    );
    assertUnique(
      obligationAnchors.map(
        ({ obligationId }) => obligationId,
      ),
      `T45_FINAL_ARTIFACT_COMPLETION_DUPLICATE:${sourcePrompt.caseId}:OBLIGATION_ANCHOR`,
    );
    const ledgerByNode = new Map(
      modelSelectionLedger.map((entry) => [
        entry.nodeId,
        entry,
      ]),
    );
    const finalByNodeForAnchors = new Map(
      final.selected.map((selected) => [
        selected.nodeId,
        selected,
      ]),
    );
    if (
      modelSelectionLedger.length
        !== rebuilt.selectionBudget
      || modelSelectionLedger.some(
        (entry) =>
          !rebuiltByNode.has(entry.nodeId)
          || entry.obligationIds.length < 1
          || new Set(entry.obligationIds).size
            !== entry.obligationIds.length
          || entry.obligationIds.some(
            (obligationId) =>
              !obligationIds.has(
                obligationId,
              ),
          ),
      )
      || obligationAnchors.some(
        ({ obligationId, nodeId }) => {
          const ledger =
            ledgerByNode.get(nodeId);
          const selected =
            finalByNodeForAnchors.get(nodeId);
          return (
            !obligationIds.has(obligationId)
            || !ledger
            || ledger.evidenceRole
              === "CONTEXT"
            || !ledger.obligationIds.includes(
              obligationId,
            )
            || !selected
            || selected.evidenceRole
              === "CONTEXT"
            || !selected.obligationIds.includes(
              obligationId,
            )
          );
        },
      )
    ) {
      throw new Error(
        `T45_FINAL_ARTIFACT_OBLIGATION_LEDGER_DRIFT:${sourcePrompt.caseId}`,
      );
    }
    for (const [values, label] of [
      [protectedKept, "PROTECTED"],
      [
        modelSelectedBaselineKept,
        "MODEL_SELECTED_PROTECTED",
      ],
      [modelAdded, "MODEL"],
      [deterministicAdded, "DETERMINISTIC"],
      [unprotectedDropped, "DROPPED"],
    ] as const) {
      assertUnique(
        values,
        `T45_FINAL_ARTIFACT_COMPLETION_DUPLICATE:${sourcePrompt.caseId}:${label}`,
      );
      if (
        values.some((nodeId) =>
          !rebuiltByNode.has(nodeId))
      ) {
        throw new Error(
          `T45_FINAL_ARTIFACT_COMPLETION_OUTSIDE_PROMPT:${sourcePrompt.caseId}:${label}`,
        );
      }
    }
    assertUnique(
      baselineRejected.map(({ nodeId }) => nodeId),
      `T45_FINAL_ARTIFACT_COMPLETION_DUPLICATE:${sourcePrompt.caseId}:BASELINE_REJECTED`,
    );
    const protectedCandidates = rebuilt.candidates
      .filter(({ protectedBaseline }) =>
        protectedBaseline)
      .sort((left, right) =>
        left.protectedBaselineOrder!
        - right.protectedBaselineOrder!);
    const protectedByNode = new Map(
      protectedCandidates.map((candidate) => [
        candidate.nodeId,
        candidate,
      ]),
    );
    const baselineRejectedNodeIds =
      baselineRejected.map(({ nodeId }) => nodeId);
    const baselineRejectedSet = new Set(
      baselineRejectedNodeIds,
    );
    const expectedBaselineRejected = [
      ...baselineRejected,
    ].sort(
      (left, right) =>
        (
          protectedByNode.get(left.nodeId)
            ?.protectedBaselineOrder
          ?? Number.MAX_SAFE_INTEGER
        )
        - (
          protectedByNode.get(right.nodeId)
            ?.protectedBaselineOrder
          ?? Number.MAX_SAFE_INTEGER
        ),
    );
    const modelSelectedBaselineKeptSet =
      new Set(modelSelectedBaselineKept);
    const defaultBaselineSlots = Math.max(
      0,
      resolveT45DefaultBaselineReservationV1(
        rebuilt,
      )
        - modelSelectedBaselineKept.length,
    );
    const initialProtectedCandidates =
      protectedCandidates
        .filter(
          ({ nodeId }) =>
            modelSelectedBaselineKeptSet
              .has(nodeId),
        )
        .concat(
          protectedCandidates
            .filter(
              ({ nodeId }) =>
                !baselineRejectedSet.has(nodeId)
                && !modelSelectedBaselineKeptSet
                  .has(nodeId),
            )
            .slice(0, defaultBaselineSlots),
        )
        .sort(
          (left, right) =>
            left.protectedBaselineOrder!
            - right.protectedBaselineOrder!,
        );
    const allModelSelectedSet = new Set([
      ...modelSelectedBaselineKept,
      ...modelAdded,
    ]);
    const expectedSelectedCandidates =
      selectT45DiverseCompletionCandidatesV1({
        prompt: rebuilt,
        initialSelectedCandidates:
          initialProtectedCandidates,
        modelSelectedNodeIds:
          allModelSelectedSet,
        rejectedNodeIds:
          baselineRejectedSet,
        obligationAnchorNodeIds:
          obligationAnchors
            .map(({ nodeId }) => nodeId)
            .filter(
              (nodeId) =>
                !initialProtectedCandidates
                  .some((candidate) =>
                    candidate.nodeId
                      === nodeId),
            ),
        orderedModelSelectedNodeIds:
          modelAdded,
      });
    const expectedProtectedKept =
      expectedSelectedCandidates
        .filter(
          ({ protectedBaseline }) =>
            protectedBaseline,
        )
        .sort(
          (left, right) =>
            left.protectedBaselineOrder!
            - right.protectedBaselineOrder!,
        )
        .map(({ nodeId }) => nodeId);
    const protectedSet = new Set(protectedKept);
    const modelSet = new Set(modelAdded);
    const deterministicSet =
      new Set(deterministicAdded);
    const expectedSelectedSet = new Set(
      expectedSelectedCandidates.map(
        ({ nodeId }) => nodeId,
      ),
    );
    const expectedDeterministicAdded =
      expectedSelectedCandidates
        .filter(
          ({ nodeId, protectedBaseline }) =>
            !protectedBaseline
            && !modelSet.has(nodeId),
        )
        .map(({ nodeId }) => nodeId);
    const expectedDropped = modelAdded.filter(
      (nodeId) =>
        !expectedSelectedSet.has(
          nodeId,
        ),
    );
    const expectedFinal =
      expectedSelectedCandidates.map(
        ({ nodeId }) => nodeId,
      );
    const finalNodeIds = final.selected.map(
      ({ nodeId }) => nodeId,
    );
    const ledgerProtectedKept =
      modelSelectionLedger
        .filter(({ nodeId, evidenceRole }) =>
          protectedByNode.has(nodeId)
          && evidenceRole !== "CONTEXT")
        .map(({ nodeId }) => nodeId)
        .sort(
          (left, right) =>
            protectedByNode.get(left)!
              .protectedBaselineOrder!
            - protectedByNode.get(right)!
              .protectedBaselineOrder!,
        );
    const ledgerRejected =
      modelSelectionLedger
        .filter(({ nodeId, evidenceRole }) =>
          protectedByNode.has(nodeId)
          && evidenceRole === "CONTEXT")
        .map(({ nodeId }) => nodeId)
        .sort(
          (left, right) =>
            protectedByNode.get(left)!
              .protectedBaselineOrder!
            - protectedByNode.get(right)!
              .protectedBaselineOrder!,
        );
    const ledgerModelAdded =
      modelSelectionLedger
        .filter(({ nodeId }) =>
          !protectedByNode.has(nodeId))
        .map(({ nodeId }) => nodeId);
    if (
      baselineRejected.some(
        ({ nodeId, reason }) =>
          !protectedByNode.has(nodeId)
          || reason
            !== "EXPLICIT_STUDENT_PREMISE_OR_EXCLUSION",
      )
      || !same(
        baselineRejected,
        expectedBaselineRejected,
      )
      || !same(
        protectedKept,
        expectedProtectedKept,
      )
      || modelSelectedBaselineKept.some(
        (nodeId) =>
          !protectedSet.has(nodeId)
          || baselineRejectedSet.has(nodeId),
      )
      || !same(
        modelSelectedBaselineKept,
        [...modelSelectedBaselineKept].sort(
          (left, right) =>
            protectedByNode.get(left)!
              .protectedBaselineOrder!
            - protectedByNode.get(right)!
              .protectedBaselineOrder!,
        ),
      )
      || !same(
        modelSelectedBaselineKept,
        ledgerProtectedKept,
      )
      || !same(
        baselineRejectedNodeIds,
        ledgerRejected,
      )
      || !same(
        modelAdded,
        ledgerModelAdded,
      )
      || modelSelectedBaselineKept.length
        + baselineRejected.length
        + modelAdded.length
        !== rebuilt.selectionBudget
      || modelAdded.some(
        (nodeId) =>
          protectedSet.has(nodeId)
          || baselineRejectedSet.has(nodeId)
          || protectedByNode.has(nodeId)
          || deterministicSet.has(nodeId),
      )
      || deterministicAdded.some(
        (nodeId) =>
          protectedSet.has(nodeId)
          || baselineRejectedSet.has(nodeId)
          || modelSet.has(nodeId)
          || protectedByNode.has(nodeId),
      )
      || unprotectedDropped.some(
        (nodeId) =>
          protectedSet.has(nodeId)
          || baselineRejectedSet.has(nodeId)
          || !modelSet.has(nodeId)
            && !deterministicSet.has(nodeId),
      )
      || !same(
        deterministicAdded,
        expectedDeterministicAdded,
      )
      || !same(
        unprotectedDropped,
        expectedDropped,
      )
      || !same(finalNodeIds, expectedFinal)
      || new Set(finalNodeIds).size
        !== finalNodeIds.length
    ) {
      throw new Error(
        `T45_FINAL_ARTIFACT_COMPLETION_LEDGER_DRIFT:${sourcePrompt.caseId}`,
      );
    }
    const modelSelected =
      modelSelectionLedger.map((entry) => {
      const candidate =
        rebuiltByNode.get(entry.nodeId);
      if (!candidate) return null;
      return {
        candidateIndex: candidate.candidateIndex,
        nodeId: candidate.nodeId,
        objectId: candidate.objectId,
        coursePackId: candidate.coursePackId,
        role: candidate.role,
        text: candidate.text,
        nodeContentHash: candidate.nodeContentHash,
        baselineRank: candidate.baselineRank,
        wholeQueryRank: candidate.wholeQueryRank,
        obligationRanks: candidate.obligationRanks,
        obligationIds: [
          ...entry.obligationIds,
        ],
        evidenceRole: entry.evidenceRole as
          | "DIRECT"
          | "COMPLEMENT"
          | "CONTEXT",
      };
    });
    let replayMatches = false;
    if (!modelSelected.some(
      (selected) => selected === null,
    )) {
      try {
        const replay =
          applyT45MultiAnchorCompletionV1({
            prompt: rebuilt,
            modelSelection: {
              caseId: final.caseId,
              coursePackId: final.coursePackId,
              candidateMapHash:
                rebuilt.candidateMapHash,
              promptHash: rebuilt.promptHash,
              status: "VALID",
              failureCategory: null,
              selected: modelSelected,
              audit: {
                elapsedMs:
                  final.stageAudit.reviewer.elapsedMs,
                rawOutputHash:
                  final.audit.rawOutputHash,
                usage:
                  final.stageAudit.reviewer.usage,
              },
            } as never,
          });
        replayMatches =
          same(
            replay.completion,
            final.completion,
          )
          && same(
            replay.testCase.selected,
            final.selected,
          );
      } catch {
        replayMatches = false;
      }
    }
    if (!replayMatches) {
      throw new Error(
        `T45_FINAL_ARTIFACT_COMPLETION_REPLAY_DRIFT:${sourcePrompt.caseId}`,
      );
    }
  }
  return input.final;
}
