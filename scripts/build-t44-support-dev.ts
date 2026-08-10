import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildT44SupportDevArtifacts,
  serializeT44SupportArtifact,
} from "../tools/mixed-retrieval/t44-support-authoring";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const corpusPath = path.join(
  workspaceRoot,
  "data",
  "knowledge-v2",
  "knowledge-corpus.v2.json",
);
const runtimePath = path.join(
  workspaceRoot,
  "tests",
  "retrieval-quality",
  "t44-support-dev.runtime.json",
);
const qrelsPath = path.join(
  workspaceRoot,
  "tests",
  "retrieval-quality",
  "t44-support-dev.qrels.json",
);

function parseMode() {
  const args = process.argv.slice(2);
  if (
    args.length !== 1
    || !["--check", "--write"].includes(args[0] ?? "")
  ) {
    throw new Error(
      "usage: build-t44-support-dev.ts --check|--write",
    );
  }
  return args[0] === "--write" ? "WRITE" : "CHECK";
}

async function main() {
  const mode = parseMode();
  const corpus = JSON.parse(
    await readFile(corpusPath, "utf8"),
  ) as unknown;
  const artifacts =
    buildT44SupportDevArtifacts(corpus);
  const runtimeText =
    serializeT44SupportArtifact(artifacts.runtime);
  const qrelsText =
    serializeT44SupportArtifact(artifacts.qrels);

  if (mode === "WRITE") {
    await writeFile(runtimePath, runtimeText, "utf8");
    await writeFile(qrelsPath, qrelsText, "utf8");
  } else {
    const [actualRuntime, actualQrels] =
      await Promise.all([
        readFile(runtimePath, "utf8"),
        readFile(qrelsPath, "utf8"),
      ]);
    if (actualRuntime !== runtimeText) {
      throw new Error(
        "T44_SUPPORT_RUNTIME_GENERATED_FILE_DRIFT",
      );
    }
    if (actualQrels !== qrelsText) {
      throw new Error(
        "T44_SUPPORT_QRELS_GENERATED_FILE_DRIFT",
      );
    }
  }

  const packCounts = Object.fromEntries(
    [...new Set(
      artifacts.runtime.cases.map(
        ({ coursePackId }) => coursePackId,
      ),
    )].map((coursePackId) => [
      coursePackId,
      artifacts.runtime.cases.filter(
        (testCase) =>
          testCase.coursePackId === coursePackId,
      ).length,
    ]),
  );
  const stratumCounts = Object.fromEntries(
    [...new Set(
      artifacts.qrels.cases.map(
        ({ stratum }) => stratum,
      ),
    )].map((stratum) => [
      stratum,
      artifacts.qrels.cases.filter(
        (testCase) => testCase.stratum === stratum,
      ).length,
    ]),
  );
  console.log(JSON.stringify({
    mode,
    runtimePath: path.relative(
      workspaceRoot,
      runtimePath,
    ).replaceAll("\\", "/"),
    qrelsPath: path.relative(
      workspaceRoot,
      qrelsPath,
    ).replaceAll("\\", "/"),
    caseCount: artifacts.runtime.cases.length,
    packCounts,
    stratumCounts,
    multiClaimCount: artifacts.qrels.cases.filter(
      ({ multiClaim }) => multiClaim,
    ).length,
    runtimeSuiteHash: artifacts.runtime.suiteHash,
    qrelsSuiteHash: artifacts.qrels.suiteHash,
    corpusBundleHash:
      artifacts.runtime.corpusSnapshot.bundleHash,
    database: "NOT_USED",
    model: "NOT_USED",
    webService: "NOT_STARTED",
    deployment: "NOT_PERFORMED",
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
