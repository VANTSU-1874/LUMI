import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import {
  preProcessFile,
} from "typescript";

import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";

export const T45_SELECTOR_EXECUTION_ROOTS_V1 =
  Object.freeze([
    "scripts/run-t45-multi-anchor-reviewer-v1.ts",
    "scripts/audit-t45-multi-anchor-reviewer-v1.ts",
    "scripts/freeze-t45-selector-v1.ts",
    "scripts/evaluate-t45-capability-obligations-v1.ts",
    "scripts/audit-t45-capability-oracle-v1.ts",
    "scripts/build-t45-capability-suites.ts",
  ] as const);

const NON_TYPESCRIPT_SOURCE_FILES = Object.freeze([
  "scripts/check-runtime-tools.mjs",
  "tools/reranker/t44_claim_matrix.py",
  "tsconfig.json",
  "package.json",
  "pnpm-lock.yaml",
] as const);

function normalizeRelativePath(
  workspaceRoot: string,
  absolutePath: string,
) {
  return path.relative(
    workspaceRoot,
    absolutePath,
  ).split(path.sep).join("/");
}

function resolveLocalTypeScriptImport(
  workspaceRoot: string,
  importer: string,
  specifier: string,
) {
  const unresolved = specifier.startsWith("@/")
    ? path.resolve(
        workspaceRoot,
        specifier.slice(2),
      )
    : specifier.startsWith(".")
      ? path.resolve(
          path.dirname(importer),
          specifier,
        )
      : null;
  if (!unresolved) return null;
  const withoutJavaScriptExtension =
    unresolved.replace(/\.(?:mjs|cjs|js|jsx)$/u, "");
  const candidates = [
    unresolved,
    withoutJavaScriptExtension,
    `${withoutJavaScriptExtension}.ts`,
    `${withoutJavaScriptExtension}.tsx`,
    `${withoutJavaScriptExtension}.mts`,
    `${withoutJavaScriptExtension}.cts`,
    path.join(withoutJavaScriptExtension, "index.ts"),
    path.join(withoutJavaScriptExtension, "index.tsx"),
  ];
  const target = candidates.find(
    (candidate) =>
      existsSync(candidate)
      && /\.(?:cts|mts|tsx?)$/u.test(candidate),
  );
  if (!target) {
    throw new Error(
      `T45_SELECTOR_SOURCE_IMPORT_UNRESOLVED:${normalizeRelativePath(
        workspaceRoot,
        importer,
      )}:${specifier}`,
    );
  }
  return path.resolve(target);
}

function assertRegularWorkspaceFile(
  workspaceRoot: string,
  absolutePath: string,
  relativePath: string,
) {
  const stat = lstatSync(absolutePath);
  if (
    stat.isSymbolicLink()
    || !stat.isFile()
  ) {
    throw new Error(
      `T45_SELECTOR_SOURCE_NOT_REGULAR:${relativePath}`,
    );
  }
  const realRoot = realpathSync(workspaceRoot);
  const realTarget = realpathSync(absolutePath);
  const fromRoot = path.relative(
    realRoot,
    realTarget,
  );
  if (
    fromRoot === ".."
    || fromRoot.startsWith(`..${path.sep}`)
    || path.isAbsolute(fromRoot)
  ) {
    throw new Error(
      `T45_SELECTOR_SOURCE_REALPATH_ESCAPE:${relativePath}`,
    );
  }
}

function assertTypeScriptAliasContract(
  workspaceRoot: string,
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      readFileSync(
        path.resolve(workspaceRoot, "tsconfig.json"),
        "utf8",
      ),
    ) as unknown;
  } catch {
    throw new Error(
      "T45_SELECTOR_TSCONFIG_INVALID",
    );
  }
  const paths = (
    parsed
    && typeof parsed === "object"
    && "compilerOptions" in parsed
    && parsed.compilerOptions
    && typeof parsed.compilerOptions === "object"
    && "paths" in parsed.compilerOptions
  )
    ? parsed.compilerOptions.paths
    : null;
  if (
    !paths
    || typeof paths !== "object"
    || !("@/*" in paths)
    || !Array.isArray(paths["@/*"])
    || paths["@/*"].length !== 1
    || paths["@/*"][0] !== "./*"
  ) {
    throw new Error(
      "T45_SELECTOR_TSCONFIG_ALIAS_DRIFT",
    );
  }
}

export function collectT45SelectorSourceFilesV1(
  workspaceRoot: string,
) {
  const root = path.resolve(workspaceRoot);
  assertTypeScriptAliasContract(root);
  const visited = new Set<string>();
  const visit = (relativePath: string) => {
    const absolutePath = path.resolve(root, relativePath);
    const normalized =
      normalizeRelativePath(root, absolutePath);
    if (
      normalized.startsWith("../")
      || path.isAbsolute(normalized)
    ) {
      throw new Error(
        `T45_SELECTOR_SOURCE_OUTSIDE_WORKSPACE:${relativePath}`,
      );
    }
    if (visited.has(normalized)) return;
    if (!existsSync(absolutePath)) {
      throw new Error(
        `T45_SELECTOR_SOURCE_MISSING:${normalized}`,
      );
    }
    assertRegularWorkspaceFile(
      root,
      absolutePath,
      normalized,
    );
    visited.add(normalized);
    if (!/\.(?:cts|mts|tsx?)$/u.test(absolutePath)) {
      return;
    }
    const imports = preProcessFile(
      readFileSync(absolutePath, "utf8"),
      true,
      true,
    ).importedFiles;
    for (const imported of imports) {
      const target = resolveLocalTypeScriptImport(
        root,
        absolutePath,
        imported.fileName,
      );
      if (target) {
        visit(normalizeRelativePath(root, target));
      }
    }
  };
  for (const entry of [
    ...T45_SELECTOR_EXECUTION_ROOTS_V1,
    ...NON_TYPESCRIPT_SOURCE_FILES,
  ]) {
    visit(entry);
  }
  return [...visited].sort((left, right) =>
    left.localeCompare(right, "en"));
}

export function captureT45SelectorSourceClosureV1(
  workspaceRoot: string,
) {
  const root = path.resolve(workspaceRoot);
  const sourceFiles =
    collectT45SelectorSourceFilesV1(root)
      .map((relativePath) => ({
        path: relativePath,
        sha256: createHash("sha256")
          .update(readFileSync(
            path.resolve(root, relativePath),
          ))
          .digest("hex"),
      }));
  return {
    sourceFiles,
    sourceClosureHash:
      sha256StableJsonV2(sourceFiles),
  };
}
