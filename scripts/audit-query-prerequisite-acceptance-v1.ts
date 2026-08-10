import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  evaluateQueryPrerequisiteV3,
  QueryPrerequisiteDecisionV3Schema,
} from "@/lib/knowledge/query-prerequisite-router-v3";
import {
  sha256StableJsonV2,
} from "@/lib/knowledge/knowledge-object-v2";
import {
  createRetrievalQueryV2,
} from "@/lib/knowledge/retrieval-query-v2";

const SUITE_PATH =
  "tests/retrieval-quality/query-prerequisite-acceptance-v1.json";
const CORPUS_HASH = "a".repeat(64);
const ASSET_HASH = "c".repeat(64);
const STRATA = [
  "VISUAL_ATTENTION_STATIC",
  "MISSING_ASSET_INSPECTION",
  "ASSET_PRESENT_INSPECTION",
  "STATIC_METHOD",
] as const;

const StratumSchema = z.enum(STRATA);

const AcceptanceCaseSchema = z.object({
  id: z.string().regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  ),
  stratum: StratumSchema,
  text: z.string().trim().min(4).max(240),
  hasAsset: z.boolean(),
  expectedDecision:
    QueryPrerequisiteDecisionV3Schema,
  expectedFailClosed: z.boolean(),
}).strict();

export const QueryPrerequisiteAcceptanceSuiteV1Schema =
  z.object({
    schemaVersion: z.literal(1),
    id: z.literal("query-prerequisite-acceptance-v1"),
    cases: z.array(AcceptanceCaseSchema).length(24),
  })
    .strict()
    .superRefine((suite, context) => {
      const ids = suite.cases.map(({ id }) => id);
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: "custom",
          message: "acceptance case ids must be unique",
          path: ["cases"],
        });
      }
      for (const stratum of STRATA) {
        const count = suite.cases.filter(
          (testCase) =>
            testCase.stratum === stratum,
        ).length;
        if (count !== 6) {
          context.addIssue({
            code: "custom",
            message:
              `stratum ${stratum} must contain exactly 6 cases`,
            path: ["cases"],
          });
        }
      }
    });

export type QueryPrerequisiteAcceptanceSuiteV1 =
  z.infer<
    typeof QueryPrerequisiteAcceptanceSuiteV1Schema
  >;

export function parseQueryPrerequisiteAcceptanceSuiteV1(
  value: unknown,
) {
  return QueryPrerequisiteAcceptanceSuiteV1Schema
    .parse(value);
}

export function evaluateQueryPrerequisiteAcceptanceV1(
  suite: QueryPrerequisiteAcceptanceSuiteV1,
) {
  const cases = suite.cases.map((testCase) => {
    const scope = {
      corpusBundleHash: CORPUS_HASH,
      sourceCoursePack: {
        id: "layout-design" as const,
        version: "1" as const,
      },
    };
    const query = testCase.hasAsset
      ? createRetrievalQueryV2({
          mode: "IMAGE_TEXT_TO_EVIDENCE",
          text: testCase.text,
          queryAsset: {
            assetId: `asset-${testCase.id}`,
            sha256: ASSET_HASH,
          },
          scope,
        })
      : createRetrievalQueryV2({
          mode: "TEXT_TO_TEXT",
          text: testCase.text,
          scope,
        });
    const trace = evaluateQueryPrerequisiteV3({
      query,
    });
    const acceptedDecisions =
      testCase.expectedFailClosed
        ? [testCase.expectedDecision]
        : [
            testCase.expectedDecision,
            "AMBIGUOUS" as const,
          ];
    const passed =
      acceptedDecisions.includes(
        trace.decision as never,
      )
      && trace.failClosedEligible
        === testCase.expectedFailClosed;
    return {
      id: testCase.id,
      stratum: testCase.stratum,
      expectedDecision:
        testCase.expectedDecision,
      acceptedDecisions,
      actualDecision: trace.decision,
      expectedFailClosed:
        testCase.expectedFailClosed,
      actualFailClosed:
        trace.failClosedEligible,
      passed,
    };
  });
  const byStratum = STRATA.map((stratum) => {
    const stratumCases = cases.filter(
      (testCase) =>
        testCase.stratum === stratum,
    );
    return {
      stratum,
      cases: stratumCases.length,
      passed: stratumCases.filter(
        (testCase) => testCase.passed,
      ).length,
    };
  });
  const falsePositive = cases.filter(
    (testCase) =>
      !testCase.expectedFailClosed
      && testCase.actualFailClosed,
  ).length;
  const falseNegative = cases.filter(
    (testCase) =>
      testCase.expectedFailClosed
      && !testCase.actualFailClosed,
  ).length;
  const passed = cases.filter(
    (testCase) => testCase.passed,
  ).length;
  return {
    schemaVersion: 1 as const,
    kind:
      "QUERY_PREREQUISITE_ACCEPTANCE_REPORT" as const,
    suiteId: suite.id,
    suiteHash: sha256StableJsonV2(suite),
    cases: cases.length,
    passed,
    falsePositive,
    falseNegative,
    byStratum,
    failures: cases.filter(
      (testCase) => !testCase.passed,
    ),
    decision: passed === cases.length
      ? "PREREQUISITE_REMEDIATION_GO" as const
      : "PREREQUISITE_REMEDIATION_NO_GO" as const,
  };
}

export async function runQueryPrerequisiteAcceptanceCliV1(
  workspaceRoot = process.cwd(),
) {
  const suite = parseQueryPrerequisiteAcceptanceSuiteV1(
    JSON.parse(await readFile(
      path.resolve(workspaceRoot, SUITE_PATH),
      "utf8",
    )) as unknown,
  );
  return evaluateQueryPrerequisiteAcceptanceV1(suite);
}

async function main() {
  const report =
    await runQueryPrerequisiteAcceptanceCliV1();
  process.stdout.write(
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (
    report.decision
      !== "PREREQUISITE_REMEDIATION_GO"
  ) {
    process.exitCode = 1;
  }
}

const entryPoint = process.argv[1];
if (
  entryPoint
  && import.meta.url
    === pathToFileURL(path.resolve(entryPoint)).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error
        ? error.message
        : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
