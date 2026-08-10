// @vitest-environment node

import { readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  auditT43TextOnlyRegressionInvocationsV2,
  auditT43RuntimeImportGraphV2,
  auditT43ProviderInvocationsV2,
  compareT43RegressionOutcomesV2,
  parseT43EvidenceAdequacyArguments,
  resolveT43OutputPath,
} from "@/scripts/evaluate-t43-evidence-adequacy-v2";

describe("T4.3 evidence adequacy CLI", () => {
  it("uses frozen local runtime paths for the visible DEV command", () => {
    expect(parseT43EvidenceAdequacyArguments([
      "--",
      "--split",
      "DEV",
      "--output",
      ".runtime/mixed-retrieval/t43-dev-fixture.json",
    ])).toMatchObject({
      run: {
        kind: "DEV",
        split: "DEV",
      },
      device: "cuda",
      gpuMemoryGiB: 3.5,
      timeoutMs: 10_000,
      pythonExecutable:
        ".runtime/visual-retrieval/python312/python.exe",
    });
  });

  it("parses only frozen regression names and rejects mixed modes", () => {
    expect(parseT43EvidenceAdequacyArguments([
      "--regression",
      "T41_DEV",
      "--output",
      ".runtime/mixed-retrieval/t43-t41.json",
    ])).toMatchObject({
      run: {
        kind: "REGRESSION",
        regression: "T41_DEV",
      },
    });
    expect(() => parseT43EvidenceAdequacyArguments([
      "--split",
      "DEV",
      "--regression",
      "T42_DEV",
      "--output",
      ".runtime/mixed-retrieval/t43-invalid.json",
    ])).toThrow(/EXCLUSIVE/i);
    expect(() => parseT43EvidenceAdequacyArguments([
      "--regression",
      "UNKNOWN",
      "--output",
      ".runtime/mixed-retrieval/t43-invalid.json",
    ])).toThrow();
  });

  it("fails closed on missing, duplicate and unknown arguments", () => {
    expect(() => parseT43EvidenceAdequacyArguments([]))
      .toThrow(/REQUIRED_ARGUMENT_MISSING/i);
    expect(() => parseT43EvidenceAdequacyArguments([
      "--output",
      ".runtime/mixed-retrieval/one.json",
      "--output",
      ".runtime/mixed-retrieval/two.json",
    ])).toThrow(/DUPLICATE_ARGUMENT/i);
    expect(() => parseT43EvidenceAdequacyArguments([
      "--output",
      ".runtime/mixed-retrieval/one.json",
      "--suite",
      "forbidden.json",
    ])).toThrow(/UNKNOWN_ARGUMENT/i);
  });

  it("allows only exclusive new JSON reports under the runtime root", async () => {
    const workspace = await mkdtemp(
      path.join(tmpdir(), "t43-cli-workspace-"),
    );
    try {
      await mkdir(
        path.join(workspace, ".runtime", "mixed-retrieval"),
        { recursive: true },
      );
      const allowed =
        ".runtime/mixed-retrieval/t43-new-report.json";
      await expect(resolveT43OutputPath(workspace, allowed))
        .resolves.toBe(path.resolve(workspace, allowed));
      await writeFile(path.resolve(workspace, allowed), "{}\n");
      await expect(resolveT43OutputPath(workspace, allowed))
        .rejects.toThrow(/ALREADY_EXISTS/i);
      await expect(resolveT43OutputPath(
        workspace,
        "docs/t43-report.json",
      )).rejects.toThrow(/MIXED_RETRIEVAL_JSON/i);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejects symlink or junction output-parent escapes", async () => {
    const external = await mkdtemp(
      path.join(tmpdir(), "t43-cli-external-"),
    );
    const workspace = await mkdtemp(
      path.join(tmpdir(), "t43-cli-workspace-"),
    );
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
      await expect(resolveT43OutputPath(
        workspace,
        ".runtime/mixed-retrieval/nested/report.json",
      )).rejects.toThrow(/OUTPUT_PARENT_(INVALID|IDENTITY_DRIFT)/i);
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });

  it("derives exact provider calls from scoring-side execution classes", () => {
    const routes = [
      ...Array.from({ length: 90 }, (_, index) => ({
        runtimeQuerySha256: index.toString(16).padStart(64, "0"),
        executionClass: "HEALTHY_SCOPED_TTT" as const,
        expectedChannels: ["LEXICAL", "TEXT_VECTOR"] as const,
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        runtimeQuerySha256: (index + 90)
          .toString(16)
          .padStart(64, "0"),
        executionClass: "PRE_RETRIEVAL_EMPTY" as const,
        expectedChannels: [] as const,
      })),
    ];
    const entries = routes.flatMap((route) =>
      route.expectedChannels.map((channel) => ({
        channel,
        queryFingerprint: route.runtimeQuerySha256,
      })));
    const audit = auditT43ProviderInvocationsV2({
      entryCount: entries.length,
      entries,
    } as never, routes);

    expect(audit).toMatchObject({
      passed: true,
      expectedCalls: 180,
      observedCalls: 180,
      expectedQueriedCount: 90,
      observedQueriedCount: 90,
      preRetrievalSkippedQueries: 10,
      duplicateCallCount: 0,
      channelCounts: {
        lexical: 90,
        textVector: 90,
        visualVector: 0,
        captionLexical: 0,
        unknown: 0,
      },
      violations: [],
    });
  });

  it("rejects a provenance-like excuse for a scoring-side call mismatch", () => {
    const routes = [
      ...Array.from({ length: 90 }, (_, index) => ({
        runtimeQuerySha256: index.toString(16).padStart(64, "0"),
        executionClass: "HEALTHY_SCOPED_TTT" as const,
        expectedChannels: ["LEXICAL", "TEXT_VECTOR"] as const,
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        runtimeQuerySha256: (index + 90)
          .toString(16)
          .padStart(64, "0"),
        executionClass: "PRE_RETRIEVAL_EMPTY" as const,
        expectedChannels: [] as const,
      })),
    ];
    const audit = auditT43ProviderInvocationsV2({
      entryCount: 2,
      entries: [
        {
          channel: "LEXICAL",
          queryFingerprint: routes[90]!.runtimeQuerySha256,
        },
        {
          channel: "TEXT_VECTOR",
          queryFingerprint: routes[90]!.runtimeQuerySha256,
        },
      ],
    } as never, routes);

    expect(audit.passed).toBe(false);
    expect(audit.violations.join("\n")).toMatch(
      /expected 180 calls|received \[\]/,
    );
  });

  it("audits exact text-only regression calls without using runtime provenance", () => {
    const routes = [
      {
        runtimeQuerySha256: "a".repeat(64),
        expectedChannels: ["LEXICAL", "TEXT_VECTOR"] as const,
      },
      {
        runtimeQuerySha256: "b".repeat(64),
        expectedChannels: [] as const,
      },
    ];
    const audit = auditT43TextOnlyRegressionInvocationsV2({
      spy: {
        entryCount: 2,
        entries: [
          {
            channel: "TEXT_VECTOR",
            queryFingerprint: "a".repeat(64),
            keys: [],
            mode: "TEXT_TO_TEXT",
            coursePackId: "general-design",
          },
          {
            channel: "LEXICAL",
            queryFingerprint: "a".repeat(64),
            keys: [],
            mode: "TEXT_TO_TEXT",
            coursePackId: "general-design",
          },
        ],
      },
      expectedCalls: 2,
      expectedQueriedFingerprints: 1,
      expectedRoutes: routes,
    });
    expect(audit).toMatchObject({
      passed: true,
      observedCalls: 2,
      observedQueriedFingerprints: 1,
      duplicateCalls: 0,
      channelCounts: {
        lexical: 1,
        textVector: 1,
        forbidden: 0,
      },
      violations: [],
    });
  });

  it("binds A0/C1 outcome hashes and reports green-to-red regressions", () => {
    const a0 = [
      {
        caseId: "case-a",
        pass: true,
        outcome: "GREEN",
        runtimeQuerySha256: "a".repeat(64),
      },
      {
        caseId: "case-b",
        pass: false,
        outcome: "RED",
        runtimeQuerySha256: "b".repeat(64),
      },
    ];
    const c1 = [
      {
        ...a0[0]!,
        pass: false,
        outcome: "REGRESSED",
      },
      a0[1]!,
    ];
    expect(compareT43RegressionOutcomesV2(a0, c1))
      .toMatchObject({
        passed: false,
        greenToRedCaseIds: ["case-a"],
        changedOutcomeCaseIds: ["case-a"],
        queryFingerprintMismatchCaseIds: [],
        missingFromA0: [],
        missingFromC1: [],
      });
  });

  it("registers the guarded pnpm commands", () => {
    const pkg = JSON.parse(readFileSync(
      path.join(process.cwd(), "package.json"),
      "utf8",
    )) as { scripts: Record<string, string> };
    expect(pkg.scripts["premixed:t43"]).toContain(
      "check-runtime-tools",
    );
    expect(pkg.scripts["mixed:t43"]).toBe(
      "tsx scripts/evaluate-t43-evidence-adequacy-v2.ts",
    );
  });

  it("keeps runtime imports physically isolated from scoring files", async () => {
    await expect(auditT43RuntimeImportGraphV2(process.cwd()))
      .resolves.toMatchObject({
        passed: true,
        forbiddenImportCount: 0,
        auditedFiles: expect.arrayContaining([
          "lib/knowledge/hybrid-retriever-v2.ts",
          "lib/knowledge/mixed-retrieval-runtime-v2.ts",
        ]),
        violations: [],
      });
  });
});
