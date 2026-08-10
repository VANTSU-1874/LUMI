import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { z } from "zod";

import { getCoursePack } from "../../lib/course-packs/registry";
import type {
  AnswerObligationSetV1,
  QueryUnderstandingInputV1,
} from "../../lib/knowledge/answer-obligation-v1";
import type {
  DirectEvidenceBatchResultV1,
} from "../../lib/knowledge/direct-evidence-channel-probe-v1";
import {
  createLocalMixedRuntimeV2,
  type LocalMixedRuntimeV2Options,
} from "../../lib/knowledge/mixed-retrieval-runtime-v2";
import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "../../lib/knowledge/knowledge-object-v2";
import {
  fuseObligationRrfV1,
  type ObligationRrfResultV1,
} from "../../lib/knowledge/obligation-rrf-v1";
import {
  createQueryUnderstandingPlannerV1,
  type QueryUnderstandingPlannerResultV1,
} from "../../lib/knowledge/query-understanding-planner-v1";
import {
  compileRetrievalPlanV1,
  type CompiledDirectQueryV1,
} from "../../lib/knowledge/retrieval-plan-v1";
import {
  createRetrievalQueryV2,
} from "../../lib/knowledge/retrieval-query-v2";
import {
  buildT44ObligationCandidateCaseV1,
  buildT44ObligationMatrixBridgeManifestV1,
  createT44ObligationCandidateArtifactV1,
  sealT44ObligationArtifactV1,
  type T44ObligationCandidateArtifactV1,
  type T44ObligationMatrixBridgeManifestV1,
} from "./t44-obligation-candidate-evaluator";
import {
  auditT44AnswerObligationBindingsV1,
} from "./t44-obligation-label-blind-v2";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IdSchema = z.string().regex(ID_PATTERN);
const HashSchema = z.string().regex(HASH_PATTERN);
const SplitSchema = z.enum([
  "CALIBRATION",
  "VALIDATION",
]);
const CoursePackIdSchema = z.enum([
  "general-design",
  "digital-interaction",
  "book-design",
  "layout-design",
  "brand-vi-design",
]);
const PartitionSchema = z.enum([
  "FROZEN_T44",
  "DEV_CAL",
  "VALIDATION",
  "VISUAL_RESERVE",
]);
const StratumSchema = z.enum([
  "DIRECT_PARAPHRASE",
  "COMPOSITION_HARD_DISTRACTOR",
]);

const InventorySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.literal(
      "lumi-t45-capability-inventory",
    ),
    corpusBundleHash: HashSchema,
    fingerprintPolicy: z
      .object({
        normalization: z.literal("NFKC_TRIM"),
        projection: z.literal(
          "KIND_ROLE_BODY_SORTED",
        ),
        hash: z.literal("SHA256"),
      })
      .strict(),
    objects: z.array(z
      .object({
        objectId: IdSchema,
        coursePackId: CoursePackIdSchema,
        objectContentHash: HashSchema,
        eligibleNodeIds: z.array(
          z.string().regex(/^node-[0-9a-f]{64}$/),
        ).min(1),
        capabilityFingerprint: HashSchema,
        familyId: IdSchema,
        partition: PartitionSchema,
      })
      .strict()).length(116),
    families: z.array(z
      .object({
        familyId: IdSchema,
        objectIds: z.array(IdSchema).min(1).max(50),
        partition: PartitionSchema,
      })
      .strict()).length(63),
    inventoryHash: HashSchema,
  })
  .strict();

const RuntimeCaseSchema = z
  .object({
    caseId: IdSchema,
    familyId: IdSchema,
    stratum: StratumSchema,
    mode: z.literal("TEXT_TO_TEXT"),
    coursePackId: CoursePackIdSchema,
    coursePackVersion: z.literal("1"),
    question: z.string().trim().min(1).max(500),
  })
  .strict();

const RuntimeSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.enum([
      "lumi-t45-capability-calibration-runtime",
      "lumi-t45-capability-validation-runtime",
    ]),
    version: z.literal("2026-07-29.1"),
    split: SplitSchema,
    corpusSnapshot: z
      .object({
        path: z.literal(
          "data/knowledge-v2/knowledge-corpus.v2.json",
        ),
        bundleHash: HashSchema,
      })
      .strict(),
    cases: z.array(RuntimeCaseSchema).length(20),
    suiteHash: HashSchema,
  })
  .strict();

type RuntimeCaseInput = z.infer<
  typeof RuntimeCaseSchema
>;

export type NormalizedObligationRuntimeCase = {
  caseId: string;
  familyId: string;
  stratum:
    | "DIRECT_PARAPHRASE"
    | "COMPOSITION_HARD_DISTRACTOR";
  mode: "TEXT_TO_TEXT";
  coursePackId: z.infer<typeof CoursePackIdSchema>;
  coursePackVersion: "1";
  question: string;
  recentTurns: readonly [];
  view: {
    id: "student-conversation";
    focus: "mentor";
  };
  hasArtwork: false;
  artworkHash: null;
};

export type T45RuntimePort = {
  identity: {
    id: string;
    version: string;
    suiteHash: string;
    split: "CALIBRATION" | "VALIDATION";
    inventoryHash: string;
    corpusBundleHash: string;
  };
  cases: readonly NormalizedObligationRuntimeCase[];
};

type CollectionRuntimeCase = {
  caseId: string;
  coursePackId: z.infer<typeof CoursePackIdSchema>;
  coursePackVersion: "1";
  question: string;
  recentTurns: Readonly<
    QueryUnderstandingInputV1["recentTurns"]
  >;
  view: QueryUnderstandingInputV1["view"];
  hasArtwork: boolean;
  artworkHash: string | null;
};

export type ObligationCollectionRuntimePortV1 = {
  identity: {
    id: string;
    version: string;
    suiteHash: string;
    corpusBundleHash: string;
  };
  cases: readonly CollectionRuntimeCase[];
};

const SHARED_PATHS = Object.freeze({
  python:
    ".runtime/visual-retrieval/python312/python.exe",
  textModelDir:
    ".runtime/text-retrieval/hf/models--BAAI--bge-small-zh-v1.5/"
    + "snapshots/7999e1d3359715c523056ef9478215996d62a620",
  textModelSeal:
    ".runtime/text-retrieval/seals/bge-small-zh-v1.5.json",
  textIndexDir:
    ".runtime/text-retrieval/indexes/"
    + "b3119e9a942497f731d6c8ee063c00fe2793e859cf47d7cbaa6101a2771b1122",
  visualModelDir:
    ".runtime/visual-retrieval/hf/models--google--"
    + "siglip2-base-patch16-224/snapshots/"
    + "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2",
  visualModelSeal:
    ".runtime/visual-retrieval/seals/siglip2.json",
  visualIndexDir:
    ".runtime/visual-retrieval/indexes/siglip2/"
    + "1f2a354c755b498240108583d10ad5f0f5d2a3ad9c9f2cee2c3110d07f05125a",
  visualOffloadDir:
    ".runtime/visual-retrieval/offload",
  controlDir:
    ".runtime/knowledge-index/control/"
    + "cad61822cf3e4d95e984b08c66fa6427c5adf182fc305329291f8eb9aad1be5d",
  assetManifest:
    "data/manifests/course-png-sha256.v1.json",
} as const);

export const T45_FROZEN_RUNTIME_BINDINGS_V1 =
  deepFreeze({
    suiteHashes: {
      CALIBRATION:
        "1fad892a86567519fba5d86358091160873cb2baff1bc1be5d01db8cf42d456b",
      VALIDATION:
        "e3a7f38cb76d402cbcac2a5d8e362b6c5536fe0c75f35c631769914a658e807b",
    },
    inventoryHash:
      "fd199dfe6f49ce1249f20a04be580dc1b1b31fff2d831b88d4bd13e022082d67",
    corpusBundleHash:
      "82db90934afaffa3d227b6b0d11ab5efdb88009fd8b9274845567de4888079f8",
  } as const);

