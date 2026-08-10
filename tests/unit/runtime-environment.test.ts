// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  effectiveDatabaseConfigNotice,
  effectiveModelConfigNotice,
  loadRuntimeEnvironment,
} from "@/lib/config/runtime-environment";

const roots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "lumi-runtime-env-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runtime environment source selection", () => {
  it("treats a loaded service environment as the atomic inference source", async () => {
    const root = await temporaryRoot();
    const localAppData = path.join(root, "local-app-data");
    const servicePath = path.join(localAppData, "ChuyingAI", "config", "service.env");
    await mkdir(path.dirname(servicePath), { recursive: true });
    await writeFile(servicePath, [
      "LLM_BASE_URL=https://service.example/v1/",
      "LLM_API_KEY=service-secret-must-not-be-logged",
      "LLM_MODEL=service-model",
      "LLM_PLANNER_MODEL=service-planner-model",
      "LLM_WEB_BASE_URL=https://service-web.example/v1",
      "LLM_WEB_API_KEY=service-web-secret-must-not-be-logged",
      "LLM_WEB_MODEL=service-web-model",
    ].join("\n"), "utf8");

    const loaded = await loadRuntimeEnvironment({
      cwd: root,
      mode: "SERVICE_OPTIONAL",
      nodeEnv: "test",
      processEnvironment: {
        NODE_ENV: "test",
        LOCALAPPDATA: localAppData,
        DATABASE_PATH: "./data/project-dev.sqlite",
        LLM_BASE_URL: "https://project.example/v1",
        LLM_API_KEY: "project-secret-must-not-be-logged",
        LLM_MODEL: "project-model",
        LLM_PLANNER_BASE_URL: "https://project-planner.example/v1",
        LLM_PLANNER_API_KEY: "project-planner-secret-must-not-be-logged",
        LLM_PLANNER_MODEL: "project-planner-model",
        LLM_WEB_BASE_URL: "https://project-web.example/v1",
        LLM_WEB_API_KEY: "project-web-secret-must-not-be-logged",
        LLM_WEB_MODEL: "project-web-model",
        LLM_EMBEDDING_BASE_URL: "https://project-embedding.example/v1",
        LLM_EMBEDDING_API_KEY: "project-embedding-secret-must-not-be-logged",
        LLM_EMBEDDING_MODEL: "project-embedding",
        AGENT_MODEL_TOTAL_TIMEOUT_MS: "99999",
      },
    });

    expect(loaded.environment).toMatchObject({
      DATABASE_PATH: "./data/project-dev.sqlite",
      LLM_BASE_URL: "https://service.example/v1/",
      LLM_API_KEY: "service-secret-must-not-be-logged",
      LLM_MODEL: "service-model",
      LLM_PLANNER_MODEL: "service-planner-model",
      LLM_WEB_BASE_URL: "https://service-web.example/v1",
      LLM_WEB_API_KEY: "service-web-secret-must-not-be-logged",
      LLM_WEB_MODEL: "service-web-model",
    });
    expect(loaded.environment.LLM_PLANNER_BASE_URL).toBeUndefined();
    expect(loaded.environment.LLM_PLANNER_API_KEY).toBeUndefined();
    expect(loaded.environment.LLM_EMBEDDING_BASE_URL).toBeUndefined();
    expect(loaded.environment.LLM_EMBEDDING_API_KEY).toBeUndefined();
    expect(loaded.environment.LLM_EMBEDDING_MODEL).toBeUndefined();
    expect(loaded.environment.AGENT_MODEL_TOTAL_TIMEOUT_MS).toBeUndefined();
    expect(loaded.provenance).toMatchObject({
      service: { status: "loaded", selection: "default" },
      model: { source: "service-env", shadowedProjectModelConfig: true },
      database: { source: "process-env", sourceFile: null },
    });

    const notice = JSON.stringify(effectiveModelConfigNotice(
      { ai: { baseUrl: "https://service.example/v1" } },
      loaded.provenance,
    ));
    expect(notice).toContain("https://service.example/v1");
    expect(notice).toContain("%LOCALAPPDATA%");
    expect(notice).not.toContain("project-secret");
    expect(notice).not.toContain("service-secret");
    expect(notice).not.toContain("LLM_API_KEY");

    const databaseNotice = JSON.stringify(effectiveDatabaseConfigNotice(
      { databasePath: loaded.environment.DATABASE_PATH },
      loaded.provenance,
      loaded.environment,
      root,
    ));
    expect(databaseNotice).toContain("effective-database-config");
    expect(databaseNotice).toContain("process-env");
    expect(databaseNotice).toContain("project-dev.sqlite");
    expect(databaseNotice).not.toContain("service-secret");
  });

  it("fails clearly when an explicitly selected service file is missing", async () => {
    const root = await temporaryRoot();
    await expect(loadRuntimeEnvironment({
      cwd: root,
      mode: "SERVICE_OPTIONAL",
      processEnvironment: {
        NODE_ENV: "test",
        CHUYING_SERVICE_ENV: path.join(root, "missing-service.env"),
      },
    })).rejects.toThrow(/SERVICE_ENV_NOT_FOUND:.+missing-service\.env/);
  });

  it("does not implicitly select the global service file for project knowledge ingestion", async () => {
    const root = await temporaryRoot();
    const localAppData = path.join(root, "local-app-data");
    const servicePath = path.join(localAppData, "ChuyingAI", "config", "service.env");
    await mkdir(path.dirname(servicePath), { recursive: true });
    await writeFile(servicePath, "DATABASE_PATH=./data/global-service.sqlite\n", "utf8");

    const loaded = await loadRuntimeEnvironment({
      cwd: root,
      mode: "EXPLICIT_SERVICE_OR_PROJECT",
      processEnvironment: {
        NODE_ENV: "test",
        LOCALAPPDATA: localAppData,
        DATABASE_PATH: "./data/project-dev.sqlite",
      },
    });

    expect(loaded.environment.DATABASE_PATH).toBe("./data/project-dev.sqlite");
    expect(loaded.provenance.service.status).toBe("disabled");
    expect(loaded.provenance.database.source).toBe("process-env");
  });

  it("reports an explicitly selected service database without exposing service secrets", async () => {
    const root = await temporaryRoot();
    const servicePath = path.join(root, "private", "service.env");
    await mkdir(path.dirname(servicePath), { recursive: true });
    await writeFile(servicePath, [
      "DATABASE_PATH=./data/service.sqlite",
      "SESSION_SECRET=service-secret-must-not-be-logged",
    ].join("\n"), "utf8");

    const loaded = await loadRuntimeEnvironment({
      cwd: root,
      mode: "EXPLICIT_SERVICE_OR_PROJECT",
      processEnvironment: {
        NODE_ENV: "test",
        CHUYING_SERVICE_ENV: servicePath,
        DATABASE_PATH: "./data/project.sqlite",
      },
    });
    const notice = JSON.stringify(effectiveDatabaseConfigNotice(
      { databasePath: loaded.environment.DATABASE_PATH },
      loaded.provenance,
      loaded.environment,
      root,
    ));

    expect(loaded.environment.DATABASE_PATH).toBe("./data/service.sqlite");
    expect(loaded.provenance.database.source).toBe("service-env");
    expect(notice).toContain("service-env");
    expect(notice).toContain("service.sqlite");
    expect(notice).not.toContain("service-secret");
  });

  it("does not inherit project Knowledge V2 feature flags into a selected service", async () => {
    const root = await temporaryRoot();
    const servicePath = path.join(root, "private", "service.env");
    await mkdir(path.dirname(servicePath), { recursive: true });
    await writeFile(servicePath, [
      "DATABASE_PATH=./data/service.sqlite",
      "SESSION_SECRET=service-secret-must-not-be-logged",
    ].join("\n"), "utf8");
    await writeFile(
      path.join(root, ".env.test"),
      [
        "KNOWLEDGE_OBJECT_V2=true",
        "VISUAL_RETRIEVAL=true",
        "EVIDENCE_BUNDLE_V2=true",
        "KNOWLEDGE_V2_CANARY_USER_IDS=project-user-1",
        "",
      ].join("\n"),
      "utf8",
    );
    vi.stubEnv("CHUYING_SERVICE_ENV", servicePath);
    vi.stubEnv("NODE_ENV", "test");
    delete process.env.KNOWLEDGE_OBJECT_V2;
    delete process.env.VISUAL_RETRIEVAL;
    delete process.env.EVIDENCE_BUNDLE_V2;
    delete process.env.KNOWLEDGE_V2_CANARY_USER_IDS;

    const loaded = await loadRuntimeEnvironment({
      cwd: root,
      mode: "EXPLICIT_SERVICE_OR_PROJECT",
      nodeEnv: "test",
    });

    expect(loaded.environment.KNOWLEDGE_OBJECT_V2).toBeUndefined();
    expect(loaded.environment.VISUAL_RETRIEVAL).toBeUndefined();
    expect(loaded.environment.EVIDENCE_BUNDLE_V2).toBeUndefined();
    expect(loaded.environment.KNOWLEDGE_V2_CANARY_USER_IDS).toBeUndefined();
    expect(loaded.environment.DATABASE_PATH).toBe("./data/service.sqlite");
    expect(loaded.provenance.database.source).toBe("service-env");
  });

  it("isolates an injected environment from host variables and project env files", async () => {
    const root = await temporaryRoot();
    await writeFile(path.join(root, ".env.test"), "FILE_ONLY=must-not-load\n", "utf8");
    const hostPath = process.env.PATH;
    const processedMarker = process.env.__NEXT_PROCESSED_ENV;

    const loaded = await loadRuntimeEnvironment({
      cwd: root,
      mode: "PROJECT_ONLY",
      processEnvironment: {
        NODE_ENV: "test",
        RUNTIME_INJECTED_ONLY: "injected-value",
      },
    });

    expect(loaded.environment.RUNTIME_INJECTED_ONLY).toBe("injected-value");
    expect(loaded.environment.PATH).toBeUndefined();
    expect(loaded.environment.FILE_ONLY).toBeUndefined();
    expect(process.env.PATH).toBe(hostPath);
    expect(process.env.RUNTIME_INJECTED_ONLY).toBeUndefined();
    expect(process.env.FILE_ONLY).toBeUndefined();
    expect(process.env.__NEXT_PROCESSED_ENV).toBe(processedMarker);
  });

  it("treats an explicitly empty processEnvironment as an isolated snapshot", async () => {
    const root = await temporaryRoot();
    await writeFile(path.join(root, ".env.test"), "FILE_ONLY=must-not-load\n", "utf8");

    const loaded = await loadRuntimeEnvironment({
      cwd: root,
      mode: "PROJECT_ONLY",
      nodeEnv: "test",
      processEnvironment: {},
    });

    expect(loaded.environment).toMatchObject({ NODE_ENV: "test" });
    expect(loaded.environment.FILE_ONLY).toBeUndefined();
    expect(loaded.environment.PATH).toBeUndefined();
  });
});
