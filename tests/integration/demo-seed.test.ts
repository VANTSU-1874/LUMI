// @vitest-environment node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync } from "node:fs";
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { readStudentDashboard } from "@/lib/services/student-dashboard";
import { listTeacherClasses, readClassAnalytics, readLearnerDetail } from "@/lib/services/teacher-analytics";
import { DEMO_CASES } from "@/data/demo/cases";
import { LUMI_D017_STORYLINE } from "@/data/demo/lumi-d017";
import { validateEvidenceProbe } from "@/lib/domain/evidence-probe";
import { DemoSeedConflictError, digestD017Storyline, seedDemoDatabase } from "@/scripts/seed-demo";
import { cleanupResetBackups, resetDatabase, ResetBackupCleanupError, UnsafeResetTargetError, validateResetTargets } from "@/scripts/reset-db";

const PEPPER = "demo-test-identity-pepper-at-least-32-characters";
const roots: string[] = [];
const require = createRequire(import.meta.url);
const MIGRATION_COUNT = (JSON.parse(readFileSync(
  path.join(process.cwd(), "drizzle", "meta", "_journal.json"),
  "utf8",
)) as { entries: unknown[] }).entries.length;

async function workspaceTemp(prefix: string) {
  const runtimeRoot = path.join(process.cwd(), ".runtime");
  await mkdir(runtimeRoot, { recursive: true });
  return await mkdtemp(path.join(runtimeRoot, prefix));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function demoDatabase() {
  const root = await workspaceTemp("demo-test-");
  roots.push(root);
  const databasePath = path.join(root, "course-demo.sqlite");
  const artworkRoot = path.join(root, "private-artworks");
  return { root, databasePath, artworkRoot };
}

function databaseFingerprint(databasePath: string) {
  const connection = createDb(databasePath);
  try {
    const rows = connection.sqlite.prepare(`
      SELECT 'users' table_name,id,alias value,data_type FROM users
      UNION ALL SELECT 'learner_profiles',user_id,level,data_type FROM learner_profiles
      UNION ALL SELECT 'projects',id,stage,data_type FROM projects
      UNION ALL SELECT 'evidence',id,verification_status,data_type FROM evidence
      UNION ALL SELECT 'design_project_tasks',id,status,data_type FROM design_project_tasks
      UNION ALL SELECT 'agent_conversations',id,course_pack_id,data_type FROM agent_conversations
      UNION ALL SELECT 'agent_turns',id,decision_code,data_type FROM agent_turns
      UNION ALL SELECT 'agent_artwork_attachments',id,digest,data_type FROM agent_artwork_attachments
      UNION ALL SELECT 'agent_critiques',id,framework_version,data_type FROM agent_critiques
      UNION ALL SELECT 'agent_session_summaries',task_id,summary,data_type FROM agent_session_summaries
      UNION ALL SELECT 'agent_student_memory',id,kind,data_type FROM agent_student_memory
      UNION ALL SELECT 'audit_events',id,type,json_extract(payload_json,'$.dataType') FROM audit_events
      ORDER BY table_name,id
    `).all();
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  } finally {
    connection.sqlite.close();
  }
}

describe("truthful demonstration catalogue", () => {
  it("defines the three fixed tool paths with bounded, auditable learning evidence", () => {
    expect(DEMO_CASES.map(({ path: toolPath }) => toolPath)).toEqual([
      "DIGISHOW",
      "TOUCHDESIGNER",
      "COLLABORATIVE",
    ]);
    expect(DEMO_CASES.map(({ title }) => title)).toEqual([
      "DigiShow距离输入到三档灯光",
      "TouchDesigner声音振幅到粒子密度",
      "DigiShow距离归一化经OSC驱动安岳石刻视觉",
    ]);
    for (const item of DEMO_CASES) {
      expect(item.dataType).toBe("DEMONSTRATION_DATA");
      expect(item.weakInitialIdea.length).toBeGreaterThan(8);
      expect(Object.values(item.approvedLogicCard).every((value) => value.length >= 4)).toBe(true);
      expect(item.evidence).toHaveLength(5);
      expect(item.evidence.every((record) => record.dataType === "DEMONSTRATION_DATA" && record.kind === "PROBE")).toBe(true);
      expect(item.evidence.map((record) => validateEvidenceProbe({ kind: record.kind, label: record.label, signalLayer: record.signalLayer, probe: record.probe }))).toEqual(
        item.evidence.map((record) => ({ verificationStatus: "RULE_VERIFIED", confirmedCode: record.code })),
      );
      expect(item.injectedFault.dataType).toBe("DEMONSTRATION_DATA");
      expect(item.transfer.dataType).toBe("DEMONSTRATION_DATA");
      expect(item.transfer.attempt.dataType).toBe("DEMONSTRATION_DATA");
      expect(item.injectedFault.expectedLayer).toMatch(/^(INPUT|MAPPING|TRANSPORT|BINDING|OUTPUT)$/);
      expect(item.transfer.status).toBe("PASSED");
      expect(item.transfer.attempt).toBeDefined();
      expect(JSON.stringify(item)).toContain("演示");
      expect(JSON.stringify(item)).not.toMatch(/真实学生效果|通过率|提升\d+%/);
    }
    expect(DEMO_CASES[2]?.evidence.some((record) => record.probe.type === "TRANSPORT_RECEIPT")).toBe(true);
  });
});

describe("deterministic demonstration seed", () => {
  it("lets eight independent processes migrate and seed the same new database consistently", async () => {
    const { databasePath, artworkRoot } = await demoDatabase();
    const cli = require.resolve("tsx/cli");
    const worker = path.join(process.cwd(), "tests", "helpers", "concurrent-demo-seed-worker.ts");
    const run = () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [cli, worker, databasePath, PEPPER, artworkRoot], { cwd: process.cwd(), windowsHide: true });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`seed worker ${code}: ${stderr}`)));
    });
    const workers = await Promise.allSettled(Array.from({ length: 8 }, run));
    expect(workers.every(({ status }) => status === "fulfilled"), workers.filter(({ status }) => status === "rejected").map((item) => String((item as PromiseRejectedResult).reason)).join("\n"))
      .toBe(true);
    const connection = createDb(databasePath);
    try {
      expect(connection.sqlite.prepare("SELECT count(*) count FROM __drizzle_migrations").get()).toEqual({ count: MIGRATION_COUNT });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM users WHERE role='STUDENT'").get()).toEqual({ count: 5 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM evidence").get()).toEqual({ count: 15 });
      expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally { connection.sqlite.close(); }
  }, 60_000);
  it("is transactional and idempotent while preserving explicit data provenance", async () => {
    const { databasePath, artworkRoot } = await demoDatabase();
    const options = { databasePath, artworkRoot, identityCodePepper: PEPPER, allowDemoSeed: true, nodeEnv: "test" } as const;
    const first = await seedDemoDatabase(options);
    const firstHash = databaseFingerprint(databasePath);
    const second = await seedDemoDatabase(options);
    const secondHash = databaseFingerprint(databasePath);

    expect(secondHash).toBe(firstHash);
    expect(second).toEqual(first);
    expect(first.classCode).toBe("DIGI2026");
    expect(first.identityCodes).toHaveLength(5);
    expect(first.starterIdentityCode).toBe("4P6R-8T2W-Y5BC");
    expect(first.identityCodes.every((code) => /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2}$/.test(code))).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/digest|pepper|secret|hash/i);

    const connection = createDb(databasePath);
    try {
      expect(connection.sqlite.prepare("SELECT hours FROM course_modules ORDER BY sequence").all()).toEqual([
        { hours: 8 }, { hours: 16 }, { hours: 24 }, { hours: 16 },
      ]);
      expect(connection.sqlite.prepare("SELECT count(*) count FROM users WHERE role='STUDENT' AND data_type='DEMONSTRATION_DATA'").get()).toEqual({ count: 5 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM learner_profiles WHERE data_type='DEMONSTRATION_DATA'").get()).toEqual({ count: 4 });
      expect(connection.sqlite.prepare("SELECT level FROM learner_profiles ORDER BY level").all()).toEqual([
        { level: "L1" }, { level: "L2" }, { level: "L3" }, { level: "L4" },
      ]);
      expect(connection.sqlite.prepare("SELECT count(*) count FROM projects WHERE data_type='DEMONSTRATION_DATA'").get()).toEqual({ count: 4 });
      expect(connection.sqlite.prepare("SELECT stage FROM projects WHERE id='demo-project-e'").get()).toEqual({ stage: "DIAGNOSTIC" });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM evidence WHERE data_type='DEMONSTRATION_DATA'").get()).toEqual({ count: 15 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM evidence WHERE kind='PROBE' AND json_valid(probe_json) AND verification_status='RULE_VERIFIED'").get()).toEqual({ count: 15 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM evidence WHERE project_id='demo-project-c' AND signal_layer='TRANSPORT' AND json_extract(probe_json,'$.type')='TRANSPORT_RECEIPT'").get()).toEqual({ count: 1 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM transfer_attempts").get()).toEqual({ count: 3 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM audit_events WHERE type='DEMO_RECORD_SEEDED' AND json_extract(payload_json,'$.dataType')='DEMONSTRATION_DATA'").get()).toEqual({ count: 3 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM design_project_tasks WHERE student_id='demo-student-c' AND data_type='DEMONSTRATION_DATA'").get()).toEqual({ count: 2 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_conversations WHERE student_id='demo-student-c' AND data_type='DEMONSTRATION_DATA'").get()).toEqual({ count: 2 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_turns t JOIN agent_conversations c ON c.id=t.conversation_id WHERE c.student_id='demo-student-c' AND t.data_type='DEMONSTRATION_DATA'").get()).toEqual({ count: 3 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_artwork_attachments WHERE student_id='demo-student-c' AND data_type='DEMONSTRATION_DATA'").get()).toEqual({ count: 2 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_critiques WHERE student_id='demo-student-c' AND data_type='DEMONSTRATION_DATA'").get()).toEqual({ count: 2 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_session_summaries WHERE student_id='demo-student-c' AND data_type='DEMONSTRATION_DATA'").get()).toEqual({ count: 2 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM agent_student_memory WHERE student_id='demo-student-c' AND data_type='DEMONSTRATION_DATA'").get()).toEqual({ count: 3 });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM audit_events WHERE id='demo-audit-d017-agent-history' AND data_type='DEMONSTRATION_DATA'").get()).toEqual({ count: 1 });
      for (const artwork of LUMI_D017_STORYLINE.artworks) {
        const row = connection.sqlite.prepare("SELECT storage_path storagePath,digest,byte_size byteSize,width,height FROM agent_artwork_attachments WHERE id=?")
          .get(artwork.id) as { storagePath: string; digest: string; byteSize: number; width: number; height: number };
        expect(row).toMatchObject({ width: artwork.seedAttachment.width, height: artwork.seedAttachment.height });
        const stored = await readFile(path.join(artworkRoot, ...row.storagePath.split("/")));
        expect(stored.byteLength).toBe(row.byteSize);
        expect(createHash("sha256").update(stored).digest("hex")).toBe(row.digest);
      }
      expect(connection.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      connection.sqlite.close();
    }
  });

  it("rolls back D-017 rows and removes newly copied private artwork when a late audit conflict occurs", async () => {
    const { databasePath, artworkRoot } = await demoDatabase();
    const options = { databasePath, artworkRoot, identityCodePepper: PEPPER, allowDemoSeed: true, nodeEnv: "test" } as const;
    await seedDemoDatabase(options);
    const artworkPaths = LUMI_D017_STORYLINE.artworks.map((artwork) => path.join(
      artworkRoot,
      `artwork-${artwork.taskId}`,
      `${artwork.id}.png`,
    ));
    const conflict = createDb(databasePath);
    try {
      conflict.sqlite.transaction(() => {
        conflict.sqlite.prepare("DELETE FROM agent_session_summaries WHERE student_id='demo-student-c'").run();
        conflict.sqlite.prepare("DELETE FROM agent_student_memory WHERE student_id='demo-student-c'").run();
        conflict.sqlite.prepare("DELETE FROM agent_conversations WHERE student_id='demo-student-c'").run();
        const changedOwnershipHash = digestD017Storyline({
          ...LUMI_D017_STORYLINE,
          artworks: LUMI_D017_STORYLINE.artworks.map((artwork, index) => index === 0
            ? { ...artwork, studentId: "demo-student-z" }
            : artwork),
        });
        expect(changedOwnershipHash).not.toBe(digestD017Storyline(LUMI_D017_STORYLINE));
        conflict.sqlite.prepare("UPDATE audit_events SET payload_json=? WHERE id='demo-audit-d017-agent-history'")
          .run(JSON.stringify({
            dataType: "DEMONSTRATION_DATA",
            studentId: LUMI_D017_STORYLINE.identity.studentId,
            projectId: LUMI_D017_STORYLINE.identity.projectId,
            storylineVersion: 1,
            storylineHash: changedOwnershipHash,
          }));
      }).immediate();
    } finally {
      conflict.sqlite.close();
    }
    await Promise.all(artworkPaths.map((file) => rm(file, { force: true })));

    await expect(seedDemoDatabase(options)).rejects.toThrow("DEMO_SEED_CONFLICT:d017-audit");
    const checked = createDb(databasePath);
    try {
      expect(checked.sqlite.prepare("SELECT count(*) count FROM agent_conversations WHERE student_id='demo-student-c'").get())
        .toEqual({ count: 0 });
      expect(checked.sqlite.prepare("SELECT count(*) count FROM agent_artwork_attachments WHERE student_id='demo-student-c'").get())
        .toEqual({ count: 0 });
      expect(checked.sqlite.prepare("SELECT count(*) count FROM agent_critiques WHERE student_id='demo-student-c'").get())
        .toEqual({ count: 0 });
      expect(checked.sqlite.prepare("SELECT count(*) count FROM design_project_tasks WHERE student_id='demo-student-c'").get())
        .toEqual({ count: 2 });
    } finally {
      checked.sqlite.close();
    }
    for (const file of artworkPaths) await expect(access(file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("adds the interactive starter to an existing v2 demo catalogue without rewriting audit history", async () => {
    const { databasePath, artworkRoot } = await demoDatabase();
    const options = { databasePath, artworkRoot, identityCodePepper: PEPPER, allowDemoSeed: true, nodeEnv: "test" } as const;
    await seedDemoDatabase(options);
    const legacy = createDb(databasePath);
    let originalAuditPayloads: unknown[] = [];
    try {
      originalAuditPayloads = legacy.sqlite.prepare("SELECT id,payload_json FROM audit_events WHERE type='DEMO_RECORD_SEEDED' ORDER BY id").all();
      legacy.sqlite.exec(`
        DELETE FROM projects WHERE id='demo-project-e';
        DELETE FROM student_identity_codes WHERE claimed_user_id='demo-student-e';
        DELETE FROM users WHERE id='demo-student-e';
      `);
    } finally {
      legacy.sqlite.close();
    }

    await expect(seedDemoDatabase(options)).resolves.toMatchObject({ starterIdentityCode: "4P6R-8T2W-Y5BC" });
    const upgraded = createDb(databasePath);
    try {
      expect(upgraded.sqlite.prepare("SELECT stage,data_type FROM projects WHERE id='demo-project-e'").get())
        .toEqual({ stage: "DIAGNOSTIC", data_type: "DEMONSTRATION_DATA" });
      expect(upgraded.sqlite.prepare("SELECT id,payload_json FROM audit_events WHERE type='DEMO_RECORD_SEEDED' ORDER BY id").all())
        .toEqual(originalAuditPayloads);
    } finally {
      upgraded.sqlite.close();
    }
  });

  it("fails with a typed conflict and rolls back all demo records instead of overwriting an existing row", async () => {
    const { databasePath, artworkRoot } = await demoDatabase();
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.prepare("INSERT INTO classes(id,name,access_code) VALUES(?,?,?)")
        .run("demo-class-digi2026", "不应被覆盖的现有班级", "REAL-CODE");
    } finally {
      connection.sqlite.close();
    }

    await expect(seedDemoDatabase({ databasePath, artworkRoot, identityCodePepper: PEPPER, allowDemoSeed: true, nodeEnv: "test" }))
      .rejects.toBeInstanceOf(DemoSeedConflictError);
    const checked = createDb(databasePath);
    try {
      expect(checked.sqlite.prepare("SELECT name,access_code FROM classes WHERE id='demo-class-digi2026'").get())
        .toEqual({ name: "不应被覆盖的现有班级", access_code: "REAL-CODE" });
      expect(checked.sqlite.prepare("SELECT count(*) count FROM course_modules").get()).toEqual({ count: 0 });
      expect(checked.sqlite.prepare("SELECT count(*) count FROM users").get()).toEqual({ count: 0 });
    } finally {
      checked.sqlite.close();
    }
  });

  it("detects a conflicting learner profile and rolls back records inserted earlier in the transaction", async () => {
    const { databasePath, artworkRoot } = await demoDatabase();
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite.exec(`
        INSERT INTO classes(id,name,access_code) VALUES('demo-class-digi2026','数字交互文创设计·竞赛演示班','DIGI2026');
        INSERT INTO users(id,class_id,role,alias,created_at) VALUES('demo-student-a','demo-class-digi2026','STUDENT','演示学习者A',1783872000);
        INSERT INTO learner_profiles(user_id,level,decomposition,signal_understanding,mapping_design,troubleshooting,transfer,updated_at)
          VALUES('demo-student-a','L4',4,4,4,4,4,1783872000);
      `);
    } finally {
      connection.sqlite.close();
    }

    await expect(seedDemoDatabase({ databasePath, artworkRoot, identityCodePepper: PEPPER, allowDemoSeed: true, nodeEnv: "test" }))
      .rejects.toThrow("DEMO_SEED_CONFLICT:profile:demo-student-a");
    const checked = createDb(databasePath);
    try {
      expect(checked.sqlite.prepare("SELECT level,decomposition FROM learner_profiles WHERE user_id='demo-student-a'").get())
        .toEqual({ level: "L4", decomposition: 4 });
      expect(checked.sqlite.prepare("SELECT count(*) count FROM course_modules").get()).toEqual({ count: 0 });
      expect(checked.sqlite.prepare("SELECT count(*) count FROM users WHERE id='demo-teacher'").get()).toEqual({ count: 0 });
      expect(checked.sqlite.prepare("SELECT count(*) count FROM student_identity_codes").get()).toEqual({ count: 0 });
    } finally {
      checked.sqlite.close();
    }
  });

  it("refuses production or unlabelled database paths by default", async () => {
    const root = await workspaceTemp("seed-unsafe-");
    roots.push(root);
    const artworkRoot = path.join(root, "private-artworks");
    await expect(seedDemoDatabase({ databasePath: path.join(root, "course.sqlite"), artworkRoot, identityCodePepper: PEPPER, allowDemoSeed: true, nodeEnv: "test" }))
      .rejects.toThrow(/demo|dev|test/i);
    await expect(seedDemoDatabase({ databasePath: path.join(root, "course-demo.sqlite"), artworkRoot, identityCodePepper: PEPPER, allowDemoSeed: false, nodeEnv: "production" }))
      .rejects.toThrow(/production|ALLOW_DEMO_SEED/i);
  });
});

