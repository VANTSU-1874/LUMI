import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  T44_CLAIM_MATRIX_CONFIG_HASH_V1,
} from "../tools/mixed-retrieval/t44-claim-matrix-contract-v1";
import {
  T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1,
  T44ObligationCandidateArtifactV1Schema,
} from "../tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2,
  T44ObligationSelectionArtifactV1Schema,
} from "../tools/mixed-retrieval/t44-obligation-label-blind-v2";
import {
  type T45CapabilityInventoryV1,
  type T45CapabilityQrelsSuite,
  type T45CapabilityRuntimeSuite,
  type T45CapabilitySplit,
} from "../tools/mixed-retrieval/t45-capability-authoring";
import {
  evaluateT45CandidateOracle,
  T45_CAPABILITY_EVALUATOR_CONFIG_HASH_V1,
  type T45CandidateOracleReport,
} from "../tools/mixed-retrieval/t45-capability-evaluator";
import {
  sealT45CandidateOracleGateV1,
  verifyT45CandidateOracleGateV1,
} from "../tools/mixed-retrieval/t45-candidate-oracle-gate-v1";
import {
  evaluateT45CandidateStructuralReadinessV1,
} from "../tools/mixed-retrieval/t45-candidate-structural-gates-v1";
import {
  T45CapabilityInventorySchema,
  T45CapabilityQrelsSuiteSchema,
  T45CapabilityRuntimeSuiteSchema,
  t45CapabilityInventoryHash,
  t45CapabilityQrelsSuiteHash,
  t45CapabilityRuntimeSuiteHash,
} from "../tools/mixed-retrieval/t45-capability-loader";
import {
  T45_FROZEN_RUNTIME_BINDINGS_V1,
} from "../tools/mixed-retrieval/t45-obligation-runtime-port";

const RUN_ID_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HashSchema = z.string().regex(HASH_PATTERN);
const IdSchema = z.string().regex(ID_PATTERN);
const SplitSchema = z.enum([
  "CALIBRATION",
  "VALIDATION",
]);

const PATHS = Object.freeze({
  sourceRoot: "tests/retrieval-quality",
  inventory: "t45-capability-inventory.json",
  artifactRoot: ".runtime/mixed-retrieval",
} as const);

const SPLIT_FILES = Object.freeze({
  CALIBRATION: {
    runtime:
      "t45-capability-calibration.runtime.json",
    qrels:
      "t45-capability-calibration.qrels.json",
  },
  VALIDATION: {
    runtime:
      "t45-capability-validation.runtime.json",
    qrels:
      "t45-capability-validation.qrels.json",
  },
} as const);

export type T45CapabilityOracleFrozenBindingsV1 = {
  inventoryBytesSha256: string;
  runtimeBytesSha256: Record<
    T45CapabilitySplit,
    string
  >;
  qrelsBytesSha256: Record<
    T45CapabilitySplit,
    string
  >;
  runtimeSuiteHashes: Record<
    T45CapabilitySplit,
    string
  >;
  qrelsSuiteHashes: Record<
    T45CapabilitySplit,
    string
  >;
  inventoryHash: string;
  corpusBundleHash: string;
};

