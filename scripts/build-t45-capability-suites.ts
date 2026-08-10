import {
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildT45CapabilityArtifacts,
  serializeT45CapabilityArtifact,
} from "../tools/mixed-retrieval/t45-capability-authoring";

type CliMode = "CHECK" | "WRITE";

export type T45CapabilitySuiteSummary = {
  mode: CliMode;
  objects: number;
  frozenT44Objects: number;
  calibrationObjects: number;
  validationObjects: number;
  visualReserveObjects: number;
  calibrationFamilies: number;
  validationFamilies: number;
  calibrationCases: number;
  validationCases: number;
  calibrationGroups: number;
  validationGroups: number;
  calibrationMulti: number;
  validationMulti: number;
};

function parseMode(args: readonly string[]): CliMode {
  if (
    args.length !== 1
    || !["--check", "--write"].includes(args[0] ?? "")
  ) {
    throw new Error(
      "usage: build-t45-capability-suites.ts --check|--write",
    );
  }
  return args[0] === "--write" ? "WRITE" : "CHECK";
}

export async function runT45CapabilitySuiteCli(input: {
  workspaceRoot: string;
  args: readonly string[];
  log?: (message: string) => void;
}): Promise<T45CapabilitySuiteSummary> {
  const mode = parseMode(input.args);
  const corpusPath = path.join(
    input.workspaceRoot,
    "data",
    "knowledge-v2",
    "knowledge-corpus.v2.json",
  );
  const suiteRoot = path.join(
    input.workspaceRoot,
    "tests",
    "retrieval-quality",
  );
  const frozenT44QrelsPath = path.join(
    suiteRoot,
    "t44-support-dev.qrels.json",
  );
  const [corpusText, frozenT44QrelsText] =
    await Promise.all([
      readFile(corpusPath, "utf8"),
      readFile(frozenT44QrelsPath, "utf8"),
    ]);
  const artifacts = buildT45CapabilityArtifacts({
    corpusInput: JSON.parse(corpusText) as unknown,
    frozenT44QrelsInput:
      JSON.parse(frozenT44QrelsText) as unknown,
  });
  const outputs = [
    {
      path: path.join(
        suiteRoot,
        "t45-capability-inventory.json",
      ),
      text: serializeT45CapabilityArtifact(
        artifacts.inventory,
      ),
      driftCode:
        "T45_CAPABILITY_INVENTORY_GENERATED_FILE_DRIFT",
    },
    {
      path: path.join(
        suiteRoot,
        "t45-capability-calibration.runtime.json",
      ),
      text: serializeT45CapabilityArtifact(
        artifacts.calibration.runtime,
      ),
      driftCode:
        "T45_CAPABILITY_CALIBRATION_RUNTIME_GENERATED_FILE_DRIFT",
    },
    {
      path: path.join(
        suiteRoot,
        "t45-capability-calibration.qrels.json",
      ),
      text: serializeT45CapabilityArtifact(
        artifacts.calibration.qrels,
      ),
      driftCode:
        "T45_CAPABILITY_CALIBRATION_QRELS_GENERATED_FILE_DRIFT",
    },
    {
      path: path.join(
        suiteRoot,
        "t45-capability-validation.runtime.json",
      ),
      text: serializeT45CapabilityArtifact(
        artifacts.validation.runtime,
      ),
      driftCode:
        "T45_CAPABILITY_VALIDATION_RUNTIME_GENERATED_FILE_DRIFT",
    },
    {
      path: path.join(
        suiteRoot,
        "t45-capability-validation.qrels.json",
      ),
      text: serializeT45CapabilityArtifact(
        artifacts.validation.qrels,
      ),
      driftCode:
        "T45_CAPABILITY_VALIDATION_QRELS_GENERATED_FILE_DRIFT",
    },
  ] as const;

  if (mode === "WRITE") {
    await Promise.all(
      outputs.map((output) =>
        writeFile(output.path, output.text, "utf8")),
    );
  } else {
    for (const output of outputs) {
      const actual = await readFile(output.path, "utf8");
      if (actual !== output.text) {
        throw new Error(output.driftCode);
      }
    }
  }

  const summary: T45CapabilitySuiteSummary = {
    mode,
    objects: artifacts.inventory.objects.length,
    frozenT44Objects:
      artifacts.inventory.objects.filter(
        ({ partition }) => partition === "FROZEN_T44",
      ).length,
    calibrationObjects:
      artifacts.inventory.objects.filter(
        ({ partition }) => partition === "DEV_CAL",
      ).length,
    validationObjects:
      artifacts.inventory.objects.filter(
        ({ partition }) => partition === "VALIDATION",
      ).length,
    visualReserveObjects:
      artifacts.inventory.objects.filter(
        ({ partition }) =>
          partition === "VISUAL_RESERVE",
      ).length,
    calibrationFamilies:
      artifacts.inventory.families.filter(
        ({ partition }) => partition === "DEV_CAL",
      ).length,
    validationFamilies:
      artifacts.inventory.families.filter(
        ({ partition }) => partition === "VALIDATION",
      ).length,
    calibrationCases:
      artifacts.calibration.runtime.cases.length,
    validationCases:
      artifacts.validation.runtime.cases.length,
    calibrationGroups:
      artifacts.calibration.qrels.cases.reduce(
        (sum, testCase) =>
          sum + testCase.requiredEvidenceGroups.length,
        0,
      ),
    validationGroups:
      artifacts.validation.qrels.cases.reduce(
        (sum, testCase) =>
          sum + testCase.requiredEvidenceGroups.length,
        0,
      ),
    calibrationMulti:
      artifacts.calibration.qrels.cases.filter(
        ({ multiClaim }) => multiClaim,
      ).length,
    validationMulti:
      artifacts.validation.qrels.cases.filter(
        ({ multiClaim }) => multiClaim,
      ).length,
  };
  (input.log ?? console.log)(JSON.stringify(summary));
  return summary;
}

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const invokedPath = process.argv[1]
  ? path.resolve(process.argv[1])
  : null;
const modulePath = path.resolve(
  fileURLToPath(import.meta.url),
);
if (
  invokedPath
  && invokedPath.toLocaleLowerCase("en-US")
    === modulePath.toLocaleLowerCase("en-US")
) {
  runT45CapabilitySuiteCli({
    workspaceRoot,
    args: process.argv.slice(2),
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