describe("demo visibility and AI fallback", () => {
  it("excludes demo learners by default and separates them only after explicit inclusion", async () => {
    const { databasePath, artworkRoot } = await demoDatabase();
    await seedDemoDatabase({ databasePath, artworkRoot, identityCodePepper: PEPPER, allowDemoSeed: true, nodeEnv: "test" });
    const connection = createDb(databasePath);
    try {
      expect(listTeacherClasses(connection.db).classes).toEqual([]);
      const includedClasses = listTeacherClasses(connection.db, { includeDemo: true });
      expect(includedClasses.classes[0]).toMatchObject({ realStudents: 0, demoStudents: 5 });

      const defaultAnalytics = readClassAnalytics(connection.db, "demo-class-digi2026");
      expect(defaultAnalytics.students).toEqual([]);
      expect(defaultAnalytics.dataCounts).toEqual({ real: 0, demonstration: 5, included: 0 });
      expect(defaultAnalytics.metricsByDataType.DEMONSTRATION_DATA.stages.every(({ count }) => count === 0)).toBe(true);

      const included = readClassAnalytics(connection.db, "demo-class-digi2026", { includeDemo: true });
      expect(included.students).toHaveLength(5);
      expect(included.students.every((student) => student.dataType === "DEMONSTRATION_DATA")).toBe(true);
      expect(included.dataCounts).toEqual({ real: 0, demonstration: 5, included: 5 });
      expect(included.stages.every(({ count }) => count === 0)).toBe(true);
      expect(included.metricsByDataType.REAL.stages.every(({ count }) => count === 0)).toBe(true);
      expect(included.metricsByDataType.DEMONSTRATION_DATA.stages.find(({ stage }) => stage === "COMPLETE")?.count).toBe(3);
      expect(included.metricsByDataType.DEMONSTRATION_DATA.stages.find(({ stage }) => stage === "DIAGNOSTIC")?.count).toBe(1);
      expect(included.metricsByDataType.DEMONSTRATION_DATA.profiles.levels).toEqual([
        { key: "L1", count: 1 }, { key: "L2", count: 1 }, { key: "L3", count: 1 }, { key: "L4", count: 1 },
      ]);
      expect(() => readLearnerDetail(connection.db, "demo-class-digi2026", "demo-student-a")).toThrow(/NOT_FOUND/);
      expect(readLearnerDetail(connection.db, "demo-class-digi2026", "demo-student-a", { includeDemo: true }).student.dataType)
        .toBe("DEMONSTRATION_DATA");
    } finally {
      connection.sqlite.close();
    }
  });

  it("publishes deterministic fallback without pretending semantic AI approval", async () => {
    const { databasePath, artworkRoot } = await demoDatabase();
    await seedDemoDatabase({ databasePath, artworkRoot, identityCodePepper: PEPPER, allowDemoSeed: true, nodeEnv: "test" });
    const connection = createDb(databasePath);
    try {
      const dashboard = readStudentDashboard(
        connection.db,
        { userId: "demo-student-a", role: "STUDENT" },
        { aiMode: "DETERMINISTIC_FALLBACK" },
      );
      expect(dashboard.aiMode).toBe("DETERMINISTIC_FALLBACK");
      expect(dashboard.dataType).toBe("DEMONSTRATION_DATA");
      expect(dashboard.profile?.dataType).toBe("DEMONSTRATION_DATA");
      expect(dashboard.logicCard).toMatchObject({ status: "APPROVED", semanticReady: true, source: "DEMONSTRATION_DATA" });
      expect(dashboard.toolPath?.path).toBe("DIGISHOW");
      expect(dashboard.transfer?.status).toBe("PASSED");
    } finally {
      connection.sqlite.close();
    }
  });
});

