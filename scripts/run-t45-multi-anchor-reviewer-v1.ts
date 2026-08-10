import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  guardModelProviderSecretOutputs,
} from "@/lib/agent/evaluation-safety";
import {
  createOpenAICompatibleModelProvider,
  type ModelProviderAdapter,
} from "@/lib/agent/model-provider-adapter";
import { isGpt56ModelId } from "@/lib/ai/model-id";
import {
  readEnv,
  resolvePlannerModelConfiguration,
} from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
} from "@/lib/config/runtime-environment";
import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  buildT44ContentRerankerPromptsForCasesV1,
  runT44ContentRerankerModelBatchV1,
} from "@/scripts/run-t44-content-reranker-v1";
import {
  T44_CONTENT_RERANKER_CONFIG_HASH_V1,
  T44_CONTENT_RERANKER_CONFIG_V1,
  T44ContentRerankerSelectionCaseV1Schema,
  type T44ContentRerankerPromptV1,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import {
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_V2,
  T44ObligationSelectionArtifactV1Schema,
} from "@/tools/mixed-retrieval/t44-obligation-label-blind-v2";
import {
  T44ObligationCandidateArtifactV1Schema,
} from "@/tools/mixed-retrieval/t44-obligation-candidate-evaluator";
import {
  assertT45CandidateOracleReadyForSelection,
  verifyT45CandidateOracleGateV1,
  type T45CandidateOracleGateV1,
} from "@/tools/mixed-retrieval/t45-candidate-oracle-gate-v1";
import {
  T45_MULTI_ANCHOR_PROMPT_TEMPLATE_HASH_V1,
  T45_MULTI_ANCHOR_REVIEWER_CONFIG_HASH_V1,
  T45_MULTI_ANCHOR_REVIEWER_CONFIG_V1,
  applyT45MultiAnchorCompletionV1,
  buildT45MultiAnchorPromptV1,
  buildT45ProtectedBaselineMap,
} from "@/tools/mixed-retrieval/t45-multi-anchor-reviewer-v1";
import {
  validateT45FinalArtifactV1,
} from "@/tools/mixed-retrieval/t45-final-artifact-validator-v1";
import {
  verifyT45AuditReceiptV1,
  type T45AuditReceiptV1,
} from "@/tools/mixed-retrieval/t45-audit-receipt-v1";
import {
  T45_FROZEN_RUNTIME_BINDINGS_V1,
  loadT45RuntimePort,
} from "@/tools/mixed-retrieval/t45-obligation-runtime-port";
import {
  captureT45SelectorSourceClosureV1,
  collectT45SelectorSourceFilesV1,
} from "@/tools/mixed-retrieval/t45-selector-source-closure-v1";
import {
  acquireT45StageReservationV1,
  publishT45SealedCheckpointV1,
} from "@/tools/mixed-retrieval/t45-sealed-checkpoint-v1";

const HASH = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HashSchema = z.string().regex(HASH);
const IdSchema = z.string().regex(ID);
const ARTIFACT_ROOT = ".runtime/mixed-retrieval";

const LEGACY_BINDINGS = Object.freeze({
  planner:
    "ed24337313dea252e34ab1555b7eeffb9844681ef386e7d2d49211839fe6671a",
  candidate:
    "516116610ea9e2c053f0c7b245936871cacdb018334e9b56208255dbd207d71e",
  matrix:
    "ad5cdf252c764e9df9937c6d89026d2d96384999fd8b2985802243421f829c71",
  baselineSelection:
    "c4bd1ef00c80219bc04a2b247d67b657722ef762ef982cc457c5317da4f20d27",
  oracle:
    "c82b35d7f9c43160bb1773f2370218f0551157542c891449909cd97d76f814e3",
  runtime:
    "535dd44ede63a02fd97fc64626287c76a2f715f89fd6fe23a10e87c00bdd0599",
} as const);

export type T45ReviewerSplit =
  | "CALIBRATION"
  | "VALIDATION"
  | "LEGACY_REGRESSION";

export type T45ReviewerArguments = {
  split: T45ReviewerSplit;
  runId: string;
  artifactId: string;
};

export function parseT45MultiAnchorReviewerArguments(
  argv: readonly string[],
): T45ReviewerArguments {
  const args = argv[0] === "--"
    ? argv.slice(1)
    : [...argv];
  if (
    args.length !== 6
    || args[0] !== "--split"
    || args[2] !== "--run-id"
    || args[4] !== "--artifact-id"
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_CLI_ARGUMENTS_INVALID",
    );
  }
  const split = args[1] === "calibration"
    ? "CALIBRATION"
    : args[1] === "validation"
      ? "VALIDATION"
      : args[1] === "legacy-regression"
        ? "LEGACY_REGRESSION"
        : null;
  const runId = args[3] ?? "";
  const artifactId = args[5] ?? "";
  if (
    !split
    || !ID.test(runId)
    || !ID.test(artifactId)
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_CLI_IDENTITY_INVALID",
    );
  }
  const valid = split === "CALIBRATION"
    ? /^calibration-v[1-9][0-9]*$/.test(runId)
      && artifactId === runId
    : split === "VALIDATION"
      ? runId === "validation-v1"
        && artifactId === "validation-v1"
      : runId === "legacy-v2"
        && artifactId === "legacy-regression-v1";
  if (!valid) {
    throw new Error(
      "T45_MULTI_ANCHOR_CLI_IDENTITY_LOCKED",
    );
  }
  return { split, runId, artifactId };
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function canonicalJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

type SealedRead<T> = {
  path: string;
  bytes: number;
  sha256: string;
  value: T;
  serialized: string;
};

