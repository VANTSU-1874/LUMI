import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import {
  createLocalMixedRuntimeV2,
  type LocalMixedRuntimeV2Options,
} from "@/lib/knowledge/mixed-retrieval-runtime-v2";
import {
  verifyKnowledgeCorpusBundleV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  decomposeRetrievalClaimsV1,
} from "@/lib/knowledge/query-claim-decomposer-v1";
import {
  createRetrievalQueryV2,
} from "@/lib/knowledge/retrieval-query-v2";
import {
  buildT44ClaimCandidateCaseV1,
  createT44ClaimCandidateRuntimeInputV1,
  evaluateT44ClaimCandidateOracleV1,
  serializeT44ClaimCandidateRuntimeInputV1,
  sha256T44ClaimCandidateRuntimeInputV1,
} from "@/tools/mixed-retrieval/t44-claim-candidate-evaluator";
import {
  buildT44ClaimSelectionArtifactV1,
  evaluateT44ClaimCoverageV1,
  serializeT44ClaimSelectionArtifactV1,
  sha256T44ClaimSelectionArtifactV1,
  T44ClaimMatrixSidecarOutputV1Schema,
} from "@/tools/mixed-retrieval/t44-claim-coverage-evaluator";
import {
  loadT44SupportDevArtifacts,
  T44SupportRuntimeSuiteSchema,
  t44SupportRuntimeSuiteHash,
  T44_SUPPORT_RUNTIME_SUITE_SHA256,
} from "@/tools/mixed-retrieval/t44-support-loader";

const execFileAsync = promisify(execFile);

const PATHS = Object.freeze({
  runtimeSuite:
    "tests/retrieval-quality/t44-support-dev.runtime.json",
  qrels:
    "tests/retrieval-quality/t44-support-dev.qrels.json",
  corpus:
    "data/knowledge-v2/knowledge-corpus.v2.json",
  python:
    ".runtime/visual-retrieval/python312/python.exe",
  matrixTool:
    "tools/reranker/t44_claim_matrix.py",
  textModelDir:
    ".runtime/text-retrieval/hf/models--BAAI--bge-small-zh-v1.5/" +
    "snapshots/7999e1d3359715c523056ef9478215996d62a620",
  textModelSeal:
    ".runtime/text-retrieval/seals/bge-small-zh-v1.5.json",
  textIndexDir:
    ".runtime/text-retrieval/indexes/" +
    "b3119e9a942497f731d6c8ee063c00fe2793e859cf47d7cbaa6101a2771b1122",
  visualModelDir:
    ".runtime/visual-retrieval/hf/models--google--" +
    "siglip2-base-patch16-224/snapshots/" +
    "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2",
  visualModelSeal:
    ".runtime/visual-retrieval/seals/siglip2.json",
  visualIndexDir:
    ".runtime/visual-retrieval/indexes/siglip2/" +
    "1f2a354c755b498240108583d10ad5f0f5d2a3ad9c9f2cee2c3110d07f05125a",
  visualOffloadDir:
    ".runtime/visual-retrieval/offload",
  controlDir:
    ".runtime/knowledge-index/control/" +
    "cad61822cf3e4d95e984b08c66fa6427c5adf182fc305329291f8eb9aad1be5d",
  assetManifest:
    "data/manifests/course-png-sha256.v1.json",
  artifactStemBase:
    ".runtime/mixed-retrieval/" +
    "t44-claim-recovery-legacy-regression",
} as const);

