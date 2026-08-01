import { createHash } from "node:crypto";

import { z } from "zod";

import { ModelBaseUrlSchema } from "@/lib/config/model-url";

const MAX_EMBEDDING_INPUTS = 128;
const MAX_EMBEDDING_INPUT_LENGTH = 20_000;
const MAX_EMBEDDING_BATCH_CHARACTERS = 500_000;
const MAX_EMBEDDING_RESPONSE_BYTES = 8 * 1024 * 1024;

const EmbeddingConfigSchema = z.object({
  baseUrl: ModelBaseUrlSchema,
  apiKey: z.string().trim().min(1).max(4_096),
  model: z.string().trim().min(1).max(200),
  timeoutMs: z.number().int().min(500).max(30_000).default(5_000),
}).strict();

const EmbeddingInputsSchema = z.array(
  z.string().trim().min(1).max(MAX_EMBEDDING_INPUT_LENGTH),
).min(1).max(MAX_EMBEDDING_INPUTS).superRefine((inputs, context) => {
  if (inputs.reduce((total, input) => total + input.length, 0) > MAX_EMBEDDING_BATCH_CHARACTERS) {
    context.addIssue({ code: "custom", message: "embedding input batch is too large" });
  }
});

const EmbeddingResponseSchema = z.object({
  data: z.array(z.object({
    index: z.number().int().min(0),
    embedding: z.array(z.number().finite()).min(1).max(16_384),
  }).passthrough()).min(1).max(MAX_EMBEDDING_INPUTS),
}).passthrough();

export type EmbeddingErrorCode =
  | "INVALID_REQUEST"
  | "REQUEST_ABORTED"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "UPSTREAM_ERROR"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE";

export class EmbeddingServiceError extends Error {
  readonly name = "EmbeddingServiceError";

  constructor(readonly code: EmbeddingErrorCode) {
    super(`Embedding service failed: ${code}`);
  }
}

export type EmbeddingProvider = {
  provider: "OPENAI_COMPATIBLE" | "TEST";
  modelId: string;
  cacheKey: string;
  embed(
    inputs: readonly string[],
    options?: { signal?: AbortSignal },
  ): Promise<number[][]>;
};

type EmbeddingProviderDependencies = {
  fetchImpl?: typeof fetch;
};

function errorCodeForStatus(status: number): EmbeddingErrorCode {
  if (status === 429) return "RATE_LIMIT";
  return "UPSTREAM_ERROR";
}

function safeTransportError(
  error: unknown,
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
) {
  if (error instanceof EmbeddingServiceError) return error;
  if (callerSignal?.aborted) return new EmbeddingServiceError("REQUEST_ABORTED");
  if (timeoutSignal.aborted || (error instanceof Error && /abort|timeout/i.test(error.name))) {
    return new EmbeddingServiceError("TIMEOUT");
  }
  return new EmbeddingServiceError("NETWORK_ERROR");
}

function parseVectors(payload: unknown, expectedCount: number) {
  const parsed = EmbeddingResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.data.length !== expectedCount) {
    throw new EmbeddingServiceError("INVALID_RESPONSE");
  }
  const ordered = [...parsed.data.data].sort((left, right) => left.index - right.index);
  const dimensions = ordered[0]?.embedding.length ?? 0;
  if (
    dimensions === 0
    || ordered.some((item, index) => item.index !== index || item.embedding.length !== dimensions)
    || ordered.some(({ embedding }) => embedding.every((value) => value === 0))
  ) {
    throw new EmbeddingServiceError("INVALID_RESPONSE");
  }
  return ordered.map(({ embedding }) => [...embedding]);
}

async function readBoundedResponse(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_EMBEDDING_RESPONSE_BYTES) {
        await reader.cancel();
        throw new EmbeddingServiceError("INVALID_RESPONSE");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

export function createOpenAICompatibleEmbeddingProvider(
  rawConfig: {
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs?: number;
  },
  dependencies: EmbeddingProviderDependencies = {},
): EmbeddingProvider {
  const config = EmbeddingConfigSchema.parse(rawConfig);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const endpoint = `${config.baseUrl}/embeddings`;
  const cacheKey = createHash("sha256")
    .update(`${config.baseUrl}\0${config.model}`, "utf8")
    .digest("hex");

  return {
    provider: "OPENAI_COMPATIBLE",
    modelId: config.model,
    cacheKey,
    async embed(rawInputs, options = {}) {
      const parsedInputs = EmbeddingInputsSchema.safeParse(Array.from(rawInputs));
      if (!parsedInputs.success) throw new EmbeddingServiceError("INVALID_REQUEST");
      const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
      const signal = options.signal
        ? AbortSignal.any([options.signal, timeoutSignal])
        : timeoutSignal;
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: config.model, input: parsedInputs.data }),
          signal,
        });
      } catch (error) {
        throw safeTransportError(error, options.signal, timeoutSignal);
      }
      if (!response.ok) throw new EmbeddingServiceError(errorCodeForStatus(response.status));
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_EMBEDDING_RESPONSE_BYTES) {
        throw new EmbeddingServiceError("INVALID_RESPONSE");
      }
      let rawBody: string;
      try {
        rawBody = await readBoundedResponse(response);
      } catch (error) {
        throw safeTransportError(error, options.signal, timeoutSignal);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        throw new EmbeddingServiceError("INVALID_RESPONSE");
      }
      return parseVectors(payload, parsedInputs.data.length);
    },
  };
}
