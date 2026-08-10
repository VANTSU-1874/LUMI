import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TUTOR_QUALITY_CASE_COUNT } from "@/lib/agent/tutor-quality-suite";

const repositoryRoot = path.resolve(".");
const tsxCli = path.join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
const qualityScript = path.join(repositoryRoot, "scripts", "evaluate-tutor-quality.ts");
const roots: string[] = [];
const servers: Server[] = [];

type RequestKind = "ANSWER" | "JUDGE";
type FakeReply = "OK" | "UNAVAILABLE" | "REJECTED" | "DISCONNECT";
type FakeRequest = { kind: RequestKind };
type ProgressSummary = {
  status: string;
  entries: Array<{ caseId: string; stage: "ANSWERED" | "JUDGED" }>;
};

const judgment = {
  schemaVersion: 1,
  scores: {
    specificityAndUsefulness: 5,
    professionalCorrectness: 5,
    executableFirstStep: 5,
    followUpJudgment: 5,
    sourceAndUncertainty: 5,
  },
  hardFailures: {
    AUTHORITY_OVERREACH: { occurred: false, evidence: null },
    FABRICATED_SOURCE: { occurred: false, evidence: null },
    PRIVACY_LEAK: { occurred: false, evidence: null },
  },
  rationale: "本地假服务只验证评测断点状态机。",
  evidence: ["local fake provider returned the strict judgment tool"],
};

function responseBody(kind: RequestKind, sequence: number) {
  const output = kind === "JUDGE"
    ? [{
        type: "function_call",
        call_id: `judge_${sequence}`,
        name: "submit_tutor_quality_judgment",
        arguments: JSON.stringify(judgment),
      }]
    : [{
        type: "message",
        content: [{
          type: "output_text",
          text: "先复制当前版本，只调整一个设计变量，再比较结果。",
        }],
      }];
  return JSON.stringify({
    id: `resp_${sequence}`,
    status: "completed",
    output,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  });
}

async function requestJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    tools?: Array<{ name?: string }>;
  };
}

async function fakeProvider(
  responder: (request: FakeRequest) => FakeReply,
) {
  const observations: RequestKind[] = [];
  let sequence = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await requestJson(request);
      const kind: RequestKind = body.tools?.some(({ name }) =>
        name === "submit_tutor_quality_judgment") ? "JUDGE" : "ANSWER";
      observations.push(kind);
      sequence += 1;
      const reply = responder({ kind });
      if (reply === "UNAVAILABLE") {
        response.writeHead(503, { "content-type": "text/plain" });
        response.end("temporarily unavailable");
        return;
      }
      if (reply === "REJECTED") {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end("request rejected");
        return;
      }
      if (reply === "DISCONNECT") {
        request.socket.destroy();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(responseBody(kind, sequence));
    } catch {
      response.writeHead(400).end();
    }
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FAKE_PROVIDER_ADDRESS_MISSING");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    observations,
    setResponder(next: (request: FakeRequest) => FakeReply) {
      responder = next;
    },
  };
}

async function testTarget(baseUrl: string) {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-quality-runner-"));
  roots.push(root);
  const reportPath = path.join(root, "latest.json");
  const serviceEnvironmentPath = path.join(root, "service.env");
  const secret = randomBytes(32).toString("hex");
  const fakeApiKey = randomBytes(32).toString("hex");
  await writeFile(serviceEnvironmentPath, [
    `SESSION_SECRET=${secret}`,
    `LLM_BASE_URL=${baseUrl}`,
    `LLM_API_KEY=${fakeApiKey}`,
    "LLM_MODEL=gpt-5.6-runner-test",
    "LLM_MAX_OUTPUT_TOKENS=2048",
    "LLM_VISION_ENABLED=true",
    "AGENT_V3_ENABLED=true",
    "",
  ].join("\n"), "utf8");
  return {
    root,
    baseUrl,
    fakeApiKey,
    reportPath,
    progressPath: `${reportPath}.progress.json`,
    serviceEnvironmentPath,
  };
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readProgress(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as ProgressSummary;
}

async function runQualityCli(input: {
  reportPath: string;
  serviceEnvironmentPath: string;
  restart?: boolean;
}) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CHUYING_SERVICE_ENV: input.serviceEnvironmentPath,
    TUTOR_QUALITY_REPORT_PATH: input.reportPath,
    LOCALAPPDATA: path.dirname(input.reportPath),
    NODE_ENV: "test",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };
  delete environment.LLM_EMBEDDING_BASE_URL;
  delete environment.LLM_EMBEDDING_API_KEY;
  delete environment.LLM_EMBEDDING_MODEL;
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [
      tsxCli,
      qualityScript,
      ...(input.restart ? ["--restart"] : []),
    ], {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk).slice(0, 16_384); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk).slice(0, 16_384); });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("TUTOR_QUALITY_TEST_PROCESS_TIMEOUT"));
    }, 120_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

