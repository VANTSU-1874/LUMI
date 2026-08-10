import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireAgentEvaluationRunLock,
  releaseAgentEvaluationRunLock,
} from "@/lib/agent/evaluation-progress";

const repositoryRoot = path.resolve(".");
const tsxCli = path.join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
const evaluationScript = path.join(repositoryRoot, "scripts", "evaluate-agent.ts");
const roots: string[] = [];
const servers: Server[] = [];
const TEST_API_KEY = "agent-eval-test-api-key-must-not-appear";

type FakeReply =
  | "OK"
  | "OK_WITH_BRIEF"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "REJECTED"
  | "STREAM_ERROR"
  | "INVALID_JSON"
  | "INVALID_SCHEMA"
  | "MALFORMED_PROTOCOL";
const BRIEF_SENTINEL = "CROSS_CASE_BRIEF_SENTINEL";
const PROVIDER_PAYLOAD_SENTINEL = "PROVIDER_PAYLOAD_SENTINEL_MUST_NOT_APPEAR";

async function consumeRequest(request: IncomingMessage) {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
  }
  return body;
}

async function fakeProvider(initialPlan: FakeReply[]) {
  let plan = [...initialPlan];
  const observations: FakeReply[] = [];
  const requestBodies: string[] = [];
  let sequence = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404).end();
      return;
    }
    const requestBody = await consumeRequest(request);
    requestBodies.push(requestBody);
    const reply = plan.shift() ?? "OK";
    observations.push(reply);
    sequence += 1;
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
    if (reply === "RATE_LIMITED") {
      response.writeHead(429, { "content-type": "text/plain", "retry-after": "10" });
      response.end("rate limited");
      return;
    }
    if (reply === "STREAM_ERROR") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.flushHeaders();
      response.write(`event: response.output_text.delta\ndata: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: "partial upstream output",
      })}\n\n`);
      setTimeout(() => response.destroy(Object.assign(new Error(
        `provider payload: ${PROVIDER_PAYLOAD_SENTINEL}`,
      ), { code: "ECONNRESET" })), 10);
      return;
    }
    if (reply === "MALFORMED_PROTOCOL") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`event: response.private_upstream_detail\ndata: ${JSON.stringify({
        type: "response.private_upstream_detail",
        provider_payload: PROVIDER_PAYLOAD_SENTINEL,
      })}\n\nevent: done\ndata: [DONE]\n\n`);
      return;
    }
    if (reply === "INVALID_JSON") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`event: response.output_text.delta\ndata: ${PROVIDER_PAYLOAD_SENTINEL}\n\n`);
      return;
    }
    if (reply === "INVALID_SCHEMA") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`event: response.output_text.delta\ndata: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: { provider_payload: PROVIDER_PAYLOAD_SENTINEL },
      })}\n\n`);
      return;
    }
    const text = reply === "OK_WITH_BRIEF"
      ? `先明确体验目标，再只改变一个设计变量做小范围对照。\n<!-- tutor-meta {"briefPatch":{"designGoal":{"value":"${BRIEF_SENTINEL}","status":"INFERRED"}}} -->`
      : "先明确体验目标，再只改变一个设计变量做小范围对照。";
    const completedResponse = {
      id: `resp_${sequence}`,
      status: "completed",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text,
        }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    };
    const parsedRequest = JSON.parse(requestBody) as { stream?: unknown };
    if (parsedRequest.stream === true) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end([
        `event: response.output_text.delta\ndata: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: text,
        })}`,
        `event: response.completed\ndata: ${JSON.stringify({
          type: "response.completed",
          response: completedResponse,
        })}`,
      ].join("\n\n") + "\n\n");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(completedResponse));
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
    requestBodies,
    setPlan(next: FakeReply[]) {
      plan = [...next];
      observations.length = 0;
      requestBodies.length = 0;
    },
  };
}

