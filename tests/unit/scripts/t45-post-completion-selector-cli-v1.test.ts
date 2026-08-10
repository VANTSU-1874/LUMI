import { afterEach, describe, expect, it } from "vitest";

import {
  runPostRemediationSelectorAcceptanceV1,
} from "../../../scripts/run-t45-post-remediation-selector-acceptance-v1";

const completionAuthorization =
  "LUMI_POST_COMPLETION_SELECTOR_EXTERNAL_AUTHORIZED";
const remediationAuthorization =
  "LUMI_POST_REMEDIATION_SELECTOR_EXTERNAL_AUTHORIZED";

afterEach(() => {
  delete process.env[completionAuthorization];
  delete process.env[remediationAuthorization];
});

describe("T45 post-completion selector CLI", () => {
  it("accepts the new sealed run id and enforces its own authorization", async () => {
    await expect(
      runPostRemediationSelectorAcceptanceV1([
        "--stage",
        "collect",
        "--run-id",
        "post-remediation-v3",
        "--device",
        "cpu",
      ]),
    ).rejects.toThrow(
      "POST_REMEDIATION_SELECTOR_MODEL_AUTHORIZATION_REQUIRED",
    );
  });

  it("keeps the historical v2 argument contract available", async () => {
    await expect(
      runPostRemediationSelectorAcceptanceV1([
        "--stage",
        "collect",
        "--run-id",
        "post-remediation-v2",
        "--device",
        "cpu",
      ]),
    ).rejects.toThrow(
      "POST_REMEDIATION_SELECTOR_MODEL_AUTHORIZATION_REQUIRED",
    );
  });

  it("rejects an unregistered run id before any model or artifact work", async () => {
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
});
