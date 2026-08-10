import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import {
  materializeLegacyKnowledgeCorpusV2,
} from "../../helpers/knowledge-v2-generation-fixtures";

import {
  T45MultiAnchorAuditReportV1Schema,
} from "@/scripts/audit-t45-multi-anchor-reviewer-v1";
import {
  T45ContentDraftArtifactV1Schema,
  T45FinalSelectionArtifactV1Schema,
} from "@/scripts/run-t45-multi-anchor-reviewer-v1";
import {
  T44_CONTENT_RERANKER_CONFIG_HASH_V1,
} from "@/tools/mixed-retrieval/t44-content-reranker-v1";
import {
  T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
} from "@/tools/mixed-retrieval/t44-obligation-label-blind-v2";
import {
  T45_CAPABILITY_EVALUATOR_CONFIG_HASH_LOCK_V1,
  sealT45CandidateOracleGateV1,
} from "@/tools/mixed-retrieval/t45-candidate-oracle-gate-v1";
import {
  T45_CAPABILITY_DENOMINATORS_V1,
  T45_CAPABILITY_EVALUATOR_CONFIG_HASH_V1,
} from "@/tools/mixed-retrieval/t45-capability-evaluator";
import {
  T45_MULTI_ANCHOR_REVIEWER_CONFIG_HASH_V1,
} from "@/tools/mixed-retrieval/t45-multi-anchor-reviewer-v1";
import {
  sealT45AuditReceiptV1,
} from "@/tools/mixed-retrieval/t45-audit-receipt-v1";

const H = "a".repeat(64);
const BUNDLE_RELATIVE_PATH =
  "tests/fixtures/mixed-retrieval/"
  + "t45-legacy-default-artifacts-v1.json.gz";
const BUNDLE_BYTES = 3_416_833;
const BUNDLE_SHA256 =
  "5fcc10ae0d4d607e1eddab358aa5e4172909b94ce5b7ef386dcfde98f67f73a2";
const BUNDLE_PAYLOAD_BYTES = 18_943_832;
const BUNDLE_PAYLOAD_SHA256 =
  "58e89d1caf7cd9ea863143647dfd74af849f76cd8932f9bb41a997a9ec3602c9";