function deepFreeze<T>(value: T): T {
  if (
    value
    && typeof value === "object"
    && !Object.isFrozen(value)
  ) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export const T45_CAPABILITY_ORACLE_FROZEN_BINDINGS_V1 =
  deepFreeze({
    inventoryBytesSha256:
      "980b0f4f5610820231dc2eae556a4740a6b72d029938b96573ac0212cbe9661e",
    runtimeBytesSha256: {
      CALIBRATION:
        "f9248863fe6ffc1417b5851773f9d0668ff93a31732b61c5c4e969db094c4ef7",
      VALIDATION:
        "f229fe62286ea2b9bbe8fe538a7a5674d19291537f160839cc72cdcf2635e31c",
    },
    qrelsBytesSha256: {
      CALIBRATION:
        "07fef5766df7fd58344d86cd648cabe88cef6cec7cceb58254b22e4dc969810e",
      VALIDATION:
        "9bd3b1eef11f932da25bae831e6fd185b79229545573de2cb42cd3c71f55dff9",
    },
    runtimeSuiteHashes: {
      ...T45_FROZEN_RUNTIME_BINDINGS_V1.suiteHashes,
    },
    qrelsSuiteHashes: {
      CALIBRATION:
        "bf37ebb456687bab84d9f4c816764ef834ccbe89276d268a916eff45254d13cd",
      VALIDATION:
        "77f1a60c4ed30020011dfe0a3e5e03faa00aded2bcae64f867f9c4c4205ff38c",
    },
    inventoryHash:
      T45_FROZEN_RUNTIME_BINDINGS_V1.inventoryHash,
    corpusBundleHash:
      T45_FROZEN_RUNTIME_BINDINGS_V1
        .corpusBundleHash,
  } satisfies T45CapabilityOracleFrozenBindingsV1);

const SealSchema = z.object({
  path: z.string().trim().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: HashSchema,
}).strict();

const RuntimeIdentitySchema = z.object({
  id: IdSchema,
  version: z.string().trim().min(1).max(64),
  suiteHash: HashSchema,
}).strict();

const BoundarySchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(
    "T45_CAPABILITY_LABELS_REMAIN_UNREAD",
  ),
  runId: z.string().regex(RUN_ID_PATTERN),
  split: SplitSchema,
  runtimeSuite: RuntimeIdentitySchema,
  capabilityInventory: z.object({
    inventoryHash: HashSchema,
  }).strict(),
  corpusSnapshot: z.object({
    bundleHash: HashSchema,
  }).strict(),
  configHashes: z.object({
    candidate: HashSchema,
    matrix: HashSchema,
    selection: HashSchema,
  }).strict(),
  providerInvocationAudit: z.unknown(),
  operationBoundary: z.literal(
    "SELECTION_SEALED_LABELS_UNREAD",
  ),
  operations: z.object({
    graphify: z.literal("NOT_USED"),
    database: z.literal("NOT_USED"),
    web: z.literal("NOT_USED"),
    deployment: z.literal("NOT_PERFORMED"),
    scoring: z.literal("NOT_PERFORMED"),
  }).strict(),
  artifacts: z.object({
    planner: SealSchema,
    provider: SealSchema,
    candidate: SealSchema,
    matrixBridge: SealSchema,
    matrix: SealSchema,
    selection: SealSchema,
  }).strict(),
}).strict();

const PlannerSchema = z.object({
  runtimeSuite: RuntimeIdentitySchema,
  cases: z.array(z.object({
    caseId: IdSchema,
    request: z.object({
      coursePack: z.object({
        id: IdSchema,
        version: z.literal("1"),
      }).passthrough(),
    }).passthrough(),
  }).passthrough()).length(20),
}).passthrough();

const ProviderArmSchema = z.object({
  status: z.enum(["EXECUTED", "CLARIFY"]),
  retrievalMode:
    z.literal("BASELINE_REUSED").optional(),
  expectedProviderCalls:
    z.number().int().nonnegative(),
  actualProviderCalls:
    z.number().int().nonnegative(),
  batch: z.object({}).passthrough().nullable(),
  rrf: z.object({}).passthrough().nullable(),
}).passthrough();

const ProviderSchema = z.object({
  expectedCalls: z.number().int().nonnegative(),
  actualCalls: z.number().int().nonnegative(),
  matched: z.boolean(),
  cases: z.array(z.object({
    caseId: IdSchema,
    A_WHOLE_QUERY: ProviderArmSchema,
    B_MODEL_GUIDED: ProviderArmSchema,
  }).passthrough()).length(20),
}).passthrough();

const MatrixCaseSchema = z.object({
  caseId: IdSchema,
  coursePackId: IdSchema,
}).passthrough();

const MatrixSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(
    "T44_OBLIGATION_NODE_MATRICES",
  ),
  arms: z.object({
    A_WHOLE_QUERY: z.object({
      output: z.object({
        cases: z.array(MatrixCaseSchema).length(20),
      }).passthrough(),
    }).passthrough(),
    B_MODEL_GUIDED: z.object({
      output: z.object({
        cases: z.array(MatrixCaseSchema).length(20),
      }).passthrough(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

type Seal = z.infer<typeof SealSchema>;
type Boundary = z.infer<typeof BoundarySchema>;

export type T45CapabilityOracleCliDependenciesV1 = {
  readQrelsReadOnly?(
    target: string,
  ): Promise<Uint8Array>;
  frozenBindings?:
    T45CapabilityOracleFrozenBindingsV1;
};

function sha256(value: string | Uint8Array) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function canonicalJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function parseT45CapabilityOracleArguments(
  argv: readonly string[],
): {
  split: T45CapabilitySplit;
  runId: string;
} {
  const args = argv[0] === "--"
    ? argv.slice(1)
    : [...argv];
  if (
    args.length !== 4
    || args[0] !== "--split"
    || args[2] !== "--run-id"
  ) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_CLI_ARGUMENTS_INVALID",
    );
  }
  const split = args[1] === "calibration"
    ? "CALIBRATION"
    : args[1] === "validation"
      ? "VALIDATION"
      : null;
  if (!split) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_CLI_SPLIT_INVALID",
    );
  }
  const runId = args[3] ?? "";
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_CLI_RUN_ID_INVALID",
    );
  }
  if (
    split === "VALIDATION"
    && runId !== "validation-v1"
  ) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_CLI_VALIDATION_RUN_ID_LOCKED",
    );
  }
  if (
    split === "CALIBRATION"
    && !/^calibration-v[1-9][0-9]*$/.test(runId)
  ) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_CLI_CALIBRATION_RUN_ID_LOCKED",
    );
  }
  return { split, runId };
}

function errorCode(error: unknown) {
  if (
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "ENOENT"
  ) {
    return "MISSING";
  }
  return null;
}

async function readRequired(
  target: string,
  artifact: string,
) {
  try {
    return await readFile(target);
  } catch (error) {
    if (errorCode(error) === "MISSING") {
      throw new Error(
        `T45_CAPABILITY_ORACLE_${artifact}_MISSING`,
      );
    }
    throw new Error(
      `T45_CAPABILITY_ORACLE_${artifact}_READ_FAILED`,
    );
  }
}

function parseJson(
  bytes: Uint8Array,
  artifact: string,
) {
  try {
    return JSON.parse(
      Buffer.from(bytes).toString("utf8"),
    ) as unknown;
  } catch {
    throw new Error(
      `T45_CAPABILITY_ORACLE_${artifact}_JSON_INVALID`,
    );
  }
}

function assertRawSeal(input: {
  artifact: string;
  expectedPath: string;
  seal: Seal;
  bytes: Uint8Array;
}) {
  if (
    path.resolve(input.seal.path)
      !== path.resolve(input.expectedPath)
  ) {
    throw new Error(
      `T45_CAPABILITY_ORACLE_${input.artifact}_PATH_DRIFT`,
    );
  }
  if (
    input.seal.bytes !== input.bytes.byteLength
    || input.seal.sha256 !== sha256(input.bytes)
  ) {
    throw new Error(
      `T45_CAPABILITY_ORACLE_${input.artifact}_BYTES_DRIFT`,
    );
  }
}

function assertFrozenHash(
  observed: string,
  expected: string,
  code: string,
) {
  if (observed !== expected) {
    throw new Error(code);
  }
}

