import { createHash } from "node:crypto";

import { asc, count, eq, lt } from "drizzle-orm";

import {
  InvalidClassCodeError,
  InvalidIdentityCodeError,
  InvalidTeacherCodeError,
  RateLimitedError,
} from "@/lib/auth/errors";
import type { DatabaseConnection } from "@/lib/db/client";
import { authRateLimits } from "@/lib/db/schema";

export const AUTH_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
export const AUTH_RATE_LIMIT_MAX_FAILURES = 5;
export const AUTH_RATE_LIMIT_RETENTION_SECONDS = 60 * 60;
export const AUTH_RATE_LIMIT_MAX_ACTIVE_BUCKETS = 10_000;

type CourseDatabase = DatabaseConnection["db"];
type AuthChannel = "student" | "teacher";

export function createAuthRateLimitKey(sourceId: string, channel: AuthChannel) {
  return createHash("sha256")
    .update(`${sourceId}\0${channel}`, "utf8")
    .digest("hex");
}

function retryAfterSeconds(blockedUntil: Date, now: Date) {
  return Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1_000));
}

export function assertNotRateLimited(
  db: CourseDatabase,
  keyHash: string,
  now = new Date(),
) {
  const row = db
    .select()
    .from(authRateLimits)
    .where(eq(authRateLimits.keyHash, keyHash))
    .get();

  if (row?.blockedUntil && row.blockedUntil.getTime() > now.getTime()) {
    throw new RateLimitedError(retryAfterSeconds(row.blockedUntil, now));
  }

  if (
    row &&
    now.getTime() - row.windowStartedAt.getTime() >=
      AUTH_RATE_LIMIT_WINDOW_SECONDS * 1_000
  ) {
    db.delete(authRateLimits).where(eq(authRateLimits.keyHash, keyHash)).run();
  }
}

export function recordAuthFailure(
  db: CourseDatabase,
  keyHash: string,
  now = new Date(),
) {
  const blockedUntil = db.transaction((transaction) => {
    transaction
      .delete(authRateLimits)
      .where(
        lt(
          authRateLimits.updatedAt,
          new Date(now.getTime() - AUTH_RATE_LIMIT_RETENTION_SECONDS * 1_000),
        ),
      )
      .run();
    const existing = transaction
      .select()
      .from(authRateLimits)
      .where(eq(authRateLimits.keyHash, keyHash))
      .get();
    if (!existing) {
      const [total] = transaction
        .select({ value: count() })
        .from(authRateLimits)
        .all();
      if (total.value >= AUTH_RATE_LIMIT_MAX_ACTIVE_BUCKETS) {
        const oldest = transaction
          .select({ keyHash: authRateLimits.keyHash })
          .from(authRateLimits)
          .orderBy(asc(authRateLimits.updatedAt), asc(authRateLimits.keyHash))
          .limit(1)
          .get();
        if (oldest) {
          transaction
            .delete(authRateLimits)
            .where(eq(authRateLimits.keyHash, oldest.keyHash))
            .run();
        }
      }
    }
    const windowExpired =
      !existing ||
      now.getTime() - existing.windowStartedAt.getTime() >=
        AUTH_RATE_LIMIT_WINDOW_SECONDS * 1_000;
    const failures = windowExpired ? 1 : existing.failures + 1;
    const windowStartedAt = windowExpired ? now : existing.windowStartedAt;
    const blockedUntil =
      failures >= AUTH_RATE_LIMIT_MAX_FAILURES
        ? new Date(now.getTime() + AUTH_RATE_LIMIT_WINDOW_SECONDS * 1_000)
        : null;

    transaction
      .insert(authRateLimits)
      .values({ keyHash, failures, windowStartedAt, blockedUntil, updatedAt: now })
      .onConflictDoUpdate({
        target: authRateLimits.keyHash,
        set: { failures, windowStartedAt, blockedUntil, updatedAt: now },
      })
      .run();

    return blockedUntil;
  });

  if (blockedUntil) {
    throw new RateLimitedError(retryAfterSeconds(blockedUntil, now));
  }
}

export function clearAuthFailures(db: CourseDatabase, keyHash: string) {
  db.delete(authRateLimits).where(eq(authRateLimits.keyHash, keyHash)).run();
}

export function authenticateWithRateLimit<T>(
  db: CourseDatabase,
  keyHash: string,
  authenticate: () => T,
) {
  assertNotRateLimited(db, keyHash);
  try {
    const result = authenticate();
    clearAuthFailures(db, keyHash);
    return result;
  } catch (error) {
    if (
      error instanceof InvalidClassCodeError ||
      error instanceof InvalidIdentityCodeError ||
      error instanceof InvalidTeacherCodeError
    ) {
      recordAuthFailure(db, keyHash);
    }
    throw error;
  }
}
