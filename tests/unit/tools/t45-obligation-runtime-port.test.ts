// @vitest-environment node

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  T45_FROZEN_RUNTIME_BINDINGS_V1,
  assertT45FormalPlannerReadyV1,
  buildT45ClarifyBaselineReuseV1,
  collectObligationLabelBlindArtifactsV1,
  loadT45RuntimePort,
} from "@/tools/mixed-retrieval/t45-obligation-runtime-port";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })),
  );
});

type Split = "CALIBRATION" | "VALIDATION";

async function localTypeScriptImportGraph(
  entryFiles: readonly string[],
) {
  const visited = new Map<string, string>();
  const pending = entryFiles.map((file) =>
    path.resolve(file));
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    const source = await readFile(file, "utf8");
    visited.set(file, source);
    const importPattern =
      /\bfrom\s+["']([^"']+)["']|import\s*["']([^"']+)["']/g;
    for (
      const match of source.matchAll(importPattern)
    ) {
      const specifier = match[1] ?? match[2]!;
      const base = specifier.startsWith("@/")
        ? path.resolve(specifier.slice(2))
        : specifier.startsWith(".")
          ? path.resolve(path.dirname(file), specifier)
          : null;
      if (!base) continue;
      const candidates = [
        base,
        `${base}.ts`,
        path.join(base, "index.ts"),
      ];
      let resolved: string | null = null;
      for (const candidate of candidates) {
        try {
          await readFile(candidate, "utf8");
          resolved = candidate;
          break;
        } catch {
          // Non-TypeScript local imports are outside this audit.
        }
      }
      if (resolved && !visited.has(resolved)) {
        pending.push(resolved);
      }
    }
  }
  return visited;
}

function runtimeFile(split: Split) {
  return split === "CALIBRATION"
    ? "t45-capability-calibration.runtime.json"
    : "t45-capability-validation.runtime.json";
}

function resignArtifact(
  value: Record<string, unknown>,
  hashField: "suiteHash" | "inventoryHash",
) {
  const unsigned = { ...value };
  delete unsigned[hashField];
  value[hashField] = sha256StableJsonV2(unsigned);
}

