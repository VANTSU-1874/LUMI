import { afterEach, describe, expect, it } from "vitest";

import {
  resolvePostRemediationReviewerModelIdV1,
  runPostRemediationSelectorAcceptanceV1,
} from "../../../scripts/run-t45-post-remediation-selector-acceptance-v1";

const authorization =
  "LUMI_POST_COMPLETION_SELECTOR_EXTERNAL_AUTHORIZED";

afterEach(() => {
  delete process.env[authorization];
});

describe("T45 post-candidate-remediation selector CLI", () => {
  it("binds an explicit evaluation-only GPT-5.6 reviewer model id without changing service config", () => {
    expect(
      resolvePostRemediationReviewerModelIdV1(
        "GPT-5.6 Luna",
        "gpt-5.6-luna",
      ),
    ).toEqual({
      modelId: "gpt-5.6-luna",
      overridden: true,
    });
    expect(() =>
      resolvePostRemediationReviewerModelIdV1(
        "GPT-5.6 Luna",
        "other-model",
      )).toThrow(
      "POST_REMEDIATION_SELECTOR_REVIEWER_MODEL_OVERRIDE_INVALID",
    );
  });

  it("accepts v4 and requires the already-authorized external field boundary", async () => {
    await expect(
      runPostRemediationSelectorAcceptanceV1([
        "--stage",
        "collect",
        "--run-id",
        "post-remediation-v4",
        "--device",
        "cpu",
      ]),
    ).rejects.toThrow(
      "POST_REMEDIATION_SELECTOR_MODEL_AUTHORIZATION_REQUIRED",
    );
  });

  it("still rejects unregistered future run ids before model work", async () => {
    await expect(
      runPostRemediationSelectorAcceptanceV1([
        "--stage",
        "collect",
        "--run-id",
        "post-remediation-v5",
        "--device",
        "cpu",
      ]),
    ).rejects.toThrow(
      "POST_REMEDIATION_SELECTOR_ARGUMENTS_INVALID",
    );
  });

  it("allows only v4 to enter the explicitly authorized recovery stage", async () => {
    await expect(
      runPostRemediationSelectorAcceptanceV1([
        "--stage",
        "review-recovery",
        "--run-id",
        "post-remediation-v4",
      ]),
    ).rejects.toThrow(
      "POST_REMEDIATION_SELECTOR_MODEL_AUTHORIZATION_REQUIRED",
    );

    await expect(
      runPostRemediationSelectorAcceptanceV1([
        "--stage",
        "review-recovery",
        "--run-id",
        "post-remediation-v3",
      ]),
    ).rejects.toThrow(
      "POST_REMEDIATION_SELECTOR_ARGUMENTS_INVALID",
    );
  });
});