async function readJson<T>(
  target: string,
  label: string,
  parse: (value: unknown) => T,
): Promise<SealedRead<T>> {
  let serialized: string;
  try {
    serialized = await readFile(target, "utf8");
  } catch {
    throw new Error(
      `T45_MULTI_ANCHOR_${label}_MISSING`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error(
      `T45_MULTI_ANCHOR_${label}_JSON_INVALID`,
    );
  }
  return {
    path: path.resolve(target),
    bytes: Buffer.byteLength(serialized, "utf8"),
    sha256: sha256(serialized),
    value: parse(raw),
    serialized,
  };
}

async function readIfExists<T>(
  target: string,
  parse: (value: unknown) => T,
) {
  try {
    const serialized = await readFile(target, "utf8");
    return {
      path: path.resolve(target),
      bytes: Buffer.byteLength(serialized, "utf8"),
      sha256: sha256(serialized),
      value: parse(JSON.parse(serialized) as unknown),
      serialized,
    };
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

async function readBytes(
  target: string,
  label: string,
) {
  let bytes: Buffer;
  try {
    bytes = await readFile(target);
  } catch {
    throw new Error(
      `T45_MULTI_ANCHOR_${label}_MISSING`,
    );
  }
  return {
    path: path.resolve(target),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    serialized: bytes,
  };
}

async function writeNew(
  target: string,
  value: unknown,
) {
  const serialized = canonicalJson(value);
  const published =
    await publishT45SealedCheckpointV1({
      target,
      bytes: serialized,
      errorPrefix:
        "T45_MULTI_ANCHOR_ARTIFACT",
    });
  const observed = published.bytes.toString("utf8");
  if (observed !== serialized) {
    throw new Error(
      "T45_MULTI_ANCHOR_ARTIFACT_BYTE_DRIFT",
    );
  }
  return {
    path: published.path,
    bytes: published.bytes.byteLength,
    sha256: sha256(published.bytes),
    serialized: observed,
  };
}

const ModelProvenanceSchema = z
  .object({
    source: z.literal("service-env"),
    modelId: z.string().trim().min(1).max(200),
    endpointHash: HashSchema,
    configHash: HashSchema,
  })
  .strict();
export type T45ModelProvenanceV1 = z.infer<
  typeof ModelProvenanceSchema
>;

const RuntimeSuiteSchema = z
  .object({
    id: IdSchema,
    version: z.string().trim().min(1).max(50),
    suiteHash: HashSchema,
    split: z.enum([
      "CALIBRATION",
      "VALIDATION",
      "LEGACY_REGRESSION",
    ]),
  })
  .strict();

const SourceInputsSchema = z
  .object({
    boundarySha256: HashSchema,
    plannerSha256: HashSchema,
    candidateSha256: HashSchema,
    matrixSha256: HashSchema,
    baselineSelectionSha256: HashSchema,
    oracleGateSha256: HashSchema.nullable(),
  })
  .strict();

const UsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict();

export const T45ContentDraftArtifactV1Schema =
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal(
      "T45_CONTENT_DRAFT_SELECTIONS",
    ),
    runId: IdSchema,
    artifactId: IdSchema,
    runtimeSuite: RuntimeSuiteSchema,
    inventoryHash: HashSchema,
    sourceClosureHash: HashSchema,
    inputs: SourceInputsSchema,
    configHash: z.literal(
      T44_CONTENT_RERANKER_CONFIG_HASH_V1,
    ),
    model: ModelProvenanceSchema,
    cases: z.array(
      T44ContentRerankerSelectionCaseV1Schema,
    ).min(1).max(50),
    summary: z.object({
      total: z.number().int().min(1).max(50),
      valid: z.number().int().nonnegative(),
      invalid: z.number().int().nonnegative(),
    }).strict(),
    generatedAt: z.string().datetime(),
  }).strict();

const FinalSelectedSchema = z
  .object({
    candidateIndex: z.number().int().min(1).max(184),
    nodeId: IdSchema,
    objectId: IdSchema,
    coursePackId: IdSchema,
    role: z.enum(["FACT", "ACTION", "TABLE"]),
    text: z.string().trim().min(1).max(32_000),
    nodeContentHash: HashSchema,
    baselineRank:
      z.number().int().min(1).max(8).nullable(),
    wholeQueryRank:
      z.number().int().min(1).max(184).nullable(),
    obligationRanks: z.array(z.object({
      obligationId: z.string(),
      rank: z.number().int().positive(),
    }).strict()).max(4),
    obligationIds: z.array(z.string()).min(1).max(4),
    evidenceRole: z.enum([
      "DIRECT",
      "COMPLEMENT",
      "CONTEXT",
    ]),
    protectedBaseline: z.boolean(),
    protectedBaselineOrder:
      z.number().int().min(1).max(8).nullable(),
  })
  .strict();

const StageAuditSchema = z.object({
  draft: z.object({
    elapsedMs: z.number().finite().nonnegative(),
    usage: UsageSchema,
  }).strict(),
  reviewer: z.object({
    elapsedMs: z.number().finite().nonnegative(),
    usage: UsageSchema,
  }).strict(),
  endToEnd: z.object({
    elapsedMs: z.number().finite().nonnegative(),
    usage: UsageSchema,
  }).strict(),
}).strict();

export const T45FinalSelectionCaseV1Schema =
  z.object({
    caseId: IdSchema,
    coursePackId: IdSchema,
    candidateMapHash: HashSchema,
    promptHash: HashSchema,
    status: z.enum(["VALID", "INVALID"]),
    failureCategory:
      z.string().trim().min(1).max(100).nullable(),
    selected: z.array(FinalSelectedSchema).max(8),
    audit: z.object({
      elapsedMs: z.number().finite().nonnegative(),
      rawOutputHash: HashSchema.nullable(),
      usage: UsageSchema,
    }).strict(),
    stageAudit: StageAuditSchema,
    completion: z.object({
      modelSelectionLedger: z.array(z.object({
        nodeId: IdSchema,
        obligationIds:
          z.array(IdSchema).min(1).max(8),
        evidenceRole: z.enum([
          "DIRECT",
          "COMPLEMENT",
          "CONTEXT",
        ]),
      }).strict()).max(8),
      obligationAnchors: z.array(z.object({
        obligationId: IdSchema,
        nodeId: IdSchema,
      }).strict()).max(8),
      protectedKept: z.array(IdSchema).max(8),
      modelSelectedBaselineKept:
        z.array(IdSchema).max(8),
      baselineRejected: z.array(z.object({
        nodeId: IdSchema,
        reason: z.literal(
          "EXPLICIT_STUDENT_PREMISE_OR_EXCLUSION",
        ),
      }).strict()).max(8),
      modelAdded: z.array(IdSchema).max(8),
      deterministicAdded: z.array(IdSchema).max(8),
      unprotectedDropped: z.array(IdSchema).max(184),
    }).strict(),
    bindingViolations: z.array(z.string()).max(32),
  }).strict();

export const T45FinalSelectionArtifactV1Schema =
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal(
      "T45_MULTI_ANCHOR_SELECTIONS",
    ),
    runId: IdSchema,
    artifactId: IdSchema,
    runtimeSuite: RuntimeSuiteSchema,
    inventoryHash: HashSchema,
    sourceClosureHash: HashSchema,
    inputs: SourceInputsSchema.extend({
      draftSelectionSha256: HashSchema,
    }).strict(),
    configHash: z.literal(
      T45_MULTI_ANCHOR_REVIEWER_CONFIG_HASH_V1,
    ),
    model: ModelProvenanceSchema,
    cases: z.array(
      T45FinalSelectionCaseV1Schema,
    ).min(1).max(50),
    summary: z.object({
      total: z.number().int().min(1).max(50),
      valid: z.number().int().nonnegative(),
      invalid: z.number().int().nonnegative(),
    }).strict(),
    generatedAt: z.string().datetime(),
  }).strict();

export type T45FinalSelectionArtifactV1 = z.infer<
  typeof T45FinalSelectionArtifactV1Schema
>;

