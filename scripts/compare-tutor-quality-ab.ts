import {
  access,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  compareTutorQualityArms,
} from "@/lib/agent/tutor-quality-ab";
import {
  loadTutorQualitySuite,
} from "@/lib/agent/tutor-quality-suite";

type Arguments = {
  legacy: string;
  v2: string;
  rag: string;
  output: string;
  blindPack: string;
  blindMapping: string;
};

function parseArguments(
  rawArguments: readonly string[],
): Arguments {
  const argumentsList =
    rawArguments[0] === "--"
      ? rawArguments.slice(1)
      : [...rawArguments];
  const values = new Map<string, string>();
  const allowed = new Set([
    "--legacy",
    "--v2",
    "--rag",
    "--output",
    "--blind-pack",
    "--blind-mapping",
  ]);
  for (
    let index = 0;
    index < argumentsList.length;
    index += 2
  ) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!key || !allowed.has(key)) {
      throw new Error(
        "TUTOR_QUALITY_AB_ARGUMENT_UNKNOWN",
      );
    }
    if (
      !value
      || value.startsWith("--")
    ) {
      throw new Error(
        "TUTOR_QUALITY_AB_ARGUMENT_MISSING",
      );
    }
    if (values.has(key)) {
      throw new Error(
        "TUTOR_QUALITY_AB_ARGUMENT_DUPLICATE",
      );
    }
    values.set(key, value);
  }
  if (
    values.size !== allowed.size
    || argumentsList.length
      !== allowed.size * 2
  ) {
    throw new Error(
      "TUTOR_QUALITY_AB_ARGUMENT_INCOMPLETE",
    );
  }
  return {
    legacy: values.get("--legacy")!,
    v2: values.get("--v2")!,
    rag: values.get("--rag")!,
    output: values.get("--output")!,
    blindPack: values.get("--blind-pack")!,
    blindMapping:
      values.get("--blind-mapping")!,
  };
}

async function assertOutputsAbsent(
  filePaths: readonly string[],
) {
  for (const filePath of filePaths) {
    try {
      await access(filePath);
      throw new Error(
        "TUTOR_QUALITY_AB_OUTPUT_EXISTS",
      );
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code
          !== "ENOENT"
      ) throw error;
    }
  }
}

async function main() {
  const argumentsValue = parseArguments(
    process.argv.slice(2),
  );
  const legacyPath =
    path.resolve(argumentsValue.legacy);
  const v2Path = path.resolve(argumentsValue.v2);
  const ragPath =
    path.resolve(argumentsValue.rag);
  const outputPath =
    path.resolve(argumentsValue.output);
  const blindPackPath =
    path.resolve(argumentsValue.blindPack);
  const blindMappingPath =
    path.resolve(argumentsValue.blindMapping);
  const allPaths = [
    legacyPath,
    v2Path,
    ragPath,
    outputPath,
    blindPackPath,
    blindMappingPath,
  ];
  if (new Set(allPaths).size !== allPaths.length) {
    throw new Error(
      "TUTOR_QUALITY_AB_PATH_COLLISION",
    );
  }
  const [
    legacyReportText,
    v2ReportText,
    rawRagReport,
    rawLegacyAttestation,
    rawV2Attestation,
  ] = await Promise.all([
    readFile(legacyPath, "utf8"),
    readFile(v2Path, "utf8"),
    readFile(ragPath, "utf8")
      .then((value) => JSON.parse(value)),
    readFile(`${legacyPath}.arm.json`, "utf8")
      .then((value) => JSON.parse(value)),
    readFile(`${v2Path}.arm.json`, "utf8")
      .then((value) => JSON.parse(value)),
  ]);
  const { suite, suiteHash } =
    loadTutorQualitySuite(
      path.resolve(
        "tests/tutor-quality/golden-suite.json",
      ),
    );
  const comparison = compareTutorQualityArms({
    suite,
    suiteHash,
    legacyReportText,
    v2ReportText,
    rawLegacyAttestation,
    rawV2Attestation,
    rawRagReport,
  });
  await assertOutputsAbsent([
    outputPath,
    blindPackPath,
    blindMappingPath,
  ]);
  await Promise.all([
    outputPath,
    blindPackPath,
    blindMappingPath,
  ].map((filePath) =>
    mkdir(path.dirname(filePath), {
      recursive: true,
    })));
  await Promise.all([
    writeFile(
      outputPath,
      `${JSON.stringify(
        comparison.report,
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx" },
    ),
    writeFile(
      blindPackPath,
      comparison.blindReviewMarkdown,
      { encoding: "utf8", flag: "wx" },
    ),
    writeFile(
      blindMappingPath,
      `${JSON.stringify(
        comparison.blindMapping,
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx" },
    ),
  ]);
  process.stdout.write(`${JSON.stringify({
    decision: comparison.report.decision,
    outputPath,
    blindPackPath,
    blindMappingPath,
    blindCaseCount:
      comparison.blindMapping.caseCount,
    automatedGates:
      comparison.report.automatedGates,
  })}\n`);
  if (
    comparison.report.decision
      === "T6_AUTOMATED_NO_GO"
  ) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error
      ? error.message
      : "TUTOR_QUALITY_AB_FAILED"}\n`,
  );
  process.exitCode = 1;
});
