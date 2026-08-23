// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  computeLegacyHermesPackageDigest,
  validateLegacyHermesHandoffV1,
} from "@/lib/domain/inspiration-wiki/legacy-hermes-handoff-v1";
import {
  decidePrivateHermesCandidateTriage,
  HermesCandidateRevisionConflictError,
  HermesTriageIdempotencyConflictError,
  persistValidatedLegacyHermesBatch,
  readPrivateHermesCandidateQueue,
} from "@/lib/services/inspiration-wiki-hermes-intake";

const roots: string[] = [];
const teacher = { userId: "teacher", role: "TEACHER" as const };
const student = { userId: "student-1", role: "STUDENT" as const };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function digest(contents: string | Buffer) {
  return createHash("sha256").update(contents).digest("hex");
}

async function writeHandoff(root: string) {
  await mkdir(path.join(root, "assets"), { recursive: true });
  const manifest = {
    schemaVersion: 1,
    contract: "lumi-hermes-inspiration-handoff",
    batchId: "hermes-test-private-001",
    producer: { name: "Hermes", version: "test-1" },
    sources: [
      { sourceId: "source-a", platform: "OTHER_PUBLIC_WEB", baseUrl: "https://example.com/", query: null, requestedCandidateCount: 1 },
      { sourceId: "source-b", platform: "BEHANCE", baseUrl: "https://www.behance.net/", query: "design", requestedCandidateCount: 1 },
    ],
    requestedCandidateCount: 2,
    screeningPolicy: {
      ruleVersion: "lumi-design-screening-v1",
      minimumTotalScore: 18,
      minimumEducationalRelevance: 3,
      minimumObservableDesignDecisions: 3,
      minimumSourceTraceability: 2,
    },
    createdAt: "2026-08-12T00:00:00.000Z",
    reviewStatus: "PENDING_REVIEW",
    importTarget: "LUMI_TEACHER_REVIEW_QUEUE",
    containsStudentData: false,
    containsCredentials: false,
  };
  const candidate = {
    schemaVersion: 1,
    batchId: manifest.batchId,
    candidateId: "hc-test-private-candidate-001",
    reviewStatus: "PENDING_REVIEW",
    source: {
      sourceId: "source-a",
      platform: "OTHER_PUBLIC_WEB",
      pageUrl: "https://example.com/work/one",
      canonicalUrl: "https://example.com/work/one",
      externalId: null,
      discoveredAt: "2026-08-12T00:01:00.000Z",
    },
    content: { title: "Test work", description: null },
    author: { displayName: "Source byline", profileUrl: null },
    license: null,
    media: [{ kind: "IMAGE", sourceUrl: "https://cdn.example.com/work-one.jpg", asset: null }],
    designCategories: ["PRINT"],
    dedupeFingerprint: "1".repeat(64),
    screening: {
      ruleVersion: "lumi-design-screening-v1",
      hardExclusions: [],
      scores: {
        educationalRelevance: 4,
        observableDesignDecisions: 4,
        executionQuality: 4,
        transferPotential: 4,
        sourceTraceability: 4,
        metadataCompleteness: 4,
      },
      totalScore: 24,
      evidence: ["Public source metadata identifies a traceable print design project."],
      decision: "INCLUDE_FOR_TEACHER_REVIEW",
    },
  };
  const files = {
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "candidates.jsonl": `${JSON.stringify(candidate)}\n`,
    "failures.jsonl": "",
    "report.md": "# Test handoff\n\nNo private credentials or student data.\n",
  };
  await Promise.all(Object.entries(files).map(([name, contents]) => writeFile(path.join(root, name), contents)));
  const inventory = await Promise.all(Object.keys(files).map(async (name) => {
    const contents = await readFile(path.join(root, name));
    return { path: name, sha256: digest(contents), bytes: contents.byteLength };
  }));
  const done = {
    schemaVersion: 1,
    batchId: manifest.batchId,
    completedAt: "2026-08-12T00:02:00.000Z",
    candidateCount: 1,
    failureCount: 0,
    files: inventory,
    packageDigest: computeLegacyHermesPackageDigest(inventory),
  };
  await writeFile(path.join(root, "DONE.json"), `${JSON.stringify(done, null, 2)}\n`);
  return { manifest, candidate, done };
}

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "lumi-hermes-s2-"));
  roots.push(root);
  const handoffRoot = path.join(root, "handoff");
  await writeHandoff(handoffRoot);
  const handoff = await validateLegacyHermesHandoffV1(handoffRoot);
  const databasePath = path.join(root, "private.sqlite");
  runMigrations(databasePath);
  const connection = createDb(databasePath);
  connection.sqlite.exec("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('teacher',NULL,'TEACHER','Test teacher',1700000000),('student-1',NULL,'STUDENT','Test student',1700000000);");
  connection.sqlite.exec("INSERT INTO teacher_access_scopes VALUES('teacher','GLOBAL',NULL,'TEST_SETUP','测试课程负责人',1700000000)");
  return { root, handoffRoot, handoff, connection };
}