async function testTarget() {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-agent-eval-resume-"));
  roots.push(root);
  const reportPath = path.join(root, "latest.json");
  const sentinelReport = "existing-release-report\n";
  await writeFile(reportPath, sentinelReport, "utf8");
  return {
    root,
    reportPath,
    progressPath: `${reportPath}.progress.json`,
    lockPath: `${reportPath}.lock.sqlite`,
    sentinelReport,
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

async function runEvaluationCli(input: {
  baseUrl: string;
  reportPath: string;
  root: string;
  restart?: boolean;
  modelId?: string;
}) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    LOCALAPPDATA: input.root,
    AGENT_EVAL_REPORT_PATH: input.reportPath,
    SESSION_SECRET: randomBytes(32).toString("hex"),
    LLM_BASE_URL: input.baseUrl,
    LLM_API_KEY: TEST_API_KEY,
    LLM_MODEL: input.modelId ?? "gpt-5.6-agent-eval-runner-test",
    LLM_MAX_OUTPUT_TOKENS: "2048",
    LLM_VISION_ENABLED: "true",
    AGENT_V3_ENABLED: "true",
    AGENT_EVAL_MODEL_IDLE_TIMEOUT_MS: "1000",
    AGENT_EVAL_MODEL_TOTAL_TIMEOUT_MS: "6000",
    AGENT_EVAL_TURN_TOTAL_TIMEOUT_MS: "9000",
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
      evaluationScript,
      ...(input.restart ? ["--restart"] : []),
    ], {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk).slice(0, 32_768); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk).slice(0, 32_768); });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("AGENT_EVALUATION_TEST_PROCESS_TIMEOUT"));
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
      // Progress lines are intentionally not JSON.
    }
  }
  throw new Error("AGENT_EVALUATION_STRUCTURED_OUTPUT_MISSING");
}

function diagnosticPath(stdout: string) {
  const value = structuredOutput(stdout).diagnosticLogPath;
  if (typeof value !== "string") throw new Error("AGENT_EVALUATION_DIAGNOSTIC_PATH_MISSING");
  return path.resolve(value);
}

function isRepositoryExternal(filePath: string) {
  const relative = path.relative(repositoryRoot, filePath);
  return relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative));
}

