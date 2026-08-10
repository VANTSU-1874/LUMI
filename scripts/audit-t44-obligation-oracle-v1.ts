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
  type KnowledgeCorpusBundleV2,
} from "../lib/knowledge/knowledge-object-v2";
import {
  T44ObligationCandidateArtifactV1Schema,
  type T44ObligationCandidateArtifactV1,
} from "../tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2,
  verifyT44ObligationSelectionBindingsV1,
  type T44ObligationSelectionArtifactV1,
} from "../tools/mixed-retrieval/t44-obligation-coverage-evaluator";
import {
  evaluateT44ObligationOracleV1,
  type T44ObligationOracleCaseV1,
} from "../tools/mixed-retrieval/t44-obligation-oracle-evaluator";
import {
  loadT44SupportDevArtifacts,
} from "../tools/mixed-retrieval/t44-support-loader";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const RUN_ID_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HashSchema = z.string().regex(HASH_PATTERN);

function sha256Bytes(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

export function parseT44ObligationOracleArguments(
  argv: readonly string[],
) {
  const args = argv.filter((value) => value !== "--");
  if (
    args.length < 2
    || args[0] !== "--run-id"
    || !RUN_ID_PATTERN.test(args[1] ?? "")
  ) {
    throw new Error(
      "T44_OBLIGATION_ORACLE_RUN_ID_INVALID",
    );
  }
  if (args.length === 2) {
    return { runId: args[1]! };
  }
  if (
    args.length !== 4
    || args[2] !== "--selection-variant"
  ) {
    throw new Error(
      "T44_OBLIGATION_ORACLE_RUN_ID_INVALID",
    );
  }
  if (args[3] !== "baseline-protected-v2") {
    throw new Error(
      "T44_OBLIGATION_ORACLE_SELECTION_VARIANT_INVALID",
    );
  }
  return {
    runId: args[1]!,
    selectionVariant:
      "baseline-protected-v2" as const,
  };
}

export function verifyT44ObligationOracleInputSealsV1(
  input: {
    candidateSerialized: string;
    matrixSerialized: string;
    selectionSerialized: string;
    selectionCandidateSha256: string;
    selectionMatrixSha256: string;
  },
) {
  const candidateSha256 = sha256Bytes(
    input.candidateSerialized,
  );
  const matrixSha256 = sha256Bytes(
    input.matrixSerialized,
  );
  const selectionSha256 = sha256Bytes(
    input.selectionSerialized,
  );
  if (
    candidateSha256
      !== HashSchema.parse(
        input.selectionCandidateSha256,
      )
  ) {
    throw new Error(
      `T44_OBLIGATION_ORACLE_CANDIDATE_SHA_DRIFT:${candidateSha256}`,
    );
  }
  if (
    matrixSha256
      !== HashSchema.parse(
        input.selectionMatrixSha256,
      )
  ) {
    throw new Error(
      `T44_OBLIGATION_ORACLE_MATRIX_SHA_DRIFT:${matrixSha256}`,
    );
  }
  return {
    candidateSha256,
    matrixSha256,
    selectionSha256,
  };
}

export function verifyT44ObligationOracleSelectionVariantV1(
  input: {
    selectionVariant?:
      "baseline-protected-v2";
    selectorConfigId?: string;
    selectorConfigVersion?: string;
    selectorConfigHash?: string;
  },
) {
  if (!input.selectionVariant) return;
  if (
    input.selectorConfigId
      !== T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2.id
    || input.selectorConfigVersion
      !== T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2
        .version
    || input.selectorConfigHash
      !== T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2
  ) {
    throw new Error(
      "T44_OBLIGATION_ORACLE_SELECTOR_CONFIG_DRIFT",
    );
  }
}

type CandidateCaseProjection = {
  caseId: string;
  coursePackId: string;
  aCandidateNodeIds: string[];
  bCandidateNodeIds: string[];
};

type SelectionCaseProjection = {
  caseId: string;
  coursePackId: string;
  aSelectedNodeIds: string[];
  bSelectedNodeIds: string[];
};

type QrelCaseProjection = {
  caseId: string;
  coursePackId: string;
  multiClaim: boolean;
  requiredEvidenceGroups: {
    groupId: string;
    acceptableNodeIds: string[];
  }[];
};

function uniqueCaseMap<T extends {
  caseId: string;
}>(
  cases: readonly T[],
  kind: string,
) {
  const result = new Map(
    cases.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  if (result.size !== cases.length) {
    throw new Error(
      `T44_OBLIGATION_ORACLE_${kind}_CASE_IDS_DUPLICATE`,
    );
  }
  return result;
}

export function buildT44ObligationOracleCasesV1(
  input: {
    candidateCases:
      readonly CandidateCaseProjection[];
    selectionCases:
      readonly SelectionCaseProjection[];
    qrelCases: readonly QrelCaseProjection[];
  },
): T44ObligationOracleCaseV1[] {
  const selections = uniqueCaseMap(
    input.selectionCases,
    "SELECTION",
  );
  const qrels = uniqueCaseMap(
    input.qrelCases,
    "QREL",
  );
  if (
    input.candidateCases.length
      !== input.selectionCases.length
    || input.candidateCases.length
      !== input.qrelCases.length
  ) {
    throw new Error(
      "T44_OBLIGATION_ORACLE_CASE_COUNT_DRIFT",
    );
  }
  return input.candidateCases.map((candidate) => {
    const selection = selections.get(
      candidate.caseId,
    );
    const qrel = qrels.get(candidate.caseId);
    if (
      !selection
      || !qrel
      || selection.coursePackId
        !== candidate.coursePackId
      || qrel.coursePackId
        !== candidate.coursePackId
    ) {
      throw new Error(
        `T44_OBLIGATION_ORACLE_CASE_BINDING_DRIFT:${candidate.caseId}`,
      );
    }
    return {
      caseId: candidate.caseId,
      coursePackId: candidate.coursePackId,
      multiClaim: qrel.multiClaim,
      requiredEvidenceGroups:
        qrel.requiredEvidenceGroups,
      aCandidateNodeIds:
        candidate.aCandidateNodeIds,
      bCandidateNodeIds:
        candidate.bCandidateNodeIds,
      aSelectedNodeIds:
        selection.aSelectedNodeIds,
      bSelectedNodeIds:
        selection.bSelectedNodeIds,
    };
  });
}

function verifyCandidateCorpusBindings(
  input: {
    candidate: T44ObligationCandidateArtifactV1;
    corpus: KnowledgeCorpusBundleV2;
  },
) {
  const corpus = verifyKnowledgeCorpusBundleV2(
    input.corpus,
  );
  if (
    input.candidate.corpusSnapshot.bundleHash
      !== corpus.bundleHash
  ) {
    throw new Error(
      "T44_OBLIGATION_ORACLE_CORPUS_BUNDLE_DRIFT",
    );
  }
  const objectById = new Map(
    corpus.objects.map((object) => [
      object.id,
      object,
    ]),
  );
  for (const testCase of input.candidate.cases) {
    for (
      const arm
      of Object.values(testCase.arms)
    ) {
      for (const ranked of arm.objectRanking) {
        const object = objectById.get(
          ranked.objectId,
        );
        if (
          !object
          || object.sourceCoursePack.id
            !== testCase.coursePackId
          || object.sourceCoursePack.version
            !== testCase.coursePackVersion
        ) {
          throw new Error(
            `T44_OBLIGATION_ORACLE_CANDIDATE_OBJECT_BINDING_DRIFT:${testCase.caseId}:${ranked.objectId}`,
          );
        }
      }
      for (const candidateNode of arm.candidateNodes) {
        const object = objectById.get(
          candidateNode.objectId,
        );
        const node = object?.nodes.find(
          ({ id }) => id === candidateNode.nodeId,
        );
        const text = node?.kind === "TEXT"
          ? node.text
          : node?.kind === "TABLE"
            ? node.plainText
            : null;
        const role = node?.kind === "TEXT"
          ? node.role
          : null;
        if (
          !object
          || !node
          || object.sourceCoursePack.id
            !== testCase.coursePackId
          || candidateNode.coursePackId
            !== testCase.coursePackId
          || candidateNode.objectContentHash
            !== object.contentHash
          || candidateNode.nodeContentHash
            !== node.contentHash
          || candidateNode.kind !== node.kind
          || candidateNode.role !== role
          || candidateNode.text !== text
        ) {
          throw new Error(
            `T44_OBLIGATION_ORACLE_CANDIDATE_NODE_BINDING_DRIFT:${testCase.caseId}:${candidateNode.nodeId}`,
          );
        }
      }
    }
  }
}

export async function writeNewT44ObligationOracleArtifactV1(
  targetPath: string,
  value: unknown,
) {
  const serialized = `${JSON.stringify(
    value,
    null,
    2,
  )}\n`;
  try {
    await writeFile(
      targetPath,
      serialized,
      {
        encoding: "utf8",
        flag: "wx",
      },
    );
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "EEXIST"
    ) {
      throw new Error(
        `T44_OBLIGATION_ORACLE_ARTIFACT_ALREADY_EXISTS:${targetPath}`,
      );
    }
    throw error;
  }
  const observed = await readFile(
    targetPath,
    "utf8",
  );
  if (observed !== serialized) {
    throw new Error(
      "T44_OBLIGATION_ORACLE_ARTIFACT_BYTES_DRIFT",
    );
  }
  return {
    path: targetPath,
    bytes: Buffer.byteLength(serialized, "utf8"),
    sha256: sha256Bytes(serialized),
  };
}

export async function runT44ObligationOracleCli(
  argv: readonly string[],
  workspaceRoot = process.cwd(),
) {
  const { runId, selectionVariant } =
    parseT44ObligationOracleArguments(argv);
  const artifactRoot = path.resolve(
    workspaceRoot,
    ".runtime/mixed-retrieval",
  );
  const stem = path.join(
    artifactRoot,
    `t44-obligation-${runId}`,
  );
  const paths = {
    candidate: `${stem}.candidate.json`,
    matrix: `${stem}.matrix.json`,
    selection: selectionVariant
      ? `${stem}.${selectionVariant}.selection.json`
      : `${stem}.selection.json`,
    oracle: selectionVariant
      ? `${stem}.${selectionVariant}.oracle-v1.json`
      : `${stem}.oracle-v1.json`,
    runtime: path.resolve(
      workspaceRoot,
      "tests/retrieval-quality/t44-support-dev.runtime.json",
    ),
    qrels: path.resolve(
      workspaceRoot,
      "tests/retrieval-quality/t44-support-dev.qrels.json",
    ),
    corpus: path.resolve(
      workspaceRoot,
      "data/knowledge-v2/knowledge-corpus.v2.json",
    ),
  };
  const [
    candidateSerialized,
    matrixSerialized,
    selectionSerialized,
    runtimeSerialized,
    qrelsSerialized,
    corpusSerialized,
  ] = await Promise.all([
    readFile(paths.candidate, "utf8"),
    readFile(paths.matrix, "utf8"),
    readFile(paths.selection, "utf8"),
    readFile(paths.runtime, "utf8"),
    readFile(paths.qrels, "utf8"),
    readFile(paths.corpus, "utf8"),
  ]);
  const candidate =
    T44ObligationCandidateArtifactV1Schema.parse(
      JSON.parse(candidateSerialized) as unknown,
    );
  const selectionInput = JSON.parse(
    selectionSerialized,
  ) as {
    candidateArtifactSha256?: unknown;
    matrixOutputSha256?: unknown;
  };
  const seals =
    verifyT44ObligationOracleInputSealsV1({
      candidateSerialized,
      matrixSerialized,
      selectionSerialized,
      selectionCandidateSha256:
        HashSchema.parse(
          selectionInput.candidateArtifactSha256,
        ),
      selectionMatrixSha256:
        HashSchema.parse(
          selectionInput.matrixOutputSha256,
        ),
    });
  const selection =
    verifyT44ObligationSelectionBindingsV1({
      seal: {
        serialized: selectionSerialized,
        sha256: seals.selectionSha256,
        bytes: Buffer.byteLength(
          selectionSerialized,
          "utf8",
        ),
      },
      candidateArtifactSha256:
        seals.candidateSha256,
      matrixOutputSha256: seals.matrixSha256,
    });
  verifyT44ObligationOracleSelectionVariantV1({
    selectionVariant,
    selectorConfigId:
      selection.selectorConfigId,
    selectorConfigVersion:
      selection.selectorConfigVersion,
    selectorConfigHash:
      selection.selectorConfigHash,
  });
  const corpus = verifyKnowledgeCorpusBundleV2(
    JSON.parse(corpusSerialized) as unknown,
  );
  const support = loadT44SupportDevArtifacts(
    JSON.parse(runtimeSerialized) as unknown,
    JSON.parse(qrelsSerialized) as unknown,
    corpus,
  );
  if (
    candidate.runtimeSuite.id
      !== support.runtime.id
    || candidate.runtimeSuite.version
      !== support.runtime.version
    || candidate.runtimeSuite.suiteHash
      !== support.runtime.suiteHash
  ) {
    throw new Error(
      "T44_OBLIGATION_ORACLE_RUNTIME_SUITE_DRIFT",
    );
  }
  verifyCandidateCorpusBindings({
    candidate,
    corpus,
  });
  const runtimeByCase = new Map(
    support.runtime.cases.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  const cases = buildT44ObligationOracleCasesV1({
    candidateCases: candidate.cases.map(
      (testCase) => ({
        caseId: testCase.caseId,
        coursePackId: testCase.coursePackId,
        aCandidateNodeIds:
          testCase.arms.A_WHOLE_QUERY
            .candidateNodes.map(({ nodeId }) =>
              nodeId),
        bCandidateNodeIds:
          testCase.arms.B_MODEL_GUIDED
            .candidateNodes.map(({ nodeId }) =>
              nodeId),
      }),
    ),
    selectionCases: selection.cases.map(
      (testCase) => ({
        caseId: testCase.caseId,
        coursePackId: testCase.coursePackId,
        aSelectedNodeIds:
          testCase.arms.A_WHOLE_QUERY
            .selected.map(({ nodeId }) => nodeId),
        bSelectedNodeIds:
          testCase.arms.B_MODEL_GUIDED
            .selected.map(({ nodeId }) => nodeId),
      }),
    ),
    qrelCases: support.qrels.cases.map(
      (testCase) => {
        const runtimeCase = runtimeByCase.get(
          testCase.caseId,
        );
        if (!runtimeCase) {
          throw new Error(
            `T44_OBLIGATION_ORACLE_RUNTIME_CASE_MISSING:${testCase.caseId}`,
          );
        }
        return {
          caseId: testCase.caseId,
          coursePackId:
            runtimeCase.coursePackId,
          multiClaim: testCase.multiClaim,
          requiredEvidenceGroups:
            testCase.requiredEvidenceGroups,
        };
      },
    ),
  });
  const oracle = evaluateT44ObligationOracleV1({
    cases,
  });
  const artifact = {
    ...oracle,
    runId,
    selectionVariant:
      selectionVariant ?? "legacy-selector-v1",
    inputs: {
      candidateSha256: seals.candidateSha256,
      matrixSha256: seals.matrixSha256,
      selectionSha256: seals.selectionSha256,
      runtimeFileSha256:
        sha256Bytes(runtimeSerialized),
      qrelsFileSha256:
        sha256Bytes(qrelsSerialized),
      runtimeSuiteHash:
        support.runtime.suiteHash,
      qrelsSuiteHash:
        support.qrels.suiteHash,
      corpusBundleHash: corpus.bundleHash,
    },
    operations: {
      model: "NOT_USED",
      graphify: "NOT_USED",
      database: "NOT_USED",
      web: "NOT_USED",
      deployment: "NOT_PERFORMED",
    },
    interpretationBoundary:
      "This is a label-aware structural reachability audit over sealed candidates and selections, not answer-quality or course-coverage evidence.",
  };
  const seal =
    await writeNewT44ObligationOracleArtifactV1(
      paths.oracle,
      artifact,
    );
  return { artifact, seal };
}

async function main() {
  const result = await runT44ObligationOracleCli(
    process.argv.slice(2),
  );
  process.stdout.write(
    `${JSON.stringify({
      decision: result.artifact.decision,
      pools: result.artifact.pools,
      gates: result.artifact.gates,
      operations: result.artifact.operations,
      oraclePath: result.seal.path,
      oracleBytes: result.seal.bytes,
      oracleSha256: result.seal.sha256,
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