function assertCaseOrder(input: {
  runtime: T45CapabilityRuntimeSuite;
  planner: z.infer<typeof PlannerSchema>;
  candidate: ReturnType<
    typeof T44ObligationCandidateArtifactV1Schema.parse
  >;
  matrix: z.infer<typeof MatrixSchema>;
  selection: ReturnType<
    typeof T44ObligationSelectionArtifactV1Schema.parse
  >;
}) {
  const expectedIds = input.runtime.cases.map(
    ({ caseId }) => caseId,
  );
  const expectedCourses = input.runtime.cases.map(
    ({ coursePackId }) => coursePackId,
  );
  const assertValues = (
    observed: readonly string[],
    expected: readonly string[],
    code: string,
  ) => {
    if (
      observed.length !== expected.length
      || observed.some(
        (value, index) => value !== expected[index],
      )
    ) {
      throw new Error(code);
    }
  };
  assertValues(
    input.planner.cases.map(
      ({ caseId }) => caseId,
    ),
    expectedIds,
    "T45_CAPABILITY_ORACLE_PLANNER_CASE_ORDER_DRIFT",
  );
  assertValues(
    input.planner.cases.map(
      ({ request }) => request.coursePack.id,
    ),
    expectedCourses,
    "T45_CAPABILITY_ORACLE_PLANNER_COURSE_ORDER_DRIFT",
  );
  assertValues(
    input.candidate.cases.map(
      ({ caseId }) => caseId,
    ),
    expectedIds,
    "T45_CAPABILITY_ORACLE_CANDIDATE_CASE_ORDER_DRIFT",
  );
  assertValues(
    input.candidate.cases.map(
      ({ coursePackId }) => coursePackId,
    ),
    expectedCourses,
    "T45_CAPABILITY_ORACLE_CANDIDATE_COURSE_ORDER_DRIFT",
  );
  for (
    const arm
    of ["A_WHOLE_QUERY", "B_MODEL_GUIDED"] as const
  ) {
    assertValues(
      input.matrix.arms[arm].output.cases.map(
        ({ caseId }) => caseId,
      ),
      expectedIds,
      "T45_CAPABILITY_ORACLE_MATRIX_CASE_ORDER_DRIFT",
    );
    assertValues(
      input.matrix.arms[arm].output.cases.map(
        ({ coursePackId }) => coursePackId,
      ),
      expectedCourses,
      "T45_CAPABILITY_ORACLE_MATRIX_COURSE_ORDER_DRIFT",
    );
  }
  assertValues(
    input.selection.cases.map(
      ({ caseId }) => caseId,
    ),
    expectedIds,
    "T45_CAPABILITY_ORACLE_SELECTION_CASE_ORDER_DRIFT",
  );
  assertValues(
    input.selection.cases.map(
      ({ coursePackId }) => coursePackId,
    ),
    expectedCourses,
    "T45_CAPABILITY_ORACLE_SELECTION_COURSE_ORDER_DRIFT",
  );
}

function assertQrelsOrder(input: {
  runtime: T45CapabilityRuntimeSuite;
  qrels: T45CapabilityQrelsSuite;
}) {
  for (
    let index = 0;
    index < input.runtime.cases.length;
    index += 1
  ) {
    const runtimeCase = input.runtime.cases[index]!;
    const qrelCase = input.qrels.cases[index]!;
    if (qrelCase.caseId !== runtimeCase.caseId) {
      throw new Error(
        "T45_CAPABILITY_ORACLE_QRELS_CASE_ORDER_DRIFT",
      );
    }
    if (qrelCase.familyId !== runtimeCase.familyId) {
      throw new Error(
        "T45_CAPABILITY_ORACLE_QRELS_FAMILY_ORDER_DRIFT",
      );
    }
  }
}

function assertBoundaryBindings(input: {
  boundary: Boundary;
  split: T45CapabilitySplit;
  runId: string;
  runtime: T45CapabilityRuntimeSuite;
  inventory: T45CapabilityInventoryV1;
}) {
  if (
    input.boundary.runId !== input.runId
    || input.boundary.split !== input.split
    || input.boundary.runtimeSuite.id
      !== input.runtime.id
    || input.boundary.runtimeSuite.version
      !== input.runtime.version
    || input.boundary.runtimeSuite.suiteHash
      !== input.runtime.suiteHash
  ) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_BOUNDARY_RUNTIME_DRIFT",
    );
  }
  if (
    input.boundary.capabilityInventory.inventoryHash
      !== input.inventory.inventoryHash
    || input.boundary.corpusSnapshot.bundleHash
      !== input.inventory.corpusBundleHash
  ) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_BOUNDARY_SOURCE_DRIFT",
    );
  }
  if (
    input.boundary.configHashes.candidate
      !== T44_OBLIGATION_CANDIDATE_CONFIG_HASH_V1
    || input.boundary.configHashes.matrix
      !== T44_CLAIM_MATRIX_CONFIG_HASH_V1
    || input.boundary.configHashes.selection
      !== T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2
  ) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_BOUNDARY_CONFIG_DRIFT",
    );
  }
}

export async function readT45QrelsReadOnlyV1(
  target: string,
) {
  let handle;
  try {
    handle = await open(target, "r");
    return await handle.readFile();
  } catch (error) {
    if (errorCode(error) === "MISSING") {
      throw new Error(
        "T45_CAPABILITY_ORACLE_QRELS_MISSING",
      );
    }
    if (
      error instanceof Error
      && error.message.startsWith(
        "T45_CAPABILITY_ORACLE_",
      )
    ) {
      throw error;
    }
    throw new Error(
      "T45_CAPABILITY_ORACLE_QRELS_READ_FAILED",
    );
  } finally {
    await handle?.close();
  }
}

