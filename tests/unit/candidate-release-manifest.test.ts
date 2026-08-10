// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildCandidateReleaseManifest,
  CANDIDATE_RELEASE_REQUIRED_FILES,
  CANDIDATE_RELEASE_SESSION_COMPATIBILITY_FILES,
  normalizeCandidateArchiveEntry,
  parseCandidateReleaseArguments,
  verifyCandidateReleaseManifest,
  type CandidateReleaseManifestInput,
} from "@/lib/operations/candidate-release-manifest";
import {
  CANDIDATE_RELEASE_SOURCE_BASELINE_COMMIT,
  PRODUCTION_SURFACE_BASELINE_RECEIPT_PATH,
  PRODUCTION_SURFACE_BASELINE_RELEASE_ID,
  type ProductionSurfaceBaselineReceipt,
} from "@/lib/operations/production-surface-baseline";

const SOURCE_COMMIT = "a".repeat(40);
const ARCHIVE_SHA = "b".repeat(64);
const ATTEMPT_ID = "t8-candidate-release-binding-v1";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function makeReceipt(): ProductionSurfaceBaselineReceipt {
  const projection = {
    schemaVersion: 1 as const,
    kind: "LUMI_PRODUCTION_SURFACE_BASELINE" as const,
    releaseId: PRODUCTION_SURFACE_BASELINE_RELEASE_ID,
    currentReleaseVerified: true as const,
    service: "active" as const,
    health: "ok" as const,
    releaseMarker: {
      bytes: 234,
      sha256: hash("release-marker"),
    },
    files: CANDIDATE_RELEASE_SESSION_COMPATIBILITY_FILES.map(
      (path, index) => ({
        path,
        bytes: index + 1,
        sha256: hash(`surface:${path}`),
      }),
    ),
    capturedAt: "2026-08-01T07:20:14.139172+00:00",
  };
  return {
    ...projection,
    receiptSha256: hash(JSON.stringify(projection)),
  };
}

function input(): CandidateReleaseManifestInput {
  const receipt = makeReceipt();
  return {
    attemptId: ATTEMPT_ID,
    sourceCommit: SOURCE_COMMIT,
    archiveSha256: ARCHIVE_SHA,
    archiveBytes: 4_096,
    archiveEntries: ["app/", ...CANDIDATE_RELEASE_REQUIRED_FILES],
    nodeVersion: "v22.23.1",
    pnpmVersion: "11.7.0",
    sourceBaselineRelationship: "ANCESTOR",
    productionSurfaceBaselineReceipt: receipt,
    candidateSourceSurfaceFiles: receipt.files,
    candidateArchiveSurfaceFiles: receipt.files,
  };
}

function build() {
  return buildCandidateReleaseManifest(input());
}

