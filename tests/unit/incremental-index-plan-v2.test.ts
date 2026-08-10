import { describe, expect, it } from "vitest";

import {
  attachIncrementalIndexOutputV2,
  createIncrementalIndexPlanV2,
  incrementalIndexCompatibilityHashV2,
  IncrementalIndexPlanV2Schema,
  validatePackagedIncrementalPlanV2,
  visualIncrementalReuseKeyV2,
} from "@/lib/knowledge/incremental-index-plan-v2";

const hash = (character: string) => character.repeat(64);

describe("incremental index plan V2", () => {
  it("freezes deterministic REUSE, REBUILD, and DELETE actions", () => {
    const plan = createIncrementalIndexPlanV2({
      provider: "bge-small-zh-v1-5",
      baseIndexBundleHash: hash("a"),
      targetCorpusBundleHash: hash("b"),
      compatibilityHash: hash("c"),
      baseCompatible: true,
      baseRecords: [
        { recordId: "record-a", reuseKey: hash("1"), ordinal: 0 },
        { recordId: "record-b", reuseKey: hash("2"), ordinal: 1 },
        { recordId: "record-deleted", reuseKey: hash("3"), ordinal: 2 },
      ],
      targetRecords: [
        { recordId: "record-a", reuseKey: hash("1"), ordinal: 0 },
        { recordId: "record-b", reuseKey: hash("4"), ordinal: 1 },
        { recordId: "record-new", reuseKey: hash("5"), ordinal: 2 },
      ],
    });

    expect(plan.actions).toEqual([
      {
        action: "REUSE",
        recordId: "record-a",
        reuseKey: hash("1"),
        targetOrdinal: 0,
        baseOrdinal: 0,
      },
      {
        action: "REBUILD",
        recordId: "record-b",
        reuseKey: hash("4"),
        targetOrdinal: 1,
      },
      {
        action: "REBUILD",
        recordId: "record-new",
        reuseKey: hash("5"),
        targetOrdinal: 2,
      },
      {
        action: "DELETE",
        recordId: "record-deleted",
        reuseKey: hash("3"),
        baseOrdinal: 2,
      },
    ]);
    expect(plan.summary).toEqual({
      reused: 1,
      rebuilt: 2,
      deleted: 1,
    });
  });

  it("never reuses an incompatible base and validates provider binding", () => {
    const draft = createIncrementalIndexPlanV2({
      provider: "siglip2",
      baseIndexBundleHash: hash("a"),
      targetCorpusBundleHash: hash("b"),
      compatibilityHash: incrementalIndexCompatibilityHashV2({
        modelRevision: "revision",
        regions: ["FULL_IMAGE"],
      }),
      baseCompatible: false,
      baseRecords: [
        { recordId: "asset-a", reuseKey: hash("1"), ordinal: 0 },
      ],
      targetRecords: [
        { recordId: "asset-a", reuseKey: hash("1"), ordinal: 0 },
      ],
    });
    const sealed = attachIncrementalIndexOutputV2(draft, hash("d"));

    expect(sealed.summary).toEqual({
      reused: 0,
      rebuilt: 1,
      deleted: 0,
    });
    expect(validatePackagedIncrementalPlanV2({
      plan: sealed,
      provider: "siglip2",
      corpusBundleHash: hash("b"),
      providerIndexBundleHash: hash("d"),
      currentRecords: [
        { recordId: "asset-a", reuseKey: hash("1"), ordinal: 0 },
      ],
    })).toEqual(sealed);
    expect(() => validatePackagedIncrementalPlanV2({
      plan: sealed,
      provider: "siglip2",
      corpusBundleHash: hash("b"),
      providerIndexBundleHash: hash("e"),
      currentRecords: [
        { recordId: "asset-a", reuseKey: hash("1"), ordinal: 0 },
      ],
    })).toThrow(/provider.binding.invalid/);
  });

  it("rejects forged summaries and non-contiguous target order", () => {
    expect(() => IncrementalIndexPlanV2Schema.parse({
      schemaVersion: 2,
      provider: "bge-small-zh-v1-5",
      baseIndexBundleHash: null,
      targetCorpusBundleHash: hash("a"),
      compatibilityHash: hash("b"),
      baseCompatible: false,
      outputIndexBundleHash: null,
      actions: [{
        action: "REBUILD",
        recordId: "record-a",
        reuseKey: hash("c"),
        targetOrdinal: 1,
      }],
      summary: { reused: 1, rebuilt: 0, deleted: 0 },
    })).toThrow();
  });

  it("matches the Python visual reuse key across integer and float JSON spellings", () => {
    expect(visualIncrementalReuseKeyV2({
      sourceSha256: hash("a"),
      regions: [{
        name: "FULL_IMAGE",
        bbox: {
          coordinateSpace: "NORMALIZED",
          x: 0,
          y: 0,
          width: 1,
          height: 0.3333333333333333,
        },
      }],
      config: {
        gpu: 3.5,
        nested: [0, 12],
      },
      modelRevision: "revision",
    })).toBe(
      "1ab786ff0e5feb1c68d1b0d58e6b60911ba2732a5e3ea893c8eb1bdbced61691",
    );
  });
});
