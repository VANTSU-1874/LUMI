// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CourseEvidenceFixtureFileV1Schema,
  CourseEvidenceFixtureManifestV1Schema,
  CourseEvidenceV1Schema,
} from "@/lib/knowledge/course-evidence-contract-v1";

const fixtureRoot = path.resolve(
  "tests/fixtures/agent-runtime-harness/evidence-channel/course-v1",
);

async function loadSealedFixture() {
  const manifest = CourseEvidenceFixtureManifestV1Schema.parse(JSON.parse(
    await readFile(path.join(fixtureRoot, "manifest.json"), "utf8"),
  ));
  const entry = manifest.files.find(({ path: file }) => file === "course-evidence-v1.json");
  if (!entry) throw new Error("SEALED_COURSE_EVIDENCE_FILE_MISSING");
  const bytes = await readFile(path.join(fixtureRoot, entry.path));
  expect(bytes.byteLength).toBe(entry.bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
  return {
    manifest,
    raw: JSON.parse(bytes.toString("utf8")) as unknown,
    fixture: CourseEvidenceFixtureFileV1Schema.parse(
      JSON.parse(bytes.toString("utf8")),
    ),
  };
}

describe("sealed CourseEvidence handoff fixtures", () => {
  it("verifies the manifest seal and four required text-baseline cases", async () => {
    const { manifest, fixture } = await loadSealedFixture();
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      fixtureStatus: "FIXTURE_CONTRACT_READY",
    });
    expect(fixture.cases.map(({ caseKind }) => caseKind)).toEqual([
      "HIT",
      "NO_ANSWER",
      "SIMILAR_DISTRACTOR",
      "SOURCE_TRACE",
    ]);
    expect(new Set(fixture.cases.map(({ caseId }) => caseId)).size).toBe(4);
  });

  it("keeps unavailable optional visual infrastructure independent from text baseline", async () => {
    const { fixture } = await loadSealedFixture();
    for (const evidence of fixture.cases) {
      expect(evidence.availability).toBe("AVAILABLE");
      expect(evidence.optionalDependencies).toHaveLength(3);
      expect(evidence.optionalDependencies.every(
        ({ availability }) => availability === "UNAVAILABLE",
      )).toBe(true);
    }
    const empty = fixture.cases.find(({ caseKind }) => caseKind === "NO_ANSWER")!;
    expect(empty).toMatchObject({
      degradedReason: "EMPTY_RESULT",
      candidateCount: 0,
      candidates: [],
      selectedEvidenceIds: [],
    });
  });

  it("binds stable evidence/object/source identities and rejects the similar distractor", async () => {
    const { fixture } = await loadSealedFixture();
    const distractor = fixture.cases.find(
      ({ caseKind }) => caseKind === "SIMILAR_DISTRACTOR",
    )!;
    expect(distractor.candidates.map(({ disposition }) => disposition)).toEqual([
      "SELECTED",
      "REJECTED_SIMILAR",
    ]);
    expect(distractor.selectedEvidenceIds).toEqual([
      "evidence-information-hierarchy-primary",
    ]);

    const sourceTrace = fixture.cases.find(({ caseKind }) => caseKind === "SOURCE_TRACE")!;
    expect(sourceTrace.candidates[0]).toMatchObject({
      evidenceId: "evidence-touchdesigner-source-trace",
      objectId: "object-touchdesigner-official-reference",
      source: {
        sourceId: "source-touchdesigner-official-reference",
        authority: "OFFICIAL",
        rights: "PUBLIC_REFERENCE",
        status: "ACTIVE",
      },
    });
  });

  it("rejects student images, raw attachments, prompts, queries and signed URLs from trace", async () => {
    const { raw, fixture } = await loadSealedFixture();
    const serialized = JSON.stringify(raw);
    expect(serialized).not.toMatch(
      /studentImage|imageBytes|rawAttachment|attachmentBytes|signedUrl|apiKey|prompt|queryText|chainOfThought|localPath/i,
    );

    const base = fixture.cases[0]!;
    for (const forbidden of [
      { studentImage: { bytes: "data:image/png;base64,AAAA" } },
      { rawAttachment: { content: "private" } },
      { prompt: "full prompt" },
      { queryText: "student question" },
      { signedUrl: "https://example.test/private?signature=secret" },
    ]) {
      expect(CourseEvidenceV1Schema.safeParse({ ...base, ...forbidden }).success)
        .toBe(false);
    }
    expect(CourseEvidenceV1Schema.safeParse({
      ...base,
      candidates: [{ ...base.candidates[0]!, rawAttachment: "private" }],
    }).success).toBe(false);
  });

  it("fails closed on route, count, selection or source-governance drift", async () => {
    const { fixture } = await loadSealedFixture();
    const base = fixture.cases[0]!;
    expect(CourseEvidenceV1Schema.safeParse({
      ...base,
      namespaceId: "student-private-library",
    }).success).toBe(false);
    expect(CourseEvidenceV1Schema.safeParse({
      ...base,
      candidateCount: 2,
    }).success).toBe(false);
    expect(CourseEvidenceV1Schema.safeParse({
      ...base,
      selectedEvidenceIds: [],
    }).success).toBe(false);
    expect(CourseEvidenceV1Schema.safeParse({
      ...base,
      candidates: [{
        ...base.candidates[0]!,
        source: { ...base.candidates[0]!.source, status: "WITHDRAWN" },
      }],
    }).success).toBe(false);
  });
});
