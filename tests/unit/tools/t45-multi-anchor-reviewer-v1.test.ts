import { describe, expect, it } from "vitest";

import { sha256StableJsonV2 } from "@/lib/knowledge/knowledge-object-v2";
import {
  T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
  T44_OBLIGATION_CANDIDATE_CONFIG_V1,
  T44ObligationCandidateArtifactV1Schema,
  type T44ObligationCandidateNodeV1,
} from "@/tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  T44ObligationSelectionArtifactV1Schema,
} from "@/tools/mixed-retrieval/t44-obligation-label-blind-v2";
import {
  T44ContentRerankerSelectionCaseV1Schema,
  buildT44ContentRerankerPromptV1,
  mapT44ContentRerankerModelOutputV1,
  type T44ContentRerankerPromptV1,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import {
  T45_MULTI_ANCHOR_PROMPT_TEMPLATE_HASH_V1,
  T45_MULTI_ANCHOR_PROMPT_TEMPLATE_V1,
  T45_MULTI_ANCHOR_REVIEWER_CONFIG_HASH_V1,
  T45_MULTI_ANCHOR_REVIEWER_CONFIG_V1,
  applyT45MultiAnchorCompletionV1,
  buildT45MultiAnchorPromptV1,
  buildT45ProtectedBaselineMap,
  resolveT45DefaultBaselineReservationV1,
  scoreT45CandidateFusionV1,
  scoreT45QuestionLexicalOverlapV1,
} from "@/tools/mixed-retrieval/t45-multi-anchor-reviewer-v1";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const CASE_ID = "t45-capability-calibration-case-01";
const COURSE_PACK_ID = "layout-design";

function node(
  index: number,
  objectId: string,
  text = `${objectId} 的第 ${index} 条原子证据`,
): T44ObligationCandidateNodeV1 {
  return {
    nodeId: `node-${index}`,
    objectId,
    coursePackId: COURSE_PACK_ID,
    objectRank:
      objectId === "object-baseline"
        ? 1
        : objectId === "object-draft"
          ? 2
          : 3,
    kind: "TEXT",
    role: index % 2 === 0 ? "ACTION" : "FACT",
    text,
    nodeContentHash: HASH,
    objectContentHash: HASH,
    sourceHash: HASH,
  };
}

function artifactArm(
  nodes: readonly T44ObligationCandidateNodeV1[],
  obligationIds: readonly string[] = [
    "obligation-1",
  ],
) {
  const objectIds = Array.from(new Set(
    nodes.map(({ objectId }) => objectId),
  ));
  return {
    directEvidenceBatchHash: HASH,
    rrfResultHash: HASH,
    objectRanking: objectIds.map(
      (objectId, index) => ({
        objectId,
        fusedRank: index + 1,
        fusionScore: 1 / (index + 1),
        bestRawRank: index + 1,
        obligationIds: [...obligationIds],
        origins: ["LEXICAL" as const],
      }),
    ),
    candidateNodes: nodes,
    candidateNodeIdsSha256: sha256StableJsonV2(
      nodes.map(({ nodeId }) => nodeId),
    ),
  };
}

function fixture(
  protectedCount: number,
  input: {
    sourceBaselineCount?: number;
    diagnosticAtEight?: boolean;
    multipleObligations?: boolean;
  } = {},
) {
  const baselineNodes = Array.from(
    { length: 8 },
    (_, index) => {
      const candidate = node(
        index + 1,
        "object-baseline",
        input.diagnosticAtEight && index === 7
          ? "不要凭模糊感觉直接定案，应拆成受众和字形两个原因。"
          : undefined,
      );
      return input.diagnosticAtEight && index === 7
        ? { ...candidate, role: "FACT" as const }
        : candidate;
    },
  );
  const draftNodes = Array.from(
    { length: 8 },
    (_, index) =>
      node(index + 9, "object-draft"),
  );
  const unrelatedNode = node(
    17,
    "object-unrelated",
  );
  const candidates = [
    ...baselineNodes,
    ...draftNodes,
    unrelatedNode,
  ];
  const obligations = input.multipleObligations
    ? [
        {
          obligationId: "obligation-1",
          learnerNeed: "判断当前问题的原因。",
          intent: "DIAGNOSE_CAUSE",
        },
        {
          obligationId: "obligation-2",
          learnerNeed: "给出可执行的修改动作。",
          intent: "PROPOSE_ACTION",
        },
      ]
    : [{
        obligationId: "obligation-1",
        learnerNeed: "判断原因并给出修改动作。",
        intent: input.diagnosticAtEight
          ? "DIAGNOSE_CAUSE"
          : "DIAGNOSE_AND_FIX",
      }];
  const sourcePrompt =
    buildT44ContentRerankerPromptV1({
      caseId: CASE_ID,
      coursePackId: COURSE_PACK_ID,
      question:
        "这个方案看着不对，我应该先排查哪几件事，再怎么改？",
      obligations,
      bCandidateNodes: candidates,
      aCandidateNodes: candidates,
      aBaselineSelectedNodeIds: baselineNodes
        .slice(
          0,
          input.sourceBaselineCount ?? protectedCount,
        )
        .map(({ nodeId }) => nodeId),
      wholeQueryRanking: candidates.map(
        ({ nodeId }, index) => ({
          nodeId,
          rank: index + 1,
        }),
      ),
      obligationRankings: obligations.map(
        ({ obligationId }, obligationIndex) => ({
          obligationId,
          ranking: candidates.map(
            ({ nodeId }, index) => ({
              nodeId,
              rank:
                obligationIndex === 0
                  ? index + 1
                  : candidates.length - index,
            }),
          ),
        }),
      ),
    });
  const draftMapped =
    mapT44ContentRerankerModelOutputV1({
      prompt: sourcePrompt,
      rawOutput: JSON.stringify({
        selections: Array.from(
          { length: 8 },
          (_, index) => ({
            candidateIndex: index + 9,
            obligationIds: ["obligation-1"],
            evidenceRole: "DIRECT",
          }),
        ),
      }),
    });
  const draftCase =
    T44ContentRerankerSelectionCaseV1Schema.parse({
      caseId: CASE_ID,
      coursePackId: COURSE_PACK_ID,
      candidateMapHash:
        sourcePrompt.candidateMapHash,
      promptHash: sourcePrompt.promptHash,
      status: "VALID",
      failureCategory: null,
      selected: draftMapped.selected,
      audit: {
        elapsedMs: 100,
        rawOutputHash: draftMapped.rawOutputHash,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
      },
    });
  const candidateArtifact =
    T44ObligationCandidateArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T44_OBLIGATION_CANDIDATES",
      runtimeSuite: {
        id: "t45-capability-calibration-runtime-v1",
        version: "1.0.0",
        suiteHash: HASH,
      },
      corpusSnapshot: {
        bundleHash: HASH,
      },
      config:
        T44_OBLIGATION_CANDIDATE_CONFIG_V1,
      configHash:
        T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
      graphifyInvocationCount: 0,
      providerAudit: {
        expectedCalls: 0,
        actualCalls: 0,
        channelCounts: {
          LEXICAL: 0,
          TEXT_VECTOR: 0,
          VISUAL_VECTOR: 0,
        },
        matched: true,
      },
      cases: [{
        caseId: CASE_ID,
        coursePackId: COURSE_PACK_ID,
        coursePackVersion: "1",
        normalizedQuestionHash: HASH,
        obligationSetHash: HASH,
        retrievalPlanHash: HASH,
        arms: {
          A_WHOLE_QUERY: artifactArm(
            candidates,
            obligations.map(
              ({ obligationId }) => obligationId,
            ),
          ),
          B_MODEL_GUIDED: artifactArm(
            candidates,
            obligations.map(
              ({ obligationId }) => obligationId,
            ),
          ),
        },
      }],
    });
  const protectedRows = baselineNodes
    .slice(0, protectedCount)
    .map((candidate, index) => ({
      nodeId: candidate.nodeId,
      objectId: candidate.objectId,
      coursePackId: candidate.coursePackId,
      selectionSource:
        "WHOLE_QUERY_BASELINE" as const,
      obligationId: null,
      aggregateRrfScore: 1 / (60 + index + 1),
    }));
  const complementRows = draftNodes
    .slice(0, 8 - protectedCount)
    .map((candidate, index) => ({
      nodeId: candidate.nodeId,
      objectId: candidate.objectId,
      coursePackId: candidate.coursePackId,
      selectionSource:
        "OBLIGATION_COMPLEMENT" as const,
      obligationId: "obligation-1",
      aggregateRrfScore:
        1 / (70 + index + 1),
    }));
  const baselineProtectedSelection =
    T44ObligationSelectionArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T44_OBLIGATION_SELECTIONS",
      candidateArtifactSha256: HASH,
      matrixOutputSha256: HASH,
      graphifyInvocationCount: 0,
      cases: [{
        caseId: CASE_ID,
        coursePackId: COURSE_PACK_ID,
        candidateNodeIdsSha256:
          sha256StableJsonV2({
            A_WHOLE_QUERY:
              candidateArtifact.cases[0]!.arms
                .A_WHOLE_QUERY
                .candidateNodeIdsSha256,
            B_MODEL_GUIDED:
              candidateArtifact.cases[0]!.arms
                .B_MODEL_GUIDED
                .candidateNodeIdsSha256,
          }),
        arms: {
          A_WHOLE_QUERY: {
            selected: protectedRows,
          },
          B_MODEL_GUIDED: {
            selected: [
              ...protectedRows,
              ...complementRows,
            ],
          },
        },
      }],
    });
  return {
    baselineNodes,
    draftNodes,
    sourcePrompt,
    draftCase,
    candidateArtifact,
    baselineProtectedSelection,
  };
}

