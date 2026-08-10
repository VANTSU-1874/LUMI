import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";

import { runMigrations } from "@/lib/db/migrate";

export class UnsafeResetTargetError extends Error {
  constructor(reason: string) {
    super(`UNSAFE_RESET_TARGET:${reason}`);
    this.name = "UnsafeResetTargetError";
  }
}

type ResetTargets = {
  workspaceRoot: string;
  databasePath: string;
  evidenceRoot: string;
  nodeEnv?: string;
};

type CleanupRemove = (target: string, options: { recursive: true; force: true }) => void;

export class ResetBackupCleanupError extends Error {
  constructor(public readonly remainingBackups: string[]) {
    super(`RESET_BACKUP_CLEANUP_FAILED:${remainingBackups.length}`);
    this.name = "ResetBackupCleanupError";
  }
}

export function cleanupResetBackups(backups: readonly string[], remove: CleanupRemove = rmSync) {
  const remaining: string[] = [];
  for (const backup of backups) {
    try { remove(backup, { recursive: true, force: true }); }
    catch { remaining.push(backup); }
  }
  if (remaining.length) throw new ResetBackupCleanupError(remaining);
}

function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function pathsOverlap(left: string, right: string) {
  return left === right || isInside(left, right) || isInside(right, left);
}

function canonicalExpectedPath(candidate: string) {
  let current = path.resolve(candidate);
  const remaining: string[] = [];
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    const segment = path.basename(current);
    if (!segment || segment === "." || segment === ".." || path.isAbsolute(segment) || segment.includes("/") || segment.includes("\\")) {
      throw new UnsafeResetTargetError("unsafe-remaining-segment");
    }
    remaining.unshift(segment);
    if (parent === current) throw new UnsafeResetTargetError("no-existing-canonical-ancestor");
    current = parent;
  }
  let expected = realpathSync.native(current);
  for (const segment of remaining) {
    const next = path.resolve(expected, segment);
    if (path.dirname(next) !== expected) throw new UnsafeResetTargetError("canonical-append-escaped");
    expected = next;
  }
  return path.normalize(expected);
}

function assertCanonicalTargetsSafe(workspaceRoot: string, databasePath: string, evidenceRoot: string) {
  const canonicalDatabasePath = canonicalExpectedPath(databasePath);
  const canonicalEvidenceRoot = canonicalExpectedPath(evidenceRoot);
  if (!isInside(workspaceRoot, canonicalDatabasePath) || !isInside(workspaceRoot, canonicalEvidenceRoot)) {
    throw new UnsafeResetTargetError("canonical-target-outside-workspace");
  }
  if (pathsOverlap(canonicalDatabasePath, canonicalEvidenceRoot)) {
    throw new UnsafeResetTargetError("canonical-overlapping-targets");
  }
  return { canonicalDatabasePath, canonicalEvidenceRoot };
}

function nearestExistingDirectory(candidate: string) {
  let current = path.dirname(candidate);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new UnsafeResetTargetError("no-existing-parent");
    current = parent;
  }
  const stat = lstatSync(current);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new UnsafeResetTargetError("parent-not-real-directory");
  return realpathSync.native(current);
}

function assertExplicitNonProductionLabel(candidate: string) {
  if (!/(^|[\\/_-])(demo|dev|test)([\\/_.-]|$)/i.test(candidate)) {
    throw new UnsafeResetTargetError("missing-demo-dev-test-label");
  }
}

function assertCandidateStillContained(workspaceRoot: string, candidate: string) {
  if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) throw new UnsafeResetTargetError("symlink-target");
  const canonicalParent = nearestExistingDirectory(candidate);
  if (!isInside(workspaceRoot, canonicalParent) && canonicalParent !== workspaceRoot) {
    throw new UnsafeResetTargetError("parent-escaped-before-stage");
  }
}

