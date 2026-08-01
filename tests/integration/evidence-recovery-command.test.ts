// @vitest-environment node

import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

import { runMigrations } from "@/lib/db/migrate";
import { createDb } from "@/lib/db/client";

function spawnRecoveryProcess(environment: Record<string, string>) {
  const child = spawn(process.execPath, [
    path.resolve("node_modules/tsx/dist/cli.mjs"),
    "tests/helpers/run-evidence-recovery-process.ts",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: path.resolve("tsconfig.json"),
      NODE_ENV: "production",
      ...environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  return {
    completed: new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    }),
  };
}

function spawnRecoveryCommand(environment: Record<string, string>, cwd = process.cwd()) {
  const cli = path.resolve("node_modules/tsx/dist/cli.mjs");
  const script = path.resolve("scripts/recover-evidence.ts");
  const child = spawn(process.execPath, [
    cli,
    script,
  ], {
    cwd,
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: path.resolve("tsconfig.json"),
      NODE_ENV: "production",
      ...environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (error) => resolve({ code: -1, stdout, stderr: error.message }));
  });
}

describe("evidence recovery command wiring", () => {
  it("runs recovery explicitly and before next start", async () => {
    const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["evidence:recover"]).toBe("tsx scripts/recover-evidence.ts");
    expect(packageJson.scripts.prestart).toBe("pnpm evidence:recover");
  });

  it("exports the recovery command runner without executing on import", async () => {
    const recoveryModule = await import("@/scripts/recover-evidence");
    expect(recoveryModule.runEvidenceRecovery).toBeTypeOf("function");
  });

  it("runs against a formally migrated database", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-recovery-command-"));
    try {
      const databasePath = path.join(directory, "course.sqlite");
      runMigrations(databasePath);
      const { runEvidenceRecovery } = await import("@/scripts/recover-evidence");
      await expect(runEvidenceRecovery({
        SESSION_SECRET: "s".repeat(32),
        DATABASE_PATH: databasePath,
        EVIDENCE_ROOT: path.join(directory, "evidence"),
      })).resolves.toMatchObject({ skipped: false });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("serializes two OS processes and completes the waiter after the owner", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-recovery-processes-"));
    try {
      const databasePath = path.join(directory, "course.sqlite");
      const root = path.join(directory, "evidence");
      runMigrations(databasePath);
      const first = spawnRecoveryProcess({
        TEST_DATABASE_PATH: databasePath,
        TEST_EVIDENCE_ROOT: root,
        TEST_HOLD_MS: "5000",
      });
      const inspector = createDb(databasePath);
      try {
        let locked = false;
        for (let attempt = 0; attempt < 300; attempt += 1) {
          const row = inspector.sqlite.prepare("SELECT count(*) count FROM evidence_recovery_locks").get() as { count: number };
          if (row.count === 1) { locked = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (!locked) {
          const failedFirst = await first.completed;
          throw new Error(`first recovery process never acquired lock: ${failedFirst.stderr}`);
        }
      } finally {
        inspector.sqlite.close();
      }
      const second = spawnRecoveryProcess({
        TEST_DATABASE_PATH: databasePath,
        TEST_EVIDENCE_ROOT: root,
      });
      const completionOrder: string[] = [];
      const firstCompleted = first.completed.then((result) => { completionOrder.push("first"); return result; });
      const secondCompleted = second.completed.then((result) => { completionOrder.push("second"); return result; });
      const [firstResult, secondResult] = await Promise.all([firstCompleted, secondCompleted]);
      expect(firstResult, firstResult.stderr).toMatchObject({ code: 0 });
      expect(secondResult, secondResult.stderr).toMatchObject({ code: 0 });
      expect(JSON.parse(firstResult.stdout)).toMatchObject({ skipped: false, waited: false });
      expect(JSON.parse(secondResult.stdout)).toMatchObject({ skipped: false, waited: true });
      expect(completionOrder).toEqual(["first", "second"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it("exits nonzero so prestart blocks startup when recovery fails", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-recovery-failure-"));
    try {
      const databasePath = path.join(directory, "course.sqlite");
      runMigrations(databasePath);
      const result = await spawnRecoveryCommand({
        SESSION_SECRET: "s".repeat(32),
        DATABASE_PATH: databasePath,
        EVIDENCE_ROOT: path.resolve("public"),
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("EVIDENCE_ROOT");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("loads production env files with Next precedence before importing recovery services", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-recovery-env-"));
    try {
      const databasePath = path.join(directory, "course.sqlite");
      const envRoot = path.join(directory, "from-env");
      const productionRoot = path.join(directory, "from-production");
      const localRoot = path.join(directory, "from-local");
      const secret = "env-secret-".padEnd(32, "s");
      const proxySecret = "proxy-secret-".padEnd(32, "p");
      const identityPepper = "identity-pepper-".padEnd(32, "i");
      runMigrations(databasePath);
      await writeFile(path.join(directory, ".env"), [
        `SESSION_SECRET=${secret}`,
        `DATABASE_PATH=${databasePath}`,
        `EVIDENCE_ROOT=${envRoot}`,
        "TEACHER_ACCESS_CODE=private-teacher-code",
        `AUTH_PROXY_SECRET=${proxySecret}`,
        `IDENTITY_CODE_PEPPER=${identityPepper}`,
      ].join("\n"), "utf8");
      await writeFile(path.join(directory, ".env.production"),
        `EVIDENCE_ROOT=${productionRoot}\n`, "utf8");
      await writeFile(path.join(directory, ".env.local"),
        `EVIDENCE_ROOT=${localRoot}\n`, "utf8");

      const result = await spawnRecoveryCommand({}, directory);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, skipped: false });
      await expect(access(localRoot)).resolves.toBeUndefined();
      expect(result.stdout + result.stderr).not.toContain(secret);
      expect(result.stdout + result.stderr).not.toContain(proxySecret);
      expect(result.stdout + result.stderr).not.toContain(identityPepper);
      await expect(access(productionRoot)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(envRoot)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("exits nonzero when startup cannot acquire the recovery lock before its timeout", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-recovery-timeout-"));
    try {
      const databasePath = path.join(directory, "course.sqlite");
      runMigrations(databasePath);
      const locked = createDb(databasePath);
      const now = Date.now();
      // Keep the competing lease alive well beyond child-process startup under
      // a fully parallel suite; the behavior under test is the 40 ms waiter
      // timeout, not whether a 1 second fixture happens to expire first.
      locked.sqlite.prepare(`
        INSERT INTO evidence_recovery_locks (name, owner, acquired_at, expires_at)
        VALUES ('evidence-storage-recovery', ?, ?, ?)
      `).run("f".repeat(36), now, now + 10_000);
      locked.sqlite.close();
      const result = await spawnRecoveryCommand({
        SESSION_SECRET: "s".repeat(32),
        DATABASE_PATH: databasePath,
        EVIDENCE_ROOT: path.join(directory, "evidence"),
        TEACHER_ACCESS_CODE: "private-teacher-code",
        AUTH_PROXY_SECRET: "p".repeat(32),
        IDENTITY_CODE_PEPPER: "i".repeat(32),
        EVIDENCE_RECOVERY_WAIT_TIMEOUT_MS: "40",
        EVIDENCE_RECOVERY_POLL_INTERVAL_MS: "5",
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("超时");
    } finally {
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
