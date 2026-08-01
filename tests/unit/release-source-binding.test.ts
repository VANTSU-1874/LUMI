// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ALLOWED_UNTRACKED_TUTOR_PLAN,
  buildReleaseSourceBinding,
  ReleaseInferenceConfigSchema,
  sameReleaseInferenceConfig,
  sameReleaseSourceBinding,
} from "@/lib/agent/release-source-binding";

const COMMIT = "a".repeat(40);

describe("release source binding", () => {
  it("treats an empty status or only the untracked tutor plan as release clean", () => {
    const empty = buildReleaseSourceBinding(COMMIT, "");
    expect(empty).toEqual({
      sourceCommit: COMMIT,
      sourceStatusHash: createHash("sha256").update("", "utf8").digest("hex"),
      sourceTrackedTreeClean: true,
    });

    const planOnly = buildReleaseSourceBinding(COMMIT, `${ALLOWED_UNTRACKED_TUTOR_PLAN}\r\n`);
    expect(planOnly.sourceTrackedTreeClean).toBe(true);
    expect(planOnly.sourceStatusHash).toBe(
      createHash("sha256").update(ALLOWED_UNTRACKED_TUTOR_PLAN, "utf8").digest("hex"),
    );
  });

  it("marks every other tracked or untracked change dirty and compares the whole binding", () => {
    const dirty = buildReleaseSourceBinding(
      COMMIT,
      `${ALLOWED_UNTRACKED_TUTOR_PLAN}\n M lib/agent/evaluation.ts\n`,
    );
    expect(dirty.sourceTrackedTreeClean).toBe(false);
    expect(sameReleaseSourceBinding(dirty, { ...dirty })).toBe(true);
    expect(sameReleaseSourceBinding(dirty, {
      ...dirty,
      sourceStatusHash: "d".repeat(64),
    })).toBe(false);

    const modifiedOnly = buildReleaseSourceBinding(COMMIT, " M package.json\r\n");
    expect(modifiedOnly.sourceStatusHash).toBe(
      createHash("sha256").update(" M package.json", "utf8").digest("hex"),
    );
  });

  it("rejects a non-commit source identity", () => {
    expect(() => buildReleaseSourceBinding("HEAD", "")).toThrow();
  });

  it("binds live inference to explicit model idle and total timeouts", () => {
    const live = {
      providerMode: "OPENAI_COMPATIBLE" as const,
      modelId: "gpt-5.6",
      endpointHash: "b".repeat(64),
      retrievalModelId: null,
      maxOutputTokens: 2048,
      modelIdleTimeoutMs: 120_000,
      modelTotalTimeoutMs: 600_000,
      turnTotalTimeoutMs: 900_000,
      vision: true,
    };
    expect(ReleaseInferenceConfigSchema.parse(live)).toEqual(live);
    expect(ReleaseInferenceConfigSchema.safeParse({ ...live, modelIdleTimeoutMs: null }).success)
      .toBe(false);
    expect(ReleaseInferenceConfigSchema.safeParse({ ...live, modelTotalTimeoutMs: null }).success)
      .toBe(false);
    expect(ReleaseInferenceConfigSchema.safeParse({ ...live, turnTotalTimeoutMs: null }).success)
      .toBe(false);
    expect(ReleaseInferenceConfigSchema.safeParse({ ...live, turnTotalTimeoutMs: 600_000 }).success)
      .toBe(false);
    expect(ReleaseInferenceConfigSchema.safeParse({ ...live, modelIdleTimeoutMs: 600_000 }).success)
      .toBe(false);
    expect(sameReleaseInferenceConfig(live, { ...live, modelIdleTimeoutMs: 90_000 }))
      .toBe(false);
    expect(sameReleaseInferenceConfig(live, { ...live, modelTotalTimeoutMs: 540_000 }))
      .toBe(false);
    expect(sameReleaseInferenceConfig(live, { ...live, turnTotalTimeoutMs: 840_000 }))
      .toBe(false);
  });

  it("keeps deterministic and test-only timeout fingerprints nullable", () => {
    const modelFree = {
      modelId: "fixture",
      endpointHash: "c".repeat(64),
      retrievalModelId: null,
      maxOutputTokens: null,
      modelIdleTimeoutMs: null,
      modelTotalTimeoutMs: null,
      turnTotalTimeoutMs: null,
      vision: false,
    };
    expect(ReleaseInferenceConfigSchema.safeParse({
      ...modelFree,
      providerMode: "DETERMINISTIC",
    }).success).toBe(true);
    expect(ReleaseInferenceConfigSchema.safeParse({
      ...modelFree,
      providerMode: "TEST",
    }).success).toBe(true);
  });
});