function withoutField(
  value: Record<string, unknown>,
  field: string,
) {
  const result = { ...value };
  delete result[field];
  return result;
}

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

function sha256(value: string | Uint8Array) {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function expectedRuntimeIdentity(
  split: "CALIBRATION" | "VALIDATION",
) {
  return split === "CALIBRATION"
    ? {
        id:
          "lumi-t45-capability-calibration-runtime",
        file:
          "t45-capability-calibration.runtime.json",
        partition: "DEV_CAL" as const,
      }
    : {
        id:
          "lumi-t45-capability-validation-runtime",
        file:
          "t45-capability-validation.runtime.json",
        partition: "VALIDATION" as const,
      };
}

function normalizeRuntimeCase(
  testCase: RuntimeCaseInput,
): NormalizedObligationRuntimeCase {
  return {
    ...testCase,
    recentTurns: [],
    view: {
      id: "student-conversation",
      focus: "mentor",
    },
    hasArtwork: false,
    artworkHash: null,
  };
}

export async function loadT45RuntimePort(input: {
  workspaceRoot: string;
  split: "CALIBRATION" | "VALIDATION";
}): Promise<T45RuntimePort> {
  const split = SplitSchema.parse(input.split);
  const expected = expectedRuntimeIdentity(split);
  const root = path.resolve(
    input.workspaceRoot,
    "tests/retrieval-quality",
  );
  const [runtimeBytes, inventoryBytes] =
    await Promise.all([
      readFile(path.join(root, expected.file)),
      readFile(path.join(
        root,
        "t45-capability-inventory.json",
      )),
    ]);
  const runtime = RuntimeSchema.parse(
    JSON.parse(
      runtimeBytes.toString("utf8"),
    ) as unknown,
  );
  const inventory = InventorySchema.parse(
    JSON.parse(
      inventoryBytes.toString("utf8"),
    ) as unknown,
  );
  if (
    runtime.split !== split
    || runtime.id !== expected.id
  ) {
    throw new Error(
      "T45_RUNTIME_PORT_SPLIT_IDENTITY_DRIFT",
    );
  }
  if (
    sha256StableJsonV2(withoutField(
      runtime as unknown as Record<string, unknown>,
      "suiteHash",
    )) !== runtime.suiteHash
  ) {
    throw new Error(
      "T45_RUNTIME_PORT_SUITE_HASH_DRIFT",
    );
  }
  if (
    sha256StableJsonV2(withoutField(
      inventory as unknown as Record<string, unknown>,
      "inventoryHash",
    )) !== inventory.inventoryHash
  ) {
    throw new Error(
      "T45_RUNTIME_PORT_INVENTORY_HASH_DRIFT",
    );
  }
  if (
    runtime.corpusSnapshot.bundleHash
      !== inventory.corpusBundleHash
  ) {
    throw new Error(
      "T45_RUNTIME_PORT_CORPUS_BINDING_DRIFT",
    );
  }
  if (
    runtime.corpusSnapshot.bundleHash
      !== T45_FROZEN_RUNTIME_BINDINGS_V1
        .corpusBundleHash
  ) {
    throw new Error(
      "T45_RUNTIME_PORT_FROZEN_CORPUS_HASH_DRIFT",
    );
  }
  if (
    runtime.suiteHash
      !== T45_FROZEN_RUNTIME_BINDINGS_V1
        .suiteHashes[split]
  ) {
    throw new Error(
      "T45_RUNTIME_PORT_FROZEN_SUITE_HASH_DRIFT",
    );
  }
  if (
    inventory.inventoryHash
      !== T45_FROZEN_RUNTIME_BINDINGS_V1
        .inventoryHash
  ) {
    throw new Error(
      "T45_RUNTIME_PORT_FROZEN_INVENTORY_HASH_DRIFT",
    );
  }
  const allowedFamilies = new Set(
    inventory.families
      .filter(
        ({ partition }) =>
          partition === expected.partition,
      )
      .map(({ familyId }) => familyId),
  );
  if (
    allowedFamilies.size !== 10
    || runtime.cases.some(
      ({ familyId }) =>
        !allowedFamilies.has(familyId),
    )
  ) {
    throw new Error(
      "T45_RUNTIME_PORT_FAMILY_BINDING_DRIFT",
    );
  }
  const familyCourses = new Map<string, Set<string>>();
  for (const object of inventory.objects) {
    const courses =
      familyCourses.get(object.familyId)
      ?? new Set<string>();
    courses.add(object.coursePackId);
    familyCourses.set(object.familyId, courses);
  }
  if (
    runtime.cases.some(
      ({ familyId, coursePackId }) =>
        !familyCourses.get(familyId)
          ?.has(coursePackId),
    )
  ) {
    throw new Error(
      "T45_RUNTIME_PORT_COURSE_BINDING_DRIFT",
    );
  }
  const caseIds = runtime.cases.map(
    ({ caseId }) => caseId,
  );
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error(
      "T45_RUNTIME_PORT_CASE_ID_DRIFT",
    );
  }
  return deepFreeze({
    identity: {
      id: runtime.id,
      version: runtime.version,
      suiteHash: runtime.suiteHash,
      split: runtime.split,
      inventoryHash: inventory.inventoryHash,
      corpusBundleHash:
        runtime.corpusSnapshot.bundleHash,
    },
    cases: runtime.cases.map(
      normalizeRuntimeCase,
    ),
  });
}

