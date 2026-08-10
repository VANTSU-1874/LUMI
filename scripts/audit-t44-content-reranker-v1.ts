import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  verifyKnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  loadT44ContentRerankerSourceBundleV1,
} from "@/scripts/run-t44-content-reranker-v1";
import {
  T44ContentRerankerSelectionArtifactV1Schema,
  verifyT44ContentRerankerSelectionSealV1,
  type T44ContentRerankerSelectionArtifactV1,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import {
  evaluateT44LegacyEvidenceCaseV1,
} from "@/tools/mixed-retrieval/t44-obligation-coverage-evaluator";
import {
  loadT44SupportDevArtifacts,
} from "@/tools/mixed-retrieval/t44-support-loader";

const RUN_ID_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARTIFACT_ID_PATTERN =
  /^(?:pilot|full)-v[1-9][0-9]*$/;

const PATHS = Object.freeze({
  artifactRoot: ".runtime/mixed-retrieval",
  runtime:
    "tests/retrieval-quality/t44-support-dev.runtime.json",
  qrels:
    "tests/retrieval-quality/t44-support-dev.qrels.json",
  corpus:
    "data/knowledge-v2/knowledge-corpus.v2.json",
});

function sha256Utf8(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

export function parseT44ContentRerankerAuditArguments(
  argv: readonly string[],
) {
  let runId: string | null = null;
  let artifactId: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (index === 0 && token === "--") {
      continue;
    }
    if (token === "--run-id" && value) {
      runId = value;
      index += 1;
      continue;
    }
    if (token === "--artifact-id" && value) {
      artifactId = value;
      index += 1;
      continue;
    }
    throw new Error(
      `T44_CONTENT_RERANKER_AUDIT_ARGUMENT_INVALID:${token ?? "<missing>"}`,
    );
  }
  if (
    !runId
    || !RUN_ID_PATTERN.test(runId)
    || !artifactId
    || !ARTIFACT_ID_PATTERN.test(artifactId)
  ) {
    throw new Error(
      "T44_CONTENT_RERANKER_AUDIT_ARGUMENTS_REQUIRED",
    );
  }
  return { runId, artifactId };
}

const EvidenceGroupSchema = z
  .object({
    groupId: z.string().regex(
      /^[a-z0-9][a-z0-9-]{0,127}$/,
    ),
    acceptableNodeIds: z.array(
      z.string().regex(
        /^[a-z0-9][a-z0-9-]{0,127}$/,
      ),
    ).min(1).max(3),
  })
  .strict();

const LabelCaseSchema = z
  .object({
    caseId: z.string().regex(
      /^[a-z0-9][a-z0-9-]{0,127}$/,
    ),
    multiClaim: z.boolean(),
    requiredEvidenceGroups:
      z.array(EvidenceGroupSchema).min(1).max(4),
    hardNegativeNodeIds: z.array(
      z.string().regex(
        /^[a-z0-9][a-z0-9-]{0,127}$/,
      ),
    ).min(1).max(4),
  })
  .passthrough();

const BaselineCaseSchema = z
  .object({
    caseId: z.string().regex(
      /^[a-z0-9][a-z0-9-]{0,127}$/,
    ),
    selectedNodeIds: z.array(
      z.string().regex(
        /^[a-z0-9][a-z0-9-]{0,127}$/,
      ),
    ).max(8),
  })
  .strict();

function mapUnique<T extends { caseId: string }>(
  rows: readonly T[],
  label: string,
) {
  const result = new Map(
    rows.map((row) => [row.caseId, row]),
  );
  if (result.size !== rows.length) {
    throw new Error(
      `T44_CONTENT_RERANKER_AUDIT_${label}_DUPLICATE`,
    );
  }
  return result;
}

function nearestRankPercentile(
  values: readonly number[],
  percentile: number,
) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort(
    (left, right) => left - right,
  );
  const index = Math.max(
    0,
    Math.ceil(percentile * sorted.length) - 1,
  );
  return sorted[index] ?? 0;
}