async function writeOrVerifyOracleArtifact(
  target: string,
  value: unknown,
  label: "ARTIFACT" | "GATE",
) {
  const content = canonicalJson(value);
  await mkdir(path.dirname(target), {
    recursive: true,
  });
  try {
    await writeFile(target, content, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "EEXIST"
    ) {
      const existing = await readRequired(
        target,
        label,
      );
      if (
        Buffer.from(existing).toString("utf8")
          === content
      ) {
        return {
          path: path.resolve(target),
          bytes: existing.byteLength,
          sha256: sha256(existing),
        };
      }
      throw new Error(
        `T45_CAPABILITY_ORACLE_${label}_CHECKPOINT_DRIFT`,
      );
    }
    throw new Error(
      `T45_CAPABILITY_ORACLE_${label}_WRITE_FAILED`,
    );
  }
  const observed = await readRequired(
    target,
    label,
  );
  if (
    Buffer.from(observed).toString("utf8")
      !== content
  ) {
    throw new Error(
      `T45_CAPABILITY_ORACLE_${label}_BYTES_DRIFT`,
    );
  }
  return {
    path: path.resolve(target),
    bytes: observed.byteLength,
    sha256: sha256(observed),
  };
}

export function serializeT45CapabilityOracleStdoutV1(
  report: T45CandidateOracleReport,
) {
  return canonicalJson(report);
}