function sha256Text(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function canonicalJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeNewUtf8(
  target: string,
  content: string,
) {
  await mkdir(path.dirname(target), {
    recursive: true,
  });
  await writeFile(target, content, {
    encoding: "utf8",
    flag: "wx",
  });
  const observed = await readFile(target, "utf8");
  if (observed !== content) {
    throw new Error(
      `T44_LEGACY_REGRESSION_ARTIFACT_WRITE_DRIFT:${target}`,
    );
  }
}

function runtimeOptions(
  workspaceRoot: string,
): LocalMixedRuntimeV2Options {
  const resolve = (value: string) =>
    path.resolve(workspaceRoot, value);
  return {
    workspaceRoot,
    pythonExecutable: resolve(PATHS.python),
    textModelDir: resolve(PATHS.textModelDir),
    textModelSeal: resolve(PATHS.textModelSeal),
    textIndexDir: resolve(PATHS.textIndexDir),
    visualModelDir: resolve(PATHS.visualModelDir),
    visualModelSeal: resolve(PATHS.visualModelSeal),
    visualIndexDir: resolve(PATHS.visualIndexDir),
    visualOffloadDir: resolve(PATHS.visualOffloadDir),
    controlDir: resolve(PATHS.controlDir),
    assetManifestPath: resolve(PATHS.assetManifest),
    device: "cuda",
    gpuMemoryGiB: 5.5,
    timeoutMs: 30_000,
    visualMaxCacheEntries: 8,
    textObjectConsensusEnabled: false,
    queryEvidenceAdequacyEnabled: false,
    queryPrerequisiteStaticBypassEnabled: false,
    textObjectChannelProbeEnabled: true,
  };
}

function isolatedPythonEnvironment() {
  const allowedExact = new Set([
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
  ]);
  const result: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined
      && (
        allowedExact.has(key.toUpperCase())
        || key.toUpperCase().startsWith("CUDA_PATH")
      )
    ) {
      result[key] = value;
    }
  }
  return {
    ...result,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    TOKENIZERS_PARALLELISM: "false",
  };
}

function providerAudit(
  entries: ReturnType<
    Awaited<ReturnType<
      typeof createLocalMixedRuntimeV2
    >>["providerSpy"]
  >["entries"],
) {
  const channelCounts = {
    LEXICAL: 0,
    TEXT_VECTOR: 0,
    VISUAL_VECTOR: 0,
    CAPTION_LEXICAL: 0,
  };
  for (const entry of entries) {
    channelCounts[entry.channel] += 1;
  }
  return {
    observedCalls: entries.length,
    channelCounts,
  };
}

