import { z } from "zod";

import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "../../lib/knowledge/knowledge-object-v2";
import {
  compareUnicodeCodePoints,
  isT45EligibleNode,
  t45CapabilityFingerprint,
  T45_CAPABILITY_CORPUS_BUNDLE_SHA256,
  T45_CAPABILITY_INVENTORY_ID,
  T45_CAPABILITY_STRATA,
  T45_CAPABILITY_VERSION,
  type T45CapabilityInventoryV1,
  type T45CapabilityPartition,
  type T45CapabilityQrelsSuite,
  type T45CapabilityRuntimeSuite,
  type T45CapabilitySplit,
  type T45RuntimeVisibleCase,
} from "./t45-capability-authoring";

export type {
  T45CapabilityInventoryV1,
  T45CapabilityQrelsSuite,
  T45CapabilityRuntimeSuite,
  T45CapabilitySplit,
  T45RuntimeVisibleCase,
} from "./t45-capability-authoring";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NODE_ID_PATTERN = /^node-[0-9a-f]{64}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IdSchema = z.string().regex(ID_PATTERN);
const NodeIdSchema = z.string().regex(NODE_ID_PATTERN);
const HashSchema = z.string().regex(HASH_PATTERN);

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
const SplitSchema = z.enum([
  "CALIBRATION",
  "VALIDATION",
]);
const StratumSchema = z.enum(T45_CAPABILITY_STRATA);
const RuntimeIdSchema = z.enum([
  "lumi-t45-capability-calibration-runtime",
  "lumi-t45-capability-validation-runtime",
]);
const QrelsIdSchema = z.enum([
  "lumi-t45-capability-calibration-qrels",
  "lumi-t45-capability-validation-qrels",
]);

const InventoryObjectSchema = z
  .object({
    objectId: IdSchema,
    coursePackId: CoursePackIdSchema,
    objectContentHash: HashSchema,
    eligibleNodeIds: z.array(NodeIdSchema).min(1),
    capabilityFingerprint: HashSchema,
    familyId: IdSchema,
    partition: PartitionSchema,
  })
  .strict();

const InventoryFamilySchema = z
  .object({
    familyId: IdSchema,
    objectIds: z.array(IdSchema).min(1).max(50),
    partition: PartitionSchema,
  })
  .strict();

const InventoryInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.literal(T45_CAPABILITY_INVENTORY_ID),
    corpusBundleHash: HashSchema,
    fingerprintPolicy: z
      .object({
        normalization: z.literal("NFKC_TRIM"),
        projection: z.literal("KIND_ROLE_BODY_SORTED"),
        hash: z.literal("SHA256"),
      })
      .strict(),
    objects: z.array(InventoryObjectSchema).length(116),
    families: z.array(InventoryFamilySchema).length(63),
  })
  .strict();

export const T45CapabilityInventorySchema =
  InventoryInputSchema.extend({
    inventoryHash: HashSchema,
  }).strict();

const CorpusSnapshotSchema = z
  .object({
    path: z.literal(
      "data/knowledge-v2/knowledge-corpus.v2.json",
    ),
    bundleHash: HashSchema,
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

const RuntimeInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: RuntimeIdSchema,
    version: z.literal(T45_CAPABILITY_VERSION),
    split: SplitSchema,
    corpusSnapshot: CorpusSnapshotSchema,
    cases: z.array(RuntimeCaseSchema).length(20),
  })
  .strict();

export const T45CapabilityRuntimeSuiteSchema =
  RuntimeInputSchema.extend({
    suiteHash: HashSchema,
  }).strict();

const EvidenceGroupSchema = z
  .object({
    groupId: IdSchema,
    acceptableNodeIds: z
      .array(NodeIdSchema)
      .min(1)
      .max(4),
  })
  .strict();

const QrelsCaseSchema = z
  .object({
    caseId: IdSchema,
    familyId: IdSchema,
    multiClaim: z.boolean(),
    requiredEvidenceGroups: z
      .array(EvidenceGroupSchema)
      .min(1)
      .max(2),
    hardNegativeNodeIds: z
      .array(NodeIdSchema)
      .min(1)
      .max(4),
  })
  .strict();

const QrelsInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: QrelsIdSchema,
    version: z.literal(T45_CAPABILITY_VERSION),
    split: SplitSchema,
    runtimeSuite: z
      .object({
        id: RuntimeIdSchema,
        version: z.literal(T45_CAPABILITY_VERSION),
        suiteHash: HashSchema,
      })
      .strict(),
    corpusSnapshot: CorpusSnapshotSchema,
    capabilityInventory: z
      .object({
        id: z.literal(T45_CAPABILITY_INVENTORY_ID),
        inventoryHash: HashSchema,
      })
      .strict(),
    cases: z.array(QrelsCaseSchema).length(20),
  })
  .strict();

export const T45CapabilityQrelsSuiteSchema =
  QrelsInputSchema.extend({
    suiteHash: HashSchema,
  }).strict();

function withoutField(
  value: Record<string, unknown>,
  field: string,
) {
  const result = { ...value };
  delete result[field];
  return result;
}

export function t45CapabilityInventoryHash(
  inventory: T45CapabilityInventoryV1,
) {
  const parsed =
    T45CapabilityInventorySchema.parse(inventory);
  return sha256StableJsonV2(
    withoutField(parsed, "inventoryHash"),
  );
}

export function t45CapabilityRuntimeSuiteHash(
  runtime: T45CapabilityRuntimeSuite,
) {
  const parsed =
    T45CapabilityRuntimeSuiteSchema.parse(runtime);
  return sha256StableJsonV2(
    withoutField(parsed, "suiteHash"),
  );
}

export function t45CapabilityQrelsSuiteHash(
  qrels: T45CapabilityQrelsSuite,
) {
  const parsed =
    T45CapabilityQrelsSuiteSchema.parse(qrels);
  return sha256StableJsonV2(
    withoutField(parsed, "suiteHash"),
  );
}

