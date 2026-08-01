// @vitest-environment node

import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { learnerProfiles, projects, transferAttempts, transferChallenges } from "@/lib/db/schema";
import {
  TransferAttemptConflictError,
  TransferEvidenceStaleError,
  TransferLockedError,
  TransferNotFoundError,
  TransferStageError,
  getOrCreateTransferChallenge,
  submitTransferChallenge,
} from "@/lib/services/transfer";

const actor = { userId: "student-1", role: "STUDENT" } as const;

function answerFor(challenge: ReturnType<typeof getOrCreateTransferChallenge>["challenge"], passing = true) {
  const range = challenge.unitPolicy.sourceRanges.find(({ unit }) => unit === challenge.unitPolicy.sourceUnit)!;
  return {
    retainedStructure: {
      culturalIntent: challenge.mustRetain.culturalIntent,
      input: challenge.mustRetain.input,
      mapping: challenge.mustRetain.mapping,
      output: challenge.mustRetain.output,
    },
    changedParts: {
      dimension: passing ? challenge.changedDimension : (challenge.changedDimension === "input" ? "output" : "input"),
      from: challenge.change.from,
      to: challenge.change.to,
      rationale: "只替换挑战指定的维度并保留其他交互关系。",
    },
    normalization: {
      sourceMin: challenge.unitPolicy.sourceUnit === "dB" ? 40 : range.minInclusive,
      sourceMax: challenge.unitPolicy.sourceUnit === "dB" ? 90 : range.maxInclusive,
      sourceUnit: challenge.unitPolicy.sourceUnit,
      targetMin: 0,
      targetMax: 1,
      targetUnit: "normalized" as const,
      relationship: challenge.unitPolicy.allowedRelationships[0],
    },
    culturalImpact: {
      audienceType: challenge.culturalPolicy.allowedAudienceTypes[0],
      behaviorBefore: challenge.culturalPolicy.allowedTransitions[0].before,
      behaviorAfter: challenge.culturalPolicy.allowedTransitions[0].after,
      intentAnchorId: challenge.culturalPolicy.intentAnchor.id,
      mechanism: challenge.culturalPolicy.allowedMechanisms[0],
    },
  };
}

async function waitForFile(file: string) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try { await access(file); return; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  throw new Error(`worker did not become ready: ${file}`);
}

