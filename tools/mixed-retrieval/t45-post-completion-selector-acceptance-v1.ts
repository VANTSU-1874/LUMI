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

export const POST_COMPLETION_ACCEPTANCE_VERSION_V1 =
  "2026-07-30.2" as const;
export const POST_COMPLETION_ACCEPTANCE_RUNTIME_ID_V1 =
  "lumi-t45-post-completion-selector-acceptance-runtime" as const;
export const POST_COMPLETION_ACCEPTANCE_QRELS_ID_V1 =
  "lumi-t45-post-completion-selector-acceptance-qrels" as const;
export const POST_COMPLETION_ACCEPTANCE_SPLIT_V1 =
  "POST_COMPLETION_ACCEPTANCE" as const;
export const POST_COMPLETION_ACCEPTANCE_DENOMINATORS_V1 =
  Object.freeze({
    cases: 20,
    families: 10,
    directCases: 10,
    compositionCases: 10,
    requiredGroups: 30,
    multiClaimCases: 10,
    casesPerCourse: 4,
    newObjectFamilies: 8,
    reusedBrandFamilies: 2,
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

export const PostCompletionAcceptanceRuntimeV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal(POST_COMPLETION_ACCEPTANCE_RUNTIME_ID_V1),
  version: z.literal(POST_COMPLETION_ACCEPTANCE_VERSION_V1),
  split: z.literal(POST_COMPLETION_ACCEPTANCE_SPLIT_V1),
  corpusSnapshot: z.object({
    path: z.literal("data/knowledge-v2/knowledge-corpus.v2.json"),
    bundleHash: HashSchema,
  }).strict(),
  capabilityInventory: z.object({
    id: z.literal("lumi-t45-capability-inventory"),
    inventoryHash: HashSchema,
  }).strict(),
  cases: z.array(RuntimeCaseSchema).length(
    POST_COMPLETION_ACCEPTANCE_DENOMINATORS_V1.cases,
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

export const PostCompletionAcceptanceQrelsV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal(POST_COMPLETION_ACCEPTANCE_QRELS_ID_V1),
  version: z.literal(POST_COMPLETION_ACCEPTANCE_VERSION_V1),
  split: z.literal(POST_COMPLETION_ACCEPTANCE_SPLIT_V1),
  runtimeSuite: z.object({
    id: z.literal(POST_COMPLETION_ACCEPTANCE_RUNTIME_ID_V1),
    version: z.literal(POST_COMPLETION_ACCEPTANCE_VERSION_V1),
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
    POST_COMPLETION_ACCEPTANCE_DENOMINATORS_V1.cases,
  ),
  suiteHash: HashSchema,
}).strict();

function withoutSuiteHash(value: Record<string, unknown>) {
  const projection = { ...value };
  delete projection.suiteHash;
  return projection;
}

export function postCompletionRuntimeHashV1(
  value: Record<string, unknown>,
) {
  return sha256StableJsonV2(withoutSuiteHash(value));
}

export function postCompletionQrelsHashV1(
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

export async function loadPostCompletionSelectorAcceptanceV1(
  workspaceRoot: string,
) {
  const root = path.resolve(workspaceRoot);
  const file = (name: string) => path.join(
    root,
    "tests/retrieval-quality",
    name,
  );
  const [
    runtimeRaw,
    qrelsRaw,
    inventoryRaw,
    corpusRaw,
    calibrationRaw,
    validationRaw,
    previousRaw,
  ] = await Promise.all([
    readFile(file(
      "t45-post-completion-selector-acceptance.runtime.json",
    ), "utf8"),
    readFile(file(
      "t45-post-completion-selector-acceptance.qrels.json",
    ), "utf8"),
    readFile(file("t45-capability-inventory.json"), "utf8"),
    readFile(path.join(
      root,
      "data/knowledge-v2/knowledge-corpus.v2.json",
    ), "utf8"),
    readFile(file("t45-capability-calibration.runtime.json"), "utf8"),
    readFile(file("t45-capability-validation.runtime.json"), "utf8"),
    readFile(file(
      "t45-post-remediation-selector-acceptance.runtime.json",
    ), "utf8"),
  ]);
  const runtimeInput = JSON.parse(runtimeRaw) as Record<string, unknown>;
  const qrelsInput = JSON.parse(qrelsRaw) as Record<string, unknown>;
  const runtime =
    PostCompletionAcceptanceRuntimeV1Schema.parse(runtimeInput);
  const qrels =
    PostCompletionAcceptanceQrelsV1Schema.parse(qrelsInput);
  const inventory = T45CapabilityInventorySchema.parse(
    JSON.parse(inventoryRaw) as unknown,
  );
  const corpus = verifyKnowledgeCorpusBundleV2(
    JSON.parse(corpusRaw) as unknown,
  );
  const previousRuntime = JSON.parse(previousRaw) as {
    cases: Array<{
      caseId: string;
      familyId: string;
      question: string;
    }>;
  };
  const priorCases = [
    ...(JSON.parse(calibrationRaw) as {
      cases: Array<{ caseId: string; question: string }>;
    }).cases,
    ...(JSON.parse(validationRaw) as {
      cases: Array<{ caseId: string; question: string }>;
    }).cases,
    ...previousRuntime.cases,
  ];
  if (
    postCompletionRuntimeHashV1(runtimeInput) !== runtime.suiteHash
    || postCompletionQrelsHashV1(qrelsInput) !== qrels.suiteHash
    || qrels.runtimeSuite.suiteHash !== runtime.suiteHash
    || runtime.corpusSnapshot.bundleHash !== corpus.bundleHash
    || qrels.corpusSnapshot.bundleHash !== corpus.bundleHash
    || runtime.capabilityInventory.inventoryHash
      !== inventory.inventoryHash
    || qrels.capabilityInventory.inventoryHash
      !== inventory.inventoryHash
  ) {
    throw new Error("POST_COMPLETION_ACCEPTANCE_SOURCE_BINDING_DRIFT");
  }

  unique(
    runtime.cases.map(({ caseId }) => caseId),
    "POST_COMPLETION_ACCEPTANCE_CASE_ID_DUPLICATE",
  );
  unique(
    runtime.cases.map(({ question }) => question),
    "POST_COMPLETION_ACCEPTANCE_QUESTION_DUPLICATE",
  );
  unique(
    qrels.cases.map(({ caseId }) => caseId),
    "POST_COMPLETION_ACCEPTANCE_QREL_CASE_DUPLICATE",
  );
  const priorIds = new Set(priorCases.map(({ caseId }) => caseId));
  const priorQuestions = new Set(priorCases.map(({ question }) => question));
  if (
    runtime.cases.some(({ caseId, question }) =>
      priorIds.has(caseId) || priorQuestions.has(question)
    )
  ) {
    throw new Error("POST_COMPLETION_ACCEPTANCE_CASE_ISOLATION_DRIFT");
  }

  const familyCounts = countBy(
    runtime.cases,
    ({ familyId }) => familyId,
  );
  const courseCounts = countBy(
    runtime.cases,
    ({ coursePackId }) => coursePackId,
  );
  const directCount = runtime.cases.filter(
    ({ stratum }) => stratum === "DIRECT_PARAPHRASE",
  ).length;
  const compositionCount = runtime.cases.length - directCount;
  if (
    familyCounts.size
      !== POST_COMPLETION_ACCEPTANCE_DENOMINATORS_V1.families
    || [...familyCounts.values()].some((count) => count !== 2)
    || courseCounts.size !== 5
    || [...courseCounts.values()].some(
      (count) =>
        count
          !== POST_COMPLETION_ACCEPTANCE_DENOMINATORS_V1.casesPerCourse,
    )
    || directCount
      !== POST_COMPLETION_ACCEPTANCE_DENOMINATORS_V1.directCases
    || compositionCount
      !== POST_COMPLETION_ACCEPTANCE_DENOMINATORS_V1.compositionCases
  ) {
    throw new Error("POST_COMPLETION_ACCEPTANCE_DISTRIBUTION_DRIFT");
  }

  const familyById = new Map(
    inventory.families.map((family) => [family.familyId, family]),
  );
  const objectById = new Map(
    inventory.objects.map((object) => [object.objectId, object]),
  );
  const corpusNodeById = new Map(
    corpus.objects.flatMap((object) =>
      object.nodes.map((node) => [node.id, object.id] as const)
    ),
  );
  const qrelById = new Map(
    qrels.cases.map((testCase) => [testCase.caseId, testCase]),
  );
  const previousFamilies = new Set(
    previousRuntime.cases.map(({ familyId }) => familyId),
  );
  let newObjectFamilies = 0;
  let reusedBrandFamilies = 0;

  for (const testCase of runtime.cases) {
    const qrel = qrelById.get(testCase.caseId);
    const family = familyById.get(testCase.familyId);
    if (
      !qrel
      || qrel.familyId !== testCase.familyId
      || qrel.multiClaim
        !== (
          testCase.stratum === "COMPOSITION_HARD_DISTRACTOR"
        )
      || qrel.requiredEvidenceGroups.length
        !== (qrel.multiClaim ? 2 : 1)
      || !family
    ) {
      throw new Error(
        `POST_COMPLETION_ACCEPTANCE_CASE_BINDING_DRIFT:${testCase.caseId}`,
      );
    }
    const familyObjects = family.objectIds.map((objectId) => {
      const object = objectById.get(objectId);
      if (!object) {
        throw new Error(
          `POST_COMPLETION_ACCEPTANCE_OBJECT_MISSING:${objectId}`,
        );
      }
      return object;
    });
    if (
      familyObjects.some(
        (object) =>
          object.partition !== "FROZEN_T44"
          || object.coursePackId !== testCase.coursePackId,
      )
    ) {
      throw new Error(
        `POST_COMPLETION_ACCEPTANCE_PARTITION_DRIFT:${testCase.caseId}`,
      );
    }
    const requiredNodeIds = qrel.requiredEvidenceGroups.flatMap(
      ({ acceptableNodeIds }) => acceptableNodeIds,
    );
    unique(
      requiredNodeIds,
      `POST_COMPLETION_ACCEPTANCE_REQUIRED_NODE_DUPLICATE:${testCase.caseId}`,
    );
    unique(
      qrel.hardNegativeNodeIds,
      `POST_COMPLETION_ACCEPTANCE_HARD_NEGATIVE_DUPLICATE:${testCase.caseId}`,
    );
    if (
      qrel.hardNegativeNodeIds.some((nodeId) =>
        requiredNodeIds.includes(nodeId)
      )
    ) {
      throw new Error(
        `POST_COMPLETION_ACCEPTANCE_LABEL_COLLISION:${testCase.caseId}`,
      );
    }
    const allowedObjectIds = new Set(family.objectIds);
    for (
      const nodeId
      of [...requiredNodeIds, ...qrel.hardNegativeNodeIds]
    ) {
      const owner = corpusNodeById.get(nodeId);
      if (!owner || !allowedObjectIds.has(owner)) {
        throw new Error(
          `POST_COMPLETION_ACCEPTANCE_NODE_SCOPE_DRIFT:${testCase.caseId}:${nodeId}`,
        );
      }
    }
  }
  for (const familyId of familyCounts.keys()) {
    const repeated = previousFamilies.has(familyId);
    const course = runtime.cases.find(
      (testCase) => testCase.familyId === familyId,
    )?.coursePackId;
    if (repeated && course === "brand-vi-design") {
      reusedBrandFamilies += 1;
    } else if (!repeated) {
      newObjectFamilies += 1;
    } else {
      throw new Error(
        `POST_COMPLETION_ACCEPTANCE_UNDECLARED_FAMILY_REUSE:${familyId}`,
      );
    }
  }
  if (
    newObjectFamilies
      !== POST_COMPLETION_ACCEPTANCE_DENOMINATORS_V1.newObjectFamilies
    || reusedBrandFamilies
      !== POST_COMPLETION_ACCEPTANCE_DENOMINATORS_V1.reusedBrandFamilies
  ) {
    throw new Error("POST_COMPLETION_ACCEPTANCE_INDEPENDENCE_DRIFT");
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
      !== POST_COMPLETION_ACCEPTANCE_DENOMINATORS_V1.requiredGroups
    || multiClaimCount
      !== POST_COMPLETION_ACCEPTANCE_DENOMINATORS_V1.multiClaimCases
  ) {
    throw new Error("POST_COMPLETION_ACCEPTANCE_DENOMINATOR_DRIFT");
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
      newObjectFamilies,
      reusedBrandFamilies,
      priorScoreFileReads: 0 as const,
    },
  };
}

export function projectPostCompletionRuntimePortV1(
  loaded: Awaited<
    ReturnType<typeof loadPostCompletionSelectorAcceptanceV1>
  >,
) {
  return {
    identity: {
      id: loaded.runtime.id,
      version: loaded.runtime.version,
      suiteHash: loaded.runtime.suiteHash,
      corpusBundleHash: loaded.runtime.corpusSnapshot.bundleHash,
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
