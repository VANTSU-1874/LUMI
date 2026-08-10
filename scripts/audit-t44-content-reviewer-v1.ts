import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  verifyKnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  evaluateT44ContentRerankerSelectionV1,
} from "@/scripts/audit-t44-content-reranker-v1";
import {
  loadT44ContentReviewerSourceBundleV1,
} from "@/scripts/run-t44-content-reviewer-v1";
import {
  T44ContentReviewerSelectionArtifactV1Schema,
  verifyT44ContentReviewerSelectionSealV1,
} from "@/tools/mixed-retrieval/t44-content-reviewer-v1";
import {
  T44_CONTENT_RERANKER_CONFIG_HASH_V1,
  T44_CONTENT_RERANKER_CONFIG_V1,
  T44ContentRerankerSelectionArtifactV1Schema,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import {
  loadT44SupportDevArtifacts,
} from "@/tools/mixed-retrieval/t44-support-loader";

const RUN_ID_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARTIFACT_ID_PATTERN =
  /^(?:pilot|full)-v[1-9][0-9]*$/;
const ARTIFACT_ROOT = ".runtime/mixed-retrieval";
const RUNTIME_PATH =
  "tests/retrieval-quality/t44-support-dev.runtime.json";
const QRELS_PATH =
  "tests/retrieval-quality/t44-support-dev.qrels.json";
const CORPUS_PATH =
  "data/knowledge-v2/knowledge-corpus.v2.json";

function sha256Utf8(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

export function parseT44ContentReviewerAuditArguments(
  argv: readonly string[],
) {
  let runId: string | null = null;
  let artifactId: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (index === 0 && token === "--") continue;
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
      `T44_CONTENT_REVIEWER_AUDIT_ARGUMENT_INVALID:${token ?? "<missing>"}`,
    );
  }
  if (
    !runId
    || !RUN_ID_PATTERN.test(runId)
    || !artifactId
    || !ARTIFACT_ID_PATTERN.test(artifactId)
  ) {
    throw new Error(
      "T44_CONTENT_REVIEWER_AUDIT_ARGUMENTS_REQUIRED",
    );
  }
  return { runId, artifactId };
}