export function validateResetTargets(input: ResetTargets) {
  if (input.nodeEnv === "production") throw new UnsafeResetTargetError("production");
  if (/^(?:\\\\|\/\/)/.test(input.databasePath) || /^(?:\\\\|\/\/)/.test(input.evidenceRoot)) {
    throw new UnsafeResetTargetError("unc-path");
  }
  const workspaceRoot = realpathSync.native(path.resolve(input.workspaceRoot));
  const databasePath = path.resolve(input.databasePath);
  const evidenceRoot = path.resolve(input.evidenceRoot);
  if (databasePath === path.parse(databasePath).root || evidenceRoot === path.parse(evidenceRoot).root) {
    throw new UnsafeResetTargetError("filesystem-root");
  }
  assertExplicitNonProductionLabel(databasePath);
  assertExplicitNonProductionLabel(evidenceRoot);
  if (!isInside(workspaceRoot, databasePath) || !isInside(workspaceRoot, evidenceRoot)) {
    throw new UnsafeResetTargetError("outside-workspace");
  }
  if (pathsOverlap(databasePath, evidenceRoot)) throw new UnsafeResetTargetError("overlapping-targets");
  const databaseParent = nearestExistingDirectory(databasePath);
  const evidenceParent = nearestExistingDirectory(evidenceRoot);
  if (!isInside(workspaceRoot, databaseParent) && databaseParent !== workspaceRoot) throw new UnsafeResetTargetError("database-parent-escaped");
  if (!isInside(workspaceRoot, evidenceParent) && evidenceParent !== workspaceRoot) throw new UnsafeResetTargetError("evidence-parent-escaped");
  if (existsSync(databasePath)) {
    const stat = lstatSync(databasePath);
    if (stat.isSymbolicLink()) throw new UnsafeResetTargetError("symlink-target");
    if (!stat.isFile()) throw new UnsafeResetTargetError("database-not-regular-file");
  }
  if (existsSync(evidenceRoot)) {
    const stat = lstatSync(evidenceRoot);
    if (stat.isSymbolicLink()) throw new UnsafeResetTargetError("symlink-target");
    if (!stat.isDirectory()) throw new UnsafeResetTargetError("evidence-not-directory");
  }
  const canonical = assertCanonicalTargetsSafe(workspaceRoot, databasePath, evidenceRoot);
  return { workspaceRoot, databasePath, evidenceRoot, demoEvidencePath: path.join(evidenceRoot, "demo"), ...canonical };
}

export async function resetDatabase(input: ResetTargets & {
  seedDemo?: boolean;
  identityCodePepper?: string;
  allowDemoSeed?: boolean;
  cleanupRemove?: CleanupRemove;
}) {
  const targets = validateResetTargets(input);
  const lockDirectory = path.join(targets.workspaceRoot, ".runtime");
  mkdirSync(lockDirectory, { recursive: true });
  const lockPath = path.join(lockDirectory, "demo-reset.lock");
  let lock: number;
  try {
    lock = openSync(lockPath, "wx");
  } catch {
    throw new Error("RESET_LOCKED");
  }
  const staged: Array<{ original: string; backup: string }> = [];
  const candidates = [targets.databasePath, `${targets.databasePath}-wal`, `${targets.databasePath}-shm`, `${targets.databasePath}-journal`, targets.demoEvidencePath];
  try {
    const backupSuffix = `.reset-${process.pid}-${randomUUID()}`;
    for (const original of candidates) {
      if (!existsSync(original)) continue;
      assertCandidateStillContained(targets.workspaceRoot, original);
      assertCanonicalTargetsSafe(targets.workspaceRoot, targets.databasePath, targets.evidenceRoot);
      const backup = `${original}${backupSuffix}`;
      if (existsSync(backup)) throw new Error("RESET_STAGING_CONFLICT");
      renameSync(original, backup);
      staged.push({ original, backup });
    }
    try {
      runMigrations(targets.databasePath);
      if (input.seedDemo) {
        const { seedDemoDatabase } = await import("./seed-demo");
        await seedDemoDatabase({
          databasePath: targets.databasePath,
          artworkRoot: targets.evidenceRoot,
          identityCodePepper: input.identityCodePepper ?? "",
          allowDemoSeed: input.allowDemoSeed === true,
          nodeEnv: input.nodeEnv,
        });
      }
    } catch (error) {
      for (const current of [targets.databasePath, `${targets.databasePath}-wal`, `${targets.databasePath}-shm`, `${targets.databasePath}-journal`, targets.demoEvidencePath]) {
        rmSync(current, { recursive: true, force: true });
      }
      for (const { original, backup } of [...staged].reverse()) if (existsSync(backup)) renameSync(backup, original);
      throw error;
    }
    // The replacement database is committed at this point. Backup cleanup is
    // a separate, best-effort phase: failure must never enter rollback and
    // delete the newly built database. Remaining paths are returned in a typed
    // error so cleanup can be retried safely.
    cleanupResetBackups(staged.map(({ backup }) => backup), input.cleanupRemove);
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
  return targets;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  void resetDatabase({
    workspaceRoot: process.cwd(),
    databasePath: process.env.DATABASE_PATH ?? "./data/demo.sqlite",
    evidenceRoot: process.env.EVIDENCE_ROOT ?? "./data/evidence-demo",
    nodeEnv: process.env.NODE_ENV,
    seedDemo: process.env.SEED_AFTER_RESET === "true",
    identityCodePepper: process.env.IDENTITY_CODE_PEPPER ?? process.env.SESSION_SECRET,
    allowDemoSeed: process.env.ALLOW_DEMO_SEED === "true",
  }).then(({ databasePath }) => console.log(`已安全重建演示数据库：${databasePath}`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "重置失败");
      process.exitCode = 1;
    });
}
