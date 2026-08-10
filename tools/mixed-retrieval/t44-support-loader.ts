import { z } from "zod";

import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "../../lib/knowledge/knowledge-object-v2";
import {
  T44_SUPPORT_CORPUS_BUNDLE_SHA256,
  T44_SUPPORT_COURSE_PACK_IDS,
  T44_SUPPORT_DEV_VERSION,
  T44_SUPPORT_QRELS_ID,
  T44_SUPPORT_RUNTIME_ID,
  T44_SUPPORT_STRATA,
} from "./t44-support-authoring";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NODE_ID_PATTERN = /^node-[0-9a-f]{64}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const IdSchema = z.string().regex(ID_PATTERN);
const NodeIdSchema = z.string().regex(NODE_ID_PATTERN);
const HashSchema = z.string().regex(HASH_PATTERN);

export const T44_SUPPORT_RUNTIME_SUITE_SHA256 =
  "a67bf1cbe71fd211355e4bd8b0e6a60326f2d697ca8a1ddafee28c29a6d27cfe";
export const T44_SUPPORT_QRELS_SUITE_SHA256 =
  "9c92e375becdae7760cd3e5d3a9dc66e45d05963302da9204e91dd260ebfe81a";

const CoursePackIdSchema = z.enum(
  T44_SUPPORT_COURSE_PACK_IDS,
);
const StratumSchema = z.enum(T44_SUPPORT_STRATA);

const CorpusSnapshotSchema = z
  .object({
    path: z.literal(
      "data/knowledge-v2/knowledge-corpus.v2.json",
    ),
    bundleHash: z.literal(
      T44_SUPPORT_CORPUS_BUNDLE_SHA256,
    ),
  })
  .strict();

const RuntimeCaseSchema = z
  .object({
    caseId: IdSchema,
    mode: z.literal("TEXT_TO_TEXT"),
    coursePackId: CoursePackIdSchema,
    coursePackVersion: z.literal("1"),
    question: z.string().trim().min(1).max(500),
  })
  .strict();

const RuntimeSuiteInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.literal(T44_SUPPORT_RUNTIME_ID),
    version: z.literal(T44_SUPPORT_DEV_VERSION),
    split: z.literal("DEV"),
    corpusSnapshot: CorpusSnapshotSchema,
    cases: z.array(RuntimeCaseSchema).length(50),
  })
  .strict();

export const T44SupportRuntimeSuiteSchema =
  RuntimeSuiteInputSchema.extend({
    suiteHash: HashSchema,
  }).strict();

const EvidenceGroupSchema = z
  .object({
    groupId: IdSchema,
    acceptableNodeIds: z
      .array(NodeIdSchema)
      .min(1)
      .max(3),
  })
  .strict();

const QrelsCaseSchema = z
  .object({
    caseId: IdSchema,
    stratum: StratumSchema,
    multiClaim: z.boolean(),
    requiredEvidenceGroups: z
      .array(EvidenceGroupSchema)
      .min(1)
      .max(4),
    hardNegativeNodeIds: z
      .array(NodeIdSchema)
      .min(1)
      .max(4),
  })
  .strict();

const QrelsSuiteInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.literal(T44_SUPPORT_QRELS_ID),
    version: z.literal(T44_SUPPORT_DEV_VERSION),
    split: z.literal("DEV"),
    runtimeSuite: z
      .object({
        id: z.literal(T44_SUPPORT_RUNTIME_ID),
        version: z.literal(T44_SUPPORT_DEV_VERSION),
        suiteHash: HashSchema,
      })
      .strict(),
    corpusSnapshot: CorpusSnapshotSchema,
    cases: z.array(QrelsCaseSchema).length(50),
  })
  .strict();

export const T44SupportQrelsSuiteSchema =
  QrelsSuiteInputSchema.extend({
    suiteHash: HashSchema,
  }).strict();

export type T44SupportRuntimeSuite = z.infer<
  typeof T44SupportRuntimeSuiteSchema
>;
export type T44SupportQrelsSuite = z.infer<
  typeof T44SupportQrelsSuiteSchema
>;

export function t44SupportRuntimeSuiteHash(
  suite: T44SupportRuntimeSuite,
) {
  const {
    suiteHash: _suiteHash,
    ...unhashed
  } = T44SupportRuntimeSuiteSchema.parse(suite);
  return sha256StableJsonV2(unhashed);
}

