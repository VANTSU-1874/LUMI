import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const root = path.resolve(argument("--root") ?? process.cwd());
const platform = argument("--platform") ?? process.platform;
const TOOL_DEFINITIONS = {
  tsx: { packageEntry: ["tsx", "dist", "cli.mjs"], shim: "tsx" },
  next: { packageEntry: ["next", "dist", "bin", "next"], shim: "next" },
  vitest: { packageEntry: ["vitest", "vitest.mjs"], shim: "vitest" },
  "drizzle-kit": { packageEntry: ["drizzle-kit", "bin.cjs"], shim: "drizzle-kit" },
};

const requestedTools = (argument("--tools") ?? Object.keys(TOOL_DEFINITIONS).join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

const failures = [];
for (const tool of requestedTools) {
  const definition = TOOL_DEFINITIONS[tool];
  if (!definition) {
    failures.push(`TOOLCHAIN_UNKNOWN_TOOL:${tool}`);
    continue;
  }
  const packageEntry = path.join(root, "node_modules", ...definition.packageEntry);
  const shim = path.join(
    root,
    "node_modules",
    ".bin",
    platform === "win32" ? `${definition.shim}.cmd` : definition.shim,
  );
  const [entryExists, shimExists] = await Promise.all([exists(packageEntry), exists(shim)]);
  const label = tool.replaceAll("-", "_").toUpperCase();
  if (!entryExists) failures.push(`TOOLCHAIN_${label}_CLI_MISSING`);
  else if (!shimExists) failures.push(`TOOLCHAIN_${label}_SHIM_MISSING`);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n运行：pnpm install --frozen-lockfile\n`);
  process.exitCode = 1;
}