export function evaluateT44ContentRerankerSelectionV1(
  rawInput: {
    artifact: T44ContentRerankerSelectionArtifactV1;
    labels: readonly z.input<
      typeof LabelCaseSchema
    >[];
    aBaseline: readonly z.input<
      typeof BaselineCaseSchema
    >[];
  },
) {
  const artifact =
    T44ContentRerankerSelectionArtifactV1Schema
      .parse(rawInput.artifact);
  const labels = z.array(LabelCaseSchema)
    .length(artifact.cases.length)
    .parse(rawInput.labels);
  const aBaseline = z.array(BaselineCaseSchema)
    .length(artifact.cases.length)
    .parse(rawInput.aBaseline);
  const labelsById = mapUnique(
    labels,
    "LABEL_CASE",
  );
  const baselineById = mapUnique(
    aBaseline,
    "BASELINE_CASE",
  );
  let supportCovered = 0;
  let groupCovered = 0;
  let groupTotal = 0;
  let multiCovered = 0;
  let multiTotal = 0;
  let hardNegativeNodes = 0;
  let hardNegativeCases = 0;
  let aHardNegativeNodes = 0;
  let aHardNegativeCases = 0;
  let aSupportCovered = 0;
  const byCoursePack = new Map<string, {
    cases: number;
    supportCovered: number;
    supportTotal: number;
    groupCovered: number;
    groupTotal: number;
    multiCovered: number;
    multiTotal: number;
    hardNegativeNodes: number;
    hardNegativeCases: number;
  }>();
  const caseResults = artifact.cases.map(
    (testCase) => {
      const label = labelsById.get(testCase.caseId);
      const baseline =
        baselineById.get(testCase.caseId);
      if (!label || !baseline) {
        throw new Error(
          `T44_CONTENT_RERANKER_AUDIT_CASE_BINDING_DRIFT:${testCase.caseId}`,
        );
      }
      const selectedNodeIds =
        testCase.selected.map(
          ({ nodeId }) => nodeId,
        );
      const result =
        evaluateT44LegacyEvidenceCaseV1({
          selectedNodeIds,
          requiredEvidenceGroups:
            label.requiredEvidenceGroups,
          hardNegativeNodeIds:
            label.hardNegativeNodeIds,
        });
      const baselineResult =
        evaluateT44LegacyEvidenceCaseV1({
          selectedNodeIds:
            baseline.selectedNodeIds,
          requiredEvidenceGroups:
            label.requiredEvidenceGroups,
          hardNegativeNodeIds:
            label.hardNegativeNodeIds,
        });
      if (result.allRequiredGroupsCovered) {
        supportCovered += 1;
      }
      if (
        baselineResult.allRequiredGroupsCovered
      ) {
        aSupportCovered += 1;
      }
      groupCovered += result.coveredGroupCount;
      groupTotal += result.requiredGroupCount;
      if (label.multiClaim) {
        multiTotal += 1;
        if (result.allRequiredGroupsCovered) {
          multiCovered += 1;
        }
      }
      hardNegativeNodes +=
        result.hardNegativeIntrusions.length;
      if (
        result.hardNegativeIntrusions.length > 0
      ) {
        hardNegativeCases += 1;
      }
      aHardNegativeNodes +=
        baselineResult.hardNegativeIntrusions.length;
      if (
        baselineResult.hardNegativeIntrusions
          .length > 0
      ) {
        aHardNegativeCases += 1;
      }
      const pack =
        byCoursePack.get(testCase.coursePackId)
        ?? {
          cases: 0,
          supportCovered: 0,
          supportTotal: 0,
          groupCovered: 0,
          groupTotal: 0,
          multiCovered: 0,
          multiTotal: 0,
          hardNegativeNodes: 0,
          hardNegativeCases: 0,
        };
      pack.cases += 1;
      pack.supportTotal += 1;
      if (result.allRequiredGroupsCovered) {
        pack.supportCovered += 1;
      }
      pack.groupCovered +=
        result.coveredGroupCount;
      pack.groupTotal +=
        result.requiredGroupCount;
      if (label.multiClaim) {
        pack.multiTotal += 1;
        if (result.allRequiredGroupsCovered) {
          pack.multiCovered += 1;
        }
      }
      pack.hardNegativeNodes +=
        result.hardNegativeIntrusions.length;
      if (
        result.hardNegativeIntrusions.length > 0
      ) {
        pack.hardNegativeCases += 1;
      }
      byCoursePack.set(
        testCase.coursePackId,
        pack,
      );
      const coveredSet = new Set(
        result.coveredGroupIds,
      );
      return {
        caseId: testCase.caseId,
        coursePackId: testCase.coursePackId,
        modelStatus: testCase.status,
        support:
          result.allRequiredGroupsCovered,
        coveredGroupIds:
          result.coveredGroupIds,
        missingGroupIds:
          label.requiredEvidenceGroups
            .map(({ groupId }) => groupId)
            .filter(
              (groupId) =>
                !coveredSet.has(groupId),
            ),
        hardNegativeIntrusionNodeIds:
          result.hardNegativeIntrusions,
        selected: testCase.selected.map(
          ({
            nodeId,
            objectId,
            text,
            evidenceRole,
            obligationIds,
          }) => ({
            nodeId,
            objectId,
            text,
            evidenceRole,
            obligationIds,
          }),
        ),
      };
    },
  );
  const valid = artifact.cases.filter(
    (testCase) => testCase.status === "VALID",
  ).length;
  const p95Ms = nearestRankPercentile(
    artifact.cases.map(
      (testCase) => testCase.audit.elapsedMs,
    ),
    0.95,
  );
  const supportMinimum =
    artifact.scope === "PILOT" ? 23 : 45;
  const multiMinimum =
    artifact.scope === "PILOT" ? 6 : 9;
  const gates = {
    support: {
      observed: supportCovered,
      minimum: supportMinimum,
      passed:
        supportCovered >= supportMinimum,
    },
    multi: {
      observed: multiCovered,
      minimum: multiMinimum,
      passed: multiCovered >= multiMinimum,
    },
    hardNegativeNodes: {
      observed: hardNegativeNodes,
      maximum: aHardNegativeNodes,
      passed:
        hardNegativeNodes <= aHardNegativeNodes,
    },
    hardNegativeCases: {
      observed: hardNegativeCases,
      maximum: aHardNegativeCases,
      passed:
        hardNegativeCases <= aHardNegativeCases,
    },
    modelValid: {
      observed: valid,
      minimum: artifact.cases.length,
      passed: valid === artifact.cases.length,
    },
    bindingViolations: {
      observed: 0,
      maximum: 0,
      passed: true,
    },
    p95Ms: {
      observed: p95Ms,
      maximum:
        artifact.config.modelCall.totalTimeoutMs,
      passed:
        p95Ms
        <= artifact.config.modelCall.totalTimeoutMs,
    },
  };
  const passed = Object.values(gates).every(
    (gate) => gate.passed,
  );
  const supportedByModel = new Set(
    caseResults.filter(
      ({ support }) => support,
    ).map(({ caseId }) => caseId),
  );
  const supportedByA = new Set(
    artifact.cases.flatMap((testCase) => {
      const label = labelsById.get(testCase.caseId)!;
      const baseline =
        baselineById.get(testCase.caseId)!;
      const result =
        evaluateT44LegacyEvidenceCaseV1({
          selectedNodeIds:
            baseline.selectedNodeIds,
          requiredEvidenceGroups:
            label.requiredEvidenceGroups,
          hardNegativeNodeIds:
            label.hardNegativeNodeIds,
        });
      return result.allRequiredGroupsCovered
        ? [testCase.caseId]
        : [];
    }),
  );
  return {
    schemaVersion: 1 as const,
    kind:
      "T44_CONTENT_RERANKER_AUDIT" as const,
    artifactId: artifact.artifactId,
    scope: artifact.scope,
    decision: (
      artifact.scope === "PILOT"
        ? passed
          ? "PILOT_GO"
          : "PILOT_NO_GO"
        : passed
          ? "FULL_EXPANSION_GO"
          : "FULL_EXPANSION_NO_GO"
    ) as
      | "PILOT_GO"
      | "PILOT_NO_GO"
      | "FULL_EXPANSION_GO"
      | "FULL_EXPANSION_NO_GO",
    metrics: {
      support: {
        covered: supportCovered,
        total: artifact.cases.length,
      },
      requiredGroups: {
        covered: groupCovered,
        total: groupTotal,
      },
      multi: {
        covered: multiCovered,
        total: multiTotal,
      },
      hardNegative: {
        nodes: hardNegativeNodes,
        cases: hardNegativeCases,
        aBaselineNodes: aHardNegativeNodes,
        aBaselineCases: aHardNegativeCases,
      },
      modelValid: {
        valid,
        total: artifact.cases.length,
      },
      latency: {
        p50Ms: nearestRankPercentile(
          artifact.cases.map(
            (testCase) =>
              testCase.audit.elapsedMs,
          ),
          0.5,
        ),
        p95Ms,
      },
    },
    aBaseline: {
      support: {
        covered: aSupportCovered,
        total: artifact.cases.length,
      },
    },
    delta: {
      gainedCaseIds: Array.from(
        supportedByModel,
      ).filter(
        (caseId) => !supportedByA.has(caseId),
      ),
      lostCaseIds: Array.from(
        supportedByA,
      ).filter(
        (caseId) => !supportedByModel.has(caseId),
      ),
    },
    byCoursePack: Object.fromEntries(
      Array.from(byCoursePack.entries()).sort(
        ([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
      ),
    ),
    gates,
    caseResults,
    operations: artifact.operations,
    interpretationBoundary:
      "This evaluates label-blind evidence selection on a fixed technical suite, not final answer professionalism or classroom outcomes.",
  };
}

function verifyPromptBindings(
  artifact: T44ContentRerankerSelectionArtifactV1,
  prompts: Awaited<
    ReturnType<
      typeof loadT44ContentRerankerSourceBundleV1
    >
  >["prompts"],
) {
  if (artifact.cases.length !== prompts.length) {
    throw new Error(
      "T44_CONTENT_RERANKER_AUDIT_PROMPT_COUNT_DRIFT",
    );
  }
  const promptsById = mapUnique(
    prompts,
    "PROMPT_CASE",
  );
  for (const testCase of artifact.cases) {
    const prompt = promptsById.get(testCase.caseId);
    if (
      !prompt
      || prompt.coursePackId
        !== testCase.coursePackId
      || prompt.candidateMapHash
        !== testCase.candidateMapHash
      || prompt.promptHash !== testCase.promptHash
      || (
        testCase.status === "VALID"
        && testCase.selected.length
          !== prompt.selectionBudget
      )
    ) {
      throw new Error(
        `T44_CONTENT_RERANKER_AUDIT_PROMPT_BINDING_DRIFT:${testCase.caseId}`,
      );
    }
    const obligationIds = new Set(
      prompt.obligationIds,
    );
    for (const selected of testCase.selected) {
      const candidate =
        prompt.candidates[
          selected.candidateIndex - 1
        ];
      if (
        !candidate
        || candidate.nodeId !== selected.nodeId
        || candidate.objectId !== selected.objectId
        || candidate.coursePackId
          !== selected.coursePackId
        || candidate.role !== selected.role
        || candidate.text !== selected.text
        || candidate.nodeContentHash
          !== selected.nodeContentHash
        || candidate.baselineRank
          !== selected.baselineRank
        || candidate.wholeQueryRank
          !== selected.wholeQueryRank
        || JSON.stringify(
          candidate.obligationRanks,
        ) !== JSON.stringify(
          selected.obligationRanks,
        )
        || selected.obligationIds.some(
          (obligationId) =>
            !obligationIds.has(obligationId),
        )
      ) {
        throw new Error(
          `T44_CONTENT_RERANKER_AUDIT_EVIDENCE_BINDING_DRIFT:${testCase.caseId}:${selected.candidateIndex}`,
        );
      }
    }
  }
}

async function writeNewReport(
  filePath: string,
  report: unknown,
) {
  const serialized = `${JSON.stringify(
    report,
    null,
    2,
  )}\n`;
  await writeFile(
    filePath,
    serialized,
    {
      encoding: "utf8",
      flag: "wx",
    },
  );
  const observed = await readFile(
    filePath,
    "utf8",
  );
  if (observed !== serialized) {
    throw new Error(
      "T44_CONTENT_RERANKER_AUDIT_REPORT_BYTE_DRIFT",
    );
  }
  return {
    path: filePath,
    bytes: Buffer.byteLength(
      observed,
      "utf8",
    ),
    sha256: sha256Utf8(observed),
  };
}

export async function runT44ContentRerankerAuditCli(
  argv: readonly string[],
  workspaceRoot = process.cwd(),
) {
  const parsed =
    parseT44ContentRerankerAuditArguments(argv);
  const selectionPath = path.resolve(
    workspaceRoot,
    PATHS.artifactRoot,
    `t44-obligation-${parsed.runId}.content-reranker-${parsed.artifactId}.selection.json`,
  );
  const serialized = await readFile(
    selectionPath,
    "utf8",
  );
  const unverified =
    T44ContentRerankerSelectionArtifactV1Schema
      .parse(JSON.parse(serialized) as unknown);
  const source =
    await loadT44ContentRerankerSourceBundleV1({
      workspaceRoot,
      runId: parsed.runId,
      scope: unverified.scope,
    });
  const artifact =
    verifyT44ContentRerankerSelectionSealV1({
      seal: {
        serialized,
        sha256: sha256Utf8(serialized),
        bytes: Buffer.byteLength(
          serialized,
          "utf8",
        ),
      },
      expectedInputs: source.inputSeals,
    });
  if (artifact.artifactId !== parsed.artifactId) {
    throw new Error(
      "T44_CONTENT_RERANKER_AUDIT_ARTIFACT_ID_DRIFT",
    );
  }
  verifyPromptBindings(
    artifact,
    source.prompts,
  );
  const [runtimeBytes, qrelsBytes, corpusBytes] =
    await Promise.all([
      readFile(
        path.resolve(workspaceRoot, PATHS.runtime),
        "utf8",
      ),
      readFile(
        path.resolve(workspaceRoot, PATHS.qrels),
        "utf8",
      ),
      readFile(
        path.resolve(workspaceRoot, PATHS.corpus),
        "utf8",
      ),
    ]);
  const loaded = loadT44SupportDevArtifacts(
    JSON.parse(runtimeBytes) as unknown,
    JSON.parse(qrelsBytes) as unknown,
    verifyKnowledgeCorpusBundleV2(
      JSON.parse(corpusBytes) as unknown,
    ),
  );
  if (
    loaded.runtime.suiteHash
      !== artifact.runtimeSuite.suiteHash
  ) {
    throw new Error(
      "T44_CONTENT_RERANKER_AUDIT_RUNTIME_SUITE_DRIFT",
    );
  }
  const artifactCaseIds = new Set(
    artifact.cases.map(
      ({ caseId }) => caseId,
    ),
  );
  const labels = loaded.qrels.cases.filter(
    ({ caseId }) =>
      artifactCaseIds.has(caseId),
  );
  const aBaseline =
    source.legacySelection.cases
      .filter(({ caseId }) =>
        artifactCaseIds.has(caseId))
      .map((testCase) => ({
        caseId: testCase.caseId,
        selectedNodeIds:
          testCase.arms.A_WHOLE_QUERY
            .selected.map(({ nodeId }) => nodeId),
      }));
  const report =
    evaluateT44ContentRerankerSelectionV1({
      artifact,
      labels,
      aBaseline,
    });
  const reportPath = path.resolve(
    workspaceRoot,
    PATHS.artifactRoot,
    `t44-obligation-${parsed.runId}.content-reranker-${parsed.artifactId}.report.json`,
  );
  const reportSeal = await writeNewReport(
    reportPath,
    {
      ...report,
      selection: {
        path: selectionPath,
        sha256: sha256Utf8(serialized),
        bytes: Buffer.byteLength(
          serialized,
          "utf8",
        ),
      },
      generatedAt: new Date().toISOString(),
    },
  );
  return { report, reportSeal };
}

async function main() {
  const result =
    await runT44ContentRerankerAuditCli(
      process.argv.slice(2),
    );
  process.stdout.write(
    `${JSON.stringify({
      decision: result.report.decision,
      metrics: result.report.metrics,
      aBaseline: result.report.aBaseline,
      delta: result.report.delta,
      byCoursePack:
        result.report.byCoursePack,
      gates: result.report.gates,
      reportPath: result.reportSeal.path,
      reportBytes: result.reportSeal.bytes,
      reportSha256: result.reportSeal.sha256,
      operations: result.report.operations,
    }, null, 2)}\n`,
  );
}

const entryPoint = process.argv[1];
if (
  entryPoint
  && import.meta.url
    === pathToFileURL(path.resolve(entryPoint)).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error
        ? error.stack ?? error.message
        : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