export function t44SupportQrelsSuiteHash(
  suite: T44SupportQrelsSuite,
) {
  const {
    suiteHash: _suiteHash,
    ...unhashed
  } = T44SupportQrelsSuiteSchema.parse(suite);
  return sha256StableJsonV2(unhashed);
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

function assertUnique(
  values: readonly string[],
  code: string,
) {
  if (new Set(values).size !== values.length) {
    throw new Error(code);
  }
}

export function assertT44SupportDevBindings(
  runtime: T44SupportRuntimeSuite,
  qrels: T44SupportQrelsSuite,
  corpusInput: unknown,
) {
  const corpus: KnowledgeCorpusBundleV2 =
    verifyKnowledgeCorpusBundleV2(corpusInput);
  if (
    corpus.bundleHash !== runtime.corpusSnapshot.bundleHash
    || corpus.bundleHash !== qrels.corpusSnapshot.bundleHash
    || corpus.bundleHash
      !== T44_SUPPORT_CORPUS_BUNDLE_SHA256
  ) {
    throw new Error("T44_SUPPORT_CORPUS_IDENTITY_MISMATCH");
  }
  if (
    qrels.runtimeSuite.id !== runtime.id
    || qrels.runtimeSuite.version !== runtime.version
    || qrels.runtimeSuite.suiteHash !== runtime.suiteHash
  ) {
    throw new Error("T44_SUPPORT_RUNTIME_QRELS_BINDING_MISMATCH");
  }

  const runtimeCaseIds = runtime.cases.map(
    ({ caseId }) => caseId,
  );
  const qrelCaseIds = qrels.cases.map(
    ({ caseId }) => caseId,
  );
  assertUnique(
    runtimeCaseIds,
    "T44_SUPPORT_RUNTIME_CASE_IDS_NOT_UNIQUE",
  );
  assertUnique(
    qrelCaseIds,
    "T44_SUPPORT_QREL_CASE_IDS_NOT_UNIQUE",
  );
  assertUnique(
    runtime.cases.map(({ question }) =>
      question.normalize("NFKC").toLocaleLowerCase("zh-CN")),
    "T44_SUPPORT_RUNTIME_QUESTIONS_NOT_UNIQUE",
  );
  if (
    runtimeCaseIds.some(
      (caseId, index) => caseId !== qrelCaseIds[index],
    )
  ) {
    throw new Error("T44_SUPPORT_CASE_ORDER_MISMATCH");
  }

  const qrelByCaseId = new Map(
    qrels.cases.map((testCase) => [
      testCase.caseId,
      testCase,
    ]),
  );
  for (const coursePackId of
    T44_SUPPORT_COURSE_PACK_IDS) {
    const packRuntimeCases = runtime.cases.filter(
      (testCase) =>
        testCase.coursePackId === coursePackId,
    );
    if (packRuntimeCases.length !== 10) {
      throw new Error(
        `T44_SUPPORT_PACK_COUNT_INVALID:${coursePackId}`,
      );
    }
    const packStrata = packRuntimeCases.map(
      ({ caseId }) =>
        qrelByCaseId.get(caseId)?.stratum,
    );
    for (const stratum of T44_SUPPORT_STRATA) {
      if (
        packStrata.filter(
          (candidate) => candidate === stratum,
        ).length !== 2
      ) {
        throw new Error(
          "T44_SUPPORT_PACK_STRATUM_COUNT_INVALID:"
          + `${coursePackId}:${stratum}`,
        );
      }
    }
  }
  if (
    qrels.cases.filter(({ multiClaim }) => multiClaim)
      .length !== 10
  ) {
    throw new Error("T44_SUPPORT_MULTI_CLAIM_COUNT_INVALID");
  }

  const nodeById = new Map(
    corpus.objects.flatMap((object) =>
      object.nodes.map((node) => [
        node.id,
        { object, node },
      ] as const)),
  );
  for (const runtimeCase of runtime.cases) {
    const qrel = qrelByCaseId.get(runtimeCase.caseId);
    if (!qrel) {
      throw new Error(
        `T44_SUPPORT_QREL_MISSING:${runtimeCase.caseId}`,
      );
    }
    assertUnique(
      qrel.requiredEvidenceGroups.map(
        ({ groupId }) => groupId,
      ),
      `T44_SUPPORT_GROUP_IDS_NOT_UNIQUE:${qrel.caseId}`,
    );
    const requiredNodeIds = new Set<string>();
    for (const evidenceGroup of
      qrel.requiredEvidenceGroups) {
      assertUnique(
        evidenceGroup.acceptableNodeIds,
        "T44_SUPPORT_GROUP_NODE_IDS_NOT_UNIQUE:"
        + `${qrel.caseId}:${evidenceGroup.groupId}`,
      );
      const owners = new Set<string>();
      for (const nodeId of
        evidenceGroup.acceptableNodeIds) {
        const binding = nodeById.get(nodeId);
        if (!binding) {
          throw new Error(
            `T44_SUPPORT_QREL_NODE_MISSING:${qrel.caseId}:${nodeId}`,
          );
        }
        if (
          binding.object.sourceCoursePack.id
            !== runtimeCase.coursePackId
          || binding.object.sourceCoursePack.version
            !== runtimeCase.coursePackVersion
          || (
            binding.node.kind !== "TABLE"
            && (
              binding.node.kind !== "TEXT"
              || !["FACT", "ACTION"].includes(
                binding.node.role,
              )
            )
          )
        ) {
          throw new Error(
            "T44_SUPPORT_QREL_NODE_SCOPE_OR_ROLE_INVALID:"
            + `${qrel.caseId}:${nodeId}`,
          );
        }
        owners.add(binding.object.id);
        requiredNodeIds.add(nodeId);
      }
      if (owners.size !== 1) {
        throw new Error(
          "T44_SUPPORT_GROUP_OWNER_AMBIGUOUS:"
          + `${qrel.caseId}:${evidenceGroup.groupId}`,
        );
      }
    }
    assertUnique(
      qrel.hardNegativeNodeIds,
      `T44_SUPPORT_HARD_NEGATIVES_NOT_UNIQUE:${qrel.caseId}`,
    );
    for (const nodeId of qrel.hardNegativeNodeIds) {
      if (requiredNodeIds.has(nodeId)) {
        throw new Error(
          `T44_SUPPORT_HARD_NEGATIVE_IS_REQUIRED:${qrel.caseId}:${nodeId}`,
        );
      }
      const binding = nodeById.get(nodeId);
      if (
        !binding
        || binding.object.sourceCoursePack.id
          !== runtimeCase.coursePackId
        || binding.object.sourceCoursePack.version
          !== runtimeCase.coursePackVersion
        || (
          binding.node.kind !== "TABLE"
          && (
            binding.node.kind !== "TEXT"
            || !["FACT", "ACTION"].includes(
              binding.node.role,
            )
          )
        )
      ) {
        throw new Error(
          "T44_SUPPORT_HARD_NEGATIVE_SCOPE_OR_ROLE_INVALID:"
          + `${qrel.caseId}:${nodeId}`,
        );
      }
    }
  }
}

export function loadT44SupportDevArtifacts(
  runtimeInput: unknown,
  qrelsInput: unknown,
  corpusInput: unknown,
) {
  const runtime =
    T44SupportRuntimeSuiteSchema.parse(runtimeInput);
  const qrels =
    T44SupportQrelsSuiteSchema.parse(qrelsInput);
  const runtimeHash =
    t44SupportRuntimeSuiteHash(runtime);
  const qrelsHash =
    t44SupportQrelsSuiteHash(qrels);
  if (
    runtime.suiteHash !== runtimeHash
    || runtime.suiteHash
      !== T44_SUPPORT_RUNTIME_SUITE_SHA256
  ) {
    throw new Error(
      `T44_SUPPORT_RUNTIME_HASH_MISMATCH:${runtimeHash}`,
    );
  }
  if (
    qrels.suiteHash !== qrelsHash
    || qrels.suiteHash
      !== T44_SUPPORT_QRELS_SUITE_SHA256
  ) {
    throw new Error(
      `T44_SUPPORT_QRELS_HASH_MISMATCH:${qrelsHash}`,
    );
  }
  assertT44SupportDevBindings(
    runtime,
    qrels,
    corpusInput,
  );
  return deepFreeze({ runtime, qrels });
}

export function projectT44SupportRuntimeCases(
  runtime: T44SupportRuntimeSuite,
) {
  return runtime.cases.map((testCase) => ({
    caseId: testCase.caseId,
    mode: testCase.mode,
    coursePackId: testCase.coursePackId,
    coursePackVersion: testCase.coursePackVersion,
    question: testCase.question,
  }));
}
