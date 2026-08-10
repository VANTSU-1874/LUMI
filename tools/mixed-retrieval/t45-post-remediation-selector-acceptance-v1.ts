import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
} from "../../lib/knowledge/knowledge-object-v2";
import {
  T45CapabilityInventorySchema,
} from "./t45-capability-loader";

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const IdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const NodeIdSchema = z.string().regex(/^node-[0-9a-f]{64}$/);
const CoursePackIdSchema = z.enum([
  "book-design",
  "brand-vi-design",
  "digital-interaction",
  "general-design",
  "layout-design",
]);

export const POST_REMEDIATION_ACCEPTANCE_VERSION_V1 =
  "2026-07-30.1" as const;
export const POST_REMEDIATION_ACCEPTANCE_RUNTIME_ID_V1 =
  "lumi-t45-post-remediation-selector-acceptance-runtime" as const;
export const POST_REMEDIATION_ACCEPTANCE_QRELS_ID_V1 =
  "lumi-t45-post-remediation-selector-acceptance-qrels" as const;
export const POST_REMEDIATION_ACCEPTANCE_SPLIT_V1 =
  "POST_REMEDIATION_ACCEPTANCE" as const;
export const POST_REMEDIATION_ACCEPTANCE_DENOMINATORS_V1 =
  Object.freeze({
    cases: 20,
    families: 10,
    directCases: 10,
    compositionCases: 10,
    requiredGroups: 30,
    multiClaimCases: 10,
    casesPerCourse: 4,
  });

const RuntimeCaseSchema = z.object({
  caseId: IdSchema,
  familyId: IdSchema,
  stratum: z.enum([
    "DIRECT_PARAPHRASE",
    "COMPOSITION_HARD_DISTRACTOR",
  ]),
  mode: z.literal("TEXT_TO_TEXT"),
  coursePackId: CoursePackIdSchema,
  coursePackVersion: z.literal("1"),
  question: z.string().trim().min(8).max(300),
}).strict();

export const PostRemediationAcceptanceRuntimeV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal(POST_REMEDIATION_ACCEPTANCE_RUNTIME_ID_V1),
  version: z.literal(POST_REMEDIATION_ACCEPTANCE_VERSION_V1),
  split: z.literal(POST_REMEDIATION_ACCEPTANCE_SPLIT_V1),
  corpusSnapshot: z.object({
    path: z.literal("data/knowledge-v2/knowledge-corpus.v2.json"),
    bundleHash: HashSchema,
  }).strict(),
  capabilityInventory: z.object({
    id: z.literal("lumi-t45-capability-inventory"),
    inventoryHash: HashSchema,
  }).strict(),
  cases: z.array(RuntimeCaseSchema).length(
    POST_REMEDIATION_ACCEPTANCE_DENOMINATORS_V1.cases,
  ),
  suiteHash: HashSchema,
}).strict();

const QrelCaseSchema = z.object({
  caseId: IdSchema,
  familyId: IdSchema,
  multiClaim: z.boolean(),
  requiredEvidenceGroups: z.array(z.object({
    groupId: IdSchema,
    acceptableNodeIds: z.array(NodeIdSchema).min(1),
  }).strict()).min(1).max(2),
  hardNegativeNodeIds: z.array(NodeIdSchema).min(1),
}).strict();

export const PostRemediationAcceptanceQrelsV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal(POST_REMEDIATION_ACCEPTANCE_QRELS_ID_V1),
  version: z.literal(POST_REMEDIATION_ACCEPTANCE_VERSION_V1),
  split: z.literal(POST_REMEDIATION_ACCEPTANCE_SPLIT_V1),
  runtimeSuite: z.object({
    id: z.literal(POST_REMEDIATION_ACCEPTANCE_RUNTIME_ID_V1),
    version: z.literal(POST_REMEDIATION_ACCEPTANCE_VERSION_V1),
    suiteHash: HashSchema,
  }).strict(),
  corpusSnapshot: z.object({
    path: z.literal("data/knowledge-v2/knowledge-corpus.v2.json"),
    bundleHash: HashSchema,
  }).strict(),
  capabilityInventory: z.object({
    id: z.literal("lumi-t45-capability-inventory"),
    inventoryHash: HashSchema,
  }).strict(),
  cases: z.array(QrelCaseSchema).length(
    POST_REMEDIATION_ACCEPTANCE_DENOMINATORS_V1.cases,
  ),
  suiteHash: HashSchema,
}).strict();