export function obligationRuntimeOptionsV1(
  workspaceRoot: string,
  device: "cuda" | "cpu",
): LocalMixedRuntimeV2Options {
  const resolve = (value: string) =>
    path.resolve(workspaceRoot, value);
  return {
    workspaceRoot,
    pythonExecutable: resolve(SHARED_PATHS.python),
    textModelDir: resolve(SHARED_PATHS.textModelDir),
    textModelSeal: resolve(
      SHARED_PATHS.textModelSeal,
    ),
    textIndexDir: resolve(SHARED_PATHS.textIndexDir),
    visualModelDir: resolve(
      SHARED_PATHS.visualModelDir,
    ),
    visualModelSeal: resolve(
      SHARED_PATHS.visualModelSeal,
    ),
    visualIndexDir: resolve(
      SHARED_PATHS.visualIndexDir,
    ),
    visualOffloadDir:
      resolve(SHARED_PATHS.visualOffloadDir),
    controlDir: resolve(SHARED_PATHS.controlDir),
    assetManifestPath:
      resolve(SHARED_PATHS.assetManifest),
    device,
    gpuMemoryGiB: device === "cuda" ? 5.5 : 0.5,
    timeoutMs: 30_000,
    visualMaxCacheEntries: 8,
    textObjectConsensusEnabled: false,
    queryEvidenceAdequacyEnabled: false,
    queryPrerequisiteStaticBypassEnabled: false,
    textObjectChannelProbeEnabled: false,
    directEvidenceChannelProbeEnabled: true,
  };
}

export function isolatedObligationPythonEnvironmentV1() {
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
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
  };
  for (const [key, value] of Object.entries(
    process.env,
  )) {
    if (
      value !== undefined
      && (
        allowedExact.has(key.toUpperCase())
        || key.toUpperCase().startsWith(
          "CUDA_PATH",
        )
      )
    ) {
      environment[key] = value;
    }
  }
  return {
    ...environment,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    TOKENIZERS_PARALLELISM: "false",
  };
}

