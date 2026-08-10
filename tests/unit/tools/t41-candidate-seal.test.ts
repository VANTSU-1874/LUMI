// @vitest-environment node

import { describe, expect, it } from "vitest";

import type {
  T41RuntimeIdentity,
} from "@/tools/mixed-retrieval/t41-answerability-evaluator";
import {
  assertT41CandidateSealMatchesV2,
  assertT41DeclaredRuntimeIdentityMatchesReportV2,
  assertT41CandidateSourceScopeCleanV2,
  createT41CandidateSealV2,
  T41_CANDIDATE_DIRTY_SCOPE_PATHS,
  T41_CANDIDATE_SOURCE_PATHS,
  type T41CandidateSourceStateV2,
  verifyT41CandidateSealV2,
} from "@/tools/mixed-retrieval/t41-candidate-seal";

function identity(
  lexicalPackCompetitionAlgorithmHash = "8".repeat(64),
): T41RuntimeIdentity {
  const activeIndexBundleHash = "a".repeat(64);
  const corpusBundleHash = "b".repeat(64);
  const channel = (
    name: "LEXICAL" | "TEXT_VECTOR" | "VISUAL_VECTOR",
    vector: boolean,
  ) => ({
    channel: name,
    identity: {
      activeIndexBundleHash,
      providerIndexBundleHash: vector ? "c".repeat(64) : null,
      indexVersionId: `${name.toLowerCase().replace("_", "-")}-v1`,
      modelId: vector ? `fixture/${name.toLowerCase()}` : null,
      modelRevision: vector ? "d".repeat(40) : null,
      configHash: "e".repeat(64),
      payloadHashes: ["f".repeat(64)],
    },
  });
  return {
    runtimeKind: "EVIDENCE_BUNDLE_V2",
    bundleSchemaVersion: 2,
    corpusBundleHash,
    activeIndexBundleHash,
    relationConfigHash: "1".repeat(64),
    normalizerConfigHash: "2".repeat(64),
    rrfConfigHash: "3".repeat(64),
    capabilityEntityManifestHash: "4".repeat(64),
    packCompetitionPolicyHash: "5".repeat(64),
    packCompetitionCalibrationHash: "6".repeat(64),
    lexicalPackCompetitionAlgorithmHash,
    textPackCompetitionAlgorithmHash: "9".repeat(64),
    acceptancePolicyHash: "7".repeat(64),
    channels: [
      channel("LEXICAL", false),
      channel("TEXT_VECTOR", true),
      channel("VISUAL_VECTOR", true),
    ],
  };
}

function sourceState(
  gitTree = "1".repeat(40),
): T41CandidateSourceStateV2 {
  return {
    gitCommit: "0".repeat(40),
    gitTree,
    files: T41_CANDIDATE_SOURCE_PATHS.map((filePath, index) => ({
      path: filePath,
      sha256: index.toString(16).padStart(64, "0"),
    })),
  };
}

describe("T4.1 candidate seal", () => {
  it("freezes the TypeScript loader configuration and npm preflight entrypoint", () => {
    expect(T41_CANDIDATE_SOURCE_PATHS).toEqual(
      expect.arrayContaining([
        "tsconfig.json",
        "scripts/check-runtime-tools.mjs",
      ]),
    );
    expect(T41_CANDIDATE_DIRTY_SCOPE_PATHS).toEqual(
      expect.arrayContaining([
        "tsconfig.json",
        "scripts/check-runtime-tools.mjs",
      ]),
    );
  });

  it("rejects dirty files anywhere in the broad candidate source scope", () => {
    expect(() => assertT41CandidateSourceScopeCleanV2(
      " M lib/knowledge/corpus-evidence-expander-v2.ts\n",
    )).toThrow(
      "T41_CANDIDATE_SOURCE_MUST_BE_TRACKED_AND_COMMITTED",
    );
    expect(() => assertT41CandidateSourceScopeCleanV2(
      "?? tools/text-retrieval/new-runtime-helper.py\n",
    )).toThrow(
      "T41_CANDIDATE_SOURCE_MUST_BE_TRACKED_AND_COMMITTED",
    );
    expect(() => assertT41CandidateSourceScopeCleanV2("  \n"))
      .not.toThrow();
  });

  it("binds a passing DEV report, runtime identity, git tree, and source files", () => {
    const runtimeIdentity = identity();
    const state = sourceState();
    const seal = createT41CandidateSealV2({
      devReportSha256: "a".repeat(64),
      runtimeIdentity,
      sourceState: state,
    });

    expect(verifyT41CandidateSealV2(seal)).toEqual(seal);
    expect(assertT41CandidateSealMatchesV2({
      seal,
      runtimeIdentity,
      sourceState: state,
    })).toEqual(seal);
  });

  it("fails closed on runtime algorithm or source-tree drift", () => {
    const runtimeIdentity = identity();
    const state = sourceState();
    const seal = createT41CandidateSealV2({
      devReportSha256: "a".repeat(64),
      runtimeIdentity,
      sourceState: state,
    });

    expect(() => assertT41CandidateSealMatchesV2({
      seal,
      runtimeIdentity: identity("0".repeat(64)),
      sourceState: state,
    })).toThrow("T41_CANDIDATE_SEAL_RUNTIME_IDENTITY_DRIFT");
    expect(() => assertT41CandidateSealMatchesV2({
      seal,
      runtimeIdentity,
      sourceState: sourceState("2".repeat(40)),
    })).toThrow("T41_CANDIDATE_SEAL_SOURCE_STATE_DRIFT");
  });

  it("requires the passing DEV report identity to equal the declaration", () => {
    const declaredRuntimeIdentity = identity();
    const runtimeIdentitySha256 =
      createT41CandidateSealV2({
        devReportSha256: "a".repeat(64),
        runtimeIdentity: declaredRuntimeIdentity,
        sourceState: sourceState(),
      }).runtimeIdentitySha256;

    expect(() => assertT41DeclaredRuntimeIdentityMatchesReportV2({
      declaredRuntimeIdentity,
      observedIdentities: [{
        runtimeIdentitySha256,
        identity: declaredRuntimeIdentity,
      }],
    })).not.toThrow();
    expect(() => assertT41DeclaredRuntimeIdentityMatchesReportV2({
      declaredRuntimeIdentity,
      observedIdentities: [{
        runtimeIdentitySha256,
        identity: identity("0".repeat(64)),
      }],
    })).toThrow(
      "T41_CANDIDATE_DECLARED_RUNTIME_IDENTITY_MISMATCH",
    );
  });

  it("rejects edited seal payloads instead of recomputing their hash", () => {
    const seal = createT41CandidateSealV2({
      devReportSha256: "a".repeat(64),
      runtimeIdentity: identity(),
      sourceState: sourceState(),
    });

    expect(() => verifyT41CandidateSealV2({
      ...seal,
      devReportSha256: "b".repeat(64),
    })).toThrow("T41_CANDIDATE_SEAL_CONFIG_HASH_MISMATCH");
  });
});
