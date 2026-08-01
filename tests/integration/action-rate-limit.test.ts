// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RateLimitedError } from "@/lib/auth/errors";
import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  consumeActionRateLimit,
  createActionRateLimitKey,
} from "@/lib/services/action-rate-limit";

describe("persistent action rate limit", () => {
  let directory: string;
  let connection: DatabaseConnection;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-action-rate-"));
    const file = path.join(directory, "course.sqlite");
    runMigrations(file);
    connection = createDb(file);
  });
  afterEach(async () => {
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("hashes source, student, project and action without retaining identifiers", () => {
    const key = createActionRateLimitKey("source-1", "student-1", "project-1", "hint");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("student-1");
  });

  it("atomically blocks beyond the configured request count", () => {
    const key = createActionRateLimitKey("source", "student", "project", "hint");
    const now = new Date("2026-07-12T08:00:00.000Z");
    consumeActionRateLimit(connection.db, key, { maxRequests: 2, windowSeconds: 60, now });
    consumeActionRateLimit(connection.db, key, { maxRequests: 2, windowSeconds: 60, now });
    expect(() => consumeActionRateLimit(connection.db, key, { maxRequests: 2, windowSeconds: 60, now }))
      .toThrow(RateLimitedError);
  });
});
