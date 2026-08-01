import { readFileSync } from "node:fs";

import { z } from "zod";

import {
  ReleaseRuntimeBindingSchema,
  ReleaseSourceBindingSchema,
  sameReleaseSourceBinding,
  type ReleaseRuntimeBinding,
  type ReleaseSourceBinding,
} from "./release-source-binding";

export const CURRENT_AGENT_HARNESS_VERSION = "2026-07-17.2";

export const REQUIRED_AGENT_HARNESS_CASES = Object.freeze([
  "normal-grounded-tool",
  "empty-tool-result",
  "invalid-tool-arguments",
  "forged-tool-rejected",
  "cross-pack-tool-rejected",
  "repeated-tool-rejected",
  "model-rate-limit-after-observation",
  "model-provider-offline",
  "formal-authority-blocked",
  "write-effect-requires-confirmation",
  "model-budget-exhausted",
  "cross-student-action-rejected",
  "action-idempotency-replay",
  "tool-timeout-contained",
  "tool-output-invalid-contained",
  "legacy-policy-trace-migrated",
] as const);

export const AgentHarnessCaseResultSchema = z.object({
  caseId: z.enum(REQUIRED_AGENT_HARNESS_CASES),
  passed: z.boolean(),
  durationMs: z.number().int().nonnegative().max(60_000),
  failures: z.array(z.string().trim().min(1).max(200)).max(20),
  observed: z.record(z.string(), z.json()),
}).strict();

export const AgentHarnessReportSchema = z.object({
  schemaVersion: z.literal(2),
  ...ReleaseSourceBindingSchema.shape,
  runtime: ReleaseRuntimeBindingSchema,
  harnessVersion: z.literal(CURRENT_AGENT_HARNESS_VERSION),
  evaluatedAt: z.string().datetime(),
  caseCount: z.literal(REQUIRED_AGENT_HARNESS_CASES.length),
  passedCaseCount: z.number().int().min(0).max(REQUIRED_AGENT_HARNESS_CASES.length),
  passed: z.boolean(),
  results: z.array(AgentHarnessCaseResultSchema).length(REQUIRED_AGENT_HARNESS_CASES.length),
}).strict().superRefine((report, context) => {
  const ids = report.results.map(({ caseId }) => caseId);
  if (new Set(ids).size !== REQUIRED_AGENT_HARNESS_CASES.length
    || REQUIRED_AGENT_HARNESS_CASES.some((id) => !ids.includes(id))) {
    context.addIssue({ code: "custom", path: ["results"], message: "harness cases are incomplete or duplicated" });
  }
  const actualPassed = report.results.filter(({ passed }) => passed).length;
  if (report.passedCaseCount !== actualPassed || report.passed !== (actualPassed === report.caseCount)) {
    context.addIssue({ code: "custom", message: "harness summary does not match case results" });
  }
});

export type AgentHarnessCaseResult = z.infer<typeof AgentHarnessCaseResultSchema>;
export type AgentHarnessReport = z.infer<typeof AgentHarnessReportSchema>;

export function buildAgentHarnessReport(
  results: AgentHarnessCaseResult[],
  source: ReleaseSourceBinding,
  runtime: ReleaseRuntimeBinding,
  evaluatedAt = new Date(),
) {
  const passedCaseCount = results.filter(({ passed }) => passed).length;
  return AgentHarnessReportSchema.parse({
    schemaVersion: 2,
    ...ReleaseSourceBindingSchema.parse(source),
    runtime: ReleaseRuntimeBindingSchema.parse(runtime),
    harnessVersion: CURRENT_AGENT_HARNESS_VERSION,
    evaluatedAt: evaluatedAt.toISOString(),
    caseCount: REQUIRED_AGENT_HARNESS_CASES.length,
    passedCaseCount,
    passed: passedCaseCount === REQUIRED_AGENT_HARNESS_CASES.length,
    results,
  });
}

export function readAgentHarnessGate(reportPath: string, options: {
  now?: Date;
  maxAgeMs?: number;
  expectedSource?: ReleaseSourceBinding;
} = {}) {
  const empty = { status: "not_run" as const, report: null };
  try {
    const report = AgentHarnessReportSchema.parse(JSON.parse(readFileSync(reportPath, "utf8")));
    if (options.expectedSource && !sameReleaseSourceBinding(report, options.expectedSource)) {
      return { status: "stale" as const, report };
    }
    const age = (options.now ?? new Date()).getTime() - new Date(report.evaluatedAt).getTime();
    if (age < 0 || age > (options.maxAgeMs ?? 7 * 24 * 60 * 60_000)) {
      return { status: "stale" as const, report };
    }
    return {
      status: report.passed && report.sourceTrackedTreeClean ? "passed" as const : "failed" as const,
      report,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
    return { status: "invalid" as const, report: null };
  }
}
