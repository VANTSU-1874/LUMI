import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  T44ClaimMatrixSidecarOutputV1Schema,
} from "../tools/mixed-retrieval/t44-claim-coverage-evaluator";
import {
  T44ObligationCandidateArtifactV1Schema,
} from "../tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  buildT44BaselineProtectedObligationSelectionArtifactV2,
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2,
} from "../tools/mixed-retrieval/t44-obligation-coverage-evaluator";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const RUN_ID_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HashSchema = z.string().regex(HASH_PATTERN);

const MatrixArmSchema = z
  .object({
    inputSha256: HashSchema,
    stderrBytes:
      z.number().int().nonnegative(),
    stderrSha256: HashSchema,
    output:
      T44ClaimMatrixSidecarOutputV1Schema,
  })
  .strict();

const MatrixReplayPackageSchemaV2 = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(
      "T44_OBLIGATION_NODE_MATRICES",
    ),
    matrixBridgeManifestSha256: HashSchema,
    graphifyInvocationCount: z.literal(0),
    arms: z
      .object({
        A_WHOLE_QUERY: MatrixArmSchema,
        B_MODEL_GUIDED: MatrixArmSchema,
      })
      .strict(),
  })
  .strict();

function sha256Bytes(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

export function parseT44BaselineProtectedReplayArgumentsV2(
  argv: readonly string[],
) {
  const args = argv.filter((value) => value !== "--");
  if (
    args.length !== 2
    || args[0] !== "--run-id"
    || !RUN_ID_PATTERN.test(args[1] ?? "")
  ) {
    throw new Error(
      "T44_BASELINE_PROTECTED_REPLAY_RUN_ID_INVALID",
    );
  }
  return { runId: args[1]! };
}

export async function writeNewT44BaselineProtectedReplayArtifactV2(
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
        `T44_BASELINE_PROTECTED_REPLAY_ARTIFACT_ALREADY_EXISTS:${targetPath}`,
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
      "T44_BASELINE_PROTECTED_REPLAY_ARTIFACT_BYTES_DRIFT",
    );
  }
  return {
    path: targetPath,
    bytes: Buffer.byteLength(serialized, "utf8"),
    sha256: sha256Bytes(serialized),
  };
}

export async function runT44BaselineProtectedReplayV2(
  argv: readonly string[],
  workspaceRoot = process.cwd(),
) {
  const { runId } =
    parseT44BaselineProtectedReplayArgumentsV2(argv);
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
    selection:
      `${stem}.baseline-protected-v2.selection.json`,
  };
  const [
    candidateSerialized,
    matrixSerialized,
  ] = await Promise.all([
    readFile(paths.candidate, "utf8"),
    readFile(paths.matrix, "utf8"),
  ]);
  const candidate =
    T44ObligationCandidateArtifactV1Schema.parse(
      JSON.parse(candidateSerialized) as unknown,
    );
  const matrix =
    MatrixReplayPackageSchemaV2.parse(
      JSON.parse(matrixSerialized) as unknown,
    );
  const candidateSha256 = sha256Bytes(
    candidateSerialized,
  );
  const matrixSha256 = sha256Bytes(
    matrixSerialized,
  );
  const selection =
    buildT44BaselineProtectedObligationSelectionArtifactV2({
      candidateArtifact: candidate,
      candidateArtifactSha256: candidateSha256,
      matrixOutputSha256: matrixSha256,
      aMatrixOutput:
        matrix.arms.A_WHOLE_QUERY.output,
      bMatrixOutput:
        matrix.arms.B_MODEL_GUIDED.output,
    });
  const seal =
    await writeNewT44BaselineProtectedReplayArtifactV2(
      paths.selection,
      selection,
    );
  return {
    runId,
    inputs: {
      candidateSha256,
      matrixSha256,
    },
    selector: {
      config:
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2,
      configHash:
        T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
    },
    operations: {
      model: "NOT_USED" as const,
      graphify: "NOT_USED" as const,
      database: "NOT_USED" as const,
      web: "NOT_USED" as const,
      deployment: "NOT_PERFORMED" as const,
    },
    seal,
  };
}

async function main() {
  const result =
    await runT44BaselineProtectedReplayV2(
      process.argv.slice(2),
    );
  process.stdout.write(
    `${JSON.stringify({
      runId: result.runId,
      inputs: result.inputs,
      selector: result.selector,
      operations: result.operations,
      selectionPath: result.seal.path,
      selectionBytes: result.seal.bytes,
      selectionSha256: result.seal.sha256,
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
