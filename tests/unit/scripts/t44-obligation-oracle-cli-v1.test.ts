// @vitest-environment node

import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildT44ObligationOracleCasesV1,
  parseT44ObligationOracleArguments,
  verifyT44ObligationOracleInputSealsV1,
  verifyT44ObligationOracleSelectionVariantV1,
  writeNewT44ObligationOracleArtifactV1,
} from "@/scripts/audit-t44-obligation-oracle-v1";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })),
  );
});

function sha256(value: string) {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

describe("T4.4 obligation oracle CLI", () => {
  it("accepts one stable lowercase run id", () => {
    expect(parseT44ObligationOracleArguments([
      "--",
      "--run-id",
      "legacy-v2",
    ])).toEqual({ runId: "legacy-v2" });
    expect(() =>
      parseT44ObligationOracleArguments([
        "--run-id",
        "Legacy_v2",
      ]),
    ).toThrow(/RUN_ID_INVALID/);
  });

  it("accepts only the frozen baseline-protected selection variant", () => {
    expect(parseT44ObligationOracleArguments([
      "--run-id",
      "legacy-v2",
      "--selection-variant",
      "baseline-protected-v2",
    ])).toEqual({
      runId: "legacy-v2",
      selectionVariant: "baseline-protected-v2",
    });
    expect(() =>
      parseT44ObligationOracleArguments([
        "--run-id",
        "legacy-v2",
        "--selection-variant",
        "tuned-after-qrels",
      ]),
    ).toThrow(/SELECTION_VARIANT_INVALID/);
  });

  it("binds selection links to actual candidate and matrix bytes", () => {
    const candidateSerialized = "{\"candidate\":true}\n";
    const matrixSerialized = "{\"matrix\":true}\n";
    const selectionSerialized = "{\"selection\":true}\n";
    const verified =
      verifyT44ObligationOracleInputSealsV1({
        candidateSerialized,
        matrixSerialized,
        selectionSerialized,
        selectionCandidateSha256:
          sha256(candidateSerialized),
        selectionMatrixSha256:
          sha256(matrixSerialized),
      });

    expect(verified).toMatchObject({
      candidateSha256: sha256(candidateSerialized),
      matrixSha256: sha256(matrixSerialized),
      selectionSha256: sha256(selectionSerialized),
    });
    expect(() =>
      verifyT44ObligationOracleInputSealsV1({
        candidateSerialized,
        matrixSerialized,
        selectionSerialized,
        selectionCandidateSha256: "f".repeat(64),
        selectionMatrixSha256:
          sha256(matrixSerialized),
      }),
    ).toThrow(/CANDIDATE_SHA_DRIFT/);
  });

  it("binds the variant name to the exact selector config identity", () => {
    expect(() =>
      verifyT44ObligationOracleSelectionVariantV1({
        selectionVariant: "baseline-protected-v2",
        selectorConfigId:
          "lumi-t44-baseline-protected-obligation-selector-v2",
        selectorConfigVersion: "2026-07-29.1",
        selectorConfigHash:
          "a7b447e22e1019ad166c9b517c1dce53ab60934c02065795e84984c6f8b24731",
      }),
    ).not.toThrow();
    expect(() =>
      verifyT44ObligationOracleSelectionVariantV1({
        selectionVariant: "baseline-protected-v2",
        selectorConfigId:
          "lumi-t44-baseline-protected-obligation-selector-v2",
        selectorConfigVersion: "2026-07-29.1",
        selectorConfigHash: "f".repeat(64),
      }),
    ).toThrow(/SELECTOR_CONFIG_DRIFT/);
  });

  it("joins candidate, selection and qrels only by exact case and course", () => {
    const input = {
      candidateCases: [{
        caseId: "case-one",
        coursePackId: "layout-design",
        aCandidateNodeIds: ["node-a"],
        bCandidateNodeIds: ["node-a", "node-b"],
      }],
      selectionCases: [{
        caseId: "case-one",
        coursePackId: "layout-design",
        aSelectedNodeIds: ["node-a"],
        bSelectedNodeIds: ["node-b"],
      }],
      qrelCases: [{
        caseId: "case-one",
        coursePackId: "layout-design",
        multiClaim: false,
        requiredEvidenceGroups: [{
          groupId: "group-one",
          acceptableNodeIds: ["node-a"],
        }],
      }],
    };
    expect(buildT44ObligationOracleCasesV1(input))
      .toEqual([{
        caseId: "case-one",
        coursePackId: "layout-design",
        multiClaim: false,
        requiredEvidenceGroups: [{
          groupId: "group-one",
          acceptableNodeIds: ["node-a"],
        }],
        aCandidateNodeIds: ["node-a"],
        bCandidateNodeIds: ["node-a", "node-b"],
        aSelectedNodeIds: ["node-a"],
        bSelectedNodeIds: ["node-b"],
      }]);

    expect(() =>
      buildT44ObligationOracleCasesV1({
        ...input,
        selectionCases: [{
          ...input.selectionCases[0]!,
          coursePackId: "book-design",
        }],
      }),
    ).toThrow(/CASE_BINDING_DRIFT/);
  });

  it("writes a new hash-verified artifact and refuses overwrite", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "lumi-t44-oracle-"),
    );
    roots.push(root);
    const target = path.join(root, "oracle.json");
    const first =
      await writeNewT44ObligationOracleArtifactV1(
        target,
        { decision: "SAFE" },
      );

    expect(first.bytes).toBeGreaterThan(0);
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      JSON.parse(await readFile(target, "utf8")),
    ).toEqual({ decision: "SAFE" });
    await expect(
      writeNewT44ObligationOracleArtifactV1(
        target,
        { decision: "OVERWRITE" },
      ),
    ).rejects.toThrow(/ARTIFACT_ALREADY_EXISTS/);
  });
});
