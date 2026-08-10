import { describe, expect, it } from "vitest";

import {
  parseT44ContentReviewerAuditArguments,
} from "@/scripts/audit-t44-content-reviewer-v1";
import {
  parseT44ContentReviewerRunArguments,
} from "@/scripts/run-t44-content-reviewer-v1";

describe("T4.4 content reviewer CLI contracts", () => {
  it("requires distinct, scope-compatible draft and output ids", () => {
    expect(parseT44ContentReviewerRunArguments([
      "--",
      "--run-id",
      "legacy-v2",
      "--draft-artifact-id",
      "pilot-v3",
      "--artifact-id",
      "pilot-v4",
    ])).toEqual({
      runId: "legacy-v2",
      draftArtifactId: "pilot-v3",
      artifactId: "pilot-v4",
      scope: "PILOT",
    });
    expect(() =>
      parseT44ContentReviewerRunArguments([
        "--run-id",
        "legacy-v2",
        "--draft-artifact-id",
        "pilot-v3",
        "--artifact-id",
        "pilot-v3",
      ]),
    ).toThrow(
      "T44_CONTENT_REVIEWER_ARTIFACT_IDS_INVALID",
    );
    expect(() =>
      parseT44ContentReviewerRunArguments([
        "--run-id",
        "legacy-v2",
        "--draft-artifact-id",
        "pilot-v3",
        "--artifact-id",
        "full-v4",
      ]),
    ).toThrow(
      "T44_CONTENT_REVIEWER_ARTIFACT_SCOPE_MISMATCH",
    );
  });

  it("parses the sealed reviewer artifact identity for audit", () => {
    expect(parseT44ContentReviewerAuditArguments([
      "--",
      "--run-id",
      "legacy-v2",
      "--artifact-id",
      "pilot-v4",
    ])).toEqual({
      runId: "legacy-v2",
      artifactId: "pilot-v4",
    });
    expect(() =>
      parseT44ContentReviewerAuditArguments([
        "--run-id",
        "legacy-v2",
        "--scope",
        "pilot",
        "--artifact-id",
        "pilot-v4",
      ]),
    ).toThrow(
      "T44_CONTENT_REVIEWER_AUDIT_ARGUMENT_INVALID",
    );
  });
});
