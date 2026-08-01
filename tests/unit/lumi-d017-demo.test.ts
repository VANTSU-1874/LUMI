import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LUMI_D017_STORYLINE } from "@/data/demo/lumi-d017";
import { DEMO_CASES, DEMO_PROFILES } from "@/data/demo/cases";
import { AgentArtworkAttachmentSchema } from "@/lib/agent/contracts";
import { CritiqueResultSchema } from "@/lib/agent/critique-contract";
import { DesignTaskSchema } from "@/lib/agent/design-project-task-contract";
import { inspectImage } from "@/lib/security/uploads";

function expectStrictlyIncreasing(values: readonly string[]) {
  const timestamps = values.map((value) => Date.parse(value));
  expect(timestamps.every(Number.isFinite)).toBe(true);
  expect(timestamps.slice(1).every((value, index) => value > timestamps[index]!)).toBe(true);
}

function collectDataTypes(value: unknown, found: unknown[] = []) {
  if (!value || typeof value !== "object") return found;
  if ("dataType" in value) found.push((value as { dataType: unknown }).dataType);
  for (const child of Object.values(value)) collectDataTypes(child, found);
  return found;
}

describe("canonical D-017 presentation storyline", () => {
  it("binds the visible preset alias to the existing demo-student-c identity", () => {
    expect(LUMI_D017_STORYLINE.identity).toMatchObject({
      studentId: "demo-student-c",
      alias: "D-017 · 预置",
      dataType: "DEMONSTRATION_DATA",
    });
    expect(DEMO_CASES.find(({ studentId }) => studentId === "demo-student-c")?.alias).toBe("D-017 · 预置");
    expect(DEMO_PROFILES.find(({ studentId }) => studentId === "demo-student-c")?.alias).toBe("D-017 · 预置");
  });

  it("contains exactly the bounded records required by the two-session walkthrough", () => {
    expect(LUMI_D017_STORYLINE.tasks).toHaveLength(2);
    expect(LUMI_D017_STORYLINE.conversations).toHaveLength(2);
    expect(LUMI_D017_STORYLINE.turns).toHaveLength(3);
    expect(LUMI_D017_STORYLINE.artworks).toHaveLength(2);
    expect(LUMI_D017_STORYLINE.critiques).toHaveLength(2);
    expect(LUMI_D017_STORYLINE.sessionSummaries).toHaveLength(2);
    expect(LUMI_D017_STORYLINE.growthMemories).toHaveLength(3);
  });

  it("keeps static SVG previews separate from the validated private PNG seed attachments", async () => {
    for (const artwork of LUMI_D017_STORYLINE.artworks) {
      expect(artwork.previewUrl).toMatch(/^\/demo\/.+\.svg$/);
      const sourcePath = path.join(process.cwd(), artwork.seedAttachment.sourcePath);
      const source = readFileSync(sourcePath);
      expect(source.byteLength).toBe(artwork.seedAttachment.byteSize);
      expect(createHash("sha256").update(source).digest("hex")).toBe(artwork.seedAttachment.sha256);
      const inspected = await inspectImage(new Uint8Array(source), artwork.seedAttachment.mimeType);
      expect(inspected).toMatchObject({
        mime: "image/png",
        width: artwork.seedAttachment.width,
        height: artwork.seedAttachment.height,
      });
      expect(inspected.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(inspected.bytes.byteLength).toBeGreaterThan(0);
      expect(artwork.seedAttachment.privatePreviewUrl).toBe(`/api/agent/artworks/${artwork.id}`);
    }
  });

  it("conforms to public task, artwork, and five-dimension critique schemas", () => {
    for (const task of LUMI_D017_STORYLINE.tasks) {
      DesignTaskSchema.parse({
        id: task.id,
        title: task.title,
        status: task.status,
        mode: task.mode,
        pinned: task.pinned,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      });
    }
    for (const artwork of LUMI_D017_STORYLINE.artworks) {
      const sourcePath = path.join(process.cwd(), "public", artwork.previewUrl.slice(1));
      const source = readFileSync(sourcePath, "utf8");
      expect(statSync(sourcePath).size).toBe(artwork.byteSize);
      expect(source).toContain(`width="${artwork.width}" height="${artwork.height}"`);
      AgentArtworkAttachmentSchema.parse({
        id: artwork.id,
        mimeType: artwork.mimeType,
        byteSize: artwork.byteSize,
        width: artwork.width,
        height: artwork.height,
        previewUrl: artwork.previewUrl,
      });
    }
    for (const record of LUMI_D017_STORYLINE.critiques) {
      CritiqueResultSchema.parse({
        id: record.id,
        frameworkId: record.frameworkId,
        frameworkVersion: record.frameworkVersion,
        courseId: record.courseId,
        artworkId: record.artworkId,
        createdAt: record.createdAt,
        dimensions: record.dimensions,
        closure: record.closure,
      });
    }
  });

  it("keeps preset chronology increasing and binds the later closure to the earlier critique", () => {
    expectStrictlyIncreasing(LUMI_D017_STORYLINE.tasks.map(({ createdAt }) => createdAt));
    expectStrictlyIncreasing(LUMI_D017_STORYLINE.conversations.map(({ createdAt }) => createdAt));
    expectStrictlyIncreasing(LUMI_D017_STORYLINE.turns.map(({ createdAt }) => createdAt));
    expectStrictlyIncreasing(LUMI_D017_STORYLINE.artworks.map(({ createdAt }) => createdAt));
    expectStrictlyIncreasing(LUMI_D017_STORYLINE.critiques.map(({ createdAt }) => createdAt));
    expectStrictlyIncreasing(LUMI_D017_STORYLINE.sessionSummaries.map(({ createdAt }) => createdAt));
    expectStrictlyIncreasing(LUMI_D017_STORYLINE.growthMemories.map(({ createdAt }) => createdAt));

    const [earlier, later] = LUMI_D017_STORYLINE.critiques;
    expect(later.closure.historyReference?.recordId).toBe(earlier.id);
    expect(later.studentId).toBe(earlier.studentId);
    expect(later.classId).toBe(earlier.classId);
    expect(later.courseId).toBe(earlier.courseId);
    expect(later.dataType).toBe(earlier.dataType);
    expect(Date.parse(later.createdAt)).toBeGreaterThan(Date.parse(earlier.createdAt));
  });

  it("derives insight support ids and aggregate counts only from the supporting record list", () => {
    const knownCritiqueIds = new Set(LUMI_D017_STORYLINE.critiques.map(({ id }) => id));
    const knownArtworkIds = new Set<string>(LUMI_D017_STORYLINE.artworks.map(({ id }) => id));
    for (const insight of LUMI_D017_STORYLINE.classInsights) {
      expect(insight.supportingRecordIds).toEqual(insight.supportingRecords.map(({ recordId }) => recordId));
      expect(insight.evidenceCount).toBe(insight.supportingRecords.length);
      expect(insight.affectedLearners).toBe(new Set(insight.supportingRecords.map(({ learnerId }) => learnerId)).size);
      expect(insight.supportingRecords.every(({ recordId }) => knownCritiqueIds.has(recordId))).toBe(true);
      expect(insight.supportingRecords.every(({ evidenceId }) => knownArtworkIds.has(evidenceId))).toBe(true);
    }
  });

  it("marks every explicit provenance field and every fixed turn as deterministic presentation data", () => {
    const dataTypes = collectDataTypes(LUMI_D017_STORYLINE);
    expect(dataTypes).not.toHaveLength(0);
    expect(dataTypes.every((value) => value === "DEMONSTRATION_DATA")).toBe(true);
    expect(LUMI_D017_STORYLINE.turns.every(({ aiMode }) => aiMode === "DETERMINISTIC_FALLBACK")).toBe(true);
    const serialized = JSON.stringify(LUMI_D017_STORYLINE);
    expect(serialized).toContain("预置");
    expect(serialized).not.toMatch(/真实学生|教学成效|提升\d+%|通过率/);
  });
});
