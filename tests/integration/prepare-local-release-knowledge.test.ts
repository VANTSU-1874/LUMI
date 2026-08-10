// @vitest-environment node

import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  writePassingAgentHarnessReport,
  writePassingAgentQualityReport,
} from "@/tests/helpers/agent-release-report-fixtures";

const repositoryRoot = process.cwd();
const roots: string[] = [];

function runReleasePreparation(
  cwd: string,
  environment: Record<string, string>,
) {
  const child = spawn(process.execPath, [
    path.join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(repositoryRoot, "tests", "fixtures", "prepare-local-release-runner.ts"),
  ], {
    cwd,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      TSX_TSCONFIG_PATH: path.join(repositoryRoot, "tsconfig.json"),
      NODE_ENV: "production",
      ...environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.on("error", (error) =>
        resolve({ code: -1, stdout, stderr: error.message }));
    },
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("local release knowledge preparation", () => {
  it("binds config and corpus to the release, rehearses restore, then writes live", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lumi-release-knowledge-"));
    roots.push(root);
    const decoyCwd = path.join(root, "decoy-cwd");
    const localAppData = path.join(root, "local-app-data");
    const dataRoot = path.join(root, "service-data");
    const databasePath = path.join(dataRoot, "competition.sqlite");
    const evidenceRoot = path.join(dataRoot, "evidence");
    const configPath = path.join(root, "config", "service.env");
    const reportRoot = path.join(root, "reports");
    const backupBase = path.join(root, "backups");
    const restoreBase = path.join(root, "restores");
    await Promise.all([
      mkdir(path.join(decoyCwd, "data", "knowledge"), { recursive: true }),
      mkdir(evidenceRoot, { recursive: true }),
      mkdir(path.dirname(configPath), { recursive: true }),
      mkdir(reportRoot, { recursive: true }),
    ]);
    await writeFile(
      path.join(decoyCwd, "data", "knowledge", "decoy.md"),
      "this must never be imported",
      "utf8",
    );
    const sqlite = new Database(databasePath);
    sqlite.exec("CREATE TABLE release_sentinel(id TEXT PRIMARY KEY)");
    sqlite.prepare("INSERT INTO release_sentinel(id) VALUES('preserved')").run();
    sqlite.close();
    const qualityReportPath = await writePassingAgentQualityReport(reportRoot);
    const harnessReportPath = await writePassingAgentHarnessReport(reportRoot);
    const relativeDatabasePath = path.relative(repositoryRoot, databasePath);
    const relativeEvidenceRoot = path.relative(repositoryRoot, evidenceRoot);
    await writeFile(configPath, [
      "SESSION_SECRET=release-session-secret-01234567890123456789",
      `DATABASE_PATH=${relativeDatabasePath}`,
      `EVIDENCE_ROOT=${relativeEvidenceRoot}`,
      "LLM_BASE_URL=https://example.com/v1",
      "LLM_API_KEY=release-test-key",
      "LLM_MODEL=release-test-model",
      "AGENT_V2_ENABLED=true",
      "KNOWLEDGE_OBJECT_V2=false",
      "TEACHER_ACCESS_CODE=release-teacher-2026",
      "IDENTITY_CODE_PEPPER=release-identity-pepper-0123456789012345",
      "AUTH_PROXY_SECRET=release-auth-proxy-01234567890123456789",
      `AGENT_EVAL_REPORT_PATH=${qualityReportPath}`,
      `AGENT_HARNESS_REPORT_PATH=${harnessReportPath}`,
    ].join("\n"), "utf8");

    const result = await runReleasePreparation(decoyCwd, {
      LOCALAPPDATA: localAppData,
      CHUYING_SERVICE_ENV: configPath,
      BACKUP_BASE: backupBase,
      RESTORE_BASE: restoreBase,
      KNOWLEDGE_OBJECT_V2: "true",
    });

    expect(result.code, result.stderr).toBe(0);
    const stdoutLines = result.stdout.trim().split(/\r?\n/);
    expect(stdoutLines).toHaveLength(1);
    const payload = JSON.parse(stdoutLines[0]!) as {
      ok: boolean;
      backupPath: string;
      restorePath: string;
      knowledgeMode: string;
      knowledge: Record<string, number>;
      rehearsal: {
        idempotent: boolean;
        fallbackVerified: boolean;
        final: { storage: { documentCount: number; assetCount: number } };
      };
    };
    expect(payload).toMatchObject({
      ok: true,
      knowledgeMode: "V2",
      knowledge: {
        "book-design@1": 63,
        "brand-vi-design@1": 2,
        "digital-interaction@1": 21,
        "general-design@1": 9,
        "layout-design@1": 21,
      },
      rehearsal: {
        idempotent: true,
        fallbackVerified: true,
        final: {
          storage: {
            documentCount: 116,
            assetCount: 156,
          },
        },
      },
    });
    expect(path.dirname(payload.backupPath)).toBe(backupBase);
    expect(path.dirname(payload.restorePath)).toBe(restoreBase);

    const noticeLines = result.stderr.trim().split(/\r?\n/);
    expect(noticeLines).toHaveLength(1);
    expect(JSON.parse(noticeLines[0]!)).toMatchObject({
      event: "effective-database-config",
      source: "service-env",
    });

    const checked = new Database(databasePath, { readonly: true });
    try {
      expect(checked.prepare(
        "SELECT id FROM release_sentinel",
      ).get()).toEqual({ id: "preserved" });
      expect(checked.prepare(
        "SELECT count(*) count FROM knowledge_chunks",
      ).get()).toEqual({ count: 116 });
      expect(checked.prepare(
        "SELECT count(*) count FROM knowledge_documents_v2",
      ).get()).toEqual({ count: 116 });
      expect(checked.prepare(
        "SELECT count(*) count FROM knowledge_assets_v2",
      ).get()).toEqual({ count: 156 });
      expect(checked.prepare(
        "SELECT count(*) count FROM knowledge_active_corpus_v2",
      ).get()).toEqual({ count: 1 });
    } finally {
      checked.close();
    }
  }, 60_000);
});