function plannerInput(
  testCase: CollectionRuntimeCase,
): QueryUnderstandingInputV1 {
  const pack = getCoursePack(
    testCase.coursePackId,
    testCase.coursePackVersion,
  );
  return {
    schemaVersion: 1,
    currentMessage: {
      source: "CURRENT_MESSAGE",
      message: testCase.question,
      messageHash: sha256(testCase.question),
    },
    recentTurns: [...testCase.recentTurns],
    coursePack: {
      id: testCase.coursePackId,
      version: testCase.coursePackVersion,
      label: pack.label,
      summary: pack.summary,
    },
    view: testCase.view,
    hasArtwork: testCase.hasArtwork,
    artworkHash: testCase.artworkHash,
  };
}

function wholeQueryCompiled(
  normalizedText: string,
): CompiledDirectQueryV1 {
  return {
    queryId:
      `query-${sha256(normalizedText).slice(0, 16)}`,
    normalizedText,
    source: "WHOLE_QUERY",
    obligationIds: [],
    modalities: ["TEXT", "IMAGE"],
  };
}

function channelCounts(
  entries: readonly { channel: string }[],
) {
  const counts = {
    LEXICAL: 0,
    TEXT_VECTOR: 0,
    VISUAL_VECTOR: 0,
  };
  for (const entry of entries) {
    if (entry.channel in counts) {
      counts[
        entry.channel as keyof typeof counts
      ] += 1;
    }
  }
  return counts;
}

export type ObligationPlannerCaseRecordV1 = {
  caseId: string;
  request: QueryUnderstandingInputV1;
  result: QueryUnderstandingPlannerResultV1;
  bindingAudit: {
    sourceAnchor: number;
    entity: number;
    constraint: number;
  };
};

type RetrievalArmRecord = {
  status: "EXECUTED" | "CLARIFY";
  retrievalMode?: "BASELINE_REUSED";
  elapsedMs: number;
  expectedProviderCalls: number;
  actualProviderCalls: number;
  batch: DirectEvidenceBatchResultV1 | null;
  rrf: ObligationRrfResultV1 | null;
};

export type ObligationProviderCaseRecordV1 = {
  caseId: string;
  A_WHOLE_QUERY: RetrievalArmRecord;
  B_MODEL_GUIDED: RetrievalArmRecord;
};

export type ObligationPlannerArtifactV1 = {
  schemaVersion: 1;
  kind: "T44_OBLIGATION_PLANNER_OUTPUTS";
  runtimeSuite: {
    id: string;
    version: string;
    suiteHash: string;
  };
  graphifyInvocationCount: 0;
  cases: ObligationPlannerCaseRecordV1[];
};

export type ObligationProviderArtifactV1 = {
  schemaVersion: 1;
  kind: "T44_OBLIGATION_PROVIDER_TRACES";
  runtimeSuite: {
    id: string;
    version: string;
    suiteHash: string;
  };
  expectedCalls: number;
  actualCalls: number;
  channelCounts: {
    LEXICAL: number;
    TEXT_VECTOR: number;
    VISUAL_VECTOR: number;
  };
  matched: boolean;
  graphifyInvocationCount: 0;
  cases: ObligationProviderCaseRecordV1[];
};

export function buildT45ClarifyBaselineReuseV1(
  input: {
    aBatch: DirectEvidenceBatchResultV1;
    aRrf: ObligationRrfResultV1;
    obligationSetHash: string;
  },
) {
  const obligationSetHash =
    HashSchema.parse(input.obligationSetHash);
  return {
    retrievalPlanHash: sha256StableJsonV2({
      status: "CLARIFY_BASELINE_REUSED",
      obligationSetHash,
      directEvidenceBatchHash:
        sha256StableJsonV2(input.aBatch),
      rrfResultHash:
        sha256StableJsonV2(input.aRrf),
    }),
    batch: input.aBatch,
    rrf: input.aRrf,
    providerTrace: {
      status: "CLARIFY" as const,
      retrievalMode: "BASELINE_REUSED" as const,
      elapsedMs: 0,
      expectedProviderCalls: 0,
      actualProviderCalls: 0,
      batch: input.aBatch,
      rrf: input.aRrf,
    },
  };
}