function structuredOutput(stdout: string) {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed.status === "string") return parsed;
    } catch {
      // Case progress lines are intentionally not JSON.
    }
  }
  throw new Error("TUTOR_QUALITY_STRUCTURED_OUTPUT_MISSING");
}

function diagnosticPath(stdout: string) {
  const value = structuredOutput(stdout).diagnosticLogPath;
  if (typeof value !== "string") throw new Error("TUTOR_QUALITY_DIAGNOSTIC_PATH_MISSING");
  return path.resolve(value);
}

function isRepositoryExternal(filePath: string) {
  const relative = path.relative(repositoryRoot, filePath);
  return relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.sequential("tutor quality CLI service-interruption checkpoints", () => {
  it("stops on an answer 503 with an empty resumable checkpoint and no report", async () => {
    const provider = await fakeProvider(() => "UNAVAILABLE");
    const target = await testTarget(provider.baseUrl);

    const result = await runQualityCli({ ...target, restart: true });

    expect(result.code).toBe(75);
    expect(provider.observations).toEqual(["ANSWER", "ANSWER", "ANSWER"]);
    expect(structuredOutput(result.stdout)).toMatchObject({
      status: "MODEL_UNAVAILABLE",
      stage: "ANSWER",
      requestMode: "NON_STREAMING",
      transportCode: null,
      protocolCode: null,
      errorSummary: "MODEL_PROVIDER_STATUS",
      diagnosticLogStatus: "WRITTEN",
      diagnosticLogPath: expect.any(String),
    });
    const logPath = diagnosticPath(result.stdout);
    expect(isRepositoryExternal(logPath)).toBe(true);
    const diagnosticLog = await readFile(logPath, "utf8");
    expect(diagnosticLog).toContain('"errorCode":"PROVIDER_STATUS"');
    expect(`${result.stdout}\n${result.stderr}\n${diagnosticLog}`).not.toContain(target.fakeApiKey);
    expect(`${result.stdout}\n${diagnosticLog}`).not.toContain(target.baseUrl);
    expect(result.stderr).toContain(`"baseUrl":"${target.baseUrl}"`);
    expect(result.stderr).toContain('"source":"service-env"');
    expect(`${result.stdout}\n${result.stderr}\n${diagnosticLog}`).not.toContain("temporarily unavailable");
    expect(await exists(target.reportPath)).toBe(false);
    const progress = await readProgress(target.progressPath);
    expect(progress.status).toBe("RUNNING");
    expect(progress.entries).toEqual([]);
  }, 120_000);

  it("stops terminally on an answer 400 while preserving its checkpoint and no report", async () => {
    const provider = await fakeProvider(() => "REJECTED");
    const target = await testTarget(provider.baseUrl);

    const result = await runQualityCli({ ...target, restart: true });

    expect(result.code).toBe(1);
    expect(provider.observations).toEqual(["ANSWER"]);
    expect(await exists(target.reportPath)).toBe(false);
    const progress = await readProgress(target.progressPath);
    expect(progress.status).toBe("RUNNING");
    expect(progress.entries).toEqual([]);
  }, 120_000);

  it("treats a dropped answer connection as resumable transport failure", async () => {
    const provider = await fakeProvider(() => "DISCONNECT");
    const target = await testTarget(provider.baseUrl);

    const result = await runQualityCli({ ...target, restart: true });

    expect(result.code).toBe(75);
    expect(provider.observations).toEqual(["ANSWER", "ANSWER", "ANSWER"]);
    expect(await exists(target.reportPath)).toBe(false);
    const progress = await readProgress(target.progressPath);
    expect(progress.status).toBe("RUNNING");
    expect(progress.entries).toEqual([]);
  }, 120_000);

  it("preserves ANSWERED after a judge 503 and resumes at the judge", async () => {
    const firstPlan: Array<{ kind: RequestKind; reply: FakeReply }> = [
      { kind: "ANSWER", reply: "OK" },
      { kind: "JUDGE", reply: "UNAVAILABLE" },
    ];
    const provider = await fakeProvider(({ kind }) => {
      const next = firstPlan.shift();
      return next?.kind === kind ? next.reply : "UNAVAILABLE";
    });
    const target = await testTarget(provider.baseUrl);

    const first = await runQualityCli({ ...target, restart: true });

    expect(first.code).toBe(75);
    expect(provider.observations).toEqual(["ANSWER", "JUDGE"]);
    expect(await exists(target.reportPath)).toBe(false);
    const answered = await readProgress(target.progressPath);
    expect(answered.entries).toHaveLength(1);
    expect(answered.entries[0]).toMatchObject({
      caseId: "di-explore-goal",
      stage: "ANSWERED",
    });

    const secondPlan: Array<{ kind: RequestKind; reply: FakeReply }> = [
      { kind: "JUDGE", reply: "OK" },
      { kind: "ANSWER", reply: "UNAVAILABLE" },
    ];
    provider.observations.length = 0;
    provider.setResponder(({ kind }) => {
      const next = secondPlan.shift();
      return next?.kind === kind ? next.reply : "UNAVAILABLE";
    });

    const second = await runQualityCli(target);

    expect(second.code).toBe(75);
    expect(provider.observations).toEqual(["JUDGE", "ANSWER", "ANSWER", "ANSWER"]);
    expect(await exists(target.reportPath)).toBe(false);
    const resumed = await readProgress(target.progressPath);
    expect(resumed.entries).toHaveLength(1);
    expect(resumed.entries[0]).toMatchObject({
      caseId: "di-explore-goal",
      stage: "JUDGED",
    });
  }, 120_000);

  it("preserves all judged entries when privacy probing receives a 503", async () => {
    let judgedCount = 0;
    const provider = await fakeProvider(({ kind }) => {
      if (kind === "JUDGE") {
        judgedCount += 1;
        return "OK";
      }
      return judgedCount >= TUTOR_QUALITY_CASE_COUNT ? "UNAVAILABLE" : "OK";
    });
    const target = await testTarget(provider.baseUrl);

    const result = await runQualityCli({ ...target, restart: true });

    expect(result.code).toBe(75);
    expect(judgedCount).toBe(TUTOR_QUALITY_CASE_COUNT);
    expect(provider.observations.at(-1)).toBe("ANSWER");
    expect(await exists(target.reportPath)).toBe(false);
    const progress = await readProgress(target.progressPath);
    expect(progress.status).toBe("RUNNING");
    expect(progress.entries).toHaveLength(TUTOR_QUALITY_CASE_COUNT);
    expect(progress.entries.every(({ stage }) => stage === "JUDGED")).toBe(true);

    provider.observations.length = 0;
    provider.setResponder(() => "UNAVAILABLE");

    const resumed = await runQualityCli(target);

    expect(resumed.code).toBe(75);
    expect(provider.observations).toEqual(["ANSWER", "ANSWER", "ANSWER"]);
    expect(await exists(target.reportPath)).toBe(false);
    const resumedProgress = await readProgress(target.progressPath);
    expect(resumedProgress.entries).toHaveLength(TUTOR_QUALITY_CASE_COUNT);
    expect(resumedProgress.entries.every(({ stage }) => stage === "JUDGED")).toBe(true);
  }, 120_000);
});
