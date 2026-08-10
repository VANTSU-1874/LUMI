import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  T41RuntimeIdentitySchema,
  type T41RuntimeIdentity,
} from "./t41-answerability-evaluator";
import {
  T41_ANSWERABILITY_SUITE_SHA256,
} from "./t41-answerability-loader";

const HASH = /^[0-9a-f]{64}$/;
const GIT_OBJECT_ID = /^[0-9a-f]{40,64}$/;
const HashSchema = z.string().regex(HASH);

export const T41_CANDIDATE_SOURCE_PATHS = Object.freeze([
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "lib/knowledge/capability-anchor-coverage-v2.ts",
  "lib/knowledge/capability-boundary-v2.ts",
  "lib/knowledge/capability-entity-registry-v2.ts",
  "lib/knowledge/evidence-bundle-v2.ts",
  "lib/knowledge/hybrid-retriever-v2.ts",
  "lib/knowledge/lexical-retriever-v2.ts",
  "lib/knowledge/mixed-retrieval-runtime-v2.ts",
  "lib/knowledge/pack-competition-v2.ts",
  "lib/knowledge/rank-fusion-v2.ts",
  "lib/knowledge/retrieval-channel-adapters-v2.ts",
  "lib/knowledge/retrieval-query-v2.ts",
  "lib/knowledge/retrieve.ts",
  "lib/knowledge/text-retriever-client.ts",
  "lib/knowledge/text-retriever.ts",
  "scripts/check-runtime-tools.mjs",
  "scripts/evaluate-t41-answerability-v2.ts",
  "tools/mixed-retrieval/t41-answerability-evaluator.ts",
  "tools/mixed-retrieval/t41-answerability-loader.ts",
  "tools/mixed-retrieval/t41-candidate-seal.ts",
  "tools/text-retrieval/text_retrieval.py",
] as const);

export const T41_CANDIDATE_DIRTY_SCOPE_PATHS = Object.freeze([
  "lib/knowledge",
  "scripts/evaluate-t41-answerability-v2.ts",
  "tools/mixed-retrieval",
  "tools/text-retrieval",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "scripts/check-runtime-tools.mjs",
] as const);

export function assertT41CandidateSourceScopeCleanV2(
  porcelainStatus: string,
) {
  if (porcelainStatus.trim()) {
    throw new Error(
      "T41_CANDIDATE_SOURCE_MUST_BE_TRACKED_AND_COMMITTED",
    );
  }
}

const T41CandidateSourceFileV2Schema = z
  .object({
    path: z.enum(T41_CANDIDATE_SOURCE_PATHS),
    sha256: HashSchema,
  })
  .strict();

export const T41CandidateSourceStateV2Schema = z
  .object({
    gitCommit: z.string().regex(GIT_OBJECT_ID),
    gitTree: z.string().regex(GIT_OBJECT_ID),
    files: z.array(T41CandidateSourceFileV2Schema)
      .length(T41_CANDIDATE_SOURCE_PATHS.length),
  })
  .strict()
  .superRefine((state, context) => {
    const actualPaths = state.files.map((file) => file.path);
    if (
      actualPaths.some(
        (filePath, index) =>
          filePath !== T41_CANDIDATE_SOURCE_PATHS[index],
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "candidate source files must match the frozen ordered path set",
        path: ["files"],
      });
    }
  });

const T41CandidateSealPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(1),
    sealKind: z.literal("T41_DEV_CANDIDATE"),
    devSuiteSha256: z.literal(
      T41_ANSWERABILITY_SUITE_SHA256.DEV,
    ),
    devReportSha256: HashSchema,
    devReportPassed: z.literal(true),
    runtimeIdentitySha256: HashSchema,
    runtimeIdentity: T41RuntimeIdentitySchema,
    sourceState: T41CandidateSourceStateV2Schema,
  })
  .strict();

export const T41CandidateSealV2Schema =
  T41CandidateSealPayloadV2Schema
    .extend({
      configHash: HashSchema,
    })
    .strict();

export type T41CandidateSourceStateV2 = z.infer<
  typeof T41CandidateSourceStateV2Schema
>;
export type T41CandidateSealV2 = z.infer<
  typeof T41CandidateSealV2Schema
