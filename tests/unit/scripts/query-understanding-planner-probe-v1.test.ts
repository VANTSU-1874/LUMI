// @vitest-environment node

import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PLANNER_REPAIR_PROBE_CASES_V1,
  PLANNER_REPAIR_PROBE_RUN_ID_V1,
  PLANNER_REPAIR_PROBE_RUN_ID_V2,
  PLANNER_REPAIR_PROBE_RUN_ID_V3,
  PLANNER_REPAIR_PROBE_RUN_ID_V4,
  PLANNER_REPAIR_PROBE_RUN_ID_V5,
  buildPlannerRepairProbeRequestV1,
  evaluatePlannerRepairProbeV1,
  parsePlannerRepairProbeArgumentsV1,
  writeNewPlannerRepairProbeArtifactV1,
  type PlannerRepairProbeCaseResultV1,
} from "@/scripts/probe-query-understanding-planner-v1";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })),
  );
});

function passingCases(): PlannerRepairProbeCaseResultV1[] {
  return PLANNER_REPAIR_PROBE_CASES_V1.map(
    (definition, index) => ({
      caseId: definition.caseId,
      coursePackId: definition.coursePackId,
      questionHash:
        buildPlannerRepairProbeRequestV1(definition)
          .currentMessage.messageHash,
      status: "READY",
      firstAttempt: "VALID",
      repairAttempt: "NOT_USED",
      callCount: 1,
      failureCategory: null,
      elapsedMs: 8_000 + index * 1_000,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      },
      bindingAudit: {
        sourceAnchor: 0,
        entity: 0,
        constraint: 0,
      },
    }),
  );
}