function verifyPromptBindings(
  artifact: ReturnType<
    typeof T44ContentReviewerSelectionArtifactV1Schema.parse
  >,
  prompts: Awaited<ReturnType<
    typeof loadT44ContentReviewerSourceBundleV1
  >>["prompts"],
) {
  if (artifact.cases.length !== prompts.length) {
    throw new Error(
      "T44_CONTENT_REVIEWER_AUDIT_PROMPT_COUNT_DRIFT",
    );
  }
  const promptById = new Map(
    prompts.map((prompt) => [
      prompt.caseId,
      prompt,
    ]),
  );
  for (const testCase of artifact.cases) {
    const prompt = promptById.get(testCase.caseId);
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
        `T44_CONTENT_REVIEWER_AUDIT_PROMPT_BINDING_DRIFT:${testCase.caseId}`,
      );
    }
    for (const selected of testCase.selected) {
      const candidate =
        prompt.candidates[
          selected.candidateIndex - 1
        ];
      if (
        !candidate
        || candidate.nodeId !== selected.nodeId
        || candidate.objectId
          !== selected.objectId
        || candidate.nodeContentHash
          !== selected.nodeContentHash
        || candidate.coursePackId
          !== selected.coursePackId
      ) {
        throw new Error(
          `T44_CONTENT_REVIEWER_AUDIT_NODE_BINDING_DRIFT:${testCase.caseId}:${selected.nodeId}`,
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
  await writeFile(filePath, serialized, {
    encoding: "utf8",
    flag: "wx",
  });
  const observed = await readFile(filePath, "utf8");
  if (observed !== serialized) {
    throw new Error(
      "T44_CONTENT_REVIEWER_AUDIT_REPORT_BYTE_DRIFT",
    );
  }
  return {
    path: filePath,
    bytes: Buffer.byteLength(observed, "utf8"),
    sha256: sha256Utf8(observed),
  };
}

export async function runT44ContentReviewerAuditCli(
  argv: readonly string[],
  workspaceRoot = process.cwd(),
) {
  const parsed =
    parseT44ContentReviewerAuditArguments(argv);
  const selectionPath = path.resolve(
    workspaceRoot,
    ARTIFACT_ROOT,
    `t44-obligation-${parsed.runId}.content-reviewer-${parsed.artifactId}.selection.json`,
  );
  const serialized = await readFile(
    selectionPath,
    "utf8",
  );
  const unverified =
    T44ContentReviewerSelectionArtifactV1Schema
      .parse(JSON.parse(serialized) as unknown);
  if (unverified.artifactId !== parsed.artifactId) {
    throw new Error(
      "T44_CONTENT_REVIEWER_AUDIT_ARTIFACT_ID_DRIFT",
    );
  }
  const loaded =
    await loadT44ContentReviewerSourceBundleV1({
      workspaceRoot,
      runId: parsed.runId,
      draftArtifactId:
        unverified.draft.artifactId,
    });
  const artifact =
    verifyT44ContentReviewerSelectionSealV1({
      seal: {
        serialized,
        sha256: sha256Utf8(serialized),
        bytes: Buffer.byteLength(
          serialized,
          "utf8",
        ),
      },
      expectedInputs: loaded.inputSeals,
    });
  if (
    artifact.draft.configHash
      !== loaded.draft.configHash
    || artifact.scope !== loaded.draft.scope
  ) {
    throw new Error(
      "T44_CONTENT_REVIEWER_AUDIT_DRAFT_BINDING_DRIFT",
    );
  }
  verifyPromptBindings(artifact, loaded.prompts);
  const [runtimeBytes, qrelsBytes, corpusBytes] =
    await Promise.all([
      readFile(
        path.resolve(workspaceRoot, RUNTIME_PATH),
        "utf8",
      ),
      readFile(
        path.resolve(workspaceRoot, QRELS_PATH),
        "utf8",
      ),
      readFile(
        path.resolve(workspaceRoot, CORPUS_PATH),
        "utf8",
      ),
    ]);
  const dev = loadT44SupportDevArtifacts(
    JSON.parse(runtimeBytes) as unknown,
    JSON.parse(qrelsBytes) as unknown,
    verifyKnowledgeCorpusBundleV2(
      JSON.parse(corpusBytes) as unknown,
    ),
  );
  if (
    dev.runtime.suiteHash
      !== artifact.runtimeSuite.suiteHash
  ) {
    throw new Error(
      "T44_CONTENT_REVIEWER_AUDIT_RUNTIME_SUITE_DRIFT",
    );
  }
  const caseIds = new Set(
    artifact.cases.map(({ caseId }) => caseId),
  );
  const labels = dev.qrels.cases.filter(
    ({ caseId }) => caseIds.has(caseId),
  );
  const aBaseline =
    loaded.source.legacySelection.cases
      .filter(({ caseId }) => caseIds.has(caseId))
      .map((testCase) => ({
        caseId: testCase.caseId,
        selectedNodeIds:
          testCase.arms.A_WHOLE_QUERY
            .selected.map(({ nodeId }) => nodeId),
      }));
  const compatible =
    T44ContentRerankerSelectionArtifactV1Schema
      .parse({
        schemaVersion: 1,
        kind:
          "T44_CONTENT_RERANKER_SELECTIONS",
        artifactId: artifact.artifactId,
        scope: artifact.scope,
        runtimeSuite: artifact.runtimeSuite,
        inputs: loaded.source.inputSeals,
        config:
          T44_CONTENT_RERANKER_CONFIG_V1,
        configHash:
          T44_CONTENT_RERANKER_CONFIG_HASH_V1,
        model: artifact.model,
        graphifyInvocationCount: 0,
        cases: artifact.cases,
        summary: artifact.summary,
        generatedAt: artifact.generatedAt,
        operations: artifact.operations,
      });
  const baseReport =
    evaluateT44ContentRerankerSelectionV1({
      artifact: compatible,
      labels,
      aBaseline,
    });
  const report = {
    ...baseReport,
    kind: "T44_CONTENT_REVIEWER_AUDIT",
    reviewer: {
      configHash: artifact.configHash,
      draftArtifactId:
        artifact.draft.artifactId,
      draftSelectionSha256:
        artifact.inputs.draftSelectionSha256,
    },
  };
  const reportPath = path.resolve(
    workspaceRoot,
    ARTIFACT_ROOT,
    `t44-obligation-${parsed.runId}.content-reviewer-${parsed.artifactId}.report.json`,
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
    await runT44ContentReviewerAuditCli(
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
      reviewer: result.report.reviewer,
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
