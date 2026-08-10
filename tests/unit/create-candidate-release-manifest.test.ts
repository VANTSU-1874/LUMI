// @vitest-environment node

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createCandidateReleaseManifest,
  readGitExportedFile,
} from "@/scripts/create-candidate-release-manifest";
import {
  fingerprintProductionSurfaceFile,
  PRODUCTION_SURFACE_BASELINE_RECEIPT_PATH,
  verifyProductionSurfaceBaselineReceipt,
} from "@/lib/operations/production-surface-baseline";

const PRE_REMEDIATION_CANDIDATE_COMMIT =
  "bd8fa24c63dbcc9e5bd48e13b5331cc3a3d249da";

describe("create candidate release manifest", () => {
  it("compares the commit's exported bytes rather than its raw blob bytes", async () => {
    const receipt = verifyProductionSurfaceBaselineReceipt(JSON.parse(
      await readFile(
        path.join(process.cwd(), PRODUCTION_SURFACE_BASELINE_RECEIPT_PATH),
        "utf8",
      ),
    ));
    const filePath = "app/layout.tsx";
    const expected = receipt.files.find((file) => file.path === filePath);
    const exported = await readGitExportedFile(
      PRE_REMEDIATION_CANDIDATE_COMMIT,
      filePath,
      process.cwd(),
    );

    expect(fingerprintProductionSurfaceFile(filePath, exported)).toEqual(expected);
  });

  it("does not create an official attempt when source parity fails in read-only preflight", async () => {
    const attemptId = "t8-candidate-preflight-no-write-v1";
    const attemptRoot = path.resolve(
      process.cwd(),
      ".runtime",
      "candidate-release",
      attemptId,
    );

    await expect(createCandidateReleaseManifest({
      sourceCommit: PRE_REMEDIATION_CANDIDATE_COMMIT,
      attemptId,
    })).rejects.toThrow("CANDIDATE_RELEASE_SOURCE_SURFACE_CHANGED");
    await expect(stat(attemptRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
