// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as browseGet } from "@/app/api/inspiration/browse/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { advanceAutomatedInspirationCandidate, decideInspirationCandidate, ingestPrivateInspirationCandidate, registerInspirationSource } from "@/lib/services/inspiration-review-pipeline";
import { privateCandidateAnalysis, teacherReviewPackage } from "@/tests/fixtures/inspiration-case-intake";
import { formalStudentPublicationFixture, reviewPipelineSourceFixture } from "@/tests/fixtures/inspiration-review-pipeline";
import { privateCandidateIntake } from "@/tests/fixtures/inspiration-case-intake";
import { p2StudentChannelShadowFixture } from "@/tests/fixtures/inspiration-p2-shadow";
import { persistP2StudentChannelShadowSnapshot } from "@/lib/services/inspiration-wiki-p2-student-channels";

const SECRET = "inspiration-browser-route-secret-at-least-32-chars";
const cookie = (token: string) => `${SESSION_COOKIE_NAME}=${token}`;

function fixture(id: string, title: string, display = true, hashCharacter = "a", sourceUrl = "https://example.org/source", sourceDisplay = "合规来源") {
  const candidate = privateCandidateIntake({
    id,
    asset: { mode: "PRIVATE_COPY", privateAssetRef: `private-candidate://fixture/${hashCharacter}.webp`, contentHash: `sha256:${hashCharacter.repeat(64)}` },
    curation: { ...privateCandidateIntake().curation, title, description: "书籍设计与版式参考", curationSourceUrl: sourceUrl, originalSourceDisplay: sourceDisplay, originalSourceUrl: sourceUrl, observedAt: "2026-08-09T00:00:00.000Z" },
    withdrawal: { status: "READY", complaintLocator: null },
    rights: { ...privateCandidateIntake().rights, decisions: { ...privateCandidateIntake().rights.decisions, STUDENT_DISPLAY: display ? "ALLOW" : "UNKNOWN" } },
  });
  const analysis = privateCandidateAnalysis({ candidateId: id, courseAssociations: [{ coursePackId: "book-design", facets: ["书籍设计", "版式"], rationale: "测试关联", confidence: 0.9, status: "PROPOSED" }] });
  const reviewPackage = teacherReviewPackage({ candidateId: id, source: { curationSourceUrl: sourceUrl, originalSourceDisplay: sourceDisplay, originalSourceUrl: sourceUrl, attributionStatus: "RECORDED" }, courseAssociations: analysis.courseAssociations, processingLog: analysis.processing });
  return { candidate, analysis, reviewPackage };
}

function activate(db: ReturnType<typeof createDb>["db"], id: string, publicSource: { label: string | null; url: string | null } | null = { label: "合规来源", url: "https://example.org/source" }) {
  let revision = 1;
  for (const state of ["DOWNLOADED/IMPORTED", "NORMALIZED/DEDUPED", "VISUALLY_ANALYZED", "READY_FOR_TEACHER_REVIEW"] as const) revision = advanceAutomatedInspirationCandidate(db, id, revision, state).revision;
  return decideInspirationCandidate(db, { userId: "teacher", role: "TEACHER" }, {
    candidateId: id,
    expectedRevision: revision,
    decision: "APPROVE",
    courseTags: ["书籍设计", "版式"],
    notes: "测试",
    idempotencyKey: `approve-${id.slice(-16)}`,
    studentPublication: publicSource ? formalStudentPublicationFixture(publicSource) : undefined,
  });
}

