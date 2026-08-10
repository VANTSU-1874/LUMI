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
const RuntimeSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.literal(
    "lumi-t45-post-remediation-selector-acceptance-runtime",
  ),
  version: z.literal("2026-07-30.1"),
  split: z.literal("POST_REMEDIATION_ACCEPTANCE"),
  corpusSnapshot: z.object({
    path: z.literal("data/knowledge-v2/knowledge-corpus.v2.json"),
    bundleHash: HashSchema,
  }).strict(),
  capabilityInventory: z.object({
    id: z.literal("lumi-t45-capability-inventory"),
    inventoryHash: HashSchema,
  }).strict(),
  cases: z.array(z.object({
    caseId: IdSchema,
    familyId: IdSchema,
    stratum: z.enum([
      "DIRECT_PARAPHRASE",
      "COMPOSITION_HARD_DISTRACTOR",
    ]),
    mode: z.literal("TEXT_TO_TEXT"),
    coursePackId: z.enum([
      "book-design",
      "brand-vi-design",
      "digital-interaction",
      "general-design",
      "layout-design",
    ]),
    coursePackVersion: z.literal("1"),
    question: z.string().trim().min(8).max(300),
  }).strict()).length(20),
  suiteHash: HashSchema,
}).strict();

function runtimeHash(value: Record<string, unknown>) {
  const projection = { ...value };
  delete projection.suiteHash;
  return sha256StableJsonV2(projection);
}

export async function loadPostRemediationRuntimeOnlyV1(
  workspaceRoot: string,
) {
  const root = path.resolve(workspaceRoot);
  const [
    runtimeRaw,
    inventoryRaw,
    corpusRaw,
    calibrationRaw,
    validationRaw,
  ] = await Promise.all([
    readFile(path.join(
      root,
      "tests/retrieval-quality/"
        + "t45-post-remediation-selector-acceptance.runtime.json",
    ), "utf8"),
    readFile(path.join(
      root,
      "tests/retrieval-quality/t45-capability-inventory.json",
    ), "utf8"),
    readFile(path.join(
      root,
      "data/knowledge-v2/knowledge-corpus.v2.json",
    ), "utf8"),
    readFile(path.join(
      root,
      "tests/retrieval-quality/"
        + "t45-capability-calibration.runtime.json",
    ), "utf8"),
    readFile(path.join(
      root,
      "tests/retrieval-quality/"
        + "t45-capability-validation.runtime.json",
    ), "utf8"),
  ]);
  const runtimeInput = JSON.parse(runtimeRaw) as Record<string, unknown>;
  const runtime = RuntimeSchema.parse(runtimeInput);
  const inventory = T45CapabilityInventorySchema.parse(
    JSON.parse(inventoryRaw) as unknown,
  );
  const corpus = verifyKnowledgeCorpusBundleV2(
    JSON.parse(corpusRaw) as unknown,
  );
  if (
    runtimeHash(runtimeInput) !== runtime.suiteHash
    || runtime.corpusSnapshot.bundleHash !== corpus.bundleHash
    || runtime.capabilityInventory.inventoryHash
      !== inventory.inventoryHash
  ) {
    throw new Error(
      "POST_REMEDIATION_RUNTIME_ONLY_SOURCE_BINDING_DRIFT",
    );
  }
  const priorCases = [
    ...(JSON.parse(calibrationRaw) as {
      cases: Array<{ caseId: string; question: string }>;
    }).cases,
    ...(JSON.parse(validationRaw) as {
      cases: Array<{ caseId: string; question: string }>;
    }).cases,
  ];
  const priorIds = new Set(priorCases.map(({ caseId }) => caseId));
  const priorQuestions = new Set(
    priorCases.map(({ question }) => question),
  );
  if (
    new Set(runtime.cases.map(({ caseId }) => caseId)).size !== 20
    || new Set(runtime.cases.map(({ question }) => question)).size !== 20
    || runtime.cases.some(({ caseId, question }) =>
      priorIds.has(caseId) || priorQuestions.has(question)
    )
  ) {
    throw new Error(
      "POST_REMEDIATION_RUNTIME_ONLY_CASE_ISOLATION_DRIFT",
    );
  }
  const familyById = new Map(
    inventory.families.map((family) => [family.familyId, family]),
  );
  const objectById = new Map(
    inventory.objects.map((object) => [object.objectId, object]),
  );
  for (const testCase of runtime.cases) {
    const family = familyById.get(testCase.familyId);
    if (
      !family
      || family.objectIds.some((objectId) => {
        const object = objectById.get(objectId);
        return !object
          || object.partition !== "FROZEN_T44"
          || object.coursePackId !== testCase.coursePackId;
      })
    ) {
      throw new Error(
        `POST_REMEDIATION_RUNTIME_ONLY_PARTITION_DRIFT:${testCase.caseId}`,
      );
    }
  }
  return {
    runtime,
    inventory,
    corpus,
    audit: {
      cases: 20 as const,
      scoreFileReads: 0 as const,
      scoreSchemaImports: 0 as const,
    },
  };
}

export function projectPostRemediationRuntimeOnlyPortV1(
  loaded: Awaited<
    ReturnType<typeof loadPostRemediationRuntimeOnlyV1>
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
