import { randomUUID } from "node:crypto";

import type { DatabaseConnection } from "@/lib/db/client";

import { recoverPendingEvidence } from "./evidence";

const LOCK_NAME = "evidence-storage-recovery";
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_WAIT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

export class EvidenceRecoveryLockTimeoutError extends Error {
  constructor() {
    super("等待证据恢复锁超时");
    this.name = "EvidenceRecoveryLockTimeoutError";
  }
}

export class EvidenceRecoveryLockLostError extends Error {
  constructor() {
    super("证据恢复锁已丢失");
    this.name = "EvidenceRecoveryLockLostError";
  }
}

function tryAcquireLock(
  connection: DatabaseConnection,
  owner: string,
  nowMs: number,
  leaseMs: number,
) {
  connection.sqlite.exec("BEGIN IMMEDIATE");
  try {
    connection.sqlite.prepare(
      "DELETE FROM evidence_recovery_locks WHERE name = ? AND expires_at <= ?",
    ).run(LOCK_NAME, nowMs);
    const inserted = connection.sqlite.prepare(`
      INSERT OR IGNORE INTO evidence_recovery_locks (name, owner, acquired_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(LOCK_NAME, owner, nowMs, nowMs + leaseMs);
    connection.sqlite.exec("COMMIT");
    return inserted.changes === 1;
  } catch (error) {
    connection.sqlite.exec("ROLLBACK");
    throw error;
  }
}

function renewLock(
  connection: DatabaseConnection,
  owner: string,
  nowMs: number,
  leaseMs: number,
) {
  connection.sqlite.exec("BEGIN IMMEDIATE");
  try {
    const updated = connection.sqlite.prepare(`
      UPDATE evidence_recovery_locks
      SET expires_at = ?
      WHERE name = ? AND owner = ? AND expires_at > ?
    `).run(nowMs + leaseMs, LOCK_NAME, owner, nowMs);
    connection.sqlite.exec("COMMIT");
    return updated.changes === 1;
  } catch (error) {
    connection.sqlite.exec("ROLLBACK");
    throw error;
  }
}

function releaseLock(connection: DatabaseConnection, owner: string) {
  connection.sqlite.exec("BEGIN IMMEDIATE");
  try {
    connection.sqlite.prepare(
      "DELETE FROM evidence_recovery_locks WHERE name = ? AND owner = ?",
    ).run(LOCK_NAME, owner);
    connection.sqlite.exec("COMMIT");
  } catch (error) {
    connection.sqlite.exec("ROLLBACK");
    throw error;
  }
}

async function waitForLock(
  connection: DatabaseConnection,
  owner: string,
  options: { leaseMs: number; waitTimeoutMs: number; pollIntervalMs: number },
) {
  const startedAt = Date.now();
  let waited = false;
  while (true) {
    const nowMs = Date.now();
    if (tryAcquireLock(connection, owner, nowMs, options.leaseMs)) {
      return { waited, waitedMs: nowMs - startedAt };
    }
    waited = true;
    const elapsed = Date.now() - startedAt;
    if (elapsed >= options.waitTimeoutMs) throw new EvidenceRecoveryLockTimeoutError();
    await new Promise((resolve) => setTimeout(
      resolve,
      Math.min(options.pollIntervalMs, options.waitTimeoutMs - elapsed),
    ));
  }
}

export async function recoverEvidenceStorage(
  connection: DatabaseConnection,
  options: Parameters<typeof recoverPendingEvidence>[1] & {
    leaseMs?: number;
    waitTimeoutMs?: number;
    pollIntervalMs?: number;
    afterLockAcquired?: () => void | Promise<void>;
  },
) {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (leaseMs < 3 || waitTimeoutMs < 0 || pollIntervalMs < 1) {
    throw new RangeError("证据恢复锁参数无效");
  }
  const owner = randomUUID();
  const wait = await waitForLock(connection, owner, { leaseMs, waitTimeoutMs, pollIntervalMs });
  let lost: EvidenceRecoveryLockLostError | null = null;
  const assertLease = () => {
    if (lost) throw lost;
  };
  const heartbeat = setInterval(() => {
    if (lost) return;
    try {
      if (!renewLock(connection, owner, Date.now(), leaseMs)) {
        lost = new EvidenceRecoveryLockLostError();
      }
    } catch {
      lost = new EvidenceRecoveryLockLostError();
    }
  }, Math.max(1, Math.floor(leaseMs / 3)));
  heartbeat.unref();
  try {
    await options.afterLockAcquired?.();
    assertLease();
    const result = await recoverPendingEvidence(connection.db, { ...options, assertLease });
    assertLease();
    return { skipped: false as const, ...wait, ...result };
  } finally {
    clearInterval(heartbeat);
    releaseLock(connection, owner);
  }
}