export async function runT45CapabilityOracleCli(
  argv: readonly string[],
  workspaceRoot = process.cwd(),
  dependencies:
    T45CapabilityOracleCliDependenciesV1 = {},
) {
  const parsed =
    parseT45CapabilityOracleArguments(argv);
  const frozen = dependencies.frozenBindings
    ?? T45_CAPABILITY_ORACLE_FROZEN_BINDINGS_V1;
  const splitFiles = SPLIT_FILES[parsed.split];
  const sourceRoot = path.resolve(
    workspaceRoot,
    PATHS.sourceRoot,
  );
  const artifactRoot = path.resolve(
    workspaceRoot,
    PATHS.artifactRoot,
  );
  const stem = `t45-capability-${parsed.runId}`;
  const paths = {
    inventory: path.join(
      sourceRoot,
      PATHS.inventory,
    ),
    runtime: path.join(
      sourceRoot,
      splitFiles.runtime,
    ),
    qrels: path.join(
      sourceRoot,
      splitFiles.qrels,
    ),
    boundary: path.join(
      artifactRoot,
      `${stem}.boundary.json`,
    ),
    planner: path.join(
      artifactRoot,
      `${stem}.planner.json`,
    ),
    provider: path.join(
      artifactRoot,
      `${stem}.provider.json`,
    ),
    candidate: path.join(
      artifactRoot,
      `${stem}.candidate.json`,
    ),
    matrix: path.join(
      artifactRoot,
      `${stem}.matrix.json`,
    ),
    selection: path.join(
      artifactRoot,
      `${stem}.selection.json`,
    ),
    oracle: path.join(
      artifactRoot,
      `${stem}.oracle.json`,
    ),
    oracleGate: path.join(
      artifactRoot,
      `${stem}.oracle-gate.json`,
    ),
  };

  const inventoryBytes = await readRequired(
    paths.inventory,
    "INVENTORY",
  );
  assertFrozenHash(
    sha256(inventoryBytes),
    frozen.inventoryBytesSha256,
    "T45_CAPABILITY_ORACLE_INVENTORY_BYTES_SHA_DRIFT",
  );
  const inventory =
    T45CapabilityInventorySchema.parse(
      parseJson(inventoryBytes, "INVENTORY"),
    ) as T45CapabilityInventoryV1;
  if (
    t45CapabilityInventoryHash(inventory)
      !== inventory.inventoryHash
  ) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_INVENTORY_HASH_DRIFT",
    );
  }
  assertFrozenHash(
    inventory.inventoryHash,
    frozen.inventoryHash,
    "T45_CAPABILITY_ORACLE_FROZEN_INVENTORY_HASH_DRIFT",
  );
  assertFrozenHash(
    inventory.corpusBundleHash,
    frozen.corpusBundleHash,
    "T45_CAPABILITY_ORACLE_FROZEN_CORPUS_HASH_DRIFT",
  );

  const runtimeBytes = await readRequired(
    paths.runtime,
    "RUNTIME",
  );
  assertFrozenHash(
    sha256(runtimeBytes),
    frozen.runtimeBytesSha256[parsed.split],
    "T45_CAPABILITY_ORACLE_RUNTIME_BYTES_SHA_DRIFT",
  );
  const runtime =
    T45CapabilityRuntimeSuiteSchema.parse(
      parseJson(runtimeBytes, "RUNTIME"),
    ) as T45CapabilityRuntimeSuite;
  if (
    runtime.split !== parsed.split
    || t45CapabilityRuntimeSuiteHash(runtime)
      !== runtime.suiteHash
  ) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_RUNTIME_SUITE_HASH_DRIFT",
    );
  }
  assertFrozenHash(
    runtime.suiteHash,
    frozen.runtimeSuiteHashes[parsed.split],
    "T45_CAPABILITY_ORACLE_FROZEN_RUNTIME_SUITE_HASH_DRIFT",
  );
  if (
    runtime.corpusSnapshot.bundleHash
      !== frozen.corpusBundleHash
  ) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_RUNTIME_CORPUS_DRIFT",
    );
  }

  const boundaryBytes = await readRequired(
    paths.boundary,
    "BOUNDARY",
  );
  const boundary = BoundarySchema.parse(
    parseJson(boundaryBytes, "BOUNDARY"),
  );
  assertBoundaryBindings({
    boundary,
    split: parsed.split,
    runId: parsed.runId,
    runtime,
    inventory,
  });

  const artifactEntries = [
    ["planner", "PLANNER"],
    ["provider", "PROVIDER"],
    ["candidate", "CANDIDATE"],
    ["matrix", "MATRIX"],
    ["selection", "SELECTION"],
  ] as const;
  const artifactBytes = new Map<
    typeof artifactEntries[number][0],
    Uint8Array
  >();
  for (const [artifact, label] of artifactEntries) {
    const bytes = await readRequired(
      paths[artifact],
      label,
    );
    assertRawSeal({
      artifact: label,
      expectedPath: paths[artifact],
      seal: boundary.artifacts[artifact],
      bytes,
    });
    artifactBytes.set(artifact, bytes);
  }

  const planner = PlannerSchema.parse(
    parseJson(
      artifactBytes.get("planner")!,
      "PLANNER",
    ),
  );
  const provider = ProviderSchema.parse(
    parseJson(
      artifactBytes.get("provider")!,
      "PROVIDER",
    ),
  );
  const candidate =
    T44ObligationCandidateArtifactV1Schema.parse(
      parseJson(
        artifactBytes.get("candidate")!,
        "CANDIDATE",
      ),
    );
  const matrix = MatrixSchema.parse(
    parseJson(
      artifactBytes.get("matrix")!,
      "MATRIX",
    ),
  );
  const selection =
    T44ObligationSelectionArtifactV1Schema.parse(
      parseJson(
        artifactBytes.get("selection")!,
        "SELECTION",
      ),
    );
  const candidateSha256 = sha256(
    artifactBytes.get("candidate")!,
  );
  const matrixSha256 = sha256(
    artifactBytes.get("matrix")!,
  );
  if (
    selection.candidateArtifactSha256
      !== candidateSha256
  ) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_SELECTION_CANDIDATE_SHA_DRIFT",
    );
  }
  if (
    selection.matrixOutputSha256 !== matrixSha256
  ) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_SELECTION_MATRIX_SHA_DRIFT",
    );
  }
  if (
    selection.selectorConfigId
      !== T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2.id
    || selection.selectorConfigVersion
      !== T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2
        .version
    || selection.selectorConfigHash
      !== T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2
  ) {
    throw new Error(
      "T45_CAPABILITY_ORACLE_SELECTOR_CONFIG_HASH_DRIFT",
    );
  }
  assertCaseOrder({
    runtime,
    planner,
    candidate,
    matrix,
    selection,
  });
  const structuralReadiness =
    evaluateT45CandidateStructuralReadinessV1({
      candidate,
      selection,
      provider,
    });
  if (!structuralReadiness.passed) {
    throw new Error(
      "T45_CANDIDATE_STRUCTURAL_NO_GO:"
      + `baseline=${
        structuralReadiness.gates
          .baselineAvailable.observedCases
      }/20:protected=${
        structuralReadiness.gates
          .protectedAnchors.observedCases
      }/20:singleCount=${
        structuralReadiness.gates
          .baselineSingleCount.observedCases
      }/20`,
    );
  }

  const readQrels = dependencies.readQrelsReadOnly
    ?? readT45QrelsReadOnlyV1;
  const report = await (async () => {
    const qrelsBytes = await readQrels(paths.qrels);
    assertFrozenHash(
      sha256(qrelsBytes),
      frozen.qrelsBytesSha256[parsed.split],
      "T45_CAPABILITY_ORACLE_QRELS_BYTES_SHA_DRIFT",
    );
    const qrels =
      T45CapabilityQrelsSuiteSchema.parse(
        parseJson(qrelsBytes, "QRELS"),
      ) as T45CapabilityQrelsSuite;
    if (
      qrels.split !== parsed.split
      || t45CapabilityQrelsSuiteHash(qrels)
        !== qrels.suiteHash
    ) {
      throw new Error(
        "T45_CAPABILITY_ORACLE_QRELS_SUITE_HASH_DRIFT",
      );
    }
    assertFrozenHash(
      qrels.suiteHash,
      frozen.qrelsSuiteHashes[parsed.split],
      "T45_CAPABILITY_ORACLE_FROZEN_QRELS_SUITE_HASH_DRIFT",
    );
    if (
      qrels.runtimeSuite.id !== runtime.id
      || qrels.runtimeSuite.version
        !== runtime.version
      || qrels.runtimeSuite.suiteHash
        !== runtime.suiteHash
      || qrels.capabilityInventory.inventoryHash
        !== inventory.inventoryHash
      || qrels.corpusSnapshot.bundleHash
        !== frozen.corpusBundleHash
    ) {
      throw new Error(
        "T45_CAPABILITY_ORACLE_QRELS_SOURCE_BINDING_DRIFT",
      );
    }
    assertQrelsOrder({ runtime, qrels });
    return evaluateT45CandidateOracle({
      split: parsed.split,
      candidate,
      selection,
      qrels,
      inventory,
      structuralReadiness,
    });
  })();

  const seal = await writeOrVerifyOracleArtifact(
    paths.oracle,
    report,
    "ARTIFACT",
  );
  const gate = sealT45CandidateOracleGateV1({
    schemaVersion: 1,
    kind:
      "T45_CAPABILITY_CANDIDATE_ORACLE_GATE",
    split: parsed.split,
    runId: parsed.runId,
    runtimeSuite: {
      id: runtime.id,
      version: runtime.version,
      suiteHash: runtime.suiteHash,
    },
    inventoryHash: inventory.inventoryHash,
    corpusBundleHash: inventory.corpusBundleHash,
    inputs: {
      boundarySha256: sha256(boundaryBytes),
      plannerSha256: sha256(
        artifactBytes.get("planner")!,
      ),
      candidateSha256,
      matrixSha256,
      baselineSelectionSha256: sha256(
        artifactBytes.get("selection")!,
      ),
      oracleReportSha256: seal.sha256,
    },
    selectorConfigHash:
      T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
    candidateOracle: report.candidateOracle,
    decision: report.decision,
    evaluatorConfigHash:
      T45_CAPABILITY_EVALUATOR_CONFIG_HASH_V1,
  });
  const gateSeal =
    await writeOrVerifyOracleArtifact(
      paths.oracleGate,
      gate,
      "GATE",
    );
  const verifiedGate =
    verifyT45CandidateOracleGateV1(
      parseJson(
        await readRequired(paths.oracleGate, "GATE"),
        "GATE",
      ),
    );
  return {
    report,
    seal,
    gate: verifiedGate,
    gateSeal,
  };
}

export function formatT45CapabilityOracleErrorCodeV1(
  error: unknown,
) {
  const message = error instanceof Error
    ? error.message
    : "";
  return message.match(
    /^(T45_[A-Z0-9]+(?:_[A-Z0-9]+)*)/,
  )?.[1]
    ?? "T45_CAPABILITY_ORACLE_UNEXPECTED_ERROR";
}

async function main() {
  const result = await runT45CapabilityOracleCli(
    process.argv.slice(2),
  );
  process.stdout.write(
    serializeT45CapabilityOracleStdoutV1(
      result.report,
    ),
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
      `${formatT45CapabilityOracleErrorCodeV1(error)}\n`,
    );
    process.exitCode = 1;
  });
}