function assertUnique(
  values: readonly string[],
  code: string,
) {
  if (new Set(values).size !== values.length) {
    throw new Error(code);
  }
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function expectedPartition(
  split: T45CapabilitySplit,
): T45CapabilityPartition {
  return split === "CALIBRATION"
    ? "DEV_CAL"
    : "VALIDATION";
}

function expectedIds(split: T45CapabilitySplit) {
  return split === "CALIBRATION"
    ? {
        runtime:
          "lumi-t45-capability-calibration-runtime",
        qrels:
          "lumi-t45-capability-calibration-qrels",
      }
    : {
        runtime:
          "lumi-t45-capability-validation-runtime",
        qrels:
          "lumi-t45-capability-validation-qrels",
      };
}

function assertNoCrossPartitionCapabilities(
  inventory: T45CapabilityInventoryV1,
) {
  const partitionsByFingerprint = new Map<
    string,
    Set<T45CapabilityPartition>
  >();
  const partitionsByFamily = new Map<
    string,
    Set<T45CapabilityPartition>
  >();
  for (const object of inventory.objects) {
    const fingerprintPartitions =
      partitionsByFingerprint.get(
        object.capabilityFingerprint,
      ) ?? new Set<T45CapabilityPartition>();
    fingerprintPartitions.add(object.partition);
    partitionsByFingerprint.set(
      object.capabilityFingerprint,
      fingerprintPartitions,
    );
    const familyPartitions =
      partitionsByFamily.get(object.familyId)
      ?? new Set<T45CapabilityPartition>();
    familyPartitions.add(object.partition);
    partitionsByFamily.set(
      object.familyId,
      familyPartitions,
    );
  }
  for (const family of inventory.families) {
    const familyPartitions =
      partitionsByFamily.get(family.familyId)
      ?? new Set<T45CapabilityPartition>();
    familyPartitions.add(family.partition);
    partitionsByFamily.set(
      family.familyId,
      familyPartitions,
    );
  }
  for (
    const [fingerprint, partitions]
    of partitionsByFingerprint
  ) {
    if (partitions.size > 1) {
      throw new Error(
        "T45_CAPABILITY_FINGERPRINT_CROSSES_PARTITIONS:"
        + fingerprint,
      );
    }
  }
  for (const [familyId, partitions] of partitionsByFamily) {
    if (partitions.size > 1) {
      throw new Error(
        `T45_CAPABILITY_FAMILY_CROSSES_PARTITIONS:${familyId}`,
      );
    }
  }
}

function assertInventoryBindings(
  inventory: T45CapabilityInventoryV1,
  corpusInput: unknown,
) {
  assertNoCrossPartitionCapabilities(inventory);
  const corpus = verifyKnowledgeCorpusBundleV2(
    corpusInput,
  );
  if (
    corpus.bundleHash
      !== T45_CAPABILITY_CORPUS_BUNDLE_SHA256
    || inventory.corpusBundleHash !== corpus.bundleHash
  ) {
    throw new Error(
      "T45_CAPABILITY_CORPUS_IDENTITY_MISMATCH",
    );
  }
  if (corpus.objects.length !== 116) {
    throw new Error(
      "T45_CAPABILITY_CORPUS_OBJECT_COUNT_INVALID",
    );
  }
  assertUnique(
    inventory.objects.map(({ objectId }) => objectId),
    "T45_CAPABILITY_OBJECT_IDS_NOT_UNIQUE",
  );
  assertUnique(
    inventory.families.map(({ familyId }) => familyId),
    "T45_CAPABILITY_FAMILY_IDS_NOT_UNIQUE",
  );

  const inventoryByObjectId = new Map(
    inventory.objects.map((entry) => [
      entry.objectId,
      entry,
    ]),
  );
  for (const object of corpus.objects) {
    const entry = inventoryByObjectId.get(object.id);
    if (!entry) {
      throw new Error(
        `T45_CAPABILITY_CORPUS_OBJECT_UNMAPPED:${object.id}`,
      );
    }
    if (entry.objectContentHash !== object.contentHash) {
      throw new Error(
        `T45_CAPABILITY_OBJECT_CONTENT_HASH_MISMATCH:${object.id}`,
      );
    }
    if (
      entry.coursePackId !== object.sourceCoursePack.id
      || object.sourceCoursePack.version !== "1"
    ) {
      throw new Error(
        `T45_CAPABILITY_OBJECT_COURSE_MISMATCH:${object.id}`,
      );
    }
    assertUnique(
      entry.eligibleNodeIds,
      `T45_CAPABILITY_ELIGIBLE_NODE_IDS_NOT_UNIQUE:${object.id}`,
    );
    const eligibleNodeIds = object.nodes
      .filter(isT45EligibleNode)
      .map(({ id }) => id)
      .sort(compareUnicodeCodePoints);
    if (
      !arraysEqual(
        entry.eligibleNodeIds,
        eligibleNodeIds,
      )
    ) {
      throw new Error(
        `T45_CAPABILITY_ELIGIBLE_NODE_BINDING_MISMATCH:${object.id}`,
      );
    }
    if (
      entry.capabilityFingerprint
      !== t45CapabilityFingerprint(object)
    ) {
      throw new Error(
        `T45_CAPABILITY_FINGERPRINT_MISMATCH:${object.id}`,
      );
    }
  }
  for (const entry of inventory.objects) {
    if (
      !corpus.objects.some(
        ({ id }) => id === entry.objectId,
      )
    ) {
      throw new Error(
        `T45_CAPABILITY_INVENTORY_OBJECT_MISSING:${entry.objectId}`,
      );
    }
  }

  const familyById = new Map(
    inventory.families.map((family) => [
      family.familyId,
      family,
    ]),
  );
  const familyMemberships: string[] = [];
  for (const family of inventory.families) {
    assertUnique(
      family.objectIds,
      `T45_CAPABILITY_FAMILY_OBJECTS_NOT_UNIQUE:${family.familyId}`,
    );
    for (const objectId of family.objectIds) {
      familyMemberships.push(objectId);
      const object = inventoryByObjectId.get(objectId);
      if (
        !object
        || object.familyId !== family.familyId
        || object.partition !== family.partition
      ) {
        throw new Error(
          "T45_CAPABILITY_FAMILY_MEMBERSHIP_INVALID:"
          + `${family.familyId}:${objectId}`,
        );
      }
    }
  }
  assertUnique(
    familyMemberships,
    "T45_CAPABILITY_OBJECT_IN_MULTIPLE_FAMILIES",
  );
  if (
    familyMemberships.length !== inventory.objects.length
  ) {
    throw new Error(
      "T45_CAPABILITY_FAMILY_MEMBERSHIP_INCOMPLETE",
    );
  }
  for (const object of inventory.objects) {
    if (!familyById.has(object.familyId)) {
      throw new Error(
        `T45_CAPABILITY_OBJECT_FAMILY_MISSING:${object.objectId}`,
      );
    }
  }

  const objectCounts = new Map<
    T45CapabilityPartition,
    number
  >([
    ["FROZEN_T44", 0],
    ["DEV_CAL", 0],
    ["VALIDATION", 0],
    ["VISUAL_RESERVE", 0],
  ]);
  for (const object of inventory.objects) {
    objectCounts.set(
      object.partition,
      objectCounts.get(object.partition)! + 1,
    );
  }
  const expectedObjectCounts:
    Record<T45CapabilityPartition, number> = {
      FROZEN_T44: 42,
      DEV_CAL: 11,
      VALIDATION: 13,
      VISUAL_RESERVE: 50,
    };
  for (
    const [partition, expected]
    of Object.entries(expectedObjectCounts) as [
      T45CapabilityPartition,
      number,
    ][]
  ) {
    if (objectCounts.get(partition) !== expected) {
      throw new Error(
        "T45_CAPABILITY_PARTITION_OBJECT_COUNT_INVALID:"
        + `${partition}:${objectCounts.get(partition)}`,
      );
    }
  }
  const familyCounts = new Map<
    T45CapabilityPartition,
    number
  >();
  for (const family of inventory.families) {
    familyCounts.set(
      family.partition,
      (familyCounts.get(family.partition) ?? 0) + 1,
    );
  }
  for (
    const [partition, expected]
    of [
      ["FROZEN_T44", 42],
      ["DEV_CAL", 10],
      ["VALIDATION", 10],
      ["VISUAL_RESERVE", 1],
    ] as const
  ) {
    if (familyCounts.get(partition) !== expected) {
      throw new Error(
        "T45_CAPABILITY_PARTITION_FAMILY_COUNT_INVALID:"
        + `${partition}:${familyCounts.get(partition)}`,
      );
    }
  }

  const posters = inventory.objects.filter(
    ({ partition }) => partition === "VISUAL_RESERVE",
  );
  if (
    posters.some(
      ({ familyId }) =>
        familyId !== "poster-analysis-template",
    )
    || new Set(
      posters.map(
        ({ capabilityFingerprint }) =>
          capabilityFingerprint,
      ),
    ).size !== 1
  ) {
    throw new Error(
      "T45_CAPABILITY_VISUAL_RESERVE_CLUSTER_INVALID",
    );
  }
  return corpus;
}

function assertSuiteBindings(
  inventory: T45CapabilityInventoryV1,
  runtime: T45CapabilityRuntimeSuite,
  qrels: T45CapabilityQrelsSuite,
  corpus: KnowledgeCorpusBundleV2,
  expectedSplitValue: T45CapabilitySplit,
) {
  const ids = expectedIds(expectedSplitValue);
  if (
    runtime.split !== expectedSplitValue
    || qrels.split !== expectedSplitValue
    || runtime.id !== ids.runtime
    || qrels.id !== ids.qrels
  ) {
    throw new Error(
      "T45_CAPABILITY_EXPECTED_SPLIT_MISMATCH",
    );
  }
  if (
    runtime.corpusSnapshot.bundleHash
      !== corpus.bundleHash
    || qrels.corpusSnapshot.bundleHash
      !== corpus.bundleHash
  ) {
    throw new Error(
      "T45_CAPABILITY_SUITE_CORPUS_MISMATCH",
    );
  }
  if (
    qrels.runtimeSuite.id !== runtime.id
    || qrels.runtimeSuite.version !== runtime.version
    || qrels.runtimeSuite.suiteHash !== runtime.suiteHash
  ) {
    throw new Error(
      "T45_CAPABILITY_RUNTIME_QRELS_BINDING_MISMATCH",
    );
  }
  if (
    qrels.capabilityInventory.id !== inventory.id
    || qrels.capabilityInventory.inventoryHash
      !== inventory.inventoryHash
  ) {
    throw new Error(
      "T45_CAPABILITY_INVENTORY_QRELS_BINDING_MISMATCH",
    );
  }

  const runtimeCaseIds = runtime.cases.map(
    ({ caseId }) => caseId,
  );
  const qrelsCaseIds = qrels.cases.map(
    ({ caseId }) => caseId,
  );
  assertUnique(
    runtimeCaseIds,
    "T45_CAPABILITY_RUNTIME_CASE_IDS_NOT_UNIQUE",
  );
  assertUnique(
    qrelsCaseIds,
    "T45_CAPABILITY_QREL_CASE_IDS_NOT_UNIQUE",
  );
  assertUnique(
    runtime.cases.map(({ question }) =>
      question
        .normalize("NFKC")
        .trim()
        .toLocaleLowerCase("zh-CN")),
    "T45_CAPABILITY_RUNTIME_QUESTIONS_NOT_UNIQUE",
  );
  if (!arraysEqual(runtimeCaseIds, qrelsCaseIds)) {
    throw new Error(
      "T45_CAPABILITY_CASE_ORDER_MISMATCH",
    );
  }

  const partition =
    expectedPartition(expectedSplitValue);
  const allowedFamilies = new Set(
    inventory.families
      .filter(
        (family) => family.partition === partition,
      )
      .map(({ familyId }) => familyId),
  );
  const inventoryByObjectId = new Map(
    inventory.objects.map((object) => [
      object.objectId,
      object,
    ]),
  );
  const qrelByCaseId = new Map(
    qrels.cases.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  for (const runtimeCase of runtime.cases) {
    const qrel = qrelByCaseId.get(runtimeCase.caseId)!;
    if (
      !allowedFamilies.has(runtimeCase.familyId)
      || !allowedFamilies.has(qrel.familyId)
    ) {
      throw new Error(
        "T45_CAPABILITY_CASE_FAMILY_OUTSIDE_SPLIT:"
        + runtimeCase.caseId,
      );
    }
    if (runtimeCase.familyId !== qrel.familyId) {
      throw new Error(
        "T45_CAPABILITY_RUNTIME_QREL_FAMILY_MISMATCH:"
        + runtimeCase.caseId,
      );
    }
  }

  const runtimeFamilies = new Set(
    runtime.cases.map(({ familyId }) => familyId),
  );
  if (runtimeFamilies.size !== 10) {
    throw new Error(
      "T45_CAPABILITY_SUITE_FAMILY_COUNT_INVALID",
    );
  }
  for (const familyId of runtimeFamilies) {
    const familyCases = runtime.cases.filter(
      (testCase) => testCase.familyId === familyId,
    );
    if (
      familyCases.length !== 2
      || T45_CAPABILITY_STRATA.some(
        (stratum) =>
          familyCases.filter(
            (testCase) =>
              testCase.stratum === stratum,
          ).length !== 1,
      )
    ) {
      throw new Error(
        `T45_CAPABILITY_FAMILY_STRATA_INVALID:${familyId}`,
      );
    }
  }
  const groupCount = qrels.cases.reduce(
    (sum, testCase) =>
      sum + testCase.requiredEvidenceGroups.length,
    0,
  );
  if (groupCount !== 30) {
    throw new Error(
      `T45_CAPABILITY_GROUP_COUNT_INVALID:${groupCount}`,
    );
  }
  if (
    qrels.cases.filter(({ multiClaim }) => multiClaim)
      .length !== 10
  ) {
    throw new Error(
      "T45_CAPABILITY_MULTI_COUNT_INVALID",
    );
  }

  const nodeById = new Map(
    corpus.objects.flatMap((object) =>
      object.nodes.map((node) => [
        node.id,
        { object, node },
      ] as const)),
  );
  for (const runtimeCase of runtime.cases) {
    const qrel = qrelByCaseId.get(runtimeCase.caseId)!;
    const expectedGroupCount =
      runtimeCase.stratum === "DIRECT_PARAPHRASE"
        ? 1
        : 2;
    if (
      qrel.requiredEvidenceGroups.length
      !== expectedGroupCount
    ) {
      throw new Error(
        "T45_CAPABILITY_GROUP_COUNT_STRATUM_MISMATCH:"
        + `${qrel.caseId}:`
        + qrel.requiredEvidenceGroups.length,
      );
    }
    if (
      qrel.multiClaim
      !== (
        runtimeCase.stratum
        === "COMPOSITION_HARD_DISTRACTOR"
      )
    ) {
      throw new Error(
        `T45_CAPABILITY_MULTI_STRATUM_MISMATCH:${qrel.caseId}`,
      );
    }
    assertUnique(
      qrel.requiredEvidenceGroups.map(
        ({ groupId }) => groupId,
      ),
      `T45_CAPABILITY_GROUP_IDS_NOT_UNIQUE:${qrel.caseId}`,
    );
    const requiredNodeIds = new Set<string>();
    for (const group of qrel.requiredEvidenceGroups) {
      assertUnique(
        group.acceptableNodeIds,
        "T45_CAPABILITY_GROUP_NODE_IDS_NOT_UNIQUE:"
        + `${qrel.caseId}:${group.groupId}`,
      );
      for (const nodeId of group.acceptableNodeIds) {
        const binding = nodeById.get(nodeId);
        const inventoryObject = binding
          ? inventoryByObjectId.get(binding.object.id)
          : undefined;
        if (
          !binding
          || !inventoryObject
          || !isT45EligibleNode(binding.node)
          || !inventoryObject.eligibleNodeIds.includes(
            nodeId,
          )
          || inventoryObject.partition !== partition
          || inventoryObject.familyId
            !== runtimeCase.familyId
          || binding.object.sourceCoursePack.id
            !== runtimeCase.coursePackId
          || binding.object.sourceCoursePack.version
            !== runtimeCase.coursePackVersion
        ) {
          throw new Error(
            "T45_CAPABILITY_REQUIRED_EVIDENCE_SCOPE_INVALID:"
            + `${qrel.caseId}:${nodeId}`,
          );
        }
        requiredNodeIds.add(nodeId);
      }
    }
    assertUnique(
      qrel.hardNegativeNodeIds,
      `T45_CAPABILITY_HARD_NEGATIVES_NOT_UNIQUE:${qrel.caseId}`,
    );
    for (const nodeId of qrel.hardNegativeNodeIds) {
      if (requiredNodeIds.has(nodeId)) {
        throw new Error(
          `T45_CAPABILITY_HARD_NEGATIVE_IS_REQUIRED:${qrel.caseId}:${nodeId}`,
        );
      }
      const binding = nodeById.get(nodeId);
      const inventoryObject = binding
        ? inventoryByObjectId.get(binding.object.id)
        : undefined;
      if (
        !binding
        || !inventoryObject
        || !isT45EligibleNode(binding.node)
        || !inventoryObject.eligibleNodeIds.includes(nodeId)
        || inventoryObject.partition !== partition
        || inventoryObject.familyId
          !== runtimeCase.familyId
        || binding.object.sourceCoursePack.id
          !== runtimeCase.coursePackId
        || binding.object.sourceCoursePack.version
          !== runtimeCase.coursePackVersion
      ) {
        throw new Error(
          "T45_CAPABILITY_HARD_NEGATIVE_SCOPE_INVALID:"
          + `${qrel.caseId}:${nodeId}`,
        );
      }
    }
  }
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

const RUNTIME_LABEL_FIELD_ERRORS = {
  acceptableNodeIds:
    "T45_CAPABILITY_RUNTIME_ACCEPTABLE_NODE_IDS_FORBIDDEN",
  hardNegativeNodeIds:
    "T45_CAPABILITY_RUNTIME_HARD_NEGATIVE_NODE_IDS_FORBIDDEN",
  requiredGroups:
    "T45_CAPABILITY_RUNTIME_REQUIRED_GROUPS_FORBIDDEN",
} as const;

function assertNoRuntimeLabelFields(
  runtimeInput: unknown,
) {
  if (
    !runtimeInput
    || typeof runtimeInput !== "object"
    || Array.isArray(runtimeInput)
  ) {
    return;
  }
  const cases = (
    runtimeInput as Record<string, unknown>
  ).cases;
  if (!Array.isArray(cases)) return;
  for (const testCase of cases) {
    if (
      !testCase
      || typeof testCase !== "object"
      || Array.isArray(testCase)
    ) {
      continue;
    }
    for (
      const [field, errorCode]
      of Object.entries(RUNTIME_LABEL_FIELD_ERRORS)
    ) {
      if (
        Object.prototype.hasOwnProperty.call(
          testCase,
          field,
        )
      ) {
        throw new Error(errorCode);
      }
    }
  }
}

export function loadT45CapabilityArtifacts(input: {
  inventoryInput: unknown;
  runtimeInput: unknown;
  qrelsInput: unknown;
  corpusInput: unknown;
  expectedSplit: T45CapabilitySplit;
}): Readonly<{
  inventory: T45CapabilityInventoryV1;
  runtime: T45CapabilityRuntimeSuite;
  qrels: T45CapabilityQrelsSuite;
}> {
  assertNoRuntimeLabelFields(input.runtimeInput);
  const inventory =
    T45CapabilityInventorySchema.parse(
      input.inventoryInput,
    ) as T45CapabilityInventoryV1;
  const runtime =
    T45CapabilityRuntimeSuiteSchema.parse(
      input.runtimeInput,
    ) as T45CapabilityRuntimeSuite;
  const qrels =
    T45CapabilityQrelsSuiteSchema.parse(
      input.qrelsInput,
    ) as T45CapabilityQrelsSuite;

  const inventoryHash =
    t45CapabilityInventoryHash(inventory);
  if (inventory.inventoryHash !== inventoryHash) {
    throw new Error(
      `T45_CAPABILITY_INVENTORY_HASH_MISMATCH:${inventoryHash}`,
    );
  }
  const runtimeHash =
    t45CapabilityRuntimeSuiteHash(runtime);
  if (runtime.suiteHash !== runtimeHash) {
    throw new Error(
      `T45_CAPABILITY_RUNTIME_HASH_MISMATCH:${runtimeHash}`,
    );
  }
  const qrelsHash =
    t45CapabilityQrelsSuiteHash(qrels);
  if (qrels.suiteHash !== qrelsHash) {
    throw new Error(
      `T45_CAPABILITY_QRELS_HASH_MISMATCH:${qrelsHash}`,
    );
  }

  const corpus = assertInventoryBindings(
    inventory,
    input.corpusInput,
  );
  assertSuiteBindings(
    inventory,
    runtime,
    qrels,
    corpus,
    input.expectedSplit,
  );
  return deepFreeze({ inventory, runtime, qrels });
}

export function projectT45RuntimeCases(
  runtime: T45CapabilityRuntimeSuite,
): T45RuntimeVisibleCase[] {
  return runtime.cases.map((testCase) => ({
    caseId: testCase.caseId,
    familyId: testCase.familyId,
    stratum: testCase.stratum,
    mode: testCase.mode,
    coursePackId: testCase.coursePackId,
    coursePackVersion: testCase.coursePackVersion,
    question: testCase.question,
  }));
}