describe("candidate release manifest", () => {
  it("binds source ancestry, the production artifact receipt, archive bytes, and closed flags", () => {
    const manifest = build();
    expect(verifyCandidateReleaseManifest(manifest)).toEqual(manifest);
    expect(manifest.requiredFiles).toEqual(
      CANDIDATE_RELEASE_REQUIRED_FILES.map((path) => ({ path, present: true })),
    );
    expect(manifest.featureFlags).toEqual({
      knowledgeObjectV2: false,
      evidenceBundleV2: false,
      visualRetrieval: false,
    });
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.sourceBaseline).toEqual({
      commit: CANDIDATE_RELEASE_SOURCE_BASELINE_COMMIT,
      relationship: "ANCESTOR",
    });
    expect(manifest.productionSurfaceBaseline).toMatchObject({
      receiptPath: PRODUCTION_SURFACE_BASELINE_RECEIPT_PATH,
      receipt: {
        releaseId: PRODUCTION_SURFACE_BASELINE_RELEASE_ID,
        receiptSha256: makeReceipt().receiptSha256,
      },
    });
    expect(manifest.studentEntryAuthParity).toMatchObject({
      status: "ARTIFACT_IDENTICAL",
      files: makeReceipt().files,
    });
    expect(manifest.bindingSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed for missing required files, unsafe paths, duplicate entries, and changed source bytes", () => {
    expect(() => buildCandidateReleaseManifest({
      ...input(),
      archiveEntries: CANDIDATE_RELEASE_REQUIRED_FILES.slice(1),
    })).toThrow("CANDIDATE_RELEASE_REQUIRED_FILE_MISSING");
    expect(() => normalizeCandidateArchiveEntry("../service.env")).toThrow(
      "CANDIDATE_RELEASE_ARCHIVE_PATH_UNSAFE",
    );
    expect(() => buildCandidateReleaseManifest({
      ...input(),
      archiveEntries: [
        ...CANDIDATE_RELEASE_REQUIRED_FILES,
        CANDIDATE_RELEASE_REQUIRED_FILES[0],
      ],
    })).toThrow("CANDIDATE_RELEASE_ARCHIVE_ENTRY_DUPLICATE");
    const changed = input();
    changed.candidateSourceSurfaceFiles = changed.candidateSourceSurfaceFiles
      .map((file, index) => index === 0
        ? { ...file, bytes: file.bytes + 1 }
        : file);
    expect(() => buildCandidateReleaseManifest(changed)).toThrow(
      `CANDIDATE_RELEASE_SOURCE_SURFACE_CHANGED:${CANDIDATE_RELEASE_SESSION_COMPATIBILITY_FILES[0]}`,
    );
  });

  it("fails closed for archive-byte drift and malformed surface sets", () => {
    const archiveChanged = input();
    archiveChanged.candidateArchiveSurfaceFiles =
      archiveChanged.candidateArchiveSurfaceFiles.map((file, index) => index === 4
        ? { ...file, sha256: hash("changed archive bytes") }
        : file);
    expect(() => buildCandidateReleaseManifest(archiveChanged)).toThrow(
      `CANDIDATE_RELEASE_ARCHIVE_SURFACE_CHANGED:${CANDIDATE_RELEASE_SESSION_COMPATIBILITY_FILES[4]}`,
    );

    const reordered = input();
    reordered.candidateSourceSurfaceFiles = [
      reordered.candidateSourceSurfaceFiles[1]!,
      reordered.candidateSourceSurfaceFiles[0]!,
      ...reordered.candidateSourceSurfaceFiles.slice(2),
    ];
    expect(() => buildCandidateReleaseManifest(reordered)).toThrow(
      "CANDIDATE_RELEASE_SOURCE_SURFACE_FILE_SET_INVALID",
    );
  });

  it("rejects tampered receipt and manifest bindings", () => {
    const receiptTampered = input();
    receiptTampered.productionSurfaceBaselineReceipt = {
      ...receiptTampered.productionSurfaceBaselineReceipt,
      capturedAt: "2026-08-01T08:00:00.000000+00:00",
    };
    expect(() => buildCandidateReleaseManifest(receiptTampered)).toThrow(
      "PRODUCTION_SURFACE_BASELINE_RECEIPT_HASH_MISMATCH",
    );
    expect(() => verifyCandidateReleaseManifest({
      ...build(),
      bindingSha256: hash("changed"),
    })).toThrow("CANDIDATE_RELEASE_BINDING_HASH_MISMATCH");
    expect(() => verifyCandidateReleaseManifest({
      schemaVersion: 1,
      kind: "LUMI_CANDIDATE_RELEASE",
    })).toThrow();
  });

  it("locks the source baseline and does not accept a caller-supplied baseline", () => {
    expect(parseCandidateReleaseArguments([
      "--commit", SOURCE_COMMIT, "--attempt-id", ATTEMPT_ID,
    ])).toEqual({
      sourceCommit: SOURCE_COMMIT,
      attemptId: ATTEMPT_ID,
    });
    expect(() => parseCandidateReleaseArguments([
      "--commit", SOURCE_COMMIT, "--attempt-id", ATTEMPT_ID,
      "--baseline-commit", "c".repeat(40),
    ])).toThrow();
    expect(() => parseCandidateReleaseArguments([
      "--commit", "801f4749c6c93a085a2c5a548f5cfaa5c0ee697f",
      "--attempt-id", ATTEMPT_ID,
    ])).toThrow("CANDIDATE_RELEASE_LEGACY_COMMIT_REJECTED");
    expect(() => parseCandidateReleaseArguments([
      "--commit", "HEAD", "--attempt-id", ATTEMPT_ID,
    ])).toThrow();
    expect(() => parseCandidateReleaseArguments([
      "--commit", SOURCE_COMMIT, "--attempt-id", "r2",
    ])).toThrow();
    expect(() => parseCandidateReleaseArguments([
      "--commit", CANDIDATE_RELEASE_SOURCE_BASELINE_COMMIT,
      "--attempt-id", ATTEMPT_ID,
    ])).toThrow("CANDIDATE_RELEASE_BASELINE_EQUALS_CANDIDATE");
  });
});
