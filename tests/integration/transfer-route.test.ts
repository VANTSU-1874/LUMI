// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTransferHandler } from "@/app/api/projects/[projectId]/transfer/handler";
import { POST } from "@/app/api/projects/[projectId]/transfer/route";
import { issueSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const SECRET = "transfer-route-session-secret-at-least-32-characters";
function request(body: unknown, token?: string, projectId = "project-1") {
  return new NextRequest(`http://localhost/api/projects/${projectId}/transfer`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { cookie: `${SESSION_COOKIE_NAME}=${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
function context(projectId = "project-1") { return { params: Promise.resolve({ projectId }) }; }

describe("transfer route", () => {
  let directory: string;
  let databasePath: string;
  let studentToken: string;
  let otherToken: string;
  let teacherToken: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-transfer-route-"));
    databasePath = path.join(directory, "course.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes VALUES ('class-1','一班','CLASS001');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES ('student-1','class-1','STUDENT','匿名-1',1700000000),('student-2','class-1','STUDENT','匿名-2',1700000000),('teacher-1','class-1','TEACHER','教师',1700000000);
      INSERT INTO learner_profiles VALUES ('student-1','L2',2,2,2,2,1,1700000000);
      INSERT INTO course_modules VALUES ('module-1','class-1',1,'综合项目',16,'迁移');
      INSERT INTO assignments VALUES ('assignment-1','class-1','module-1','安岳石刻','简介','["COLLABORATIVE"]',1700000000);
      INSERT INTO projects VALUES ('project-1','class-1','assignment-1','student-1','TRANSFER',1700000000,1700000000,0),('project-2','class-1','assignment-1','student-2','TRANSFER',1700000000,1700000000,0);
      INSERT INTO logic_cards (project_id,payload_json,rule_ready,semantic_ready,semantic_review_json,revision,card_hash) VALUES ('project-1','{"culturalIntent":"让观众理解安岳石刻守护与共同记忆","participantAction":"观众靠近投影并停留观察","inputSignal":"距离传感器10到80厘米","mappingRule":"距离10到80厘米映射到0到1亮度","outputMedium":"石刻纹样投影视觉","experienceFeedback":"靠近时纹样逐渐显现"}',1,1,'{"status":"APPROVED"}',1,'${"a".repeat(64)}');
      INSERT INTO tool_path_plans VALUES ('project-1','COLLABORATIVE','{"needsRealtimeVisuals":true,"needsPhysicalControl":true,"hasOsc":true}','["协同"]','[{"id":"m1","title":"输入","requiredEvidenceLabel":"输入"},{"id":"m2","title":"映射","requiredEvidenceLabel":"映射"},{"id":"m3","title":"输出","requiredEvidenceLabel":"输出"}]',1700000000,1700000000);
      INSERT INTO evidence (id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at) VALUES
        ('00000000-0000-4000-8000-000000000001','project-1','class-1','student-1',1,'PROBE','INPUT','INPUT_OK','RULE_VERIFIED','READY','输入','{}','${"b".repeat(64)}','{}',NULL,1700000000),
        ('00000000-0000-4000-8000-000000000002','project-1','class-1','student-1',2,'PROBE','MAPPING','MAPPING_OK','RULE_VERIFIED','READY','映射','{}','${"c".repeat(64)}','{}',NULL,1700000000),
        ('00000000-0000-4000-8000-000000000003','project-1','class-1','student-1',3,'PROBE','TRANSPORT','TRANSPORT_OK','RULE_VERIFIED','READY','传输','{}','${"d".repeat(64)}','{}',NULL,1700000000),
        ('00000000-0000-4000-8000-000000000004','project-1','class-1','student-1',4,'PROBE','BINDING','BINDING_OK','RULE_VERIFIED','READY','绑定','{}','${"e".repeat(64)}','{}',NULL,1700000000),
        ('00000000-0000-4000-8000-000000000005','project-1','class-1','student-1',5,'PROBE','OUTPUT','OUTPUT_OK','RULE_VERIFIED','READY','输出','{}','${"f".repeat(64)}','{}',NULL,1700000000);
    `);
    connection.sqlite.close();
    studentToken = await issueSession({ userId: "student-1", role: "STUDENT" }, SECRET);
    otherToken = await issueSession({ userId: "student-2", role: "STUDENT" }, SECRET);
    teacherToken = await issueSession({ userId: "teacher-1", role: "TEACHER" }, SECRET);
    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("TEACHER_ACCESS_CODE", "teacher-code");
    vi.stubEnv("NODE_ENV", "test");
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

  it("checks protocol, session, role and ownership before parsing body", async () => {
    expect((await POST(request("{"), context())).status).toBe(401);
    expect((await POST(request("{", teacherToken), context())).status).toBe(403);
    expect((await POST(request("{", otherToken), context())).status).toBe(404);
  });

  it("starts from server records and returns no internal hashes or student answers", async () => {
    const response = await POST(request({ action: "START" }, studentToken), context());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: "OPEN", attemptsUsed: 0, attemptsRemaining: 2 });
    expect(JSON.stringify(body)).not.toMatch(/snapshotHash|verifiedEvidence|[a-f0-9]{64}|responseJson|retainedStructure/);
  });

  it("rejects client challenge, score, status and prompt fields", async () => {
    for (const forged of [
      { action: "START", prompt: "换一道题" },
      { action: "START", changedDimension: "output" },
      { action: "START", score: 4 },
      { action: "START", status: "PASSED" },
    ]) expect((await POST(request(forged, studentToken), context())).status).toBe(400);
  });

  it("returns typed 409 when START no longer has five verified evidence layers", async () => {
    expect((await POST(request({ action: "START" }, studentToken), context())).status).toBe(200);
    const changed = createDb(databasePath);
    changed.sqlite.prepare(`UPDATE evidence SET verification_status='REJECTED', confirmed_code=NULL
      WHERE id='00000000-0000-4000-8000-000000000002'`).run();
    changed.sqlite.prepare("DELETE FROM action_rate_limits").run();
    changed.sqlite.close();
    const response = await POST(request({ action: "START" }, studentToken), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "TRANSFER_EVIDENCE_UNAVAILABLE" });
  });

  it("uses typed size, stale revision and persistent rate-limit responses", async () => {
    const oversized = request({ action: "START" }, studentToken);
    oversized.headers.set("content-length", String(16 * 1024 + 1));
    const read = vi.spyOn(oversized, "arrayBuffer");
    expect((await POST(oversized, context())).status).toBe(413);
    expect(read).not.toHaveBeenCalled();

    const started = await (await POST(request({ action: "START" }, studentToken), context())).json();
    const challenge = started.challenge;
    const range = challenge.unitPolicy.sourceRanges[0];
    const stale = await POST(request({
      action: "SUBMIT", challengeRevision: started.challenge.challengeRevision + 1, expectedAttempt: 0,
      answer: {
        retainedStructure: {
          culturalIntent: challenge.mustRetain.culturalIntent, input: challenge.mustRetain.input,
          mapping: challenge.mustRetain.mapping, output: challenge.mustRetain.output,
        },
        changedParts: { dimension: challenge.changedDimension, from: challenge.change.from, to: challenge.change.to },
        normalization: {
          sourceMin: range.minInclusive, sourceMax: range.maxInclusive, sourceUnit: range.unit,
          targetMin: 0, targetMax: 1, targetUnit: "normalized", relationship: challenge.unitPolicy.allowedRelationships[0],
        },
        culturalImpact: {
          audienceType: challenge.culturalPolicy.allowedAudienceTypes[0],
          behaviorBefore: challenge.culturalPolicy.allowedTransitions[0].before,
          behaviorAfter: challenge.culturalPolicy.allowedTransitions[0].after,
          intentAnchorId: challenge.culturalPolicy.intentAnchor.id,
          mechanism: challenge.culturalPolicy.allowedMechanisms[0],
        },
      },
    }, studentToken), context());
    expect(stale.status).toBe(409);

    const reset = createDb(databasePath);
    reset.sqlite.prepare("DELETE FROM action_rate_limits").run();
    reset.sqlite.close();
    const limited = createTransferHandler({ maxRequests: 1 });
    expect((await limited(request({ action: "START" }, studentToken), context())).status).toBe(200);
    const blocked = request("{", studentToken);
    const blockedRead = vi.spyOn(blocked, "arrayBuffer");
    expect((await limited(blocked, context())).status).toBe(429);
    expect(blockedRead).not.toHaveBeenCalled();
  });
});