>;

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${stableJson(item)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function t41RuntimeIdentitySha256(
  identityInput: T41RuntimeIdentity,
) {
  return sha256(stableJson(
    T41RuntimeIdentitySchema.parse(identityInput),
  ));
}

export function assertT41DeclaredRuntimeIdentityMatchesReportV2(
  input: {
    declaredRuntimeIdentity: T41RuntimeIdentity;
    observedIdentities: readonly {
      runtimeIdentitySha256: string;
      identity: T41RuntimeIdentity;
    }[];
  },
) {
  const declared = T41RuntimeIdentitySchema.parse(
    input.declaredRuntimeIdentity,
  );
  const observed = input.observedIdentities[0];
  if (
    input.observedIdentities.length !== 1
    || !observed
    || observed.runtimeIdentitySha256
      !== t41RuntimeIdentitySha256(declared)
    || stableJson(T41RuntimeIdentitySchema.parse(observed.identity))
      !== stableJson(declared)
  ) {
    throw new Error(
      "T41_CANDIDATE_DECLARED_RUNTIME_IDENTITY_MISMATCH",
    );
  }
}

export async function captureT41CandidateSourceStateV2(input: {
  workspaceRoot: string;
  gitCommit: string;
  gitTree: string;
}): Promise<T41CandidateSourceStateV2> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const files = await Promise.all(
    T41_CANDIDATE_SOURCE_PATHS.map(async (relativePath) => ({
      path: relativePath,
      sha256: sha256(await readFile(path.join(
        workspaceRoot,
        ...relativePath.split("/"),
      ))),
    })),
  );
  return T41CandidateSourceStateV2Schema.parse({
    gitCommit: input.gitCommit,
    gitTree: input.gitTree,
    files,
  });
}

export function createT41CandidateSealV2(input: {
  devReportSha256: string;
  runtimeIdentity: T41RuntimeIdentity;
  sourceState: T41CandidateSourceStateV2;
}): T41CandidateSealV2 {
  const runtimeIdentity = T41RuntimeIdentitySchema.parse(
    input.runtimeIdentity,
  );
  const payload = T41CandidateSealPayloadV2Schema.parse({
    schemaVersion: 1,
    sealKind: "T41_DEV_CANDIDATE",
    devSuiteSha256: T41_ANSWERABILITY_SUITE_SHA256.DEV,
    devReportSha256: input.devReportSha256,
    devReportPassed: true,
    runtimeIdentitySha256:
      t41RuntimeIdentitySha256(runtimeIdentity),
    runtimeIdentity,
    sourceState: input.sourceState,
  });
  return T41CandidateSealV2Schema.parse({
    ...payload,
    configHash: sha256(stableJson(payload)),
  });
}

export function verifyT41CandidateSealV2(
  sealInput: unknown,
) {
  const seal = T41CandidateSealV2Schema.parse(sealInput);
  const { configHash, ...payload } = seal;
  if (sha256(stableJson(payload)) !== configHash) {
    throw new Error("T41_CANDIDATE_SEAL_CONFIG_HASH_MISMATCH");
  }
  if (
    t41RuntimeIdentitySha256(seal.runtimeIdentity)
    !== seal.runtimeIdentitySha256
  ) {
    throw new Error("T41_CANDIDATE_SEAL_RUNTIME_IDENTITY_HASH_MISMATCH");
  }
  return seal;
}

export function assertT41CandidateSealMatchesV2(input: {
  seal: T41CandidateSealV2;
  runtimeIdentity: T41RuntimeIdentity;
  sourceState: T41CandidateSourceStateV2;
}) {
  const seal = verifyT41CandidateSealV2(input.seal);
  const runtimeIdentity = T41RuntimeIdentitySchema.parse(
    input.runtimeIdentity,
  );
  const sourceState = T41CandidateSourceStateV2Schema.parse(
    input.sourceState,
  );
  if (
    stableJson(runtimeIdentity) !== stableJson(seal.runtimeIdentity)
    || t41RuntimeIdentitySha256(runtimeIdentity)
      !== seal.runtimeIdentitySha256
  ) {
    throw new Error("T41_CANDIDATE_SEAL_RUNTIME_IDENTITY_DRIFT");
  }
  if (stableJson(sourceState) !== stableJson(seal.sourceState)) {
    throw new Error("T41_CANDIDATE_SEAL_SOURCE_STATE_DRIFT");
  }
  return seal;
}