function spawnAttemptWorker(databasePath: string, ready: string, start: string, answer: unknown) {
  const child = spawn(process.execPath, [
    path.resolve("node_modules/tsx/dist/cli.mjs"),
    path.resolve("tests/helpers/transfer-attempt-worker.ts"),
    databasePath, ready, start, JSON.stringify(answer),
  ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function spawnStartWorker(databasePath: string, ready: string, start: string) {
  const child = spawn(process.execPath, [
    path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("tests/helpers/transfer-start-worker.ts"),
    databasePath, ready, start,
  ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("persisted transfer challenges", () => {
  let directory: string;
  let databasePath: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-transfer-"));
    databasePath = path.join(directory, "course.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes VALUES ('class-1', '一班', 'CLASS001');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('student-1', 'class-1', 'STUDENT', '匿名-1', 1700000000),
        ('student-2', 'class-1', 'STUDENT', '匿名-2', 1700000000);
      INSERT INTO learner_profiles VALUES ('student-1', 'L2', 2, 2, 2, 2, 1, 1700000000);
      INSERT INTO course_modules VALUES ('module-1', 'class-1', 1, '综合项目', 16, '迁移');
      INSERT INTO assignments VALUES ('assignment-1', 'class-1', 'module-1', '安岳石刻', '简介', '["COLLABORATIVE"]', 1700000000);
      INSERT INTO projects VALUES
        ('project-1', 'class-1', 'assignment-1', 'student-1', 'TRANSFER', 1700000000, 1700000000, 5),
        ('project-2', 'class-1', 'assignment-1', 'student-2', 'TRANSFER', 1700000000, 1700000000, 0);
      INSERT INTO logic_cards
        (project_id,payload_json,rule_ready,semantic_ready,semantic_review_json,revision,card_hash)
      VALUES ('project-1','{"culturalIntent":"让观众理解安岳石刻守护与共同记忆","participantAction":"观众靠近石刻投影并停留观察","inputSignal":"距离传感器10到80厘米","mappingRule":"距离由10到80厘米映射为0到1的画面亮度","outputMedium":"石刻纹样投影视觉","experienceFeedback":"靠近时纹样逐渐显现"}',1,1,'{"status":"APPROVED","ready":true,"issues":[],"source":"test"}',1,'${"a".repeat(64)}');
      INSERT INTO tool_path_plans VALUES ('project-1','COLLABORATIVE','{"needsRealtimeVisuals":true,"needsPhysicalControl":true,"hasOsc":true}','["协同"]','[{"id":"m1","title":"输入","requiredEvidenceLabel":"输入"},{"id":"m2","title":"映射","requiredEvidenceLabel":"映射"},{"id":"m3","title":"输出","requiredEvidenceLabel":"输出"}]',1700000000,1700000000);
      INSERT INTO evidence
        (id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at)
      VALUES
        ('00000000-0000-4000-8000-000000000001','project-1','class-1','student-1',1,'PROBE','INPUT','INPUT_OK','RULE_VERIFIED','READY','输入','{}','${"b".repeat(64)}','{}',NULL,1700000000),
        ('00000000-0000-4000-8000-000000000002','project-1','class-1','student-1',2,'PROBE','MAPPING','MAPPING_OK','TEACHER_VERIFIED','READY','映射','{}','${"c".repeat(64)}','{}',NULL,1700000000),
        ('00000000-0000-4000-8000-000000000003','project-1','class-1','student-1',3,'PROBE','TRANSPORT','TRANSPORT_OK','RULE_VERIFIED','READY','传输','{}','${"d".repeat(64)}','{}',NULL,1700000000),
        ('00000000-0000-4000-8000-000000000004','project-1','class-1','student-1',4,'PROBE','BINDING','BINDING_OK','RULE_VERIFIED','READY','绑定','{}','${"e".repeat(64)}','{}',NULL,1700000000),
        ('00000000-0000-4000-8000-000000000005','project-1','class-1','student-1',5,'PROBE','OUTPUT','OUTPUT_OK','RULE_VERIFIED','READY','输出','{}','${"f".repeat(64)}','{}',NULL,1700000000),
        ('00000000-0000-4000-8000-000000000006','project-1','class-1','student-1',6,'TEXT','OUTPUT',NULL,'SUBMITTED','READY','未验证','不能用于挑战','${"9".repeat(64)}',NULL,NULL,1700000000);
    `);
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("creates one stable auditable snapshot from current project records", () => {
    const first = getOrCreateTransferChallenge(connection.db, actor, "project-1");
    const second = getOrCreateTransferChallenge(connection.db, actor, "project-1");
    expect(second).toEqual(first);
    expect(first).toMatchObject({ attemptsUsed: 0, attemptsRemaining: 2, status: "OPEN" });
    expect(first.challenge.prompt).toContain("只改变");
    const stored = connection.db.select().from(transferChallenges).get();
    expect(stored?.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored?.snapshotJson)).not.toContain("不能用于挑战");
  });

  it("requires TRANSFER and unifies foreign and unknown ownership", () => {
    connection.sqlite.prepare("UPDATE projects SET stage='BUILD' WHERE id='project-1'").run();
    expect(() => getOrCreateTransferChallenge(connection.db, actor, "project-1")).toThrow(TransferStageError);
    expect(() => getOrCreateTransferChallenge(connection.db, actor, "project-2")).toThrow(TransferNotFoundError);
    expect(() => getOrCreateTransferChallenge(connection.db, actor, "missing")).toThrow(TransferNotFoundError);
  });

  it("persists at most two monotonic attempts and locks after the second failure", async () => {
    const challenge = getOrCreateTransferChallenge(connection.db, actor, "project-1");
    const failingAnswer = answerFor(challenge.challenge, false);
    const first = await submitTransferChallenge(connection.db, actor, "project-1", {
      challengeRevision: challenge.challenge.challengeRevision,
      expectedAttempt: 0,
      answer: failingAnswer,
    });
    expect(first).toMatchObject({ attemptsUsed: 1, attemptsRemaining: 1, status: "OPEN" });
    const second = await submitTransferChallenge(connection.db, actor, "project-1", {
      challengeRevision: challenge.challenge.challengeRevision,
      expectedAttempt: 1,
      answer: failingAnswer,
    });
    expect(second).toMatchObject({ attemptsUsed: 2, attemptsRemaining: 0, status: "LOCKED", locked: true });
    expect(second.latestRubric?.feedback.teacherReview).toBe(true);
    expect(connection.db.select().from(transferAttempts).all().map(({ attemptNumber }) => attemptNumber)).toEqual([1, 2]);
    await expect(submitTransferChallenge(connection.db, actor, "project-1", {
      challengeRevision: 1, expectedAttempt: 2, answer: failingAnswer,
    })).rejects.toThrow(TransferLockedError);
  });

  it("uses attempt CAS so duplicate or stale submissions cannot land", async () => {
    const challenge = getOrCreateTransferChallenge(connection.db, actor, "project-1");
    const failingAnswer = answerFor(challenge.challenge, false);
    await submitTransferChallenge(connection.db, actor, "project-1", {
      challengeRevision: challenge.challenge.challengeRevision, expectedAttempt: 0, answer: failingAnswer,
    });
    await expect(submitTransferChallenge(connection.db, actor, "project-1", {
      challengeRevision: challenge.challenge.challengeRevision, expectedAttempt: 0, answer: failingAnswer,
    })).rejects.toThrow(TransferAttemptConflictError);
    await expect(submitTransferChallenge(connection.db, actor, "project-1", {
      challengeRevision: challenge.challenge.challengeRevision + 1, expectedAttempt: 1, answer: failingAnswer,
    })).rejects.toThrow(TransferAttemptConflictError);
    expect(connection.db.select().from(transferAttempts).all()).toHaveLength(1);
  });

  it("revalidates the exact five-layer evidence snapshot before scoring", async () => {
    const challenge = getOrCreateTransferChallenge(connection.db, actor, "project-1");
    connection.sqlite.prepare(`UPDATE evidence SET verification_status='REJECTED', confirmed_code=NULL
      WHERE id='00000000-0000-4000-8000-000000000002'`).run();
    await expect(submitTransferChallenge(connection.db, actor, "project-1", {
      challengeRevision: 1, expectedAttempt: 0, answer: answerFor(challenge.challenge),
    })).rejects.toThrow(TransferEvidenceStaleError);
    expect(connection.db.select().from(transferAttempts).all()).toHaveLength(0);
    expect(connection.db.select().from(projects).get()?.stage).toBe("TRANSFER");
    expect(connection.db.select().from(learnerProfiles).get()?.transfer).toBe(1);
  });

  it("regenerates a stale active challenge atomically while preserving the project attempt budget and history", async () => {
    const first = getOrCreateTransferChallenge(connection.db, actor, "project-1");
    const storedBefore = connection.sqlite.prepare("SELECT snapshot_json FROM transfer_challenges WHERE project_id='project-1'").get() as { snapshot_json: string };
    connection.sqlite.prepare("UPDATE evidence SET content_digest=? WHERE id=?")
      .run("7".repeat(64), "00000000-0000-4000-8000-000000000005");
    const regenerated = getOrCreateTransferChallenge(connection.db, actor, "project-1");
    expect(regenerated).toMatchObject({ attemptsUsed: 0, attemptsRemaining: 2, status: "OPEN" });
    expect(regenerated.challenge.challengeRevision).toBe(first.challenge.challengeRevision + 1);
    const history = connection.sqlite.prepare(`SELECT revision,snapshot_hash,snapshot_json,status,attempt_count
      FROM transfer_challenge_revisions WHERE project_id='project-1'`).get() as Record<string, unknown>;
    expect(history).toMatchObject({ revision: 1, status: "OPEN", attempt_count: 0, snapshot_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.parse(String(history.snapshot_json))).toEqual(JSON.parse(storedBefore.snapshot_json));
    await expect(submitTransferChallenge(connection.db, actor, "project-1", {
      challengeRevision: first.challenge.challengeRevision, expectedAttempt: 0, answer: answerFor(first.challenge),
    })).rejects.toThrow(TransferAttemptConflictError);
  });

  it("preserves one used attempt across regeneration so only one retry remains", async () => {
    const first = getOrCreateTransferChallenge(connection.db, actor, "project-1");
    await submitTransferChallenge(connection.db, actor, "project-1", {
      challengeRevision: 1, expectedAttempt: 0, answer: answerFor(first.challenge, false),
    });
    connection.sqlite.prepare("UPDATE evidence SET content_digest=? WHERE id=?")
      .run("7".repeat(64), "00000000-0000-4000-8000-000000000005");
    const regenerated = getOrCreateTransferChallenge(connection.db, actor, "project-1");
    expect(regenerated).toMatchObject({ attemptsUsed: 1, attemptsRemaining: 1, status: "OPEN" });
    expect(regenerated.challenge.challengeRevision).toBe(2);
    expect(connection.sqlite.prepare("SELECT challenge_revision,attempt_number FROM transfer_attempts").get())
      .toEqual({ challenge_revision: 1, attempt_number: 1 });
  });

  it("refuses START when verified evidence is incomplete instead of returning a stale challenge", () => {
    getOrCreateTransferChallenge(connection.db, actor, "project-1");
    connection.sqlite.prepare(`UPDATE evidence SET verification_status='REJECTED', confirmed_code=NULL
      WHERE id='00000000-0000-4000-8000-000000000002'`).run();
    expect(() => getOrCreateTransferChallenge(connection.db, actor, "project-1")).toThrow("TRANSFER_EVIDENCE_UNAVAILABLE");
    connection.sqlite.prepare(`INSERT INTO evidence
      (id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "00000000-0000-4000-8000-000000000007", "project-1", "class-1", "student-1", 7, "PROBE", "MAPPING", "MAPPING_OK",
      "TEACHER_VERIFIED", "READY", "替换映射", "{}", "7".repeat(64), "{}", null, 1_700_000_001,
    );
    expect(getOrCreateTransferChallenge(connection.db, actor, "project-1").challenge.challengeRevision).toBe(2);
  });

  it("lets two concurrent START calls create only one replacement revision", async () => {
    getOrCreateTransferChallenge(connection.db, actor, "project-1");
    connection.sqlite.prepare("UPDATE evidence SET content_digest=? WHERE id=?")
      .run("7".repeat(64), "00000000-0000-4000-8000-000000000005");
    connection.sqlite.close();
    const start = path.join(directory, "regen.signal");
    const readyOne = path.join(directory, "regen-one.ready");
    const readyTwo = path.join(directory, "regen-two.ready");
    const one = spawnStartWorker(databasePath, readyOne, start);
    const two = spawnStartWorker(databasePath, readyTwo, start);
    await Promise.all([waitForFile(readyOne), waitForFile(readyTwo)]);
    await writeFile(start, "start", "utf8");
    const results = await Promise.all([one, two]);
    expect(results.map(({ code, stderr }) => ({ code, stderr }))).toEqual([{ code: 0, stderr: "" }, { code: 0, stderr: "" }]);
    expect(results.map(({ stdout }) => JSON.parse(stdout).revision)).toEqual([2, 2]);
    connection = createDb(databasePath);
    expect(connection.sqlite.prepare("SELECT revision FROM transfer_challenges").get()).toEqual({ revision: 2 });
    expect(connection.sqlite.prepare("SELECT count(*) count FROM transfer_challenge_revisions").get()).toEqual({ count: 1 });
  }, 10_000);

  it("passes, advances to COMPLETE and updates transfer profile only in one transaction", async () => {
    const challenge = getOrCreateTransferChallenge(connection.db, actor, "project-1");
    const tailored = answerFor(challenge.challenge);
    const result = await submitTransferChallenge(connection.db, actor, "project-1", {
      challengeRevision: challenge.challenge.challengeRevision, expectedAttempt: 0,
      answer: { ...tailored, culturalImpact: { ...tailored.culturalImpact, reflection: "学生提交的反思不得进入教师专用字段" } },
    });
    expect(result).toMatchObject({ status: "PASSED", attemptsUsed: 1, attemptsRemaining: 0 });
    expect(connection.db.select().from(projects).get()?.stage).toBe("COMPLETE");
    expect(connection.db.select().from(learnerProfiles).get()?.transfer).toBe(2);
    expect(connection.db.select().from(transferAttempts).get()?.responseJson.culturalImpact).not.toHaveProperty("reflection");
  });

  it("does not let AI feedback override deterministic scoring or inject prose", async () => {
    const challenge = getOrCreateTransferChallenge(connection.db, actor, "project-1");
    const failingAnswer = answerFor(challenge.challenge, false);
    const result = await submitTransferChallenge(connection.db, actor, "project-1", {
      challengeRevision: challenge.challenge.challengeRevision, expectedAttempt: 0, answer: failingAnswer,
    }, () => ({ aiCode: "CLARITY_NOTE", passed: true, completeWork: "完整作品" }));
    expect(result.latestRubric?.passed).toBe(false);
    expect(result.latestRubric?.feedback.aiCode).toBeNull();
    expect(JSON.stringify(result)).not.toContain("完整作品");
  });

  it("isolates callback mutations from the canonical answer persisted for scoring", async () => {
    const challenge = getOrCreateTransferChallenge(connection.db, actor, "project-1");
    const original = answerFor(challenge.challenge, false);
    const result = await submitTransferChallenge(connection.db, actor, "project-1", {
      challengeRevision: 1, expectedAttempt: 0, answer: original,
    }, ({ answer }) => {
      answer.retainedStructure.input = "AI篡改输入";
      answer.changedParts.rationale = "AI篡改理由并试图影响持久答案";
      return { aiCode: "CLARITY_NOTE" };
    });
    expect(result.latestRubric?.feedback.aiCode).toBe("CLARITY_NOTE");
    expect(connection.db.select().from(transferAttempts).get()?.responseJson).toEqual(original);
  });

  it("runs deferred AI outside transactions and rejects the stale write after regeneration", async () => {
    const challenge = getOrCreateTransferChallenge(connection.db, actor, "project-1");
    let releaseAi!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const pending = submitTransferChallenge(connection.db, actor, "project-1", {
      challengeRevision: 1, expectedAttempt: 0, answer: answerFor(challenge.challenge, false),
    }, async ({ signal }) => {
      markStarted();
      await new Promise<void>((resolve) => { releaseAi = resolve; signal.addEventListener("abort", () => resolve(), { once: true }); });
      return { aiCode: "CLARITY_NOTE" };
    }, { aiTimeoutMs: 2_000 });
    await started;
    const other = createDb(databasePath);
    expect(() => other.sqlite.exec("BEGIN IMMEDIATE; ROLLBACK;")).not.toThrow();
    other.sqlite.prepare("UPDATE evidence SET content_digest=? WHERE id=?")
      .run("7".repeat(64), "00000000-0000-4000-8000-000000000005");
    expect(getOrCreateTransferChallenge(other.db, actor, "project-1").challenge.challengeRevision).toBe(2);
    other.sqlite.close();
    releaseAi();
    await expect(pending).rejects.toThrow(TransferAttemptConflictError);
    expect(connection.db.select().from(transferAttempts).all()).toHaveLength(0);
  });

  it("times out or catches AI failure without rolling back deterministic attempts", async () => {
    const challenge = getOrCreateTransferChallenge(connection.db, actor, "project-1");
    let aborted = false;
    const timed = await submitTransferChallenge(connection.db, actor, "project-1", {
      challengeRevision: 1, expectedAttempt: 0, answer: answerFor(challenge.challenge, false),
    }, ({ signal }) => new Promise(() => { signal.addEventListener("abort", () => { aborted = true; }, { once: true }); }), { aiTimeoutMs: 20 });
    expect(timed).toMatchObject({ attemptsUsed: 1, attemptsRemaining: 1 });
    expect(timed.latestRubric?.feedback.aiCode).toBeNull();
    expect(aborted).toBe(true);
    const thrown = await submitTransferChallenge(connection.db, actor, "project-1", {
      challengeRevision: 1, expectedAttempt: 1, answer: answerFor(challenge.challenge, false),
    }, () => { throw new Error("AI unavailable"); }, { aiTimeoutMs: 20 });
    expect(thrown).toMatchObject({ attemptsUsed: 2, status: "LOCKED" });
    expect(connection.db.select().from(transferAttempts).all()).toHaveLength(2);
  });

  it("serializes two OS-process submissions so only one expected attempt lands", async () => {
    const challenge = getOrCreateTransferChallenge(connection.db, actor, "project-1");
    const failingAnswer = answerFor(challenge.challenge, false);
    connection.sqlite.close();
    const start = path.join(directory, "start.signal");
    const readyOne = path.join(directory, "one.ready");
    const readyTwo = path.join(directory, "two.ready");
    const one = spawnAttemptWorker(databasePath, readyOne, start, failingAnswer);
    const two = spawnAttemptWorker(databasePath, readyTwo, start, failingAnswer);
    await Promise.all([waitForFile(readyOne), waitForFile(readyTwo)]);
    await writeFile(start, "start", "utf8");
    const results = await Promise.all([one, two]);
    expect(results.map(({ code, stderr }) => ({ code, stderr }))).toEqual([{ code: 0, stderr: "" }, { code: 0, stderr: "" }]);
    expect(results.map(({ stdout }) => JSON.parse(stdout)).sort((left, right) => Number(right.ok) - Number(left.ok)))
      .toEqual([{ ok: true, attemptsUsed: 1 }, { ok: false, errorName: "TransferAttemptConflictError" }]);
    connection = createDb(databasePath);
    expect(connection.db.select().from(transferAttempts).all()).toHaveLength(1);
  }, 10_000);
});
