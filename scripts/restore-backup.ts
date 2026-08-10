import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  loadRuntimeEnvironment,
  writeEffectiveDatabaseConfigNotice,
} from "@/lib/config/runtime-environment";
import {
  assertCanonicalDirectory,
  BackupSafetyError,
  copyDirectoryContentsWithoutLinks,
  isUnc,
  overlaps,
  samePath,
} from "./backup-core";
import {
  assertSelectedBackup,
  preflightBackupTree,
  validateBackupManifestTree,
  validateBackupTree,
} from "./verify-backup";

export type RestoreBackupOptions = {
  backupBase: string;
  backupPath: string;
  restoreBase: string;
  liveDatabasePath: string;
  liveEvidenceRoot: string;
  afterCopy?: (paths: { incompletePath: string; restorePath: string }) => void | Promise<void>;
  removeIncompleteMarker?: (markerPath: string) => void | Promise<void>;
};

async function assertCanonicalLivePath(rawPath: string, kind: "database" | "evidence") {
  if (!rawPath.trim() || isUnc(rawPath)) throw new BackupSafetyError(`RESTORE_LIVE_${kind.toUpperCase()}_UNSAFE`);
  const resolved = path.resolve(rawPath);
  const details = await lstat(resolved).catch(() => null);
  const expectedType = kind === "database" ? details?.isFile() : details?.isDirectory();
  if (!expectedType || details?.isSymbolicLink()) {
    throw new BackupSafetyError(`RESTORE_LIVE_${kind.toUpperCase()}_UNSAFE`);
  }
  const canonical = await realpath(resolved);
  if (!samePath(canonical, resolved)) {
    throw new BackupSafetyError(`RESTORE_LIVE_${kind.toUpperCase()}_NON_CANONICAL`);
  }
  return canonical;
}

async function assertRestoreInputs(options: RestoreBackupOptions) {
  const backupBase = await assertCanonicalDirectory(options.backupBase);
  const restoreBase = await assertCanonicalDirectory(options.restoreBase, "RESTORE_BASE_INVALID");
  const backupPath = await assertSelectedBackup(backupBase, options.backupPath);
  const liveDatabasePath = await assertCanonicalLivePath(options.liveDatabasePath, "database");
  const liveEvidenceRoot = await assertCanonicalLivePath(options.liveEvidenceRoot, "evidence");

  if (overlaps(backupBase, restoreBase) || overlaps(backupPath, restoreBase) ||
    overlaps(restoreBase, liveDatabasePath) || overlaps(restoreBase, liveEvidenceRoot) ||
    overlaps(backupBase, liveDatabasePath) || overlaps(backupBase, liveEvidenceRoot) ||
    overlaps(backupPath, liveDatabasePath) || overlaps(backupPath, liveEvidenceRoot)) {
    throw new BackupSafetyError("RESTORE_PATH_OVERLAP");
  }
  return { backupPath, restoreBase };
}

export async function restoreBackup(options: RestoreBackupOptions) {
  const { backupPath, restoreBase } = await assertRestoreInputs(options);
  await preflightBackupTree(backupPath);
  const sourceBefore = await validateBackupManifestTree(backupPath);
  const unique = randomUUID();
  const incompletePath = path.join(restoreBase, `.restore-${unique}.incomplete`);
  const restorePath = path.join(restoreBase, `restore-${unique}`);

  await mkdir(incompletePath, { recursive: false, mode: 0o700 });
  await writeFile(path.join(incompletePath, "INCOMPLETE"), "INCOMPLETE\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  await copyDirectoryContentsWithoutLinks(backupPath, incompletePath);
  await options.afterCopy?.({ incompletePath, restorePath });

  const sourceAfter = await validateBackupManifestTree(backupPath);
  if (JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter)) {
    throw new BackupSafetyError("RESTORE_SOURCE_CHANGED");
  }
  await validateBackupManifestTree(incompletePath, true);
  const verificationPath = await mkdtemp(
    path.join(restoreBase, ".restore-verify-"),
  );
  try {
    await copyDirectoryContentsWithoutLinks(incompletePath, verificationPath);
    await validateBackupTree(verificationPath, true);
  } finally {
    await rm(verificationPath, { recursive: true, force: true });
  }

  await rename(incompletePath, restorePath);
  await (options.removeIncompleteMarker ?? unlink)(path.join(restorePath, "INCOMPLETE"));
  return {
    restorePath,
    databasePath: path.join(restorePath, "database.sqlite"),
    evidenceDir: path.join(restorePath, "evidence"),
  } as const;
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (invoked) {
  void loadRuntimeEnvironment({ mode: "EXPLICIT_SERVICE_OR_PROJECT" })
    .then((loaded) => {
      writeEffectiveDatabaseConfigNotice(
        { databasePath: loaded.environment.DATABASE_PATH },
        loaded.provenance,
        loaded.environment,
      );
      return restoreBackup({
        backupBase: loaded.environment.BACKUP_BASE ?? "",
        backupPath: process.env.BACKUP_PATH?.trim()
          || loaded.environment.BACKUP_PATH
          || "",
        restoreBase: loaded.environment.RESTORE_BASE ?? "",
        liveDatabasePath: loaded.environment.DATABASE_PATH ?? "",
        liveEvidenceRoot: loaded.environment.EVIDENCE_ROOT ?? "",
      });
    }).then(({ databasePath, evidenceDir }) => {
    console.log(JSON.stringify({ ok: true, databasePath, evidenceDir }));
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "BACKUP_RESTORE_FAILED");
    process.exitCode = 1;
  });
}
