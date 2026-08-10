import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import {
  assertT45AuditReceiptMatchesReportV1,
  assertT45AuditReportMatchesSelectionV1,
  T45MultiAnchorAuditReportV1Schema,
} from "@/scripts/audit-t45-multi-anchor-reviewer-v1";
import {
  T45ContentDraftArtifactV1Schema,
  T45FinalSelectionArtifactV1Schema,
  T45SelectorFreezeV1Schema,
  loadT45ReviewerSourceBundleV1,
  verifyT45SelectorFreezeV1,
  type T45ModelProvenanceV1,
  type T45SelectorFreezeV1,
} from "@/scripts/run-t45-multi-anchor-reviewer-v1";
import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  T44_CONTENT_RERANKER_CONFIG_HASH_V1,
  T44_CONTENT_RERANKER_CONFIG_V1,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import {
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
} from "@/tools/mixed-retrieval/t44-obligation-label-blind-v2";
import {
  T45_MULTI_ANCHOR_PROMPT_TEMPLATE_HASH_V1,
  T45_MULTI_ANCHOR_REVIEWER_CONFIG_HASH_V1,
  T45_MULTI_ANCHOR_REVIEWER_CONFIG_V1,
} from "@/tools/mixed-retrieval/t45-multi-anchor-reviewer-v1";
import {
  verifyT45CandidateOracleGateV1,
} from "@/tools/mixed-retrieval/t45-candidate-oracle-gate-v1";
import {
  verifyT45AuditReceiptV1,
} from "@/tools/mixed-retrieval/t45-audit-receipt-v1";
import {
  collectT45SelectorSourceFilesV1,
} from "@/tools/mixed-retrieval/t45-selector-source-closure-v1";
import {
  acquireT45StageReservationV1,
  publishT45SealedCheckpointV1,
} from "@/tools/mixed-retrieval/t45-sealed-checkpoint-v1";
import {
  validateT45FinalArtifactV1,
} from "@/tools/mixed-retrieval/t45-final-artifact-validator-v1";

const ARTIFACT_ROOT = ".runtime/mixed-retrieval";

export type T45SelectorFreezeArguments = {
  runId: string;
  artifactId: string;
};

