// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as triagePost } from "@/app/api/teacher/inspiration-wiki/candidates/[candidateId]/triage/route";
import { GET as queueGet } from "@/app/api/teacher/inspiration-wiki/candidates/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const SECRET = "hermes-private-route-secret-at-least-32-characters";
const CANDIDATE_ID = `hermes-candidate:${"1".repeat(32)}`;
const cookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;

describe("D-18 teacher-only Hermes candidate routes", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "lumi-hermes-routes-"));
    databasePath = path.join(directory, "private.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('teacher',NULL,'TEACHER','Test teacher',1700000000),('student-1',NULL,'STUDENT','Test student',1700000000);");
      connection.sqlite.prepare(`
        INSERT INTO inspiration_wiki_hermes_batches(
          batch_id, contract_version, package_digest, manifest_json, done_json,
          candidate_count, failure_count, intake_state, student_visible,
          current_page, r2, embedding, lumi_retrieval, imported_at
        ) VALUES('hermes-test-route-001','LEGACY_V1',?,'{}','{}',1,0,
          'VALIDATED_PRIVATE',0,'DISABLED','DISABLED','DISABLED','DISABLED',1700000000)
      `).run("a".repeat(64));
      connection.sqlite.prepare(`
        INSERT INTO inspiration_wiki_hermes_candidates(
          id, batch_id, source_candidate_id, revision, contract_state, review_state,
          source_id, source_platform, page_url, canonical_url, title, description,
          author_json, license_json, media_json, design_categories_json, screening_json,
          raw_candidate_json, raw_digest, dedupe_fingerprint, scope, student_visible,
          wiki_draft, current_page, r2, embedding, lumi_retrieval, created_at, updated_at
        ) VALUES(?, 'hermes-test-route-001', 'hc-test-route-candidate-001', 1,
          'V1_UPGRADE_REQUIRED', 'PENDING_REVIEW', 'source-a', 'OTHER_PUBLIC_WEB',
          'https://example.com/work', 'https://example.com/work', 'Route fixture', NULL,
          NULL, NULL, '[{"kind":"IMAGE","asset":null}]', '["PRINT"]',
          '{"totalScore":24,"evidence":["Public source evidence"]}', '{}', ?, ?,
          'PRIVATE_CANDIDATE', 0, 'NOT_CREATED', 'DISABLED', 'DISABLED', 'DISABLED',
          'DISABLED', 1700000000, 1700000000)
      `).run(CANDIDATE_ID, "b".repeat(64), "c".repeat(64));
    } finally {
      connection.sqlite.close();
    }
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("fails closed for unauthenticated and student requests", async () => {
    expect((await queueGet(new NextRequest("http://localhost/api/teacher/inspiration-wiki/candidates"))).status).toBe(401);
    const studentToken = await issueSession({ userId: "student-1", role: "STUDENT" }, SECRET);
    expect((await queueGet(new NextRequest("http://localhost/api/teacher/inspiration-wiki/candidates", {
      headers: { cookie: cookie(studentToken) },
    }))).status).toBe(403);
    const response = await triagePost(new NextRequest(`http://localhost/api/teacher/inspiration-wiki/candidates/${CANDIDATE_ID}/triage`, {
      method: "POST",
      headers: { cookie: cookie(studentToken), "content-type": "application/json" },
      body: JSON.stringify({ candidateRevision: 1, decision: "HOLD_RIGHTS", note: "", idempotencyKey: "student-forbidden-001" }),
    }), { params: Promise.resolve({ candidateId: CANDIDATE_ID }) });
    expect(response.status).toBe(403);
  });

  it("returns only the private projection and saves revision-bound triage", async () => {
    const teacherToken = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    const queue = await queueGet(new NextRequest("http://localhost/api/teacher/inspiration-wiki/candidates", {
      headers: { cookie: cookie(teacherToken) },
    }));
    expect(queue.status).toBe(200);
    expect(queue.headers.get("cache-control")).toBe("private, no-store");
    const payload = await queue.json();
    expect(payload).toMatchObject({
      items: [expect.objectContaining({
        id: CANDIDATE_ID,
        contractState: "V1_UPGRADE_REQUIRED",
        capabilityBoundary: expect.objectContaining({ studentVisible: false, currentPage: "DISABLED", lumiRetrieval: "DISABLED" }),
      })],
      meta: {
        total: 1,
        readiness: {
          teacherReviewReady: 0,
          controlledPreviewReady: 0,
          rightsEvidenceReady: 0,
          descriptionsReady: 0,
          v2Normalized: 0,
          blocked: { rights: 1, preview: 1, description: 1, normalization: 1 },
        },
        sources: [{
          sourceId: "source-a",
          total: 1,
          rightsEvidenceReady: 0,
          descriptionsReady: 0,
          controlledPreviewReady: 0,
        }],
      },
    });
    expect(JSON.stringify(payload)).not.toContain("rawCandidateJson");
    expect(JSON.stringify(payload)).not.toContain("sourceUrl");

    const request = (revision: number, key: string) => new NextRequest(`http://localhost/api/teacher/inspiration-wiki/candidates/${CANDIDATE_ID}/triage`, {
      method: "POST",
      headers: { cookie: cookie(teacherToken), "content-type": "application/json" },
      body: JSON.stringify({ candidateRevision: revision, decision: "HOLD_RIGHTS", note: "rights unknown", idempotencyKey: key }),
    });
    const decided = await triagePost(request(1, "teacher-rights-hold-001"), { params: Promise.resolve({ candidateId: CANDIDATE_ID }) });
    expect(decided.status).toBe(201);
    expect(await decided.json()).toMatchObject({ revision: 2, reviewState: "RIGHTS_HOLD", replayed: false });
    const stale = await triagePost(request(1, "teacher-rights-hold-002"), { params: Promise.resolve({ candidateId: CANDIDATE_ID }) });
    expect(stale.status).toBe(409);

    const connection = createDb(databasePath);
    try {
      expect(connection.sqlite.prepare("SELECT count(*) AS count FROM inspiration_admissions").get()).toEqual({ count: 0 });
      expect(connection.sqlite.prepare("SELECT student_visible AS studentVisible, current_page AS currentPage, lumi_retrieval AS lumiRetrieval FROM inspiration_wiki_hermes_candidates").get())
        .toEqual({ studentVisible: 0, currentPage: "DISABLED", lumiRetrieval: "DISABLED" });
    } finally {
      connection.sqlite.close();
    }
  });
});
