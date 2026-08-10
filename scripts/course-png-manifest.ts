import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  COURSE_PNG_MANIFEST_PATH,
  verifyCoursePngManifest,
  writeCoursePngManifest,
} from "@/lib/knowledge/course-png-manifest";

export async function runCoursePngManifest(
  mode: "WRITE" | "CHECK",
  workspaceRoot = process.cwd(),
) {
  const manifest = mode === "WRITE"
    ? await writeCoursePngManifest({ workspaceRoot })
    : await verifyCoursePngManifest({ workspaceRoot });
  return {
    mode,
    manifestPath: COURSE_PNG_MANIFEST_PATH.replaceAll("\\", "/"),
    assetCount: manifest.assetCount,
    totalBytes: manifest.totalBytes,
  };
}

export function parseCoursePngManifestArgs(arguments_: readonly string[]) {
  if (arguments_.length === 1 && arguments_[0] === "--write") return "WRITE" as const;
  if (arguments_.length === 1 && arguments_[0] === "--check") return "CHECK" as const;
  throw new Error("usage: course-png-manifest.ts --write|--check");
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  Promise.resolve()
    .then(() => runCoursePngManifest(parseCoursePngManifestArgs(process.argv.slice(2))))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