describe("published inspiration browse API", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-inspiration-browser-"));
    const databasePath = path.join(directory, "browser.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec("INSERT INTO users(id,class_id,role,alias,created_at) VALUES('teacher',NULL,'TEACHER','教师',1700000000),('student',NULL,'STUDENT','学生',1700000000),('deleted-student',NULL,'STUDENT','已删除学生',1700000000),('deleted-teacher',NULL,'TEACHER','已删除教师',1700000000); DELETE FROM users WHERE id IN ('deleted-student','deleted-teacher');");
      registerInspirationSource(connection.db, reviewPipelineSourceFixture);
      const visible = fixture("inspiration-intake:book-layout-active", "书籍版式案例", true, "a");
      const visibleSecond = fixture("inspiration-intake:book-layout-active-second", "书籍装帧案例", true, "d");
      const hidden = fixture("inspiration-intake:book-layout-pending", "不应泄露的候选", true, "b");
      const noDisplay = fixture("inspiration-intake:book-layout-no-display", "没有展示许可", false, "c");
      for (const item of [visible, visibleSecond, hidden, noDisplay]) ingestPrivateInspirationCandidate(connection.db, { sourceId: reviewPipelineSourceFixture.id, ...item });
      activate(connection.db, visible.candidate.id);
      activate(connection.db, visibleSecond.candidate.id);
      activate(connection.db, noDisplay.candidate.id, null);
    } finally { connection.sqlite.close(); }
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

  it("is authenticated, paginated, searchable, and never serializes private or non-displayable candidates", async () => {
    expect((await browseGet(new NextRequest("http://localhost/api/inspiration/browse"))).status).toBe(401);
    const studentToken = await issueSession({ userId: "student", role: "STUDENT" }, SECRET);
    const response = await browseGet(new NextRequest("http://localhost/api/inspiration/browse?limit=1&q=%E4%B9%A6%E7%B1%8D%E8%AE%BE%E8%AE%A1", { headers: { cookie: cookie(studentToken) } }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ appliedFacets: expect.arrayContaining(["书籍设计"]), items: [expect.objectContaining({ preview: "METADATA_ONLY" })] });
    expect(payload.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(payload)).not.toContain("inspiration-intake:");
    expect(JSON.stringify(payload)).not.toContain("private-candidate:");
    expect(JSON.stringify(payload)).not.toContain("不应泄露的候选");
    expect(JSON.stringify(payload)).not.toContain("没有展示许可");
    const next = await browseGet(new NextRequest(`http://localhost/api/inspiration/browse?limit=1&q=%E4%B9%A6%E7%B1%8D%E8%AE%BE%E8%AE%A1&cursor=${encodeURIComponent(payload.nextCursor)}`, { headers: { cookie: cookie(studentToken) } }));
    const nextPayload = await next.json();
    expect(next.status).toBe(200);
    expect(nextPayload.items).toHaveLength(1);
    expect(nextPayload.items[0].id).not.toBe(payload.items[0].id);
    const teacherToken = await issueSession({ userId: "teacher", role: "TEACHER" }, SECRET);
    expect((await browseGet(new NextRequest("http://localhost/api/inspiration/browse", { headers: { cookie: cookie(teacherToken) } }))).status).toBe(200);
    for (const actor of [
      { userId: "deleted-student", role: "STUDENT" as const },
      { userId: "nonexistent-student", role: "STUDENT" as const },
      { userId: "deleted-teacher", role: "TEACHER" as const },
    ]) {
      const staleToken = await issueSession(actor, SECRET);
      expect((await browseGet(new NextRequest("http://localhost/api/inspiration/browse", { headers: { cookie: cookie(staleToken) } }))).status).toBe(403);
    }
  });

  it("keeps legacy student browse and search empty while P2 is in Shadow", async () => {
    const connection = createDb(process.env.DATABASE_PATH!);
    try { persistP2StudentChannelShadowSnapshot(connection, p2StudentChannelShadowFixture()); }
    finally { connection.sqlite.close(); }
    const studentToken = await issueSession({ userId: "student", role: "STUDENT" }, SECRET);
    const response = await browseGet(new NextRequest(
      "http://localhost/api/inspiration/browse?q=%E4%B9%A6%E7%B1%8D%E8%AE%BE%E8%AE%A1&topic=%E7%89%88%E5%BC%8F",
      { headers: { cookie: cookie(studentToken) } },
    ));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], nextCursor: null, appliedFacets: ["书籍设计", "版式"] });
  });

  it("projects only approved public source links and omits unsafe locators instead of rewriting them", async () => {
    const connection = createDb(process.env.DATABASE_PATH!);
    try {
      const unsafe = [
        ["inspiration-intake:source-private", "私有定位符", "e", "private-candidate://ingest/private-source"],
        ["inspiration-intake:source-local", "本地地址", "f", "https://localhost/source"],
        ["inspiration-intake:source-internal", "内网地址", "0", "https://127.0.0.1/source"],
        ["inspiration-intake:source-credentials", "含凭据地址", "1", "https://author:secret@example.org/source"],
        ["inspiration-intake:source-signed", "签名地址", "2", "https://example.org/source?X-Amz-Signature=secret"],
        ["inspiration-intake:source-display-locator", "错误显示定位符", "3", "private-candidate://ingest/private-source", "采集记录：private-candidate://ingest/display-secret"],
      ] as const;
      for (const [id, title, hashCharacter, sourceUrl, sourceDisplay] of unsafe) {
        const item = fixture(id, title, true, hashCharacter, sourceUrl, sourceDisplay);
        ingestPrivateInspirationCandidate(connection.db, { sourceId: reviewPipelineSourceFixture.id, ...item });
        activate(connection.db, id, { label: sourceDisplay ?? "合规来源", url: sourceUrl });
      }
      const malicious = fixture("inspiration-intake:student-projection-malicious", "将被安全投影替换", true, "4");
      ingestPrivateInspirationCandidate(connection.db, { sourceId: reviewPipelineSourceFixture.id, ...malicious });
      activate(connection.db, malicious.candidate.id, { label: "https://localhost/private", url: "https://example.org/source?token=secret" });
      connection.sqlite.prepare("UPDATE inspiration_admissions SET read_model_json=? WHERE candidate_id=?").run(JSON.stringify({
        title: "C:\\Users\\student\\secret.txt",
        description: "/etc/passwd",
        tags: ["安全标签", "inspiration-intake:secret", "\\\\server\\share"],
        courseAssociations: [{ coursePackId: "book-design", facets: ["版式", "file:///tmp/private"] }, { coursePackId: "private-candidate://id", facets: ["不应出现"] }],
        source: { label: "https://localhost/private", url: "https://example.org/source?token=secret" },
        attributionNotice: "private-candidate://hidden/notice",
      }), malicious.candidate.id);
    } finally { connection.sqlite.close(); }
    const studentToken = await issueSession({ userId: "student", role: "STUDENT" }, SECRET);
    const response = await browseGet(new NextRequest("http://localhost/api/inspiration/browse?limit=30", { headers: { cookie: cookie(studentToken) } }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    for (const title of ["私有定位符", "本地地址", "内网地址", "含凭据地址", "签名地址", "错误显示定位符"]) {
      expect(payload.items).toContainEqual(expect.objectContaining({ title, source: expect.objectContaining({ url: null }) }));
    }
    expect(payload.items).toContainEqual(expect.objectContaining({
      title: "未命名灵感案例",
      description: null,
      tags: ["安全标签"],
      courseAssociations: [{ coursePackId: "book-design", facets: ["版式"] }],
      source: { label: "来源未知", url: null },
      attributionNotice: "来源状态未知；当前不提供外部链接。",
    }));
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("private-candidate://");
    expect(serialized).not.toContain("localhost");
    expect(serialized).not.toContain("127.0.0.1");
    expect(serialized).not.toContain("author:secret@");
    expect(serialized).not.toContain("X-Amz-Signature");
    expect(serialized).not.toContain("display-secret");
    expect(serialized).not.toContain("secret.txt");
    expect(serialized).not.toContain("/etc/passwd");
    expect(serialized).not.toContain("inspiration-intake:secret");
    expect(serialized).not.toContain("server\\share");
    const unsafeFacetResponse = await browseGet(new NextRequest("http://localhost/api/inspiration/browse?limit=30&topic=file%3A%2F%2F%2Fetc%2Fpasswd", { headers: { cookie: cookie(studentToken) } }));
    expect(unsafeFacetResponse.status).toBe(200);
    const unsafeFacetPayload = await unsafeFacetResponse.json();
    expect(unsafeFacetPayload.appliedFacets).toEqual([]);
    expect(JSON.stringify(unsafeFacetPayload)).not.toContain("/etc/passwd");
  });
});