const LEGACY_ARTIFACT_BINDINGS = Object.freeze({
  "t44-obligation-legacy-v2.planner.json": {
    bytes: 291405,
    sha256:
      "ed24337313dea252e34ab1555b7eeffb9844681ef386e7d2d49211839fe6671a",
  },
  "t44-obligation-legacy-v2.candidate.json": {
    bytes: 5548873,
    sha256:
      "516116610ea9e2c053f0c7b245936871cacdb018334e9b56208255dbd207d71e",
  },
  "t44-obligation-legacy-v2.matrix.json": {
    bytes: 7636167,
    sha256:
      "ad5cdf252c764e9df9937c6d89026d2d96384999fd8b2985802243421f829c71",
  },
  "t44-obligation-legacy-v2.baseline-protected-v2.selection.json":
    {
      bytes: 321032,
      sha256:
        "c4bd1ef00c80219bc04a2b247d67b657722ef762ef982cc457c5317da4f20d27",
    },
  "t44-obligation-legacy-v2.baseline-protected-v2.oracle-v1.json":
    {
      bytes: 38255,
      sha256:
        "c82b35d7f9c43160bb1773f2370218f0551157542c891449909cd97d76f814e3",
    },
  "t44-obligation-legacy-v2.content-reviewer-full-v2.selection.json":
    {
      bytes: 371346,
      sha256:
        "fac195fdffb4362efed072a3478bf500631305f251e8cf5271ed676509b37a35",
    },
} as const);
const FORBIDDEN_FIXTURE_CONTENT =
  /(?:api[_-]?key|base[_-]?url|https?:\/\/|authorization["'\s:=]|bearer\s+|sk-(?:proj-)?[A-Za-z0-9_-]{16,})/iu;

function sha256(value: string | Uint8Array) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

async function writeCanonical(
  target: string,
  value: unknown,
) {
  const serialized =
    `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(path.dirname(target), {
    recursive: true,
  });
  await writeFile(target, serialized, "utf8");
  return sha256(serialized);
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
  );
}

async function materializeLegacyArtifacts(
  sourceRoot: string,
  artifactRoot: string,
) {
  let raw: unknown;
  try {
    const bundle = await readFile(
      path.join(sourceRoot, BUNDLE_RELATIVE_PATH),
    );
    if (
      bundle.byteLength !== BUNDLE_BYTES
      || sha256(bundle) !== BUNDLE_SHA256
    ) {
      throw new Error(
        "T45_LEGACY_FIXTURE_GZIP_DRIFT",
      );
    }
    const payload = gunzipSync(bundle, {
      maxOutputLength: BUNDLE_PAYLOAD_BYTES,
    });
    if (
      payload.byteLength !== BUNDLE_PAYLOAD_BYTES
      || sha256(payload)
        !== BUNDLE_PAYLOAD_SHA256
    ) {
      throw new Error(
        "T45_LEGACY_FIXTURE_PAYLOAD_DRIFT",
      );
    }
    raw = JSON.parse(payload.toString("utf8")) as unknown;
  } catch {
    throw new Error(
      "T45_LEGACY_FIXTURE_BUNDLE_INVALID",
    );
  }
  if (
    !isRecord(raw)
    || JSON.stringify(
      Object.keys(raw).sort(),
    ) !== JSON.stringify([
      "files",
      "kind",
      "schemaVersion",
    ])
    || raw.schemaVersion !== 1
    || raw.kind
      !== "T45_LEGACY_DEFAULT_ARTIFACTS"
    || !isRecord(raw.files)
  ) {
    throw new Error(
      "T45_LEGACY_FIXTURE_BUNDLE_INVALID",
    );
  }
  const expectedNames = Object.keys(
    LEGACY_ARTIFACT_BINDINGS,
  ).sort();
  const observedNames = Object.keys(
    raw.files,
  ).sort();
  if (
    JSON.stringify(observedNames)
      !== JSON.stringify(expectedNames)
  ) {
    throw new Error(
      "T45_LEGACY_FIXTURE_FILE_SET_DRIFT",
    );
  }
  await mkdir(artifactRoot, {
    recursive: true,
  });
  for (const name of expectedNames) {
    const expected =
      LEGACY_ARTIFACT_BINDINGS[
        name as keyof typeof LEGACY_ARTIFACT_BINDINGS
      ];
    const encoded = raw.files[name];
    if (
      !isRecord(encoded)
      || JSON.stringify(
        Object.keys(encoded).sort(),
      ) !== JSON.stringify([
        "bytes",
        "contentBase64",
        "sha256",
      ])
      || encoded.bytes !== expected.bytes
      || encoded.sha256 !== expected.sha256
      || typeof encoded.contentBase64 !== "string"
    ) {
      throw new Error(
        `T45_LEGACY_FIXTURE_METADATA_DRIFT:${name}`,
      );
    }
    const content = Buffer.from(
      encoded.contentBase64,
      "base64",
    );
    if (
      content.toString("base64")
        !== encoded.contentBase64
      || content.byteLength !== expected.bytes
      || sha256(content) !== expected.sha256
    ) {
      throw new Error(
        `T45_LEGACY_FIXTURE_CONTENT_DRIFT:${name}`,
      );
    }
    if (
      FORBIDDEN_FIXTURE_CONTENT.test(
        content.toString("utf8"),
      )
    ) {
      throw new Error(
        `T45_LEGACY_FIXTURE_SECRET_OR_URL:${name}`,
      );
    }
    const target = path.join(
      artifactRoot,
      name,
    );
    await writeFile(target, content);
    const observed = await readFile(target);
    if (
      observed.byteLength !== expected.bytes
      || sha256(observed) !== expected.sha256
    ) {
      throw new Error(
        `T45_LEGACY_FIXTURE_WRITE_DRIFT:${name}`,
      );
    }
  }
}

function validationNoGoEvaluation(
  caseIds: readonly string[],
) {
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
    schemaVersion: 1 as const,
    kind:
      "T45_CAPABILITY_SELECTION_REPORT" as const,
    split: "VALIDATION" as const,
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
    cases: caseIds.map((caseId, index) => ({
      caseId,
      familyId:
        `validation-family-${Math.floor(index / 2) + 1}`,
      multiClaim: index < 10,
      status: "INVALID" as const,
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
    })),
    families: Array.from(
      { length: 10 },
      (_, index) => ({
        familyId: `validation-family-${index + 1}`,
        casesSupported: 0,
        casesTotal: 2,
        bothCasesSupported: false,
      }),
    ),
    passed: false,
    decision:
      "VALIDATION_SELECTOR_NO_GO" as const,
  };
}

export async function createT45LegacyDefaultFixture(
  root: string,
) {
  const sourceRoot = process.cwd();
  const copies = [
    "tests/retrieval-quality/t45-capability-inventory.json",
    "tests/retrieval-quality/t45-capability-validation.runtime.json",
    "tests/retrieval-quality/t44-support-dev.runtime.json",
    "tests/retrieval-quality/t44-support-dev.qrels.json",
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
  await materializeLegacyKnowledgeCorpusV2(
    path.join(root, "data/knowledge-v2/knowledge-corpus.v2.json"),
    sourceRoot,
  );
  const runtime = JSON.parse(
    await readFile(
      path.join(
        root,
        "tests/retrieval-quality/t45-capability-validation.runtime.json",
      ),
      "utf8",
    ),
  ) as {
    id: string;
    version: string;
    suiteHash: string;
    corpusSnapshot: { bundleHash: string };
    cases: Array<{
      caseId: string;
      coursePackId: string;
    }>;
  };
  const inventory = JSON.parse(
    await readFile(
      path.join(
        root,
        "tests/retrieval-quality/t45-capability-inventory.json",
      ),
      "utf8",
    ),
  ) as { inventoryHash: string };
  const artifactRoot = path.join(
    root,
    ".runtime/mixed-retrieval",
  );
  await materializeLegacyArtifacts(
    sourceRoot,
    artifactRoot,
  );
  const model = {
    source: "service-env" as const,
    modelId: "GPT-5.6 Luna",
    endpointHash: H,
    configHash: H,
  };
  const freeze = {
    freezeHash: H,
    model,
    sourceClosureHash: H,
  };
  const gateInput = {
    schemaVersion: 1 as const,
    kind:
      "T45_CAPABILITY_CANDIDATE_ORACLE_GATE" as const,
    split: "VALIDATION" as const,
    runId: "validation-v1",
    runtimeSuite: {
      id: runtime.id,
      version: runtime.version,
      suiteHash: runtime.suiteHash,
    },
    inventoryHash: inventory.inventoryHash,
    corpusBundleHash:
      runtime.corpusSnapshot.bundleHash,
    inputs: {
      boundarySha256: H,
      plannerSha256: H,
      candidateSha256: H,
      matrixSha256: H,
      baselineSelectionSha256: H,
      oracleReportSha256: H,
    },
    selectorConfigHash:
      T44_BASELINE_PROTECTED_SELECTOR_CONFIG_HASH_V2,
    candidateOracle: {
      casesCovered: 20,
      casesTotal: 20 as const,
      groupsCovered: 30,
      groupsTotal: 30 as const,
      coveragePassed: true,
      structuralGates: {
        baselineAvailableCases: 20,
        protectedAnchorCases: 20,
        baselineSingleCountCases: 20,
        casesTotal: 20 as const,
        passed: true,
      },
      passed: true,
    },
    decision:
      "VALIDATION_CANDIDATE_READY" as const,
    evaluatorConfigHash:
      T45_CAPABILITY_EVALUATOR_CONFIG_HASH_LOCK_V1,
  };
  const gate =
    sealT45CandidateOracleGateV1(gateInput);
  const gatePath = path.join(
    artifactRoot,
    "t45-capability-validation-v1.oracle-gate.json",
  );
  const gateSha = await writeCanonical(
    gatePath,
    gate,
  );
  const inputs = {
    boundarySha256: H,
    plannerSha256: H,
    candidateSha256: H,
    matrixSha256: H,
    baselineSelectionSha256: H,
    oracleGateSha256: gateSha,
  };
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  const runtimeSuite = {
    id: runtime.id,
    version: runtime.version,
    suiteHash: runtime.suiteHash,
    split: "VALIDATION" as const,
  };
  const draftCases = runtime.cases.map(
    (testCase) => ({
      caseId: testCase.caseId,
      coursePackId: testCase.coursePackId,
      candidateMapHash: H,
      promptHash: H,
      status: "INVALID" as const,
      failureCategory: "OFFLINE",
      selected: [],
      audit: {
        elapsedMs: 0,
        rawOutputHash: null,
        usage,
      },
    }),
  );
  const draft =
    T45ContentDraftArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T45_CONTENT_DRAFT_SELECTIONS",
      runId: "validation-v1",
      artifactId: "validation-v1",
      runtimeSuite,
      inventoryHash: inventory.inventoryHash,
      sourceClosureHash: H,
      inputs,
      configHash:
        T44_CONTENT_RERANKER_CONFIG_HASH_V1,
      model,
      cases: draftCases,
      summary: {
        total: 20,
        valid: 0,
        invalid: 20,
      },
      generatedAt: "2026-07-29T00:00:00.000Z",
    });
  const draftPath = path.join(
    artifactRoot,
    "t45-capability-validation-v1.content-draft-validation-v1.selection.json",
  );
  const draftSha = await writeCanonical(
    draftPath,
    draft,
  );
  const selection =
    T45FinalSelectionArtifactV1Schema.parse({
      schemaVersion: 1,
      kind: "T45_MULTI_ANCHOR_SELECTIONS",
      runId: "validation-v1",
      artifactId: "validation-v1",
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
      cases: draftCases.map((testCase) => ({
        ...testCase,
        stageAudit: {
          draft: { elapsedMs: 0, usage },
          reviewer: { elapsedMs: 0, usage },
          endToEnd: { elapsedMs: 0, usage },
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
      })),
      summary: {
        total: 20,
        valid: 0,
        invalid: 20,
      },
      generatedAt: draft.generatedAt,
    });
  const selectionPath = path.join(
    artifactRoot,
    "t45-capability-validation-v1.multi-anchor-validation-v1.selection.json",
  );
  const selectionSha = await writeCanonical(
    selectionPath,
    selection,
  );
  const report =
    T45MultiAnchorAuditReportV1Schema.parse({
      schemaVersion: 1,
      kind: "T45_MULTI_ANCHOR_AUDIT",
      split: "VALIDATION",
      runId: "validation-v1",
      artifactId: "validation-v1",
      decision: "VALIDATION_SELECTOR_NO_GO",
      inputs: {
        selectionSha256: selectionSha,
        draftSelectionSha256: draftSha,
        oracleGateSha256: gateSha,
        freezeHash: freeze.freezeHash,
        source: inputs,
      },
      sourceClosureHash: H,
      evaluation: validationNoGoEvaluation(
        runtime.cases.map(({ caseId }) => caseId),
      ),
      generatedAt: draft.generatedAt,
    });
  const reportSha = await writeCanonical(
    path.join(
      artifactRoot,
      "t45-capability-validation-v1.multi-anchor-validation-v1.report.json",
    ),
    report,
  );
  await writeCanonical(
    path.join(
      artifactRoot,
      "t45-capability-validation-v1.multi-anchor-validation-v1.receipt.json",
    ),
    sealT45AuditReceiptV1({
      schemaVersion: 1,
      kind: "T45_AUDIT_RECEIPT",
      split: "VALIDATION",
      runId: "validation-v1",
      artifactId: "validation-v1",
      decision: "VALIDATION_SELECTOR_NO_GO",
      inputs: report.inputs,
      reportSha256: reportSha,
      sourceClosureHash: H,
      evaluatorConfigHash:
        T45_CAPABILITY_EVALUATOR_CONFIG_HASH_V1,
      aggregate: {
        kind: "CAPABILITY",
        cases: 20,
        requiredGroups: 30,
        multiCases: 10,
        families: 10,
        supportCases: 0,
        requiredGroupsCovered: 0,
        multiJointCoverage: 0,
        familiesWithBothCasesSupported: 0,
        hardNegativeNodes: 1,
        hardNegativeCases: 1,
        aBaselineHardNegativeNodes: 0,
        aBaselineHardNegativeCases: 0,
        validSelections: 0,
        bindingViolations: 1,
        reviewerP95Ms: 31_000,
      },
    }),
  );
  return {
    root,
    model,
    freeze,
    gate,
    gateInput,
    gatePath,
    qrelsPath: path.join(
      root,
      "tests/retrieval-quality/t44-support-dev.qrels.json",
    ),
    artifactRoot,
    captureSourceClosure: () => ({
      sourceFiles: [{
        path: "sealed-source.ts",
        sha256: H,
      }],
      sourceClosureHash: H,
    }),
    validationSource: {
      runtimeSuite,
      inventoryHash: inventory.inventoryHash,
      corpusBundleHash:
        runtime.corpusSnapshot.bundleHash,
      inputs,
      prompts: draftCases.map((testCase) => ({
        caseId: testCase.caseId,
        coursePackId: testCase.coursePackId,
        candidateMapHash:
          testCase.candidateMapHash,
        promptHash: testCase.promptHash,
        candidates: [],
      })),
      candidate: {},
      baselineSelection: {},
      gate,
    },
  };
}
