import { HermeticHarnessModeSchema, runHermeticUnifiedHarness } from "@/lib/agent/harness-hermetic";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const mode = HermeticHarnessModeSchema.parse(argument("--mode") ?? "OFF");
  const outputRoot = argument("--output-root");
  const result = await runHermeticUnifiedHarness({
    mode,
    ...(outputRoot ? { outputRoot } : {}),
    requireCleanSource: true,
  });
  process.stdout.write(`${JSON.stringify({
    mode: result.report.mode,
    reportPath: result.reportPath,
    passed: result.report.agentHarness.passed,
    caseCount: result.report.agentHarness.caseCount,
    passedCaseCount: result.report.agentHarness.passedCaseCount,
    fixture: result.report.fixture,
    contextMemoryEvidence: result.report.contextMemoryEvidence,
  })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
