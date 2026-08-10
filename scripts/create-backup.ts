import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  loadRuntimeEnvironment,
  writeEffectiveDatabaseConfigNotice,
} from "@/lib/config/runtime-environment";
import {
  assertCanonicalDirectory,
  BackupSafetyError,
  copySnapshot,
  isUnc,
  overlaps,
  restoredSnapshot,
  snapshotsEqual,
  sourceSnapshot,
  samePath,
  writeJsonExclusive,
} from "./backup-core";

type CheckpointResult = { busy: number; log: number; checkpointed: number };

export type CreateBackupOptions = {
  databasePath: string;
  evidenceRoot: string;
  backupBase: string;
  afterCopy?: () => void | Promise<void>;
  checkpointDatabase?: (databasePath: string) => CheckpointResult;
  now?: Date;
};

function checkpointDatabase(databasePath: string): CheckpointResult {
  const sqlite = new Database(databasePath, { fileMustExist: true, timeout: 1_000 });
  try {
    const rows = sqlite.pragma("wal_checkpoint(TRUNCATE)") as unknown as CheckpointResult[];
    const row = rows[0];
    if (!row || !Number.isInteger(row.busy)) throw new BackupSafetyError("BACKUP_CHECKPOINT_INVALID");
    return row;
  } finally {
    sqlite.close();
  }
}

async function assertSources(databasePath: string, evidenceRoot: string, backupBase: string) {
  if (isUnc(databasePath) || isUnc(evidenceRoot)) throw new BackupSafetyError("BACKUP_SOURCE_UNC");
  const resolvedDatabase = path.resolve(databasePath);
  const resolvedEvidence = path.resolve(evidenceRoot);
  if (overlaps(resolvedDatabase, resolvedEvidence) || overlaps(backupBase, resolvedDatabase) || overlaps(backupBase, resolvedEvidence)) {
    throw new BackupSafetyError("BACKUP_SOURCE_OVERLAP");
  }
  const databaseDetails = await lstat(resolvedDatabase).catch(() => null);
  const evidenceDetails = await lstat(resolvedEvidence).catch(() => null);
  if (!databaseDetails?.isFile() || databaseDetails.isSymbolicLink()) throw new BackupSafetyError("BACKUP_DATABASE_UNSAFE");
  if (!evidenceDetails?.isDirectory() || evidenceDetails.isSymbolicLink()) throw new BackupSafetyError("BACKUP_EVIDENCE_UNSAFE");
  const canonicalDatabase = await realpath(resolvedDatabase);
  const canonicalEvidence = await realpath(resolvedEvidence);
  if (!samePath(canonicalDatabase, resolvedDatabase)) throw new BackupSafetyError("BACKUP_DATABASE_NON_CANONICAL");
  if (!samePath(canonicalEvidence, resolvedEvidence)) throw new BackupSafetyError("BACKUP_EVIDENCE_NON_CANONICAL");
  return { databasePath: resolvedDatabase, evidenceRoot: resolvedEvidence };
}

export async function assertWalDrained(databasePath: string) {
  const walPath = `${databasePath}-wal`;
  const details = await lstat(walPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (!details) return;
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new BackupSafetyError("BACKUP_SOURCE_WAL_UNSAFE");
  }
  if (details.size !== 0) {
    throw new BackupSafetyError("BACKUP_SOURCE_WAL_ACTIVE");
  }
}

export async function createConsistentBackup(options: CreateBackupOptions) {
  const backupBase = await assertCanonicalDirectory(options.backupBase);
  const sources = await assertSources(options.databasePath, options.evidenceRoot, backupBase);
  const checkpoint = (options.checkpointDatabase ?? checkpointDatabase)(sources.databasePath);
  if (checkpoint.busy !== 0) throw new BackupSafetyError("BACKUP_CHECKPOINT_BUSY");
  await assertWalDrained(sources.databasePath);

  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const uniqueName = `${stamp}-${randomUUID()}`;
  const incompletePath = path.join(backupBase, `${uniqueName}.incomplete`);
  const backupPath = path.join(backupBase, uniqueName);
  await mkdir(incompletePath, { recursive: false, mode: 0o700 });
  await writeFile(path.join(incompletePath, "INCOMPLETE"), "INCOMPLETE\n", { flag: "wx", mode: 0o600 });

  try {
    const before = await sourceSnapshot(sources.databasePath, sources.evidenceRoot);
    await copySnapshot(sources.databasePath, sources.evidenceRoot, incompletePath, before);
    await options.afterCopy?.();
    await assertWalDrained(sources.databasePath);
    const after = await sourceSnapshot(sources.databasePath, sources.evidenceRoot);
    if (!snapshotsEqual(before, after)) throw new BackupSafetyError("BACKUP_SOURCE_CHANGED");
    const copied = await restoredSnapshot(incompletePath);
    if (!snapshotsEqual(before, copied)) throw new BackupSafetyError("BACKUP_TARGET_MISMATCH");

    const manifest = { version: 1 as const, createdAt: (options.now ?? new Date()).toISOString(), ...before };
    await writeJsonExclusive(path.join(incompletePath, "manifest.json"), manifest);
    await writeFile(path.join(incompletePath, "COMPLETE"), "COMPLETE\n", { flag: "wx", mode: 0o600 });
    await unlink(path.join(incompletePath, "INCOMPLETE"));
    await rename(incompletePath, backupPath);
    return { backupPath, manifest, checkpoint } as const;
  } catch (error) {
    throw error;
  }
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url : false;
if (invoked) {
  void loadRuntimeEnvironment({ mode: "EXPLICIT_SERVICE_OR_PROJECT" }).then((loaded) => {
    writeEffectiveDatabaseConfigNotice(
      { databasePath: loaded.environment.DATABASE_PATH },
      loaded.provenance,
      loaded.environment,
    );
    return createConsistentBackup({
      databasePath: loaded.environment.DATABASE_PATH ?? "",
      evidenceRoot: loaded.environment.EVIDENCE_ROOT ?? "",
      backupBase: loaded.environment.BACKUP_BASE ?? "",
    });
  }).then(({ backupPath, manifest }) => {
    console.log(JSON.stringify({ ok: true, backupPath, fileCount: manifest.files.length }));
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "BACKUP_FAILED");
    process.exitCode = 1;
  });
}
