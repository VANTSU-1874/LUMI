// @vitest-environment node

import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  materializeLegacyKnowledgeCorpusV2,
} from "../../helpers/knowledge-v2-generation-fixtures";

import {
  classifyT45LegacyAuditDecisionV1,
  parseT45MultiAnchorAuditArguments,
  runT45MultiAnchorAuditCli,
  T45LegacyEvaluationV1Schema,
} from "@/scripts/audit-t45-multi-anchor-reviewer-v1";
import {
  loadT45ReviewerSourceBundleV1,
  parseT45MultiAnchorReviewerArguments,
  T45ContentDraftArtifactV1Schema,
  T45FinalSelectionArtifactV1Schema,
} from "@/scripts/run-t45-multi-anchor-reviewer-v1";
import {
  buildT44ContentRerankerPromptV1,
  mapT44ContentRerankerModelOutputV1,
  T44_CONTENT_RERANKER_CONFIG_HASH_V1,
  T44ContentRerankerSelectionCaseV1Schema,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import {
  T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
  T44_OBLIGATION_CANDIDATE_CONFIG_V1,
  T44ObligationCandidateArtifactV1Schema,
} from "@/tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2,
  T44ObligationSelectionArtifactV1Schema,
} from "@/tools/mixed-retrieval/t44-obligation-label-blind-v2";
import {
  T45_CAPABILITY_DENOMINATORS_V1,
  T45_CAPABILITY_EVALUATOR_CONFIG_HASH_V1,
  T45SelectionReportSchema,
} from "@/tools/mixed-retrieval/t45-capability-evaluator";
import {
  applyT45MultiAnchorCompletionV1,
  buildT45MultiAnchorPromptV1,
  T45_MULTI_ANCHOR_REVIEWER_CONFIG_HASH_V1,
} from "@/tools/mixed-retrieval/t45-multi-anchor-reviewer-v1";
import {
  createT45LegacyDefaultFixture,
} from "@/tests/unit/scripts/t45-legacy-default-fixture";
import {
  validateT45FinalArtifactV1,
} from "@/tools/mixed-retrieval/t45-final-artifact-validator-v1";
import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  sealT45AuditReceiptV1,
} from "@/tools/mixed-retrieval/t45-audit-receipt-v1";

const H = "a".repeat(64);
const H2 = "b".repeat(64);
const roots: string[] = [];
const captureSourceClosure = () => ({
  sourceFiles: [
    { path: "sealed-source.ts", sha256: H },
  ],
  sourceClosureHash: H,
});

