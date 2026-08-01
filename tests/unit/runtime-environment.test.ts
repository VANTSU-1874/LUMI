// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
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
    });
    expect(loaded.environment.LLM_EMBEDDING_BASE_URL).toBeUndefined();
    expect(loaded.environment.LLM_EMBEDDING_API_KEY).toBeUndefined();
    expect(loaded.environment.LLM_EMBEDDING_MODEL).toBeUndefined();
    expect(loaded.environment.AGENT_MODEL_TOTAL_TIMEOUT_MS).toBeUndefined();
    expect(loaded.provenance).toMatchObject({
      service: { status: "loaded", selection: "default" },
      model: { source: "service-env", shadowedProjectModelConfig: true },
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
