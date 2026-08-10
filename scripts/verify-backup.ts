import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  loadRuntimeEnvironment,
  writeEffectiveDatabaseConfigNotice,
} from "@/lib/config/runtime-environment";
import {
  assertCanonicalDirectory,
  assertRegularNonEmptyFile,
  BackupFile,
  BackupSafetyError,
  copyDirectoryWithoutLinks,
  isInside,
  isUnc,
  readManifest,
  restoredSnapshot,
  samePath,
} from "./backup-core";

type VerifyBackupOptions = { backupBase: string; backupPath: string };

export async function assertSelectedBackup(backupBase: string, rawBackupPath: string) {
  if (!rawBackupPath.trim() || isUnc(rawBackupPath)) throw new BackupSafetyError("BACKUP_PATH_INVALID");
  const resolved = path.resolve(rawBackupPath);
  if (!isInside(backupBase, resolved) || !samePath(path.dirname(resolved), backupBase) || resolved.endsWith(".incomplete")) {
    throw new BackupSafetyError("BACKUP_PATH_OUTSIDE_APPROVED_BASE");
  }
  const details = await lstat(resolved).catch(() => null);
  if (!details?.isDirectory() || details.isSymbolicLink()) throw new BackupSafetyError("BACKUP_PATH_UNSAFE");
  const canonical = await realpath(resolved);
  if (!samePath(canonical, resolved)) throw new BackupSafetyError("BACKUP_PATH_NON_CANONICAL");
  return canonical;
}

export async function preflightBackupTree(root: string, allowIncompleteMarker = false) {
  await assertRegularNonEmptyFile(path.join(root, "COMPLETE"), "BACKUP_COMPLETE_MISSING");
  if (await readFile(path.join(root, "COMPLETE"), "utf8") !== "COMPLETE\n") {
    throw new BackupSafetyError("BACKUP_COMPLETE_INVALID");
  }
  const manifest = await readManifest(path.join(root, "manifest.json"));
  const incompleteMarker = await readFile(path.join(root, "INCOMPLETE"), "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (allowIncompleteMarker) {
    if (incompleteMarker !== "INCOMPLETE\n") {
      throw new BackupSafetyError("RESTORE_INCOMPLETE_MARKER_INVALID");
    }
  } else if (incompleteMarker !== null) {
    throw new BackupSafetyError("BACKUP_INCOMPLETE_MARKER_PRESENT");
  }
  return manifest;
}

export async function validateBackupManifestTree(root: string, allowIncompleteMarker = false) {
  const manifest = await preflightBackupTree(root, allowIncompleteMarker);
  const allowedRootEntries = new Set(["COMPLETE", "manifest.json", "database.sqlite", "evidence"]);
  if (allowIncompleteMarker) allowedRootEntries.add("INCOMPLETE");
  const extraRootEntry = (await readdir(root)).find((entry) => !allowedRootEntries.has(entry));
  if (extraRootEntry) throw new BackupSafetyError(`BACKUP_MANIFEST_EXTRA:${extraRootEntry}`);
  const actual = await restoredSnapshot(root);
  const expectedPaths = new Set(manifest.files.map((entry) => entry.path));
  const actualPaths = new Set(actual.files.map((entry) => entry.path));
  const missing = [...expectedPaths].filter((entry) => !actualPaths.has(entry));
  const extra = [...actualPaths].filter((entry) => !expectedPaths.has(entry));
  if (missing.length) throw new BackupSafetyError(`BACKUP_MANIFEST_MISSING:${missing[0]}`);
  if (extra.length) throw new BackupSafetyError(`BACKUP_MANIFEST_EXTRA:${extra[0]}`);
  const expectedDirectories = new Set(manifest.directories);
  const actualDirectories = new Set(actual.directories);
  const missingDirectory = [...expectedDirectories].find((entry) => !actualDirectories.has(entry));
  const extraDirectory = [...actualDirectories].find((entry) => !expectedDirectories.has(entry));
  if (missingDirectory) throw new BackupSafetyError(`BACKUP_MANIFEST_MISSING_DIRECTORY:${missingDirectory}`);
  if (extraDirectory) throw new BackupSafetyError(`BACKUP_MANIFEST_EXTRA_DIRECTORY:${extraDirectory}`);
  for (const expected of manifest.files) {
    const found = actual.files.find((entry) => entry.path === expected.path);
    if (!found || found.size !== expected.size || found.sha256 !== expected.sha256) {
      throw new BackupSafetyError(`BACKUP_MANIFEST_HASH_MISMATCH:${expected.path}`);
    }
  }
  return { manifest, actual } as const;
}