async function runLegacyRegression(
  workspaceRoot = process.cwd(),
) {
  const resolve = (value: string) =>
    path.resolve(workspaceRoot, value);
  const runId =
    process.env.LUMI_T44_LEGACY_REGRESSION_RUN_ID;
  if (
    runId !== undefined
    && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(runId)
  ) {
    throw new Error(
      "T44_LEGACY_REGRESSION_RUN_ID_INVALID",
    );
  }
  const artifactStem = runId === undefined
    ? PATHS.artifactStemBase
    : `${PATHS.artifactStemBase}-${runId}`;
  const [
    runtimeBytes,
    corpusBytes,
  ] = await Promise.all([
    readFile(resolve(PATHS.runtimeSuite)),
    readFile(resolve(PATHS.corpus)),
  ]);
  const runtimeSuite =
    T44SupportRuntimeSuiteSchema.parse(
      JSON.parse(runtimeBytes.toString("utf8")) as unknown,
    );
  const runtimeHash =
    t44SupportRuntimeSuiteHash(runtimeSuite);
  if (
    runtimeHash !== runtimeSuite.suiteHash
    || runtimeHash
      !== T44_SUPPORT_RUNTIME_SUITE_SHA256
  ) {
    throw new Error(
      `T44_LEGACY_REGRESSION_RUNTIME_HASH_DRIFT:${runtimeHash}`,
    );
  }
  const corpus = verifyKnowledgeCorpusBundleV2(
    JSON.parse(corpusBytes.toString("utf8")) as unknown,
  );
  if (
    corpus.bundleHash
    !== runtimeSuite.corpusSnapshot.bundleHash
  ) {
    throw new Error(
      "T44_LEGACY_REGRESSION_CORPUS_BINDING_DRIFT",
    );
  }

  let runtime:
    Awaited<ReturnType<typeof createLocalMixedRuntimeV2>>
    | null = null;
  const cases = [];
  const candidateExpansionTimingMs: Array<{
    caseId: string;
    durationMs: number;
  }> = [];
  let audit;
  try {
    runtime = await createLocalMixedRuntimeV2(
      runtimeOptions(workspaceRoot),
    );
    for (const testCase of runtimeSuite.cases) {
      const startedAt = performance.now();
      const query = createRetrievalQueryV2({
        mode: testCase.mode,
        text: testCase.question,
        scope: {
          corpusBundleHash: corpus.bundleHash,
          sourceCoursePack: {
            id: testCase.coursePackId,
            version: testCase.coursePackVersion,
          },
        },
      });
      if (query.normalizedText === null) {
        throw new Error(
          `T44_LEGACY_REGRESSION_TEXT_QUERY_REQUIRED:${testCase.caseId}`,
        );
      }
      const decomposition =
        decomposeRetrievalClaimsV1(
          query.normalizedText,
        );
      const probeResults = [];
      for (const probe of decomposition.probes) {
        const probeQuery = createRetrievalQueryV2({
          mode: "TEXT_TO_TEXT",
          text: probe.text,
          scope: query.scope,
        });
        try {
          probeResults.push({
            probeId: probe.probeId,
            result:
              await runtime.probeTextObjectChannels(
                probeQuery,
                probe.kind === "SUPPORT_CLAIM"
                  ? { staticParentQuery: query }
                  : undefined,
              ),
          });
        } catch (error) {
          throw new Error(
            "T44_LEGACY_REGRESSION_PROBE_FAILED:"
            + `${testCase.caseId}:${probe.probeId}:`
            + `${JSON.stringify(probe.text)}`,
            { cause: error },
          );
        }
      }
      cases.push(buildT44ClaimCandidateCaseV1({
        caseId: testCase.caseId,
        query,
        decomposition,
        probeResults,
        corpus,
      }));
      candidateExpansionTimingMs.push({
        caseId: testCase.caseId,
        durationMs: Math.max(
          0,
          performance.now() - startedAt,
        ),
      });
    }
    audit = providerAudit(
      runtime.providerSpy().entries,
    );
  } finally {
    await runtime?.dispose();
  }
  if (!audit) {
    throw new Error(
      "T44_LEGACY_REGRESSION_PROVIDER_AUDIT_MISSING",
    );
  }

  const candidateInput =
    createT44ClaimCandidateRuntimeInputV1({
      runtimeSuite: {
        id: runtimeSuite.id,
        version: runtimeSuite.version,
        suiteHash: runtimeSuite.suiteHash,
      },
      corpusBundleHash: corpus.bundleHash,
      cases,
    });
  const serializedCandidateInput =
    serializeT44ClaimCandidateRuntimeInputV1(
      candidateInput,
    );
  const candidateInputSha256 =
    sha256T44ClaimCandidateRuntimeInputV1(
      serializedCandidateInput,
    );
  const candidatePath =
    resolve(`${artifactStem}.candidate.json`);
  await writeNewUtf8(
    candidatePath,
    serializedCandidateInput,
  );
  if (
    sha256Text(await readFile(candidatePath, "utf8"))
    !== candidateInputSha256
  ) {
    throw new Error(
      "T44_LEGACY_REGRESSION_CANDIDATE_SEAL_DRIFT",
    );
  }

  // Labels are deliberately read only after the candidate artifact is
  // serialized, written, closed, and byte-sealed.
  const qrelsBytes = await readFile(resolve(PATHS.qrels));
  const { qrels } = loadT44SupportDevArtifacts(
    JSON.parse(runtimeBytes.toString("utf8")) as unknown,
    JSON.parse(qrelsBytes.toString("utf8")) as unknown,
    corpus,
  );
  const candidateOracle =
    evaluateT44ClaimCandidateOracleV1({
      serializedCandidateInput,
      candidateInputSha256,
      qrelCases: qrels.cases.map(
        ({
          caseId,
          multiClaim,
          requiredEvidenceGroups,
        }) => ({
          caseId,
          multiClaim,
          requiredEvidenceGroups,
        }),
      ),
      corpus,
    });
  const oraclePath =
    resolve(`${artifactStem}.oracle.json`);
  await writeNewUtf8(
    oraclePath,
    canonicalJson(candidateOracle),
  );

  if (!candidateOracle.passed) {
    const stoppedSummary = {
      kind: "T44_CLAIM_RECOVERY_LEGACY_REGRESSION",
      purpose:
        "EXPOSED_DEV_STRUCTURAL_REGRESSION_ONLY",
      decision: "STOP_BEFORE_BGE",
      candidateInputSha256,
      candidateOracle,
      providerInvocationAudit: audit,
      artifacts: {
        candidatePath,
        oraclePath,
      },
    };
    const summaryPath =
      resolve(`${artifactStem}.summary.json`);
    await writeNewUtf8(
      summaryPath,
      canonicalJson(stoppedSummary),
    );
    return {
      summaryPath,
      summary: stoppedSummary,
    };
  }

  // The Python process receives only the label-blind, sealed candidate path.
  const {
    stdout,
    stderr,
  } = await execFileAsync(
    resolve(PATHS.python),
    [
      resolve(PATHS.matrixTool),
      "--input",
      candidatePath,
      "--corpus",
      resolve(PATHS.corpus),
      "--model-dir",
      resolve(PATHS.textModelDir),
      "--model-seal",
      resolve(PATHS.textModelSeal),
      "--index-dir",
      resolve(PATHS.textIndexDir),
      "--device",
      "cuda",
    ],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: isolatedPythonEnvironment(),
      maxBuffer: 64 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    },
  );
  T44ClaimMatrixSidecarOutputV1Schema.parse(
    JSON.parse(stdout) as unknown,
  );
  const matrixOutputSha256 = sha256Text(stdout);
  const matrixPath =
    resolve(`${artifactStem}.matrix.json`);
  const matrixStderrPath =
    resolve(`${artifactStem}.matrix.stderr.log`);
  await writeNewUtf8(matrixPath, stdout);
  await writeNewUtf8(matrixStderrPath, stderr);

  const selection =
    buildT44ClaimSelectionArtifactV1({
      serializedCandidateInput,
      candidateInputSha256,
      serializedMatrixOutput: stdout,
      matrixOutputSha256,
    });
  const serializedSelection =
    serializeT44ClaimSelectionArtifactV1(selection);
  const selectionArtifactSha256 =
    sha256T44ClaimSelectionArtifactV1(
      serializedSelection,
    );
  const selectionPath =
    resolve(`${artifactStem}.selection.json`);
  await writeNewUtf8(
    selectionPath,
    serializedSelection,
  );

  const evaluation = evaluateT44ClaimCoverageV1({
    serializedCandidateInput,
    candidateInputSha256,
    serializedMatrixOutput: stdout,
    matrixOutputSha256,
    serializedSelectionArtifact:
      serializedSelection,
    selectionArtifactSha256,
    qrelCases: qrels.cases,
    corpus,
    candidateExpansionTimingMs,
    providerInvocationAudit: audit,
  });
  const reportPath =
    resolve(`${artifactStem}.report.json`);
  await writeNewUtf8(
    reportPath,
    canonicalJson(evaluation),
  );
  const summary = {
    kind: "T44_CLAIM_RECOVERY_LEGACY_REGRESSION",
    purpose:
      "EXPOSED_DEV_STRUCTURAL_REGRESSION_ONLY",
    decision:
      evaluation.passed
        ? "KNOWN_FAILURE_REGRESSION_PASS"
        : "KNOWN_FAILURE_REGRESSION_FAIL",
    candidateInputSha256,
    matrixOutputSha256,
    selectionArtifactSha256,
    candidateOracle: {
      aggregate: candidateOracle.aggregate,
      byCoursePack: candidateOracle.byCoursePack,
      gates: candidateOracle.gates,
      passed: candidateOracle.passed,
    },
    arms: evaluation.arms,
    timing: {
      nodeSelectionExtraP95Ms:
        evaluation.timing.nodeSelectionExtraP95Ms,
      candidateExpansionP95Ms:
        evaluation.timing.candidateExpansionP95Ms,
    },
    gates: evaluation.gates,
    providerInvocationAudit: audit,
    artifacts: {
      candidatePath,
      oraclePath,
      matrixPath,
      matrixStderrPath,
      selectionPath,
      reportPath,
    },
  };
  const summaryPath =
    resolve(`${artifactStem}.summary.json`);
  await writeNewUtf8(
    summaryPath,
    canonicalJson(summary),
  );
  return { summaryPath, summary };
}

async function main() {
  const result = await runLegacyRegression();
  process.stdout.write(
    `${canonicalJson({
      summaryPath: result.summaryPath,
      decision: result.summary.decision,
      candidateOracle:
        result.summary.candidateOracle,
      arms:
        "arms" in result.summary
          ? result.summary.arms
          : null,
      timing:
        "timing" in result.summary
          ? result.summary.timing
          : null,
      providerInvocationAudit:
        result.summary.providerInvocationAudit,
    })}`,
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
