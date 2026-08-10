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
    "lumi-t45-post-candidate-remediation-selector-acceptance-runtime",
  ),
  version: z.literal("2026-07-30.3"),
  split: z.literal("POST_CANDIDATE_REMEDIATION_ACCEPTANCE"),
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

export async function loadPostCandidateRemediationRuntimeOnlyV1(
  workspaceRoot: string,
) {
  const root = path.resolve(workspaceRoot);
  const testFile = (name: string) => path.join(
    root,
    "tests/retrieval-quality",
    name,
  );
  const priorRuntimeNames = [
    "t45-capability-calibration.runtime.json",
    "t45-capability-validation.runtime.json",
    "t45-post-remediation-selector-acceptance.runtime.json",
    "t45-post-completion-selector-acceptance.runtime.json",
  ] as const;
  const [
    runtimeRaw,
    inventoryRaw,
    corpusRaw,
    ...priorRaw
  ] = await Promise.all([
    readFile(testFile(
      "t45-post-candidate-remediation-selector-acceptance.runtime.json",
    ), "utf8"),
    readFile(testFile("t45-capability-inventory.json"), "utf8"),
    readFile(path.join(
      root,
      "data/knowledge-v2/knowledge-corpus.v2.json",
    ), "utf8"),
    ...priorRuntimeNames.map((name) =>
      readFile(testFile(name), "utf8")),
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
      "POST_CANDIDATE_REMEDIATION_RUNTIME_SOURCE_BINDING_DRIFT",
    );
  }

  const priorCases = priorRaw.flatMap((raw) =>
    (JSON.parse(raw) as {
      cases: Array<{
        caseId: string;
        familyId: string;
        question: string;
      }>;
    }).cases);
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
      "POST_CANDIDATE_REMEDIATION_RUNTIME_ISOLATION_DRIFT",
    );
  }

  const familyById = new Map(
    inventory.families.map((family) => [family.familyId, family]),
  );
  const objectById = new Map(
    inventory.objects.map((object) => [object.objectId, object]),
  );
  const previousFamilies = new Set(
    priorCases.map(({ familyId }) => familyId),
  );
  const currentFamilies = new Set(
    runtime.cases.map(({ familyId }) => familyId),
  );
  const courseCounts = new Map<string, number>();
  let newObjectFamilies = 0;
  let reusedBrandFamilies = 0;
  for (const testCase of runtime.cases) {
    courseCounts.set(
      testCase.coursePackId,
      (courseCounts.get(testCase.coursePackId) ?? 0) + 1,
    );
  }
  for (const familyId of currentFamilies) {
    const testCases = runtime.cases.filter(
      (testCase) => testCase.familyId === familyId,
    );
    const family = familyById.get(familyId);
    if (
      testCases.length !== 2
      || !family
      || family.objectIds.some((objectId) => {
        const object = objectById.get(objectId);
        return !object
          || object.partition !== "FROZEN_T44"
          || object.coursePackId !== testCases[0]?.coursePackId;
      })
    ) {
      throw new Error(
        `POST_CANDIDATE_REMEDIATION_RUNTIME_PARTITION_DRIFT:${familyId}`,
      );
    }
    const repeated = previousFamilies.has(familyId);
    if (
      repeated
      && testCases[0]?.coursePackId === "brand-vi-design"
    ) {
      reusedBrandFamilies += 1;
    } else if (!repeated) {
      newObjectFamilies += 1;
    } else {
      throw new Error(
        `POST_CANDIDATE_REMEDIATION_RUNTIME_UNDECLARED_REUSE:${familyId}`,
      );
    }
  }
  if (
    currentFamilies.size !== 10
    || courseCounts.size !== 5
    || [...courseCounts.values()].some((count) => count !== 4)
    || runtime.cases.filter(
      ({ stratum }) => stratum === "DIRECT_PARAPHRASE",
    ).length !== 10
    || newObjectFamilies !== 8
    || reusedBrandFamilies !== 2
  ) {
    throw new Error(
      "POST_CANDIDATE_REMEDIATION_RUNTIME_DISTRIBUTION_DRIFT",
    );
  }

  return {
    runtime,
    inventory,
    corpus,
    audit: {
      cases: 20 as const,
      scoreFileReads: 0 as const,
      scoreSchemaImports: 0 as const,
      newObjectFamilies: 8 as const,
      reusedBrandFamilies: 2 as const,
    },
  };
}

export function projectPostCandidateRemediationRuntimeOnlyPortV1(
  loaded: Awaited<
    ReturnType<typeof loadPostCandidateRemediationRuntimeOnlyV1>
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
