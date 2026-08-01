// @vitest-environment node

import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const roots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "lumi-ingest-env-"));
  roots.push(root);
  return root;
}

function runKnowledgeIngest(cwd: string, environment: Record<string, string>) {
  const child = spawn(process.execPath, [
    path.join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(repositoryRoot, "scripts", "ingest-knowledge.ts"),
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
    windowsHide: true,
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

describe("knowledge ingestion environment selection", () => {
  it("uses the project database unless CHUYING_SERVICE_ENV is explicit", async () => {
    const root = await temporaryRoot();
    const localAppData = path.join(root, "local-app-data");
    const projectDatabase = path.join(root, "data", "project-dev.sqlite");
    const serviceDatabase = path.join(root, "data", "global-service.sqlite");
    const servicePath = path.join(localAppData, "ChuyingAI", "config", "service.env");
    await mkdir(path.dirname(servicePath), { recursive: true });
    await cp(path.join(repositoryRoot, "data", "knowledge"), path.join(root, "data", "knowledge"), {
      recursive: true,
    });
    await writeFile(path.join(root, ".env.local"), [
      "SESSION_SECRET=project-session-secret-at-least-32-characters",
      `DATABASE_PATH=${projectDatabase}`,
      "EVIDENCE_ROOT=./data/evidence-dev",
    ].join("\n"), "utf8");
    await writeFile(servicePath, [
      "SESSION_SECRET=service-session-secret-at-least-32-characters",
      `DATABASE_PATH=${serviceDatabase}`,
    ].join("\n"), "utf8");

    const result = await runKnowledgeIngest(root, { LOCALAPPDATA: localAppData });

    expect(result, result.stderr).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      byCoursePack: { "general-design@1": 8, "digital-interaction@1": 17, "book-design@1": 9 },
    });
    await expect(access(projectDatabase)).resolves.toBeUndefined();
    await expect(access(serviceDatabase)).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.stdout).not.toContain("session-secret");
  });

  it("uses the service database when CHUYING_SERVICE_ENV explicitly names an existing file", async () => {
    const root = await temporaryRoot();
    const projectDatabase = path.join(root, "data", "project-dev.sqlite");
    const serviceDatabase = path.join(root, "data", "explicit-service.sqlite");
    const servicePath = path.join(root, "private-config", "service.env");
    await mkdir(path.dirname(servicePath), { recursive: true });
    await cp(path.join(repositoryRoot, "data", "knowledge"), path.join(root, "data", "knowledge"), {
      recursive: true,
    });
    await writeFile(path.join(root, ".env.local"), [
      "SESSION_SECRET=project-session-secret-at-least-32-characters",
      `DATABASE_PATH=${projectDatabase}`,
      "EVIDENCE_ROOT=./data/evidence-dev",
    ].join("\n"), "utf8");
    await writeFile(servicePath, [
      "SESSION_SECRET=service-session-secret-at-least-32-characters",
      `DATABASE_PATH=${serviceDatabase}`,
    ].join("\n"), "utf8");

    const result = await runKnowledgeIngest(root, { CHUYING_SERVICE_ENV: servicePath });

    expect(result, result.stderr).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      byCoursePack: { "general-design@1": 8, "digital-interaction@1": 17, "book-design@1": 9 },
    });
    await expect(access(serviceDatabase)).resolves.toBeUndefined();
    await expect(access(projectDatabase)).rejects.toMatchObject({ code: "ENOENT" });
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("session-secret");
  });
});
