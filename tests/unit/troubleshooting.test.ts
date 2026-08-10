import { describe, expect, it } from "vitest";

import {
  TroubleshootingStateSchema,
  TroubleshootingRunSnapshotSchema,
  nextTroubleshootingStep,
  recordTroubleshootingRound,
} from "@/lib/services/troubleshooting";

describe("signal-chain troubleshooting", () => {
  it("shares one parser for persisted state and its layer/status columns", () => {
    expect(() => TroubleshootingRunSnapshotSchema.parse({
      currentLayer: "INPUT",
      status: "ACTIVE",
      stateJson: { currentLayer: "OUTPUT", status: "ACTIVE" },
    })).toThrow();
    const parsed = TroubleshootingRunSnapshotSchema.parse({
      currentLayer: "INPUT",
      status: "ACTIVE",
      stateJson: { current_layer: "INPUT", status: "ACTIVE" },
    });
    expect(parsed.stateJson).toMatchObject({ currentLayer: "INPUT", status: "ACTIVE" });
  });

  it("always starts at INPUT and cannot be jumped by later evidence", () => {
    expect(nextTroubleshootingStep({ evidence: [] }).layer).toBe("INPUT");
    expect(nextTroubleshootingStep({ evidence: ["MAPPING_OK", "OUTPUT_OK"] }).layer).toBe(
      "INPUT",
    );
  });

  it("moves in the fixed INPUT to OUTPUT order", () => {
    expect(nextTroubleshootingStep({ evidence: ["INPUT_OK"] }).layer).toBe("MAPPING");
    expect(
      nextTroubleshootingStep({ evidence: ["INPUT_OK", "MAPPING_OK"] }).layer,
    ).toBe("TRANSPORT");
    expect(
      nextTroubleshootingStep({
        evidence: ["INPUT_OK", "MAPPING_OK", "TRANSPORT_OK"],
      }).layer,
    ).toBe("BINDING");
  });

  it("returns only one next action and separates facts from hypotheses", () => {
    const result = nextTroubleshootingStep({ evidence: ["INPUT_OK"] });
    expect(result.nextActions).toHaveLength(1);
    expect(result.confirmedFacts).toEqual(["输入层已有服务端确认证据"]);
    expect(result.unconfirmedHypotheses[0]).toContain("映射");
    expect(Object.keys(result).sort()).toEqual([
      "confirmedFacts",
      "layer",
      "nextActions",
      "status",
      "unconfirmedHypotheses",
    ]);
  });

  it("escalates after three rounds without a new record id and digest", () => {
    let state = TroubleshootingStateSchema.parse({});
    state = recordTroubleshootingRound(state, null);
    state = recordTroubleshootingRound(state, null);
    state = recordTroubleshootingRound(state, null);
    expect(state.status).toBe("ESCALATED");
    expect(state.nextActions).toEqual(["请求教师查看当前层证据"]);
  });

  it("does not count a replayed record or duplicate digest as new evidence", () => {
    const first = recordTroubleshootingRound(TroubleshootingStateSchema.parse({}), {
      recordId: "00000000-0000-4000-8000-000000000001",
      digest: "a".repeat(64),
      code: "INPUT_OK",
    });
    const replayId = recordTroubleshootingRound(first, {
      recordId: "00000000-0000-4000-8000-000000000001",
      digest: "b".repeat(64),
      code: "INPUT_OK",
    });
    const replayDigest = recordTroubleshootingRound(replayId, {
      recordId: "00000000-0000-4000-8000-000000000002",
      digest: "a".repeat(64),
      code: "INPUT_OK",
    });
    expect(replayDigest.noNewEvidenceRounds).toBe(2);
    expect(replayDigest.confirmedCodes).toEqual(["INPUT_OK"]);
  });
});
