// @vitest-environment node

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const NOW = 1_700_000_000;

function seed(connection: ReturnType<typeof createDb>) {
  connection.sqlite.exec(`
    INSERT INTO classes VALUES ('class-1','一班','C1'),('class-2','二班','C2');
    INSERT INTO users(id,class_id,role,alias,created_at) VALUES ('student-1','class-1','STUDENT','匿名1',${NOW}),('student-2','class-2','STUDENT','匿名2',${NOW});
    INSERT INTO course_modules VALUES ('module-1','class-1',1,'模块',2,'迁移');
    INSERT INTO assignments VALUES ('assignment-1','class-1','module-1','作业','简介','["DIGISHOW"]',${NOW});
    INSERT INTO projects (id,class_id,assignment_id,student_id,stage,created_at,updated_at)
      VALUES ('project-1','class-1','assignment-1','student-1','TRANSFER',${NOW},${NOW});
  `);
}

const snapshot = {
  projectId: "project-1", challengeRevision: 1, changedDimension: "input", prompt: "保留其余维度，只改变输入",
  mustRetain: { culturalIntent: "石刻记忆", structure: "输入映射输出", input: "距离", mapping: "线性", output: "投影" },
  change: { candidateId: "sound-db", dimension: "input", from: "距离", to: "声音" },
  unitPolicy: {
    sourceKind: "SOUND", sourceUnit: "dB", sourceRanges: [{ unit: "dB", minInclusive: 20, maxInclusive: 130 }],
    targetMin: 0, targetMax: 1, targetUnit: "normalized", allowedRelationships: ["LINEAR", "DIRECT"],
  },
  culturalPolicy: {
    intentAnchor: { id: "intent_1111111111111111", label: "石刻记忆" },
    allowedAudienceTypes: ["GENERAL_VISITORS", "YOUNG_LEARNERS", "COMMUNITY_MEMBERS", "CULTURAL_HERITAGE_AUDIENCE"],
    allowedTransitions: [
      { before: "PASSIVE_VIEWING", after: "ACTIVE_EXPLORATION" },
      { before: "FOLLOWING_INSTRUCTIONS", after: "COLLABORATIVE_CREATION" },
      { before: "INDIVIDUAL_INTERACTION", after: "REFLECTIVE_SHARING" },
    ],
    allowedMechanisms: ["COLLECTIVE_RESPONSE", "PARTICIPATORY_TRIGGER"],
  }, path: "DIGISHOW",
  verifiedEvidenceSnapshot: ["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"].map((layer, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`, sequence: index + 1, layer,
    code: ["INPUT_OK", "MAPPING_OK", "TRANSPORT_OK", "BINDING_OK", "OUTPUT_OK"][index], digest: String(index + 1).repeat(64),
  })),
  verifiedEvidenceHash: "b".repeat(64), snapshotHash: "a".repeat(64),
};
const answer = {
  retainedStructure: { culturalIntent: "石刻记忆", input: "距离", mapping: "线性", output: "投影" },
  changedParts: { dimension: "input", from: "距离", to: "声音", rationale: "只改变挑战指定输入维度" },
  normalization: { sourceMin: 40, sourceMax: 90, sourceUnit: "dB", targetMin: 0, targetMax: 1, targetUnit: "normalized", relationship: "LINEAR" },
  culturalImpact: {
    audienceType: "GENERAL_VISITORS", behaviorBefore: "PASSIVE_VIEWING", behaviorAfter: "ACTIVE_EXPLORATION",
    intentAnchorId: "intent_1111111111111111", mechanism: "COLLECTIVE_RESPONSE",
  },
};
const rubric = {
  criteria: {
    retainedStructure: { passed: true, reasonCode: "RETAINED_MATCH" },
    changedParts: { passed: true, reasonCode: "CHANGE_TARGETED" },
    normalization: { passed: true, reasonCode: "NORMALIZATION_VALID" },
    culturalImpact: { passed: true, reasonCode: "CULTURAL_CONCRETE" },
  }, score: 4, passed: true, outcome: "PASSED",
  feedback: { retained: false, changed: false, normalization: false, cultural: false, teacherReview: false, aiCode: null },
};

describe("transfer schema and migration", () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map((item) => rm(item, { recursive: true, force: true }))));

  it("rejects cross-owner challenges and malformed snapshots", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-transfer-schema-")); directories.push(directory);
    const file = path.join(directory, "db.sqlite"); runMigrations(file); const connection = createDb(file); seed(connection);
    const insert = connection.sqlite.prepare(`INSERT INTO transfer_challenges
      (id,project_id,class_id,student_id,revision,snapshot_hash,snapshot_json,status,attempt_count,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    expect(() => insert.run("cross", "project-1", "class-2", "student-2", 1, "a".repeat(64), JSON.stringify(snapshot), "OPEN", 0, NOW, NOW)).toThrow();
    expect(() => insert.run("bad-json", "project-1", "class-1", "student-1", 1, "a".repeat(64), "{}", "OPEN", 0, NOW, NOW)).toThrow();
    expect(() => insert.run("bad-hash", "project-1", "class-1", "student-1", 1, "x".repeat(64), JSON.stringify(snapshot), "OPEN", 0, NOW, NOW)).toThrow();
    expect(() => insert.run("bad-state", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify(snapshot), "LOCKED", 1, NOW, NOW)).toThrow();
    expect(() => insert.run("same-change", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify({ ...snapshot, change: { ...snapshot.change, to: snapshot.change.from } }), "OPEN", 0, NOW, NOW)).toThrow();
    expect(() => insert.run("bad-policy", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify({ ...snapshot, unitPolicy: {} }), "OPEN", 0, NOW, NOW)).toThrow();
    expect(() => insert.run("bad-cultural-policy", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify({ ...snapshot, culturalPolicy: { ...snapshot.culturalPolicy, allowedMechanisms: ["SENSORY_FEEDBACK", "COLLECTIVE_RESPONSE"] } }), "OPEN", 0, NOW, NOW)).toThrow();
    expect(() => insert.run("bad-evidence-hash", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify({ ...snapshot, verifiedEvidenceHash: "B".repeat(64) }), "OPEN", 0, NOW, NOW)).toThrow();
    expect(() => insert.run("bad-evidence-item", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify({ ...snapshot, verifiedEvidenceSnapshot: snapshot.verifiedEvidenceSnapshot.map((item, index) => index === 0 ? { ...item, id: "not-a-uuid", sequence: 0, digest: "A".repeat(64) } : item) }), "OPEN", 0, NOW, NOW)).toThrow();
    expect(() => insert.run("bad-source-range", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify({ ...snapshot, unitPolicy: { ...snapshot.unitPolicy, sourceRanges: [{ unit: "dB", minInclusive: 20, maxInclusive: 20 }] } }), "OPEN", 0, NOW, NOW)).toThrow();
    expect(() => insert.run("empty-prompt", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify({ ...snapshot, prompt: "" }), "OPEN", 0, NOW, NOW)).toThrow();
    expect(() => insert.run("empty-retained", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify({ ...snapshot, mustRetain: { ...snapshot.mustRetain, input: "" } }), "OPEN", 0, NOW, NOW)).toThrow();
    expect(() => insert.run("empty-candidate", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify({ ...snapshot, change: { ...snapshot.change, candidateId: "" } }), "OPEN", 0, NOW, NOW)).toThrow();
    expect(() => insert.run("overlong-label", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify({ ...snapshot, culturalPolicy: { ...snapshot.culturalPolicy, intentAnchor: { ...snapshot.culturalPolicy.intentAnchor, label: "文".repeat(501) } } }), "OPEN", 0, NOW, NOW)).toThrow();
    const boundary = {
      ...snapshot, prompt: "十字边界提示文本正好", mustRetain: { culturalIntent: "文化", structure: "结构", input: "输入", mapping: "映射", output: "输出" },
      change: { ...snapshot.change, candidateId: "x", from: "距离", to: "声音" },
      culturalPolicy: { ...snapshot.culturalPolicy, intentAnchor: { ...snapshot.culturalPolicy.intentAnchor, label: "文化" } },
    };
    expect(() => insert.run("boundary", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify(boundary), "OPEN", 0, NOW, NOW)).not.toThrow();
    expect(() => connection.sqlite.prepare(`UPDATE transfer_challenges SET revision=2,
      snapshot_json=json_set(snapshot_json,'$.challengeRevision',2) WHERE id='boundary'`).run()).toThrow();
    connection.sqlite.close();
  });

  it("binds attempts to the exact owner/revision and enforces JSON shapes and two attempts", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-transfer-attempt-schema-")); directories.push(directory);
    const file = path.join(directory, "db.sqlite"); runMigrations(file); const connection = createDb(file); seed(connection);
    connection.sqlite.prepare(`INSERT INTO transfer_challenges VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run("challenge-1", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify(snapshot), "OPEN", 0, NOW, NOW);
    const insert = connection.sqlite.prepare(`INSERT INTO transfer_attempts VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    expect(() => insert.run("a1", "challenge-1", "project-1", "class-1", "student-1", 1, 1, "{}", JSON.stringify(rubric), 1, NOW)).toThrow();
    expect(() => insert.run("a2", "challenge-1", "project-1", "class-1", "student-1", 1, 1, JSON.stringify(answer), "{}", 1, NOW)).toThrow();
    expect(() => insert.run("empty-answer", "challenge-1", "project-1", "class-1", "student-1", 1, 1, "{}", JSON.stringify(rubric), 1, NOW)).toThrow();
    expect(() => insert.run("empty-criteria", "challenge-1", "project-1", "class-1", "student-1", 1, 1, JSON.stringify(answer), JSON.stringify({ ...rubric, criteria: {} }), 1, NOW)).toThrow();
    expect(() => insert.run("bad-culture", "challenge-1", "project-1", "class-1", "student-1", 1, 1, JSON.stringify({ ...answer, culturalImpact: { ...answer.culturalImpact, behaviorAfter: answer.culturalImpact.behaviorBefore } }), JSON.stringify(rubric), 1, NOW)).toThrow();
    expect(() => insert.run("bad-mechanism", "challenge-1", "project-1", "class-1", "student-1", 1, 1, JSON.stringify({ ...answer, culturalImpact: { ...answer.culturalImpact, mechanism: "BOGUS" } }), JSON.stringify(rubric), 1, NOW)).toThrow();
    expect(() => insert.run("long-retained", "challenge-1", "project-1", "class-1", "student-1", 1, 1, JSON.stringify({ ...answer, retainedStructure: { ...answer.retainedStructure, culturalIntent: "文".repeat(501) } }), JSON.stringify(rubric), 1, NOW)).toThrow();
    expect(() => insert.run("short-change", "challenge-1", "project-1", "class-1", "student-1", 1, 1, JSON.stringify({ ...answer, changedParts: { ...answer.changedParts, from: "短" } }), JSON.stringify(rubric), 1, NOW)).toThrow();
    expect(() => insert.run("long-rationale", "challenge-1", "project-1", "class-1", "student-1", 1, 1, JSON.stringify({ ...answer, changedParts: { ...answer.changedParts, rationale: "理".repeat(301) } }), JSON.stringify(rubric), 1, NOW)).toThrow();
    expect(() => insert.run("long-reflection", "challenge-1", "project-1", "class-1", "student-1", 1, 1, JSON.stringify({ ...answer, culturalImpact: { ...answer.culturalImpact, reflection: "思".repeat(301) } }), JSON.stringify(rubric), 1, NOW)).toThrow();
    expect(() => insert.run("contradictory-reason", "challenge-1", "project-1", "class-1", "student-1", 1, 1, JSON.stringify(answer), JSON.stringify({ ...rubric, criteria: { ...rubric.criteria, retainedStructure: { passed: true, reasonCode: "RETAINED_MISMATCH" } } }), 1, NOW)).toThrow();
    expect(() => insert.run("contradictory-feedback", "challenge-1", "project-1", "class-1", "student-1", 1, 1, JSON.stringify(answer), JSON.stringify({ ...rubric, feedback: { ...rubric.feedback, retained: true } }), 1, NOW)).toThrow();
    expect(() => insert.run("contradictory-review", "challenge-1", "project-1", "class-1", "student-1", 1, 1, JSON.stringify(answer), JSON.stringify({ ...rubric, feedback: { ...rubric.feedback, teacherReview: true } }), 1, NOW)).toThrow();
    expect(() => insert.run("null-rubric", "challenge-1", "project-1", "class-1", "student-1", 1, 1, JSON.stringify(answer), null, 1, NOW)).toThrow();
    expect(() => insert.run("a3", "challenge-1", "project-1", "class-1", "student-1", 1, 3, JSON.stringify(answer), JSON.stringify(rubric), 1, NOW)).toThrow();
    expect(() => insert.run("a4", "challenge-1", "project-1", "class-2", "student-2", 1, 1, JSON.stringify(answer), JSON.stringify(rubric), 1, NOW)).toThrow();
    expect(() => insert.run("wrong-revision", "challenge-1", "project-1", "class-1", "student-1", 2, 1, JSON.stringify(answer), JSON.stringify(rubric), 1, NOW)).toThrow();
    expect(() => insert.run("valid", "challenge-1", "project-1", "class-1", "student-1", 1, 1, JSON.stringify(answer), JSON.stringify(rubric), 1, NOW)).not.toThrow();
    const badHistorySnapshot = { ...snapshot, verifiedEvidenceSnapshot: snapshot.verifiedEvidenceSnapshot.map((item, index) => index === 4 ? { ...item, digest: "A".repeat(64) } : item) };
    expect(() => connection.sqlite.prepare("INSERT INTO transfer_challenge_revisions VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("challenge-1", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify(badHistorySnapshot), "OPEN", 0, NOW)).toThrow();
    expect(() => connection.sqlite.prepare("INSERT INTO transfer_challenge_revisions VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("challenge-1", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify({ ...snapshot, prompt: "文".repeat(1001) }), "OPEN", 0, NOW)).toThrow();
    expect(() => connection.sqlite.prepare("UPDATE transfer_attempts SET challenge_revision=2 WHERE id='valid'").run()).toThrow();
    expect(() => connection.sqlite.prepare("UPDATE transfer_attempts SET student_id='student-2',class_id='class-2' WHERE id='valid'").run()).toThrow();
    expect(() => connection.sqlite.prepare(`UPDATE transfer_challenges SET revision=2,
      snapshot_json=json_set(snapshot_json,'$.challengeRevision',2) WHERE id='challenge-1'`).run()).toThrow();
    expect(() => connection.sqlite.prepare("INSERT INTO transfer_challenge_revisions VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("challenge-1", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify(snapshot), "OPEN", 0, NOW)).not.toThrow();
    expect(() => connection.sqlite.prepare("DELETE FROM transfer_challenge_revisions WHERE challenge_id='challenge-1' AND revision=1").run()).toThrow();
    expect(() => connection.sqlite.prepare("UPDATE transfer_challenge_revisions SET revision=2 WHERE challenge_id='challenge-1' AND revision=1").run()).toThrow();
    const invalidHistorySnapshots = [
      { ...snapshot, challengeRevision: 2, culturalPolicy: { ...snapshot.culturalPolicy, allowedAudienceTypes: ["GENERAL_VISITORS", "BOGUS"] } },
      { ...snapshot, challengeRevision: 3, culturalPolicy: { ...snapshot.culturalPolicy, allowedMechanisms: ["COLLECTIVE_RESPONSE", "BOGUS"] } },
      { ...snapshot, challengeRevision: 4, unitPolicy: { ...snapshot.unitPolicy, allowedRelationships: ["LINEAR", "BOGUS"] } },
      { ...snapshot, challengeRevision: 5, culturalPolicy: { ...snapshot.culturalPolicy, allowedTransitions: [
        { before: "PASSIVE_VIEWING", after: "ACTIVE_EXPLORATION" }, { before: "PASSIVE_VIEWING", after: "PASSIVE_VIEWING" },
      ] } },
    ];
    invalidHistorySnapshots.forEach((invalidSnapshot, index) => {
      expect(() => connection.sqlite.prepare("INSERT INTO transfer_challenge_revisions VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run("challenge-1", "project-1", "class-1", "student-1", index + 2, "a".repeat(64), JSON.stringify(invalidSnapshot), "OPEN", 0, NOW)).toThrow();
    });
    expect(() => insert.run("duplicate", "challenge-1", "project-1", "class-1", "student-1", 1, 1, JSON.stringify(answer), JSON.stringify(rubric), 1, NOW)).toThrow();
    expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
    connection.sqlite.close();
  });

  it("upgrades a populated 0009 database without discarding the legacy response", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-transfer-upgrade-")); directories.push(directory);
    const source = path.resolve("drizzle");
    const journal = JSON.parse(await readFile(path.join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const oldEntries = journal.entries.filter(({ idx }) => idx <= 9);
    const partial = path.join(directory, "partial"); await mkdir(path.join(partial, "meta"), { recursive: true });
    await writeFile(path.join(partial, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "sqlite", entries: oldEntries }), "utf8");
    await Promise.all(oldEntries.map(({ tag }) => copyFile(path.join(source, `${tag}.sql`), path.join(partial, `${tag}.sql`))));
    const file = path.join(directory, "db.sqlite"); runMigrations(file, partial); const old = createDb(file); seed(old);
    old.sqlite.prepare("INSERT INTO transfer_challenges VALUES (?,?,?,?,?,?,?)")
      .run("legacy-1", "project-1", "媒介", "改用灯光", '{"student":"original answer"}', '{"score":3}', 1);
    old.sqlite.close();
    runMigrations(file);
    const upgraded = createDb(file);
    expect(upgraded.sqlite.prepare("SELECT response_json,rubric_json,passed FROM legacy_transfer_challenges WHERE id='legacy-1'").get())
      .toEqual({ response_json: '{"student":"original answer"}', rubric_json: '{"score":3}', passed: 1 });
    expect(upgraded.sqlite.prepare("SELECT count(*) count FROM transfer_challenges").get()).toEqual({ count: 0 });
    expect(upgraded.sqlite.prepare("SELECT count(*) count FROM __drizzle_migrations").get()).toEqual({ count: journal.entries.length });
    expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
    upgraded.sqlite.close();
  });

  it("archives populated pre-structural Task8 records when upgrading 0012 to 0013", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-transfer-v1-upgrade-")); directories.push(directory);
    const source = path.resolve("drizzle");
    const journal = JSON.parse(await readFile(path.join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const oldEntries = journal.entries.filter(({ idx }) => idx <= 12);
    const partial = path.join(directory, "through-0012"); await mkdir(path.join(partial, "meta"), { recursive: true });
    await writeFile(path.join(partial, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "sqlite", entries: oldEntries }), "utf8");
    await Promise.all(oldEntries.map(({ tag }) => copyFile(path.join(source, `${tag}.sql`), path.join(partial, `${tag}.sql`))));
    const file = path.join(directory, "db.sqlite"); runMigrations(file, partial); const old = createDb(file); seed(old);
    const oldSnapshot = {
      projectId: "project-1", challengeRevision: 1, changedDimension: "input", prompt: "只改变输入",
      mustRetain: { culturalIntent: "石刻", structure: "输入映射输出", input: "距离", mapping: "线性", output: "投影" },
      change: { dimension: "input", from: "距离", to: "声音" }, path: "DIGISHOW",
      evidenceCodes: ["INPUT_OK"], snapshotHash: "a".repeat(64),
    };
    old.sqlite.prepare("INSERT INTO transfer_challenges VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run("challenge-v1", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify(oldSnapshot), "OPEN", 1, NOW, NOW);
    old.sqlite.prepare("INSERT INTO transfer_attempts VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run("attempt-v1", "challenge-v1", "project-1", "class-1", "student-1", 1, 1,
        JSON.stringify({ retainedStructure: "旧保留", changedParts: "旧改变", normalization: "旧范围", culturalImpact: "旧影响" }),
        JSON.stringify({ criteria: {}, score: 0, passed: false, feedbackCodes: [] }), 0, NOW);
    old.sqlite.close();

    runMigrations(file);
    const upgraded = createDb(file);
    expect(upgraded.sqlite.prepare("SELECT id FROM legacy_transfer_challenges_v1").all()).toEqual([{ id: "challenge-v1" }]);
    expect(upgraded.sqlite.prepare("SELECT id,response_json FROM legacy_transfer_attempts_v1").get()).toMatchObject({ id: "attempt-v1" });
    expect(upgraded.sqlite.prepare("SELECT count(*) count FROM transfer_challenges").get()).toEqual({ count: 0 });
    expect(upgraded.sqlite.prepare("SELECT count(*) count FROM transfer_attempts").get()).toEqual({ count: 0 });
    expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
    upgraded.sqlite.close();
  });

  it("archives populated free-text cultural records when upgrading 0013 to 0014", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-transfer-v2-upgrade-")); directories.push(directory);
    const source = path.resolve("drizzle");
    const journal = JSON.parse(await readFile(path.join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const oldEntries = journal.entries.filter(({ idx }) => idx <= 13);
    const partial = path.join(directory, "through-0013"); await mkdir(path.join(partial, "meta"), { recursive: true });
    await writeFile(path.join(partial, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "sqlite", entries: oldEntries }), "utf8");
    await Promise.all(oldEntries.map(({ tag }) => copyFile(path.join(source, `${tag}.sql`), path.join(partial, `${tag}.sql`))));
    const file = path.join(directory, "db.sqlite"); runMigrations(file, partial); const old = createDb(file); seed(old);
    const oldSnapshot = { ...snapshot, intentTokens: ["石刻记忆"] } as Record<string, unknown>;
    delete oldSnapshot.culturalPolicy;
    const oldAnswer = {
      ...answer,
      culturalImpact: { audience: "现场参观观众", behaviorChange: "观众从靠近改为主动发声参与互动", connectionToIntent: "发声参与仍连接石刻记忆文化意图" },
    };
    const oldRubric = {
      criteria: {
        retainedStructure: { passed: true, reasonCode: "RETAINED_EXACT" },
        changedParts: { passed: true, reasonCode: "CHANGE_EXACT" },
        normalization: { passed: true, reasonCode: "NORMALIZATION_VERIFIABLE" },
        culturalImpact: { passed: true, reasonCode: "CULTURAL_LINK_CONCRETE" },
      }, score: 4, passed: true, feedbackCodes: [],
    };
    old.sqlite.prepare("INSERT INTO transfer_challenges VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run("challenge-v2", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify(oldSnapshot), "PASSED", 1, NOW, NOW);
    old.sqlite.prepare("INSERT INTO transfer_attempts VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run("attempt-v2", "challenge-v2", "project-1", "class-1", "student-1", 1, 1, JSON.stringify(oldAnswer), JSON.stringify(oldRubric), 1, NOW);
    old.sqlite.close();

    runMigrations(file);
    const upgraded = createDb(file);
    expect(upgraded.sqlite.prepare("SELECT id FROM legacy_transfer_challenges_v2").all()).toEqual([{ id: "challenge-v2" }]);
    expect(upgraded.sqlite.prepare("SELECT id,response_json FROM legacy_transfer_attempts_v2").get()).toMatchObject({ id: "attempt-v2" });
    expect(upgraded.sqlite.prepare("SELECT count(*) count FROM transfer_challenges").get()).toEqual({ count: 0 });
    expect(upgraded.sqlite.prepare("SELECT count(*) count FROM transfer_attempts").get()).toEqual({ count: 0 });
    expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
    upgraded.sqlite.close();
  });

  it("preserves populated controlled attempts when upgrading 0014 through the revision history migrations", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-transfer-v3-upgrade-")); directories.push(directory);
    const source = path.resolve("drizzle");
    const journal = JSON.parse(await readFile(path.join(source, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    const oldEntries = journal.entries.filter(({ idx }) => idx <= 14);
    const partial = path.join(directory, "through-0014"); await mkdir(path.join(partial, "meta"), { recursive: true });
    await writeFile(path.join(partial, "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "sqlite", entries: oldEntries }), "utf8");
    await Promise.all(oldEntries.map(({ tag }) => copyFile(path.join(source, `${tag}.sql`), path.join(partial, `${tag}.sql`))));
    const file = path.join(directory, "db.sqlite"); runMigrations(file, partial); const old = createDb(file); seed(old);
    const retryRubric = {
      ...rubric,
      criteria: { ...rubric.criteria, retainedStructure: { passed: false, reasonCode: "RETAINED_MISMATCH" } },
      score: 3, passed: false, outcome: "OPEN",
      feedback: { ...rubric.feedback, retained: true },
    };
    old.sqlite.prepare("INSERT INTO transfer_challenges VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run("challenge-v3", "project-1", "class-1", "student-1", 1, "a".repeat(64), JSON.stringify(snapshot), "OPEN", 1, NOW, NOW);
    old.sqlite.prepare("INSERT INTO transfer_attempts VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run("attempt-v3", "challenge-v3", "project-1", "class-1", "student-1", 1, 1, JSON.stringify(answer), JSON.stringify(retryRubric), 0, NOW);
    old.sqlite.close();
    runMigrations(file);
    const upgraded = createDb(file);
    const migrated = upgraded.sqlite.prepare("SELECT rubric_json,challenge_revision FROM transfer_attempts WHERE id='attempt-v3'").get() as { rubric_json: string; challenge_revision: number };
    expect(JSON.parse(migrated.rubric_json).outcome).toBe("RETRY");
    expect(migrated.challenge_revision).toBe(1);
    expect(upgraded.sqlite.pragma("foreign_key_check")).toEqual([]);
    upgraded.sqlite.close();
  });
});
