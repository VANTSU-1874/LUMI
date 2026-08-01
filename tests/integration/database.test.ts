import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const NOW = 1_700_000_000;
const TRANSFER_SNAPSHOT_JSON = JSON.stringify({
  projectId: "project-1", challengeRevision: 1, changedDimension: "input", prompt: "保留其余维度，只改变输入",
  mustRetain: { culturalIntent: "石刻记忆", structure: "输入映射输出", input: "距离", mapping: "线性", output: "投影" },
  change: { candidateId: "sound-db", dimension: "input", from: "距离", to: "声音" },
  unitPolicy: {
    sourceKind: "SOUND", sourceUnit: "dB", sourceRanges: [{ unit: "dB", minInclusive: 20, maxInclusive: 130 }],
    targetMin: 0, targetMax: 1, targetUnit: "normalized", allowedRelationships: ["LINEAR"],
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
});

describe("SQLite persistence", () => {
  let temporaryDirectory: string;
  let databasePath: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "tonggan-db-"));
    databasePath = path.join(temporaryDirectory, "nested", "course.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
  });

  afterEach(async () => {
    connection?.sqlite.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  function seedBaseCourse() {
    connection.sqlite.exec(`
      INSERT INTO classes (id, name, access_code) VALUES
        ('class-1', '交互媒体一班', 'CLASS001'),
        ('class-2', '交互媒体二班', 'CLASS002');
      INSERT INTO users (id, class_id, role, alias, created_at) VALUES
        ('student-1', 'class-1', 'STUDENT', '小满', ${NOW}),
        ('student-2', 'class-2', 'STUDENT', '谷雨', ${NOW});
      INSERT INTO course_modules (id, class_id, sequence, title, hours, focus) VALUES
        ('module-1', 'class-1', 1, '六元逻辑卡', 2, '逻辑设计'),
        ('module-2', 'class-2', 1, '工具实践', 2, '技术实现');
      INSERT INTO assignments
        (id, class_id, module_id, title, brief, allowed_tools, created_at) VALUES
        ('assignment-1', 'class-1', 'module-1', '逻辑卡作业', '完成逻辑卡', '["DIGISHOW"]', ${NOW}),
        ('assignment-2', 'class-2', 'module-2', '工具作业', '完成原型', '["TOUCHDESIGNER"]', ${NOW});
    `);
  }

  function insertProject({
    id = "project-1",
    assignmentId = "assignment-1",
    studentId = "student-1",
    classId = "class-1",
    stage = "LOGIC_CARD",
  } = {}) {
    const columns = connection.sqlite.prepare("PRAGMA table_info(projects)").all() as {
      name: string;
    }[];
    const hasClassId = columns.some(({ name }) => name === "class_id");

    if (hasClassId) {
      connection.sqlite
        .prepare(
          "INSERT INTO projects (id, class_id, assignment_id, student_id, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(id, classId, assignmentId, studentId, stage, NOW, NOW);
      return;
    }

    connection.sqlite
      .prepare(
        "INSERT INTO projects (id, assignment_id, student_id, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, assignmentId, studentId, stage, NOW, NOW);
  }

  function expectJsonValid(table: string, column: string) {
    const row = connection.sqlite
      .prepare(`SELECT json_valid(${column}) AS valid FROM ${table} LIMIT 1`)
      .get() as { valid: number };
    expect(row.valid).toBe(1);
  }

  it("creates every course table through migrations", () => {
    const rows = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%' ORDER BY name",
      )
      .all() as { name: string }[];

    expect(rows.map(({ name }) => name)).toEqual(
      [
        "action_rate_limits",
        "agent_actions",
        "agent_artwork_attachments",
        "agent_conversations",
        "agent_critiques",
        "agent_decision_reviews",
        "agent_external_search_consents",
        "agent_messages",
        "agent_project_briefs",
        "agent_run_artwork_inputs",
        "agent_run_controls",
        "agent_run_events",
        "agent_runs",
        "agent_runtime_events",
        "agent_session_summaries",
        "agent_steps",
        "agent_student_memory",
        "agent_tool_calls",
        "agent_turns",
        "assignments",
        "auth_account",
        "auth_rate_limits",
        "auth_session",
        "auth_user",
        "auth_verification",
        "audit_events",
        "classes",
        "course_modules",
        "course_pack_profiles",
        "design_project_tasks",
        "evidence",
        "evidence_recovery_locks",
        "hint_evidence_consumptions",
        "hint_records",
        "knowledge_chunks",
        "learner_profiles",
        "legacy_transfer_attempts_v1",
        "legacy_transfer_attempts_v2",
        "legacy_transfer_challenges",
        "legacy_transfer_challenges_v1",
        "legacy_transfer_challenges_v2",
        "logic_cards",
        "projects",
        "student_identity_codes",
        "teacher_decisions",
        "tool_path_plans",
        "transfer_attempts",
        "transfer_challenge_revisions",
        "transfer_challenges",
        "troubleshooting_runs",
        "users",
      ].sort(),
    );
  });

  it("can apply the full migration chain repeatedly", () => {
    connection.sqlite.close();
    runMigrations(databasePath);
    connection = createDb(databasePath);

    const table = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'student_identity_codes'",
      )
      .get() as { name: string } | undefined;
    expect(table?.name).toBe("student_identity_codes");
  });

  it("enforces external-search consent integrity and task ownership in SQLite", () => {
    seedBaseCourse();
    connection.sqlite.prepare(`
      INSERT INTO design_project_tasks(
        id,student_id,class_id,title,status,created_at,updated_at,data_type
      ) VALUES(?,?,?,?,?,?,?,?)
    `).run("task-consent", "student-1", "class-1", "授权测试", "ACTIVE", NOW, NOW, "REAL");
    const insertConsent = (input: {
      nonce: string;
      studentId?: string;
      classId?: string;
      digest?: string;
      issuedAt?: number;
      consumedAt?: number;
      dataType?: string;
    }) => connection.sqlite.prepare(`
      INSERT INTO agent_external_search_consents(
        nonce,student_id,class_id,task_id,message_digest,issued_at_ms,consumed_at_ms,
        run_id,used_at_ms,data_type
      ) VALUES(?,?,?,?,?,?,?,NULL,NULL,?)
    `).run(
      input.nonce,
      input.studentId ?? "student-1",
      input.classId ?? "class-1",
      "task-consent",
      input.digest ?? "a".repeat(64),
      input.issuedAt ?? 1_700_000_000_000,
      input.consumedAt ?? 1_700_000_000_000,
      input.dataType ?? "REAL",
    );

    expect(() => insertConsent({ nonce: "bad-digest", digest: "not-a-digest" }))
      .toThrow(/CHECK constraint failed/);
    expect(() => insertConsent({
      nonce: "over-ttl",
      consumedAt: 1_700_000_600_001,
    })).toThrow(/CHECK constraint failed/);
    expect(() => insertConsent({
      nonce: "future-issued",
      issuedAt: 1_700_000_031_000,
    })).toThrow(/CHECK constraint failed/);
    expect(() => insertConsent({ nonce: "bad-data-type", dataType: "UNKNOWN" }))
      .toThrow(/CHECK constraint failed/);
    expect(() => insertConsent({
      nonce: "wrong-owner",
      studentId: "student-2",
      classId: "class-2",
    })).toThrow(/FOREIGN KEY constraint failed/);

    insertConsent({ nonce: "valid-consent" });
    connection.sqlite.prepare("DELETE FROM design_project_tasks WHERE id=?").run("task-consent");
    expect(connection.sqlite.prepare(
      "SELECT count(*) count FROM agent_external_search_consents WHERE nonce=?",
    ).get("valid-consent")).toEqual({ count: 0 });
  });

  it("enables foreign key enforcement on every connection", () => {
    const pragma = connection.sqlite.prepare("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    };

    expect(pragma.foreign_keys).toBe(1);
  });

  it("records class ownership on projects", () => {
    const columns = connection.sqlite.prepare("PRAGMA table_info(projects)").all() as {
      name: string;
    }[];

    expect(columns.map(({ name }) => name)).toContain("class_id");
  });

  it("creates the private artwork attachment ownership schema", () => {
    const columns = connection.sqlite
      .prepare("PRAGMA table_info(agent_artwork_attachments)")
      .all() as { name: string; notnull: number }[];
    const indexes = connection.sqlite
      .prepare("PRAGMA index_list(agent_artwork_attachments)")
      .all() as { name: string; unique: number }[];

    expect(columns.map(({ name }) => name)).toEqual([
      "id", "task_id", "turn_id", "student_id", "class_id", "mime_type",
      "storage_path", "digest", "byte_size", "width", "height", "created_at",
      "updated_at", "data_type",
    ]);
    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "agent_artwork_attachments_turn_unique", unique: 1 }),
      expect.objectContaining({ name: "agent_artwork_attachments_student_created_idx", unique: 0 }),
    ]));
  });

  it("rejects duplicate aliases within a class", () => {
    seedBaseCourse();

    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO users (id, class_id, role, alias, created_at) VALUES ('student-3', 'class-1', 'STUDENT', '小满', ?)",
        )
        .run(NOW),
    ).toThrow();
  });

  it("rejects duplicate module sequences within a class", () => {
    seedBaseCourse();

    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO course_modules (id, class_id, sequence, title, hours, focus) VALUES ('module-3', 'class-1', 1, '重复模块', 2, '重复序号')",
        )
        .run(),
    ).toThrow();
  });

  it("rejects an assignment that uses another class module", () => {
    seedBaseCourse();

    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO assignments (id, class_id, module_id, title, brief, allowed_tools, created_at) VALUES ('assignment-cross', 'class-1', 'module-2', '跨班作业', '不允许', '[\"DIGISHOW\"]', ?)",
        )
        .run(NOW),
    ).toThrow();
  });

  it("rejects a project that uses another class student", () => {
    seedBaseCourse();

    expect(() =>
      insertProject({ studentId: "student-2", classId: "class-1" }),
    ).toThrow();
  });

  it("rejects a user with an invalid role", () => {
    connection.sqlite
      .prepare("INSERT INTO classes (id, name, access_code) VALUES ('class-1', '一班', 'C1')")
      .run();

    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO users (id, class_id, role, alias, created_at) VALUES ('admin-1', 'class-1', 'ADMIN', '管理员', ?)",
        )
        .run(NOW),
    ).toThrow();
  });

  it("rejects a negative authentication failure count", () => {
    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO auth_rate_limits (key_hash, failures, window_started_at, blocked_until, updated_at) VALUES (?, -1, ?, NULL, ?)",
        )
        .run("a".repeat(64), NOW, NOW),
    ).toThrow();
  });

  it("rejects an identity claim whose user belongs to another class", () => {
    seedBaseCourse();
    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO student_identity_codes (code_digest, class_id, claimed_user_id, created_at, claimed_at) VALUES (?, 'class-1', 'student-2', ?, ?)",
        )
        .run("b".repeat(64), NOW, NOW),
    ).toThrow();
  });

  it("rejects a partially claimed identity code", () => {
    connection.sqlite
      .prepare("INSERT INTO classes (id, name, access_code) VALUES ('class-1', '一班', 'C1')")
      .run();
    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO student_identity_codes (code_digest, class_id, claimed_user_id, created_at, claimed_at) VALUES (?, 'class-1', NULL, ?, ?)",
        )
        .run("c".repeat(64), NOW, NOW),
    ).toThrow();
  });

  it("rejects a learner profile with an invalid level", () => {
    seedBaseCourse();

    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO learner_profiles (user_id, level, decomposition, signal_understanding, mapping_design, troubleshooting, transfer, updated_at) VALUES ('student-1', 'L99', 1, 2, 3, 4, 1, ?)",
        )
        .run(NOW),
    ).toThrow();
  });

  it.each([-1, 999])("rejects an out-of-range learner score: %s", (score) => {
    seedBaseCourse();

    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO learner_profiles (user_id, level, decomposition, signal_understanding, mapping_design, troubleshooting, transfer, updated_at) VALUES ('student-1', 'L2', ?, 2, 3, 4, 1, ?)",
        )
        .run(score, NOW),
    ).toThrow();
  });

  it("stores legal half-point learner scores without integer rounding", () => {
    seedBaseCourse();

    connection.sqlite.prepare(
      "INSERT INTO learner_profiles (user_id, level, decomposition, signal_understanding, mapping_design, troubleshooting, transfer, updated_at) VALUES ('student-1', 'L3', 3.5, 3.5, 3.5, 3.5, 3.5, ?)",
    ).run(NOW);

    expect(connection.sqlite.prepare(
      "SELECT decomposition, signal_understanding, mapping_design, troubleshooting, transfer FROM learner_profiles WHERE user_id='student-1'",
    ).get()).toEqual({
      decomposition: 3.5,
      signal_understanding: 3.5,
      mapping_design: 3.5,
      troubleshooting: 3.5,
      transfer: 3.5,
    });
  });

  it("rejects non-half-point learner scores on both insert and update", () => {
    seedBaseCourse();
    const scoreColumns = [
      "decomposition",
      "signal_understanding",
      "mapping_design",
      "troubleshooting",
      "transfer",
    ] as const;
    const insert = connection.sqlite.prepare(
      "INSERT INTO learner_profiles (user_id, level, decomposition, signal_understanding, mapping_design, troubleshooting, transfer, updated_at) VALUES ('student-1', 'L3', ?, ?, ?, ?, ?, ?)",
    );
    for (const [invalidIndex] of scoreColumns.entries()) {
      const scores = scoreColumns.map((_column, index) => index === invalidIndex ? 3.25 : 3.5);
      expect(() => insert.run(...scores, NOW)).toThrow();
    }

    connection.sqlite.prepare(
      "INSERT INTO learner_profiles (user_id, level, decomposition, signal_understanding, mapping_design, troubleshooting, transfer, updated_at) VALUES ('student-1', 'L3', 3.5, 3.5, 3.5, 3.5, 3.5, ?)",
    ).run(NOW);
    for (const column of scoreColumns) {
      expect(() => connection.sqlite.prepare(
        `UPDATE learner_profiles SET ${column}=3.25 WHERE user_id='student-1'`,
      ).run()).toThrow();
    }
    expect(connection.sqlite.prepare(
      "SELECT decomposition,signal_understanding,mapping_design,troubleshooting,transfer FROM learner_profiles WHERE user_id='student-1'",
    ).get()).toEqual({
      decomposition: 3.5,
      signal_understanding: 3.5,
      mapping_design: 3.5,
      troubleshooting: 3.5,
      transfer: 3.5,
    });
  });

  it("rejects a project with an invalid stage", () => {
    seedBaseCourse();

    expect(() => insertProject({ stage: "NO_SUCH_STAGE" })).toThrow();
  });

  it("rejects evidence with an invalid kind", () => {
    seedBaseCourse();
    insertProject();

    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO evidence (id, project_id, kind, label, content, created_at) VALUES ('evidence-1', 'project-1', 'AUDIO', '非法类型', 'x', ?)",
        )
        .run(NOW),
    ).toThrow();
  });

  it("rejects a troubleshooting run with an invalid status", () => {
    seedBaseCourse();
    insertProject();

    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO troubleshooting_runs (id, project_id, symptom, current_layer, state_json, status, revision, created_at, updated_at) VALUES ('run-1', 'project-1', '无响应', 'INPUT', '{}', 'IGNORED', 1, ?, ?)",
        )
        .run(NOW, NOW),
    ).toThrow();
  });

  it("requires troubleshooting state to be an object consistent with layer and status columns", () => {
    seedBaseCourse();
    insertProject();
    const insert = connection.sqlite.prepare(`
      INSERT INTO troubleshooting_runs
        (id, project_id, symptom, current_layer, state_json, status, revision, created_at, updated_at)
      VALUES (?, 'project-1', '无响应', 'INPUT', ?, 'ACTIVE', 1, ${NOW}, ${NOW})
    `);
    expect(() => insert.run("run-array-state", "[]")).toThrow();
    expect(() => insert.run(
      "run-mismatched-state",
      '{"currentLayer":"OUTPUT","status":"ACTIVE"}',
    )).toThrow();
    expect(() => insert.run(
      "run-snake-state",
      '{"current_layer":"INPUT","status":"ACTIVE"}',
    )).not.toThrow();
  });

  it("enforces composite evidence ownership and verification semantics", () => {
    seedBaseCourse();
    insertProject();
    const insert = connection.sqlite.prepare(`
      INSERT INTO evidence
        (id, project_id, class_id, student_id, evidence_sequence, kind, signal_layer, confirmed_code,
         verification_status, storage_status, label, content, content_digest, probe_json, original_name, created_at)
      VALUES (?, 'project-1', ?, ?, ?, 'PROBE', ?, ?, ?, 'READY', '探针', '{}', ?, '{}', NULL, ${NOW})
    `);

    expect(() => insert.run("cross-project-class", "class-2", "student-2", 1, "INPUT", "INPUT_OK", "RULE_VERIFIED", "a".repeat(64))).toThrow();
    expect(() => insert.run("cross-student-class", "class-1", "student-2", 1, "INPUT", "INPUT_OK", "RULE_VERIFIED", "b".repeat(64))).toThrow();
    expect(() => insert.run("wrong-layer-code", "class-1", "student-1", 1, "INPUT", "OUTPUT_OK", "RULE_VERIFIED", "c".repeat(64))).toThrow();
    expect(() => insert.run("verified-without-code", "class-1", "student-1", 1, "INPUT", null, "RULE_VERIFIED", "d".repeat(64))).toThrow();
    expect(() => insert.run("submitted-with-code", "class-1", "student-1", 1, "INPUT", "INPUT_OK", "SUBMITTED", "e".repeat(64))).toThrow();
    expect(() => insert.run("valid-evidence", "class-1", "student-1", 1, "INPUT", "INPUT_OK", "RULE_VERIFIED", "f".repeat(64))).not.toThrow();
    expect(() => insert.run("duplicate-sequence", "class-1", "student-1", 1, "INPUT", "INPUT_OK", "RULE_VERIFIED", "1".repeat(64))).toThrow();
  });

  it("requires probe_json if and only if evidence kind is PROBE", () => {
    seedBaseCourse();
    insertProject();
    const insert = connection.sqlite.prepare(`
      INSERT INTO evidence
        (id, project_id, class_id, student_id, evidence_sequence, kind, signal_layer, confirmed_code,
         verification_status, storage_status, label, content, content_digest, probe_json, original_name, created_at)
      VALUES (?, 'project-1', 'class-1', 'student-1', 1, ?, 'INPUT', ?, ?, 'READY', '证据', '{}', ?, ?, NULL, ${NOW})
    `);
    expect(() => insert.run(
      "probe-without-json", "PROBE", "INPUT_OK", "RULE_VERIFIED", "a".repeat(64), null,
    )).toThrow();
    expect(() => insert.run(
      "text-with-probe-json", "TEXT", null, "SUBMITTED", "b".repeat(64), "{}",
    )).toThrow();
  });

  it("binds a hint consumption to the exact evidence sequence and digest", () => {
    seedBaseCourse();
    insertProject();
    connection.sqlite.exec(`
      INSERT INTO evidence
        (id, project_id, class_id, student_id, evidence_sequence, kind, signal_layer, confirmed_code,
         verification_status, storage_status, label, content, content_digest, probe_json, original_name, created_at)
      VALUES ('evidence-exact', 'project-1', 'class-1', 'student-1', 1, 'PROBE', 'INPUT', 'INPUT_OK',
        'RULE_VERIFIED', 'READY', '探针', '{}', '${"a".repeat(64)}', '{}', NULL, ${NOW});
      INSERT INTO hint_records
        (id, project_id, class_id, student_id, hint_sequence, evidence_sequence_watermark, context_hash,
         hint_level, response_json, created_at)
      VALUES ('hint-exact', 'project-1', 'class-1', 'student-1', 1, 1, '${"b".repeat(64)}', 3, '{}', ${NOW});
    `);
    const consume = connection.sqlite.prepare(`
      INSERT INTO hint_evidence_consumptions
        (evidence_id, hint_record_id, project_id, student_id, class_id, evidence_sequence, content_digest, consumed_at)
      VALUES ('evidence-exact', 'hint-exact', 'project-1', 'student-1', 'class-1', ?, ?, ${NOW})
    `);
    expect(() => consume.run(2, "a".repeat(64))).toThrow();
    expect(() => consume.run(1, "c".repeat(64))).toThrow();
  });

  it("exposes the composite ownership indexes and has no foreign-key violations", () => {
    const evidenceIndexes = connection.sqlite.pragma("index_list('evidence')") as Array<{ name: string }>;
    const hintIndexes = connection.sqlite.pragma("index_list('hint_records')") as Array<{ name: string }>;
    expect(evidenceIndexes.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "evidence_id_project_student_class_unique",
      "evidence_exact_consumption_unique",
      "evidence_project_student_sequence_unique",
    ]));
    expect(hintIndexes.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "hint_records_id_project_student_class_unique",
      "hint_records_project_student_sequence_unique",
    ]));
    expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  const invalidBooleanCases = [
    {
      field: "logic_cards.rule_ready",
      sql: "INSERT INTO logic_cards (project_id, payload_json, rule_ready, semantic_ready, semantic_review_json) VALUES ('project-1', '{}', 2, 0, '{}')",
    },
    {
      field: "logic_cards.semantic_ready",
      sql: "INSERT INTO logic_cards (project_id, payload_json, rule_ready, semantic_ready, semantic_review_json) VALUES ('project-1', '{}', 1, 2, '{}')",
    },
  ];

  it.each(invalidBooleanCases)("rejects invalid boolean in $field", ({ sql }) => {
    seedBaseCourse();
    insertProject();

    expect(() => connection.sqlite.prepare(sql).run()).toThrow();
  });

  const invalidJsonCases = [
    {
      field: "assignments.allowed_tools",
      sql: `INSERT INTO assignments (id, class_id, module_id, title, brief, allowed_tools, created_at)
        VALUES ('assignment-json', 'class-1', 'module-1', 'JSON', 'JSON', 'not-json', ${NOW})`,
    },
    {
      field: "logic_cards.payload_json",
      sql: "INSERT INTO logic_cards (project_id, payload_json, rule_ready, semantic_ready, semantic_review_json) VALUES ('project-1', 'not-json', 1, 0, '{}')",
    },
    {
      field: "logic_cards.semantic_review_json",
      sql: "INSERT INTO logic_cards (project_id, payload_json, rule_ready, semantic_ready, semantic_review_json) VALUES ('project-1', '{}', 1, 0, 'not-json')",
    },
    {
      field: "troubleshooting_runs.state_json",
      sql: `INSERT INTO troubleshooting_runs (id, project_id, symptom, current_layer, state_json, status, revision, created_at, updated_at)
        VALUES ('run-json', 'project-1', '无响应', 'INPUT', 'not-json', 'ACTIVE', 1, ${NOW}, ${NOW})`,
    },
    {
      field: "transfer_challenges.snapshot_json",
      sql: `INSERT INTO transfer_challenges (id,project_id,class_id,student_id,revision,snapshot_hash,snapshot_json,status,attempt_count,created_at,updated_at)
        VALUES ('transfer-json','project-1','class-1','student-1',1,'${"a".repeat(64)}','not-json','OPEN',0,${NOW},${NOW})`,
    },
    {
      field: "audit_events.payload_json",
      sql: `INSERT INTO audit_events (id, user_id, type, payload_json, created_at)
        VALUES ('audit-json', 'student-1', 'LOGIN', 'not-json', ${NOW})`,
    },
    {
      field: "knowledge_chunks.tags",
      sql: "INSERT INTO knowledge_chunks (id, source, title, tags, content) VALUES ('chunk-json', '课程', '标题', 'not-json', '内容')",
    },
  ];

  it.each(invalidJsonCases)("rejects invalid JSON in $field", ({ sql }) => {
    seedBaseCourse();
    insertProject();

    expect(() => connection.sqlite.prepare(sql).run()).toThrow();
  });

  it("accepts valid JSON in every structured field", () => {
    seedBaseCourse();
    insertProject();
    connection.sqlite.exec(`
      INSERT INTO logic_cards
        (project_id, payload_json, rule_ready, semantic_ready, semantic_review_json)
        VALUES ('project-1', '{"culturalIntent":"传播石刻文化","participantAction":"观众触摸屏幕","inputSignal":"触摸位置坐标","mappingRule":"按区域映射内容","outputMedium":"投影画面变化","experienceFeedback":"观众看到回应"}', 1, 0, '{"status":"PENDING"}');
      INSERT INTO troubleshooting_runs
        (id, project_id, symptom, current_layer, state_json, status, revision, created_at, updated_at)
        VALUES ('run-1', 'project-1', '无响应', 'INPUT', '{"currentLayer":"INPUT","status":"ACTIVE"}', 'ACTIVE', 1, ${NOW}, ${NOW});
      INSERT INTO transfer_challenges
        (id,project_id,class_id,student_id,revision,snapshot_hash,snapshot_json,status,attempt_count,created_at,updated_at)
        VALUES ('transfer-1','project-1','class-1','student-1',1,'${"a".repeat(64)}',
          '${TRANSFER_SNAPSHOT_JSON}',
          'OPEN',0,${NOW},${NOW});
      INSERT INTO audit_events
        (id, user_id, type, payload_json, created_at)
        VALUES ('audit-1', 'student-1', 'LOGIN', '{"source":"course"}', ${NOW});
      INSERT INTO knowledge_chunks
        (id, source, title, tags, content)
        VALUES ('chunk-1', '课程', '逻辑卡', '["逻辑","交互"]', '知识内容');
    `);

    expectJsonValid("assignments", "allowed_tools");
    expectJsonValid("logic_cards", "payload_json");
    expectJsonValid("logic_cards", "semantic_review_json");
    expectJsonValid("troubleshooting_runs", "state_json");
    expectJsonValid("transfer_challenges", "snapshot_json");
    expectJsonValid("audit_events", "payload_json");
    expectJsonValid("knowledge_chunks", "tags");
  });

  it("rejects a logic card without a semantic review record", () => {
    seedBaseCourse();
    insertProject();

    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO logic_cards (project_id, payload_json, rule_ready, semantic_ready, semantic_review_json) VALUES ('project-1', '{}', 1, 0, NULL)",
        )
        .run(),
    ).toThrow();
  });

  it("cascades project-owned records when a project is deleted", () => {
    seedBaseCourse();
    insertProject();
    connection.sqlite.exec(`
      INSERT INTO logic_cards (project_id, payload_json, rule_ready, semantic_ready, semantic_review_json)
        VALUES ('project-1', '{}', 1, 0, '{}');
      INSERT INTO evidence
        (id, project_id, class_id, student_id, evidence_sequence, kind, signal_layer, confirmed_code,
         verification_status, storage_status, label, content, content_digest, probe_json, original_name, created_at)
        VALUES ('evidence-1', 'project-1', 'class-1', 'student-1', 1, 'TEXT', 'INPUT', NULL,
          'SUBMITTED', 'READY', '文本', '内容', '${"a".repeat(64)}', NULL, NULL, ${NOW});
      INSERT INTO troubleshooting_runs
        (id, project_id, symptom, current_layer, state_json, status, revision, created_at, updated_at)
        VALUES ('run-1', 'project-1', '无响应', 'INPUT', '{"currentLayer":"INPUT","status":"ACTIVE"}', 'ACTIVE', 1, ${NOW}, ${NOW});
      INSERT INTO transfer_challenges VALUES ('transfer-1','project-1','class-1','student-1',1,'${"a".repeat(64)}',
        '${TRANSFER_SNAPSHOT_JSON}',
        'OPEN',0,${NOW},${NOW});
    `);

    expect(() =>
      connection.sqlite.prepare("DELETE FROM projects WHERE id = 'project-1'").run(),
    ).not.toThrow();
    for (const table of [
      "logic_cards",
      "evidence",
      "troubleshooting_runs",
      "transfer_challenges",
    ]) {
      const row = connection.sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
        count: number;
      };
      expect(row.count).toBe(0);
    }
  });

  it("cascades learner profiles when a user is deleted", () => {
    seedBaseCourse();
    connection.sqlite
      .prepare(
        "INSERT INTO learner_profiles VALUES ('student-1', 'L2', 1, 2, 3, 4, 1, ?)",
      )
      .run(NOW);

    expect(() =>
      connection.sqlite.prepare("DELETE FROM users WHERE id = 'student-1'").run(),
    ).not.toThrow();
    const row = connection.sqlite
      .prepare("SELECT count(*) AS count FROM learner_profiles")
      .get() as { count: number };
    expect(row.count).toBe(0);
  });

  it("rejects a user that references a missing class", () => {
    expect(() =>
      connection.sqlite
        .prepare(
          "INSERT INTO users (id, class_id, role, alias, created_at) VALUES ('orphan', 'missing-class', 'STUDENT', '无班级学生', ?)",
        )
        .run(NOW),
    ).toThrow();
  });

  it("closes SQLite when connection initialization fails", () => {
    const closeSpy = vi.spyOn(Database.prototype, "close");
    const pragmaSpy = vi
      .spyOn(Database.prototype, "pragma")
      .mockImplementationOnce(() => {
        throw new Error("pragma failed");
      });

    try {
      expect(() => createDb(":memory:")).toThrow("pragma failed");
      expect(closeSpy).toHaveBeenCalledTimes(1);
    } finally {
      pragmaSpy.mockRestore();
      closeSpy.mockRestore();
    }
  });
});
