// @vitest-environment node

import { readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  auditT42ProviderInvocationsV2,
  parseT42RecallArguments,
  resolveT42OutputPath,
} from "@/scripts/evaluate-t42-recall-v2";

const REQUIRED = [
  "--output",
  ".runtime/mixed-retrieval/t42-dev-fixture.json",
  "--python",
  ".runtime/python.exe",
  "--text-model-dir",
  ".runtime/text-model",
  "--text-model-seal",
  ".runtime/text-model-seal.json",
  "--text-index-dir",
  ".runtime/text-index",
  "--visual-model-dir",
  ".runtime/visual-model",
  "--visual-model-seal",
  ".runtime/visual-model-seal.json",
  "--visual-index-dir",
  ".runtime/visual-index",
  "--visual-offload-dir",
  ".runtime/visual-offload",
  "--control-dir",
  ".runtime/control",
] as const;

describe("T4.2 recall CLI", () => {
  it("accepts only the frozen visible DEV split and explicit local inputs", () => {
    expect(parseT42RecallArguments([
      "--",
      ...REQUIRED,
      "--split",
      "DEV",
      "--device",
      "cpu",
    ])).toMatchObject({
      split: "DEV",
      device: "cpu",
      timeoutMs: 10_000,
      gpuMemoryGiB: 3.5,
    });
    expect(() => parseT42RecallArguments([
      ...REQUIRED,
      "--split",
      "HELDOUT",
    ])).toThrow(/ONLY_VISIBLE_DEV/i);
  });

  it("fails closed on missing, duplicate and unknown arguments", () => {
    expect(() => parseT42RecallArguments(
      REQUIRED.slice(2),
    )).toThrow(/REQUIRED_ARGUMENT_MISSING/i);
    expect(() => parseT42RecallArguments([
      ...REQUIRED,
      "--output",
      ".runtime/mixed-retrieval/duplicate.json",
    ])).toThrow(/DUPLICATE_ARGUMENT/i);
    expect(() => parseT42RecallArguments([
      ...REQUIRED,
      "--suite",
      "forbidden.json",
    ])).toThrow(/UNKNOWN_ARGUMENT/i);
  });

  it("allows reports only under the dedicated runtime directory", async () => {
    await expect(resolveT42OutputPath(
      process.cwd(),
      "docs/t42-report.json",
    )).rejects.toThrow(/MIXED_RETRIEVAL_JSON/i);
  });

  it("rejects nested symlink or junction output-parent escapes", async () => {
    const external = await mkdtemp(path.join(tmpdir(), "t42-cli-external-"));
    const workspace = await mkdtemp(path.join(tmpdir(), "t42-cli-workspace-"));
    try {
      const nestedRoot = path.join(
        workspace,
        ".runtime",
        "mixed-retrieval",
        "nested",
      );
      await mkdir(path.dirname(nestedRoot), { recursive: true });
      await symlink(
        external,
        nestedRoot,
        process.platform === "win32" ? "junction" : "dir",
      );

      await expect(resolveT42OutputPath(
        workspace,
        ".runtime/mixed-retrieval/nested/report.json",
      )).rejects.toThrow(/OUTPUT_PARENT_(INVALID|IDENTITY_DRIFT)/i);
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });

  it("registers the guarded pnpm command", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts["premixed:t42"]).toContain("check-runtime-tools");
    expect(pkg.scripts["mixed:t42"]).toBe(
      "tsx scripts/evaluate-t42-recall-v2.ts",
    );
  });

  it("treats external-verification fail-closed queries as zero provider calls", () => {
    const audit = auditT42ProviderInvocationsV2({
      entryCount: 2,
      entries: [
        {
          channel: "LEXICAL",
          queryFingerprint: "a".repeat(64),
        },
        {
          channel: "TEXT_VECTOR",
          queryFingerprint: "a".repeat(64),
        },
      ],
    } as never, [
      {
        runtimeQuerySha256: "a".repeat(64),
        expectedChannels: ["LEXICAL", "TEXT_VECTOR"],
      },
      {
        runtimeQuerySha256: "b".repeat(64),
        expectedChannels: [],
      },
    ]);

    expect(audit).toMatchObject({
      passed: true,
      expectedCalls: 2,
      observedCalls: 2,
      uniqueQueries: 1,
      expectedQueriedCount: 1,
      preRetrievalSkippedQueries: 1,
      visualCalls: 0,
      violations: [],
    });
  });

  it("fails the invocation audit on missing or unexpected channel calls", () => {
    const audit = auditT42ProviderInvocationsV2({
      entryCount: 2,
      entries: [
        {
          channel: "LEXICAL",
          queryFingerprint: "a".repeat(64),
        },
        {
          channel: "LEXICAL",
          queryFingerprint: "b".repeat(64),
        },
      ],
    } as never, [
      {
        runtimeQuerySha256: "a".repeat(64),
        expectedChannels: ["LEXICAL", "TEXT_VECTOR"],
      },
    ]);

    expect(audit.passed).toBe(false);
    expect(audit.violations).toEqual([
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: expected [LEXICAL,TEXT_VECTOR], received [LEXICAL]",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: unexpected provider query",
    ]);
  });
});
