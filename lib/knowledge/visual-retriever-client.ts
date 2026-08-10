import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  createGuardedVisualRetriever,
  VisualIndexIdentitySchema,
  VisualRetrievalResponseSchema,
  VisualRetrieverCapabilitiesSchema,
  type VisualIndexIdentity,
  type VisualRetriever,
  type VisualRetrieverCapabilities,
  type VisualRetrieverTransport,
} from "./visual-retriever";

const ReadyEnvelopeSchema = z
  .object({
    v: z.literal(1),
    type: z.literal("ready"),
    capabilities: z.array(z.string().min(1)).min(1),
    identity: VisualIndexIdentitySchema,
  })
  .strict();

const ResultEnvelopeSchema = z
  .object({
    v: z.literal(1),
    type: z.literal("result"),
    id: z.string().uuid(),
    status: VisualRetrievalResponseSchema.shape.status,
    reason: VisualRetrievalResponseSchema.shape.reason,
    hits: VisualRetrievalResponseSchema.shape.hits,
    index: VisualRetrievalResponseSchema.shape.index,
    timing: VisualRetrievalResponseSchema.shape.timing,
    diagnosticTiming: z.record(z.string(), z.number().finite().nonnegative()).optional(),
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

const MAX_SIDECAR_REQUEST_BYTES = 24 * 1024 * 1024;

class VisualSidecarUnavailableError extends Error {}

function sameIdentity(left: VisualIndexIdentity, right: VisualIndexIdentity) {
  return left.corpusBundleHash === right.corpusBundleHash
    && left.indexBundleHash === right.indexBundleHash
    && left.indexVersionId === right.indexVersionId
    && left.modelId === right.modelId
    && left.modelRevision === right.modelRevision;
}

function requiredCapabilities(capabilities: VisualRetrieverCapabilities) {
  const required = [];
  if (capabilities.textToImage) required.push("TEXT_TO_IMAGE");
  if (capabilities.imageToImage) required.push("IMAGE_TO_IMAGE");
  if (capabilities.imageTextToImage) required.push("IMAGE_TEXT_TO_IMAGE");
  if (capabilities.normalizedRegions) required.push("NORMALIZED_REGIONS");
  return required;
}

function reportsCapability(reported: readonly string[], expected: string) {
  return reported.some((capability) =>
    capability === expected || capability === `${expected}_EXPERIMENTAL`);
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
      throw new Error(`visual sidecar environment key is not allowed: ${key}`);
    }
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

async function validateProcessPath(candidate: string, kind: "file" | "directory") {
  if (!path.isAbsolute(candidate)) {
    throw new Error(`visual sidecar ${kind} path must be absolute`);
  }
  const stats = await lstat(candidate);
  if (kind === "file" ? !stats.isFile() : !stats.isDirectory()) {
    throw new Error(`visual sidecar ${kind} path has the wrong type`);
  }
}

function settleAtAbort<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("visual sidecar request aborted"));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => {
      finish(() => reject(
        signal.reason ?? new Error("visual sidecar request aborted"),
      ));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    let pending: Promise<T>;
    try {
      pending = operation();
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    void pending.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export type VisualSidecarHandle = {
  retriever: VisualRetriever;
  resources(): {
    processRunning: boolean;
    pendingRequests: number;
    active: number;
    queueDepth: number;
    maxQueue: number;
    cacheEntries: number;
    maxCacheEntries: number;
    cacheHits: number;
    cacheMisses: number;
  };
  dispose(): Promise<void>;
};

export type ResolvedVisualQueryImage = {
  sha256: string;
  pngBytes: Buffer;
};

export async function startVisualSidecar(input: {
  executable: string;
  args: readonly string[];
  cwd: string;
  env?: Readonly<Record<string, string | undefined>>;
  expectedIndex: VisualIndexIdentity;
  capabilities: VisualRetrieverCapabilities;
  allowedAssetCoursePacks?: ReadonlyMap<string, string>;
  resolveQueryImage?: (
    assetId: string,
    context: { signal: AbortSignal },
  ) => Promise<ResolvedVisualQueryImage>;
  maxQueryImageBytes?: number;
  startupTimeoutMs?: number;
  concurrency?: 1;
  maxQueue?: number;
  maxCacheEntries?: number;
  maxStdoutLineBytes?: number;
  spawnImpl?: SpawnSidecar;
}): Promise<VisualSidecarHandle> {
  const expectedIndex = VisualIndexIdentitySchema.parse(input.expectedIndex);
  const capabilities = VisualRetrieverCapabilitiesSchema.parse(input.capabilities);
  const startupTimeoutMs = z.number().int().min(1).max(120_000)
    .parse(input.startupTimeoutMs ?? 60_000);
  const concurrency = z.literal(1).parse(input.concurrency ?? 1);
  const maxQueue = z.number().int().min(0).max(1_000).parse(input.maxQueue ?? 8);
  const maxCacheEntries = z.number().int().min(0).max(10_000)
    .parse(input.maxCacheEntries ?? 128);
  const maxStdoutLineBytes = z.number().int().min(1_024).max(16 * 1024 * 1024)
    .parse(input.maxStdoutLineBytes ?? 1024 * 1024);
  const maxQueryImageBytes = z.number().int().min(1_024).max(32 * 1024 * 1024)
    .parse(input.maxQueryImageBytes ?? 16 * 1024 * 1024);
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
    const error = new VisualSidecarUnavailableError(message);
    requestTermination(error);
    if (!ready) rejectReady(error);
  }

  function handleLine(lineBytes: Buffer) {
    if (lineBytes.length > maxStdoutLineBytes) {
      failProtocol("visual sidecar response too large");
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(lineBytes.toString("utf8"));
    } catch {
      failProtocol("visual sidecar emitted invalid JSON");
      return;
    }
    if (!ready) {
      const envelope = ReadyEnvelopeSchema.safeParse(value);
      if (
        !envelope.success
        || !sameIdentity(envelope.data.identity, expectedIndex)
        || requiredCapabilities(capabilities).some((capability) =>
          !reportsCapability(envelope.data.capabilities, capability))
      ) {
        failProtocol("visual sidecar handshake mismatch");
        return;
      }
      ready = true;
      resolveReady();
      return;
    }
    const envelope = ResultEnvelopeSchema.safeParse(value);
    if (!envelope.success) {
      failProtocol("visual sidecar response invalid");
      return;
    }
    const request = pending.get(envelope.data.id);
    if (!request) {
      failProtocol("visual sidecar returned an unknown request id");
      return;
    }
    pending.delete(envelope.data.id);
    request.removeAbortListener();
    request.resolve({
      status: envelope.data.status,
      reason: envelope.data.reason,
      hits: envelope.data.hits,
      index: envelope.data.index,
      timing: envelope.data.timing,
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
      failProtocol("visual sidecar response too large");
    }
  });

  const startupTimer = setTimeout(() => {
    failProtocol("visual sidecar startup timeout");
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
    const error = new VisualSidecarUnavailableError(
      `visual sidecar exited code=${code ?? "null"} signal=${signal ?? "null"}${suffix}`,
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

  const transport: VisualRetrieverTransport = async (query, options, context) => {
    if (disposed || !ready) {
      throw new VisualSidecarUnavailableError("visual sidecar unavailable");
    }
    const queryAssetId = "queryAssetId" in query ? query.queryAssetId : null;
    let queryImage: ResolvedVisualQueryImage | undefined;
    if (queryAssetId) {
      if (!input.resolveQueryImage) {
        throw new VisualSidecarUnavailableError("visual query image resolver unavailable");
      }
      queryImage = await settleAtAbort(
        () => input.resolveQueryImage!(queryAssetId, { signal: context.signal }),
        context.signal,
      );
    }
    if (queryImage) {
      if (
        queryImage.pngBytes.length > maxQueryImageBytes
        || !queryImage.pngBytes.subarray(0, 8).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        )
        || createHash("sha256").update(queryImage.pngBytes).digest("hex") !== queryImage.sha256
      ) {
        throw new VisualSidecarUnavailableError("visual query image validation failed");
      }
    }
    const requestId = randomUUID();
    const envelope = JSON.stringify({
      v: 1,
      type: "search",
      id: requestId,
      topK: options.topK,
      query,
      ...(queryImage
        ? {
            queryImage: {
              assetId: queryAssetId,
              sha256: queryImage.sha256,
              pngBase64: queryImage.pngBytes.toString("base64"),
            },
          }
        : {}),
    });
    const framedEnvelope = `${envelope}\n`;
    if (Buffer.byteLength(framedEnvelope, "utf8") > MAX_SIDECAR_REQUEST_BYTES) {
      throw new VisualSidecarUnavailableError("visual sidecar request too large");
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    context.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        pending.delete(requestId);
        requestTermination(new VisualSidecarUnavailableError("visual sidecar request aborted"));
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

  const retriever = createGuardedVisualRetriever({
    capabilities,
    expectedIndex,
    transport,
    concurrency,
    maxQueue,
    maxCacheEntries,
    ...(input.allowedAssetCoursePacks
      ? { allowedAssetCoursePacks: input.allowedAssetCoursePacks }
      : {}),
  });

  return {
    retriever,
    resources() {
      const resources = retriever.resourceSnapshot?.();
      if (!resources) {
        throw new VisualSidecarUnavailableError(
          "visual retriever resource snapshot unavailable",
        );
      }
      return {
        processRunning:
          !disposed
          && child.exitCode === null
          && child.signalCode === null,
        pendingRequests: pending.size,
        ...resources,
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
          throw new VisualSidecarUnavailableError("visual sidecar did not exit after termination");
        }
        return;
      }
      disposed = true;
      rejectAll(new VisualSidecarUnavailableError("visual sidecar disposed"));
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
        throw new VisualSidecarUnavailableError("visual sidecar did not exit after termination");
      }
    },
  };
}
