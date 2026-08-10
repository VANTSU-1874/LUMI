import { describe, expect, it, vi } from "vitest";

import {
  classifyKnowledgeV2OperatingMode,
  prepareAgentEvidenceRuntimeV2,
  resolveKnowledgeV2Enablement,
} from "@/lib/knowledge/knowledge-v2-enablement";

describe("Knowledge V2 controlled enablement", () => {
  it.each([
    [[false, false, false], "LEGACY_ONLY"],
    [[true, false, false], "CONTROL_PRESET"],
    [[true, true, false], "CONTROL_PRESET"],
    [[true, false, true], "AGENT_EVIDENCE_TEXT"],
    [[true, true, true], "AGENT_EVIDENCE_VISUAL"],
  ] as const)(
    "classifies raw=%j as %s",
    (raw, expected) => {
      expect(classifyKnowledgeV2OperatingMode({
        knowledgeObjectV2: raw[0],
        visualRetrieval: raw[1],
        evidenceBundleV2: raw[2],
      })).toBe(expected);
    },
  );

  it.each([
    {
      raw: [false, false, false],
      effective: [false, false, false],
      reasons: ["DISABLED", "DISABLED", "DISABLED"],
    },
    {
      raw: [false, false, true],
      effective: [false, false, false],
      reasons: ["DISABLED", "DISABLED", "DEPENDENCY_DISABLED"],
    },
    {
      raw: [false, true, false],
      effective: [false, false, false],
      reasons: ["DISABLED", "DEPENDENCY_DISABLED", "DISABLED"],
    },
    {
      raw: [false, true, true],
      effective: [false, false, false],
      reasons: ["DISABLED", "DEPENDENCY_DISABLED", "DEPENDENCY_DISABLED"],
    },
    {
      raw: [true, false, false],
      effective: [true, false, false],
      reasons: ["ENABLED", "DISABLED", "DISABLED"],
    },
    {
      raw: [true, false, true],
      effective: [true, false, true],
      reasons: ["ENABLED", "DISABLED", "ENABLED"],
    },
    {
      raw: [true, true, false],
      effective: [true, true, false],
      reasons: ["ENABLED", "ENABLED", "DISABLED"],
    },
    {
      raw: [true, true, true],
      effective: [true, true, true],
      reasons: ["ENABLED", "ENABLED", "ENABLED"],
    },
  ] as const)(
    "resolves raw=$raw without weakening the master rollback",
    ({ raw, effective, reasons }) => {
      const resolved = resolveKnowledgeV2Enablement({
        knowledgeObjectV2: raw[0],
        visualRetrieval: raw[1],
        evidenceBundleV2: raw[2],
      });

      expect(Object.values(resolved.effective))
        .toEqual(effective);
      expect(Object.values(resolved.reasons))
        .toEqual(reasons);
    },
  );

  it("does not load a runtime when the master flag disables requested dependencies", async () => {
    const load = vi.fn();
    const resolved =
      await prepareAgentEvidenceRuntimeV2({
        knowledgeObjectV2Enabled: false,
        visualRetrievalEnabled: true,
        evidenceBundleV2Enabled: true,
      }, load);

    expect(resolved.status)
      .toBe("KNOWLEDGE_OBJECT_DISABLED");
    expect(load).not.toHaveBeenCalled();
  });

  it("treats the master-only state as CONTROL_PRESET without loading a shadow runtime", async () => {
    const load = vi.fn();
    const flags = {
      knowledgeObjectV2: true,
      visualRetrieval: false,
      evidenceBundleV2: false,
    };

    expect(classifyKnowledgeV2OperatingMode(flags))
      .toBe("CONTROL_PRESET");
    const resolved =
      await prepareAgentEvidenceRuntimeV2({
        knowledgeObjectV2Enabled:
          flags.knowledgeObjectV2,
        visualRetrievalEnabled:
          flags.visualRetrieval,
        evidenceBundleV2Enabled:
          flags.evidenceBundleV2,
      }, load);

    expect(resolved.status)
      .toBe("EVIDENCE_BUNDLE_DISABLED");
    expect(resolved.port).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("loads the active text-only runtime when visual retrieval is disabled", async () => {
    const port = { search: vi.fn() };
    const load = vi.fn(async () => port);
    const resolved =
      await prepareAgentEvidenceRuntimeV2({
        knowledgeObjectV2Enabled: true,
        visualRetrievalEnabled: false,
        evidenceBundleV2Enabled: true,
      }, load);

    expect(resolved).toMatchObject({
      status: "READY",
      port,
      error: null,
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it("returns an injected port only when all effective gates are open", async () => {
    const port = { search: vi.fn() };
    const load = vi.fn();
    const resolved =
      await prepareAgentEvidenceRuntimeV2({
        knowledgeObjectV2Enabled: true,
        visualRetrievalEnabled: true,
        evidenceBundleV2Enabled: true,
        evidenceSearchV2: port,
      }, load);

    expect(resolved).toMatchObject({
      status: "READY",
      port,
      error: null,
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("contains runtime initialization failure and leaves the caller a legacy fallback", async () => {
    const failure = new Error("fixed snapshot missing");
    const resolved =
      await prepareAgentEvidenceRuntimeV2({
        knowledgeObjectV2Enabled: true,
        visualRetrievalEnabled: true,
        evidenceBundleV2Enabled: true,
      }, async () => {
        throw failure;
      });

    expect(resolved).toMatchObject({
      status: "RUNTIME_UNAVAILABLE",
      port: null,
      error: failure,
    });
  });
});