const BoundarySchema = z.object({
  runId: IdSchema,
  split: z.enum(["CALIBRATION", "VALIDATION"]),
  runtimeSuite: z.object({
    id: IdSchema,
    version: z.string(),
    suiteHash: HashSchema,
  }).strict(),
  capabilityInventory: z.object({
    inventoryHash: HashSchema,
  }).strict(),
  corpusSnapshot: z.object({
    bundleHash: HashSchema,
  }).strict(),
  artifacts: z.object({
    planner: z.object({
      sha256: HashSchema,
      bytes: z.number().int().positive(),
      path: z.string(),
    }).passthrough(),
    candidate: z.object({
      sha256: HashSchema,
      bytes: z.number().int().positive(),
      path: z.string(),
    }).passthrough(),
    matrix: z.object({
      sha256: HashSchema,
      bytes: z.number().int().positive(),
      path: z.string(),
    }).passthrough(),
    selection: z.object({
      sha256: HashSchema,
      bytes: z.number().int().positive(),
      path: z.string(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

export const T45LegacyValidationReportV1Schema =
z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("T45_MULTI_ANCHOR_AUDIT"),
  split: z.literal("VALIDATION"),
  runId: z.literal("validation-v1"),
  artifactId: z.literal("validation-v1"),
  decision: z.enum([
    "VALIDATION_GO",
    "VALIDATION_SELECTOR_NO_GO",
  ]),
  inputs: z.object({
    selectionSha256: HashSchema,
    draftSelectionSha256: HashSchema,
    oracleGateSha256: HashSchema,
    freezeHash: HashSchema,
    source: SourceInputsSchema,
  }).strict(),
}).passthrough();

export type T45ReviewerSourceBundleV1 = {
  runtimeSuite: z.infer<typeof RuntimeSuiteSchema>;
  inventoryHash: string;
  corpusBundleHash: string;
  inputs: z.infer<typeof SourceInputsSchema>;
  prompts: T44ContentRerankerPromptV1[];
  candidate: ReturnType<
    typeof T44ObligationCandidateArtifactV1Schema.parse
  >;
  baselineSelection: ReturnType<
    typeof T44ObligationSelectionArtifactV1Schema.parse
  >;
  gate: T45CandidateOracleGateV1 | null;
};

function assertSourceSelector(
  selection: T45ReviewerSourceBundleV1["baselineSelection"],
) {
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
      "T45_MULTI_ANCHOR_SOURCE_SELECTOR_DRIFT",
    );
  }
}

async function loadCapabilitySource(
  parsed: T45ReviewerArguments,
  workspaceRoot: string,
): Promise<T45ReviewerSourceBundleV1> {
  const split = parsed.split as
    | "CALIBRATION"
    | "VALIDATION";
  const stem = `t45-capability-${parsed.runId}`;
  const root = path.resolve(
    workspaceRoot,
    ARTIFACT_ROOT,
  );
  const paths = {
    boundary: path.join(root, `${stem}.boundary.json`),
    planner: path.join(root, `${stem}.planner.json`),
    candidate: path.join(root, `${stem}.candidate.json`),
    matrix: path.join(root, `${stem}.matrix.json`),
    selection: path.join(root, `${stem}.selection.json`),
    gate: path.join(root, `${stem}.oracle-gate.json`),
  };
  const [
    boundary,
    planner,
    candidate,
    matrix,
    selection,
    gate,
  ] = await Promise.all([
    readJson(paths.boundary, "BOUNDARY", (value) =>
      BoundarySchema.parse(value)),
    readJson(paths.planner, "PLANNER", (value) => value),
    readJson(paths.candidate, "CANDIDATE", (value) =>
      T44ObligationCandidateArtifactV1Schema.parse(
        value,
      )),
    readJson(paths.matrix, "MATRIX", (value) => value),
    readJson(paths.selection, "SELECTION", (value) =>
      T44ObligationSelectionArtifactV1Schema.parse(
        value,
      )),
    readJson(paths.gate, "ORACLE_GATE", (value) =>
      verifyT45CandidateOracleGateV1(value)),
  ]);
  const port = await loadT45RuntimePort({
    workspaceRoot,
    split,
  });
  const b = boundary.value;
  if (
    b.runId !== parsed.runId
    || b.split !== split
    || b.runtimeSuite.id !== port.identity.id
    || b.runtimeSuite.version
      !== port.identity.version
    || b.runtimeSuite.suiteHash
      !== port.identity.suiteHash
    || b.capabilityInventory.inventoryHash
      !== port.identity.inventoryHash
    || b.corpusSnapshot.bundleHash
      !== port.identity.corpusBundleHash
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_BOUNDARY_IDENTITY_DRIFT",
    );
  }
  const actual = {
    boundarySha256: boundary.sha256,
    plannerSha256: planner.sha256,
    candidateSha256: candidate.sha256,
    matrixSha256: matrix.sha256,
    baselineSelectionSha256: selection.sha256,
    oracleGateSha256: gate.sha256,
  };
  const expected = gate.value.inputs;
  for (
    const [field, value]
    of Object.entries({
      boundarySha256: actual.boundarySha256,
      plannerSha256: actual.plannerSha256,
      candidateSha256: actual.candidateSha256,
      matrixSha256: actual.matrixSha256,
      baselineSelectionSha256:
        actual.baselineSelectionSha256,
    })
  ) {
    if (
      expected[field as keyof typeof expected]
        !== value
    ) {
      throw new Error(
        `T45_MULTI_ANCHOR_GATE_${field.toUpperCase()}_DRIFT`,
      );
    }
  }
  if (
    gate.value.split !== split
    || gate.value.runId !== parsed.runId
    || gate.value.runtimeSuite.suiteHash
      !== port.identity.suiteHash
    || gate.value.inventoryHash
      !== port.identity.inventoryHash
    || gate.value.corpusBundleHash
      !== port.identity.corpusBundleHash
    || gate.value.selectorConfigHash
      !== T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_GATE_IDENTITY_DRIFT",
    );
  }
  assertSourceSelector(selection.value);
  const built =
    buildT44ContentRerankerPromptsForCasesV1({
      planner: planner.value,
      candidate: candidate.value,
      matrix: matrix.value,
      baselineSelection: selection.value,
      caseIdentities: port.cases.map(
        ({ caseId, coursePackId }) => ({
          caseId,
          coursePackId,
        }),
      ),
    });
  return {
    runtimeSuite: {
      id: port.identity.id,
      version: port.identity.version,
      suiteHash: port.identity.suiteHash,
      split,
    },
    inventoryHash: port.identity.inventoryHash,
    corpusBundleHash: port.identity.corpusBundleHash,
    inputs: actual,
    prompts: built.prompts,
    candidate: built.candidate,
    baselineSelection: selection.value,
    gate: gate.value,
  };
}

async function loadLegacySource(
  workspaceRoot: string,
  freeze: T45SelectorFreezeV1,
  dependencies: {
    loadValidationSource:
      typeof loadCapabilitySource;
    validateFinal:
      typeof validateT45FinalArtifactV1;
    captureSourceClosure:
      typeof captureT45SelectorSourceClosureV1;
  },
): Promise<T45ReviewerSourceBundleV1> {
  const root = path.resolve(
    workspaceRoot,
    ARTIFACT_ROOT,
  );
  const validationFinal = path.join(
    root,
    "t45-capability-validation-v1.multi-anchor-validation-v1.selection.json",
  );
  const validationReport = path.join(
    root,
    "t45-capability-validation-v1.multi-anchor-validation-v1.report.json",
  );
  const validationReceipt = path.join(
    root,
    "t45-capability-validation-v1.multi-anchor-validation-v1.receipt.json",
  );
  const validationDraft = path.join(
    root,
    "t45-capability-validation-v1.content-draft-validation-v1.selection.json",
  );
  const validationParsed: T45ReviewerArguments = {
    split: "VALIDATION",
    runId: "validation-v1",
    artifactId: "validation-v1",
  };
  const validationSource =
    await dependencies.loadValidationSource(
      validationParsed,
      workspaceRoot,
    );
  let validationSelection:
    SealedRead<T45FinalSelectionArtifactV1>;
  let sealedDraft:
    SealedRead<
      z.infer<typeof T45ContentDraftArtifactV1Schema>
    >;
  try {
    [
      validationSelection,
      sealedDraft,
    ] = await Promise.all([
      readJson(
        validationFinal,
        "LEGACY_VALIDATION_SELECTION",
        (value) =>
          T45FinalSelectionArtifactV1Schema
            .parse(value),
      ),
      readJson(
        validationDraft,
        "LEGACY_VALIDATION_DRAFT",
        (value) =>
          T45ContentDraftArtifactV1Schema
            .parse(value),
      ),
    ]);
  } catch {
    throw new Error(
      "T45_MULTI_ANCHOR_LEGACY_VALIDATION_NOT_SEALED",
    );
  }
  if (
    !same(
      validationSelection.value.model,
      freeze.model,
    )
    || !same(
      sealedDraft.value.model,
      freeze.model,
    )
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_LEGACY_VALIDATION_MODEL_FREEZE_DRIFT",
    );
  }
  const currentSourceClosure =
    dependencies.captureSourceClosure(
      workspaceRoot,
    );
  if (
    validationSelection.value.sourceClosureHash
      !== freeze.sourceClosureHash
    || sealedDraft.value.sourceClosureHash
      !== freeze.sourceClosureHash
    || currentSourceClosure.sourceClosureHash
      !== freeze.sourceClosureHash
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_LEGACY_VALIDATION_SOURCE_CLOSURE_FREEZE_DRIFT",
    );
  }
  dependencies.validateFinal({
    prompts: validationSource.prompts,
    candidate: validationSource.candidate,
    baselineSelection:
      validationSource.baselineSelection,
    draft: sealedDraft.value,
    final: validationSelection.value,
  });
  let validationAudit:
    Awaited<ReturnType<typeof readBytes>>;
  let validationAuditReceipt:
    SealedRead<T45AuditReceiptV1>;
  try {
    [
      validationAudit,
      validationAuditReceipt,
    ] = await Promise.all([
      readBytes(
        validationReport,
        "LEGACY_VALIDATION_REPORT",
      ),
      readJson(
        validationReceipt,
        "LEGACY_VALIDATION_RECEIPT",
        (value) => verifyT45AuditReceiptV1(value),
      ),
    ]);
  } catch {
    throw new Error(
      "T45_MULTI_ANCHOR_LEGACY_VALIDATION_NOT_SEALED",
    );
  }
  if (
    validationAuditReceipt.value
      .sourceClosureHash
      !== freeze.sourceClosureHash
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_LEGACY_VALIDATION_RECEIPT_SOURCE_CLOSURE_FREEZE_DRIFT",
    );
  }
  const validationGateValue =
    validationSource.gate;
  if (!validationGateValue) {
    throw new Error(
      "T45_MULTI_ANCHOR_LEGACY_VALIDATION_NOT_SEALED",
    );
  }
  assertT45CandidateOracleReadyForSelection(
    validationGateValue,
  );
  if (
    validationSelection.value.runId
      !== "validation-v1"
    || validationSelection.value.artifactId
      !== "validation-v1"
    || validationSelection.value.runtimeSuite.split
      !== "VALIDATION"
    || validationSelection.value.runtimeSuite.id
      !== "lumi-t45-capability-validation-runtime"
    || validationSelection.value.runtimeSuite.version
      !== "2026-07-29.1"
    || validationSelection.value.runtimeSuite.suiteHash
      !== T45_FROZEN_RUNTIME_BINDINGS_V1
        .suiteHashes.VALIDATION
    || validationSelection.value.inventoryHash
      !== T45_FROZEN_RUNTIME_BINDINGS_V1.inventoryHash
    || !same(
      validationSelection.value.runtimeSuite,
      validationSource.runtimeSuite,
    )
    || validationSelection.value.inventoryHash
      !== validationSource.inventoryHash
    || !same(
      {
        boundarySha256:
          validationSelection.value.inputs
            .boundarySha256,
        plannerSha256:
          validationSelection.value.inputs
            .plannerSha256,
        candidateSha256:
          validationSelection.value.inputs
            .candidateSha256,
        matrixSha256:
          validationSelection.value.inputs
            .matrixSha256,
        baselineSelectionSha256:
          validationSelection.value.inputs
            .baselineSelectionSha256,
        oracleGateSha256:
          validationSelection.value.inputs
            .oracleGateSha256,
      },
      validationSource.inputs,
    )
    || validationSelection.value.cases.length !== 20
    || validationSelection.value.cases.some(
      (testCase, index) =>
        testCase.caseId
          !== validationSource.prompts[index]?.caseId
        || testCase.coursePackId
          !== validationSource.prompts[index]?.coursePackId,
    )
    || validationAuditReceipt.value.inputs.selectionSha256
      !== validationSelection.sha256
    || validationAuditReceipt.value.inputs
      .draftSelectionSha256
      !== validationSelection.value.inputs
        .draftSelectionSha256
    || validationAuditReceipt.value.inputs
      .oracleGateSha256
      !== validationSelection.value.inputs
        .oracleGateSha256
    || validationAuditReceipt.value.inputs.freezeHash
      !== freeze.freezeHash
    || validationAuditReceipt.value.reportSha256
      !== validationAudit.sha256
    || validationAuditReceipt.value.split
      !== "VALIDATION"
    || validationAuditReceipt.value.runId
      !== "validation-v1"
    || validationAuditReceipt.value.artifactId
      !== "validation-v1"
    || (
      validationAuditReceipt.value.decision
        !== "VALIDATION_GO"
      && validationAuditReceipt.value.decision
        !== "VALIDATION_SELECTOR_NO_GO"
    )
    || !same(
      validationAuditReceipt.value.inputs.source,
      {
        boundarySha256:
          validationSelection.value.inputs
            .boundarySha256,
        plannerSha256:
          validationSelection.value.inputs
            .plannerSha256,
        candidateSha256:
          validationSelection.value.inputs
            .candidateSha256,
        matrixSha256:
          validationSelection.value.inputs
            .matrixSha256,
        baselineSelectionSha256:
          validationSelection.value.inputs
            .baselineSelectionSha256,
        oracleGateSha256:
          validationSelection.value.inputs
            .oracleGateSha256,
      },
    )
    || validationSelection.value.inputs
      .draftSelectionSha256 !== sealedDraft.sha256
    || validationSelection.value.inputs
      .oracleGateSha256
      !== validationSource.inputs.oracleGateSha256
    || !same(
      sealedDraft.value.runtimeSuite,
      validationSelection.value.runtimeSuite,
    )
    || sealedDraft.value.inventoryHash
      !== validationSelection.value.inventoryHash
    || !same(
      sealedDraft.value.inputs,
      validationAuditReceipt.value.inputs.source,
    )
    || !same(
      sealedDraft.value.model,
      validationSelection.value.model,
    )
    || sealedDraft.value.cases.length !== 20
    || sealedDraft.value.cases.some(
      (testCase, index) =>
        testCase.caseId
          !== validationSource.prompts[index]?.caseId
        || testCase.coursePackId
          !== validationSource.prompts[index]?.coursePackId,
    )
    || validationGateValue.split !== "VALIDATION"
    || validationGateValue.runId !== "validation-v1"
    || validationGateValue.runtimeSuite.suiteHash
      !== T45_FROZEN_RUNTIME_BINDINGS_V1
        .suiteHashes.VALIDATION
    || validationGateValue.inventoryHash
      !== T45_FROZEN_RUNTIME_BINDINGS_V1.inventoryHash
    || validationGateValue.corpusBundleHash
      !== T45_FROZEN_RUNTIME_BINDINGS_V1
        .corpusBundleHash
    || validationGateValue.inputs.boundarySha256
      !== validationSelection.value.inputs
        .boundarySha256
    || validationGateValue.inputs.plannerSha256
      !== validationSelection.value.inputs
        .plannerSha256
    || validationGateValue.inputs.candidateSha256
      !== validationSelection.value.inputs
        .candidateSha256
    || validationGateValue.inputs.matrixSha256
      !== validationSelection.value.inputs
        .matrixSha256
    || validationGateValue.inputs
      .baselineSelectionSha256
      !== validationSelection.value.inputs
        .baselineSelectionSha256
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_LEGACY_VALIDATION_NOT_SEALED",
    );
  }
  const stem = path.join(
    root,
    "t44-obligation-legacy-v2",
  );
  const [
    planner,
    candidate,
    matrix,
    selection,
    oracle,
    runtime,
  ] = await Promise.all([
    readJson(`${stem}.planner.json`, "LEGACY_PLANNER",
      (value) => value),
    readJson(`${stem}.candidate.json`, "LEGACY_CANDIDATE",
      (value) =>
        T44ObligationCandidateArtifactV1Schema.parse(
          value,
        )),
    readJson(`${stem}.matrix.json`, "LEGACY_MATRIX",
      (value) => value),
    readJson(
      `${stem}.baseline-protected-v2.selection.json`,
      "LEGACY_SELECTION",
      (value) =>
        T44ObligationSelectionArtifactV1Schema.parse(
          value,
        ),
    ),
    readBytes(
      `${stem}.baseline-protected-v2.oracle-v1.json`,
      "LEGACY_ORACLE",
    ),
    readJson(
      path.resolve(
        workspaceRoot,
        "tests/retrieval-quality/t44-support-dev.runtime.json",
      ),
      "LEGACY_RUNTIME",
      (value) => z.object({
        id: IdSchema,
        version: z.string(),
        suiteHash: HashSchema,
        corpusSnapshot: z.object({
          bundleHash: HashSchema,
        }).passthrough(),
        cases: z.array(z.object({
          caseId: IdSchema,
          coursePackId: IdSchema,
        }).passthrough()).length(50),
      }).passthrough().parse(value),
    ),
  ]);
  const observed = {
    planner: planner.sha256,
    candidate: candidate.sha256,
    matrix: matrix.sha256,
    baselineSelection: selection.sha256,
    oracle: oracle.sha256,
    runtime: runtime.sha256,
  };
  for (
    const field
    of Object.keys(LEGACY_BINDINGS) as Array<
      keyof typeof LEGACY_BINDINGS
    >
  ) {
    if (observed[field] !== LEGACY_BINDINGS[field]) {
      throw new Error(
        `T45_MULTI_ANCHOR_LEGACY_${field.toUpperCase()}_SHA_DRIFT`,
      );
    }
  }
  assertSourceSelector(selection.value);
  const built =
    buildT44ContentRerankerPromptsForCasesV1({
      planner: planner.value,
      candidate: candidate.value,
      matrix: matrix.value,
      baselineSelection: selection.value,
      caseIdentities: runtime.value.cases.map(
        ({ caseId, coursePackId }) => ({
          caseId,
          coursePackId,
        }),
      ),
    });
  return {
    runtimeSuite: {
      id: runtime.value.id,
      version: runtime.value.version,
      suiteHash: runtime.value.suiteHash,
      split: "LEGACY_REGRESSION",
    },
    inventoryHash:
      T45_FROZEN_RUNTIME_BINDINGS_V1.inventoryHash,
    corpusBundleHash:
      runtime.value.corpusSnapshot.bundleHash,
    inputs: {
      boundarySha256: oracle.sha256,
      plannerSha256: planner.sha256,
      candidateSha256: candidate.sha256,
      matrixSha256: matrix.sha256,
      baselineSelectionSha256: selection.sha256,
      oracleGateSha256: null,
    },
    prompts: built.prompts,
    candidate: built.candidate,
    baselineSelection: selection.value,
    gate: null,
  };
}