describe("D-18 private Hermes candidate intake", () => {
  it("validates and persists a legacy package without inventing v2 material or touching admissions", async () => {
    const { handoff, connection } = await setup();
    try {
      const before = connection.sqlite.prepare("SELECT count(*) AS count FROM inspiration_admissions").get();
      expect(persistValidatedLegacyHermesBatch(connection, handoff, "2026-08-12T00:03:00.000Z"))
        .toEqual({ imported: true, batchId: handoff.manifest.batchId, candidates: 1 });
      expect(persistValidatedLegacyHermesBatch(connection, handoff, "2026-08-12T00:04:00.000Z"))
        .toEqual({ imported: false, batchId: handoff.manifest.batchId, candidates: 1 });
      expect(connection.sqlite.prepare(`
        SELECT contract_state AS contractState, review_state AS reviewState,
          description, license_json AS licenseJson, scope, student_visible AS studentVisible,
          wiki_draft AS wikiDraft, current_page AS currentPage, r2, embedding,
          lumi_retrieval AS lumiRetrieval
        FROM inspiration_wiki_hermes_candidates
      `).get()).toEqual({
        contractState: "V1_UPGRADE_REQUIRED",
        reviewState: "PENDING_REVIEW",
        description: null,
        licenseJson: null,
        scope: "PRIVATE_CANDIDATE",
        studentVisible: 0,
        wikiDraft: "NOT_CREATED",
        currentPage: "DISABLED",
        r2: "DISABLED",
        embedding: "DISABLED",
        lumiRetrieval: "DISABLED",
      });
      expect(connection.sqlite.prepare("SELECT count(*) AS count FROM inspiration_admissions").get()).toEqual(before);
      expect(() => connection.sqlite.prepare("UPDATE inspiration_wiki_hermes_candidates SET student_visible=1").run()).toThrow();
    } finally {
      connection.sqlite.close();
    }
  });

  it("exposes a path-free teacher queue and records revision-bound private triage", async () => {
    const { handoff, connection } = await setup();
    try {
      persistValidatedLegacyHermesBatch(connection, handoff, "2026-08-12T00:03:00.000Z");
      expect(() => readPrivateHermesCandidateQueue(connection, student, { limit: 30, offset: 0 })).toThrow();
      const queue = readPrivateHermesCandidateQueue(connection, teacher, { limit: 30, offset: 0 });
      expect(queue.meta.stateCounts.PENDING_REVIEW).toBe(1);
      expect(queue.items[0]).toMatchObject({
        revision: 1,
        contractState: "V1_UPGRADE_REQUIRED",
        reviewState: "PENDING_REVIEW",
        media: { controlledPreviewAvailable: false },
        capabilityBoundary: { studentVisible: false, currentPage: "DISABLED", lumiRetrieval: "DISABLED" },
      });
      expect(JSON.stringify(queue)).not.toContain("cdn.example.com");
      expect(JSON.stringify(queue)).not.toContain(handoff.root);

      const candidateId = queue.items[0]!.id;
      const input = {
        candidateId,
        candidateRevision: 1,
        decision: "REQUEST_NORMALIZATION" as const,
        note: "v1 lacks media role and source taxonomy",
        idempotencyKey: "triage-normalization-001",
      };
      expect(decidePrivateHermesCandidateTriage(connection, teacher, input, "2026-08-12T00:05:00.000Z"))
        .toMatchObject({ revision: 2, reviewState: "NORMALIZATION_REQUIRED", replayed: false });
      expect(decidePrivateHermesCandidateTriage(connection, teacher, input, "2026-08-12T00:06:00.000Z"))
        .toMatchObject({ revision: 2, reviewState: "NORMALIZATION_REQUIRED", replayed: true });
      expect(() => decidePrivateHermesCandidateTriage(connection, teacher, {
        ...input,
        note: "different request",
      })).toThrow(HermesTriageIdempotencyConflictError);
      expect(() => decidePrivateHermesCandidateTriage(connection, teacher, {
        ...input,
        idempotencyKey: "triage-normalization-002",
      })).toThrow(HermesCandidateRevisionConflictError);
      expect(connection.sqlite.prepare("SELECT count(*) AS count FROM inspiration_admissions").get()).toEqual({ count: 0 });
    } finally {
      connection.sqlite.close();
    }
  });

  it("rejects a tampered package before persistence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lumi-hermes-tamper-"));
    roots.push(root);
    await writeHandoff(root);
    await writeFile(path.join(root, "report.md"), "# Changed after DONE\n");
    await expect(validateLegacyHermesHandoffV1(root)).rejects.toThrow("HANDOFF_FILE_DIGEST_MISMATCH:report.md");
  });
});
