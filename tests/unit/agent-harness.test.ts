// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AgentHarnessReportSchema,
  type AgentHarnessCaseResult,
  buildAgentHarnessReport,
  readAgentHarnessGate,
  REQUIRED_AGENT_HARNESS_CASES,
} from "@/lib/agent/harness";
import {
  CLEAN_RELEASE_SOURCE,
  DIRTY_RELEASE_SOURCE,
  V3_RELEASE_RUNTIME,
} from "@/tests/helpers/release-source-binding";

const roots: string[] = [];

function passingResults(): AgentHarnessCaseResult[] {
  return REQUIRED_AGENT_HARNESS_CASES.map((caseId) => ({
    caseId,
    passed: true,
    durationMs: 1,
    failures: [],
    observed: {},
  }));
}

async function reportFile(report: unknown) {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-harness-report-"));
  roots.push(root);
  const reportPath = path.join(root, "report.json");
  await writeFile(reportPath, JSON.stringify(report), "utf8");
  return reportPath;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agent release Harness report", () => {
  it("passes only a fresh report containing every required scenario exactly once", async () => {
    const evaluatedAt = new Date("2026-07-15T08:00:00.000Z");
    const report = buildAgentHarnessReport(
      passingResults(), CLEAN_RELEASE_SOURCE, V3_RELEASE_RUNTIME, evaluatedAt,
    );
    const gate = readAgentHarnessGate(await reportFile(report), {
      now: new Date("2026-07-15T09:00:00.000Z"),
    });

    expect(report).toMatchObject({
      passed: true,
      caseCount: REQUIRED_AGENT_HARNESS_CASES.length,
      passedCaseCount: REQUIRED_AGENT_HARNESS_CASES.length,
    });
    expect(gate.status).toBe("passed");
  });

  it("fails a complete report when one containment scenario fails", async () => {
    const results = passingResults();
    results[0] = { ...results[0], passed: false, failures: ["GROUNDING_FAILED"] };
    const gate = readAgentHarnessGate(await reportFile(
      buildAgentHarnessReport(results, CLEAN_RELEASE_SOURCE, V3_RELEASE_RUNTIME),
    ));

    expect(gate.status).toBe("failed");
    expect(gate.report?.passedCaseCount).toBe(REQUIRED_AGENT_HARNESS_CASES.length - 1);
  });

  it("rejects stale, malformed and missing reports without opening the release gate", async () => {
    const old = buildAgentHarnessReport(
      passingResults(),
      CLEAN_RELEASE_SOURCE,
      V3_RELEASE_RUNTIME,
      new Date("2026-06-01T00:00:00.000Z"),
    );
    expect(readAgentHarnessGate(await reportFile(old), {
      now: new Date("2026-07-15T00:00:00.000Z"),
    }).status).toBe("stale");
    expect(readAgentHarnessGate(await reportFile({ passed: true })).status).toBe("invalid");
    expect(readAgentHarnessGate(path.join(tmpdir(), "missing-agent-harness-report.json")).status).toBe("not_run");
  });

  it("rejects duplicated or omitted required scenarios at the schema boundary", () => {
    const report = buildAgentHarnessReport(passingResults(), CLEAN_RELEASE_SOURCE, V3_RELEASE_RUNTIME);
    const duplicated = {
      ...report,
      results: [...report.results.slice(0, -1), report.results[0]],
    };
    expect(AgentHarnessReportSchema.safeParse(duplicated).success).toBe(false);
  });

  it("rejects a dirty or differently bound source", async () => {
    const dirty = buildAgentHarnessReport(passingResults(), DIRTY_RELEASE_SOURCE, V3_RELEASE_RUNTIME);
    expect(readAgentHarnessGate(await reportFile(dirty)).status).toBe("failed");

    const clean = buildAgentHarnessReport(passingResults(), CLEAN_RELEASE_SOURCE, V3_RELEASE_RUNTIME);
    expect(readAgentHarnessGate(await reportFile(clean), {
      expectedSource: DIRTY_RELEASE_SOURCE,
    }).status).toBe("stale");
  });
});