function noGoEvaluation() {
  const minimum = (required: number) => ({
    observed: 0,
    required,
    passed: false,
  });
  const maximum = (
    observed: number,
    requiredMaximum: number,
  ) => ({
    observed,
    requiredMaximum,
    passed: observed <= requiredMaximum,
  });
  return {
    schemaVersion: 1,
    kind: "T45_CAPABILITY_SELECTION_REPORT",
    split: "CALIBRATION",
    configHash:
      T45_CAPABILITY_EVALUATOR_CONFIG_HASH_V1,
    denominators:
      T45_CAPABILITY_DENOMINATORS_V1,
    summary: {
      supportCases: 0,
      requiredGroupsCovered: 0,
      multiJointCoverage: 0,
      familiesWithBothCasesSupported: 0,
      hardNegativeNodes: 0,
      hardNegativeCases: 0,
      aBaselineHardNegativeNodes: 0,
      aBaselineHardNegativeCases: 0,
      validSelections: 0,
      bindingViolations: 1,
      reviewerP95Ms: 31_000,
    },
    gates: {
      supportCases: minimum(18),
      requiredGroupsCovered: minimum(28),
      multiJointCoverage: minimum(9),
      familiesWithBothCasesSupported: minimum(9),
      hardNegativeNodes: maximum(0, 0),
      hardNegativeCases: maximum(0, 0),
      validSelections: minimum(20),
      bindingViolations: maximum(1, 0),
      reviewerP95Ms: maximum(31_000, 30_000),
    },
    cases: Array.from(
      { length: 20 },
      (_, index) => ({
        caseId: `case-${index + 1}`,
        familyId:
          `family-${Math.floor(index / 2) + 1}`,
        multiClaim: index < 10,
        status: "INVALID",
        selectedNodeIds: [],
        groups: Array.from(
          { length: index < 10 ? 2 : 1 },
          (_, groupIndex) => ({
            groupId:
              `group-${index + 1}-${groupIndex + 1}`,
            covered: false,
            matchedNodeIds: [],
          }),
        ),
        covered: false,
        hardNegativeNodeIds: [],
        bindingViolations:
          index === 0 ? ["binding-drift-1"] : [],
      }),
    ),
    families: Array.from(
      { length: 10 },
      (_, index) => ({
        familyId: `family-${index + 1}`,
        casesSupported: 0,
        casesTotal: 2,
        bothCasesSupported: false,
      }),
    ),
    passed: false,
    decision: "CALIBRATION_NO_GO",
  } as const;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "t45-audit-"),
  );
  roots.push(root);
  const artifactRoot = path.join(
    root,
    ".runtime/mixed-retrieval",
  );
  await mkdir(artifactRoot, { recursive: true });
  const inputs = {
    boundarySha256: H,
    plannerSha256: H,
    candidateSha256: H,
    matrixSha256: H,
    baselineSelectionSha256: H,
    oracleGateSha256: H,
  };
  const runtimeSuite = {
    id: "runtime-suite",
    version: "1",
    suiteHash: H,
    split: "CALIBRATION" as const,
  };
  const model = {
    source: "service-env" as const,
    modelId: "GPT-5.6 Luna",
    endpointHash: H,
    configHash: H,
  };
  const usage = {
    inputTokens: 2,
    outputTokens: 1,
    totalTokens: 3,
  };
  const nodes = [1, 2].map(
    (candidateIndex) => ({
      nodeId: `audit-node-${candidateIndex}`,
      objectId: `audit-object-${candidateIndex}`,
      coursePackId: "layout-design",
      objectRank: candidateIndex,
      kind: "TEXT" as const,
      role: candidateIndex === 1
        ? "FACT" as const
        : "ACTION" as const,
      text: `审计候选证据 ${candidateIndex}`,
      nodeContentHash: H,
      objectContentHash: H,
      sourceHash: H,
    }),
  );
  const sourcePrompt =
    buildT44ContentRerankerPromptV1({
      caseId: "case-1",
      coursePackId: "layout-design",
      question: "这个版式应该怎么改？",
      obligations: [{
        obligationId: "obligation-1",
        learnerNeed: "给出诊断和修改动作。",
        intent: "DIAGNOSE_AND_FIX",
      }],
      bCandidateNodes: nodes,
      aCandidateNodes: nodes,
      aBaselineSelectedNodeIds: [
        nodes[0]!.nodeId,
      ],
      wholeQueryRanking: nodes.map(
        ({ nodeId }, index) => ({
          nodeId,
          rank: index + 1,
        }),
      ),
      obligationRankings: [{
        obligationId: "obligation-1",
        ranking: nodes.map(
          ({ nodeId }, index) => ({
            nodeId,
            rank: index + 1,
          }),
        ),
      }],
    });
  const arm = {
    directEvidenceBatchHash: H,
    rrfResultHash: H,
    objectRanking: nodes.map(
      ({ objectId }, index) => ({
        objectId,
        fusedRank: index + 1,
        fusionScore: 1 / (index + 1),
        bestRawRank: index + 1,
        obligationIds: ["obligation-1"],
        origins: ["LEXICAL" as const],
      }),
    ),
    candidateNodes: nodes,
    candidateNodeIdsSha256:
      sha256StableJsonV2(
        nodes.map(({ nodeId }) => nodeId),
      ),
  };
  const candidate =
    T44ObligationCandidateArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T44_OBLIGATION_CANDIDATES",
      runtimeSuite: {
        id: runtimeSuite.id,
        version: runtimeSuite.version,
        suiteHash: runtimeSuite.suiteHash,
      },
      corpusSnapshot: { bundleHash: H },
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
        caseId: "case-1",
        coursePackId: "layout-design",
        coursePackVersion: "1",
        normalizedQuestionHash: H,
        obligationSetHash: H,
        retrievalPlanHash: H,
        arms: {
          A_WHOLE_QUERY: arm,
          B_MODEL_GUIDED: arm,
        },
      }],
    });
  const baselineSelection =
    T44ObligationSelectionArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T44_OBLIGATION_SELECTIONS",
      candidateArtifactSha256: H,
      matrixOutputSha256: H,
      selectorConfigId:
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2.id,
      selectorConfigVersion:
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2
          .version,
      selectorConfigHash:
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
      graphifyInvocationCount: 0,
      cases: [{
        caseId: "case-1",
        coursePackId: "layout-design",
        candidateNodeIdsSha256:
          sha256StableJsonV2({
            A_WHOLE_QUERY:
              arm.candidateNodeIdsSha256,
            B_MODEL_GUIDED:
              arm.candidateNodeIdsSha256,
          }),
        arms: {
          A_WHOLE_QUERY: {
            selected: [{
              nodeId: nodes[0]!.nodeId,
              objectId: nodes[0]!.objectId,
              coursePackId: "layout-design",
              selectionSource:
                "WHOLE_QUERY_BASELINE",
              obligationId: null,
              aggregateRrfScore: 1 / 61,
            }],
          },
          B_MODEL_GUIDED: {
            selected: [{
              nodeId: nodes[0]!.nodeId,
              objectId: nodes[0]!.objectId,
              coursePackId: "layout-design",
              selectionSource:
                "WHOLE_QUERY_BASELINE",
              obligationId: null,
              aggregateRrfScore: 1 / 61,
            }],
          },
        },
      }],
    });
  const mappedDraft =
    mapT44ContentRerankerModelOutputV1({
      prompt: sourcePrompt,
      rawOutput: JSON.stringify({
        selections: [1, 2].map(
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
      caseId: "case-1",
      coursePackId: "layout-design",
      candidateMapHash:
        sourcePrompt.candidateMapHash,
      promptHash: sourcePrompt.promptHash,
      status: "VALID",
      failureCategory: null,
      selected: mappedDraft.selected,
      audit: {
        elapsedMs: 1,
        rawOutputHash:
          mappedDraft.rawOutputHash,
        usage,
      },
    });
  const reviewerPrompt =
    buildT45MultiAnchorPromptV1({
      sourcePrompt,
      draftCase,
      baselineProtectedSelection:
        baselineSelection,
      candidateArtifact: candidate,
    });
  const mappedReviewer =
    mapT44ContentRerankerModelOutputV1({
      prompt: reviewerPrompt,
      rawOutput: JSON.stringify({
        selections: [1, 2].map(
          (candidateIndex) => ({
            candidateIndex,
            obligationIds: ["obligation-1"],
            evidenceRole: "DIRECT",
          }),
        ),
      }),
    });
  const reviewerCase =
    T44ContentRerankerSelectionCaseV1Schema.parse({
      caseId: "case-1",
      coursePackId: "layout-design",
      candidateMapHash:
        reviewerPrompt.candidateMapHash,
      promptHash: reviewerPrompt.promptHash,
      status: "VALID",
      failureCategory: null,
      selected: mappedReviewer.selected,
      audit: {
        elapsedMs: 1,
        rawOutputHash:
          mappedReviewer.rawOutputHash,
        usage,
      },
    });
  const completed =
    applyT45MultiAnchorCompletionV1({
      prompt: reviewerPrompt,
      modelSelection: reviewerCase,
    });
  const finalCase = {
    ...completed.testCase,
    audit: {
      ...completed.testCase.audit,
      elapsedMs: 2,
      usage: {
        inputTokens: 4,
        outputTokens: 2,
        totalTokens: 6,
      },
    },
    stageAudit: {
      draft: { elapsedMs: 1, usage },
      reviewer: { elapsedMs: 1, usage },
      endToEnd: {
        elapsedMs: 2,
        usage: {
          inputTokens: 4,
          outputTokens: 2,
          totalTokens: 6,
        },
      },
    },
    completion: completed.completion,
    bindingViolations: [],
  };
  const draft = {
    schemaVersion: 1,
    kind: "T45_CONTENT_DRAFT_SELECTIONS",
    runId: "calibration-v1",
    artifactId: "calibration-v1",
    runtimeSuite,
    inventoryHash: H,
    sourceClosureHash: H,
    inputs,
    configHash:
      T44_CONTENT_RERANKER_CONFIG_HASH_V1,
    model,
    cases: [draftCase],
    summary: { total: 1, valid: 1, invalid: 0 },
    generatedAt: "2026-07-29T00:00:00.000Z",
  };
  const draftSerialized =
    `${JSON.stringify(draft, null, 2)}\n`;
  const draftPath = path.join(
    artifactRoot,
    "t45-capability-calibration-v1.content-draft-calibration-v1.selection.json",
  );
  await writeFile(
    draftPath,
    draftSerialized,
    "utf8",
  );
  const draftSha = createHash("sha256")
    .update(draftSerialized)
    .digest("hex");
  const selection = {
    schemaVersion: 1,
    kind: "T45_MULTI_ANCHOR_SELECTIONS",
    runId: "calibration-v1",
    artifactId: "calibration-v1",
    runtimeSuite,
    inventoryHash: H,
    sourceClosureHash: H,
    inputs: {
      ...inputs,
      draftSelectionSha256: draftSha,
    },
    configHash:
      T45_MULTI_ANCHOR_REVIEWER_CONFIG_HASH_V1,
    model,
    cases: [finalCase],
    summary: {
      total: 1,
      valid: 1,
      invalid: 0,
    },
    generatedAt: "2026-07-29T00:00:00.000Z",
  };
  const selectionPath = path.join(
    artifactRoot,
    "t45-capability-calibration-v1.multi-anchor-calibration-v1.selection.json",
  );
  await writeFile(
    selectionPath,
    `${JSON.stringify(selection, null, 2)}\n`,
    "utf8",
  );
  const source = {
    runtimeSuite,
    inventoryHash: H,
    corpusBundleHash: H,
    inputs,
    prompts: [sourcePrompt],
    candidate,
    baselineSelection,
    gate: null,
  };
  return {
    root,
    source,
    draftPath,
    selectionPath,
  };
}

async function frozenAuditFixture(
  split: "CALIBRATION" | "VALIDATION",
) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "t45-audit-frozen-"),
  );
  roots.push(root);
  const stem = split === "CALIBRATION"
    ? "calibration"
    : "validation";
  const sourceRoot = process.cwd();
  const copies = [
    "tests/retrieval-quality/t45-capability-inventory.json",
    `tests/retrieval-quality/t45-capability-${stem}.runtime.json`,
    `tests/retrieval-quality/t45-capability-${stem}.qrels.json`,
  ];
  await Promise.all(copies.map(async (relative) => {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), {
      recursive: true,
    });
    await copyFile(
      path.join(sourceRoot, relative),
      target,
    );
  }));
  await mkdir(path.join(root, "data/knowledge-v2"), {
    recursive: true,
  });
  await materializeLegacyKnowledgeCorpusV2(
    path.join(root, "data/knowledge-v2/knowledge-corpus.v2.json"),
    sourceRoot,
  );
  const [corpus, inventory, runtime, qrels] =
    await Promise.all([
      readFile(
        path.join(
          root,
          "data/knowledge-v2/knowledge-corpus.v2.json",
        ),
        "utf8",
      ).then((value) => JSON.parse(value) as {
        bundleHash: string;
        objects: Array<{
          id: string;
          sourceCoursePack: { id: string };
          nodes: Array<Record<string, unknown> & {
            id: string;
            kind: string;
            contentHash: string;
          }>;
        }>;
      }),
      readFile(
        path.join(
          root,
          "tests/retrieval-quality/t45-capability-inventory.json",
        ),
        "utf8",
      ).then((value) => JSON.parse(value) as {
        inventoryHash: string;
      }),
      readFile(
        path.join(
          root,
          `tests/retrieval-quality/t45-capability-${stem}.runtime.json`,
        ),
        "utf8",
      ).then((value) => JSON.parse(value) as {
        id: string;
        version: string;
        suiteHash: string;
        cases: Array<{
          caseId: string;
          coursePackId: string;
        }>;
      }),
      readFile(
        path.join(
          root,
          `tests/retrieval-quality/t45-capability-${stem}.qrels.json`,
        ),
        "utf8",
      ).then((value) => JSON.parse(value) as {
        cases: Array<{
          caseId: string;
          requiredEvidenceGroups: Array<{
            acceptableNodeIds: string[];
          }>;
        }>;
      }),
    ]);
  const nodeById = new Map(
    corpus.objects.flatMap((object) =>
      object.nodes.map((node) => [
        node.id,
        { object, node },
      ] as const)),
  );
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  const draftCases = runtime.cases.map(
    (runtimeCase, caseIndex) => {
      const qrel = qrels.cases[caseIndex]!;
      const ids = [...new Set(
        qrel.requiredEvidenceGroups.map(
          (group) =>
            group.acceptableNodeIds[0]!,
        ),
      )];
      const selected = ids.map(
        (nodeId, nodeIndex) => {
          const binding = nodeById.get(nodeId)!;
          const text = binding.node.kind === "TEXT"
            ? String(binding.node.text)
            : JSON.stringify(binding.node);
          return {
            candidateIndex: nodeIndex + 1,
            nodeId,
            objectId: binding.object.id,
            coursePackId:
              binding.object.sourceCoursePack.id,
            role: binding.node.kind === "TABLE"
              ? "TABLE"
              : binding.node.role,
            text,
            nodeContentHash:
              binding.node.contentHash,
            baselineRank: null,
            wholeQueryRank: nodeIndex + 1,
            obligationRanks: [],
            obligationIds: ["obligation-1"],
            evidenceRole: "DIRECT",
          };
        },
      );
      return {
        caseId: runtimeCase.caseId,
        coursePackId:
          runtimeCase.coursePackId,
        candidateMapHash: H,
        promptHash: H,
        status: "VALID",
        failureCategory: null,
        selected,
        audit: {
          elapsedMs: 1,
          rawOutputHash: H,
          usage,
        },
      };
    },
  );
  const runtimeSuite = {
    id: runtime.id,
    version: runtime.version,
    suiteHash: runtime.suiteHash,
    split,
  };
  const model = {
    source: "service-env",
    modelId: "GPT-5.6 Luna",
    endpointHash: H,
    configHash: H,
  };
  const inputs = {
    boundarySha256: H,
    plannerSha256: H,
    candidateSha256: H,
    matrixSha256: H,
    baselineSelectionSha256: H,
    oracleGateSha256: H,
  };
  const runId = split === "CALIBRATION"
    ? "calibration-v88"
    : "validation-v1";
  const artifactId = runId;
  const artifactRoot = path.join(
    root,
    ".runtime/mixed-retrieval",
  );
  const draft = {
    schemaVersion: 1,
    kind: "T45_CONTENT_DRAFT_SELECTIONS",
    runId,
    artifactId,
    runtimeSuite,
    inventoryHash: inventory.inventoryHash,
    sourceClosureHash: H,
    inputs,
    configHash:
      T44_CONTENT_RERANKER_CONFIG_HASH_V1,
    model,
    cases: draftCases,
    summary: { total: 20, valid: 20, invalid: 0 },
    generatedAt: "2026-07-29T00:00:00.000Z",
  };
  const draftSerialized =
    `${JSON.stringify(draft, null, 2)}\n`;
  const draftPath = path.join(
    artifactRoot,
    `t45-capability-${runId}.content-draft-${artifactId}.selection.json`,
  );
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(draftPath, draftSerialized, "utf8");
  const draftSha = createHash("sha256")
    .update(draftSerialized)
    .digest("hex");
  const selection = {
    schemaVersion: 1,
    kind: "T45_MULTI_ANCHOR_SELECTIONS",
    runId,
    artifactId,
    runtimeSuite,
    inventoryHash: inventory.inventoryHash,
    sourceClosureHash: H,
    inputs: {
      ...inputs,
      draftSelectionSha256: draftSha,
    },
    configHash:
      T45_MULTI_ANCHOR_REVIEWER_CONFIG_HASH_V1,
    model,
    cases: draftCases.map((draftCase) => ({
      ...draftCase,
      selected: draftCase.selected.map(
        (node) => ({
          ...node,
          protectedBaseline: false,
          protectedBaselineOrder: null,
        }),
      ),
      stageAudit: {
        draft: { elapsedMs: 1, usage },
        reviewer: { elapsedMs: 1, usage },
        endToEnd: { elapsedMs: 2, usage },
      },
      completion: {
        modelSelectionLedger:
          draftCase.selected.map(
            ({
              nodeId,
              obligationIds,
              evidenceRole,
            }) => ({
              nodeId,
              obligationIds,
              evidenceRole,
            }),
          ),
        obligationAnchors: [],
        protectedKept: [],
        modelSelectedBaselineKept: [],
        baselineRejected: [],
        modelAdded: draftCase.selected.map(
          ({ nodeId }) => nodeId,
        ),
        deterministicAdded: [],
        unprotectedDropped: [],
      },
      bindingViolations: [],
    })),
    summary: { total: 20, valid: 20, invalid: 0 },
    generatedAt: draft.generatedAt,
  };
  const selectionPath = path.join(
    artifactRoot,
    `t45-capability-${runId}.multi-anchor-${artifactId}.selection.json`,
  );
  await writeFile(
    selectionPath,
    `${JSON.stringify(selection, null, 2)}\n`,
    "utf8",
  );
  const source = {
    runtimeSuite,
    inventoryHash: inventory.inventoryHash,
    corpusBundleHash: corpus.bundleHash,
    inputs,
    prompts: [],
    candidate: {},
    baselineSelection: {
      cases: runtime.cases.map((testCase) => ({
        caseId: testCase.caseId,
        coursePackId: testCase.coursePackId,
        arms: {
          A_WHOLE_QUERY: { selected: [] },
        },
      })),
    },
    gate: null,
  };
  return {
    root,
    source,
    runId,
    artifactId,
    qrelsPath: path.join(
      root,
      `tests/retrieval-quality/t45-capability-${stem}.qrels.json`,
    ),
    model,
  };
}