export type T44LabelBlindArtifactsV1 = {
  planner: ObligationPlannerArtifactV1;
  provider: ObligationProviderArtifactV1;
  candidate: T44ObligationCandidateArtifactV1;
  matrixBridge: T44ObligationMatrixBridgeManifestV1;
};

export function assertT45FormalPlannerReadyV1(input: {
  caseId: string;
  status: AnswerObligationSetV1["status"];
  failureCategory:
    QueryUnderstandingPlannerResultV1["audit"]["failureCategory"];
}): void {
  const caseId = IdSchema.parse(input.caseId);
  if (
    input.status !== "DEGRADED"
    && input.failureCategory === null
  ) {
    return;
  }
  throw new Error(
    "T45_FORMAL_PLANNER_NOT_READY:"
      + `${caseId}:`
      + (input.failureCategory ?? input.status),
  );
}

type CollectInput = {
  runtime: ObligationCollectionRuntimePortV1;
  corpus: KnowledgeCorpusBundleV2;
  planner: Pick<
    ReturnType<
      typeof createQueryUnderstandingPlannerV1
    >,
    "plan"
  >;
  workspaceRoot: string;
  device: "cuda" | "cpu";
  clarifyBaselinePolicy?:
    | "EMPTY_B"
    | "REUSE_WHOLE_QUERY_BASELINE";
  requirePlannerReady?: boolean;
};