export const T45SelectorFreezeV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("T45_SELECTOR_FREEZE"),
    calibration: z.object({
      runId: IdSchema,
      artifactId: IdSchema,
      selectionSha256: HashSchema,
      draftSelectionSha256: HashSchema,
      reportSha256: HashSchema,
    }).strict(),
    model: ModelProvenanceSchema,
    sourceClosureHash: HashSchema,
    sourceFiles: z.array(z.object({
      path: z.string().min(1),
      sha256: HashSchema,
    }).strict()).min(1),
    runtimeConfig: z.object({
      draftConfigHash: HashSchema,
      reviewerConfigHash: HashSchema,
      systemPromptHash: HashSchema,
      promptTemplateHash: HashSchema,
      outputSchemaHash: HashSchema,
      baselineSelectorConfigHash: HashSchema,
    }).strict(),
    freezeHash: HashSchema,
  })
  .strict();

export type T45SelectorFreezeV1 = z.infer<
  typeof T45SelectorFreezeV1Schema
>;

export async function verifyT45SelectorFreezeV1(
  workspaceRoot: string,
) {
  const target = path.resolve(
    workspaceRoot,
    ARTIFACT_ROOT,
    "t45-selector-freeze-v1.json",
  );
  const loaded = await readJson(
    target,
    "FREEZE",
    (value) => T45SelectorFreezeV1Schema.parse(value),
  );
  const {
    freezeHash,
    ...projection
  } = loaded.value;
  if (
    sha256StableJsonV2(projection) !== freezeHash
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_FREEZE_HASH_DRIFT",
    );
  }
  if (
    sha256StableJsonV2(loaded.value.sourceFiles)
      !== loaded.value.sourceClosureHash
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_FREEZE_SOURCE_CLOSURE_HASH_DRIFT",
    );
  }
  const expectedSourcePaths =
    collectT45SelectorSourceFilesV1(workspaceRoot);
  const frozenSourcePaths =
    loaded.value.sourceFiles.map(
      ({ path: sourcePath }) => sourcePath,
    );
  if (!same(
    frozenSourcePaths,
    expectedSourcePaths,
  )) {
    throw new Error(
      "T45_MULTI_ANCHOR_FREEZE_SOURCE_CLOSURE_DRIFT",
    );
  }
  for (const source of loaded.value.sourceFiles) {
    const bytes = await readFile(
      path.resolve(workspaceRoot, source.path),
    );
    if (sha256(bytes) !== source.sha256) {
      throw new Error(
        `T45_MULTI_ANCHOR_FREEZE_SOURCE_DRIFT:${source.path}`,
      );
    }
  }
  const expectedConfig = {
    draftConfigHash:
      T44_CONTENT_RERANKER_CONFIG_HASH_V1,
    reviewerConfigHash:
      T45_MULTI_ANCHOR_REVIEWER_CONFIG_HASH_V1,
    systemPromptHash:
      T45_MULTI_ANCHOR_REVIEWER_CONFIG_V1
        .systemPromptHash,
    promptTemplateHash:
      T45_MULTI_ANCHOR_PROMPT_TEMPLATE_HASH_V1,
    outputSchemaHash:
      T44_CONTENT_RERANKER_CONFIG_V1.modelCall
        .structuredOutputSchemaHash,
    baselineSelectorConfigHash:
      T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
  };
  if (
    sha256StableJsonV2(
      loaded.value.runtimeConfig,
    ) !== sha256StableJsonV2(expectedConfig)
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_FREEZE_CONFIG_DRIFT",
    );
  }
  return loaded.value;
}

