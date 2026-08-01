// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const checker = path.resolve("scripts/check-runtime-tools.mjs");

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "lumi-toolchain-"));
  roots.push(root);
  return root;
}

const toolEntries = {
  tsx: ["tsx", "dist", "cli.mjs"],
  next: ["next", "dist", "bin", "next"],
  vitest: ["vitest", "vitest.mjs"],
  "drizzle-kit": ["drizzle-kit", "bin.cjs"],
} as const;

function run(root: string, tools: string) {
  return spawnSync(process.execPath, [
    checker,
    "--root",
    root,
    "--platform",
    "win32",
    "--tools",
    tools,
  ], {
    encoding: "utf8",
    windowsHide: true,
  });
}

async function installFakeTool(root: string, tool: keyof typeof toolEntries, includeShim = true) {
  const entry = path.join(root, "node_modules", ...toolEntries[tool]);
  await mkdir(path.dirname(entry), { recursive: true });
  await writeFile(entry, "", "utf8");
  if (!includeShim) return;
  const shim = path.join(root, "node_modules", ".bin", `${tool}.cmd`);
  await mkdir(path.dirname(shim), { recursive: true });
  await writeFile(shim, "", "utf8");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runtime toolchain preflight", () => {
  it("maps every critical package lifecycle hook to the required tool", async () => {
    const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const expected = {
      dev: "next",
      build: "next",
      test: "vitest",
      "test:watch": "vitest",
      "db:generate": "drizzle-kit",
      "db:migrate": "tsx",
      "db:seed": "tsx",
      "knowledge:ingest": "tsx",
      "agent:eval": "tsx",
      "model:latency": "tsx",
      "agent:benchmark": "tsx",
      "agent:harness": "tsx",
      "tutor:quality": "tsx",
      "tutor:promotion:verify": "tsx",
      "local-host:start": "tsx",
    } as const;

    for (const [script, tool] of Object.entries(expected)) {
      expect(packageJson.scripts[`pre${script}`]).toBe(
        `node scripts/check-runtime-tools.mjs --tools ${tool}`,
      );
    }
    expect(packageJson.scripts["runtime:preflight"]).toBe(
      "node scripts/check-runtime-tools.mjs --tools tsx,next,vitest,drizzle-kit",
    );
  });

  it.each([
    ["tsx", "TOOLCHAIN_TSX_SHIM_MISSING"],
    ["next", "TOOLCHAIN_NEXT_SHIM_MISSING"],
    ["vitest", "TOOLCHAIN_VITEST_SHIM_MISSING"],
    ["drizzle-kit", "TOOLCHAIN_DRIZZLE_KIT_SHIM_MISSING"],
  ] as const)("reports a missing Windows %s shim before its runner starts", async (tool, code) => {
    const root = await temporaryRoot();
    await installFakeTool(root, tool, false);

    const result = run(root, tool);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(code);
    expect(result.stderr).toContain("pnpm install --frozen-lockfile");
  });

  it.each([
    ["tsx", "TOOLCHAIN_TSX_CLI_MISSING"],
    ["next", "TOOLCHAIN_NEXT_CLI_MISSING"],
    ["vitest", "TOOLCHAIN_VITEST_CLI_MISSING"],
    ["drizzle-kit", "TOOLCHAIN_DRIZZLE_KIT_CLI_MISSING"],
  ] as const)("reports a missing %s package entry", async (tool, code) => {
    const root = await temporaryRoot();

    const result = run(root, tool);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(code);
  });

  it("stays silent when every requested package entry and shim exists", async () => {
    const root = await temporaryRoot();
    await Promise.all((Object.keys(toolEntries) as Array<keyof typeof toolEntries>)
      .map((tool) => installFakeTool(root, tool)));

    const result = run(root, "tsx,next,vitest,drizzle-kit");

    expect(result).toMatchObject({ status: 0, stdout: "", stderr: "" });
  });
});