async function legacyDefaultAuditFixture() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "t45-audit-legacy-"),
  );
  roots.push(root);
  const prerequisite =
    await createT45LegacyDefaultFixture(root);
  const parsed =
    parseT45MultiAnchorReviewerArguments([
      "--split", "legacy-regression",
      "--run-id", "legacy-v2",
      "--artifact-id", "legacy-regression-v1",
    ]);
  const source =
    await loadT45ReviewerSourceBundleV1(
      parsed,
      root,
      prerequisite.freeze as never,
      {
        loadValidationSource: async () =>
          prerequisite.validationSource as never,
        captureSourceClosure:
          prerequisite.captureSourceClosure,
      },
    );
  const prior = JSON.parse(
    await readFile(
      path.join(
        prerequisite.artifactRoot,
        "t44-obligation-legacy-v2.content-reviewer-full-v2.selection.json",
      ),
      "utf8",
    ),
  ) as {
    cases: Array<{
      caseId: string;
      coursePackId: string;
      candidateMapHash: string;
      promptHash: string;
      status: "VALID" | "INVALID";
      failureCategory: string | null;
      selected: Array<Record<string, unknown> & {
        nodeId: string;
      }>;
      audit: {
        elapsedMs: number;
        rawOutputHash: string | null;
        usage: {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        };
      };
    }>;
    summary: {
      total: number;
      valid: number;
      invalid: number;
    };
    generatedAt: string;
  };
  const draft =
    T45ContentDraftArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T45_CONTENT_DRAFT_SELECTIONS",
      runId: "legacy-v2",
      artifactId: "legacy-regression-v1",
      runtimeSuite: source.runtimeSuite,
      inventoryHash: source.inventoryHash,
      sourceClosureHash: H,
      inputs: source.inputs,
      configHash:
        T44_CONTENT_RERANKER_CONFIG_HASH_V1,
      model: prerequisite.model,
      cases: prior.cases,
      summary: prior.summary,
      generatedAt: prior.generatedAt,
    });
  const draftSerialized =
    `${JSON.stringify(draft, null, 2)}\n`;
  const draftPath = path.join(
    prerequisite.artifactRoot,
    "t45-capability-legacy-v2.content-draft-legacy-regression-v1.selection.json",
  );
  await writeFile(
    draftPath,
    draftSerialized,
    "utf8",
  );
  const draftSha = createHash("sha256")
    .update(draftSerialized)
    .digest("hex");
  const baselineByCase = new Map(
    source.baselineSelection.cases.map(
      (testCase) => [
        testCase.caseId,
        new Map(
          testCase.arms.A_WHOLE_QUERY.selected.map(
            ({ nodeId }, index) => [
              nodeId,
              index + 1,
            ],
          ),
        ),
      ],
    ),
  );
  const finalSelection =
    T45FinalSelectionArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T45_MULTI_ANCHOR_SELECTIONS",
      runId: "legacy-v2",
      artifactId: "legacy-regression-v1",
      runtimeSuite: source.runtimeSuite,
      inventoryHash: source.inventoryHash,
      sourceClosureHash: H,
      inputs: {
        ...source.inputs,
        draftSelectionSha256: draftSha,
      },
      configHash:
        T45_MULTI_ANCHOR_REVIEWER_CONFIG_HASH_V1,
      model: prerequisite.model,
      cases: prior.cases.map((testCase) => {
        const baseline =
          baselineByCase.get(testCase.caseId)!;
        return {
          ...testCase,
          selected: testCase.selected.map(
            (node) => {
              const protectedOrder =
                baseline.get(node.nodeId) ?? null;
              return {
                ...node,
                protectedBaseline:
                  protectedOrder !== null,
                protectedBaselineOrder:
                  protectedOrder,
              };
            },
          ),
          stageAudit: {
            draft: {
              elapsedMs: testCase.audit.elapsedMs,
              usage: testCase.audit.usage,
            },
            reviewer: {
              elapsedMs: 0,
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
              },
            },
            endToEnd: {
              elapsedMs: testCase.audit.elapsedMs,
              usage: testCase.audit.usage,
            },
          },
          completion: {
            modelSelectionLedger: [],
            obligationAnchors: [],
            protectedKept: [],
            modelSelectedBaselineKept: [],
            baselineRejected: [],
            modelAdded: [],
            deterministicAdded: [],
            unprotectedDropped: [],
          },
          bindingViolations: [],
        };
      }),
      summary: prior.summary,
      generatedAt: prior.generatedAt,
    });
  await writeFile(
    path.join(
      prerequisite.artifactRoot,
      "t45-capability-legacy-v2.multi-anchor-legacy-regression-v1.selection.json",
    ),
    `${JSON.stringify(
      finalSelection,
      null,
      2,
    )}\n`,
    "utf8",
  );
  return {
    ...prerequisite,
    legacySource: source,
  };
}