export const T45_EFFECTIVE_VISION_V1 = false;

type T45ProviderConfigurationV1 = {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  idleTimeoutMs: number;
  totalTimeoutMs: number;
  vision: false;
};

export type T45ResolvedModelRuntimeV1 = {
  provenance: T45ModelProvenanceV1;
  provider: T45ProviderConfigurationV1;
};

export function buildT45ResolvedModelRuntimeV1(
  input: {
    source: "service-env";
    modelId: string;
    baseUrl: string;
    apiKey: string;
    providerSelection: string;
    maxOutputTokens: number;
    configuredVision: boolean;
  },
): T45ResolvedModelRuntimeV1 {
  void input.configuredVision;
  const endpointHash = sha256(
    new URL(input.baseUrl).toString(),
  );
  const credentialSlotHash = sha256(
    "lumi:t45:credential-slot:v1\0"
    + input.apiKey,
  );
  const configHash = sha256StableJsonV2({
    source: input.source,
    modelId: input.modelId,
    endpointHash,
    providerSelection: input.providerSelection,
    maxOutputTokens: input.maxOutputTokens,
    credentialSlotHash,
    vision: T45_EFFECTIVE_VISION_V1,
    reasoningEffort:
      T44_CONTENT_RERANKER_CONFIG_V1.modelCall
        .reasoningEffort,
    idleTimeoutMs:
      T45_MULTI_ANCHOR_REVIEWER_CONFIG_V1.modelCall
        .idleTimeoutMs,
    totalTimeoutMs:
      T45_MULTI_ANCHOR_REVIEWER_CONFIG_V1.modelCall
        .totalTimeoutMs,
  });
  return {
    provenance: ModelProvenanceSchema.parse({
      source: input.source,
      modelId: input.modelId,
      endpointHash,
      configHash,
    }),
    provider: {
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.modelId,
      maxOutputTokens: input.maxOutputTokens,
      idleTimeoutMs:
        T45_MULTI_ANCHOR_REVIEWER_CONFIG_V1.modelCall
          .idleTimeoutMs,
      totalTimeoutMs:
        T45_MULTI_ANCHOR_REVIEWER_CONFIG_V1.modelCall
          .totalTimeoutMs,
      vision: T45_EFFECTIVE_VISION_V1,
    },
  };
}