async function closedProviderBaseUrl() {
  const server = createServer((_request, response) => response.writeHead(503).end());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("CLOSED_PROVIDER_ADDRESS_MISSING");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return `http://127.0.0.1:${address.port}/v1`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.sequential("agent evaluation CLI resumable checkpoints", () => {
  it("keeps only the completed prefix, preserves latest, and replays an interrupted case prelude", async () => {
    const provider = await fakeProvider([
      ...Array.from({ length: 20 }, (): FakeReply => "OK"),
      "OK",
      ...Array.from({ length: 3 }, (): FakeReply => "UNAVAILABLE"),
    ]);
    const target = await testTarget();

    const first = await runEvaluationCli({ ...target, baseUrl: provider.baseUrl, restart: true });

    expect(first.code).toBe(75);
    expect(provider.observations).toHaveLength(24);
    expect(provider.observations.slice(-4)).toEqual([
      "OK",
      "UNAVAILABLE",
      "UNAVAILABLE",
      "UNAVAILABLE",
    ]);
    expect(provider.requestBodies.every((body) =>
      (JSON.parse(body) as { stream?: unknown }).stream === true)).toBe(true);
    const interruption = structuredOutput(first.stdout);
    expect(interruption).toMatchObject({
      status: "MODEL_UNAVAILABLE",
      requestMode: "AGENT_STREAMING",
      transportCode: null,
      protocolCode: null,
      errorSummary: "MODEL_PROVIDER_STATUS",
      diagnosticLogStatus: "WRITTEN",
      diagnosticLogPath: expect.any(String),
    });
    expect(interruption).not.toHaveProperty("errorCauseChain");
    expect(interruption).not.toHaveProperty("errorMessage");
    const logPath = diagnosticPath(first.stdout);
    expect(isRepositoryExternal(logPath)).toBe(true);
    const diagnosticLog = await readFile(logPath, "utf8");
    expect(diagnosticLog).toContain('"errorCode":"PROVIDER_STATUS"');
    expect(first.stdout).not.toContain(TEST_API_KEY);
    expect(first.stdout).not.toContain(provider.baseUrl);
    expect(first.stdout).not.toContain("temporarily unavailable");
    expect(diagnosticLog).not.toContain(TEST_API_KEY);
    expect(diagnosticLog).not.toContain(provider.baseUrl);
    expect(diagnosticLog).not.toContain("temporarily unavailable");
    expect(await readFile(target.reportPath, "utf8")).toBe(target.sentinelReport);
    const checkpoint = JSON.parse(await readFile(target.progressPath, "utf8")) as {
      schemaVersion: number;
      status: string;
      nextCaseIndex: number;
      results: Array<{ caseId: string }>;
    };
    expect(checkpoint).toMatchObject({
      schemaVersion: 6,
      status: "RUNNING",
      nextCaseIndex: 20,
    });
    expect(checkpoint.results).toHaveLength(20);
    expect(await exists(target.lockPath)).toBe(true);

    provider.setPlan(["OK", "UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE"]);
    const resumed = await runEvaluationCli({ ...target, baseUrl: provider.baseUrl });

    expect(resumed.code).toBe(75);
    expect(resumed.stdout).toContain("[resume] 已恢复 20/37 个案例");
    expect(provider.observations).toEqual([
      "OK",
      "UNAVAILABLE",
      "UNAVAILABLE",
      "UNAVAILABLE",
    ]);
    expect(await readFile(target.reportPath, "utf8")).toBe(target.sentinelReport);
    const unchanged = JSON.parse(await readFile(target.progressPath, "utf8")) as {
      nextCaseIndex: number;
      results: Array<{ caseId: string }>;
    };
    expect(unchanged.nextCaseIndex).toBe(20);
    expect(unchanged.results).toHaveLength(20);
    expect(await exists(target.lockPath)).toBe(true);

    provider.setPlan([]);
    const completed = await runEvaluationCli({ ...target, baseUrl: provider.baseUrl });

    expect([0, 1]).toContain(completed.code);
    expect(completed.stdout).toContain("[resume] 已恢复 20/37 个案例");
    const report = JSON.parse(await readFile(target.reportPath, "utf8")) as {
      caseCount: number;
      results: Array<{ caseId: string }>;
    };
    const suite = JSON.parse(await readFile(
      path.join(repositoryRoot, "data", "evals", "agent-core.json"),
      "utf8",
    )) as { cases: Array<{ id: string }> };
    expect(report.caseCount).toBe(37);
    expect(report.results.map(({ caseId }) => caseId))
      .toEqual(suite.cases.map(({ id }) => id));
    expect(new Set(report.results.map(({ caseId }) => caseId)).size).toBe(37);
    expect(await exists(target.progressPath)).toBe(false);
    expect(await exists(target.lockPath)).toBe(true);
  }, 120_000);

  it("clears the old prefix with --restart", async () => {
    const provider = await fakeProvider(["OK", "UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE"]);
    const target = await testTarget();
    const first = await runEvaluationCli({ ...target, baseUrl: provider.baseUrl, restart: true });

    provider.setPlan(["UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE"]);
    const restarted = await runEvaluationCli({ ...target, baseUrl: provider.baseUrl, restart: true });

    expect(restarted.code).toBe(75);
    expect(restarted.stdout).not.toContain("[resume]");
    expect(provider.observations).toEqual(["UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE"]);
    const checkpoint = JSON.parse(await readFile(target.progressPath, "utf8")) as {
      nextCaseIndex: number;
      results: unknown[];
    };
    expect(checkpoint.nextCaseIndex).toBe(0);
    expect(checkpoint.results).toEqual([]);
    expect(await readFile(target.reportPath, "utf8")).toBe(target.sentinelReport);
    const firstLogPath = diagnosticPath(first.stdout);
    const restartedLogPath = diagnosticPath(restarted.stdout);
    expect(restartedLogPath).not.toBe(firstLogPath);
    expect((await readFile(firstLogPath, "utf8")).trim().split(/\r?\n/)).toHaveLength(1);
    expect((await readFile(restartedLogPath, "utf8")).trim().split(/\r?\n/)).toHaveLength(1);
  }, 120_000);

  it("records a real fetch rejection without exposing connection configuration", async () => {
    const target = await testTarget();
    const baseUrl = await closedProviderBaseUrl();

    const result = await runEvaluationCli({ ...target, baseUrl, restart: true });

    expect(result.code).toBe(75);
    const interruption = structuredOutput(result.stdout);
    expect(interruption).toMatchObject({
      status: "MODEL_UNAVAILABLE",
      requestMode: "AGENT_STREAMING",
      errorSummary: expect.stringMatching(/^MODEL_TRANSPORT:/),
      transportCode: expect.any(String),
      protocolCode: null,
      diagnosticLogStatus: "WRITTEN",
    });
    const log = await readFile(diagnosticPath(result.stdout), "utf8");
    expect(log).toContain('"name":"ModelServiceError"');
    expect(log).toContain('"name":"TypeError"');
    expect(`${result.stdout}\n${result.stderr}\n${log}`).not.toContain(TEST_API_KEY);
    expect(`${result.stdout}\n${log}`).not.toContain(baseUrl);
    expect(result.stderr).toContain(`"baseUrl":"${baseUrl}"`);
    expect(result.stderr).toContain('"source":"process-env"');
  }, 120_000);

  it("recovers one real post-delta stream failure without retaining failed-attempt text", async () => {
    const provider = await fakeProvider(["STREAM_ERROR"]);
    const target = await testTarget();

    const result = await runEvaluationCli({ ...target, baseUrl: provider.baseUrl, restart: true });

    expect(result.code).toBe(0);
    expect(provider.observations.slice(0, 2)).toEqual(["STREAM_ERROR", "OK"]);
    const reportText = await readFile(target.reportPath, "utf8");
    const report = JSON.parse(reportText) as {
      results: Array<{
        observed: {
          message: string;
          modelRetryCount: number;
        };
      }>;
    };
    expect(report.results[0]?.observed).toMatchObject({
      message: "先明确体验目标，再只改变一个设计变量做小范围对照。",
      modelRetryCount: 1,
    });
    expect(reportText).not.toContain("partial upstream output");
    expect(reportText).not.toContain(PROVIDER_PAYLOAD_SENTINEL);
  }, 120_000);

  it("retains a response-stream partial answer after every retry fails and redacts provider payload text", async () => {
    const provider = await fakeProvider(
      Array.from({ length: 3 }, (): FakeReply => "STREAM_ERROR"),
    );
    const target = await testTarget();

    const result = await runEvaluationCli({ ...target, baseUrl: provider.baseUrl, restart: true });

    expect(result.code).toBe(0);
    expect(provider.observations.slice(0, 3)).toEqual([
      "STREAM_ERROR",
      "STREAM_ERROR",
      "STREAM_ERROR",
    ]);
    expect(provider.observations.slice(3).every((reply) => reply === "OK")).toBe(true);
    const reportText = await readFile(target.reportPath, "utf8");
    const report = JSON.parse(reportText) as {
      results: Array<{
        observed: {
          aiMode: string;
          message: string;
          whyThisStep: string;
          uncertainty: string;
          modelRetryCount: number;
        };
      }>;
    };
    expect(report.results[0]?.observed).toMatchObject({
      aiMode: "MODEL_ASSISTED",
      message: "partial upstream output",
      whyThisStep: expect.stringContaining("模型连接在回答完成前中断"),
      uncertainty: expect.stringContaining("本回答未完成"),
      modelRetryCount: 2,
    });
    expect(`${result.stdout}\n${result.stderr}\n${reportText}`).not.toContain(TEST_API_KEY);
    expect(`${result.stdout}\n${reportText}`).not.toContain(provider.baseUrl);
    expect(result.stderr).toContain(`"baseUrl":"${provider.baseUrl}"`);
    expect(`${result.stdout}\n${result.stderr}\n${reportText}`).not.toContain(PROVIDER_PAYLOAD_SENTINEL);
    expect(`${result.stdout}\n${result.stderr}\n${reportText}`).not.toContain(PROVIDER_PAYLOAD_SENTINEL.slice(0, 10));
  }, 120_000);

  it("logs malformed protocol diagnostics when deterministic fallback continues", async () => {
    const provider = await fakeProvider([
      ...Array.from({ length: 3 }, (): FakeReply => "INVALID_JSON"),
      ...Array.from({ length: 3 }, (): FakeReply => "INVALID_SCHEMA"),
      ...Array.from({ length: 3 }, (): FakeReply => "MALFORMED_PROTOCOL"),
      ...Array.from({ length: 3 }, (): FakeReply => "UNAVAILABLE"),
    ]);
    const target = await testTarget();

    const result = await runEvaluationCli({ ...target, baseUrl: provider.baseUrl, restart: true });

    expect(result.code).toBe(75);
    expect(provider.observations).toEqual([
      ...Array.from({ length: 3 }, (): FakeReply => "INVALID_JSON"),
      ...Array.from({ length: 3 }, (): FakeReply => "INVALID_SCHEMA"),
      ...Array.from({ length: 3 }, (): FakeReply => "MALFORMED_PROTOCOL"),
      ...Array.from({ length: 3 }, (): FakeReply => "UNAVAILABLE"),
    ]);
    const checkpoint = JSON.parse(await readFile(target.progressPath, "utf8")) as {
      nextCaseIndex: number;
      results: Array<{ observed: { aiMode: string; modelErrors: string[] } }>;
    };
    expect(checkpoint.nextCaseIndex).toBe(3);
    expect(checkpoint.results).toHaveLength(3);
    expect(checkpoint.results.every(({ observed }) =>
      observed.aiMode === "DETERMINISTIC_FALLBACK")).toBe(true);
    expect(checkpoint.results.every(({ observed }) =>
      observed.modelErrors.join("\n").includes("INVALID_RESPONSE"))).toBe(true);
    const log = await readFile(diagnosticPath(result.stdout), "utf8");
    const entries = log.trim().split(/\r?\n/).map((line) => JSON.parse(line) as {
      outcome: string;
      diagnostics: { modelProtocolErrorCodes: string[] };
    });
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({
      outcome: "DEGRADED_CONTINUED",
      diagnostics: { modelProtocolErrorCodes: ["JSON_INVALID"] },
    });
    expect(entries[1]).toMatchObject({
      outcome: "DEGRADED_CONTINUED",
      diagnostics: { modelProtocolErrorCodes: ["EVENT_SCHEMA_INVALID"] },
    });
    expect(entries[2]).toMatchObject({
      outcome: "DEGRADED_CONTINUED",
      diagnostics: { modelProtocolErrorCodes: ["OUTPUT_EMPTY"] },
    });
    expect(entries[3]).toMatchObject({ outcome: "INTERRUPTED" });
    expect(`${result.stdout}\n${result.stderr}\n${log}`).not.toContain(TEST_API_KEY);
    expect(`${result.stdout}\n${log}`).not.toContain(provider.baseUrl);
    expect(result.stderr).toContain(`"baseUrl":"${provider.baseUrl}"`);
    expect(`${result.stdout}\n${result.stderr}\n${log}`).not.toContain(PROVIDER_PAYLOAD_SENTINEL);
    expect(`${result.stdout}\n${result.stderr}\n${log}`).not.toContain(PROVIDER_PAYLOAD_SENTINEL.slice(0, 10));
  }, 120_000);

  it("records a permanent prelude provider rejection as a failed completed case", async () => {
    const provider = await fakeProvider([
      ...Array.from({ length: 20 }, (): FakeReply => "OK"),
      "REJECTED",
      ...Array.from({ length: 3 }, (): FakeReply => "UNAVAILABLE"),
    ]);
    const target = await testTarget();

    const result = await runEvaluationCli({ ...target, baseUrl: provider.baseUrl, restart: true });

    expect(result.code).toBe(75);
    expect(provider.observations).toHaveLength(24);
    expect(provider.observations.slice(-4)).toEqual([
      "REJECTED",
      "UNAVAILABLE",
      "UNAVAILABLE",
      "UNAVAILABLE",
    ]);
    const checkpoint = JSON.parse(await readFile(target.progressPath, "utf8")) as {
      nextCaseIndex: number;
      results: Array<{
        caseId: string;
        passed: boolean;
        observed: { aiMode: string; modelErrors: string[] };
      }>;
    };
    expect(checkpoint.nextCaseIndex).toBe(21);
    expect(checkpoint.results[20]).toMatchObject({
      caseId: "book-reflect-layout-choice",
      passed: false,
      observed: { aiMode: "DETERMINISTIC_FALLBACK" },
    });
    expect(checkpoint.results[20]?.observed.modelErrors.join("\n")).toContain("PROVIDER_STATUS");
    expect(await readFile(target.reportPath, "utf8")).toBe(target.sentinelReport);
    expect(await exists(target.progressPath)).toBe(true);
    expect(await exists(target.lockPath)).toBe(true);
  }, 120_000);

  it("clears project-brief state before the next case", async () => {
    const provider = await fakeProvider([
      "OK_WITH_BRIEF",
      "UNAVAILABLE",
      "UNAVAILABLE",
      "UNAVAILABLE",
    ]);
    const target = await testTarget();

    const result = await runEvaluationCli({ ...target, baseUrl: provider.baseUrl, restart: true });

    expect(result.code).toBe(75);
    expect(provider.requestBodies).toHaveLength(4);
    expect(provider.requestBodies.every((body) => !body.includes(BRIEF_SENTINEL))).toBe(true);
    expect(await exists(target.lockPath)).toBe(true);
  }, 120_000);

  it("persists a rate-limit cooldown only after the final fallback", async () => {
    const provider = await fakeProvider(["RATE_LIMITED"]);
    const target = await testTarget();

    const first = await runEvaluationCli({ ...target, baseUrl: provider.baseUrl, restart: true });

    expect(first.code).toBe(75);
    const checkpoint = JSON.parse(await readFile(target.progressPath, "utf8")) as {
      status: string;
      nextCaseIndex: number;
      cooldownUntil: string | null;
    };
    expect(checkpoint).toMatchObject({
      status: "RATE_LIMITED",
      nextCaseIndex: 0,
      cooldownUntil: expect.any(String),
    });
    expect(await readFile(target.reportPath, "utf8")).toBe(target.sentinelReport);
    expect(await exists(target.lockPath)).toBe(true);

    const coolingDown = await runEvaluationCli({ ...target, baseUrl: provider.baseUrl });
    expect(coolingDown.code).toBe(75);
    expect(coolingDown.stdout).toContain('"status":"RATE_LIMITED"');
    expect(provider.observations).toEqual(["RATE_LIMITED"]);
    expect(await exists(target.lockPath)).toBe(true);
  }, 120_000);

  it("rejects a concurrent run without touching latest or invoking the provider", async () => {
    const provider = await fakeProvider([]);
    const target = await testTarget();
    const lock = await acquireAgentEvaluationRunLock(target.lockPath);
    let result: Awaited<ReturnType<typeof runEvaluationCli>>;
    try {
      result = await runEvaluationCli({ ...target, baseUrl: provider.baseUrl, restart: true });
    } finally {
      await releaseAgentEvaluationRunLock(lock);
    }

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("AGENT_EVAL_ALREADY_RUNNING");
    expect(provider.observations).toEqual([]);
    expect(await readFile(target.reportPath, "utf8")).toBe(target.sentinelReport);
    expect(await exists(target.lockPath)).toBe(true);
  }, 120_000);
});