describe("T45 multi-anchor audit CLI", () => {
  it("uses the same frozen calibration, validation and legacy identities", () => {
    expect(
      parseT45MultiAnchorAuditArguments([
        "--split", "calibration",
        "--run-id", "calibration-v7",
        "--artifact-id", "calibration-v7",
      ]),
    ).toEqual({
      split: "CALIBRATION",
      runId: "calibration-v7",
      artifactId: "calibration-v7",
    });
    expect(
      parseT45MultiAnchorAuditArguments([
        "--split", "validation",
        "--run-id", "validation-v1",
        "--artifact-id", "validation-v1",
      ]),
    ).toMatchObject({ split: "VALIDATION" });
    expect(
      parseT45MultiAnchorAuditArguments([
        "--split", "legacy-regression",
        "--run-id", "legacy-v2",
        "--artifact-id", "legacy-regression-v1",
      ]),
    ).toMatchObject({
      split: "LEGACY_REGRESSION",
    });
    expect(() =>
      parseT45MultiAnchorAuditArguments([
        "--split", "validation",
        "--run-id", "validation-v2",
        "--artifact-id", "validation-v2",
      ]),
    ).toThrow("T45_MULTI_ANCHOR_CLI_IDENTITY_LOCKED");
  });

  it("classifies the legacy support floor without weakening other hard gates", () => {
    expect(
      classifyT45LegacyAuditDecisionV1({
        supportCases: 45,
        otherHardGatesPassed: true,
      }),
    ).toBe("LEGACY_REGRESSION_RECOVERED");
    expect(
      classifyT45LegacyAuditDecisionV1({
        supportCases: 43,
        otherHardGatesPassed: true,
      }),
    ).toBe(
      "LEGACY_REGRESSION_NONREGRESSION_ONLY",
    );
    expect(
      classifyT45LegacyAuditDecisionV1({
        supportCases: 50,
        otherHardGatesPassed: false,
      }),
    ).toBe("LEGACY_REGRESSION_NO_GO");
    expect(
      classifyT45LegacyAuditDecisionV1({
        supportCases: 42,
        otherHardGatesPassed: true,
      }),
    ).toBe("LEGACY_REGRESSION_NO_GO");
  });

  it("writes a sealed report once, resumes without qrels evaluation, and rejects input drift before scoring", async () => {
    const { root, source, draftPath } =
      await fixture();
    const evaluate = vi.fn(
      async () => noGoEvaluation(),
    );
    const args = [
      "--split", "calibration",
      "--run-id", "calibration-v1",
      "--artifact-id", "calibration-v1",
    ];
    const first = await runT45MultiAnchorAuditCli(
      args,
      root,
      {
        captureSourceClosure,
        loadSource: async () => source as never,
        evaluate,
        assertReportMatchesSelection:
          () => undefined as never,
      },
    );
    expect(first.resumed).toBe(false);
    expect(evaluate).toHaveBeenCalledTimes(1);
    const receiptPath = path.join(
      root,
      ".runtime/mixed-retrieval/"
      + "t45-capability-calibration-v1."
      + "multi-anchor-calibration-v1.receipt.json",
    );
    await unlink(receiptPath);

    const neverEvaluate = vi.fn();
    const resumed =
      await runT45MultiAnchorAuditCli(
        args,
        root,
        {
          captureSourceClosure,
          loadSource:
            async () => source as never,
          evaluate: neverEvaluate,
          assertReportMatchesSelection:
            () => undefined as never,
        },
      );
    expect(resumed.resumed).toBe(true);
    expect(resumed.output.sha256)
      .toBe(first.output.sha256);
    expect(neverEvaluate).not.toHaveBeenCalled();
    expect(
      JSON.parse(await readFile(receiptPath, "utf8")),
    ).toMatchObject({
      kind: "T45_AUDIT_RECEIPT",
      reportSha256: first.output.sha256,
      sourceClosureHash: H,
    });

    const driftEvaluate = vi.fn();
    await expect(
      runT45MultiAnchorAuditCli(
        args,
        root,
        {
          captureSourceClosure,
          loadSource: async () => ({
            ...source,
            inputs: {
              ...source.inputs,
              candidateSha256: H2,
            },
          } as never),
          evaluate: driftEvaluate,
          assertReportMatchesSelection:
            () => undefined as never,
        },
      ),
    ).rejects.toThrow(
      "T45_MULTI_ANCHOR_AUDIT_DRAFT_BINDING_DRIFT",
    );
    expect(driftEvaluate).not.toHaveBeenCalled();

    await unlink(draftPath);
    await expect(
      runT45MultiAnchorAuditCli(
        args,
        root,
        {
          captureSourceClosure,
          loadSource:
            async () => source as never,
          evaluate: neverEvaluate,
          assertReportMatchesSelection:
            () => undefined as never,
        },
      ),
    ).rejects.toThrow(
      "T45_MULTI_ANCHOR_AUDIT_DRAFT_MISSING",
    );
  });

  it("rejects a qrel-only node outside the actual candidate prompt before capability evaluation even after the selection bytes change", async () => {
    const {
      root,
      source,
      selectionPath,
    } = await fixture();
    const selection = JSON.parse(
      await readFile(selectionPath, "utf8"),
    ) as {
      cases: Array<{
        selected: Array<{
          nodeId: string;
        }>;
      }>;
    };
    selection.cases[0]!.selected[0]!.nodeId =
      "qrel-only-node";
    await writeFile(
      selectionPath,
      `${JSON.stringify(selection, null, 2)}\n`,
      "utf8",
    );
    const evaluate = vi.fn();
    await expect(
      runT45MultiAnchorAuditCli(
        [
          "--split", "calibration",
          "--run-id", "calibration-v1",
          "--artifact-id", "calibration-v1",
        ],
        root,
        {
          captureSourceClosure,
          loadSource:
            async () => source as never,
          evaluate,
        },
      ),
    ).rejects.toThrow(
      "T45_FINAL_ARTIFACT_SELECTED_OUTSIDE_PROMPT",
    );
    expect(evaluate).not.toHaveBeenCalled();
  });

  it.each([
    "CALIBRATION",
    "VALIDATION",
  ] as const)(
    "uses the default frozen 20-case %s evaluator and does not reopen qrels after report seal",
    async (split) => {
      const frozen = await frozenAuditFixture(split);
      const args = [
        "--split",
        split === "CALIBRATION"
          ? "calibration"
          : "validation",
        "--run-id", frozen.runId,
        "--artifact-id", frozen.artifactId,
      ];
      const verifyFreeze = async () => ({
        freezeHash: H,
        model: frozen.model,
      } as never);
      const first = await runT45MultiAnchorAuditCli(
        args,
        frozen.root,
        {
          captureSourceClosure,
          loadSource: async () =>
            frozen.source as never,
          verifyFreeze,
          validateFinal: () => undefined as never,
        },
      );
      const evaluation =
        T45SelectionReportSchema.parse(
          first.report.evaluation,
        );
      expect(evaluation.denominators).toEqual({
        cases: 20,
        requiredGroups: 30,
        multiCases: 10,
        families: 10,
      });
      expect(evaluation.summary).toMatchObject({
        supportCases: 20,
        requiredGroupsCovered: 30,
        multiJointCoverage: 10,
        familiesWithBothCasesSupported: 10,
      });
      expect(first.report.decision).toBe(
        split === "CALIBRATION"
          ? "CALIBRATION_GO"
          : "VALIDATION_GO",
      );

      await unlink(frozen.qrelsPath);
      const resumed =
        await runT45MultiAnchorAuditCli(
          args,
          frozen.root,
          {
            captureSourceClosure,
            loadSource: async () =>
              frozen.source as never,
            verifyFreeze,
            validateFinal: () => undefined as never,
          },
        );
      expect(resumed.resumed).toBe(true);
      expect(resumed.output.sha256)
        .toBe(first.output.sha256);
    },
  );

  it("rejects a self-consistent capability report that swaps selected and matched nodes away from the actual final on both evaluate and resume without qrels", async () => {
    const frozen = await frozenAuditFixture(
      "CALIBRATION",
    );
    const args = [
      "--split", "calibration",
      "--run-id", frozen.runId,
      "--artifact-id", frozen.artifactId,
    ];
    const dependencies = {
      captureSourceClosure,
      loadSource: async () =>
        frozen.source as never,
      validateFinal: () => undefined as never,
    };
    const first = await runT45MultiAnchorAuditCli(
      args,
      frozen.root,
      dependencies,
    );
    const forgedEvaluation =
      T45SelectionReportSchema.parse(
        structuredClone(
          first.report.evaluation,
        ),
      );
    const forgedCase =
      forgedEvaluation.cases[0]!;
    const originalNode =
      forgedCase.selectedNodeIds[0]!;
    const forgedNode = "report-only-node";
    forgedCase.selectedNodeIds =
      forgedCase.selectedNodeIds.map(
        (nodeId) =>
          nodeId === originalNode
            ? forgedNode
            : nodeId,
      );
    forgedCase.groups = forgedCase.groups.map(
      (group) => ({
        ...group,
        matchedNodeIds:
          group.matchedNodeIds.map(
            (nodeId) =>
              nodeId === originalNode
                ? forgedNode
                : nodeId,
          ),
      }),
    );
    forgedCase.hardNegativeNodeIds =
      forgedCase.hardNegativeNodeIds.map(
        (nodeId) =>
          nodeId === originalNode
            ? forgedNode
            : nodeId,
      );
    const reportPath = first.output.path;
    const receiptPath = path.join(
      frozen.root,
      ".runtime/mixed-retrieval",
      `t45-capability-${frozen.runId}.multi-anchor-${frozen.artifactId}.receipt.json`,
    );
    await Promise.all([
      unlink(reportPath),
      unlink(receiptPath),
    ]);
    await expect(
      runT45MultiAnchorAuditCli(
        args,
        frozen.root,
        {
          ...dependencies,
          evaluate: async () =>
            forgedEvaluation,
        },
      ),
    ).rejects.toThrow(
      "T45_CAPABILITY_REPORT_SELECTION_TRUTH_DRIFT",
    );
    const forgedReport = {
      ...first.report,
      evaluation: forgedEvaluation,
    };
    await writeFile(
      reportPath,
      `${JSON.stringify(
        forgedReport,
        null,
        2,
      )}\n`,
      "utf8",
    );
    await unlink(frozen.qrelsPath);
    await expect(
      runT45MultiAnchorAuditCli(
        args,
        frozen.root,
        {
          ...dependencies,
          evaluate: vi.fn(),
        },
      ),
    ).rejects.toThrow(
      "T45_CAPABILITY_REPORT_SELECTION_TRUTH_DRIFT",
    );
  });

  it("rejects a resealed receipt whose aggregate no longer derives from the truth-validated report without qrels", async () => {
    const frozen = await frozenAuditFixture(
      "CALIBRATION",
    );
    const args = [
      "--split", "calibration",
      "--run-id", frozen.runId,
      "--artifact-id", frozen.artifactId,
    ];
    const dependencies = {
      captureSourceClosure,
      loadSource: async () =>
        frozen.source as never,
      validateFinal: () => undefined as never,
    };
    const first = await runT45MultiAnchorAuditCli(
      args,
      frozen.root,
      dependencies,
    );
    const receiptPath = path.join(
      frozen.root,
      ".runtime/mixed-retrieval",
      `t45-capability-${frozen.runId}.multi-anchor-${frozen.artifactId}.receipt.json`,
    );
    const receipt = JSON.parse(
      await readFile(receiptPath, "utf8"),
    ) as {
      receiptHash?: string;
      aggregate: {
        aBaselineHardNegativeNodes: number;
      };
      [key: string]: unknown;
    };
    delete receipt.receiptHash;
    receipt.aggregate.aBaselineHardNegativeNodes =
      1;
    await writeFile(
      receiptPath,
      `${JSON.stringify(
        sealT45AuditReceiptV1(
          receipt as never,
        ),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await unlink(frozen.qrelsPath);
    await expect(
      runT45MultiAnchorAuditCli(
        args,
        frozen.root,
        dependencies,
      ),
    ).rejects.toThrow(
      "T45_AUDIT_RECEIPT_REPORT_TRUTH_DRIFT",
    );
    expect(first.resumed).toBe(false);
  });

  it("uses the default frozen 50-case legacy loader/evaluator and resumes the sealed report without qrels", async () => {
    const fixture =
      await legacyDefaultAuditFixture();
    const args = [
      "--split", "legacy-regression",
      "--run-id", "legacy-v2",
      "--artifact-id", "legacy-regression-v1",
    ];
    const verifyFreeze =
      async () => fixture.freeze as never;
    const validateFinal = vi.fn(
      (
        input: Parameters<
          typeof validateT45FinalArtifactV1
        >[0],
      ) => input.final,
    );
    const first = await runT45MultiAnchorAuditCli(
      args,
      fixture.root,
      {
        verifyFreeze,
        captureSourceClosure,
        loadSource: async () =>
          fixture.legacySource,
        validateFinal,
      },
    );
    expect(validateFinal).toHaveBeenCalledTimes(1);
    expect(
      validateFinal.mock.calls[0]![0]
        .prompts,
    ).toHaveLength(50);
    const evaluation = first.report.evaluation as {
      decision: string;
      metrics: {
        support: { covered: number; total: number };
        requiredGroups: {
          covered: number;
          total: number;
        };
        multi: { covered: number; total: number };
        modelValid: { valid: number; total: number };
      };
      gates: Record<string, { passed: boolean }>;
    };
    expect(first.report.decision).toBe(
      "LEGACY_REGRESSION_NONREGRESSION_ONLY",
    );
    expect(evaluation.metrics).toMatchObject({
      support: { covered: 43, total: 50 },
      requiredGroups: { covered: 89, total: 97 },
      multi: { covered: 9, total: 10 },
      modelValid: { valid: 50, total: 50 },
    });
    expect(evaluation.gates.support?.passed)
      .toBe(false);
    expect(
      Object.entries(evaluation.gates)
        .filter(([name]) => name !== "support")
        .every(([, gate]) => gate.passed),
    ).toBe(true);
    const truncated = structuredClone(
      first.report.evaluation,
    ) as { caseResults: unknown[] };
    truncated.caseResults.pop();
    expect(() =>
      T45LegacyEvaluationV1Schema.parse(truncated),
    ).toThrow();
    const invalidHardNegative =
      structuredClone(
        first.report.evaluation,
      ) as {
        caseResults: Array<{
          hardNegativeIntrusionNodeIds:
            string[];
        }>;
      };
    invalidHardNegative.caseResults[0]!
      .hardNegativeIntrusionNodeIds = [
        "not-selected",
      ];
    expect(() =>
      T45LegacyEvaluationV1Schema.parse(
        invalidHardNegative,
      ),
    ).toThrow(
      "T45_LEGACY_EVALUATION_TRUTH_DRIFT",
    );
    const unsupportedBySelection =
      structuredClone(
        first.report.evaluation,
      ) as {
        caseResults: Array<{
          support: boolean;
          selected: unknown[];
        }>;
      };
    const forgedSupportedCase =
      unsupportedBySelection.caseResults.find(
        (testCase) =>
          testCase.support
          && testCase.selected.length > 0,
      );
    expect(forgedSupportedCase)
      .toBeDefined();
    forgedSupportedCase!.selected = [];
    expect(() =>
      T45LegacyEvaluationV1Schema.parse(
        unsupportedBySelection,
      ),
    ).toThrow(
      "T45_LEGACY_EVALUATION_TRUTH_DRIFT",
    );

    await unlink(fixture.qrelsPath);
    const resumed =
      await runT45MultiAnchorAuditCli(
        args,
        fixture.root,
        {
          verifyFreeze,
          captureSourceClosure,
          loadSource: async () =>
            fixture.legacySource,
          validateFinal,
        },
      );
    expect(resumed.resumed).toBe(true);
    expect(validateFinal).toHaveBeenCalledTimes(2);
    expect(resumed.output.sha256)
      .toBe(first.output.sha256);

    const forgedReport = structuredClone(
      first.report,
    );
    const forgedLegacyEvaluation =
      T45LegacyEvaluationV1Schema.parse(
        forgedReport.evaluation,
      );
    forgedLegacyEvaluation.caseResults[0]!
      .selected[0]!.text +=
      " report-only-forgery";
    forgedReport.evaluation =
      forgedLegacyEvaluation;
    await writeFile(
      first.output.path,
      `${JSON.stringify(
        forgedReport,
        null,
        2,
      )}\n`,
      "utf8",
    );
    await expect(
      runT45MultiAnchorAuditCli(
        args,
        fixture.root,
        {
          verifyFreeze,
          captureSourceClosure,
          loadSource: async () =>
            fixture.legacySource,
          validateFinal,
        },
      ),
    ).rejects.toThrow(
      "T45_LEGACY_REPORT_SELECTION_TRUTH_DRIFT",
    );
  });
});
