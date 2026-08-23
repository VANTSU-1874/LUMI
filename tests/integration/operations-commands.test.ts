// @vitest-environment node

import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";

const roots: string[] = [];
const repositoryRoot = process.cwd();

async function temporaryWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-operations-"));
  roots.push(root);
  return root;
}

function runScript(script: string, cwd: string, environment: Record<string, string> = {}) {
  const child = spawn(process.execPath, [
    path.join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(repositoryRoot, script),
  ], {
    cwd,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      TSX_TSCONFIG_PATH: path.join(repositoryRoot, "tsconfig.json"),
      NODE_ENV: "development",
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

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("documented database commands", () => {
  it("loads the database target from .env.local before migrating", async () => {
    const root = await temporaryWorkspace();
    await writeFile(path.join(root, ".env.local"), "DATABASE_PATH=./runtime/course-dev.sqlite\n", "utf8");

    const result = await runScript("lib/db/migrate.ts", root);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain("\"event\":\"effective-database-config\"");
    expect(result.stderr).toContain("\"source\":\"project-env\"");
    await expect(access(path.join(root, "runtime", "course-dev.sqlite"))).resolves.toBeUndefined();
    await expect(access(path.join(root, "data", "tonggan.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps an explicit service or PowerShell environment override ahead of .env.local", async () => {
    const root = await temporaryWorkspace();
    await writeFile(path.join(root, ".env.local"), "DATABASE_PATH=./runtime/from-file-dev.sqlite\n", "utf8");

    const result = await runScript("lib/db/migrate.ts", root, {
      DATABASE_PATH: "./runtime/from-process-dev.sqlite",
    });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain("\"event\":\"effective-database-config\"");
    expect(result.stderr).toContain("\"source\":\"process-env\"");
    await expect(access(path.join(root, "runtime", "from-process-dev.sqlite"))).resolves.toBeUndefined();
    await expect(access(path.join(root, "runtime", "from-file-dev.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("loads .env.local before seeding and prints the five issued demo logins without secrets", async () => {
    const root = await temporaryWorkspace();
    const pepper = "seed-pepper-value-that-must-not-be-printed-123456";
    await writeFile(path.join(root, ".env.local"), [
      "DATABASE_PATH=./data/course-demo.sqlite",
      `IDENTITY_CODE_PEPPER=${pepper}`,
      "ALLOW_DEMO_SEED=true",
    ].join("\n"), "utf8");

    const result = await runScript("scripts/seed-demo.ts", root);

    expect(result, result.stderr).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain("演示班级码：DIGI2026");
    expect(result.stdout.match(/[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2}/g)).toHaveLength(5);
    expect(result.stdout).not.toContain(pepper);
    await expect(access(path.join(root, "data", "course-demo.sqlite"))).resolves.toBeUndefined();
  });

  it("loads guarded reset targets from .env.local", async () => {
    const root = await temporaryWorkspace();
    await writeFile(path.join(root, ".env.local"), [
      "DATABASE_PATH=./runtime/course-dev.sqlite",
      "EVIDENCE_ROOT=./runtime/evidence-dev",
    ].join("\n"), "utf8");

    const result = await runScript("scripts/reset-db.ts", root);

    expect(result, result.stderr).toMatchObject({ code: 0, stderr: "" });
    expect(result.stdout).toContain("runtime\\course-dev.sqlite");
    await expect(access(path.join(root, "runtime", "course-dev.sqlite"))).resolves.toBeUndefined();
    await expect(access(path.join(root, "data", "demo.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("loads the external service environment before ingesting course knowledge", async () => {
    const root = await temporaryWorkspace();
    const configDirectory = path.join(root, "config");
    const databasePath = path.join(root, "data", "service.sqlite");
    const evidenceRoot = path.join(root, "data", "evidence");
    const serviceEnvironmentPath = path.join(configDirectory, "service.env");
    await mkdir(configDirectory, { recursive: true });
    await writeFile(serviceEnvironmentPath, [
      "SESSION_SECRET=service-environment-session-secret-0123456789",
      `DATABASE_PATH=${databasePath}`,
      `EVIDENCE_ROOT=${evidenceRoot}`,
      "TEACHER_ACCESS_CODE=service-teacher-code",
      "IDENTITY_CODE_PEPPER=service-identity-pepper-0123456789",
      "AUTH_PROXY_SECRET=service-proxy-secret-0123456789abcdef",
      "PUBLIC_APP_URL=https://service-environment.invalid",
      "AGENT_V2_ENABLED=true",
    ].join("\n"), "utf8");

    const result = await runScript("scripts/ingest-knowledge.ts", repositoryRoot, {
      CHUYING_SERVICE_ENV: serviceEnvironmentPath,
    });

    expect(result, result.stderr).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      byCoursePack: { "general-design@1": 8, "digital-interaction@1": 17, "book-design@1": 9 },
    });
    await expect(access(databasePath)).resolves.toBeUndefined();
    expect(result.stdout).not.toContain("service-environment-session-secret");
  });

  it("reruns local setup without resetting interactive starter progress", async () => {
    const root = await temporaryWorkspace();
    const environment = { LOCALAPPDATA: root };
    const first = await runScript("scripts/setup-local-host.ts", repositoryRoot, environment);
    expect(first, first.stderr).toMatchObject({ code: 0, stderr: "" });
    const firstResult = JSON.parse(first.stdout) as { databasePath: string; environmentPath: string };
    const sqlite = new Database(firstResult.databasePath);
    try {
      sqlite.prepare("UPDATE projects SET stage='BUILD',evidence_revision=4,updated_at=? WHERE id='demo-project-e'")
        .run(1783872600);
    } finally {
      sqlite.close();
    }

    const second = await runScript("scripts/setup-local-host.ts", repositoryRoot, environment);
    expect(second, second.stderr).toMatchObject({ code: 0, stderr: "" });
    const checked = new Database(firstResult.databasePath, { readonly: true });
    try {
      expect(checked.prepare("SELECT stage,evidence_revision,updated_at FROM projects WHERE id='demo-project-e'").get())
        .toEqual({ stage: "BUILD", evidence_revision: 4, updated_at: 1783872600 });
    } finally {
      checked.close();
    }
    await expect(readFile(firstResult.environmentPath, "utf8")).resolves.toContain("AGENT_HARNESS_REPORT_PATH=");
  }, 20_000);

  it("rejects QR generation without PUBLIC_APP_URL and leaves an old asset untouched", async () => {
    const root = await temporaryWorkspace();
    const publicDirectory = path.join(root, "public");
    const qrPath = path.join(publicDirectory, "competition-qr.svg");
    await mkdir(publicDirectory);
    await writeFile(qrPath, "existing-reviewed-asset", "utf8");

    const result = await runScript("scripts/generate-qr.ts", root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("PUBLIC_APP_URL_INVALID:missing");
    expect(result.stdout).toBe("");
    await expect(readFile(qrPath, "utf8")).resolves.toBe("existing-reviewed-asset");
  });

  it("executes the documented backup and isolated verification commands", async () => {
    const root = await temporaryWorkspace();
    const data = path.join(root, "data");
    const evidenceRoot = path.join(data, "evidence");
    const backupBase = path.join(root, "approved-backups");
    const databasePath = path.join(data, "course.sqlite");
    await mkdir(evidenceRoot, { recursive: true });
    await mkdir(backupBase);
    const sqlite = new Database(databasePath);
    sqlite.exec("CREATE TABLE item (id TEXT PRIMARY KEY)");
    sqlite.close();

    const created = await runScript("scripts/create-backup.ts", root, {
      DATABASE_PATH: databasePath,
      EVIDENCE_ROOT: evidenceRoot,
      BACKUP_BASE: backupBase,
    });
    expect(created, created.stderr).toMatchObject({ code: 0, stderr: "" });
    const backup = JSON.parse(created.stdout) as { ok: boolean; backupPath: string };
    expect(backup.ok).toBe(true);

    const verified = await runScript("scripts/verify-backup.ts", root, {
      BACKUP_BASE: backupBase,
      BACKUP_PATH: backup.backupPath,
    });
    expect(verified, verified.stderr).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(verified.stdout)).toMatchObject({ ok: true, fileCount: 1, evidenceReferenceCount: 0 });
  });
});