async function verifyDatabase(root: string, actualFiles: ReadonlyMap<string, BackupFile>) {
  const databasePath = path.join(root, "database.sqlite");
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 1_000 });
  try {
    sqlite.pragma("query_only = ON");
    if (sqlite.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new BackupSafetyError("BACKUP_SQLITE_INTEGRITY_FAILED");
    }
    const foreignKeys = sqlite.pragma("foreign_key_check") as unknown[];
    if (foreignKeys.length) throw new BackupSafetyError("BACKUP_SQLITE_FOREIGN_KEY_FAILED");
    const hasEvidence = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='evidence'").get();
    if (!hasEvidence) return 0;
    const references = sqlite.prepare(
      "SELECT content, content_digest AS contentDigest FROM evidence WHERE kind='IMAGE' AND storage_status='READY' ORDER BY id",
    ).all() as Array<{ content: string; contentDigest: string }>;
    for (const reference of references) {
      if (!reference.content || reference.content.includes("\\") || path.posix.isAbsolute(reference.content) ||
        reference.content.split("/").includes("..")) {
        throw new BackupSafetyError("BACKUP_EVIDENCE_REFERENCE_UNSAFE");
      }
      const evidenceRoot = path.join(root, "evidence");
      const referencedPath = path.resolve(evidenceRoot, ...reference.content.split("/"));
      if (!isInside(evidenceRoot, referencedPath)) throw new BackupSafetyError("BACKUP_EVIDENCE_REFERENCE_UNSAFE");
      const relativePath = `evidence/${reference.content}`;
      const actual = actualFiles.get(relativePath);
      if (!actual || !samePath(referencedPath, path.join(root, ...relativePath.split("/")))) {
        throw new BackupSafetyError("BACKUP_EVIDENCE_REFERENCE_MISSING");
      }
      if (actual.sha256 !== reference.contentDigest) {
        throw new BackupSafetyError("BACKUP_EVIDENCE_REFERENCE_HASH_MISMATCH");
      }
    }
    return references.length;
  } finally {
    sqlite.close();
  }
}

export async function validateBackupTree(root: string, allowIncompleteMarker = false) {
  const { manifest, actual } = await validateBackupManifestTree(root, allowIncompleteMarker);
  const actualFiles = new Map(actual.files.map((entry) => [entry.path, entry]));
  const evidenceReferenceCount = await verifyDatabase(root, actualFiles);
  return { manifest, actual, evidenceReferenceCount } as const;
}

export async function verifyBackup(options: VerifyBackupOptions) {
  const backupBase = await assertCanonicalDirectory(options.backupBase);
  const backupPath = await assertSelectedBackup(backupBase, options.backupPath);
  await preflightBackupTree(backupPath);
  const temporaryRoot = await mkdtemp(path.join(backupBase, `.verify-${randomUUID()}-`));
  const restoreRoot = path.join(temporaryRoot, "restore");
  try {
    await copyDirectoryWithoutLinks(backupPath, restoreRoot);
    const { manifest, evidenceReferenceCount } = await validateBackupTree(restoreRoot);
    return { fileCount: manifest.files.length, evidenceReferenceCount } as const;
  } finally {
    if (!isInside(backupBase, temporaryRoot) || !path.basename(temporaryRoot).startsWith(".verify-")) {
      throw new BackupSafetyError("BACKUP_VERIFY_TEMP_UNSAFE");
    }
    await rm(temporaryRoot, { recursive: true, force: true });
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
    return verifyBackup({
      backupBase: loaded.environment.BACKUP_BASE ?? "",
      backupPath: process.env.BACKUP_PATH?.trim()
        || loaded.environment.BACKUP_PATH
        || "",
    });
  }).then((result) => console.log(JSON.stringify({ ok: true, ...result })))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "BACKUP_VERIFY_FAILED");
      process.exitCode = 1;
    });
}