export function collectObligationLabelBlindArtifactsV1(
  input: {
    runtime: T45RuntimePort;
    corpus: KnowledgeCorpusBundleV2;
    planner: Pick<
      ReturnType<
        typeof createQueryUnderstandingPlannerV1
      >,
      "plan"
    >;
    workspaceRoot: string;
    device: "cuda" | "cpu";
    clarifyBaselinePolicy:
      "REUSE_WHOLE_QUERY_BASELINE";
    requirePlannerReady?: boolean;
  },
): Promise<T44LabelBlindArtifactsV1>;
export function collectObligationLabelBlindArtifactsV1(
  input: CollectInput,
): Promise<T44LabelBlindArtifactsV1>;
export async function collectObligationLabelBlindArtifactsV1(
  input: CollectInput,
): Promise<T44LabelBlindArtifactsV1> {
  const corpus = verifyKnowledgeCorpusBundleV2(
    input.corpus,
  );
  if (
    corpus.bundleHash
      !== input.runtime.identity.corpusBundleHash
  ) {
    throw new Error(
      "T45_OBLIGATION_COLLECTION_CORPUS_BINDING_DRIFT",
    );
  }
  const caseIds = input.runtime.cases.map(
    ({ caseId }) => caseId,
  );
  if (
    caseIds.length < 1
    || caseIds.length > 50
    || new Set(caseIds).size !== caseIds.length
  ) {
    throw new Error(
      "T45_OBLIGATION_COLLECTION_CASE_ID_DRIFT",
    );
  }
  let mixedRuntime:
    Awaited<ReturnType<
      typeof createLocalMixedRuntimeV2
    >> | null = null;
  const plannerCases:
    ObligationPlannerCaseRecordV1[] = [];
  const providerCases:
    ObligationProviderCaseRecordV1[] = [];
  const candidateCases: ReturnType<
    typeof buildT44ObligationCandidateCaseV1
  >[] = [];
  const obligationSets = new Map<
    string,
    AnswerObligationSetV1
  >();
  let expectedCalls = 0;
  try {
    mixedRuntime = await createLocalMixedRuntimeV2(
      obligationRuntimeOptionsV1(
        input.workspaceRoot,
        input.device,
      ),
    );
    for (const testCase of input.runtime.cases) {
      const request = plannerInput(testCase);
      const parentQuery = createRetrievalQueryV2({
        mode: "TEXT_TO_TEXT",
        text: testCase.question,
        scope: {
          corpusBundleHash: corpus.bundleHash,
          sourceCoursePack: {
            id: testCase.coursePackId,
            version:
              testCase.coursePackVersion,
          },
        },
      });
      if (parentQuery.normalizedText === null) {
        throw new Error(
          `T45_OBLIGATION_TEXT_QUERY_REQUIRED:${testCase.caseId}`,
        );
      }
      const beforeA =
        mixedRuntime.providerSpy().entries.length;
      const aStartedAt = performance.now();
      const aBatch =
        await mixedRuntime.probeDirectEvidenceBatch(
          [wholeQueryCompiled(
            parentQuery.normalizedText,
          )],
          { staticParentQuery: parentQuery },
        );
      const aElapsedMs = Math.max(
        0,
        performance.now() - aStartedAt,
      );
      const aRrf = fuseObligationRrfV1(
        aBatch.results,
      );
      const afterA =
        mixedRuntime.providerSpy().entries.length;

      const plannerResult =
        await input.planner.plan(request);
      if (input.requirePlannerReady === true) {
        assertT45FormalPlannerReadyV1({
          caseId: testCase.caseId,
          status: plannerResult.obligationSet.status,
          failureCategory:
            plannerResult.audit.failureCategory,
        });
      }
      const bindingAudit =
        auditT44AnswerObligationBindingsV1({
          request,
          prediction:
            plannerResult.obligationSet,
        });
      plannerCases.push({
        caseId: testCase.caseId,
        request,
        result: plannerResult,
        bindingAudit,
      });
      obligationSets.set(
        testCase.caseId,
        plannerResult.obligationSet,
      );

      let bBatch:
        DirectEvidenceBatchResultV1 | null = null;
      let bRrf: ObligationRrfResultV1 | null = null;
      let bElapsedMs = 0;
      let retrievalPlanHash: string;
      let bProviderTrace: RetrievalArmRecord;
      if (
        plannerResult.obligationSet.status
        === "CLARIFY"
      ) {
        if (
          input.clarifyBaselinePolicy
          === "REUSE_WHOLE_QUERY_BASELINE"
        ) {
          const reused =
            buildT45ClarifyBaselineReuseV1({
              aBatch,
              aRrf,
              obligationSetHash:
                plannerResult.obligationSet
                  .trace.outputHash,
            });
          retrievalPlanHash =
            reused.retrievalPlanHash;
          bBatch = reused.batch;
          bRrf = reused.rrf;
          bProviderTrace =
            reused.providerTrace;
        } else {
          retrievalPlanHash = sha256StableJsonV2({
            status: "CLARIFY",
            obligationSetHash:
              plannerResult.obligationSet
                .trace.outputHash,
          });
          bProviderTrace = {
            status: "CLARIFY",
            elapsedMs: 0,
            expectedProviderCalls: 0,
            actualProviderCalls: 0,
            batch: null,
            rrf: null,
          };
        }
      } else {
        const compiled = compileRetrievalPlanV1(
          plannerResult.obligationSet,
        );
        retrievalPlanHash = compiled.planHash;
        const bStartedAt = performance.now();
        bBatch =
          await mixedRuntime.probeDirectEvidenceBatch(
            compiled.physicalQueries,
            { staticParentQuery: parentQuery },
          );
        bElapsedMs = Math.max(
          0,
          performance.now() - bStartedAt,
        );
        bRrf = fuseObligationRrfV1(
          bBatch.results,
        );
        const afterB =
          mixedRuntime.providerSpy().entries.length;
        bProviderTrace = {
          status: "EXECUTED",
          elapsedMs: bElapsedMs,
          expectedProviderCalls:
            bBatch.expectedProviderCalls,
          actualProviderCalls:
            afterB - afterA,
          batch: bBatch,
          rrf: bRrf,
        };
      }
      const afterB =
        mixedRuntime.providerSpy().entries.length;
      const aActual = afterA - beforeA;
      if (
        bProviderTrace.actualProviderCalls
          !== afterB - afterA
      ) {
        throw new Error(
          `T45_OBLIGATION_B_PROVIDER_COUNT_DRIFT:${testCase.caseId}`,
        );
      }
      expectedCalls +=
        aBatch.expectedProviderCalls
        + bProviderTrace.expectedProviderCalls;
      providerCases.push({
        caseId: testCase.caseId,
        A_WHOLE_QUERY: {
          status: "EXECUTED",
          elapsedMs: aElapsedMs,
          expectedProviderCalls:
            aBatch.expectedProviderCalls,
          actualProviderCalls: aActual,
          batch: aBatch,
          rrf: aRrf,
        },
        B_MODEL_GUIDED: bProviderTrace,
      });
      candidateCases.push(
        buildT44ObligationCandidateCaseV1({
          caseId: testCase.caseId,
          coursePackId:
            testCase.coursePackId,
          coursePackVersion:
            testCase.coursePackVersion,
          normalizedQuestionHash:
            plannerResult.obligationSet
              .normalizedQuestionHash,
          obligationSetHash:
            sha256StableJsonV2(
              plannerResult.obligationSet,
            ),
          retrievalPlanHash,
          aDirectEvidenceBatchHash:
            sha256StableJsonV2(aBatch),
          aRrfResult: aRrf,
          bDirectEvidenceBatchHash:
            bBatch
              ? sha256StableJsonV2(bBatch)
              : null,
          bRrfResult: bRrf,
          corpus,
        }),
      );
    }
    const entries =
      mixedRuntime.providerSpy().entries;
    const counts = channelCounts(entries);
    const actualCalls = entries.length;
    const plannerArtifact:
      ObligationPlannerArtifactV1 = {
        schemaVersion: 1,
        kind: "T44_OBLIGATION_PLANNER_OUTPUTS",
        runtimeSuite: {
          id: input.runtime.identity.id,
          version: input.runtime.identity.version,
          suiteHash:
            input.runtime.identity.suiteHash,
        },
        graphifyInvocationCount: 0,
        cases: plannerCases,
      };
    const providerArtifact:
      ObligationProviderArtifactV1 = {
        schemaVersion: 1,
        kind: "T44_OBLIGATION_PROVIDER_TRACES",
        runtimeSuite: {
          id: input.runtime.identity.id,
          version: input.runtime.identity.version,
          suiteHash:
            input.runtime.identity.suiteHash,
        },
        expectedCalls,
        actualCalls,
        channelCounts: counts,
        matched: expectedCalls === actualCalls,
        graphifyInvocationCount: 0,
        cases: providerCases,
      };
    const candidateArtifact =
      createT44ObligationCandidateArtifactV1({
        runtimeSuite: {
          id: input.runtime.identity.id,
          version: input.runtime.identity.version,
          suiteHash:
            input.runtime.identity.suiteHash,
        },
        corpusBundleHash: corpus.bundleHash,
        providerAudit: {
          expectedCalls,
          actualCalls,
          channelCounts: counts,
          matched: expectedCalls === actualCalls,
        },
        cases: candidateCases,
      });
    const candidateSha256 =
      sealT44ObligationArtifactV1(
        candidateArtifact,
      ).sha256;
    const matrixBridge =
      buildT44ObligationMatrixBridgeManifestV1({
        candidateArtifact,
        candidateArtifactSha256:
          candidateSha256,
        obligationSets,
      });
    return {
      planner: plannerArtifact,
      provider: providerArtifact,
      candidate: candidateArtifact,
      matrixBridge,
    };
  } finally {
    await mixedRuntime?.dispose();
  }
}
