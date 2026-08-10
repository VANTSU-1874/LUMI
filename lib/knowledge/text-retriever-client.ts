import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  createGuardedTextRetriever,
  TextIndexIdentitySchema,
  TextRetrievalResponseSchema,
  type TextIndexIdentity,
  type TextRetriever,
  type TextRetrieverTransport,
  type TextTargetScope,
} from "./text-retriever";
import {
  TextSidecarEnvironmentV1Schema,
  type TextSidecarEnvironmentV1,
} from "./runtime-environment-seal-v2";

const ReadyEnvelopeSchema = z
  .object({
    v: z.literal(1),
    type: z.literal("ready"),
    capabilities: z.tuple([z.literal("TEXT_TO_TEXT")]),
    identity: TextIndexIdentitySchema,
    environment: TextSidecarEnvironmentV1Schema,
  })
  .strict();

const ResultEnvelopeSchema = z
  .object({
    v: z.literal(1),
    type: z.literal("result"),
    id: z.string().uuid(),
    status: TextRetrievalResponseSchema.shape.status,
    reason: TextRetrievalResponseSchema.shape.reason,
    hits: TextRetrievalResponseSchema.shape.hits,
    objectCandidates: TextRetrievalResponseSchema.shape.objectCandidates,
    index: TextRetrievalResponseSchema.shape.index,
    timing: TextRetrievalResponseSchema.shape.timing,
    diagnostics: TextRetrievalResponseSchema.shape.diagnostics,
    error: z
      .object({
        code: z.string().min(1).max(80),
        retryable: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  removeAbortListener: () => void;
};

type SpawnSidecar = (
  executable: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    windowsHide: true;
    shell: false;
    stdio: ["pipe", "pipe", "pipe"];
  },
) => ChildProcessWithoutNullStreams;

const INHERITED_ENVIRONMENT_KEYS = [
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "PATH",
  "TEMP",
  "TMP",
  "CUDA_PATH",
  "CUDA_VISIBLE_DEVICES",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
] as const;

const EXPLICIT_ENVIRONMENT_KEYS = new Set([
  "PYTHONHASHSEED",
  "CUBLAS_WORKSPACE_CONFIG",
  "HF_HOME",
  "HF_HUB_CACHE",
  "TRANSFORMERS_CACHE",
  "HF_HUB_OFFLINE",
  "TRANSFORMERS_OFFLINE",
  "TORCH_HOME",
  "TEMP",
  "TMP",
  "CUDA_VISIBLE_DEVICES",
]);

const MAX_SIDECAR_REQUEST_BYTES = 64 * 1024;

class TextSidecarUnavailableError extends Error {}

function sameIdentity(left: TextIndexIdentity, right: TextIndexIdentity) {
  return left.corpusBundleHash === right.corpusBundleHash
    && left.indexBundleHash === right.indexBundleHash
    && left.indexVersionId === right.indexVersionId
    && left.modelId === right.modelId
    && left.modelRevision === right.modelRevision;
}

function sidecarEnvironment(explicit: Readonly<Record<string, string | undefined>>) {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
  };
  for (const key of INHERITED_ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(explicit)) {
    if (!EXPLICIT_ENVIRONMENT_KEYS.has(key.toUpperCase())) {
      throw new Error(`text sidecar environment key is not allowed: ${key}`);
    }
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

async function validateProcessPath(candidate: string, kind: "file" | "directory") {
  if (!path.isAbsolute(candidate)) {
    throw new Error(`text sidecar ${kind} path must be absolute`);
  }
  // Python virtual environments use an executable symlink on Linux. Follow the
  // link and validate its resolved target while still rejecting directories
  // and dangling links.
  const stats = await stat(candidate);
  if (kind === "file" ? !stats.isFile() : !stats.isDirectory()) {
    throw new Error(`text sidecar ${kind} path has the wrong type`);
  }
}

export type TextSidecarHandle = {
  retriever: TextRetriever;
  environment: TextSidecarEnvironmentV1;
  resources(): {
    processRunning: boolean;
    pendingRequests: number;
  };
  dispose(): Promise<void>;
};

export async function startTextSidecar(input: {
  executable: string;
  args: readonly string[];
  cwd: string;
  expectedIndex: TextIndexIdentity;
  env?: Readonly<Record<string, string | undefined>>;
  allowedTargets?: ReadonlyMap<string, TextTargetScope>;
  startupTimeoutMs?: number;
  maxStdoutLineBytes?: number;
  spawnImpl?: SpawnSidecar;
}): Promise<TextSidecarHandle> {
  const expectedIndex = TextIndexIdentitySchema.parse(input.expectedIndex);
  const startupTimeoutMs = z.number().int().min(1).max(120_000)
    .parse(input.startupTimeoutMs ?? 60_000);
  const maxStdoutLineBytes = z.number().int().min(1_024).max(4 * 1024 * 1024)
    .parse(input.maxStdoutLineBytes ?? 1024 * 1024);
  const environment = sidecarEnvironment(input.env ?? {});
  await Promise.all([
    validateProcessPath(input.executable, "file"),
    validateProcessPath(input.cwd, "directory"),
  ]);

  const spawnImpl: SpawnSidecar = input.spawnImpl
    ?? ((executable, args, options) => spawn(executable, args, options));
  const child = spawnImpl(input.executable, input.args, {
    cwd: input.cwd,
    env: environment,
    windowsHide: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.setDefaultEncoding("utf8");
  child.stderr.setEncoding("utf8");

  const pending = new Map<string, PendingRequest>();
  let disposed = false;
  let ready = false;
  let runtimeEnvironment: TextSidecarEnvironmentV1 | null = null;
  let stderrTail = "";
  let stdoutBuffer = Buffer.alloc(0);
  let resolveExit!: () => void;
  const exitPromise = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  let rejectReady!: (error: unknown) => void;
  let resolveReady!: () => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function rejectAll(reason: unknown) {
    for (const request of pending.values()) {
      request.removeAbortListener();
      request.reject(reason);
    }
    pending.clear();
  }

  function requestTermination(reason: unknown) {
    if (disposed) return;
    disposed = true;
    rejectAll(reason);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }

  function failProtocol(message: string) {
    const error = new TextSidecarUnavailableError(message);
    requestTermination(error);
    if (!ready) rejectReady(error);
  }

  function handleLine(lineBytes: Buffer) {
    if (lineBytes.length > maxStdoutLineBytes) {
      failProtocol("text sidecar response too large");
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(lineBytes.toString("utf8"));
    } catch {
      failProtocol("text sidecar emitted invalid JSON");
      return;
    }
    if (!ready) {
      const envelope = ReadyEnvelopeSchema.safeParse(value);
      if (!envelope.success || !sameIdentity(envelope.data.identity, expectedIndex)) {
        failProtocol("text sidecar handshake mismatch");
        return;
      }
      runtimeEnvironment = envelope.data.environment;
      ready = true;
      resolveReady();
      return;
    }
    const envelope = ResultEnvelopeSchema.safeParse(value);
    if (!envelope.success) {
      failProtocol("text sidecar response invalid");
      return;
    }
    const request = pending.get(envelope.data.id);
    if (!request) {
      failProtocol("text sidecar returned an unknown request id");
      return;
    }
    pending.delete(envelope.data.id);
    request.removeAbortListener();
    request.resolve({
      status: envelope.data.status,
      reason: envelope.data.reason,
      hits: envelope.data.hits,
      objectCandidates: envelope.data.objectCandidates,
      index: envelope.data.index,
      timing: envelope.data.timing,
      diagnostics: envelope.data.diagnostics,
    });
  }

  child.stderr.on("data", (chunk: string) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-64 * 1024);
  });
  child.stdout.on("data", (chunk: Buffer) => {
    if (disposed) return;
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
    let lineEnd = stdoutBuffer.indexOf(0x0a);
    while (lineEnd >= 0) {
      const line = stdoutBuffer.subarray(0, lineEnd);
      stdoutBuffer = stdoutBuffer.subarray(lineEnd + 1);
      handleLine(line);
      if (disposed) return;
      lineEnd = stdoutBuffer.indexOf(0x0a);
    }
    if (stdoutBuffer.length > maxStdoutLineBytes) {
      failProtocol("text sidecar response too large");
    }
  });

  const startupTimer = setTimeout(() => {
    failProtocol("text sidecar startup timeout");
  }, startupTimeoutMs);
  startupTimer.unref?.();

  child.once("error", (error) => {
    clearTimeout(startupTimer);
    requestTermination(error);
    if (!ready) rejectReady(error);
  });
  child.once("exit", (code, signal) => {
    clearTimeout(startupTimer);
    resolveExit();
    if (disposed) return;
    disposed = true;
    const suffix = stderrTail
      ? `; stderr captured=${Buffer.byteLength(stderrTail, "utf8")} bytes`
      : "";
    const error = new TextSidecarUnavailableError(
      `text sidecar exited code=${code ?? "null"} signal=${signal ?? "null"}${suffix}`,
    );
    rejectAll(error);
    if (!ready) rejectReady(error);
  });

  try {
    await readyPromise;
  } catch (error) {
    requestTermination(error);
    await Promise.race([
      exitPromise,
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
    throw error;
  } finally {
    clearTimeout(startupTimer);
  }

  const transport: TextRetrieverTransport = async (query, options, context) => {
    if (disposed || !ready) {
      throw new TextSidecarUnavailableError("text sidecar unavailable");
    }
    const requestId = randomUUID();
    const framedEnvelope = `${JSON.stringify({
      v: 1,
      type: "search",
      id: requestId,
      topK: options.topK,
      query,
    })}\n`;
    if (Buffer.byteLength(framedEnvelope, "utf8") > MAX_SIDECAR_REQUEST_BYTES) {
      throw new TextSidecarUnavailableError("text sidecar request too large");
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    context.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        pending.delete(requestId);
        requestTermination(new TextSidecarUnavailableError("text sidecar request aborted"));
        reject(context.signal.reason);
      };
      context.signal.addEventListener("abort", onAbort, { once: true });
      pending.set(requestId, {
        resolve,
        reject,
        removeAbortListener: () =>
          context.signal.removeEventListener("abort", onAbort),
      });
      child.stdin.write(framedEnvelope, (error) => {
        if (!error) return;
        const request = pending.get(requestId);
        if (!request) return;
        pending.delete(requestId);
        request.removeAbortListener();
        request.reject(error);
      });
    });
  };

  return {
    retriever: createGuardedTextRetriever({
      expectedIndex,
      transport,
      ...(input.allowedTargets ? { allowedTargets: input.allowedTargets } : {}),
    }),
    environment: TextSidecarEnvironmentV1Schema.parse(runtimeEnvironment),
    resources() {
      return {
        processRunning:
          !disposed
          && child.exitCode === null
          && child.signalCode === null,
        pendingRequests: pending.size,
      };
    },
    async dispose() {
      if (disposed) {
        const alreadyExited = await Promise.race([
          exitPromise.then(() => true),
          new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
        ]);
        if (alreadyExited) return;
        if (child.exitCode === null && child.signalCode === null) child.kill();
        const exitedAfterRepeatedKill = await Promise.race([
          exitPromise.then(() => true),
          new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
        ]);
        if (!exitedAfterRepeatedKill) {
          throw new TextSidecarUnavailableError("text sidecar did not exit after termination");
        }
        return;
      }
      disposed = true;
      rejectAll(new TextSidecarUnavailableError("text sidecar disposed"));
      child.stdin.end();
      if (child.exitCode !== null || child.signalCode !== null) {
        await exitPromise;
        return;
      }
      const exitedGracefully = await Promise.race([
        exitPromise.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]);
      if (exitedGracefully) return;
      child.kill();
      const exitedAfterKill = await Promise.race([
        exitPromise.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
      ]);
      if (!exitedAfterKill) {
        throw new TextSidecarUnavailableError("text sidecar did not exit after termination");
      }
    },
  };
}
