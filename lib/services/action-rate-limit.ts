import { createHash } from "node:crypto";

import { eq, lt } from "drizzle-orm";
import { z } from "zod";

import { RateLimitedError } from "@/lib/auth/errors";
import type { DatabaseConnection } from "@/lib/db/client";
import { actionRateLimits } from "@/lib/db/schema";

type CourseDatabase = DatabaseConnection["db"];

export function createActionRateLimitKey(
  sourceId: string,
  studentId: string,
  projectId: string,
  action: string,
) {
  return createHash("sha256")
    .update(`${sourceId}\0${studentId}\0${projectId}\0${action}`, "utf8")
    .digest("hex");
}

export function consumeActionRateLimit(
  db: CourseDatabase,
  keyHash: string,
  rawOptions: { maxRequests?: number; windowSeconds?: number; now?: Date } = {},
) {
  const maxRequests = z.number().int().min(1).max(1_000).parse(rawOptions.maxRequests ?? 10);
  const windowSeconds = z.number().int().min(1).max(86_400).parse(rawOptions.windowSeconds ?? 60);
  const now = rawOptions.now ?? new Date();
  db.transaction((transaction) => {
    transaction.delete(actionRateLimits)
      .where(lt(actionRateLimits.updatedAt, new Date(now.getTime() - 24 * 60 * 60 * 1_000))).run();
    const existing = transaction.select().from(actionRateLimits)
      .where(eq(actionRateLimits.keyHash, keyHash)).get();
    const expired = !existing || now.getTime() - existing.windowStartedAt.getTime() >= windowSeconds * 1_000;
    const requests = expired ? 1 : existing.requests + 1;
    if (requests > maxRequests) {
      const elapsedSeconds = Math.floor((now.getTime() - existing!.windowStartedAt.getTime()) / 1_000);
      throw new RateLimitedError(Math.max(1, windowSeconds - elapsedSeconds));
    }
    transaction.insert(actionRateLimits).values({
      keyHash,
      requests,
      windowStartedAt: expired ? now : existing.windowStartedAt,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: actionRateLimits.keyHash,
      set: { requests, windowStartedAt: expired ? now : existing!.windowStartedAt, updatedAt: now },
    }).run();
  }, { behavior: "immediate" });
}