async function resolveModel(
  workspaceRoot: string,
) {
  const loadedEnvironment =
    await loadRuntimeEnvironment({
      cwd: workspaceRoot,
      mode: "SERVICE_REQUIRED",
      nodeEnv: "test",
    });
  const config = readEnv(
    loadedEnvironment.environment,
  );
  const planner =
    resolvePlannerModelConfiguration(config.ai);
  if (
    !planner.enabled
    || !isGpt56ModelId(planner.model)
    || loadedEnvironment.provenance.model.source
      !== "service-env"
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_SERVICE_MODEL_REQUIRED",
    );
  }
  return buildT45ResolvedModelRuntimeV1({
    source: "service-env",
    modelId: planner.model,
    baseUrl: planner.baseUrl,
    apiKey: planner.apiKey,
    providerSelection: planner.selection,
    maxOutputTokens: planner.maxOutputTokens,
    configuredVision: planner.vision,
  });
}

function createProvider(
  resolved: T45ResolvedModelRuntimeV1,
) {
  return guardModelProviderSecretOutputs(
    createOpenAICompatibleModelProvider({
      ...resolved.provider,
    }),
    resolved.provider.apiKey,
  );
}

function same(value: unknown, expected: unknown) {
  return sha256StableJsonV2(value)
    === sha256StableJsonV2(expected);
}

function assertArtifactBindings(
  artifact: {
    runId: string;
    artifactId: string;
    runtimeSuite: unknown;
    inventoryHash: string;
    inputs: unknown;
    model: T45ModelProvenanceV1;
  },
  parsed: T45ReviewerArguments,
  source: T45ReviewerSourceBundleV1,
  model: T45ModelProvenanceV1,
) {
  if (
    artifact.runId !== parsed.runId
    || artifact.artifactId !== parsed.artifactId
    || !same(
      artifact.runtimeSuite,
      source.runtimeSuite,
    )
    || artifact.inventoryHash
      !== source.inventoryHash
    || !same(
      artifact.inputs,
      source.inputs,
    )
    || !same(artifact.model, model)
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_CHECKPOINT_BINDING_DRIFT",
    );
  }
}

function addUsage(
  left: z.infer<typeof UsageSchema>,
  right: z.infer<typeof UsageSchema>,
) {
  return {
    inputTokens:
      left.inputTokens + right.inputTokens,
    outputTokens:
      left.outputTokens + right.outputTokens,
    totalTokens:
      left.totalTokens + right.totalTokens,
  };
}

export type T45ReviewerCliDependenciesV1 = {
  captureSourceClosure(
    workspaceRoot: string,
  ): ReturnType<
    typeof captureT45SelectorSourceClosureV1
  >;
  loadSource(
    parsed: T45ReviewerArguments,
    workspaceRoot: string,
    freeze: T45SelectorFreezeV1 | null,
  ): Promise<T45ReviewerSourceBundleV1>;
  resolveModel(
    workspaceRoot: string,
  ): Promise<T45ResolvedModelRuntimeV1>;
  createProvider(
    resolved: T45ResolvedModelRuntimeV1,
  ): ModelProviderAdapter;
  runModelBatch(input: {
    prompts: readonly T44ContentRerankerPromptV1[];
    model: ModelProviderAdapter;
  }): ReturnType<
    typeof runT44ContentRerankerModelBatchV1
  >;
  verifyFreeze(
    workspaceRoot: string,
  ): Promise<T45SelectorFreezeV1>;
};

const DEFAULT_DEPENDENCIES: T45ReviewerCliDependenciesV1 = {
  captureSourceClosure:
    captureT45SelectorSourceClosureV1,
  loadSource: loadT45ReviewerSourceBundleV1,
  resolveModel,
  createProvider,
  runModelBatch: runT45ReviewerModelBatchV1,
  verifyFreeze: verifyT45SelectorFreezeV1,
};

export function runT45ReviewerModelBatchV1(
  input: {
    prompts:
      readonly T44ContentRerankerPromptV1[];
    model: ModelProviderAdapter;
    onFailure?: (input: {
      caseId: string;
      error: unknown;
    }) => void;
  },
) {
  return runT44ContentRerankerModelBatchV1({
    ...input,
    totalTimeoutMs:
      T45_MULTI_ANCHOR_REVIEWER_CONFIG_V1
        .modelCall.totalTimeoutMs,
  });
}

export async function loadT45ReviewerSourceBundleV1(
  parsed: T45ReviewerArguments,
  workspaceRoot: string,
  freeze: T45SelectorFreezeV1 | null = null,
  overrides: Partial<{
    loadValidationSource:
      typeof loadCapabilitySource;
    validateFinal:
      typeof validateT45FinalArtifactV1;
    captureSourceClosure:
      typeof captureT45SelectorSourceClosureV1;
  }> = {},
) {
  if (parsed.split === "LEGACY_REGRESSION") {
    if (!freeze) {
      throw new Error(
        "T45_MULTI_ANCHOR_LEGACY_FREEZE_REQUIRED",
      );
    }
    return loadLegacySource(
      workspaceRoot,
      freeze,
      {
        loadValidationSource:
          overrides.loadValidationSource
          ?? loadCapabilitySource,
        validateFinal:
          overrides.validateFinal
          ?? validateT45FinalArtifactV1,
        captureSourceClosure:
          overrides.captureSourceClosure
          ?? captureT45SelectorSourceClosureV1,
      },
    );
  }
  return loadCapabilitySource(parsed, workspaceRoot);
}