function buildPrompt(
  protectedCount: number,
  input: {
    sourceBaselineCount?: number;
    diagnosticAtEight?: boolean;
    multipleObligations?: boolean;
  } = {},
) {
  const source = fixture(protectedCount, input);
  return {
    ...source,
    prompt: buildT45MultiAnchorPromptV1({
      sourcePrompt: source.sourcePrompt,
      draftCase: source.draftCase,
      baselineProtectedSelection:
        source.baselineProtectedSelection,
      candidateArtifact:
        source.candidateArtifact,
    }),
  };
}

function modelSelection(
  prompt: T44ContentRerankerPromptV1,
  indexes: readonly number[],
) {
  return modelSelectionWithAssignments(
    prompt,
    indexes.map((candidateIndex) => ({
      candidateIndex,
      obligationIds: ["obligation-1"],
      evidenceRole: "DIRECT" as const,
    })),
  );
}

function modelSelectionWithAssignments(
  prompt: T44ContentRerankerPromptV1,
  assignments: ReadonlyArray<{
    candidateIndex: number;
    obligationIds: string[];
    evidenceRole:
      | "DIRECT"
      | "COMPLEMENT"
      | "CONTEXT";
  }>,
) {
  const mapped =
    mapT44ContentRerankerModelOutputV1({
      prompt,
      rawOutput: JSON.stringify({
        selections: assignments,
      }),
    });
  return T44ContentRerankerSelectionCaseV1Schema
    .parse({
      caseId: prompt.caseId,
      coursePackId: prompt.coursePackId,
      candidateMapHash: prompt.candidateMapHash,
      promptHash: prompt.promptHash,
      status: "VALID",
      failureCategory: null,
      selected: mapped.selected,
      audit: {
        elapsedMs: 200,
        rawOutputHash: mapped.rawOutputHash,
        usage: {
          inputTokens: 20,
          outputTokens: 10,
          totalTokens: 30,
        },
      },
    });
}

