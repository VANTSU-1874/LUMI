import { describe, expect, it } from "vitest";

import {
  T44ContentRerankerSelectionCaseV1Schema,
  buildT44ContentRerankerPromptV1,
  mapT44ContentRerankerModelOutputV1,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import {
  T44_CONTENT_REVIEWER_CONFIG_HASH_V1,
  T44_CONTENT_REVIEWER_CONFIG_V1,
  applyT44ContentReviewerCompletionV1,
  buildT44ContentReviewerPromptV1,
  sealT44ContentReviewerSelectionArtifactV1,
  verifyT44ContentReviewerSelectionSealV1,
} from "@/tools/mixed-retrieval/t44-content-reviewer-v1";

const HASH = "a".repeat(64);

function node(
  index: number,
  objectId: string,
  role: "FACT" | "ACTION" = "FACT",
  text = `${objectId} 的第 ${index} 条原子证据`,
) {
  return {
    nodeId: `node-${index}`,
    objectId,
    coursePackId: "layout-design",
    objectRank: index,
    kind: "TEXT" as const,
    role,
    text,
    nodeContentHash: HASH,
    objectContentHash: HASH,
    sourceHash: HASH,
  };
}

function completionFixture(input: {
  question: string;
  intent: string;
  texts: readonly {
    role?: "FACT" | "ACTION";
    text: string;
  }[];
  selectedIndexes: readonly number[];
}) {
  const candidates = input.texts.map(
    (item, index) =>
      node(
        index + 1,
        "object-primary",
        item.role ?? "FACT",
        item.text,
      ),
  );
  const sourcePrompt = buildT44ContentRerankerPromptV1({
    caseId: "t44-support-layout-p2a",
    coursePackId: "layout-design",
    question: input.question,
    obligations: [{
      obligationId: "obligation-1",
      learnerNeed: input.question,
      intent: input.intent,
    }],
    bCandidateNodes: candidates,
    aCandidateNodes: candidates,
    aBaselineSelectedNodeIds: candidates
      .slice(0, 8)
      .map(({ nodeId }) => nodeId),
    wholeQueryRanking: candidates.map(
      ({ nodeId }, index) => ({
        nodeId,
        rank: index + 1,
      }),
    ),
    obligationRankings: [{
      obligationId: "obligation-1",
      ranking: candidates.map(
        ({ nodeId }, index) => ({
          nodeId,
          rank: index + 1,
        }),
      ),
    }],
  });
  const draftMapped =
    mapT44ContentRerankerModelOutputV1({
      prompt: sourcePrompt,
      rawOutput: JSON.stringify({
        selections: [1, 2, 3, 4, 5, 6, 7, 8].map(
          (candidateIndex) => ({
            candidateIndex,
            obligationIds: ["obligation-1"],
            evidenceRole: "DIRECT",
          }),
        ),
      }),
    });
  const draftCase =
    T44ContentRerankerSelectionCaseV1Schema.parse({
      caseId: sourcePrompt.caseId,
      coursePackId: sourcePrompt.coursePackId,
      candidateMapHash: sourcePrompt.candidateMapHash,
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
  const prompt = buildT44ContentReviewerPromptV1({
    sourcePrompt,
    draftCase,
  });
  const reviewMapped =
    mapT44ContentRerankerModelOutputV1({
      prompt,
      rawOutput: JSON.stringify({
        selections: input.selectedIndexes.map(
          (candidateIndex) => ({
            candidateIndex,
            obligationIds: ["obligation-1"],
            evidenceRole: "DIRECT",
          }),
        ),
      }),
    });
  const reviewCase =
    T44ContentRerankerSelectionCaseV1Schema.parse({
      caseId: prompt.caseId,
      coursePackId: prompt.coursePackId,
      candidateMapHash: prompt.candidateMapHash,
      promptHash: prompt.promptHash,
      status: "VALID",
      failureCategory: null,
      selected: reviewMapped.selected,
      audit: {
        elapsedMs: 200,
        rawOutputHash: reviewMapped.rawOutputHash,
        usage: {
          inputTokens: 20,
          outputTokens: 10,
          totalTokens: 30,
        },
      },
    });
  return { prompt, reviewCase };
}

function fixture() {
  const candidates = [
    node(1, "object-baseline", "ACTION"),
    node(2, "object-baseline"),
    node(3, "object-baseline"),
    node(4, "object-draft", "ACTION"),
    node(5, "object-draft"),
    node(6, "object-draft"),
    node(7, "object-draft"),
    node(8, "object-draft"),
    node(9, "object-unrelated"),
    node(10, "object-unrelated"),
  ];
  const sourcePrompt = buildT44ContentRerankerPromptV1({
    caseId: "t44-support-layout-p2a",
    coursePackId: "layout-design",
    question: "所有东西都对齐了还是没重点，应该先重新分哪几类信息？",
    obligations: [{
      obligationId: "obligation-1",
      learnerNeed: "恢复主次并检查共同对齐路径。",
      intent: "DIAGNOSE_AND_FIX",
    }],
    bCandidateNodes: candidates,
    aCandidateNodes: candidates,
    aBaselineSelectedNodeIds: [
      "node-1",
      "node-2",
    ],
    wholeQueryRanking: candidates.map(
      ({ nodeId }, index) => ({
        nodeId,
        rank: index + 1,
      }),
    ),
    obligationRankings: [{
      obligationId: "obligation-1",
      ranking: candidates.map(
        ({ nodeId }, index) => ({
          nodeId,
          rank: index + 1,
        }),
      ),
    }],
  });
  const mapped = mapT44ContentRerankerModelOutputV1({
    prompt: sourcePrompt,
    rawOutput: JSON.stringify({
      selections: [1, 4, 5, 6, 7, 8, 2, 3].map(
        (candidateIndex) => ({
          candidateIndex,
          obligationIds: ["obligation-1"],
          evidenceRole: "DIRECT",
        }),
      ),
    }),
  });
  const draftCase =
    T44ContentRerankerSelectionCaseV1Schema.parse({
      caseId: sourcePrompt.caseId,
      coursePackId: sourcePrompt.coursePackId,
      candidateMapHash: sourcePrompt.candidateMapHash,
      promptHash: sourcePrompt.promptHash,
      status: "VALID",
      failureCategory: null,
      selected: mapped.selected,
      audit: {
        elapsedMs: 100,
        rawOutputHash: mapped.rawOutputHash,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
      },
    });
  return { sourcePrompt, draftCase };
}

describe("T4.4 object-local content reviewer v1", () => {
  it("reviews only draft or A-baseline objects and freezes an eight-node final budget", () => {
    const { sourcePrompt, draftCase } = fixture();
    const prompt = buildT44ContentReviewerPromptV1({
      sourcePrompt,
      draftCase,
    });

    expect(prompt.candidates).toHaveLength(8);
    expect(new Set(prompt.candidates.map(
      ({ objectId }) => objectId,
    ))).toEqual(new Set([
      "object-baseline",
      "object-draft",
    ]));
    expect(prompt.messages[1]?.content).toContain(
      "必须恰好选择 8 条",
    );
    expect(prompt.messages[1]?.content).toContain("d=");
    expect(prompt.selectionBudget).toBe(8);
    expect(prompt.reviewSourceHash).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(T44_CONTENT_REVIEWER_CONFIG_V1)
      .toMatchObject({
        topK: 8,
        graphifyPolicy: "NOT_USED",
      });
    expect(T44_CONTENT_REVIEWER_CONFIG_HASH_V1)
      .toBe(
        "4936648c8efb8444dcced7428c06eceaac05196856b48f1c28ca0a5841e3fa11",
      );
    expect(
      T44_CONTENT_REVIEWER_CONFIG_V1
        .baselinePolicy,
    ).toBe(
      "PRESERVE_A_BASELINE_RANK_1_AFTER_MODEL_REVIEW",
    );
  });

  it("maps exactly eight final indexes and fails closed on an undersized review", () => {
    const { sourcePrompt, draftCase } = fixture();
    const prompt = buildT44ContentReviewerPromptV1({
      sourcePrompt,
      draftCase,
    });
    const valid = mapT44ContentRerankerModelOutputV1({
      prompt,
      rawOutput: JSON.stringify({
        selections: [1, 2, 3, 4, 5, 6, 7, 8].map(
          (candidateIndex) => ({
            candidateIndex,
            obligationIds: ["obligation-1"],
            evidenceRole: "DIRECT",
          }),
        ),
      }),
    });

    expect(valid.selected).toHaveLength(8);
    expect(() =>
      mapT44ContentRerankerModelOutputV1({
        prompt,
        rawOutput: JSON.stringify({
          selections: [1, 2, 3, 4, 5, 6, 7].map(
            (candidateIndex) => ({
              candidateIndex,
              obligationIds: ["obligation-1"],
              evidenceRole: "DIRECT",
            }),
          ),
        }),
      }),
    ).toThrow(
      "T44_CONTENT_RERANKER_SELECTION_BUDGET_INVALID",
    );
  });

  it("rejects a draft whose source prompt bindings drift", () => {
    const { sourcePrompt, draftCase } = fixture();

    expect(() =>
      buildT44ContentReviewerPromptV1({
        sourcePrompt,
        draftCase: {
          ...draftCase,
          promptHash: "b".repeat(64),
        },
      }),
    ).toThrow(
      "T44_CONTENT_REVIEWER_DRAFT_BINDING_DRIFT",
    );
  });

  it("protects the strongest whole-question anchor, adds a decomposition diagnostic, and evicts the worst unprotected whole-query match", () => {
    const { prompt, reviewCase } =
      completionFixture({
        question:
          "这个字标感觉太冷，怎么判断是字形问题还是受众不合适？",
        intent: "DIAGNOSE_CAUSE",
        texts: [
          {
            role: "ACTION",
            text:
              "先对照学生原问题保留最直接的整句证据。",
          },
          { text: "第二条互补证据。" },
          { text: "第三条互补证据。" },
          { text: "第四条互补证据。" },
          { text: "第五条互补证据。" },
          { text: "第六条互补证据。" },
          { text: "第七条互补证据。" },
          { text: "第八条互补证据。" },
          {
            text:
              "用模糊形容词直接定案：应拆成字形变量和接触点任务。",
          },
          { text: "与原问题最远的背景说明。" },
        ],
        selectedIndexes: [2, 3, 4, 5, 6, 7, 8, 10],
      });

    const result =
      applyT44ContentReviewerCompletionV1({
        prompt,
        reviewCase,
      });

    expect(result.testCase.selected.map(
      ({ candidateIndex }) => candidateIndex,
    )).toEqual([2, 3, 4, 5, 6, 7, 1, 9]);
    expect(result.completion.added).toEqual([
      {
        candidateIndex: 1,
        reason: "BASELINE_RANK_1",
      },
      {
        candidateIndex: 9,
        reason: "DIAGNOSTIC_DECOMPOSITION",
      },
    ]);
    expect(result.completion.dropped.map(
      ({ candidateIndex }) => candidateIndex,
    )).toEqual([10, 8]);
  });

  it("adds a contrastive evidence probe and a decision-context criterion for their matching intents", () => {
    const shared = [
      { role: "ACTION" as const, text: "第一条直接证据。" },
      { text: "第二条证据。" },
      { text: "第三条证据。" },
      { text: "第四条证据。" },
      { text: "第五条证据。" },
      { text: "第六条证据。" },
      { text: "第七条证据。" },
      { text: "第八条证据。" },
    ];
    const criteria =
      completionFixture({
        question:
          "留白很多不一定高级，应该回到什么阅读任务判断？",
        intent: "CHECK_CRITERIA",
        texts: [
          ...shared,
          {
            role: "ACTION",
            text:
              "是文字太多，还是信息组没有停顿？请截一张隐藏装饰后的版本。",
          },
        ],
        selectedIndexes: [1, 2, 3, 4, 5, 6, 7, 8],
      });
    const tradeoff =
      completionFixture({
        question:
          "两种版式都能用网格时，选择依据应该落在哪？",
        intent: "COMPARE_TRADEOFF",
        texts: [
          ...shared,
          {
            text:
              "气质判断的证据来自目标受众和传播场景。",
          },
        ],
        selectedIndexes: [1, 2, 3, 4, 5, 6, 7, 8],
      });

    expect(
      applyT44ContentReviewerCompletionV1(criteria)
        .completion.added,
    ).toEqual([{
      candidateIndex: 9,
      reason: "CONTRASTIVE_EVIDENCE_PROBE",
    }]);
    expect(
      applyT44ContentReviewerCompletionV1(tradeoff)
        .completion.added,
    ).toEqual([{
      candidateIndex: 9,
      reason: "DECISION_CONTEXT_CRITERION",
    }]);
  });

  it("adds a factual anchor for an explicit coordinated question facet and rejects label-bearing inputs", () => {
    const fixture = completionFixture({
      question:
        "先分主要和次要信息后，怎样用栏位、间距和留白把阅读路线做出来？",
      intent: "EXPLAIN_CONCEPT",
      texts: [
        {
          role: "ACTION",
          text: "先用栏位建立共同对齐路径。",
        },
        { text: "组内间距和组间间距应有差异。" },
        { text: "第三条证据。" },
        { text: "第四条证据。" },
        { text: "第五条证据。" },
        { text: "第六条证据。" },
        { text: "第七条证据。" },
        { text: "第八条证据。" },
        {
          text:
            "留白应帮助标题与正文形成边界，而不只是空白。",
        },
      ],
      selectedIndexes: [1, 2, 3, 4, 5, 6, 7, 8],
    });

    expect(
      applyT44ContentReviewerCompletionV1(fixture)
        .completion.added,
    ).toEqual([{
      candidateIndex: 9,
      reason: "EXPLICIT_FACET_FACT",
    }]);
    expect(() =>
      applyT44ContentReviewerCompletionV1({
        ...fixture,
        qrels: {},
      } as never),
    ).toThrow(
      "T44_CONTENT_RERANKER_LABEL_FIELD_FORBIDDEN",
    );
  });

  it("seals the draft source and all upstream inputs into the reviewer artifact", () => {
    const { sourcePrompt, draftCase } = fixture();
    const prompt = buildT44ContentReviewerPromptV1({
      sourcePrompt,
      draftCase,
    });
    const mapped = mapT44ContentRerankerModelOutputV1({
      prompt,
      rawOutput: JSON.stringify({
        selections: [1, 2, 3, 4, 5, 6, 7, 8].map(
          (candidateIndex) => ({
            candidateIndex,
            obligationIds: ["obligation-1"],
            evidenceRole: "DIRECT",
          }),
        ),
      }),
    });
    const testCase =
      T44ContentRerankerSelectionCaseV1Schema.parse({
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
    const inputs = {
      plannerSha256: HASH,
      candidateSha256: HASH,
      matrixSha256: HASH,
      legacySelectionSha256: HASH,
      draftSelectionSha256: HASH,
    };
    const seal =
      sealT44ContentReviewerSelectionArtifactV1({
        schemaVersion: 1,
        kind: "T44_CONTENT_REVIEWER_SELECTIONS",
        artifactId: "pilot-v4",
        scope: "PILOT",
        runtimeSuite: {
          id: "t44-support-dev-runtime-v1",
          version: "1.0.0",
          suiteHash: HASH,
        },
        inputs,
        draft: {
          artifactId: "pilot-v3",
          configHash: HASH,
        },
        config: T44_CONTENT_REVIEWER_CONFIG_V1,
        configHash:
          T44_CONTENT_REVIEWER_CONFIG_HASH_V1,
        model: {
          source: "service-env",
          modelId: "GPT-5.6 Luna",
          endpointHash: HASH,
        },
        graphifyInvocationCount: 0,
        cases: [testCase],
        summary: {
          total: 1,
          valid: 1,
          invalid: 0,
        },
        generatedAt: "2026-07-29T00:00:00.000Z",
        operations: {
          graphify: "NOT_USED",
          database: "NOT_USED",
          web: "NOT_USED",
          deployment: "NOT_PERFORMED",
        },
      });

    expect(
      verifyT44ContentReviewerSelectionSealV1({
        seal,
        expectedInputs: inputs,
      }).artifactId,
    ).toBe("pilot-v4");
    expect(() =>
      verifyT44ContentReviewerSelectionSealV1({
        seal,
        expectedInputs: {
          ...inputs,
          draftSelectionSha256: "b".repeat(64),
        },
      }),
    ).toThrow(
      "T44_CONTENT_REVIEWER_DRAFT_SELECTION_BINDING_DRIFT",
    );
  });
});
