// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { evidence, projects } from "@/lib/db/schema";
import {
  UnsafeEvidencePathError,
  initializeEvidenceRoot,
  recoverPendingEvidence,
  saveEvidence,
} from "@/lib/services/evidence";
import { validPng } from "@/tests/helpers/image-fixtures";
import {
  EvidenceRecoveryLockLostError,
  EvidenceRecoveryLockTimeoutError,
  recoverEvidenceStorage,
} from "@/lib/services/evidence-recovery";

const actor = { userId: "student-1", role: "STUDENT" } as const;

describe("evidence storage recovery", () => {
  let directory: string;
  let root: string;
  let databasePath: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-recovery-"));
    root = path.join(directory, "private-evidence");
    databasePath = path.join(directory, "course.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes VALUES ('class-1', '一班', 'CLASS001');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES ('student-1', 'class-1', 'STUDENT', '匿名-1', 1700000000);
      INSERT INTO course_modules VALUES ('module-1', 'class-1', 1, '搭建', 2, '信号');
      INSERT INTO assignments VALUES ('assignment-1', 'class-1', 'module-1', '作业', '简介', '["DIGISHOW"]', 1700000000);
      INSERT INTO projects VALUES ('project-1', 'class-1', 'assignment-1', 'student-1', 'BUILD', 1700000000, 1700000000, 0);
    `);
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  function insertPending(id: string, digest: string, createdAt = 1_700_000_000) {
    connection.sqlite.prepare(`
      INSERT INTO evidence
        (id, project_id, class_id, student_id, evidence_sequence, kind, signal_layer, confirmed_code,
         verification_status, storage_status, label, content, content_digest, probe_json, original_name, created_at)
      VALUES (?, 'project-1', 'class-1', 'student-1', 1, 'IMAGE', 'INPUT', NULL,
        'SUBMITTED', 'PENDING', '截图', ?, ?, NULL, 'shot.png', ?)
    `).run(id, `project-1/${id}.png`, digest, createdAt);
  }

  function deletionTombstone(directory: string, evidenceId: string, extension = ".png") {
    return path.join(directory, `.deleting-${evidenceId}-${randomUUID()}${extension}`);
  }

  it("finalizes a complete pending image and is idempotent", async () => {
    const id = randomUUID();
    const digest = createHash("sha256").update(validPng).digest("hex");
    insertPending(id, digest);
    await mkdir(path.join(root, "project-1"), { recursive: true });
    const finalPath = path.join(root, "project-1", `${id}.png`);
    await writeFile(finalPath, validPng);
    await utimes(finalPath, new Date(0), new Date(0));

    await expect(recoverPendingEvidence(connection.db, { root })).resolves.toEqual({
      finalized: 1, removed: 0, skippedPending: 0, removedTemps: 0, removedOrphans: 0,
    });
    expect(connection.db.select().from(evidence).get()?.storageStatus).toBe("READY");
    await expect(recoverPendingEvidence(connection.db, { root })).resolves.toEqual({
      finalized: 0, removed: 0, skippedPending: 0, removedTemps: 0, removedOrphans: 0,
    });
    await expect(readFile(path.join(root, "project-1", `${id}.png`))).resolves.toEqual(validPng);
  });

  it("never moves a TRANSFER project back to TROUBLESHOOT while finalizing", async () => {
    const id = randomUUID();
    const digest = createHash("sha256").update(validPng).digest("hex");
    insertPending(id, digest);
    connection.sqlite.prepare("UPDATE projects SET stage='TRANSFER' WHERE id='project-1'").run();
    await mkdir(path.join(root, "project-1"), { recursive: true });
    const finalPath = path.join(root, "project-1", `${id}.png`);
    await writeFile(finalPath, validPng);
    await utimes(finalPath, new Date(0), new Date(0));

    await recoverPendingEvidence(connection.db, { root });
    expect(connection.db.select().from(projects).get()?.stage).toBe("TRANSFER");
  });

  it("skips a fresh pending row and file until both exceed the grace period", async () => {
    const now = new Date();
    const id = randomUUID();
    const digest = createHash("sha256").update(validPng).digest("hex");
    insertPending(id, digest, Math.floor(now.getTime() / 1_000));
    const finalPath = path.join(root, "project-1", `${id}.png`);
    await mkdir(path.dirname(finalPath), { recursive: true });
    await writeFile(finalPath, validPng);

    await expect(recoverPendingEvidence(connection.db, {
      root, now, pendingGraceMs: 60_000,
    })).resolves.toMatchObject({ finalized: 0, removed: 0, skippedPending: 1 });
    expect(connection.db.select().from(evidence).get()?.storageStatus).toBe("PENDING");
    await expect(readFile(finalPath)).resolves.toEqual(validPng);
  });

  it("removes missing pending rows and stale owned temp files without touching unknown files", async () => {
    const id = randomUUID();
    insertPending(id, "a".repeat(64), 0);
    const projectDirectory = path.join(root, "project-1");
    await mkdir(projectDirectory, { recursive: true });
    const temp = path.join(projectDirectory, `.${id}.tmp`);
    const unknown = path.join(projectDirectory, "keep-me.bin");
    await writeFile(temp, "partial");
    await writeFile(unknown, "owner-unknown");
    await utimes(temp, new Date(0), new Date(0));

    await expect(recoverPendingEvidence(connection.db, {
      root, now: new Date(2_000_000), tempMaxAgeMs: 1_000,
    })).resolves.toEqual({
      finalized: 0, removed: 1, skippedPending: 0, removedTemps: 0, removedOrphans: 0,
    });
    expect(connection.db.select().from(evidence).all()).toHaveLength(0);
    await expect(readFile(temp)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(unknown, "utf8")).resolves.toBe("owner-unknown");
  });

  it("removes only old strict-UUID final orphans after the configured grace period", async () => {
    const ready = await saveEvidence(connection.db, actor, "project-1", {
      kind: "IMAGE", label: "已引用", signalLayer: "INPUT", bytes: validPng,
      declaredMime: "image/png", originalName: "ready.png",
    }, { root });
    const readyBytes = await readFile(path.join(root, ready.content));
    const projectDirectory = path.join(root, "project-1");
    const oldOrphan = path.join(projectDirectory, `${randomUUID()}.png`);
    const recentOrphan = path.join(projectDirectory, `${randomUUID()}.jpg`);
    const unknown = path.join(projectDirectory, "not-a-uuid.png");
    await writeFile(oldOrphan, validPng);
    await writeFile(recentOrphan, validPng);
    await writeFile(unknown, validPng);
    await utimes(oldOrphan, new Date(0), new Date(0));
    await utimes(unknown, new Date(0), new Date(0));

    const result = await recoverPendingEvidence(connection.db, {
      root, now: new Date(2_000_000), orphanGraceMs: 1_000,
    } as Parameters<typeof recoverPendingEvidence>[1] & { orphanGraceMs: number });
    expect(result).toMatchObject({ removedOrphans: 1 });
    await expect(readFile(oldOrphan)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(recentOrphan)).resolves.toEqual(validPng);
    await expect(readFile(unknown)).resolves.toEqual(validPng);
    await expect(readFile(path.join(root, ready.content))).resolves.toEqual(readyBytes);
  });

  it("removes an old strict-UUID temp without a DB row but preserves unknown temp names", async () => {
    const projectDirectory = path.join(root, "project-1");
    await mkdir(projectDirectory, { recursive: true });
    const orphanTemp = path.join(projectDirectory, `.${randomUUID()}.tmp`);
    const unknownTemp = path.join(projectDirectory, ".unknown.tmp");
    await writeFile(orphanTemp, "old-owned-temp");
    await writeFile(unknownTemp, "unknown-temp");
    await utimes(orphanTemp, new Date(0), new Date(0));
    await utimes(unknownTemp, new Date(0), new Date(0));

    await expect(recoverPendingEvidence(connection.db, {
      root, now: new Date(2_000_000), tempMaxAgeMs: 1_000,
    })).resolves.toMatchObject({ removedTemps: 1 });
    await expect(access(orphanTemp)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(unknownTemp, "utf8")).resolves.toBe("unknown-temp");
  });

  it("removes a fresh strict tombstone immediately when deletion already committed in the database", async () => {
    const projectDirectory = path.join(root, "project-1");
    await mkdir(projectDirectory, { recursive: true });
    const tombstone = deletionTombstone(projectDirectory, randomUUID());
    const lookalike = path.join(projectDirectory, ".deleting-not-owned");
    await writeFile(tombstone, "deleted-private-image");
    await writeFile(lookalike, "unknown");
    await utimes(lookalike, new Date(0), new Date(0));
    await expect(recoverPendingEvidence(connection.db, {
      root, now: new Date(), deletionGraceMs: 60_000,
    }))
      .resolves.toMatchObject({ removedTemps: 1 });
    await expect(access(tombstone)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(lookalike, "utf8")).resolves.toBe("unknown");
  });

  it("preserves a fresh deletion tombstone while its READY database row still exists", async () => {
    const now = new Date();
    const ready = await saveEvidence(connection.db, actor, "project-1", {
      kind: "IMAGE", label: "事务中截图", signalLayer: "INPUT", bytes: validPng,
      declaredMime: "image/png", originalName: "in-flight.png",
    }, { root });
    const original = path.join(root, ready.content);
    const tombstone = deletionTombstone(path.dirname(original), ready.id);
    await rename(original, tombstone);

    await expect(recoverPendingEvidence(connection.db, {
      root, now, deletionGraceMs: 60_000,
    })).resolves.toMatchObject({ finalized: 0, removedTemps: 0 });
    await expect(access(original)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(tombstone)).resolves.toBeInstanceOf(Buffer);
  });

  it("atomically restores an aged deletion tombstone when its READY database row still exists", async () => {
    const ready = await saveEvidence(connection.db, actor, "project-1", {
      kind: "IMAGE", label: "事务回滚截图", signalLayer: "INPUT", bytes: validPng,
      declaredMime: "image/png", originalName: "rollback.png",
    }, { root });
    const original = path.join(root, ready.content);
    const storedBytes = await readFile(original);
    const tombstone = deletionTombstone(path.dirname(original), ready.id);
    await rename(original, tombstone);
    await utimes(tombstone, new Date(0), new Date(0));

    await expect(recoverPendingEvidence(connection.db, {
      root, now: new Date(2_000_000), deletionGraceMs: 1_000,
    })).resolves.toMatchObject({ finalized: 1, removedTemps: 0 });
    await expect(readFile(original)).resolves.toEqual(storedBytes);
    await expect(access(tombstone)).rejects.toMatchObject({ code: "ENOENT" });
    expect(connection.sqlite.prepare("SELECT storage_status FROM evidence WHERE id=?").get(ready.id))
      .toEqual({ storage_status: "READY" });
  });

  it("fails closed for a tombstone whose row is not a bound READY image", async () => {
    const id = randomUUID();
    insertPending(id, "a".repeat(64), Math.floor(Date.now() / 1_000));
    const projectDirectory = path.join(root, "project-1");
    const tombstone = deletionTombstone(projectDirectory, id);
    await mkdir(projectDirectory, { recursive: true });
    await writeFile(tombstone, "pending-image");
    await utimes(tombstone, new Date(0), new Date(0));

    await expect(recoverPendingEvidence(connection.db, {
      root, now: new Date(), pendingGraceMs: 60_000, deletionGraceMs: 1,
    })).resolves.toMatchObject({ finalized: 0, removedTemps: 0, skippedPending: 1 });
    await expect(readFile(tombstone, "utf8")).resolves.toBe("pending-image");
  });

  it("fails closed for a strict tombstone associated with a READY non-image row", async () => {
    const readyText = await saveEvidence(connection.db, actor, "project-1", {
      kind: "TEXT", label: "文本证据", signalLayer: "INPUT", text: "不属于私有图片存储",
    }, { root });
    const projectDirectory = path.join(root, "project-1");
    const tombstone = deletionTombstone(projectDirectory, readyText.id);
    await mkdir(projectDirectory, { recursive: true });
    await writeFile(tombstone, "not-an-image-tombstone");
    await utimes(tombstone, new Date(0), new Date(0));

    await expect(recoverPendingEvidence(connection.db, {
      root, now: new Date(2_000_000), deletionGraceMs: 1_000,
    })).resolves.toMatchObject({ finalized: 0, removedTemps: 0 });
    await expect(readFile(tombstone, "utf8")).resolves.toBe("not-an-image-tombstone");
  });

  it("fails closed when a strict tombstone cannot reconstruct the READY row's exact relative path", async () => {
    const ready = await saveEvidence(connection.db, actor, "project-1", {
      kind: "IMAGE", label: "扩展绑定截图", signalLayer: "INPUT", bytes: validPng,
      declaredMime: "image/png", originalName: "bound.png",
    }, { root });
    const original = path.join(root, ready.content);
    const tombstone = deletionTombstone(path.dirname(original), ready.id, ".jpg");
    await rename(original, tombstone);
    await utimes(tombstone, new Date(0), new Date(0));

    await expect(recoverPendingEvidence(connection.db, {
      root, now: new Date(2_000_000), deletionGraceMs: 1_000,
    })).resolves.toMatchObject({ finalized: 0, removedTemps: 0 });
    await expect(access(original)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(tombstone)).resolves.toBeInstanceOf(Buffer);
  });

  it("preserves an unsafe-extension file even when a malformed pending row references it", async () => {
    const id = randomUUID();
    insertPending(id, "a".repeat(64));
    connection.sqlite.prepare("UPDATE evidence SET content = ? WHERE id = ?")
      .run(`project-1/${id}.exe`, id);
    const projectDirectory = path.join(root, "project-1");
    const unknown = path.join(projectDirectory, `${id}.exe`);
    await mkdir(projectDirectory, { recursive: true });
    await writeFile(unknown, "unknown-owner-file");
    await utimes(unknown, new Date(0), new Date(0));

    await recoverPendingEvidence(connection.db, { root });
    expect(connection.db.select().from(evidence).all()).toHaveLength(0);
    await expect(readFile(unknown, "utf8")).resolves.toBe("unknown-owner-file");
  });

  it("rejects a symlinked root and project directory before creating a row", async () => {
    const outside = path.join(directory, "outside");
    await mkdir(outside);
    await symlink(outside, root, process.platform === "win32" ? "junction" : "dir");
    await expect(initializeEvidenceRoot(root)).rejects.toBeInstanceOf(UnsafeEvidencePathError);

    await rm(root, { force: true });
    await mkdir(root);
    await symlink(outside, path.join(root, "project-1"), process.platform === "win32" ? "junction" : "dir");
    await expect(saveEvidence(connection.db, actor, "project-1", {
      kind: "IMAGE", label: "截图", signalLayer: "INPUT", bytes: validPng,
      declaredMime: "image/png", originalName: "shot.png",
    }, { root })).rejects.toBeInstanceOf(UnsafeEvidencePathError);
    expect(connection.db.select().from(evidence).all()).toHaveLength(0);

    const pendingId = randomUUID();
    const outsideFile = path.join(outside, `${pendingId}.png`);
    await writeFile(outsideFile, "outside-owner-data");
    insertPending(pendingId, "a".repeat(64));
    await expect(recoverPendingEvidence(connection.db, { root })).resolves.toMatchObject({ removed: 1 });
    await expect(readFile(outsideFile, "utf8")).resolves.toBe("outside-owner-data");
  });

  it("rejects a root reached through a symlinked ancestor", async () => {
    const outside = path.join(directory, "outside-ancestor");
    const nested = path.join(outside, "nested");
    const link = path.join(directory, "link");
    await mkdir(nested, { recursive: true });
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");

    await expect(initializeEvidenceRoot(path.join(link, "nested")))
      .rejects.toBeInstanceOf(UnsafeEvidencePathError);
  });

  it("rejects roots inside public and roots that contain public", async () => {
    const previousCwd = process.cwd();
    const appRoot = path.join(directory, "app-root");
    await mkdir(path.join(appRoot, "public"), { recursive: true });
    process.chdir(appRoot);
    try {
      const publicEvidence = path.join(appRoot, "public", "evidence");
      await expect(initializeEvidenceRoot(publicEvidence))
        .rejects.toBeInstanceOf(UnsafeEvidencePathError);
      await expect(access(publicEvidence)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(initializeEvidenceRoot(appRoot))
        .rejects.toBeInstanceOf(UnsafeEvidencePathError);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("rejects a project directory replaced by a junction before image rename", async () => {
    const outside = path.join(directory, "swap-outside");
    await mkdir(outside);
    const sentinel = path.join(outside, "sentinel.txt");
    await writeFile(sentinel, "outside-owner-data");
    let swapped = false;
    const options = {
      root,
      beforeImageRename: async () => {
        const projectDirectory = path.join(root, "project-1");
        await rename(projectDirectory, `${projectDirectory}-original`);
        await symlink(outside, projectDirectory, process.platform === "win32" ? "junction" : "dir");
        swapped = true;
      },
    } as Parameters<typeof saveEvidence>[4] & { beforeImageRename: () => Promise<void> };

    await expect(saveEvidence(connection.db, actor, "project-1", {
      kind: "IMAGE", label: "写中替换", signalLayer: "INPUT", bytes: validPng,
      declaredMime: "image/png", originalName: "swap.png",
    }, options)).rejects.toBeInstanceOf(UnsafeEvidencePathError);
    expect(swapped).toBe(true);
    expect(connection.db.select().from(evidence).all()).toHaveLength(0);
    await expect(readFile(sentinel, "utf8")).resolves.toBe("outside-owner-data");
  });

  it("allows only one recovery executor across two database connections", async () => {
    const other = createDb(databasePath);
    let acquired!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    try {
      const first = recoverEvidenceStorage(connection, {
        root,
        afterLockAcquired: async () => {
          acquired();
          await gate;
        },
      });
      await ready;
      let secondSettled = false;
      const second = recoverEvidenceStorage(other, {
        root,
        waitTimeoutMs: 2_000,
        pollIntervalMs: 10,
      } as Parameters<typeof recoverEvidenceStorage>[1] & {
        waitTimeoutMs: number;
        pollIntervalMs: number;
      }).finally(() => { secondSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(secondSettled).toBe(false);
      release();
      await expect(first).resolves.toMatchObject({ skipped: false, waited: false });
      await expect(second).resolves.toMatchObject({ skipped: false, waited: true });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM evidence_recovery_locks").get())
        .toEqual({ count: 0 });
    } finally {
      other.sqlite.close();
    }
  });

  it("serializes concurrent recovery while restoring one aged READY tombstone exactly once", async () => {
    const readyRow = await saveEvidence(connection.db, actor, "project-1", {
      kind: "IMAGE", label: "并发恢复截图", signalLayer: "INPUT", bytes: validPng,
      declaredMime: "image/png", originalName: "concurrent.png",
    }, { root });
    const original = path.join(root, readyRow.content);
    const expectedBytes = await readFile(original);
    const tombstone = deletionTombstone(path.dirname(original), readyRow.id);
    await rename(original, tombstone);
    await utimes(tombstone, new Date(0), new Date(0));
    const other = createDb(databasePath);
    let acquired!: () => void;
    let release!: () => void;
    const firstOwnsLock = new Promise<void>((resolve) => { acquired = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    try {
      const first = recoverEvidenceStorage(connection, {
        root, now: new Date(2_000_000), deletionGraceMs: 1_000,
        afterLockAcquired: async () => { acquired(); await gate; },
      });
      await firstOwnsLock;
      const second = recoverEvidenceStorage(other, {
        root, now: new Date(2_000_000), deletionGraceMs: 1_000,
        waitTimeoutMs: 2_000, pollIntervalMs: 5,
      });
      release();
      const results = await Promise.all([first, second]);
      expect(results.map(({ finalized }) => finalized).sort()).toEqual([0, 1]);
      expect(results[1].waited).toBe(true);
      await expect(readFile(original)).resolves.toEqual(expectedBytes);
      await expect(access(tombstone)).rejects.toMatchObject({ code: "ENOENT" });
      expect(connection.sqlite.prepare("SELECT count(*) count FROM evidence_recovery_locks").get())
        .toEqual({ count: 0 });
    } finally {
      other.sqlite.close();
    }
  });

  it("times out instead of returning success while another recovery owns the lock", async () => {
    const other = createDb(databasePath);
    let acquired!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    try {
      const first = recoverEvidenceStorage(connection, {
        root,
        afterLockAcquired: async () => { acquired(); await gate; },
      });
      await ready;
      await expect(recoverEvidenceStorage(other, {
        root, waitTimeoutMs: 40, pollIntervalMs: 5,
      })).rejects.toBeInstanceOf(EvidenceRecoveryLockTimeoutError);
      release();
      await first;
    } finally {
      other.sqlite.close();
    }
  });

  it("fails when heartbeat discovers that lock ownership was lost", async () => {
    const mutator = createDb(databasePath);
    try {
      const pending = recoverEvidenceStorage(connection, {
        root,
        leaseMs: 60,
        afterLockAcquired: async () => {
          mutator.sqlite.prepare("DELETE FROM evidence_recovery_locks").run();
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
      });
      await expect(pending).rejects.toBeInstanceOf(EvidenceRecoveryLockLostError);
    } finally {
      mutator.sqlite.close();
    }
  });

  it("heartbeats a short lease so a long recovery never overlaps a waiter", async () => {
    const other = createDb(databasePath);
    let acquired!: () => void;
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    let active = 0;
    let maximumActive = 0;
    const enter = async (holdMs: number) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (holdMs > 0) acquired();
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      active -= 1;
    };
    try {
      const first = recoverEvidenceStorage(connection, {
        root, leaseMs: 60, afterLockAcquired: () => enter(220),
      });
      await ready;
      const second = recoverEvidenceStorage(other, {
        root, leaseMs: 60, waitTimeoutMs: 1_000, pollIntervalMs: 5,
        afterLockAcquired: () => enter(0),
      });
      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect(firstResult.waited).toBe(false);
      expect(secondResult.waited).toBe(true);
      expect(maximumActive).toBe(1);
    } finally {
      other.sqlite.close();
    }
  });

  it("lets a waiter take over after the first recovery fails", async () => {
    const other = createDb(databasePath);
    let acquired!: () => void;
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    try {
      const first = recoverEvidenceStorage(connection, {
        root,
        afterLockAcquired: async () => {
          acquired();
          await new Promise((resolve) => setTimeout(resolve, 50));
          throw new Error("first failed");
        },
      });
      await ready;
      const second = recoverEvidenceStorage(other, {
        root, waitTimeoutMs: 1_000, pollIntervalMs: 5,
      });
      await expect(first).rejects.toThrow("first failed");
      await expect(second).resolves.toMatchObject({ skipped: false, waited: true });
    } finally {
      other.sqlite.close();
    }
  });
});