export type PostRemediationAcceptanceRuntimeV1 = z.infer<
  typeof PostRemediationAcceptanceRuntimeV1Schema
>;
export type PostRemediationAcceptanceQrelsV1 = z.infer<
  typeof PostRemediationAcceptanceQrelsV1Schema
>;

function withoutSuiteHash(value: Record<string, unknown>) {
  const projection = { ...value };
  delete projection.suiteHash;
  return projection;
}

export function postRemediationRuntimeHashV1(
  value: Record<string, unknown>,
) {
  return sha256StableJsonV2(withoutSuiteHash(value));
}

export function postRemediationQrelsHashV1(
  value: Record<string, unknown>,
) {
  return sha256StableJsonV2(withoutSuiteHash(value));
}

function unique(values: readonly string[], code: string) {
  if (new Set(values).size !== values.length) {
    throw new Error(code);
  }
}

function countBy<T>(
  values: readonly T[],
  project: (value: T) => string,
) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = project(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export async function loadPostRemediationSelectorAcceptanceV1(
  workspaceRoot: string,
) {
  const root = path.resolve(workspaceRoot);
  const paths = {
    runtime: path.join(
      root,
      "tests/retrieval-quality/"
        + "t45-post-remediation-selector-acceptance.runtime.json",
    ),
    qrels: path.join(
      root,
      "tests/retrieval-quality/"
        + "t45-post-remediation-selector-acceptance.qrels.json",
    ),
    inventory: path.join(
      root,
      "tests/retrieval-quality/t45-capability-inventory.json",
    ),
    corpus: path.join(
      root,
      "data/knowledge-v2/knowledge-corpus.v2.json",
    ),
    calibrationRuntime: path.join(
      root,
      "tests/retrieval-quality/"
        + "t45-capability-calibration.runtime.json",
    ),
    validationRuntime: path.join(
      root,
      "tests/retrieval-quality/"
        + "t45-capability-validation.runtime.json",
    ),
  };
  const [
    runtimeRaw,
    qrelsRaw,
    inventoryRaw,
    corpusRaw,
    calibrationRaw,
    validationRaw,
  ] = await Promise.all([
    readFile(paths.runtime, "utf8"),
    readFile(paths.qrels, "utf8"),
    readFile(paths.inventory, "utf8"),
    readFile(paths.corpus, "utf8"),
    readFile(paths.calibrationRuntime, "utf8"),
    readFile(paths.validationRuntime, "utf8"),
  ]);
  const runtimeInput = JSON.parse(runtimeRaw) as Record<string, unknown>;
  const qrelsInput = JSON.parse(qrelsRaw) as Record<string, unknown>;
  const runtime =
    PostRemediationAcceptanceRuntimeV1Schema.parse(runtimeInput);
  const qrels =
    PostRemediationAcceptanceQrelsV1Schema.parse(qrelsInput);
  const inventory = T45CapabilityInventorySchema.parse(
    JSON.parse(inventoryRaw) as unknown,
  );
  const corpus = verifyKnowledgeCorpusBundleV2(
    JSON.parse(corpusRaw) as unknown,
  );
  const priorRuntimeCases = [
    ...(JSON.parse(calibrationRaw) as { cases: Array<{
      caseId: string;
      question: string;
    }> }).cases,
    ...(JSON.parse(validationRaw) as { cases: Array<{
      caseId: string;
      question: string;
    }> }).cases,
  ];

  if (
    postRemediationRuntimeHashV1(runtimeInput)
      !== runtime.suiteHash
  ) {
    throw new Error(
      "POST_REMEDIATION_ACCEPTANCE_RUNTIME_HASH_DRIFT",
    );
  }
  if (
    postRemediationQrelsHashV1(qrelsInput)
      !== qrels.suiteHash
  ) {
    throw new Error(
      "POST_REMEDIATION_ACCEPTANCE_QRELS_HASH_DRIFT",
    );
  }
  if (qrels.runtimeSuite.suiteHash !== runtime.suiteHash) {
    throw new Error(
      "POST_REMEDIATION_ACCEPTANCE_RUNTIME_QRELS_DRIFT",
    );
  }
  if (
    runtime.corpusSnapshot.bundleHash !== corpus.bundleHash
    || qrels.corpusSnapshot.bundleHash !== corpus.bundleHash
    || runtime.capabilityInventory.inventoryHash
      !== inventory.inventoryHash
    || qrels.capabilityInventory.inventoryHash
      !== inventory.inventoryHash
  ) {
    throw new Error(
      "POST_REMEDIATION_ACCEPTANCE_SOURCE_BINDING_DRIFT",
    );
  }

  const caseIds = runtime.cases.map(({ caseId }) => caseId);
  const questions = runtime.cases.map(({ question }) => question);
  unique(caseIds, "POST_REMEDIATION_ACCEPTANCE_CASE_ID_DUPLICATE");
  unique(questions, "POST_REMEDIATION_ACCEPTANCE_QUESTION_DUPLICATE");
  const priorCaseIds = new Set(
    priorRuntimeCases.map(({ caseId }) => caseId),
  );
  const priorQuestions = new Set(
    priorRuntimeCases.map(({ question }) => question),
  );
  if (
    runtime.cases.some(({ caseId, question }) =>
      priorCaseIds.has(caseId) || priorQuestions.has(question)
    )
  ) {
    throw new Error(
      "POST_REMEDIATION_ACCEPTANCE_PRIOR_SUITE_OVERLAP",
    );
  }

  const qrelIds = qrels.cases.map(({ caseId }) => caseId);
  if (
    qrelIds.some((caseId, index) => caseId !== caseIds[index])
  ) {
    throw new Error(
      "POST_REMEDIATION_ACCEPTANCE_CASE_ORDER_DRIFT",
    );
  }
  const qrelById = new Map(
    qrels.cases.map((testCase) => [testCase.caseId, testCase]),
  );
  const familyCounts = countBy(
    runtime.cases,
    ({ familyId }) => familyId,
  );
  const courseCounts = countBy(
    runtime.cases,
    ({ coursePackId }) => coursePackId,
  );
  if (
    familyCounts.size
      !== POST_REMEDIATION_ACCEPTANCE_DENOMINATORS_V1.families
    || [...familyCounts.values()].some((count) => count !== 2)
    || courseCounts.size !== CoursePackIdSchema.options.length
    || [...courseCounts.values()].some(
      (count) =>
        count
        !== POST_REMEDIATION_ACCEPTANCE_DENOMINATORS_V1
          .casesPerCourse,
    )
  ) {
    throw new Error(
      "POST_REMEDIATION_ACCEPTANCE_DISTRIBUTION_DRIFT",
    );
  }

  const inventoryFamilyById = new Map(
    inventory.families.map((family) => [family.familyId, family]),
  );
  const inventoryObjectById = new Map(
    inventory.objects.map((object) => [object.objectId, object]),
  );
  const corpusNodeById = new Map(
    corpus.objects.flatMap((object) =>
      object.nodes.map((node) => [node.id, {
        node,
        objectId: object.id,
      }] as const)
    ),
  );
  for (const runtimeCase of runtime.cases) {
    const qrel = qrelById.get(runtimeCase.caseId);
    const family = inventoryFamilyById.get(runtimeCase.familyId);
    if (
      !qrel
      || qrel.familyId !== runtimeCase.familyId
      || qrel.multiClaim
        !== (
          runtimeCase.stratum
            === "COMPOSITION_HARD_DISTRACTOR"
        )
      || qrel.requiredEvidenceGroups.length
        !== (qrel.multiClaim ? 2 : 1)
      || !family
    ) {
      throw new Error(
        `POST_REMEDIATION_ACCEPTANCE_CASE_BINDING_DRIFT:${runtimeCase.caseId}`,
      );
    }
    const familyObjects = family.objectIds.map((objectId) => {
      const object = inventoryObjectById.get(objectId);
      if (!object) {
        throw new Error(
          `POST_REMEDIATION_ACCEPTANCE_OBJECT_MISSING:${objectId}`,
        );
      }
      return object;
    });
    if (
      familyObjects.some(
        (object) =>
          object.partition !== "FROZEN_T44"
          || object.coursePackId !== runtimeCase.coursePackId,
      )
    ) {
      throw new Error(
        `POST_REMEDIATION_ACCEPTANCE_PARTITION_DRIFT:${runtimeCase.caseId}`,
      );
    }
    const allowedObjectIds = new Set(
      familyObjects.map(({ objectId }) => objectId),
    );
    const requiredNodeIds = qrel.requiredEvidenceGroups.flatMap(
      ({ acceptableNodeIds }) => acceptableNodeIds,
    );
    unique(
      requiredNodeIds,
      `POST_REMEDIATION_ACCEPTANCE_REQUIRED_NODE_DUPLICATE:${runtimeCase.caseId}`,
    );
    unique(
      qrel.hardNegativeNodeIds,
      `POST_REMEDIATION_ACCEPTANCE_HARD_NEGATIVE_DUPLICATE:${runtimeCase.caseId}`,
    );
    if (
      qrel.hardNegativeNodeIds.some((nodeId) =>
        requiredNodeIds.includes(nodeId)
      )
    ) {
      throw new Error(
        `POST_REMEDIATION_ACCEPTANCE_LABEL_COLLISION:${runtimeCase.caseId}`,
      );
    }
    for (
      const nodeId
      of [...requiredNodeIds, ...qrel.hardNegativeNodeIds]
    ) {
      const owner = corpusNodeById.get(nodeId);
      if (!owner || !allowedObjectIds.has(owner.objectId)) {
        throw new Error(
          `POST_REMEDIATION_ACCEPTANCE_NODE_SCOPE_DRIFT:${runtimeCase.caseId}:${nodeId}`,
        );
      }
    }
  }
  const groupCount = qrels.cases.reduce(
    (sum, testCase) =>
      sum + testCase.requiredEvidenceGroups.length,
    0,
  );
  const multiClaimCount = qrels.cases.filter(
    ({ multiClaim }) => multiClaim,
  ).length;
  if (
    groupCount
      !== POST_REMEDIATION_ACCEPTANCE_DENOMINATORS_V1
        .requiredGroups
    || multiClaimCount
      !== POST_REMEDIATION_ACCEPTANCE_DENOMINATORS_V1
        .multiClaimCases
  ) {
    throw new Error(
      "POST_REMEDIATION_ACCEPTANCE_DENOMINATOR_DRIFT",
    );
  }
  return {
    runtime,
    qrels,
    inventory,
    corpus,
    audit: {
      cases: runtime.cases.length,
      families: familyCounts.size,
      requiredGroups: groupCount,
      multiClaimCases: multiClaimCount,
      courseCounts: Object.fromEntries(courseCounts),
      sourcePartition: "FROZEN_T44" as const,
      validationQrelsReads: 0 as const,
    },
  };
}

export function projectPostRemediationRuntimePortV1(
  loaded: Awaited<
    ReturnType<typeof loadPostRemediationSelectorAcceptanceV1>
  >,
) {
  return {
    identity: {
      id: loaded.runtime.id,
      version: loaded.runtime.version,
      suiteHash: loaded.runtime.suiteHash,
      corpusBundleHash:
        loaded.runtime.corpusSnapshot.bundleHash,
    },
    cases: loaded.runtime.cases.map((testCase) => ({
      ...testCase,
      recentTurns: [] as const,
      view: {
        id: "student-conversation" as const,
        focus: "mentor" as const,
      },
      hasArtwork: false,
      artworkHash: null,
    })),
  };
}