describe("query understanding planner runtime repair probe v1", () => {
  it("uses exactly one new label-free question for each course pack", () => {
    expect(PLANNER_REPAIR_PROBE_CASES_V1).toHaveLength(5);
    expect(new Set(
      PLANNER_REPAIR_PROBE_CASES_V1.map(
        ({ coursePackId }) => coursePackId,
      ),
    )).toEqual(new Set([
      "general-design",
      "digital-interaction",
      "book-design",
      "layout-design",
      "brand-vi-design",
    ]));
    const requests =
      PLANNER_REPAIR_PROBE_CASES_V1.map(
        buildPlannerRepairProbeRequestV1,
      );
    expect(requests.every(
      (request) =>
        request.currentMessage.message.length > 0
        && /^[0-9a-f]{64}$/.test(
          request.currentMessage.messageHash,
        )
        && request.recentTurns.length === 0
        && !request.hasArtwork,
    )).toBe(true);
  });

  it("freezes all four runtime repair gates without labels", () => {
    const report = evaluatePlannerRepairProbeV1({
      runId: PLANNER_REPAIR_PROBE_RUN_ID_V1,
      model: {
        environmentMode: "SERVICE_REQUIRED",
        source: "service-env",
        modelId: "gpt-5.6-sol",
        endpointHash: "a".repeat(64),
      },
      cases: passingCases(),
      generatedAt: "2026-07-29T00:00:00.000Z",
    });

    expect(report.decision)
      .toBe("PLANNER_RUNTIME_REPAIR_GO");
    expect(report.summary).toMatchObject({
      nonDegraded: 5,
      validAfterAtMostOneRepair: 5,
      plannerP95Ms: 12_000,
      providerCallCount: 5,
      bindingViolations: {
        sourceAnchor: 0,
        entity: 0,
        constraint: 0,
      },
    });
    expect(Object.values(report.gateResults)
      .every(Boolean)).toBe(true);
    expect(report.operations).toEqual({
      database: "NOT_USED",
      qrels: "NOT_READ",
      graphify: "NOT_USED",
      web: "NOT_USED",
      deployment: "NOT_PERFORMED",
    });
    const serialized = JSON.stringify(report);
    for (const { question } of PLANNER_REPAIR_PROBE_CASES_V1) {
      expect(serialized).not.toContain(question);
    }
  });

  it("returns NO_GO when one case degrades or exceeds the frozen budget", () => {
    const cases = passingCases();
    cases[4] = {
      ...cases[4]!,
      status: "DEGRADED",
      firstAttempt: "TIMEOUT",
      failureCategory: "TIMEOUT",
      elapsedMs: 20_001,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    };
    const report = evaluatePlannerRepairProbeV1({
      runId: PLANNER_REPAIR_PROBE_RUN_ID_V1,
      model: {
        environmentMode: "SERVICE_REQUIRED",
        source: "service-env",
        modelId: "gpt-5.6-sol",
        endpointHash: "b".repeat(64),
      },
      cases,
      generatedAt: "2026-07-29T00:00:00.000Z",
    });

    expect(report.decision)
      .toBe("PLANNER_RUNTIME_REPAIR_NO_GO");
    expect(report.gateResults).toMatchObject({
      nonDegraded: false,
      validAfterAtMostOneRepair: false,
      plannerP95: false,
    });
  });

  it("accepts only the frozen historical and current run ids", () => {
    expect(parsePlannerRepairProbeArgumentsV1([
      "--",
      "--run-id",
      "repair-v1",
    ])).toEqual({ runId: "repair-v1" });
    expect(parsePlannerRepairProbeArgumentsV1([
      "--run-id",
      "repair-v2",
    ])).toEqual({ runId: "repair-v2" });
    expect(parsePlannerRepairProbeArgumentsV1([
      "--run-id",
      "repair-v3",
    ])).toEqual({ runId: "repair-v3" });
    expect(parsePlannerRepairProbeArgumentsV1([
      "--run-id",
      "repair-v4",
    ])).toEqual({ runId: "repair-v4" });
    expect(parsePlannerRepairProbeArgumentsV1([
      "--run-id",
      "repair-v5",
    ])).toEqual({ runId: "repair-v5" });
    expect(PLANNER_REPAIR_PROBE_RUN_ID_V2)
      .toBe("repair-v2");
    expect(PLANNER_REPAIR_PROBE_RUN_ID_V3)
      .toBe("repair-v3");
    expect(PLANNER_REPAIR_PROBE_RUN_ID_V4)
      .toBe("repair-v4");
    expect(PLANNER_REPAIR_PROBE_RUN_ID_V5)
      .toBe("repair-v5");
    expect(() =>
      parsePlannerRepairProbeArgumentsV1([
        "--run-id",
        "repair-v6",
      ])).toThrow(/RUN_ID_REQUIRED/);
  });

  it("preserves repair-v3/v4 identities and binds repair-v5 to planner 1.4.0", () => {
    const historical = evaluatePlannerRepairProbeV1({
      runId: PLANNER_REPAIR_PROBE_RUN_ID_V1,
      model: {
        environmentMode: "SERVICE_REQUIRED",
        source: "service-env",
        modelId: "gpt-5.6-sol",
        endpointHash: "d".repeat(64),
      },
      cases: passingCases(),
      generatedAt: "2026-07-29T00:00:00.000Z",
    });
    const previous = evaluatePlannerRepairProbeV1({
      runId: PLANNER_REPAIR_PROBE_RUN_ID_V3,
      model: {
        environmentMode: "SERVICE_REQUIRED",
        source: "service-env",
        modelId: "GPT-5.6 Luna",
        endpointHash: "e".repeat(64),
      },
      cases: passingCases(),
      generatedAt: "2026-07-29T00:00:00.000Z",
    });
    const previousCourseContext =
      evaluatePlannerRepairProbeV1({
      runId: PLANNER_REPAIR_PROBE_RUN_ID_V4,
      model: {
        environmentMode: "SERVICE_REQUIRED",
        source: "service-env",
        modelId: "GPT-5.6 Luna",
        endpointHash: "f".repeat(64),
      },
      cases: passingCases(),
      generatedAt: "2026-07-30T00:00:00.000Z",
    });
    const current = evaluatePlannerRepairProbeV1({
      runId: PLANNER_REPAIR_PROBE_RUN_ID_V5,
      model: {
        environmentMode: "SERVICE_REQUIRED",
        source: "service-env",
        modelId: "GPT-5.6 Luna",
        endpointHash: "a".repeat(64),
      },
      cases: passingCases(),
      generatedAt: "2026-07-30T01:00:00.000Z",
    });

    expect(historical.plannerConfig.plannerVersion)
      .toBe("1.1.0");
    expect(previous.plannerConfig.plannerVersion)
      .toBe("1.2.0");
    expect(previousCourseContext.plannerConfig.plannerVersion)
      .toBe("1.3.0");
    expect(current.plannerConfig.plannerVersion)
      .toBe("1.4.0");
  });

  it("writes with wx and verifies a re-readable byte seal", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "lumi-planner-probe-"),
    );
    roots.push(root);
    const target = path.join(root, "repair-v1.json");
    const report = evaluatePlannerRepairProbeV1({
      runId: PLANNER_REPAIR_PROBE_RUN_ID_V1,
      model: {
        environmentMode: "SERVICE_REQUIRED",
        source: "service-env",
        modelId: "gpt-5.6-sol",
        endpointHash: "c".repeat(64),
      },
      cases: passingCases(),
      generatedAt: "2026-07-29T00:00:00.000Z",
    });

    const seal =
      await writeNewPlannerRepairProbeArtifactV1(
        target,
        report,
      );
    expect(seal.bytes).toBeGreaterThan(0);
    expect(seal.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(await readFile(target, "utf8")))
      .toMatchObject({
        decision: "PLANNER_RUNTIME_REPAIR_GO",
        sampleSize: 5,
      });
    await expect(
      writeNewPlannerRepairProbeArtifactV1(
        target,
        report,
      ),
    ).rejects.toMatchObject({ code: "EEXIST" });
  });
});
