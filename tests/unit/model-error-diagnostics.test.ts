import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  consoleModelErrorDiagnostics,
  createLocalModelErrorDiagnosticLog,
  createModelErrorDiagnostics,
} from "@/lib/agent/model-error-diagnostics";
import { ModelServiceError } from "@/lib/ai/client";

const roots: string[] = [];

async function testRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "tonggan-model-diagnostics-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("model error diagnostics", () => {
  it("preserves a bounded cause chain in a unique repository-external redacted JSONL log", async () => {
    const root = await testRoot();
    const repositoryRoot = path.join(root, "repository");
    await mkdir(repositoryRoot);
    const secret = ["sk", "diagnostics-secret-0123456789"].join("-");
    const baseUrl = "https://private-provider.example.test/v1";
    const providerPayload = "PROVIDER_PAYLOAD_SENTINEL_MUST_NOT_APPEAR";
    const socketError = Object.assign(new Error(
      `provider payload: ${providerPayload}; Bearer ${secret}; endpoint ${baseUrl}`,
    ), {
      code: "ECONNRESET",
      errno: "-4077",
      syscall: "read",
    });
    const streamError = new Error("response body: private upstream body", { cause: socketError });
    const serviceError = new ModelServiceError(
      "TRANSPORT",
      null,
      null,
      "ECONNRESET",
      null,
      streamError,
    );
    const diagnostics = createModelErrorDiagnostics({ redactValues: [secret, baseUrl] });

    diagnostics.record(serviceError);
    diagnostics.record(serviceError);
    const snapshot = diagnostics.snapshot();

    expect(snapshot.errorCount).toBe(1);
    expect(snapshot.modelTransportErrorCodes).toEqual(["ECONNRESET"]);
    expect(snapshot.errorEvents[0]?.causeChain.map(({ name }) => name)).toEqual([
      "ModelServiceError",
      "Error",
      "Error",
    ]);
    expect(consoleModelErrorDiagnostics(snapshot)).toEqual({
      transportCode: "ECONNRESET",
      protocolCode: null,
      errorSummary: "MODEL_TRANSPORT:ECONNRESET",
    });
    expect(JSON.stringify(snapshot)).not.toContain("private upstream body");
    const sink = createLocalModelErrorDiagnosticLog({
      runner: "agent-eval",
      environment: { LOCALAPPDATA: root },
      repositoryRoot,
      now: new Date("2026-07-19T00:00:00.000Z"),
    });
    const secondSink = createLocalModelErrorDiagnosticLog({
      runner: "agent-eval",
      environment: { LOCALAPPDATA: root },
      repositoryRoot,
      now: new Date("2026-07-19T00:00:00.000Z"),
    });
    expect(sink.path).not.toBe(secondSink.path);
    expect(path.relative(repositoryRoot, sink.path!)).toMatch(/^\.\./);
    const write = await sink.append({
      recordedAt: "2026-07-19T00:00:00.000Z",
      runner: "AGENT_EVAL",
      stage: "CASE",
      caseId: "diagnostic-case",
      outcome: "INTERRUPTED",
      errorCode: "TRANSPORT",
      requestMode: "AGENT_STREAMING",
      diagnostics: snapshot,
    }, (text) => {
      expect(text).not.toContain(secret);
      expect(text).not.toContain(baseUrl);
      expect(text).not.toContain(providerPayload);
    });

    expect(write).toEqual({ status: "WRITTEN", path: sink.path });
    const log = await readFile(sink.path!, "utf8");
    expect(log).toContain('"name":"ModelServiceError"');
    expect(log).toContain('"name":"Error"');
    expect(log).toContain('"code":"ECONNRESET"');
    expect(log).not.toContain(secret);
    expect(log).not.toContain(baseUrl);
    expect(log).not.toContain(providerPayload);
  });

  it("never persists invalid-response parser messages that contain provider payload fragments", () => {
    const providerPayload = "PRIVATE_PROVIDER_PAYLOAD_FRAGMENT";
    const diagnostics = createModelErrorDiagnostics();
    diagnostics.record(new ModelServiceError(
      "INVALID_RESPONSE",
      null,
      null,
      null,
      "JSON_INVALID",
      new SyntaxError(`Unexpected token 'P', \"${providerPayload}\" is not valid JSON`),
    ));

    const snapshot = diagnostics.snapshot();
    expect(snapshot.modelProtocolErrorCodes).toEqual(["JSON_INVALID"]);
    expect(snapshot.errorEvents[0]?.causeChain).toEqual([
      expect.objectContaining({
        name: "ModelServiceError",
        message: "model response detail redacted",
        protocolCode: "JSON_INVALID",
      }),
      expect.objectContaining({
        name: "SyntaxError",
        message: "model response detail redacted",
      }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain(providerPayload);
    expect(JSON.stringify(snapshot)).not.toContain(providerPayload.slice(0, 10));
  });

  it("persists bounded streaming response observations without response bodies", () => {
    const diagnostics = createModelErrorDiagnostics();
    diagnostics.record(new ModelServiceError(
      "INVALID_RESPONSE",
      null,
      null,
      null,
      "EVENT_TYPE_UNSUPPORTED",
      undefined,
      {
        eventTypes: [{ type: "response.private_upstream_detail", count: 1, unknown: true }],
        eventTypesTruncated: false,
        completedSeen: true,
        textLengths: { streamedText: 12, doneText: 12, completedMessageText: 12 },
        attemptComplete: true,
      },
    ));

    expect(diagnostics.snapshot().errorEvents[0]?.responseObservation).toEqual({
      eventTypes: [{ type: "response.private_upstream_detail", count: 1, unknown: true }],
      eventTypesTruncated: false,
      completedSeen: true,
      textLengths: { streamedText: 12, doneText: 12, completedMessageText: 12 },
      attemptComplete: true,
    });
  });

  it("bounds events and survives hostile getters plus cyclic causes", () => {
    const diagnostics = createModelErrorDiagnostics();
    const hostile = new Proxy({}, {
      get() {
        throw new Error("getter must not escape diagnostics");
      },
    });
    const cyclic = new Error("cyclic model failure") as Error & { cause?: unknown };
    cyclic.cause = cyclic;

    expect(() => diagnostics.record(hostile)).not.toThrow();
    expect(() => diagnostics.record(cyclic)).not.toThrow();
    for (let index = 0; index < 8; index += 1) {
      diagnostics.record(new Error(`bounded failure ${index}`));
    }
    const snapshot = diagnostics.snapshot();

    expect(snapshot.errorCount).toBe(10);
    expect(snapshot.errorEvents).toHaveLength(8);
    expect(snapshot.errorEventsTruncated).toBe(true);
    expect(snapshot.errorEvents[1]).toMatchObject({ causeChainTruncated: true });
  });

  it("falls back to cause-free output when validation rejects details", async () => {
    const root = await testRoot();
    const repositoryRoot = path.join(root, "repository");
    await mkdir(repositoryRoot);
    const diagnostics = createModelErrorDiagnostics();
    diagnostics.record(new ModelServiceError(
      "INVALID_RESPONSE",
      null,
      null,
      null,
      "JSON_INVALID",
      new SyntaxError("unexpected private provider JSON"),
    ));
    const sink = createLocalModelErrorDiagnosticLog({
      runner: "tutor-quality",
      environment: { LOCALAPPDATA: root },
      repositoryRoot,
    });

    const write = await sink.append({
      recordedAt: "2026-07-19T00:00:00.000Z",
      runner: "TUTOR_QUALITY",
      stage: "ANSWER",
      caseId: "validation-fallback",
      outcome: "DEGRADED_CONTINUED",
      errorCode: "INVALID_RESPONSE",
      requestMode: "NON_STREAMING",
      diagnostics: diagnostics.snapshot(),
    }, (text) => {
      const parsed = JSON.parse(text) as {
        diagnostics: { errorEvents: Array<{ causeChain: unknown[] }> };
      };
      if (parsed.diagnostics.errorEvents.some(({ causeChain }) => causeChain.length > 0)) {
        throw new Error("reject detailed cause chain");
      }
    });

    expect(write).toEqual({ status: "REDACTED", path: sink.path });
    const entry = JSON.parse(await readFile(sink.path!, "utf8")) as {
      diagnostics: { errorEvents: Array<{ causeChain: unknown[] }> };
    };
    expect(entry.diagnostics.errorEvents.every(({ causeChain }) => causeChain.length === 0)).toBe(true);
  });

  it("returns UNAVAILABLE instead of throwing when the sidecar directory cannot be created", async () => {
    const root = await testRoot();
    const blockedLocalAppData = path.join(root, "not-a-directory");
    await writeFile(blockedLocalAppData, "blocked", "utf8");
    const diagnostics = createModelErrorDiagnostics();
    diagnostics.record(new Error("model failure must remain primary"));
    const sink = createLocalModelErrorDiagnosticLog({
      runner: "agent-eval",
      environment: { LOCALAPPDATA: blockedLocalAppData },
      repositoryRoot: path.join(root, "repository"),
    });

    await expect(sink.append({
      recordedAt: "2026-07-19T00:00:00.000Z",
      runner: "AGENT_EVAL",
      stage: "CASE",
      caseId: "unavailable-sidecar",
      outcome: "INTERRUPTED",
      errorCode: null,
      requestMode: "AGENT_STREAMING",
      diagnostics: diagnostics.snapshot(),
    })).resolves.toEqual({ status: "UNAVAILABLE", path: null });
  });
});
