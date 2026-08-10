// @vitest-environment node

import {
  mkdir,
  mkdtemp,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertT41AnswerabilityOutputIsolation,
  parseT41AnswerabilityArguments,
  resolveT41AnswerabilityOutputPath,
  resolveT41CandidateSealInputPath,
  t41BoundaryAuditForSplit,
} from "@/scripts/evaluate-t41-answerability-v2";

const REQUIRED = [
  "--output",
  ".runtime/mixed-retrieval/t41-dev.json",
  "--python",
  ".runtime/python/python.exe",
  "--text-model-dir",
  ".runtime/text/model",
  "--text-model-seal",
  ".runtime/text/seal.json",
  "--text-index-dir",
  ".runtime/text/index",
  "--visual-model-dir",
  ".runtime/visual/model",
  "--visual-model-seal",
  ".runtime/visual/seal.json",
  "--visual-index-dir",
  ".runtime/visual/index",
  "--visual-offload-dir",
  ".runtime/visual/offload",
  "--control-dir",
  ".runtime/control",
] as const;

describe("T4.1 answerability CLI V2", () => {
  it("defaults to the frozen DEV split and local runtime parameters", () => {
    expect(parseT41AnswerabilityArguments(REQUIRED)).toMatchObject({
      output: ".runtime/mixed-retrieval/t41-dev.json",
      split: "DEV",
      allowHeldout: false,
      suite: "tests/retrieval-quality/t41-answerability-dev.json",
      candidateSeal:
        ".runtime/mixed-retrieval/t41-dev.candidate-seal.json",
      device: "cuda",
      gpuMemoryGiB: 3.5,
      timeoutMs: 10_000,
    });
  });

  it("requires both explicit HELDOUT split and authorization flag", () => {
    expect(() => parseT41AnswerabilityArguments([
      ...REQUIRED,
      "--split",
      "HELDOUT",
    ])).toThrow(
      "T41_CLI_HELDOUT_REQUIRES_EXPLICIT_SPLIT_AND_ALLOW_HELDOUT",
    );
    expect(() => parseT41AnswerabilityArguments([
      ...REQUIRED,
      "--allow-heldout",
    ])).toThrow("T41_CLI_ALLOW_HELDOUT_REQUIRES_HELDOUT_SPLIT");

    expect(() => parseT41AnswerabilityArguments([
      ...REQUIRED,
      "--split",
      "HELDOUT",
      "--allow-heldout",
    ])).toThrow(
      "T41_CLI_HELDOUT_REQUIRES_FROZEN_CANDIDATE_SEAL",
    );
    expect(parseT41AnswerabilityArguments([
      ...REQUIRED,
      "--split",
      "HELDOUT",
      "--allow-heldout",
      "--candidate-seal",
      ".runtime/mixed-retrieval/frozen-candidate.json",
    ])).toMatchObject({
      split: "HELDOUT",
      allowHeldout: true,
      suite: "tests/retrieval-quality/t41-answerability-heldout.json",
      candidateSeal:
        ".runtime/mixed-retrieval/frozen-candidate.json",
    });
  });

  it("rejects missing, duplicate, unknown and invalid numeric arguments", () => {
    expect(() => parseT41AnswerabilityArguments(
      REQUIRED.filter((value) => value !== ".runtime/python/python.exe"),
    )).toThrow("T41_CLI_ARGUMENT_VALUE_MISSING:--python");
    expect(() => parseT41AnswerabilityArguments([
      ...REQUIRED,
      "--output",
      ".runtime/mixed-retrieval/other.json",
    ])).toThrow("T41_CLI_DUPLICATE_ARGUMENT:--output");
    expect(() => parseT41AnswerabilityArguments([
      ...REQUIRED,
      "--allow-heldout",
      "--allow-heldout",
    ])).toThrow("T41_CLI_DUPLICATE_ARGUMENT:--allow-heldout");
    expect(() => parseT41AnswerabilityArguments([
      ...REQUIRED,
      "--database",
      "service.sqlite",
    ])).toThrow("T41_CLI_UNKNOWN_ARGUMENT:--database");
    expect(() => parseT41AnswerabilityArguments([
      ...REQUIRED,
      "--timeout-ms",
      "0",
    ])).toThrow();
  });

  it("allows only JSON reports beneath .runtime/mixed-retrieval", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "t41-cli-output-"));
    await mkdir(path.join(workspace, ".runtime"), { recursive: true });

    await expect(resolveT41AnswerabilityOutputPath(
      workspace,
      ".runtime/mixed-retrieval/report.json",
    )).resolves.toBe(
      path.join(workspace, ".runtime", "mixed-retrieval", "report.json"),
    );
    await expect(resolveT41AnswerabilityOutputPath(
      workspace,
      ".runtime/retrieval-quality/report.json",
    )).rejects.toThrow(
      "T41_CLI_OUTPUT_MUST_BE_MIXED_RETRIEVAL_RUNTIME_JSON",
    );
    await expect(resolveT41AnswerabilityOutputPath(
      workspace,
      ".runtime/mixed-retrieval/report.txt",
    )).rejects.toThrow(
      "T41_CLI_OUTPUT_MUST_BE_MIXED_RETRIEVAL_RUNTIME_JSON",
    );

    await mkdir(
      path.join(workspace, ".runtime", "mixed-retrieval"),
      { recursive: true },
    );
    await writeFile(
      path.join(
        workspace,
        ".runtime",
        "mixed-retrieval",
        "existing.json",
      ),
      "{}\n",
      "utf8",
    );
    await expect(resolveT41AnswerabilityOutputPath(
      workspace,
      ".runtime/mixed-retrieval/existing.json",
    )).rejects.toThrow("T41_CLI_OUTPUT_ALREADY_EXISTS");
    await expect(resolveT41CandidateSealInputPath(
      workspace,
      ".runtime/mixed-retrieval/existing.json",
    )).resolves.toBe(
      path.join(
        workspace,
        ".runtime",
        "mixed-retrieval",
        "existing.json",
      ),
    );
  });

  it("rejects symlink escapes and output/input overlap", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "t41-cli-symlink-"));
    const external = await mkdtemp(path.join(tmpdir(), "t41-cli-external-"));
    await mkdir(path.join(workspace, ".runtime"), { recursive: true });
    await symlink(
      external,
      path.join(workspace, ".runtime", "mixed-retrieval"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(resolveT41AnswerabilityOutputPath(
      workspace,
      ".runtime/mixed-retrieval/report.json",
    )).rejects.toThrow("T41_CLI_OUTPUT_SYMLINK_FORBIDDEN");

    const output = path.join(workspace, ".runtime", "mixed-retrieval.json");
    expect(() => assertT41AnswerabilityOutputIsolation(
      output,
      [output],
      [],
    )).toThrow("T41_CLI_OUTPUT_INPUT_COLLISION");
    expect(() => assertT41AnswerabilityOutputIsolation(
      output,
      [],
      [path.join(workspace, ".runtime")],
    )).toThrow("T41_CLI_OUTPUT_INPUT_DIRECTORY_COLLISION");
  });

  it("rejects custom suite paths before any suite can be read", () => {
    expect(() => parseT41AnswerabilityArguments([
      ...REQUIRED,
      "--suite",
      "tests/retrieval-quality/t41-answerability-heldout.json",
    ])).toThrow("T41_CLI_UNKNOWN_ARGUMENT:--suite");
  });

  it("redacts query-derived boundary fragments from HELDOUT reports", () => {
    const boundary = {
      schemaVersion: 2,
      decision: "REJECT",
      reason: "UNSUPPORTED_TECHNICAL_ANCHOR",
      queryMode: "TEXT_TO_TEXT",
      sourceCoursePack: {
        id: "book-design",
        version: "1",
      },
      acceptancePolicyHash: "1".repeat(64),
      capabilityEntityManifestHash: "2".repeat(64),
      packCompetitionPolicyHash: "3".repeat(64),
      packCompetitionCalibrationHash: "4".repeat(64),
      lexicalPackCompetitionAlgorithmHash: "5".repeat(64),
      textPackCompetitionAlgorithmHash: "6".repeat(64),
      acceptedCandidateIdsBefore: ["node-secret"],
      acceptedCandidateIdsAfter: [],
      matchedEntities: [{ alias: "Secret Product" }],
      unsupportedTechnicalAnchors: ["Secret Operation"],
      diagnostics: null,
    } as never;
    expect(t41BoundaryAuditForSplit("DEV", boundary))
      .toBe(boundary);
    const heldout = t41BoundaryAuditForSplit(
      "HELDOUT",
      boundary,
    );
    expect(heldout).toMatchObject({
      decision: "REJECT",
      reason: "UNSUPPORTED_TECHNICAL_ANCHOR",
      acceptedCandidateCountBefore: 1,
      acceptedCandidateCountAfter: 0,
      matchedEntityCount: 1,
      unsupportedTechnicalAnchorCount: 1,
      diagnosticsPresent: false,
    });
    expect(JSON.stringify(heldout)).not.toContain("Secret");
    expect(JSON.stringify(heldout)).not.toContain("node-secret");
  });
});