export async function runT45MultiAnchorReviewerCli(
  argv: readonly string[],
  workspaceRoot = process.cwd(),
  overrides: Partial<
    T45ReviewerCliDependenciesV1
  > = {},
) {
  const parsed =
    parseT45MultiAnchorReviewerArguments(argv);
  const dependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...overrides,
  };
  const sourceClosure =
    dependencies.captureSourceClosure(workspaceRoot);
  const assertSourceClosure = () => {
    const observed =
      dependencies.captureSourceClosure(workspaceRoot);
    if (
      !same(observed.sourceFiles, sourceClosure.sourceFiles)
      || observed.sourceClosureHash
        !== sourceClosure.sourceClosureHash
    ) {
      throw new Error(
        "T45_MULTI_ANCHOR_SOURCE_CLOSURE_DRIFT",
      );
    }
  };
  let freeze = parsed.split === "LEGACY_REGRESSION"
    ? await dependencies.verifyFreeze(workspaceRoot)
    : null;
  const source = await dependencies.loadSource(
    parsed,
    workspaceRoot,
    freeze,
  );
  if (source.gate) {
    assertT45CandidateOracleReadyForSelection(
      source.gate,
    );
  }
  for (const sourcePrompt of source.prompts) {
    buildT45ProtectedBaselineMap({
      baselineProtectedSelection:
        source.baselineSelection,
      candidateArtifact: source.candidate,
      sourcePrompt,
    });
  }
  if (parsed.split === "VALIDATION") {
    freeze = await dependencies.verifyFreeze(
      workspaceRoot,
    );
  }
  const resolved =
    await dependencies.resolveModel(workspaceRoot);
  if (
    freeze
    && !same(
      freeze.model,
      resolved.provenance,
    )
  ) {
    throw new Error(
      "T45_MULTI_ANCHOR_FREEZE_MODEL_DRIFT",
    );
  }
  const root = path.resolve(
    workspaceRoot,
    ARTIFACT_ROOT,
  );
  const stem = `t45-capability-${parsed.runId}`;
  const draftPath = path.join(
    root,
    `${stem}.content-draft-${parsed.artifactId}.selection.json`,
  );
  const finalPath = path.join(
    root,
    `${stem}.multi-anchor-${parsed.artifactId}.selection.json`,
  );
  const existingFinal = await readIfExists(
    finalPath,
    (value) =>
      T45FinalSelectionArtifactV1Schema.parse(value),
  );
  if (existingFinal) {
    const finalDraft = await readIfExists(
      draftPath,
      (value) =>
        T45ContentDraftArtifactV1Schema.parse(value),
    );
    if (!finalDraft) {
      throw new Error(
        "T45_MULTI_ANCHOR_DRAFT_MISSING_FOR_FINAL",
      );
    }
    if (
      finalDraft.sha256
      !== existingFinal.value.inputs
        .draftSelectionSha256
    ) {
      throw new Error(
        "T45_MULTI_ANCHOR_FINAL_DRAFT_SHA_DRIFT",
      );
    }
    assertArtifactBindings(
      finalDraft.value,
      parsed,
      source,
      resolved.provenance,
    );
    if (
      finalDraft.value.sourceClosureHash
        !== sourceClosure.sourceClosureHash
      || existingFinal.value.sourceClosureHash
        !== sourceClosure.sourceClosureHash
    ) {
      throw new Error(
        "T45_MULTI_ANCHOR_SOURCE_CLOSURE_HASH_DRIFT",
      );
    }
    const sourceInputs = {
      boundarySha256:
        existingFinal.value.inputs.boundarySha256,
      plannerSha256:
        existingFinal.value.inputs.plannerSha256,
      candidateSha256:
        existingFinal.value.inputs.candidateSha256,
      matrixSha256:
        existingFinal.value.inputs.matrixSha256,
      baselineSelectionSha256:
        existingFinal.value.inputs
          .baselineSelectionSha256,
      oracleGateSha256:
        existingFinal.value.inputs
          .oracleGateSha256,
    };
    assertArtifactBindings(
      {
        ...existingFinal.value,
        inputs: sourceInputs,
      },
      parsed,
      source,
      resolved.provenance,
    );
    validateT45FinalArtifactV1({
      prompts: source.prompts,
      candidate: source.candidate,
      baselineSelection:
        source.baselineSelection,
      draft: finalDraft.value,
      final: existingFinal.value,
    });
    return {
      artifact: existingFinal.value,
      output: {
        path: existingFinal.path,
        bytes: existingFinal.bytes,
        sha256: existingFinal.sha256,
      },
      resumed: "FINAL" as const,
    };
  }
  let provider: ModelProviderAdapter | null = null;
  const requireProvider = () => {
    provider ??=
      dependencies.createProvider(resolved);
    return provider;
  };
  let draftRead = await readIfExists(
    draftPath,
    (value) =>
      T45ContentDraftArtifactV1Schema.parse(value),
  );
  const resumedDraft = draftRead !== null;
  if (draftRead) {
    assertArtifactBindings(
      draftRead.value,
      parsed,
      source,
      resolved.provenance,
    );
    if (
      draftRead.value.sourceClosureHash
        !== sourceClosure.sourceClosureHash
    ) {
      throw new Error(
        "T45_MULTI_ANCHOR_SOURCE_CLOSURE_HASH_DRIFT",
      );
    }
  } else {
    const reservation =
      await acquireT45StageReservationV1({
        target: `${draftPath}.reservation`,
        stage: `draft:${parsed.runId}`,
        runId: parsed.runId,
        artifactId: parsed.artifactId,
      });
    try {
      draftRead = await readIfExists(
        draftPath,
        (value) =>
          T45ContentDraftArtifactV1Schema.parse(
            value,
          ),
      );
      if (!draftRead) {
        assertSourceClosure();
        const cases =
          await dependencies.runModelBatch({
            prompts: source.prompts,
            model: requireProvider(),
          });
        const valid = cases.filter(
          ({ status }) => status === "VALID",
        ).length;
        const artifact =
          T45ContentDraftArtifactV1Schema.parse({
            schemaVersion: 1,
            kind: "T45_CONTENT_DRAFT_SELECTIONS",
            runId: parsed.runId,
            artifactId: parsed.artifactId,
            runtimeSuite: source.runtimeSuite,
            inventoryHash: source.inventoryHash,
            sourceClosureHash:
              sourceClosure.sourceClosureHash,
            inputs: source.inputs,
            configHash:
              T44_CONTENT_RERANKER_CONFIG_HASH_V1,
            model: resolved.provenance,
            cases,
            summary: {
              total: cases.length,
              valid,
              invalid: cases.length - valid,
            },
            generatedAt: new Date().toISOString(),
          });
        const written = await writeNew(
          draftPath,
          artifact,
        );
        assertSourceClosure();
        draftRead = await readIfExists(
          draftPath,
          (value) =>
            T45ContentDraftArtifactV1Schema.parse(
              value,
            ),
        );
        if (
          !draftRead
          || draftRead.sha256 !== written.sha256
        ) {
          throw new Error(
            "T45_MULTI_ANCHOR_DRAFT_REOPEN_DRIFT",
          );
        }
      } else {
        assertArtifactBindings(
          draftRead.value,
          parsed,
          source,
          resolved.provenance,
        );
        if (
          draftRead.value.sourceClosureHash
            !== sourceClosure.sourceClosureHash
        ) {
          throw new Error(
            "T45_MULTI_ANCHOR_SOURCE_CLOSURE_HASH_DRIFT",
          );
        }
      }
    } finally {
      await reservation.release();
    }
  }
  const draftById = new Map(
    draftRead.value.cases.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  const finalReservation =
    await acquireT45StageReservationV1({
      target: `${finalPath}.reservation`,
      stage: `final:${parsed.runId}`,
      runId: parsed.runId,
      artifactId: parsed.artifactId,
    });
  try {
    const racedFinal = await readIfExists(
      finalPath,
      (value) =>
        T45FinalSelectionArtifactV1Schema.parse(
          value,
        ),
    );
    if (racedFinal) {
      if (
        draftRead.sha256
        !== racedFinal.value.inputs
          .draftSelectionSha256
      ) {
        throw new Error(
          "T45_MULTI_ANCHOR_FINAL_DRAFT_SHA_DRIFT",
        );
      }
      assertArtifactBindings(
        {
          ...racedFinal.value,
          inputs: {
            boundarySha256:
              racedFinal.value.inputs
                .boundarySha256,
            plannerSha256:
              racedFinal.value.inputs.plannerSha256,
            candidateSha256:
              racedFinal.value.inputs
                .candidateSha256,
            matrixSha256:
              racedFinal.value.inputs.matrixSha256,
            baselineSelectionSha256:
              racedFinal.value.inputs
                .baselineSelectionSha256,
            oracleGateSha256:
              racedFinal.value.inputs
                .oracleGateSha256,
          },
        },
        parsed,
        source,
        resolved.provenance,
      );
      if (
        racedFinal.value.sourceClosureHash
          !== sourceClosure.sourceClosureHash
      ) {
        throw new Error(
          "T45_MULTI_ANCHOR_SOURCE_CLOSURE_HASH_DRIFT",
        );
      }
      validateT45FinalArtifactV1({
        prompts: source.prompts,
        candidate: source.candidate,
        baselineSelection:
          source.baselineSelection,
        draft: draftRead.value,
        final: racedFinal.value,
      });
      return {
        artifact: racedFinal.value,
        output: {
          path: racedFinal.path,
          bytes: racedFinal.bytes,
          sha256: racedFinal.sha256,
        },
        resumed: "FINAL" as const,
      };
    }
  const reviewPrompts = source.prompts.flatMap(
    (prompt) => {
      const draft = draftById.get(prompt.caseId);
      if (!draft) {
        throw new Error(
          "T45_MULTI_ANCHOR_DRAFT_CASE_MISSING",
        );
      }
      if (draft.status === "INVALID") {
        return [];
      }
      return [buildT45MultiAnchorPromptV1({
        sourcePrompt: prompt,
        draftCase: draft,
        baselineProtectedSelection:
          source.baselineSelection,
        candidateArtifact: source.candidate,
      })];
    },
  );
  const reviewCases = reviewPrompts.length === 0
    ? []
    : (assertSourceClosure(),
      await dependencies.runModelBatch({
        prompts: reviewPrompts,
        model: requireProvider(),
      }));
  const reviewById = new Map(
    reviewCases.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  const promptById = new Map(
    reviewPrompts.map((prompt) => [
      prompt.caseId,
      prompt,
    ]),
  );
  const cases = draftRead.value.cases.map(
    (draftCase) => {
      if (draftCase.status === "INVALID") {
        return T45FinalSelectionCaseV1Schema.parse({
          caseId: draftCase.caseId,
          coursePackId: draftCase.coursePackId,
          candidateMapHash:
            draftCase.candidateMapHash,
          promptHash: draftCase.promptHash,
          status: "INVALID",
          failureCategory:
            draftCase.failureCategory,
          selected: [],
          audit: {
            elapsedMs: draftCase.audit.elapsedMs,
            rawOutputHash:
              draftCase.audit.rawOutputHash,
            usage: draftCase.audit.usage,
          },
          stageAudit: {
            draft: {
              elapsedMs:
                draftCase.audit.elapsedMs,
              usage: draftCase.audit.usage,
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
              elapsedMs:
                draftCase.audit.elapsedMs,
              usage: draftCase.audit.usage,
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
        });
      }
      const review = reviewById.get(
        draftCase.caseId,
      );
      const prompt = promptById.get(
        draftCase.caseId,
      );
      if (!review || !prompt) {
        throw new Error(
          "T45_MULTI_ANCHOR_REVIEW_CASE_MISSING",
        );
      }
      const completed =
        applyT45MultiAnchorCompletionV1({
          prompt,
          modelSelection: review,
        });
      const usage = addUsage(
        draftCase.audit.usage,
        review.audit.usage,
      );
      return T45FinalSelectionCaseV1Schema.parse({
        ...completed.testCase,
        audit: {
          ...completed.testCase.audit,
          elapsedMs:
            draftCase.audit.elapsedMs
            + review.audit.elapsedMs,
          usage,
        },
        stageAudit: {
          draft: {
            elapsedMs: draftCase.audit.elapsedMs,
            usage: draftCase.audit.usage,
          },
          reviewer: {
            elapsedMs: review.audit.elapsedMs,
            usage: review.audit.usage,
          },
          endToEnd: {
            elapsedMs:
              draftCase.audit.elapsedMs
              + review.audit.elapsedMs,
            usage,
          },
        },
        completion: completed.completion,
        bindingViolations: [],
      });
    },
  );
  const valid = cases.filter(
    ({ status }) => status === "VALID",
  ).length;
  const artifact =
    T45FinalSelectionArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T45_MULTI_ANCHOR_SELECTIONS",
      runId: parsed.runId,
      artifactId: parsed.artifactId,
      runtimeSuite: source.runtimeSuite,
      inventoryHash: source.inventoryHash,
      sourceClosureHash:
        sourceClosure.sourceClosureHash,
      inputs: {
        ...source.inputs,
        draftSelectionSha256: draftRead.sha256,
      },
      configHash:
        T45_MULTI_ANCHOR_REVIEWER_CONFIG_HASH_V1,
      model: resolved.provenance,
      cases,
      summary: {
        total: cases.length,
        valid,
        invalid: cases.length - valid,
      },
      generatedAt: new Date().toISOString(),
    });
  validateT45FinalArtifactV1({
    prompts: source.prompts,
    candidate: source.candidate,
    baselineSelection: source.baselineSelection,
    draft: draftRead.value,
    final: artifact,
  });
  const output = await writeNew(
    finalPath,
    artifact,
  );
  assertSourceClosure();
  return {
    artifact,
    output,
    resumed:
      resumedDraft
        ? "DRAFT" as const
        : "NONE" as const,
  };
  } finally {
    await finalReservation.release();
  }
}

export function formatT45MultiAnchorErrorCodeV1(
  error: unknown,
) {
  const message = error instanceof Error
    ? error.message
    : "";
  return message.match(
    /^(T45_[A-Z0-9]+(?:_[A-Z0-9]+)*)/,
  )?.[1]
    ?? "T45_MULTI_ANCHOR_UNEXPECTED_ERROR";
}

async function main() {
  const result =
    await runT45MultiAnchorReviewerCli(
      process.argv.slice(2),
    );
  process.stdout.write(`${JSON.stringify({
    selectionPath: result.output.path,
    selectionBytes: result.output.bytes,
    selectionSha256: result.output.sha256,
    summary: result.artifact.summary,
    model: result.artifact.model,
    configHash: result.artifact.configHash,
    resumed: result.resumed,
  }, null, 2)}\n`);
}

const entryPoint = process.argv[1];
if (
  entryPoint
  && import.meta.url
    === pathToFileURL(path.resolve(entryPoint)).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${formatT45MultiAnchorErrorCodeV1(error)}\n`,
    );
    process.exitCode = 1;
  });
}