describe("guarded reset target validation", () => {
  it("rejects directory databases, file evidence roots, and overlapping targets", async () => {
    const { root } = await demoDatabase();
    const databaseDirectory = path.join(root, "database-demo");
    const evidenceFile = path.join(root, "evidence-demo-file");
    await mkdir(databaseDirectory);
    await writeFile(evidenceFile, "not a directory");
    expect(() => validateResetTargets({ workspaceRoot: process.cwd(), databasePath: databaseDirectory, evidenceRoot: path.join(root, "evidence-demo"), nodeEnv: "test" })).toThrow(UnsafeResetTargetError);
    expect(() => validateResetTargets({ workspaceRoot: process.cwd(), databasePath: path.join(root, "course-demo.sqlite"), evidenceRoot: evidenceFile, nodeEnv: "test" })).toThrow(UnsafeResetTargetError);
    const evidenceRoot = path.join(root, "evidence-demo");
    await mkdir(evidenceRoot);
    expect(() => validateResetTargets({ workspaceRoot: process.cwd(), databasePath: path.join(evidenceRoot, "course-demo.sqlite"), evidenceRoot, nodeEnv: "test" })).toThrow(UnsafeResetTargetError);
  });

  it("preserves the committed replacement database when backup cleanup fails and reports retryable leftovers", async () => {
    const { root, databasePath } = await demoDatabase();
    const evidenceRoot = path.join(root, "evidence-demo");
    await mkdir(path.join(evidenceRoot, "demo"), { recursive: true });
    await writeFile(databasePath, "old database bytes");
    await writeFile(path.join(evidenceRoot, "demo", "old.txt"), "old demo evidence");
    const attempts: string[] = [];
    let cleanupError: ResetBackupCleanupError | undefined;
    try {
      await resetDatabase({
        workspaceRoot: process.cwd(), databasePath, evidenceRoot, nodeEnv: "test",
        cleanupRemove: (target, options) => {
          attempts.push(target);
          if (attempts.length === 2) throw new Error("injected cleanup failure");
          rmSync(target, options);
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ResetBackupCleanupError);
      cleanupError = error as ResetBackupCleanupError;
    }
    expect(cleanupError).toBeDefined();
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    const replacement = createDb(databasePath);
    try { expect(replacement.sqlite.prepare("SELECT count(*) count FROM __drizzle_migrations").get()).toEqual({ count: MIGRATION_COUNT }); }
    finally { replacement.sqlite.close(); }
    expect(cleanupError?.remainingBackups).toHaveLength(1);
    cleanupResetBackups(cleanupError?.remainingBackups ?? []);
    for (const backup of cleanupError?.remainingBackups ?? []) await expect(access(backup)).rejects.toThrow();
  });
  it("accepts only explicit demo/dev/test targets inside the real workspace", async () => {
    const root = await workspaceTemp("reset-demo-");
    roots.push(root);
    const evidenceRoot = path.join(root, "evidence-demo");
    await mkdir(evidenceRoot);
    expect(validateResetTargets({
      workspaceRoot: process.cwd(),
      databasePath: path.join(root, "course-demo.sqlite"),
      evidenceRoot,
      nodeEnv: "test",
    })).toMatchObject({ databasePath: path.join(root, "course-demo.sqlite"), demoEvidencePath: path.join(evidenceRoot, "demo") });
  });

  it.each([
    ["production database", "C:\\production.sqlite", path.join(process.cwd(), "data", "demo-evidence")],
    ["UNC", "\\\\server\\share\\demo.sqlite", path.join(process.cwd(), "data", "demo-evidence")],
    ["drive root", "C:\\", path.join(process.cwd(), "data", "demo-evidence")],
    ["outside workspace", path.join(path.parse(process.cwd()).root, "tmp-demo.sqlite"), path.join(process.cwd(), "data", "demo-evidence")],
  ])("rejects unsafe %s", (_label, databasePath, evidenceRoot) => {
    expect(() => validateResetTargets({ workspaceRoot: process.cwd(), databasePath, evidenceRoot, nodeEnv: "test" }))
      .toThrow(UnsafeResetTargetError);
  });

  it("stages every SQLite sidecar and only the demo evidence subtree before rebuilding", async () => {
    const { root, databasePath } = await demoDatabase();
    const evidenceRoot = path.join(root, "evidence-demo");
    await mkdir(path.join(evidenceRoot, "demo"), { recursive: true });
    await Promise.all([
      writeFile(databasePath, "old-db"), writeFile(`${databasePath}-wal`, "old-wal"),
      writeFile(`${databasePath}-shm`, "old-shm"), writeFile(`${databasePath}-journal`, "old-journal"),
      writeFile(path.join(evidenceRoot, "demo", "old.txt"), "demo evidence"),
      writeFile(path.join(evidenceRoot, "keep.txt"), "real evidence stays"),
    ]);
    await resetDatabase({ workspaceRoot: process.cwd(), databasePath, evidenceRoot, nodeEnv: "test" });
    const connection = createDb(databasePath);
    try { expect(connection.sqlite.prepare("SELECT count(*) count FROM classes").get()).toEqual({ count: 0 }); }
    finally { connection.sqlite.close(); }
    await expect(access(`${databasePath}-wal`)).rejects.toThrow();
    await expect(access(`${databasePath}-shm`)).rejects.toThrow();
    await expect(access(`${databasePath}-journal`)).rejects.toThrow();
    await expect(access(path.join(evidenceRoot, "demo"))).rejects.toThrow();
    expect(await readFile(path.join(evidenceRoot, "keep.txt"), "utf8")).toBe("real evidence stays");
  });

  it("restores the database, all sidecars and demo evidence when post-stage seeding fails", async () => {
    const { root, databasePath } = await demoDatabase();
    const evidenceRoot = path.join(root, "evidence-demo");
    await mkdir(path.join(evidenceRoot, "demo"), { recursive: true });
    const files = new Map([
      [databasePath, "old-db"], [`${databasePath}-wal`, "old-wal"], [`${databasePath}-shm`, "old-shm"],
      [`${databasePath}-journal`, "old-journal"], [path.join(evidenceRoot, "demo", "old.txt"), "old-evidence"],
    ]);
    await Promise.all([...files].map(([file, contents]) => writeFile(file, contents)));
    await expect(resetDatabase({
      workspaceRoot: process.cwd(), databasePath, evidenceRoot, nodeEnv: "test",
      seedDemo: true, allowDemoSeed: true, identityCodePepper: "too-short",
    })).rejects.toThrow();
    for (const [file, contents] of files) expect(await readFile(file, "utf8")).toBe(contents);
  });

  it("rejects a symbolic-link database target", async () => {
    const { root } = await demoDatabase();
    const target = path.join(root, "real-demo.sqlite");
    const link = path.join(root, "linked-demo.sqlite");
    await writeFile(target, "x");
    try { await symlink(target, link, "file"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    expect(() => validateResetTargets({ workspaceRoot: process.cwd(), databasePath: link, evidenceRoot: path.join(root, "evidence-demo"), nodeEnv: "test" }))
      .toThrow(UnsafeResetTargetError);
  });

  it("rejects a database path whose parent junction resolves outside the workspace", async () => {
    const { root } = await demoDatabase();
    const outside = await mkdtemp(path.join(tmpdir(), "tonggan-reset-outside-"));
    roots.push(outside);
    const junction = path.join(root, "junction-demo");
    await symlink(outside, junction, "junction");
    expect(() => validateResetTargets({
      workspaceRoot: process.cwd(),
      databasePath: path.join(junction, "course-demo.sqlite"),
      evidenceRoot: path.join(root, "evidence-demo"),
      nodeEnv: "test",
    })).toThrow(UnsafeResetTargetError);
  });

  it("rejects canonically overlapping reset targets reached through an in-workspace junction without touching files", async () => {
    const { root } = await demoDatabase();
    const evidenceRoot = path.join(root, "evidence-demo");
    const demoDirectory = path.join(evidenceRoot, "demo");
    const sentinel = path.join(demoDirectory, "keep.txt");
    await mkdir(demoDirectory, { recursive: true });
    await writeFile(sentinel, "must remain unchanged");
    const alias = path.join(root, "alias-demo");
    await symlink(evidenceRoot, alias, "junction");
    const databasePath = path.join(alias, "demo", "course-demo.sqlite");

    await expect(resetDatabase({ workspaceRoot: process.cwd(), databasePath, evidenceRoot, nodeEnv: "test" }))
      .rejects.toBeInstanceOf(UnsafeResetTargetError);
    expect(await readFile(sentinel, "utf8")).toBe("must remain unchanged");
    await expect(access(databasePath)).rejects.toThrow();
  });

  it("accepts deep nonexistent database targets when their canonical expected path is separate", async () => {
    const { root } = await demoDatabase();
    const evidenceRoot = path.join(root, "evidence-demo");
    await mkdir(evidenceRoot);
    expect(() => validateResetTargets({
      workspaceRoot: process.cwd(),
      databasePath: path.join(root, "nested-demo", "deep", "course-demo.sqlite"),
      evidenceRoot,
      nodeEnv: "test",
    })).not.toThrow();
    expect(() => validateResetTargets({
      workspaceRoot: process.cwd(),
      databasePath: path.join(root, "ordinary-demo.sqlite"),
      evidenceRoot,
      nodeEnv: "test",
    })).not.toThrow();
  });
});

describe("0023 provenance migration history", () => {
  it("upgrades an existing 0022 database without rewriting real records", async () => {
    const { root, databasePath } = await demoDatabase();
    const oldMigrations = path.join(root, "drizzle-through-0022");
    await cp(path.join(process.cwd(), "drizzle"), oldMigrations, { recursive: true });
    await rm(path.join(oldMigrations, "0023_chubby_felicia_hardy.sql"));
    const journalPath = path.join(oldMigrations, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: unknown[] };
    const fullMigrationCount = journal.entries.length;
    journal.entries = journal.entries.slice(0, 23);
    await writeFile(journalPath, JSON.stringify(journal));
    runMigrations(databasePath, oldMigrations);
    const old = createDb(databasePath);
    try {
      old.sqlite.exec("INSERT INTO classes(id,name,access_code) VALUES('legacy','历史班','LEGACY'); INSERT INTO users(id,class_id,role,alias,created_at) VALUES('legacy-student','legacy','STUDENT','匿名',1700000000); INSERT INTO learner_profiles(user_id,level,decomposition,signal_understanding,mapping_design,troubleshooting,transfer,updated_at) VALUES('legacy-student','L2',2,2,2,2,2,1700000000);");
    } finally { old.sqlite.close(); }
    runMigrations(databasePath);
    const upgraded = createDb(databasePath);
    try {
      expect(upgraded.sqlite.prepare("SELECT id,alias,data_type FROM users WHERE id='legacy-student'").get())
        .toEqual({ id: "legacy-student", alias: "匿名", data_type: "REAL" });
      expect(upgraded.sqlite.prepare("SELECT user_id,level,data_type FROM learner_profiles WHERE user_id='legacy-student'").get())
        .toEqual({ user_id: "legacy-student", level: "L2", data_type: "REAL" });
      expect(upgraded.sqlite.prepare("SELECT count(*) count FROM __drizzle_migrations").get()).toEqual({ count: fullMigrationCount });
    } finally { upgraded.sqlite.close(); }
  });
});
