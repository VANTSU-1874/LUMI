import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.PLAYWRIGHT_PORT ?? "3000");
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
const e2eNodeEnvironment = process.env.PLAYWRIGHT_USE_BUILD === "1"
  ? "production"
  : "development";
const e2eEnvironment = {
  SESSION_SECRET: "e2e-session-secret-at-least-32-characters-long",
  DATABASE_PATH: `.runtime/e2e-demo-student-flow-${e2ePort}.sqlite`,
  EVIDENCE_ROOT: `.runtime/e2e-evidence-${e2ePort}`,
  NEXT_DIST_DIR: ".next/e2e-playwright",
  IDENTITY_CODE_PEPPER: "e2e-identity-pepper-at-least-32-characters-long",
  AUTH_PROXY_SECRET: "e2e-auth-proxy-secret-at-least-32-characters-long",
  TEACHER_ACCESS_CODE: "e2e-teacher-code",
  LLM_BASE_URL: "http://127.0.0.1:9/v1",
  LLM_API_KEY: "e2e-unavailable-provider",
  LLM_MODEL: "e2e-unavailable-model",
  LLM_VISION_ENABLED: "false",
  AGENT_V3_ENABLED: "true",
};
const windowsChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browserExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (process.platform === "win32" && existsSync(windowsChrome) ? windowsChrome : undefined);
const nodeExecutable = JSON.stringify(process.execPath);
const seedCommand = `${nodeExecutable} node_modules/tsx/dist/cli.mjs tests/e2e/seed-student-flow.ts`;
const e2eServer = process.env.PLAYWRIGHT_USE_BUILD === "1"
  ? `${nodeExecutable} node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${e2ePort}`
  : `${nodeExecutable} node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port ${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: browserExecutable ? { executablePath: browserExecutable } : undefined,
      },
    },
  ],
  webServer: {
    command: `${seedCommand} && ${e2eServer}`,
    url: `http://127.0.0.1:${e2ePort}`,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    env: { ...process.env, ...e2eEnvironment, PUBLIC_APP_URL: e2eBaseUrl, NODE_ENV: e2eNodeEnvironment },
  },
});