export function parseT45SelectorFreezeArguments(
  argv: readonly string[],
): T45SelectorFreezeArguments {
  const args = argv[0] === "--"
    ? argv.slice(1)
    : [...argv];
  if (
    args.length !== 4
    || args[0] !== "--run-id"
    || args[2] !== "--artifact-id"
  ) {
    throw new Error(
      "T45_SELECTOR_FREEZE_ARGUMENTS_INVALID",
    );
  }
  const runId = args[1] ?? "";
  const artifactId = args[3] ?? "";
  if (
    !/^calibration-v[1-9][0-9]*$/.test(runId)
    || artifactId !== runId
  ) {
    throw new Error(
      "T45_SELECTOR_FREEZE_IDENTITY_LOCKED",
    );
  }
  return { runId, artifactId };
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function canonicalJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function runtimeConfig() {
  return {
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
}

export function buildT45SelectorFreezeV1(
  input: {
    calibration:
      T45SelectorFreezeV1["calibration"];
    model: T45ModelProvenanceV1;
    sourceFiles:
      T45SelectorFreezeV1["sourceFiles"];
  },
) {
  const sourceFiles = [...input.sourceFiles]
    .sort((left, right) =>
      left.path.localeCompare(right.path, "en"));
  if (
    new Set(sourceFiles.map(({ path: file }) => file))
      .size !== sourceFiles.length
  ) {
    throw new Error(
      "T45_SELECTOR_FREEZE_SOURCE_DUPLICATE",
    );
  }
  const projection = {
    schemaVersion: 1 as const,
    kind: "T45_SELECTOR_FREEZE" as const,
    calibration: input.calibration,
    model: input.model,
    sourceClosureHash:
      sha256StableJsonV2(sourceFiles),
    sourceFiles,
    runtimeConfig: runtimeConfig(),
  };
  return T45SelectorFreezeV1Schema.parse({
    ...projection,
    freezeHash: sha256StableJsonV2(projection),
  });
}

export const T45_SELECTOR_SOURCE_FILES_V1 =
  Object.freeze(
    collectT45SelectorSourceFilesV1(
      path.resolve(
        path.dirname(
          fileURLToPath(import.meta.url),
        ),
        "..",
      ),
    ),
  );

async function hashSourceFiles(
  workspaceRoot: string,
) {
  const sourceFiles =
    collectT45SelectorSourceFilesV1(workspaceRoot);
  return Promise.all(
    sourceFiles.map(
      async (relativePath) => ({
        path: relativePath,
        sha256: sha256(
          await readFile(path.resolve(
            workspaceRoot,
            relativePath,
          )),
        ),
      }),
    ),
  );
}

export type T45SelectorFreezeDependenciesV1 = {
  hashSourceFiles(
    workspaceRoot: string,
  ): Promise<T45SelectorFreezeV1["sourceFiles"]>;
  verifyExisting(
    workspaceRoot: string,
  ): Promise<T45SelectorFreezeV1>;
  validateFinalArtifacts(input: {
    workspaceRoot: string;
    runId: string;
    artifactId: string;
    draft: ReturnType<
      typeof T45ContentDraftArtifactV1Schema.parse
    >;
    final: ReturnType<
      typeof T45FinalSelectionArtifactV1Schema.parse
    >;
  }): Promise<void>;
  assertReportMatchesSelection:
    typeof assertT45AuditReportMatchesSelectionV1;
};

const DEFAULT_DEPENDENCIES:
T45SelectorFreezeDependenciesV1 = {
  hashSourceFiles,
  verifyExisting: verifyT45SelectorFreezeV1,
  validateFinalArtifacts: async (input) => {
    const source =
      await loadT45ReviewerSourceBundleV1(
        {
          split: "CALIBRATION",
          runId: input.runId,
          artifactId: input.artifactId,
        },
        input.workspaceRoot,
      );
    validateT45FinalArtifactV1({
      prompts: source.prompts,
      candidate: source.candidate,
      baselineSelection:
        source.baselineSelection,
      draft: input.draft,
      final: input.final,
    });
  },
  assertReportMatchesSelection:
    assertT45AuditReportMatchesSelectionV1,
};

async function readJson<T>(
  target: string,
  label: string,
  parse: (value: unknown) => T,
) {
  let serialized: string;
  try {
    serialized = await readFile(target, "utf8");
  } catch {
    throw new Error(
      `T45_SELECTOR_FREEZE_${label}_MISSING`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error(
      `T45_SELECTOR_FREEZE_${label}_JSON_INVALID`,
    );
  }
  return {
    sha256: sha256(serialized),
    value: parse(raw),
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
      errorPrefix: "T45_SELECTOR_FREEZE",
    });
  const observed = published.bytes.toString("utf8");
  if (observed !== serialized) {
    throw new Error(
      "T45_SELECTOR_FREEZE_BYTE_DRIFT",
    );
  }
  return {
    path: published.path,
    bytes: published.bytes.byteLength,
    sha256: sha256(published.bytes),
  };
}

function same(left: unknown, right: unknown) {
  return sha256StableJsonV2(left)
    === sha256StableJsonV2(right);
}

export async function runT45SelectorFreezeCli(
  argv: readonly string[],
  workspaceRoot = process.cwd(),
  overrides: Partial<
    T45SelectorFreezeDependenciesV1
  > = {},
) {
  const parsed = parseT45SelectorFreezeArguments(
    argv,
  );
  const dependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...overrides,
  };
  const root = path.resolve(
    workspaceRoot,
    ARTIFACT_ROOT,
  );
  const target = path.join(
    root,
    "t45-selector-freeze-v1.json",
  );
  const reservation =
    await acquireT45StageReservationV1({
      target: `${target}.reservation`,
      stage: "freeze",
      runId: parsed.runId,
      artifactId: parsed.artifactId,
    });
  try {
  const stem = `t45-capability-${parsed.runId}`;
  const selectionPath = path.join(
    root,
    `${stem}.multi-anchor-${parsed.artifactId}.selection.json`,
  );
  const draftPath = path.join(
    root,
    `${stem}.content-draft-${parsed.artifactId}.selection.json`,
  );
  const reportPath = path.join(
    root,
    `${stem}.multi-anchor-${parsed.artifactId}.report.json`,
  );
  const receiptPath = path.join(
    root,
    `${stem}.multi-anchor-${parsed.artifactId}.receipt.json`,
  );
  const gatePath = path.join(
    root,
    `${stem}.oracle-gate.json`,
  );
  const [
    selection,
    draft,
    report,
    receipt,
    gate,
    sourceFiles,
  ] =
    await Promise.all([
      readJson(
        selectionPath,
        "SELECTION",
        (value) =>
          T45FinalSelectionArtifactV1Schema.parse(value),
      ),
      readJson(
        draftPath,
        "DRAFT",
        (value) =>
          T45ContentDraftArtifactV1Schema.parse(value),
      ),
      readJson(
        reportPath,
        "REPORT",
        (value) =>
          T45MultiAnchorAuditReportV1Schema
            .parse(value),
      ),
      readJson(
        receiptPath,
        "RECEIPT",
        (value) =>
          verifyT45AuditReceiptV1(value),
      ),
      readJson(
        gatePath,
        "ORACLE_GATE",
        (value) =>
          verifyT45CandidateOracleGateV1(value),
      ),
      dependencies.hashSourceFiles(workspaceRoot),
    ]);
  const selectionSource = {
    boundarySha256:
      selection.value.inputs.boundarySha256,
    plannerSha256:
      selection.value.inputs.plannerSha256,
    candidateSha256:
      selection.value.inputs.candidateSha256,
    matrixSha256:
      selection.value.inputs.matrixSha256,
    baselineSelectionSha256:
      selection.value.inputs
        .baselineSelectionSha256,
    oracleGateSha256:
      selection.value.inputs.oracleGateSha256,
  };
  const sourceClosureHash =
    sha256StableJsonV2(sourceFiles);
  await dependencies.validateFinalArtifacts({
    workspaceRoot,
    runId: parsed.runId,
    artifactId: parsed.artifactId,
    draft: draft.value,
    final: selection.value,
  });
  dependencies.assertReportMatchesSelection(
    report.value,
    selection.value,
  );
  assertT45AuditReceiptMatchesReportV1(
    report.value,
    report.sha256,
    receipt.value,
  );
  if (
    selection.value.runId !== parsed.runId
    || selection.value.artifactId
      !== parsed.artifactId
    || draft.value.runId !== parsed.runId
    || draft.value.artifactId !== parsed.artifactId
    || report.value.runId !== parsed.runId
    || report.value.artifactId !== parsed.artifactId
    || selection.value.runtimeSuite.split
      !== "CALIBRATION"
    || draft.value.runtimeSuite.split
      !== "CALIBRATION"
    || report.value.split !== "CALIBRATION"
    || report.value.decision !== "CALIBRATION_GO"
    || draft.value.sourceClosureHash
      !== sourceClosureHash
    || selection.value.sourceClosureHash
      !== sourceClosureHash
    || report.value.sourceClosureHash
      !== sourceClosureHash
    || selection.value.inputs.draftSelectionSha256
      !== draft.sha256
    || report.value.inputs.selectionSha256
      !== selection.sha256
    || report.value.inputs.draftSelectionSha256
      !== draft.sha256
    || report.value.inputs.freezeHash !== null
    || selection.value.inputs.oracleGateSha256
      !== gate.sha256
    || report.value.inputs.oracleGateSha256
      !== gate.sha256
    || receipt.value.reportSha256
      !== report.sha256
    || receipt.value.sourceClosureHash
      !== sourceClosureHash
    || receipt.value.decision !== report.value.decision
    || !same(receipt.value.inputs, report.value.inputs)
    || !same(
      report.value.inputs.source,
      selectionSource,
    )
    || !same(draft.value.inputs, selectionSource)
    || !same(
      selection.value.model,
      draft.value.model,
    )
  ) {
    throw new Error(
      "T45_SELECTOR_FREEZE_CALIBRATION_BINDING_DRIFT",
    );
  }
  const manifest = buildT45SelectorFreezeV1({
    calibration: {
      runId: parsed.runId,
      artifactId: parsed.artifactId,
      selectionSha256: selection.sha256,
      draftSelectionSha256: draft.sha256,
      reportSha256: report.sha256,
    },
    model: selection.value.model,
    sourceFiles,
  });
  try {
    const existing =
      await dependencies.verifyExisting(workspaceRoot);
    if (!same(existing, manifest)) {
      throw new Error(
        "T45_SELECTOR_FREEZE_EXISTING_DRIFT",
      );
    }
    const bytes = await readFile(target);
    return {
      manifest: existing,
      output: {
        path: target,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      },
      resumed: true,
    };
  } catch (error) {
    if (
      !(
        error instanceof Error
        && error.message
          === "T45_MULTI_ANCHOR_FREEZE_MISSING"
      )
    ) {
      throw error;
    }
  }
  const beforePublishSources =
    await dependencies.hashSourceFiles(workspaceRoot);
  if (
    !same(beforePublishSources, sourceFiles)
    || sha256StableJsonV2(beforePublishSources)
      !== manifest.sourceClosureHash
  ) {
    throw new Error(
      "T45_SELECTOR_FREEZE_SOURCE_CHANGED_BEFORE_PUBLISH",
    );
  }
  const output = await writeNew(target, manifest);
  const observedSources =
    await dependencies.hashSourceFiles(workspaceRoot);
  if (
    !same(observedSources, sourceFiles)
    || sha256StableJsonV2(observedSources)
      !== manifest.sourceClosureHash
  ) {
    throw new Error(
      "T45_SELECTOR_FREEZE_SOURCE_CHANGED_DURING_PUBLISH",
    );
  }
  return {
    manifest,
    output,
    resumed: false,
  };
  } finally {
    await reservation.release();
  }
}

export function formatT45SelectorFreezeErrorV1(
  error: unknown,
) {
  const message = error instanceof Error
    ? error.message
    : "";
  return message.match(
    /^(T45_[A-Z0-9]+(?:_[A-Z0-9]+)*)/,
  )?.[1]
    ?? "T45_SELECTOR_FREEZE_UNEXPECTED_ERROR";
}

async function main() {
  const result = await runT45SelectorFreezeCli(
    process.argv.slice(2),
  );
  process.stdout.write(`${JSON.stringify({
    freezePath: result.output.path,
    freezeBytes: result.output.bytes,
    freezeSha256: result.output.sha256,
    freezeHash: result.manifest.freezeHash,
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
      `${formatT45SelectorFreezeErrorV1(error)}\n`,
    );
    process.exitCode = 1;
  });
}