async function isolatedRuntimeWorkspace(input: {
  split: Split;
  mutateRuntime?: (
    value: Record<string, unknown>,
  ) => void;
  mutateInventory?: (
    value: Record<string, unknown>,
  ) => void;
}) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "lumi-t45-port-"),
  );
  roots.push(root);
  const sourceRoot = path.resolve(
    "tests/retrieval-quality",
  );
  const targetRoot = path.join(
    root,
    "tests",
    "retrieval-quality",
  );
  await mkdir(targetRoot, { recursive: true });
  const runtime = JSON.parse(
    await readFile(
      path.join(sourceRoot, runtimeFile(input.split)),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const inventory = JSON.parse(
    await readFile(
      path.join(
        sourceRoot,
        "t45-capability-inventory.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  input.mutateRuntime?.(runtime);
  input.mutateInventory?.(inventory);
  await writeFile(
    path.join(targetRoot, runtimeFile(input.split)),
    `${JSON.stringify(runtime, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(
      targetRoot,
      "t45-capability-inventory.json",
    ),
    `${JSON.stringify(inventory, null, 2)}\n`,
    "utf8",
  );
  return { root, runtime, inventory };
}

describe("T4.5 obligation runtime port", () => {
  it.each([
    "READY",
    "CLARIFY",
  ] as const)(
    "accepts a formal planner result with %s status and no provider failure",
    (status) => {
      expect(() =>
        assertT45FormalPlannerReadyV1({
          caseId: "formal-ready-case",
          status,
          failureCategory: null,
        }),
      ).not.toThrow();
    },
  );

  it.each([
    {
      status: "DEGRADED" as const,
      failureCategory: "PROVIDER_ERROR" as const,
      reason: "PROVIDER_ERROR",
    },
    {
      status: "READY" as const,
      failureCategory: "TIMEOUT" as const,
      reason: "TIMEOUT",
    },
    {
      status: "DEGRADED" as const,
      failureCategory: null,
      reason: "DEGRADED",
    },
  ])(
    "fails closed before sealing when the formal planner is not ready: $reason",
    ({ status, failureCategory, reason }) => {
      expect(() =>
        assertT45FormalPlannerReadyV1({
          caseId: "formal-failed-case",
          status,
          failureCategory,
        }),
      ).toThrow(
        `T45_FORMAL_PLANNER_NOT_READY:formal-failed-case:${reason}`,
      );
    },
  );

  it("keeps the whole-query baseline in B without new provider calls when the planner asks to clarify", () => {
    const aBatch = {
      expectedProviderCalls: 3,
      results: [],
    };
    const aRrf = {
      candidates: [],
    };

    const reused = buildT45ClarifyBaselineReuseV1({
      aBatch: aBatch as never,
      aRrf: aRrf as never,
      obligationSetHash: "a".repeat(64),
    });

    expect(reused.retrievalPlanHash)
      .toMatch(/^[0-9a-f]{64}$/);
    expect(reused.batch).toBe(aBatch);
    expect(reused.rrf).toBe(aRrf);
    expect(reused.providerTrace).toEqual({
      status: "CLARIFY",
      retrievalMode: "BASELINE_REUSED",
      elapsedMs: 0,
      expectedProviderCalls: 0,
      actualProviderCalls: 0,
      batch: aBatch,
      rrf: aRrf,
    });
  });

  it("deep-freezes every external binding and cannot be re-signed around", async () => {
    const fixture =
      await isolatedRuntimeWorkspace({
        split: "CALIBRATION",
        mutateRuntime: (runtime) => {
          const cases = runtime.cases as Array<{
            question: string;
          }>;
          cases[0]!.question += "冻结常量绕过尝试";
          resignArtifact(runtime, "suiteHash");
        },
      });
    const mutableBindings =
      T45_FROZEN_RUNTIME_BINDINGS_V1 as unknown as {
        suiteHashes: {
          CALIBRATION: string;
        };
      };
    const original =
      mutableBindings.suiteHashes.CALIBRATION;
    const resignedHash =
      fixture.runtime.suiteHash as string;
    let assignmentError: unknown;
    let loadError: unknown;
    let valueAfterAssignment: string | undefined;
    try {
      try {
        mutableBindings.suiteHashes.CALIBRATION =
          resignedHash;
      } catch (error) {
        assignmentError = error;
      }
      valueAfterAssignment =
        mutableBindings.suiteHashes.CALIBRATION;
      try {
        await loadT45RuntimePort({
          workspaceRoot: fixture.root,
          split: "CALIBRATION",
        });
      } catch (error) {
        loadError = error;
      }
    } finally {
      if (
        mutableBindings.suiteHashes.CALIBRATION
          !== original
      ) {
        mutableBindings.suiteHashes.CALIBRATION =
          original;
      }
    }

    expect(Object.isFrozen(
      T45_FROZEN_RUNTIME_BINDINGS_V1,
    )).toBe(true);
    expect(Object.isFrozen(
      T45_FROZEN_RUNTIME_BINDINGS_V1.suiteHashes,
    )).toBe(true);
    expect(assignmentError).toBeInstanceOf(TypeError);
    expect(valueAfterAssignment).toBe(original);
    expect(loadError).toBeInstanceOf(Error);
    expect((loadError as Error).message).toMatch(
      /T45_RUNTIME_PORT_FROZEN_SUITE_HASH_DRIFT/,
    );
  });

  it.each([
    "CALIBRATION",
    "VALIDATION",
  ] as const)(
    "loads only the %s runtime plus inventory and preserves all 20 cases",
    async (split) => {
      const fixture =
        await isolatedRuntimeWorkspace({ split });
      const port = await loadT45RuntimePort({
        workspaceRoot: fixture.root,
        split,
      });
      const runtimeCases =
        fixture.runtime.cases as Array<{
          caseId: string;
          familyId: string;
          stratum: string;
        }>;

      expect(port.identity).toEqual({
        id: fixture.runtime.id,
        version: fixture.runtime.version,
        suiteHash: fixture.runtime.suiteHash,
        split,
        inventoryHash:
          fixture.inventory.inventoryHash,
        corpusBundleHash: (
          fixture.runtime.corpusSnapshot as {
            bundleHash: string;
          }
        ).bundleHash,
      });
      expect(port.cases).toHaveLength(20);
      expect(
        port.cases.map(({ caseId }) => caseId),
      ).toEqual(
        runtimeCases.map(({ caseId }) => caseId),
      );
      expect(port.cases.map(
        ({ familyId, stratum }) => ({
          familyId,
          stratum,
        }),
      )).toEqual(runtimeCases.map(
        ({ familyId, stratum }) => ({
          familyId,
          stratum,
        }),
      ));
      expect(port.cases.every(
        (testCase) =>
          testCase.recentTurns.length === 0
          && testCase.view.id
            === "student-conversation"
          && testCase.hasArtwork === false
          && testCase.artworkHash === null,
      )).toBe(true);
      expect(Object.isFrozen(port)).toBe(true);
    },
  );

  it("rejects runtime suite, inventory and corpus identity drift", async () => {
    const suiteDrift =
      await isolatedRuntimeWorkspace({
        split: "CALIBRATION",
        mutateRuntime: (runtime) => {
          const cases = runtime.cases as Array<{
            question: string;
          }>;
          cases[0]!.question += "漂移";
        },
      });
    await expect(loadT45RuntimePort({
      workspaceRoot: suiteDrift.root,
      split: "CALIBRATION",
    })).rejects.toThrow(
      /T45_RUNTIME_PORT_SUITE_HASH_DRIFT/,
    );

    const inventoryDrift =
      await isolatedRuntimeWorkspace({
        split: "CALIBRATION",
        mutateInventory: (inventory) => {
          inventory.inventoryHash = "f".repeat(64);
        },
      });
    await expect(loadT45RuntimePort({
      workspaceRoot: inventoryDrift.root,
      split: "CALIBRATION",
    })).rejects.toThrow(
      /T45_RUNTIME_PORT_INVENTORY_HASH_DRIFT/,
    );

    const corpusDrift =
      await isolatedRuntimeWorkspace({
        split: "CALIBRATION",
        mutateRuntime: (runtime) => {
          const snapshot =
            runtime.corpusSnapshot as {
              bundleHash: string;
           };
           snapshot.bundleHash = "e".repeat(64);
          resignArtifact(runtime, "suiteHash");
        },
      });
    await expect(loadT45RuntimePort({
      workspaceRoot: corpusDrift.root,
      split: "CALIBRATION",
    })).rejects.toThrow(
      /T45_RUNTIME_PORT_CORPUS_BINDING_DRIFT/,
    );
  });

  it("rejects semantic runtime and inventory changes even when their self-declared hashes are re-signed", async () => {
    const resignedRuntime =
      await isolatedRuntimeWorkspace({
        split: "CALIBRATION",
        mutateRuntime: (runtime) => {
          const cases = runtime.cases as Array<{
            question: string;
          }>;
          cases[0]!.question += "重签后语义漂移";
          resignArtifact(runtime, "suiteHash");
        },
      });
    await expect(loadT45RuntimePort({
      workspaceRoot: resignedRuntime.root,
      split: "CALIBRATION",
    })).rejects.toThrow(
      /T45_RUNTIME_PORT_FROZEN_SUITE_HASH_DRIFT/,
    );

    const resignedInventory =
      await isolatedRuntimeWorkspace({
        split: "CALIBRATION",
        mutateInventory: (inventory) => {
          const objects = inventory.objects as Array<{
            objectContentHash: string;
          }>;
          objects[0]!.objectContentHash =
            "e".repeat(64);
          resignArtifact(inventory, "inventoryHash");
        },
      });
    await expect(loadT45RuntimePort({
      workspaceRoot: resignedInventory.root,
      split: "CALIBRATION",
    })).rejects.toThrow(
      /T45_RUNTIME_PORT_FROZEN_INVENTORY_HASH_DRIFT/,
    );

    const resignedCorpusBinding =
      await isolatedRuntimeWorkspace({
        split: "CALIBRATION",
        mutateRuntime: (runtime) => {
          (
            runtime.corpusSnapshot as {
              bundleHash: string;
            }
          ).bundleHash = "d".repeat(64);
          resignArtifact(runtime, "suiteHash");
        },
        mutateInventory: (inventory) => {
          inventory.corpusBundleHash =
            "d".repeat(64);
          resignArtifact(inventory, "inventoryHash");
        },
      });
    await expect(loadT45RuntimePort({
      workspaceRoot: resignedCorpusBinding.root,
      split: "CALIBRATION",
    })).rejects.toThrow(
      /T45_RUNTIME_PORT_FROZEN_CORPUS_HASH_DRIFT/,
    );
  });

  it("keeps the full runtime import graphs free of label fields and files", async () => {
    expect(
      typeof collectObligationLabelBlindArtifactsV1,
    ).toBe("function");
    const graph = await localTypeScriptImportGraph([
      "tools/mixed-retrieval/"
        + "t45-obligation-runtime-port.ts",
      "scripts/"
        + "evaluate-t45-capability-obligations-v1.ts",
    ]);
    const violations = [...graph.entries()]
      .filter(([, source]) =>
        /\.qrels|requiredEvidenceGroups|hardNegativeNodeIds/i
          .test(source))
      .map(([file]) =>
        path.relative(process.cwd(), file)
          .replaceAll("\\", "/"))
      .sort();
    expect(violations).toEqual([]);
  });
});