describe("T4.5 multi-anchor reviewer v1", () => {
  it("binds the actual prompt template projection to a frozen hash", () => {
    expect(
      sha256StableJsonV2(
        T45_MULTI_ANCHOR_PROMPT_TEMPLATE_V1,
      ),
    ).toBe(
      T45_MULTI_ANCHOR_PROMPT_TEMPLATE_HASH_V1,
    );
    expect(
      T45_MULTI_ANCHOR_REVIEWER_CONFIG_V1
        .promptTemplateHash,
    ).toBe(
      T45_MULTI_ANCHOR_PROMPT_TEMPLATE_HASH_V1,
    );
  });

  it.each([4, 5, 6, 7, 8])(
    "keeps the two default anchors out of %i and gives the remaining budget to reviewer evidence",
    (protectedCount) => {
      const { prompt } = buildPrompt(
        protectedCount,
      );
      const model = modelSelection(
        prompt,
        [9, 10, 11, 12, 13, 14, 15, 16],
      );
      const result =
        applyT45MultiAnchorCompletionV1({
          prompt,
          modelSelection: model,
        });

      expect(result.testCase.selected)
        .toHaveLength(8);
      expect(result.testCase.selected.filter(
        ({ protectedBaseline }) =>
          protectedBaseline,
      )).toHaveLength(2);
      expect(result.completion.protectedKept)
        .toEqual([
          "node-1",
          "node-2",
        ]);
      expect(
        result.completion.modelSelectedBaselineKept,
      ).toEqual([]);
      expect(result.completion.baselineRejected)
        .toEqual([]);
      expect(result.completion.unprotectedDropped)
        .toHaveLength(2);
      expect(prompt.candidates.filter(
        ({ protectedBaseline }) =>
          protectedBaseline,
      )).toHaveLength(protectedCount);
    },
  );

  it("uses CONTEXT on a selected baseline anchor as an explicit rejection and does not restore it", () => {
    const { prompt } = buildPrompt(4, {
      sourceBaselineCount: 8,
      diagnosticAtEight: true,
    });
    const model = modelSelection(
      prompt,
      [2, 9, 10, 11, 12, 13, 14, 15],
    );
    const explicitRejection = {
      ...model,
      selected: model.selected.map((selected) =>
        selected.candidateIndex === 2
          ? {
              ...selected,
              evidenceRole: "CONTEXT" as const,
            }
          : selected),
    };
    const result =
      applyT45MultiAnchorCompletionV1({
        prompt,
        modelSelection: explicitRejection,
      });

    expect(result.completion.protectedKept)
      .toEqual([
        "node-1",
        "node-3",
      ]);
    expect(result.completion.baselineRejected)
      .toEqual([{
        nodeId: "node-2",
        reason:
          "EXPLICIT_STUDENT_PREMISE_OR_EXCLUSION",
    }]);
    expect(result.completion.deterministicAdded)
      .toEqual([]);
    expect(result.testCase.selected.some(
      ({ nodeId }) => nodeId === "node-2",
    )).toBe(false);
  });

  it("fills the Top-8 from label-blind unprotected candidates when explicit rejections consume model slots", () => {
    const { prompt } = buildPrompt(8);
    const model = modelSelection(
      prompt,
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    const manyRejections = {
      ...model,
      selected: model.selected.map((selected) =>
        selected.candidateIndex === 1
          ? selected
          : {
              ...selected,
              evidenceRole: "CONTEXT" as const,
            }),
    };
    const result =
      applyT45MultiAnchorCompletionV1({
        prompt,
        modelSelection: manyRejections,
      });

    expect(result.completion.protectedKept)
      .toEqual(["node-1"]);
    expect(result.completion.baselineRejected)
      .toHaveLength(7);
    expect(result.completion.deterministicAdded)
      .toHaveLength(7);
    expect(result.testCase.selected)
      .toHaveLength(8);
    expect(result.testCase.selected.filter(
      ({ protectedBaseline }) =>
        protectedBaseline,
    )).toHaveLength(1);
  });

  it("keeps omitted baseline anchors by default and records which kept anchors the model selected", () => {
    const { prompt } = buildPrompt(4);
    const result =
      applyT45MultiAnchorCompletionV1({
        prompt,
        modelSelection: modelSelection(
          prompt,
          [1, 9, 10, 11, 12, 13, 14, 15],
        ),
      });

    expect(result.completion.protectedKept)
      .toEqual([
      "node-1",
      "node-2",
    ]);
    expect(
      result.completion.modelSelectedBaselineKept,
    )
      .toEqual(["node-1"]);
    expect(result.completion.baselineRejected)
      .toEqual([]);
    expect(result.completion.modelAdded)
      .toEqual([
        "node-9",
        "node-10",
        "node-11",
        "node-12",
        "node-13",
        "node-14",
        "node-15",
      ]);
    expect(result.completion.unprotectedDropped)
      .toEqual([
        "node-15",
      ]);
  });

  it("does not evict an early reviewer-selected direct evidence merely because its retrieval rank is lower", () => {
    const { prompt } = buildPrompt(4);
    const result =
      applyT45MultiAnchorCompletionV1({
        prompt,
        modelSelection: modelSelection(
          prompt,
          [16, 9, 10, 11, 12, 13, 14, 15],
        ),
      });

    expect(result.testCase.selected.map(
      ({ nodeId }) => nodeId,
    )).toContain("node-16");
    expect(result.completion.unprotectedDropped)
      .not.toContain("node-16");
    expect(
      result.completion
        .modelSelectionLedger[0],
    ).toEqual({
      nodeId: "node-16",
      obligationIds: ["obligation-1"],
      evidenceRole: "DIRECT",
    });
    expect(result.completion.obligationAnchors)
      .toEqual([{
        obligationId: "obligation-1",
        nodeId: "node-16",
      }]);
  });

  it("keeps distinct non-context reviewer evidence for every answer obligation under baseline pressure", () => {
    const { prompt } = buildPrompt(8, {
      multipleObligations: true,
    });
    const result =
      applyT45MultiAnchorCompletionV1({
        prompt,
        modelSelection:
          modelSelectionWithAssignments(
            prompt,
            [
              {
                candidateIndex: 9,
                obligationIds: [
                  "obligation-1",
                ],
                evidenceRole: "DIRECT",
              },
              ...[10, 11, 12, 13, 14, 15]
                .map((candidateIndex) => ({
                  candidateIndex,
                  obligationIds: [
                    "obligation-1",
                  ],
                  evidenceRole:
                    "COMPLEMENT" as const,
                })),
              {
                candidateIndex: 16,
                obligationIds: [
                  "obligation-2",
                ],
                evidenceRole: "DIRECT",
              },
            ],
          ),
      });

    for (
      const obligationId
      of prompt.obligationIds
    ) {
      expect(result.testCase.selected.some(
        (selected) =>
          selected.evidenceRole !== "CONTEXT"
          && selected.obligationIds.includes(
            obligationId,
          ),
      )).toBe(true);
    }
    expect(result.testCase.selected.map(
      ({ nodeId }) => nodeId,
    )).toContain("node-16");
    expect(result.completion.unprotectedDropped)
      .not.toContain("node-16");
    expect(result.completion.obligationAnchors)
      .toEqual([
        {
          obligationId: "obligation-1",
          nodeId: "node-9",
        },
        {
          obligationId: "obligation-2",
          nodeId: "node-16",
        },
      ]);
  });

  it("keeps more than four baseline anchors only when the model explicitly selects them", () => {
    const { prompt } = buildPrompt(8);
    const result =
      applyT45MultiAnchorCompletionV1({
        prompt,
        modelSelection: modelSelection(
          prompt,
          [4, 5, 6, 7, 8, 9, 10, 11],
        ),
      });

    expect(result.completion.protectedKept)
      .toEqual([
        "node-4",
        "node-5",
        "node-6",
        "node-7",
        "node-8",
      ]);
    expect(
      result.completion.modelSelectedBaselineKept,
    ).toEqual([
      "node-4",
      "node-5",
      "node-6",
      "node-7",
      "node-8",
    ]);
    expect(result.testCase.selected.map(
      ({ nodeId }) => nodeId,
    )).toEqual([
      "node-4",
      "node-5",
      "node-6",
      "node-7",
      "node-8",
      "node-9",
      "node-10",
      "node-11",
    ]);
  });

  it("cross-validates protected provenance against the same case, course, object, candidate, and content hash", () => {
    const source = fixture(4);
    const protectedMap =
      buildT45ProtectedBaselineMap({
        baselineProtectedSelection:
          source.baselineProtectedSelection,
        candidateArtifact:
          source.candidateArtifact,
        sourcePrompt: source.sourcePrompt,
      });

    expect([...protectedMap.values()]).toEqual(
      source.baselineNodes
        .slice(0, 4)
        .map((candidate, index) => ({
          nodeId: candidate.nodeId,
          objectId: candidate.objectId,
          coursePackId: candidate.coursePackId,
          nodeContentHash:
            candidate.nodeContentHash,
          baselineOrder: index + 1,
        })),
    );

    const selectionCase =
      source.baselineProtectedSelection.cases[0]!;
    const candidateCase =
      source.candidateArtifact.cases[0]!;
    const firstProtected =
      selectionCase.arms.B_MODEL_GUIDED
        .selected[0]!;
    const expectFailure = (
      selection:
        typeof source.baselineProtectedSelection =
          source.baselineProtectedSelection,
      candidate:
        typeof source.candidateArtifact =
          source.candidateArtifact,
      prompt = source.sourcePrompt,
    ) => expect(() =>
      buildT45ProtectedBaselineMap({
        baselineProtectedSelection: selection,
        candidateArtifact: candidate,
        sourcePrompt: prompt,
      }),
    ).toThrow();

    expectFailure({
      ...source.baselineProtectedSelection,
      cases: [{
        ...selectionCase,
        caseId: "another-case",
      }],
    });
    expectFailure({
      ...source.baselineProtectedSelection,
      cases: [{
        ...selectionCase,
        arms: {
          ...selectionCase.arms,
          B_MODEL_GUIDED: {
            selected: [],
          },
        },
      }],
    });
    expectFailure({
      ...source.baselineProtectedSelection,
      cases: [{
        ...selectionCase,
        candidateNodeIdsSha256: OTHER_HASH,
      }],
    });
    expectFailure({
      ...source.baselineProtectedSelection,
      cases: [{
        ...selectionCase,
        arms: {
          ...selectionCase.arms,
          B_MODEL_GUIDED: {
            selected: [
              {
                ...firstProtected,
                objectId: "object-drift",
              },
              ...selectionCase.arms.B_MODEL_GUIDED
                .selected.slice(1),
            ],
          },
        },
      }],
    });
    expectFailure({
      ...source.baselineProtectedSelection,
      cases: [{
        ...selectionCase,
        arms: {
          ...selectionCase.arms,
          B_MODEL_GUIDED: {
            selected: [
              {
                ...firstProtected,
                coursePackId: "book-design",
              },
              ...selectionCase.arms.B_MODEL_GUIDED
                .selected.slice(1),
            ],
          },
        },
      }],
    });
    expectFailure(
      source.baselineProtectedSelection,
      {
        ...source.candidateArtifact,
        cases: [{
          ...candidateCase,
          arms: {
            ...candidateCase.arms,
            B_MODEL_GUIDED: {
              ...candidateCase.arms
                .B_MODEL_GUIDED,
              candidateNodes:
                candidateCase.arms
                  .B_MODEL_GUIDED
                  .candidateNodes.map(
                    (candidate) =>
                      candidate.nodeId
                        === firstProtected.nodeId
                        ? {
                            ...candidate,
                            nodeContentHash:
                              OTHER_HASH,
                          }
                        : candidate,
                  ),
            },
          },
        }],
      },
    );
    expectFailure({
      ...source.baselineProtectedSelection,
      cases: [{
        ...selectionCase,
        arms: {
          ...selectionCase.arms,
          B_MODEL_GUIDED: {
            selected: [
              {
                ...firstProtected,
                nodeId: "node-missing",
              },
              ...selectionCase.arms.B_MODEL_GUIDED
                .selected.slice(1),
            ],
          },
        },
      }],
    });
    expectFailure({
      ...source.baselineProtectedSelection,
      cases: [{
        ...selectionCase,
        arms: {
          ...selectionCase.arms,
          B_MODEL_GUIDED: {
            selected: [
              firstProtected,
              firstProtected,
              ...selectionCase.arms.B_MODEL_GUIDED
                .selected.slice(2),
            ],
          },
        },
      }],
    });
    expect(() =>
      buildT45ProtectedBaselineMap({
        baselineProtectedSelection: {
          ...source.baselineProtectedSelection,
          cases: [{
            ...selectionCase,
            arms: {
              ...selectionCase.arms,
              B_MODEL_GUIDED: {
                selected: [
                  ...selectionCase.arms
                    .B_MODEL_GUIDED.selected,
                  {
                    nodeId: "node-9",
                    objectId: "object-draft",
                    coursePackId: COURSE_PACK_ID,
                    selectionSource:
                      "WHOLE_QUERY_BASELINE",
                    obligationId: null,
                    aggregateRrfScore: 1 / 99,
                  },
                ],
              },
            },
          }],
        } as never,
        candidateArtifact:
          source.candidateArtifact,
        sourcePrompt: source.sourcePrompt,
      }),
    ).toThrow();
  });

  it("marks p=1 and p=0 in the prompt and binds those fields into a new config and candidate-map hash", () => {
    const four = buildPrompt(4, {
      sourceBaselineCount: 8,
    });
    const five = buildPrompt(5, {
      sourceBaselineCount: 8,
    });

    expect(four.prompt.messages[0]?.content)
      .toContain("p=1");
    expect(four.prompt.messages[0]?.content)
      .toContain("默认保留");
    expect(four.prompt.messages[0]?.content)
      .toContain("evidenceRole 标成 CONTEXT");
    expect(four.prompt.messages[0]?.content)
      .toContain("页数、尺寸、对象或任务边界");
    expect(four.prompt.messages[0]?.content)
      .toContain("评价、纠正、反驳");
    expect(four.prompt.messages[0]?.content)
      .toContain("单一回答义务");
    expect(four.prompt.messages[0]?.content)
      .toContain("多回答义务");
    expect(four.prompt.messages[1]?.content)
      .toContain("p=1");
    expect(four.prompt.messages[1]?.content)
      .toContain("p=0");
    expect(four.prompt.candidates.filter(
      ({ protectedBaseline }) =>
        protectedBaseline,
    )).toHaveLength(4);
    expect(
      four.prompt.candidateMapHash,
    ).not.toBe(five.prompt.candidateMapHash);
    expect(
      T45_MULTI_ANCHOR_REVIEWER_CONFIG_V1
        .baselinePolicy,
    ).toBe(
      "BASELINE_DEFAULT_RESERVATION_TWO_SINGLE_FOUR_MULTI_MODEL_SELECTED_ADDITIONAL_ONLY_CONTEXT_MARKED_ANCHORS_EXPLICITLY_REJECTED",
    );
    expect(
      T45_MULTI_ANCHOR_REVIEWER_CONFIG_V1
        .defaultBaselineReservation,
    ).toEqual({
      singleObligation: 2,
      multipleObligations: 4,
    });
    expect(
      T45_MULTI_ANCHOR_REVIEWER_CONFIG_V1
        .candidateRankFusion,
    ).toEqual({
      rrfOffset: 60,
      modelSelectedBonus: 0.005,
      wholeQueryWeight: 1,
      obligationSumWeight: 0.5,
      questionLexicalWeight: 0.02,
      atomicityWeight: 0.005,
      maximumPerObject: 3,
      maximumPerObjectSemanticCue: 1,
    });
    expect(
      resolveT45DefaultBaselineReservationV1(
        four.prompt,
      ),
    ).toBe(2);
    expect(
      resolveT45DefaultBaselineReservationV1({
        selectionBudget: 8,
        obligations: [
          four.prompt.obligations[0]!,
          {
            ...four.prompt.obligations[0]!,
            obligationId: "obligation-2",
          },
        ],
      }),
    ).toBe(4);
    expect(
      T45_MULTI_ANCHOR_REVIEWER_CONFIG_HASH_V1,
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses the frozen label-blind fusion score for deterministic fallback candidates", () => {
    const strongRetrieval =
      scoreT45CandidateFusionV1(
        "国际主义风格的网格怎样判断",
        {
          text: "通过网格和信息层级判断国际主义风格",
          wholeQueryRank: 7,
          obligationRanks: [
            {
              obligationId: "obligation-1",
              rank: 7,
            },
            {
              obligationId: "obligation-2",
              rank: 7,
            },
            {
              obligationId: "obligation-3",
              rank: 7,
            },
          ],
        },
        false,
      );
    const weakRetrievalSelectedByModel =
      scoreT45CandidateFusionV1(
        "国际主义风格的网格怎样判断",
        {
          text: "不相关的工具背景",
          wholeQueryRank: 80,
          obligationRanks: [
            {
              obligationId: "obligation-1",
              rank: 80,
            },
            {
              obligationId: "obligation-2",
              rank: 80,
            },
            {
              obligationId: "obligation-3",
              rank: 80,
            },
          ],
        },
        true,
      );

    expect(strongRetrieval).toBeGreaterThan(
      weakRetrievalSelectedByModel,
    );
    expect(
      scoreT45CandidateFusionV1(
        "",
        {
          text: "",
          wholeQueryRank: null,
          obligationRanks: [],
        },
        false,
      ),
    ).toBe(0);
    expect(
      scoreT45QuestionLexicalOverlapV1(
        "OSC 接收为什么没有通道",
        "检查 OSC In CHOP 的接收端口和通道",
      ),
    ).toBeGreaterThan(0);
  });

  it("rejects a coherent rank-2 protected-marker replacement even when the stale hashes are retained", () => {
    const { prompt } = buildPrompt(8);
    const markerOnlyTamper = {
      ...prompt,
      candidates: prompt.candidates.map(
        (candidate) =>
          candidate.nodeId === "node-2"
            ? {
                ...candidate,
                protectedBaseline: false,
                protectedBaselineOrder: null,
              }
            : candidate,
      ),
    };
    const tamperedPrompt = {
      ...prompt,
      candidates: prompt.candidates.map(
        (candidate) => {
          if (candidate.nodeId === "node-2") {
            return {
              ...candidate,
              protectedBaseline: false,
              protectedBaselineOrder: null,
            };
          }
          if (
            candidate.protectedBaselineOrder !== null
            && candidate.protectedBaselineOrder > 2
          ) {
            return {
              ...candidate,
              protectedBaselineOrder:
                candidate.protectedBaselineOrder - 1,
            };
          }
          if (candidate.nodeId === "node-9") {
            return {
              ...candidate,
              protectedBaseline: true,
              protectedBaselineOrder: 8,
            };
          }
          return candidate;
        },
      ),
    };

    expect(() =>
      applyT45MultiAnchorCompletionV1({
        prompt: markerOnlyTamper,
        modelSelection: modelSelection(
          markerOnlyTamper,
          [9, 10, 11, 12, 13, 14, 15, 16],
        ),
      }),
    ).toThrow(
      "T45_MULTI_ANCHOR_PROTECTED_ORDER_DRIFT",
    );
    expect(() =>
      applyT45MultiAnchorCompletionV1({
        prompt: tamperedPrompt,
        modelSelection: modelSelection(
          tamperedPrompt,
          [9, 10, 11, 12, 13, 14, 15, 16],
        ),
      }),
    ).toThrow(
      "T45_MULTI_ANCHOR_PROMPT_CANDIDATE_MAP_HASH_DRIFT",
    );
  });

  it("rejects stale hashes after candidate reordering, message changes, or obligation changes", () => {
    const { prompt } = buildPrompt(4);
    const reordered = [...prompt.candidates]
      .reverse()
      .map((candidate, index) => ({
        ...candidate,
        candidateIndex: index + 1,
      }));
    const tamperedPrompts = [
      {
        ...prompt,
        candidates: reordered,
      },
      {
        ...prompt,
        messages: prompt.messages.map(
          (message, index) =>
            index === 1
              ? {
                  ...message,
                  content:
                    `${message.content}\n篡改消息`,
                }
              : message,
        ),
      },
      {
        ...prompt,
        obligations: prompt.obligations.map(
          (obligation, index) =>
            index === 0
              ? {
                  ...obligation,
                  learnerNeed: "篡改后的回答义务",
                }
              : obligation,
        ),
      },
    ];

    expect(() =>
      applyT45MultiAnchorCompletionV1({
        prompt: tamperedPrompts[0]!,
        modelSelection: modelSelection(
          tamperedPrompts[0]!,
          [9, 10, 11, 12, 13, 14, 15, 16],
        ),
      }),
    ).toThrow(
      "T45_MULTI_ANCHOR_PROMPT_CANDIDATE_MAP_HASH_DRIFT",
    );
    for (const tampered of tamperedPrompts.slice(1)) {
      expect(() =>
        applyT45MultiAnchorCompletionV1({
          prompt: tampered,
          modelSelection: modelSelection(
            tampered,
            [9, 10, 11, 12, 13, 14, 15, 16],
          ),
        }),
      ).toThrow(
        "T45_MULTI_ANCHOR_PROMPT_HASH_DRIFT",
      );
    }
  });

  it("rejects duplicate protected orders and deeply freezes the canonical prompt", () => {
    const { prompt } = buildPrompt(4);
    const duplicateOrder = {
      ...prompt,
      candidates: prompt.candidates.map(
        (candidate) =>
          candidate.nodeId === "node-2"
            ? {
                ...candidate,
                protectedBaselineOrder: 1,
              }
            : candidate,
      ),
    };

    expect(() =>
      applyT45MultiAnchorCompletionV1({
        prompt: duplicateOrder,
        modelSelection: modelSelection(
          duplicateOrder,
          [9, 10, 11, 12, 13, 14, 15, 16],
        ),
      }),
    ).toThrow(
      "T45_MULTI_ANCHOR_PROTECTED_ORDER_DRIFT",
    );
    expect(Object.isFrozen(prompt)).toBe(true);
    expect(Object.isFrozen(prompt.candidates))
      .toBe(true);
    expect(Object.isFrozen(prompt.candidates[0]))
      .toBe(true);
    expect(Object.isFrozen(
      prompt.candidates[0]!.obligationRanks,
    )).toBe(true);
    expect(Object.isFrozen(
      prompt.candidates[0]!
        .obligationRanks[0],
    )).toBe(true);
    expect(Object.isFrozen(prompt.messages))
      .toBe(true);
    expect(Object.isFrozen(prompt.messages[0]))
      .toBe(true);
    expect(Object.isFrozen(prompt.obligations))
      .toBe(true);
    expect(Object.isFrozen(prompt.obligations[0]))
      .toBe(true);
  });

  it("excludes unrelated objects and keeps prompt candidate indexes contiguous", () => {
    const { prompt } = buildPrompt(4);

    expect(prompt.candidates.map(
      ({ nodeId }) => nodeId,
    )).not.toContain("node-17");
    expect(prompt.candidates.map(
      ({ candidateIndex }) => candidateIndex,
    )).toEqual(
      prompt.candidates.map(
        (_, index) => index + 1,
      ),
    );
  });

  it("does not inject the retired intent-specific deterministic completion when model-reviewed nodes fill the budget", () => {
    const { prompt } = buildPrompt(4, {
      sourceBaselineCount: 8,
      diagnosticAtEight: true,
    });
    const result =
      applyT45MultiAnchorCompletionV1({
        prompt,
        modelSelection: modelSelection(
          prompt,
          [1, 2, 3, 4, 9, 10, 11, 12],
        ),
      });

    expect(result.completion.deterministicAdded)
      .toEqual([]);
    expect(result.completion.unprotectedDropped)
      .toEqual([]);
    expect(result.testCase.selected.map(
      ({ nodeId }) => nodeId,
    )).toEqual([
      "node-1",
      "node-2",
      "node-3",
      "node-4",
      "node-9",
      "node-10",
      "node-11",
      "node-12",
    ]);
  });

  it("preserves INVALID model output without silently substituting protected nodes and rejects label fields", () => {
    const source = buildPrompt(4);
    const invalid =
      T44ContentRerankerSelectionCaseV1Schema
        .parse({
          caseId: source.prompt.caseId,
          coursePackId:
            source.prompt.coursePackId,
          candidateMapHash:
            source.prompt.candidateMapHash,
          promptHash: source.prompt.promptHash,
          status: "INVALID",
          failureCategory: "MODEL_TIMEOUT",
          selected: [],
          audit: {
            elapsedMs: 30_000,
            rawOutputHash: null,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            },
          },
        });
    const result =
      applyT45MultiAnchorCompletionV1({
        prompt: source.prompt,
        modelSelection: invalid,
      });

    expect(result.testCase.status).toBe("INVALID");
    expect(result.testCase.selected).toEqual([]);
    expect(result.completion).toEqual({
      modelSelectionLedger: [],
      obligationAnchors: [],
      protectedKept: [],
      modelSelectedBaselineKept: [],
      baselineRejected: [],
      modelAdded: [],
      deterministicAdded: [],
      unprotectedDropped: [],
    });
    expect(() =>
      buildT45MultiAnchorPromptV1({
        sourcePrompt: source.sourcePrompt,
        draftCase: source.draftCase,
        baselineProtectedSelection:
          source.baselineProtectedSelection,
        candidateArtifact:
          source.candidateArtifact,
        qrels: {},
      } as never),
    ).toThrow(
      "T44_CONTENT_RERANKER_LABEL_FIELD_FORBIDDEN",
    );
  });
});
