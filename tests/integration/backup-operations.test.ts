// @vitest-environment node

import Database from "better-sqlite3";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createConsistentBackup } from "@/scripts/create-backup";
import { restoreBackup } from "@/scripts/restore-backup";
import { validateBackupTree, verifyBackup } from "@/scripts/verify-backup";

const roots: string[] = [];

async function fixture(options: {
  emptyEvidence?: boolean;
  invalidForeignKey?: boolean;
  invalidEvidenceDigest?: boolean;
  walMode?: boolean;
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-backup-"));
  roots.push(root);
  const data = path.join(root, "data");
  const evidenceRoot = path.join(data, "evidence");
  const backupBase = path.join(root, "approved-backups");
  const restoreBase = path.join(root, "approved-restores");
  const databasePath = path.join(data, "course.sqlite");
  await mkdir(evidenceRoot, { recursive: true });
  await mkdir(backupBase);
  await mkdir(restoreBase);
  const sqlite = new Database(databasePath);
  if (options.walMode) sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE parent (id TEXT PRIMARY KEY);
    CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parent(id));
    CREATE TABLE evidence (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      storage_status TEXT NOT NULL,
      content TEXT NOT NULL,
      content_digest TEXT NOT NULL
    );
    INSERT INTO parent VALUES ('p1');
    INSERT INTO child VALUES ('c1', 'p1');
  `);
  if (options.invalidForeignKey) {
    sqlite.pragma("foreign_keys = OFF");
    sqlite.prepare("INSERT INTO child VALUES ('orphan', 'missing-parent')").run();
  }
  if (!options.emptyEvidence) {
    await mkdir(path.join(evidenceRoot, "project-1"));
    const bytes = Buffer.from("private-image-evidence");
    const relativePath = "project-1/evidence.webp";
    await writeFile(path.join(evidenceRoot, ...relativePath.split("/")), bytes);
    const digest = options.invalidEvidenceDigest
      ? "0".repeat(64)
      : (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
    sqlite.prepare("INSERT INTO evidence VALUES (?, 'IMAGE', 'READY', ?, ?)")
      .run("e1", relativePath, digest);
  }
  sqlite.close();
  return { root, data, evidenceRoot, backupBase, restoreBase, databasePath };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("consistent backup and isolated restore rehearsal", () => {
  it("atomically snapshots the database and entire evidence tree, then verifies it", async () => {
    const source = await fixture();

    const backup = await createConsistentBackup(source);
    const manifest = JSON.parse(await readFile(path.join(backup.backupPath, "manifest.json"), "utf8")) as {
      files: Array<{ path: string; size: number; sha256: string }>;
      directories: string[];
    };
    expect(backup.backupPath.startsWith(source.backupBase)).toBe(true);
    expect(backup.backupPath.endsWith(".incomplete")).toBe(false);
    expect(manifest.directories).toContain("evidence");
    expect(manifest.files.map((entry) => entry.path)).toEqual([
      "database.sqlite",
      "evidence/project-1/evidence.webp",
    ]);
    await expect(readFile(path.join(backup.backupPath, "COMPLETE"), "utf8"))
      .resolves.toMatch(/^COMPLETE\n$/);

    await expect(verifyBackup({ backupBase: source.backupBase, backupPath: backup.backupPath }))
      .resolves.toMatchObject({ fileCount: 2, evidenceReferenceCount: 1 });
    expect((await readdir(source.backupBase)).some((name) => name.startsWith(".verify-"))).toBe(false);
  });

  it("preserves an explicitly empty evidence directory as a valid restore point", async () => {
    const source = await fixture({ emptyEvidence: true });
    const backup = await createConsistentBackup(source);

    await expect(verifyBackup({ backupBase: source.backupBase, backupPath: backup.backupPath }))
      .resolves.toMatchObject({ fileCount: 1, evidenceReferenceCount: 0 });
  });

  it("verifies and restores a WAL database without opening the backup or final restore in place", async () => {
    const source = await fixture({ walMode: true });
    const backup = await createConsistentBackup(source);
    await expect(verifyBackup({
      backupBase: source.backupBase,
      backupPath: backup.backupPath,
    })).resolves.toMatchObject({ fileCount: 2, evidenceReferenceCount: 1 });
    const restored = await restoreBackup({
      backupBase: source.backupBase,
      backupPath: backup.backupPath,
      restoreBase: source.restoreBase,
      liveDatabasePath: source.databasePath,
      liveEvidenceRoot: source.evidenceRoot,
    });

    expect(await readdir(backup.backupPath)).not.toContain("database.sqlite-wal");
    expect(await readdir(backup.backupPath)).not.toContain("database.sqlite-shm");
    expect(await readdir(restored.restorePath)).not.toContain("database.sqlite-wal");
    expect(await readdir(restored.restorePath)).not.toContain("database.sqlite-shm");
    expect((await readdir(source.restoreBase)).some((entry) =>
      entry.startsWith(".restore-verify-"))).toBe(false);
  });

  it("leaves a uniquely named INCOMPLETE snapshot on a source-race failure", async () => {
    const source = await fixture();

    await expect(createConsistentBackup({
      ...source,
      afterCopy: async () => writeFile(source.databasePath, "changed-during-backup", "utf8"),
    })).rejects.toThrow(/SOURCE_CHANGED/i);
    const names = await readdir(source.backupBase);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/\.incomplete$/);
    await expect(readFile(path.join(source.backupBase, names[0], "INCOMPLETE"), "utf8"))
      .resolves.toContain("INCOMPLETE");
  });

  it("detects missing, extra, corrupt, and unsafe backup content without deleting existing paths", async () => {
    const source = await fixture();
    const backup = await createConsistentBackup(source);
    const sentinel = path.join(source.backupBase, "do-not-delete");
    await mkdir(sentinel);
    await writeFile(path.join(sentinel, "sentinel.txt"), "keep", "utf8");
    await writeFile(path.join(backup.backupPath, "evidence", "unexpected.txt"), "extra", "utf8");

    await expect(verifyBackup({ backupBase: source.backupBase, backupPath: backup.backupPath }))
      .rejects.toThrow(/MANIFEST_EXTRA/i);
    await expect(readFile(path.join(sentinel, "sentinel.txt"), "utf8")).resolves.toBe("keep");
    expect((await readdir(source.backupBase)).some((name) => name.startsWith(".verify-"))).toBe(false);
  });

  it("rejects an unlisted file at the restore-point root", async () => {
    const source = await fixture();
    const backup = await createConsistentBackup(source);
    await writeFile(path.join(backup.backupPath, "unlisted-root.txt"), "extra", "utf8");

    await expect(verifyBackup({ backupBase: source.backupBase, backupPath: backup.backupPath }))
      .rejects.toThrow(/MANIFEST_EXTRA/i);
  });

  it("detects a missing manifest file and a same-size content corruption", async () => {
    const missingSource = await fixture();
    const missingBackup = await createConsistentBackup(missingSource);
    await unlink(path.join(missingBackup.backupPath, "evidence", "project-1", "evidence.webp"));
    await expect(verifyBackup({ backupBase: missingSource.backupBase, backupPath: missingBackup.backupPath }))
      .rejects.toThrow(/MANIFEST_MISSING/i);

    const corruptSource = await fixture();
    const corruptBackup = await createConsistentBackup(corruptSource);
    await writeFile(
      path.join(corruptBackup.backupPath, "evidence", "project-1", "evidence.webp"),
      "private-image-evidencf",
      "utf8",
    );
    await expect(verifyBackup({ backupBase: corruptSource.backupBase, backupPath: corruptBackup.backupPath }))
      .rejects.toThrow(/HASH_MISMATCH/i);
  });

  it("rejects a busy checkpoint before creating an INCOMPLETE destination", async () => {
    const source = await fixture();
    await expect(createConsistentBackup({
      ...source,
      checkpointDatabase: () => ({ busy: 1, log: 2, checkpointed: 0 }),
    })).rejects.toThrow(/CHECKPOINT_BUSY/i);
    await expect(readdir(source.backupBase)).resolves.toEqual([]);
  });

  it("fails closed when a writer commits new WAL frames after the checkpoint", async () => {
    const source = await fixture({ walMode: true });
    const writers: Array<InstanceType<typeof Database>> = [];
    try {
      await expect(createConsistentBackup({
        ...source,
        afterCopy: () => {
          const writer = new Database(source.databasePath);
          writers.push(writer);
          writer.pragma("journal_mode = WAL");
          writer.prepare("INSERT INTO parent VALUES ('late-writer')").run();
        },
      })).rejects.toThrow(/SOURCE_WAL_ACTIVE|SOURCE_CHANGED/);
    } finally {
      for (const writer of writers) writer.close();
    }
  });

  it("rejects foreign-key violations and mismatched READY image references after manifest verification", async () => {
    const foreignKeySource = await fixture({ invalidForeignKey: true });
    const foreignKeyBackup = await createConsistentBackup(foreignKeySource);
    await expect(verifyBackup({
      backupBase: foreignKeySource.backupBase,
      backupPath: foreignKeyBackup.backupPath,
    })).rejects.toThrow(/FOREIGN_KEY/i);

    const referenceSource = await fixture({ invalidEvidenceDigest: true });
    const referenceBackup = await createConsistentBackup(referenceSource);
    await expect(verifyBackup({
      backupBase: referenceSource.backupBase,
      backupPath: referenceBackup.backupPath,
    })).rejects.toThrow(/EVIDENCE_REFERENCE_HASH_MISMATCH/i);
  });

  it("refuses roots, UNC paths, source overlap, and non-canonical approved bases", async () => {
    const source = await fixture();
    await expect(createConsistentBackup({ ...source, backupBase: path.parse(source.root).root }))
      .rejects.toThrow(/BACKUP_BASE/i);
    await expect(createConsistentBackup({ ...source, backupBase: source.data }))
      .rejects.toThrow(/OVERLAP/i);
    await expect(createConsistentBackup({ ...source, backupBase: "\\\\server\\share" }))
      .rejects.toThrow(/UNC|BACKUP_BASE/i);

    const linkedBase = path.join(source.root, "linked-backups");
    await symlink(source.backupBase, linkedBase, "junction");
    await expect(createConsistentBackup({ ...source, backupBase: linkedBase }))
      .rejects.toThrow(/BACKUP_BASE/i);

    const linkedData = path.join(source.root, "linked-data");
    await symlink(source.data, linkedData, "junction");
    await expect(createConsistentBackup({
      ...source,
      databasePath: path.join(linkedData, "course.sqlite"),
      evidenceRoot: path.join(linkedData, "evidence"),
    })).rejects.toThrow(/BACKUP_(DATABASE|EVIDENCE).*CANONICAL|BACKUP_.*UNSAFE/i);
  });

  it("materializes a verified restore copy without rewriting the source manifest or COMPLETE marker", async () => {
    const source = await fixture();
    const backup = await createConsistentBackup(source);
    const collisionSentinel = path.join(
      source.restoreBase,
      ".restore-verify-pre-existing",
    );
    await mkdir(collisionSentinel);
    await writeFile(
      path.join(collisionSentinel, "sentinel.txt"),
      "keep",
      "utf8",
    );
    const manifestBefore = await readFile(path.join(backup.backupPath, "manifest.json"));
    const completeBefore = await readFile(path.join(backup.backupPath, "COMPLETE"));
    const liveBefore = await readFile(source.databasePath);

    const restored = await restoreBackup({
      backupBase: source.backupBase,
      backupPath: backup.backupPath,
      restoreBase: source.restoreBase,
      liveDatabasePath: source.databasePath,
      liveEvidenceRoot: source.evidenceRoot,
    });

    expect(path.basename(restored.restorePath)).toMatch(/^restore-/);
    expect(restored.restorePath.endsWith(".incomplete")).toBe(false);
    expect(restored.databasePath).toBe(path.join(restored.restorePath, "database.sqlite"));
    expect(restored.evidenceDir).toBe(path.join(restored.restorePath, "evidence"));
    await expect(readFile(path.join(restored.restorePath, "manifest.json"))).resolves.toEqual(manifestBefore);
    await expect(readFile(path.join(restored.restorePath, "COMPLETE"))).resolves.toEqual(completeBefore);
    await expect(readFile(source.databasePath)).resolves.toEqual(liveBefore);
    await expect(
      readFile(path.join(collisionSentinel, "sentinel.txt"), "utf8"),
    ).resolves.toBe("keep");
    expect((await readdir(source.restoreBase)).some((entry) => entry.endsWith(".incomplete"))).toBe(false);
    expect((await readdir(source.restoreBase)).filter(
      (entry) => entry.startsWith(".restore-verify-"),
    )).toEqual([".restore-verify-pre-existing"]);
  });

  it("keeps a failed restore as INCOMPLETE and never deletes live or pre-existing restore paths", async () => {
    const source = await fixture();
    const backup = await createConsistentBackup(source);
    const sentinel = path.join(source.restoreBase, "keep-existing");
    await mkdir(sentinel);
    await writeFile(path.join(sentinel, "sentinel.txt"), "keep", "utf8");
    const liveBefore = await readFile(source.databasePath);

    await expect(restoreBackup({
      backupBase: source.backupBase,
      backupPath: backup.backupPath,
      restoreBase: source.restoreBase,
      liveDatabasePath: source.databasePath,
      liveEvidenceRoot: source.evidenceRoot,
      afterCopy: async () => writeFile(
        path.join(backup.backupPath, "evidence", "project-1", "evidence.webp"),
        "source-mutated-after-copy",
      ),
    })).rejects.toThrow(/SOURCE_CHANGED|HASH_MISMATCH/i);

    const names = await readdir(source.restoreBase);
    const incomplete = names.find((entry) => /^\.restore-.*\.incomplete$/.test(entry));
    expect(incomplete).toBeTruthy();
    await expect(readFile(path.join(source.restoreBase, incomplete!, "INCOMPLETE"), "utf8"))
      .resolves.toBe("INCOMPLETE\n");
    await expect(readFile(path.join(sentinel, "sentinel.txt"), "utf8")).resolves.toBe("keep");
    await expect(readFile(source.databasePath)).resolves.toEqual(liveBefore);
  });

  it("rejects tampered, empty, extra, linked, and overlapping restore inputs", async () => {
    const tampered = await fixture();
    const tamperedBackup = await createConsistentBackup(tampered);
    await writeFile(path.join(tamperedBackup.backupPath, "evidence", "project-1", "evidence.webp"), "tampered");
    await expect(restoreBackup({
      backupBase: tampered.backupBase,
      backupPath: tamperedBackup.backupPath,
      restoreBase: tampered.restoreBase,
      liveDatabasePath: tampered.databasePath,
      liveEvidenceRoot: tampered.evidenceRoot,
    })).rejects.toThrow(/HASH_MISMATCH/i);

    const empty = await fixture();
    const emptyBackup = await createConsistentBackup(empty);
    await writeFile(path.join(emptyBackup.backupPath, "database.sqlite"), "");
    await expect(restoreBackup({
      backupBase: empty.backupBase,
      backupPath: emptyBackup.backupPath,
      restoreBase: empty.restoreBase,
      liveDatabasePath: empty.databasePath,
      liveEvidenceRoot: empty.evidenceRoot,
    })).rejects.toThrow(/EMPTY|HASH_MISMATCH/i);

    const extra = await fixture();
    const extraBackup = await createConsistentBackup(extra);
    await writeFile(path.join(extraBackup.backupPath, "unexpected.txt"), "extra");
    await expect(restoreBackup({
      backupBase: extra.backupBase,
      backupPath: extraBackup.backupPath,
      restoreBase: extra.restoreBase,
      liveDatabasePath: extra.databasePath,
      liveEvidenceRoot: extra.evidenceRoot,
    })).rejects.toThrow(/MANIFEST_EXTRA/i);

    const linked = await fixture();
    const linkedBackup = await createConsistentBackup(linked);
    const linkedRestoreBase = path.join(linked.root, "linked-restores");
    await symlink(linked.restoreBase, linkedRestoreBase, "junction");
    await expect(restoreBackup({
      backupBase: linked.backupBase,
      backupPath: linkedBackup.backupPath,
      restoreBase: linkedRestoreBase,
      liveDatabasePath: linked.databasePath,
      liveEvidenceRoot: linked.evidenceRoot,
    })).rejects.toThrow(/RESTORE_BASE/i);
    await expect(restoreBackup({
      backupBase: linked.backupBase,
      backupPath: linkedBackup.backupPath,
      restoreBase: linked.backupBase,
      liveDatabasePath: linked.databasePath,
      liveEvidenceRoot: linked.evidenceRoot,
    })).rejects.toThrow(/OVERLAP/i);
    await expect(restoreBackup({
      backupBase: linked.backupBase,
      backupPath: linkedBackup.backupPath,
      restoreBase: linked.data,
      liveDatabasePath: linked.databasePath,
      liveEvidenceRoot: linked.evidenceRoot,
    })).rejects.toThrow(/OVERLAP/i);
    await expect(restoreBackup({
      backupBase: linked.backupBase,
      backupPath: linkedBackup.backupPath,
      restoreBase: path.parse(linked.root).root,
      liveDatabasePath: linked.databasePath,
      liveEvidenceRoot: linked.evidenceRoot,
    })).rejects.toThrow(/RESTORE_BASE/i);
    await expect(restoreBackup({
      backupBase: linked.backupBase,
      backupPath: linkedBackup.backupPath,
      restoreBase: "\\\\server\\share",
      liveDatabasePath: linked.databasePath,
      liveEvidenceRoot: linked.evidenceRoot,
    })).rejects.toThrow(/RESTORE_BASE/i);
  });

  it("fails closed on unreasonable manifest counts and sizes", async () => {
    const source = await fixture({ emptyEvidence: true });
    const backup = await createConsistentBackup(source);
    const manifestPath = path.join(backup.backupPath, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      version: number;
      createdAt: string;
      directories: string[];
      files: Array<{ path: string; size: number; sha256: string }>;
    };
    manifest.files[0].size = 9 * 1024 * 1024 * 1024;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(verifyBackup({ backupBase: source.backupBase, backupPath: backup.backupPath }))
      .rejects.toThrow(/MANIFEST_LIMIT/i);

    manifest.files[0].size = 1;
    manifest.files.push(...Array.from({ length: 10_001 }, (_, index) => ({
      path: `evidence/f-${index}`,
      size: 1,
      sha256: "0".repeat(64),
    })));
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(verifyBackup({ backupBase: source.backupBase, backupPath: backup.backupPath }))
      .rejects.toThrow(/MANIFEST_LIMIT/i);
  });

  it("preserves the original INCOMPLETE directory and marker when the final rename conflicts", async () => {
    const source = await fixture();
    const backup = await createConsistentBackup(source);
    const liveBefore = await readFile(source.databasePath);
    let attemptedFinalPath = "";

    await expect(restoreBackup({
      backupBase: source.backupBase,
      backupPath: backup.backupPath,
      restoreBase: source.restoreBase,
      liveDatabasePath: source.databasePath,
      liveEvidenceRoot: source.evidenceRoot,
      afterCopy: async ({ restorePath }) => {
        attemptedFinalPath = restorePath;
        await mkdir(restorePath);
        await writeFile(path.join(restorePath, "sentinel.txt"), "do-not-replace");
      },
    })).rejects.toThrow();

    const entries = await readdir(source.restoreBase);
    const incompleteName = entries.find((entry) => /^\.restore-.*\.incomplete$/.test(entry));
    expect(incompleteName).toBeTruthy();
    await expect(readFile(path.join(source.restoreBase, incompleteName!, "INCOMPLETE"), "utf8"))
      .resolves.toBe("INCOMPLETE\n");
    await expect(readFile(path.join(attemptedFinalPath, "sentinel.txt"), "utf8"))
      .resolves.toBe("do-not-replace");
    await expect(readFile(source.databasePath)).resolves.toEqual(liveBefore);
  });

  it("leaves a renamed restore marked INCOMPLETE and unconsumable when marker removal fails", async () => {
    const source = await fixture();
    const backup = await createConsistentBackup(source);
    const liveBefore = await readFile(source.databasePath);

    await expect(restoreBackup({
      backupBase: source.backupBase,
      backupPath: backup.backupPath,
      restoreBase: source.restoreBase,
      liveDatabasePath: source.databasePath,
      liveEvidenceRoot: source.evidenceRoot,
      removeIncompleteMarker: async () => {
        throw new Error("simulated marker unlink failure");
      },
    })).rejects.toThrow(/marker unlink failure/i);

    const entries = await readdir(source.restoreBase);
    expect(entries.some((entry) => entry.endsWith(".incomplete"))).toBe(false);
    const finalName = entries.find((entry) => /^restore-/.test(entry));
    expect(finalName).toBeTruthy();
    const finalPath = path.join(source.restoreBase, finalName!);
    await expect(readFile(path.join(finalPath, "INCOMPLETE"), "utf8")).resolves.toBe("INCOMPLETE\n");
    await expect(validateBackupTree(finalPath)).rejects.toThrow(/INCOMPLETE/i);
    await expect(verifyBackup({ backupBase: source.restoreBase, backupPath: finalPath }))
      .rejects.toThrow(/INCOMPLETE/i);
    await expect(readFile(source.databasePath)).resolves.toEqual(liveBefore);
  });

  it("rejects manifest limits and case-folded path collisions before copying the backup tree", async () => {
    const oversized = await fixture();
    const oversizedBackup = await createConsistentBackup(oversized);
    const oversizedManifestPath = path.join(oversizedBackup.backupPath, "manifest.json");
    const oversizedManifest = JSON.parse(await readFile(oversizedManifestPath, "utf8")) as {
      files: Array<{ path: string; size: number; sha256: string }>;
    };
    oversizedManifest.files[0].size = 9 * 1024 * 1024 * 1024;
    await writeFile(oversizedManifestPath, JSON.stringify(oversizedManifest));
    const outside = path.join(oversized.root, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(oversizedBackup.backupPath, "evidence", "000-copy-must-not-start"), "junction");

    await expect(verifyBackup({
      backupBase: oversized.backupBase,
      backupPath: oversizedBackup.backupPath,
    })).rejects.toThrow(/MANIFEST_LIMIT/i);

    const collision = await fixture();
    const collisionBackup = await createConsistentBackup(collision);
    const collisionManifestPath = path.join(collisionBackup.backupPath, "manifest.json");
    const collisionManifest = JSON.parse(await readFile(collisionManifestPath, "utf8")) as {
      files: Array<{ path: string; size: number; sha256: string }>;
    };
    collisionManifest.files.push({
      ...collisionManifest.files[1],
      path: collisionManifest.files[1].path.toUpperCase(),
    });
    await writeFile(collisionManifestPath, JSON.stringify(collisionManifest));

    await expect(verifyBackup({
      backupBase: collision.backupBase,
      backupPath: collisionBackup.backupPath,
    })).rejects.toThrow(/MANIFEST_CASE_COLLISION/i);
  });
});
