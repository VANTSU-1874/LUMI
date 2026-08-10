// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as studentPost } from "@/app/api/auth/student/route";
import { POST as teacherPost } from "@/app/api/auth/teacher/route";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import {
  generateIdentityCode,
  issueStudentIdentityCode,
} from "@/lib/auth/identity-code";
import {
  authenticateWithRateLimit,
  recordAuthFailure,
} from "@/lib/auth/rate-limit";
import { signTrustedSource } from "@/lib/auth/trusted-source";

const SESSION_SECRET = "rate-limit-session-secret-at-least-32-characters";
const TEACHER_CODE = "private-teacher-code";
const IDENTITY_CODE_PEPPER = "rate-test-identity-pepper-at-least-32-characters";
const AUTH_PROXY_SECRET = "rate-test-auth-proxy-secret-at-least-32-characters";

function trustedHeaders(sourceId: string) {
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  return {
    "x-tonggan-source-id": sourceId,
    "x-tonggan-source-timestamp": timestamp,
    "x-tonggan-source-signature": signTrustedSource(
      sourceId,
      timestamp,
      AUTH_PROXY_SECRET,
    ),
  };
}

function jsonRequest(
  pathname: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
  sourceId = "rate-source-a",
) {
  return new NextRequest(`http://localhost${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...trustedHeaders(sourceId),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe("persistent authentication rate limits", () => {
  let temporaryDirectory: string;
  let databasePath: string;
  let identityCode: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "tonggan-rate-limit-"));
    databasePath = path.join(temporaryDirectory, "rate-limit.sqlite");
    runMigrations(databasePath);
    const connection = createDb(databasePath);
    try {
      connection.sqlite
        .prepare("INSERT INTO classes (id, name, access_code) VALUES (?, ?, ?)")
        .run("class-1", "一班", "CLASS001");
      identityCode = issueStudentIdentityCode(connection.db, {
        classId: "class-1",
        pepper: IDENTITY_CODE_PEPPER,
      });
    } finally {
      connection.sqlite.close();
    }

    vi.stubEnv("DATABASE_PATH", databasePath);
    vi.stubEnv("SESSION_SECRET", SESSION_SECRET);
    vi.stubEnv("TEACHER_ACCESS_CODE", TEACHER_CODE);
    vi.stubEnv("IDENTITY_CODE_PEPPER", IDENTITY_CODE_PEPPER);
    vi.stubEnv("AUTH_PROXY_SECRET", AUTH_PROXY_SECRET);
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("blocks the fifth teacher failure and persists across reopened connections", async () => {
    for (let attempt = 1; attempt < 5; attempt += 1) {
      const response = await teacherPost(
        jsonRequest(
          "/api/auth/teacher",
          { code: "wrong-teacher-code" },
          { "x-forwarded-for": `203.0.113.${attempt}` },
        ),
      );
      expect(response.status).toBe(401);
    }

    const blocked = await teacherPost(
      jsonRequest(
        "/api/auth/teacher",
        { code: "wrong-teacher-code" },
        { "x-forwarded-for": "198.51.100.10" },
      ),
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

    const reopened = createDb(databasePath);
    const persistedBlock = reopened.sqlite
      .prepare(
        "SELECT failures, blocked_until AS blockedUntil FROM auth_rate_limits",
      )
      .get() as { failures: number; blockedUntil: number | null };
    reopened.sqlite.close();
    expect(persistedBlock.failures).toBe(5);
    expect(persistedBlock.blockedUntil).not.toBeNull();
    const stillBlocked = await teacherPost(
      jsonRequest("/api/auth/teacher", { code: "different-wrong-code" }),
    );
    expect(stillBlocked.status).toBe(429);

    const correctCredential = await teacherPost(
      jsonRequest("/api/auth/teacher", { code: TEACHER_CODE }),
    );
    expect(correctCredential.status).toBe(429);

    const otherSource = await teacherPost(
      jsonRequest(
        "/api/auth/teacher",
        { code: TEACHER_CODE },
        {},
        "rate-source-b",
      ),
    );
    expect(otherSource.status).toBe(200);

    const independentChannel = await studentPost(
      jsonRequest("/api/auth/student", {
        classCode: "CLASS001",
        alias: identityCode,
      }),
    );
    expect(independentChannel.status).toBe(200);
  });

  it("uses one bounded student bucket across different credential guesses", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await studentPost(
        jsonRequest("/api/auth/student", {
          classCode: `MISSING${attempt}`,
          alias: generateIdentityCode(),
        }),
      );
      statuses.push(response.status);
    }

    expect(statuses).toEqual([401, 401, 401, 401, 429, 429, 429, 429]);

    const bounded = createDb(databasePath);
    const boundedRow = bounded.sqlite
      .prepare("SELECT count(*) AS count FROM auth_rate_limits")
      .get() as { count: number };
    bounded.sqlite.close();
    expect(boundedRow.count).toBe(1);

    const correctCredential = await studentPost(
      jsonRequest("/api/auth/student", {
        classCode: "CLASS001",
        alias: identityCode,
      }),
    );
    expect(correctCredential.status).toBe(429);

    const otherSource = await studentPost(
      jsonRequest(
        "/api/auth/student",
        { classCode: "CLASS001", alias: identityCode },
        {},
        "rate-source-b",
      ),
    );
    expect(otherSource.status).toBe(200);

    const connection = createDb(databasePath);
    try {
      const row = connection.sqlite
        .prepare("SELECT count(*) AS count FROM auth_rate_limits")
        .get() as { count: number };
      expect(row.count).toBe(1);
    } finally {
      connection.sqlite.close();
    }
  });

  it("clears prior failures after a successful teacher entry", async () => {
    const failed = await teacherPost(
      jsonRequest("/api/auth/teacher", { code: "wrong-teacher-code" }),
    );
    expect(failed.status).toBe(401);

    const succeeded = await teacherPost(
      jsonRequest("/api/auth/teacher", { code: TEACHER_CODE }),
    );
    expect(succeeded.status).toBe(200);

    const connection = createDb(databasePath);
    try {
      const row = connection.sqlite
        .prepare("SELECT count(*) AS count FROM auth_rate_limits")
        .get() as { count: number };
      expect(row.count).toBe(0);
    } finally {
      connection.sqlite.close();
    }
  });

  it("stores only hashed keys and counters, never raw credentials or forwarded IPs", async () => {
    await teacherPost(
      jsonRequest(
        "/api/auth/teacher",
        { code: "wrong-teacher-code" },
        { "x-forwarded-for": "203.0.113.99" },
      ),
    );
    await studentPost(
      jsonRequest("/api/auth/student", {
        classCode: "MISSING01",
        alias: identityCode,
      }),
    );

    const connection = createDb(databasePath);
    try {
      const rows = connection.sqlite.prepare("SELECT * FROM auth_rate_limits").all();
      const persisted = JSON.stringify(rows);
      expect(rows).toHaveLength(2);
      expect(persisted).not.toContain(TEACHER_CODE);
      expect(persisted).not.toContain("wrong-teacher-code");
      expect(persisted).not.toContain("MISSING01");
      expect(persisted).not.toContain(identityCode);
      expect(persisted).not.toContain("203.0.113.99");
      expect(persisted).not.toContain("rate-source-a");
      expect(persisted).toMatch(/[a-f0-9]{64}/);
    } finally {
      connection.sqlite.close();
    }
  });

  it("keeps the teacher bucket independent of the configured teacher secret", async () => {
    await teacherPost(
      jsonRequest("/api/auth/teacher", { code: "wrong-teacher-code" }),
    );
    vi.stubEnv("TEACHER_ACCESS_CODE", "another-private-teacher-code");
    await teacherPost(
      jsonRequest("/api/auth/teacher", { code: "another-wrong-code" }),
    );

    const connection = createDb(databasePath);
    try {
      const rows = connection.sqlite.prepare("SELECT key_hash FROM auth_rate_limits").all() as {
        key_hash: string;
      }[];
      const offlineProbe = createHash("sha256").update(TEACHER_CODE).digest("hex");
      expect(rows).toHaveLength(1);
      expect(rows[0].key_hash).not.toBe(offlineProbe);
    } finally {
      connection.sqlite.close();
    }
  });

  it("checks a blocked bucket before invoking the credential verifier", () => {
    const keyHash = "d".repeat(64);
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const connection = createDb(databasePath);
    try {
      connection.sqlite
        .prepare(
          "INSERT INTO auth_rate_limits (key_hash, failures, window_started_at, blocked_until, updated_at) VALUES (?, 5, ?, ?, ?)",
        )
        .run(keyHash, nowSeconds, nowSeconds + 900, nowSeconds);
      let authenticateCalls = 0;

      expect(() =>
        authenticateWithRateLimit(connection.db, keyHash, () => {
          authenticateCalls += 1;
          return true;
        }),
      ).toThrow("尝试次数过多");
      expect(authenticateCalls).toBe(0);
    } finally {
      connection.sqlite.close();
    }
  });

  it("removes buckets older than the one-hour retention window", () => {
    const now = new Date("2026-07-12T00:00:00.000Z");
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    const oldKey = "a".repeat(64);
    const recentKey = "b".repeat(64);
    const newKey = "c".repeat(64);
    const connection = createDb(databasePath);
    try {
      const insert = connection.sqlite.prepare(
        "INSERT INTO auth_rate_limits (key_hash, failures, window_started_at, blocked_until, updated_at) VALUES (?, 1, ?, NULL, ?)",
      );
      insert.run(oldKey, nowSeconds - 3_601, nowSeconds - 3_601);
      insert.run(recentKey, nowSeconds - 60, nowSeconds - 60);

      recordAuthFailure(connection.db, newKey, now);

      const keys = connection.sqlite
        .prepare("SELECT key_hash AS keyHash FROM auth_rate_limits ORDER BY key_hash")
        .all() as { keyHash: string }[];
      expect(keys.map(({ keyHash }) => keyHash)).toEqual([recentKey, newKey].sort());
    } finally {
      connection.sqlite.close();
    }
  });

  it("caps active buckets at 10000 by evicting the oldest entry", () => {
    const now = new Date("2026-07-12T00:00:00.000Z");
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    const newKey = "f".repeat(64);
    const connection = createDb(databasePath);
    try {
      connection.sqlite
        .prepare(
          `WITH RECURSIVE bucket(value) AS (
             SELECT 0 UNION ALL SELECT value + 1 FROM bucket WHERE value < 9999
           )
           INSERT INTO auth_rate_limits
             (key_hash, failures, window_started_at, blocked_until, updated_at)
           SELECT printf('%064x', value), 1, ?, NULL, ? FROM bucket`,
        )
        .run(nowSeconds, nowSeconds);

      recordAuthFailure(connection.db, newKey, now);

      const count = connection.sqlite
        .prepare("SELECT count(*) AS count FROM auth_rate_limits")
        .get() as { count: number };
      const inserted = connection.sqlite
        .prepare("SELECT key_hash FROM auth_rate_limits WHERE key_hash = ?")
        .get(newKey);
      expect(count.count).toBe(10_000);
      expect(inserted).toBeDefined();
    } finally {
      connection.sqlite.close();
    }
  });
});
