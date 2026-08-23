import { createHash } from "node:crypto";

import { z } from "zod";

import { ModelBaseUrlSchema } from "../config/model-url";
import { normalizePublicHttpsUrl } from "../security/public-web-url";
import { isGpt56ModelId } from "./model-id";

const MAX_RESPONSE_TEXT_LENGTH = 32_000;
const MAX_OBSERVED_EVENT_TYPES = 32;
const MAX_OBSERVED_EVENT_TYPE_LENGTH = 96;

export type ModelResponseObservation = {
  eventTypes: Array<{
    type: string;
    count: number;
    unknown: boolean;
  }>;
  eventTypesTruncated: boolean;
  completedSeen: boolean;
  textLengths: {
    streamedText: number;
    doneText: number;
    completedMessageText: number;
  };
  attemptComplete: boolean;
};

const ConfigSchema = z.object({
  baseUrl: ModelBaseUrlSchema,
  apiKey: z.string().min(1).max(4_096),
  model: z.string().trim().min(1).max(200),
  maxOutputTokens: z.number().int().min(1).max(4096).default(4096),
}).strict();

const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(16_000),
}).strict();

const ModelToolCallSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/),
  arguments: z.string().max(4_000),
}).strict();

const ModelToolDefinitionSchema = z.object({
  name: ModelToolCallSchema.shape.name,
  description: z.string().trim().min(1).max(1_024),
  parameters: z.record(z.string(), z.unknown()),
  strict: z.boolean().optional(),
}).strict();

const ModelHostedToolDefinitionSchema = z.object({
  type: z.literal("web_search"),
  searchContextSize: z.enum(["low", "medium", "high"]).optional(),
}).strict();

const ProviderOutputItemSchema = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 64 * 1024,
  "provider output item is too large",
);
const ProviderOutputSchema = z.array(ProviderOutputItemSchema).max(32).refine(
  (value) => JSON.stringify(value).length <= 256 * 1024,
  "provider output is too large",
);

const ModelConversationMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.enum(["system", "user"]), content: z.string().min(1).max(16_000) }).strict(),
  z.object({
    role: z.literal("assistant"),
    content: z.string().max(32_000).nullable(),
    toolCalls: z.array(ModelToolCallSchema).max(8).optional(),
    providerOutput: ProviderOutputSchema.optional(),
  }).strict().superRefine((message, context) => {
    if (
      !message.content?.trim()
      && (message.toolCalls?.length ?? 0) === 0
      && (message.providerOutput?.length ?? 0) === 0
    ) {
      context.addIssue({ code: "custom", message: "assistant message must include content or tool calls" });
    }
  }),
  z.object({
    role: z.literal("tool"),
    toolCallId: ModelToolCallSchema.shape.id,
    content: z.string().min(1).max(16_000),
  }).strict(),
]);

const ImageSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= 5 * 1024 * 1024),
}).strict();
const ModelImagesSchema = z.array(ImageSchema)
  .max(5)
  .superRefine((images, context) => {
    const totalBytes = images.reduce(
      (total, image) =>
        total + image.bytes.byteLength,
      0,
    );
    if (totalBytes > 15 * 1024 * 1024) {
      context.addIssue({
        code: "custom",
        message:
          "model images exceed aggregate byte limit",
      });
    }
  });

const ProviderMessageSchema = z.object({
  role: MessageSchema.shape.role,
  content: z.union([
    MessageSchema.shape.content,
    z.array(z.union([
      z.object({ type: z.literal("text"), text: MessageSchema.shape.content }).strict(),
      z.object({
        type: z.literal("image_url"),
        image_url: z.object({
          url: z.string().min(1).max(7_100_000).regex(
            /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/,
          ),
        }).strict(),
      }).strict(),
    ])).min(1).max(6),
  ]),
}).strict();

const ProviderToolCallSchema = z.object({
  id: ModelToolCallSchema.shape.id,
  type: z.literal("function"),
  function: z.object({
    name: ModelToolCallSchema.shape.name,
    arguments: ModelToolCallSchema.shape.arguments,
  }).strict(),
}).strict();

const ProviderConversationMessageSchema = z.union([
  ProviderMessageSchema,
  z.object({
    role: z.literal("assistant"),
    content: z.string().max(32_000).nullable(),
    tool_calls: z.array(ProviderToolCallSchema).min(1).max(8),
  }).strict(),
  z.object({
    role: z.literal("tool"),
    tool_call_id: ModelToolCallSchema.shape.id,
    content: z.string().min(1).max(16_000),
  }).strict(),
]);

const ProviderResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string().max(32_000).nullable().optional(),
      tool_calls: z.array(ProviderToolCallSchema).min(1).max(8).optional(),
    }).superRefine((message, context) => {
      if (!message.content?.trim() && (message.tool_calls?.length ?? 0) === 0) {
        context.addIssue({ code: "custom", message: "provider response must include content or tool calls" });
      }
    }),
    finish_reason: z.string().min(1).max(80).nullable().optional(),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().min(0),
    completion_tokens: z.number().int().min(0),
    total_tokens: z.number().int().min(0),
  }).optional().nullable(),
});

const ProviderStreamChunkSchema = z.object({
  choices: z.array(z.object({
    delta: z.object({
      content: z.string().max(32_000).nullable().optional(),
      tool_calls: z.array(z.object({
        index: z.number().int().min(0).max(7),
        id: z.string().max(200).optional(),
        type: z.literal("function").optional(),
        function: z.object({
          name: z.string().max(64).optional(),
          arguments: z.string().max(4_000).optional(),
        }).optional(),
      })).max(8).optional(),
    }),
    finish_reason: z.string().min(1).max(80).nullable().optional(),
  })).max(8),
  usage: ProviderResponseSchema.shape.usage,
});

const ResponsesUsageSchema = z.object({
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  total_tokens: z.number().int().min(0),
}).passthrough();

const ResponsesApiResponseSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.string().min(1).max(40),
  output: ProviderOutputSchema,
  usage: ResponsesUsageSchema.optional().nullable(),
  incomplete_details: z.object({
    reason: z.string().min(1).max(80),
  }).passthrough().optional().nullable(),
}).passthrough();

function responseReachedOutputTokenLimit(response: Pick<
  z.infer<typeof ResponsesApiResponseSchema>,
  "status" | "incomplete_details"
>) {
  return response.status === "incomplete"
    && response.incomplete_details?.reason === "max_output_tokens";
}

const ResponsesFunctionCallSchema = z.object({
  type: z.literal("function_call"),
  call_id: ModelToolCallSchema.shape.id,
  name: ModelToolCallSchema.shape.name,
  arguments: ModelToolCallSchema.shape.arguments,
}).passthrough();

const ResponsesOutputMessageSchema = z.object({
  type: z.literal("message"),
  content: z.array(z.object({
    type: z.literal("output_text"),
    text: z.string().max(32_000),
    annotations: z.array(z.unknown()).max(64).catch([]).optional(),
  }).passthrough()).max(8),
}).passthrough();

const ResponsesWebSearchCallSchema = z.object({
  type: z.literal("web_search_call"),
}).passthrough();

const ResponsesUrlCitationAnnotationSchema = z.object({
  type: z.literal("url_citation"),
  url: z.string().trim().min(1).max(4_096),
  title: z.string().trim().min(1).max(1_024),
  start_index: z.number().int().min(0).max(32_000),
  end_index: z.number().int().min(0).max(32_000),
}).passthrough().refine(
  (citation) => citation.end_index >= citation.start_index,
  "citation range is invalid",
);

const ResponsesTextDeltaPayloadSchema = z.object({
  delta: z.string().max(32_000),
  output_index: z.number().int().min(0).max(31).optional(),
  content_index: z.number().int().min(0).max(7).optional(),
}).passthrough();

const ResponsesTextDonePayloadSchema = z.object({
  text: z.string().max(32_000),
  output_index: z.number().int().min(0).max(31).optional(),
  content_index: z.number().int().min(0).max(7).optional(),
}).passthrough();

const ResponsesOutputItemStreamPayloadSchema = z.object({
  output_index: z.number().int().min(0).max(31).optional(),
  item: ProviderOutputItemSchema,
}).passthrough();

const ResponsesWebSearchProgressEventSchema = z.object({
  type: z.enum([
    "response.web_search_call.in_progress",
    "response.web_search_call.searching",
    "response.web_search_call.completed",
  ]),
}).passthrough();

const ResponsesOutputItemAddedEventSchema = z.object({
  type: z.literal("response.output_item.added"),
  item: ResponsesWebSearchCallSchema,
}).passthrough();

const ResponsesCompletedEventSchema = z.object({
  type: z.literal("response.completed"),
  response: ResponsesApiResponseSchema,
}).passthrough();

const ResponsesIncompleteEventSchema = z.object({
  type: z.literal("response.incomplete"),
  response: ResponsesApiResponseSchema,
}).passthrough();

export type ModelMessage = z.infer<typeof MessageSchema>;
export type ModelVisionImage = z.infer<typeof ImageSchema>;
export type ModelToolCall = z.infer<typeof ModelToolCallSchema>;
export type ModelToolDefinition = z.infer<typeof ModelToolDefinitionSchema>;
export type ModelHostedToolDefinition = z.infer<typeof ModelHostedToolDefinitionSchema>;
export type ModelConversationMessage = z.infer<typeof ModelConversationMessageSchema>;
export type ModelServiceFailureCode =
  | "RATE_LIMIT"
  | "PROVIDER_STATUS"
  | "TIMEOUT"
  | "CANCELLED"
  | "TRANSPORT"
  | "INVALID_RESPONSE";

export const MODEL_TRANSPORT_FAILURE_CODES = [
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "OTHER",
] as const;

const ModelTransportFailureCodeSchema = z.enum(MODEL_TRANSPORT_FAILURE_CODES);

export type ModelTransportFailureCode = z.infer<typeof ModelTransportFailureCodeSchema>;

export const MODEL_PROTOCOL_FAILURE_CODES = [
  "BODY_MISSING",
  "BYTE_LIMIT",
  "JSON_INVALID",
  "EVENT_SCHEMA_INVALID",
  "EVENT_TYPE_MISSING",
  "EVENT_TYPE_UNSUPPORTED",
  "EVENT_TYPE_CONFLICT",
  "PROVIDER_FAILED",
  "TERMINAL_MISSING",
  "TERMINAL_INVALID",
  "COMPLETION_SCHEMA_INVALID",
  "USAGE_INVALID",
  "OUTPUT_SCHEMA_INVALID",
  "OUTPUT_EMPTY",
  "STATUS_NOT_COMPLETED",
  "TEXT_LIMIT",
  "TEXT_MISMATCH",
  "TEXT_ORDER_INVALID",
  "ACTION_INCOMPLETE",
  "ACTION_IDENTITY_INVALID",
  "OTHER",
] as const;

export type ModelProtocolFailureCode = (typeof MODEL_PROTOCOL_FAILURE_CODES)[number];

class ModelResponseProtocolError extends Error {
  constructor(
    readonly protocolCode: ModelProtocolFailureCode,
    readonly responseObservation: ModelResponseObservation | null = null,
  ) {
    super(`model response protocol failed: ${protocolCode}`);
    this.name = "ModelResponseProtocolError";
  }
}

function throwModelResponseProtocolError(code: ModelProtocolFailureCode): never {
  throw new ModelResponseProtocolError(code);
}

function parseResponsesStreamEvent(data: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    // JSON parser messages can echo provider bytes. Keep only a stable, payload-free category.
    throwModelResponseProtocolError("JSON_INVALID");
  }
  const object = z.record(z.string(), z.unknown()).safeParse(parsed);
  if (!object.success) throwModelResponseProtocolError("EVENT_SCHEMA_INVALID");
  return { parsed, object: object.data };
}

function parseResponsesStreamPayload<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throwModelResponseProtocolError("EVENT_SCHEMA_INVALID");
  return parsed.data;
}

function safeModelProtocolFailureCode(error: unknown): ModelProtocolFailureCode {
  if (error instanceof ModelResponseProtocolError) return error.protocolCode;
  if (error instanceof z.ZodError) return "EVENT_SCHEMA_INVALID";
  if (error instanceof SyntaxError) return "JSON_INVALID";
  const message = error instanceof Error ? error.message : "";
  if (message === "response body is empty") return "BODY_MISSING";
  if (message === "response too large") return "BYTE_LIMIT";
  if (message === "response content too large") return "TEXT_LIMIT";
  if (message === "response stream ended without completion") return "TERMINAL_MISSING";
  if (message === "response terminal marker has an invalid event type") return "TERMINAL_INVALID";
  if (message === "response stream failed") return "PROVIDER_FAILED";
  if (message === "response SSE event type mismatch") return "EVENT_TYPE_CONFLICT";
  if (["response did not complete", "response stream did not complete"].includes(message)) {
    return "STATUS_NOT_COMPLETED";
  }
  if (message === "response output is empty") return "OUTPUT_EMPTY";
  if (/text|output order|output index/.test(message)) {
    return /match|omits/.test(message) ? "TEXT_MISMATCH" : "TEXT_ORDER_INVALID";
  }
  if (/identity|duplicated/.test(message)) return "ACTION_IDENTITY_INVALID";
  if (/action|function call/.test(message)) return "ACTION_INCOMPLETE";
  if (/output/.test(message)) return "OUTPUT_SCHEMA_INVALID";
  return "OTHER";
}

function responseObservationFrom(error: unknown): ModelResponseObservation | null {
  if (error instanceof ModelResponseProtocolError) return error.responseObservation;
  if (typeof error !== "object" || error === null) return null;
  const observation = (error as { responseObservation?: unknown }).responseObservation;
  return observation && typeof observation === "object"
    ? observation as ModelResponseObservation
    : null;
}

function safeModelTransportFailureCode(error: unknown): ModelTransportFailureCode {
  let current = error;
  const visited = new Set<object>();
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null || visited.has(current)) break;
    visited.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    const parsed = ModelTransportFailureCodeSchema.safeParse(candidate.code);
    if (parsed.success && parsed.data !== "OTHER") return parsed.data;
    current = candidate.cause;
  }
  return "OTHER";
}

export class ModelServiceError extends Error {
  constructor(
    readonly code: ModelServiceFailureCode,
    readonly retryAfterMs: number | null = null,
    readonly httpStatus: number | null = null,
    readonly transportCode: ModelTransportFailureCode | null = null,
    readonly protocolCode: ModelProtocolFailureCode | null = null,
    cause?: unknown,
    readonly responseObservation: ModelResponseObservation | null = null,
  ) {
    super("模型服务暂时不可用", cause === undefined ? undefined : { cause });
    this.name = "ModelServiceError";
  }
}

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ModelReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export type ModelStructuredOutput = {
  name: string;
  schema: Record<string, unknown>;
};

export type CompletionOptions = {
  signal?: AbortSignal;
  /**
   * Per-request streaming liveness guard. When omitted, the client-level
   * default is used. Non-streaming requests intentionally ignore it.
   */
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
  onUsage?: (usage: ModelUsage) => void;
  onTextDelta?: (delta: string) => void;
  /** Reports raw stream transport activity, including reasoning-only events. */
  onStreamActivity?: () => void;
  reasoningEffort?: ModelReasoningEffort;
  structuredOutput?: ModelStructuredOutput;
};

export type ModelResponseOptions = CompletionOptions & {
  runId?: string;
  tools?: ModelToolDefinition[];
  hostedTools?: ModelHostedToolDefinition[];
  maxHostedToolCalls?: number;
  retryWithoutHostedTools?: boolean;
  toolChoice?: "auto" | "none" | "required";
  image?: ModelVisionImage;
  images?: ModelVisionImage[];
  onWebSearchProgress?: (event: ModelWebSearchProgress) => void;
};

export type ModelWebCitation = {
  url: string;
  title: string;
  startIndex: number;
  endIndex: number;
};

export type ModelWebSearchProgress = {
  status: "RUNNING" | "SUCCEEDED" | "UNAVAILABLE";
};

export type ModelWebSearchResult = {
  status: "NOT_USED" | "SUCCEEDED" | "UNAVAILABLE";
  citations: ModelWebCitation[];
};

function responseImages(
  options: ModelResponseOptions,
) {
  if (
    options.image
    && (options.images?.length ?? 0) > 0
  ) {
    throw new ModelServiceError(
      "INVALID_RESPONSE",
    );
  }
  return ModelImagesSchema.parse(
    options.images
    ?? (options.image ? [options.image] : []),
  );
}

const ModelReasoningEffortSchema = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const MAX_STRUCTURED_OUTPUT_SCHEMA_BYTES = 64 * 1024;
const ModelStructuredOutputSchema = z.object({
  name: z.string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/),
  schema: z.record(z.string(), z.unknown()),
}).strict().superRefine((value, context) => {
  try {
    const serialized = JSON.stringify(value.schema);
    if (Buffer.byteLength(serialized, "utf8") > MAX_STRUCTURED_OUTPUT_SCHEMA_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["schema"],
        message: `Structured output schema exceeds ${MAX_STRUCTURED_OUTPUT_SCHEMA_BYTES} bytes`,
      });
    }
  } catch {
    context.addIssue({
      code: "custom",
      path: ["schema"],
      message: "Structured output schema must be JSON serializable",
    });
  }
});

export type ModelResponse = {
  content: string | null;
  toolCalls: ModelToolCall[];
  /** The provider ended a response because its output-token cap was reached. */
  outputTruncated?: boolean;
  providerOutput?: z.infer<typeof ProviderOutputSchema>;
  webSearch?: ModelWebSearchResult;
};

export type ModelClient = {
  complete(messages: ModelMessage[], options?: CompletionOptions): Promise<string>;
  respond?(
    messages: ModelConversationMessage[],
    options?: ModelResponseOptions,
  ): Promise<ModelResponse>;
  completeWithImage?(
    messages: ModelMessage[],
    image: ModelVisionImage,
    options?: CompletionOptions,
  ): Promise<string>;
  completeWithImages?(
    messages: ModelMessage[],
    images: ModelVisionImage[],
    options?: CompletionOptions,
  ): Promise<string>;
};

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_MAX_RESPONSES_STREAM_BYTES = 1024 * 1024;
const MAX_TIMEOUT_MS = 600_000;
const MAX_RESPONSES_STREAM_BYTES = DEFAULT_MAX_RESPONSES_STREAM_BYTES;

type RequestAbortCause =
  | "CALLER"
  | "EXTERNAL_TIMEOUT"
  | "IDLE_TIMEOUT"
  | "TOTAL_TIMEOUT";

function isTimeoutAbortReason(reason: unknown) {
  return typeof reason === "object"
    && reason !== null
    && "name" in reason
    && reason.name === "TimeoutError";
}

function timeoutValue(value: number | undefined, fallback: number) {
  return z.number().int().positive().max(MAX_TIMEOUT_MS).parse(value ?? fallback);
}

function createRequestAbortController(options: {
  callerSignal?: AbortSignal;
  idleTimeoutMs?: number;
  totalTimeoutMs: number;
}) {
  const controller = new AbortController();
  let abortCause: RequestAbortCause | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let totalTimer: ReturnType<typeof setTimeout> | null = null;

  const abort = (cause: RequestAbortCause) => {
    if (abortCause) return;
    abortCause = cause;
    controller.abort(new DOMException(
      cause === "CALLER" ? "The operation was aborted" : "The operation timed out",
      cause === "CALLER" ? "AbortError" : "TimeoutError",
    ));
  };

  const resetIdleTimer = () => {
    if (options.idleTimeoutMs === undefined || abortCause) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abort("IDLE_TIMEOUT"), options.idleTimeoutMs);
  };

  const abortFromCaller = () => abort(
    isTimeoutAbortReason(options.callerSignal?.reason) ? "EXTERNAL_TIMEOUT" : "CALLER",
  );
  options.callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  if (options.callerSignal?.aborted) abortFromCaller();

  if (!abortCause) {
    totalTimer = setTimeout(() => abort("TOTAL_TIMEOUT"), options.totalTimeoutMs);
    resetIdleTimer();
  }

  return {
    signal: controller.signal,
    get abortCause() {
      return abortCause;
    },
    noteTransportActivity(byteLength: number) {
      if (byteLength > 0) resetIdleTimer();
    },
    dispose() {
      if (idleTimer) clearTimeout(idleTimer);
      if (totalTimer) clearTimeout(totalTimer);
      options.callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function throwForAbortCause(cause: RequestAbortCause | null): never | void {
  if (cause === "CALLER") throw new ModelServiceError("CANCELLED");
  if (cause) throw new ModelServiceError("TIMEOUT");
}

async function waitForAbortable<T>(operation: Promise<T>, signal: AbortSignal) {
  let abortFromSignal: (() => void) | null = null;
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      abortFromSignal = () => reject(signal.reason);
      signal.addEventListener("abort", abortFromSignal, { once: true });
      if (signal.aborted) abortFromSignal();
    });
    return await Promise.race([operation, aborted]);
  } finally {
    if (abortFromSignal) signal.removeEventListener("abort", abortFromSignal);
  }
}

function retryAfterMs(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  const duration = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now();
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.min(60_000, Math.max(1_000, Math.round(duration)));
}

function normalizeWebCitation(value: unknown, textLength: number): ModelWebCitation | null {
  const parsed = ResponsesUrlCitationAnnotationSchema.safeParse(value);
  if (!parsed.success || parsed.data.end_index > textLength) return null;
  try {
    const url = normalizePublicHttpsUrl(parsed.data.url);
    if (!url) return null;
    const title = parsed.data.title
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    if (!title) return null;
    return {
      url,
      title,
      startIndex: parsed.data.start_index,
      endIndex: parsed.data.end_index,
    };
  } catch {
    return null;
  }
}

class ModelResponseTransportError extends Error {
  constructor(readonly transportCode: ModelTransportFailureCode, cause?: unknown) {
    super("model response transport failed", cause === undefined ? undefined : { cause });
    this.name = "ModelResponseTransportError";
  }
}

async function readModelResponseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
) {
  let abortFromSignal: (() => void) | null = null;
  try {
    const read = reader.read();
    if (!signal) return await read;
    const aborted = new Promise<never>((_resolve, reject) => {
      abortFromSignal = () => reject(signal.reason);
      signal.addEventListener("abort", abortFromSignal, { once: true });
      if (signal.aborted) abortFromSignal();
    });
    return await Promise.race([read, aborted]);
  } catch (error) {
    throw new ModelResponseTransportError(safeModelTransportFailureCode(error), error);
  } finally {
    if (abortFromSignal) signal?.removeEventListener("abort", abortFromSignal);
  }
}

function cancelModelResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
) {
  try {
    const cancellation = reader.cancel();
    void cancellation.catch(() => undefined);
  } catch {
    // A disconnected or concurrently closed provider stream is already unusable.
  }
}

async function readBoundedResponse(response: Response, maxBytes: number, signal?: AbortSignal) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("response too large");
  if (!response.body) throw new Error("response body is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await readModelResponseChunk(reader, signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        cancelModelResponseReader(reader);
        throw new Error("response too large");
      }
      chunks.push(value);
    }
  } catch (error) {
    cancelModelResponseReader(reader);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function indicatesHostedToolIncompatibility(response: Response, signal?: AbortSignal) {
  if (![400, 404, 422].includes(response.status)) return false;
  try {
    const body = await readBoundedResponse(response.clone(), 16 * 1024, signal);
    return /(?:(?:hosted|web[ _.-]?search|max_tool_calls)[\s\S]{0,100}(?:unsupported|not supported|unknown|invalid|unrecognized)|(?:unsupported|not supported|unknown|unrecognized)[\s\S]{0,100}(?:hosted|web[ _.-]?search|max_tool_calls))/i.test(body);
  } catch {
    return false;
  }
}

async function indicatesUnsupportedMaxToolCalls(response: Response, signal?: AbortSignal) {
  if (![400, 404, 422].includes(response.status)) return false;
  try {
    const body = await readBoundedResponse(response.clone(), 16 * 1024, signal);
    return /(?:max_tool_calls[\s\S]{0,100}(?:unsupported|not supported|unknown|invalid|unrecognized)|(?:unsupported|not supported|unknown|invalid|unrecognized)[\s\S]{0,100}max_tool_calls)/i.test(body);
  } catch {
    return false;
  }
}

async function readStreamingResponse(
  response: Response,
  maxBytes: number,
  options: ModelResponseOptions,
  onTransportActivity: (byteLength: number) => void,
  signal: AbortSignal,
): Promise<z.infer<typeof ProviderResponseSchema>> {
  if (!response.body) throw new Error("response body is empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let buffer = "";
  let content = "";
  let total = 0;
  let usage: z.infer<typeof ProviderResponseSchema>["usage"] = null;
  let finishReason: string | null | undefined;
  let outputTruncated = false;
  let doneEventSeen = false;

  const consumeEvent = (rawEvent: string) => {
    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    if (data.trim() === "[DONE]") {
      doneEventSeen = true;
      return;
    }
    const chunk = ProviderStreamChunkSchema.parse(JSON.parse(data));
    if (chunk.usage) usage = chunk.usage;
    for (const choice of chunk.choices) {
      if (choice.finish_reason !== undefined) finishReason = choice.finish_reason;
      outputTruncated ||= choice.finish_reason === "length";
      const delta = choice.delta.content;
      if (delta) {
        content += delta;
        if (content.length > 32_000) throw new Error("response content too large");
        options.onTextDelta?.(delta);
      }
      for (const fragment of choice.delta.tool_calls ?? []) {
        const current = toolCalls.get(fragment.index) ?? { id: "", name: "", arguments: "" };
        if (fragment.id) current.id += fragment.id;
        if (fragment.function?.name) current.name += fragment.function.name;
        if (fragment.function?.arguments) current.arguments += fragment.function.arguments;
        toolCalls.set(fragment.index, current);
      }
    }
  };

  try {
    while (!doneEventSeen) {
      const { done, value } = await readModelResponseChunk(reader, signal);
      if (done) break;
      onTransportActivity(value.byteLength);
      total += value.byteLength;
      if (total > maxBytes) {
        cancelModelResponseReader(reader);
        throw new Error("response too large");
      }
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const separator = /\r?\n\r?\n/.exec(buffer);
        if (!separator || separator.index === undefined) break;
        const rawEvent = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        consumeEvent(rawEvent);
        if (doneEventSeen) {
          buffer = "";
          break;
        }
      }
    }
    if (doneEventSeen) {
      cancelModelResponseReader(reader);
    }
  } catch (error) {
    cancelModelResponseReader(reader);
    throw error;
  } finally {
    reader.releaseLock();
  }
  buffer += decoder.decode();
  if (buffer.trim() && !doneEventSeen) consumeEvent(buffer);

  const calls = [...toolCalls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, call]) => ({
      id: call.id,
      type: "function" as const,
      function: { name: call.name, arguments: call.arguments },
    }));
  return ProviderResponseSchema.parse({
    choices: [{
      message: {
        content: content || null,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      },
      ...(outputTruncated
        ? { finish_reason: "length" }
        : finishReason === undefined ? {} : { finish_reason: finishReason }),
    }],
    usage,
  });
}

function modelResponseFromResponses(
  rawResponse: z.infer<typeof ResponsesApiResponseSchema>,
  options: { hostedWebSearchOffered?: boolean; hostedWebSearchUnavailable?: boolean } = {},
): ModelResponse {
  const response = ResponsesApiResponseSchema.parse(rawResponse);
  const outputTruncated = responseReachedOutputTokenLimit(response);
  if (response.status !== "completed" && !outputTruncated) {
    throw new Error("response did not complete");
  }
  const content: string[] = [];
  let contentLength = 0;
  const toolCalls: ModelToolCall[] = [];
  const citations = new Map<string, ModelWebCitation>();
  let webSearchUsed = false;
  let webSearchFailed = false;
  for (const item of response.output) {
    const functionCall = ResponsesFunctionCallSchema.safeParse(item);
    if (functionCall.success) {
      toolCalls.push({
        id: functionCall.data.call_id,
        name: functionCall.data.name,
        arguments: functionCall.data.arguments,
      });
      continue;
    }
    const webSearchCall = ResponsesWebSearchCallSchema.safeParse(item);
    if (webSearchCall.success) {
      webSearchUsed = true;
      webSearchFailed ||= webSearchCall.data.status === "failed";
      continue;
    }
    const message = ResponsesOutputMessageSchema.safeParse(item);
    if (message.success) {
      for (const outputText of message.data.content) {
        content.push(outputText.text);
        contentLength += outputText.text.length;
        if (contentLength > MAX_RESPONSE_TEXT_LENGTH) {
          throw new Error("response content too large");
        }
        for (const annotation of outputText.annotations ?? []) {
          const citation = normalizeWebCitation(annotation, outputText.text.length);
          if (citation && citations.size < 16 && !citations.has(citation.url)) {
            citations.set(citation.url, citation);
          }
        }
      }
    }
  }
  const text = content.join("").trim();
  if (!text && toolCalls.length === 0) throw new Error("response output is empty");
  const citationList = [...citations.values()];
  const includeWebSearch = Boolean(
    options.hostedWebSearchOffered
    || options.hostedWebSearchUnavailable
    || webSearchUsed
    || citationList.length > 0,
  );
  const webSearchStatus = options.hostedWebSearchUnavailable || webSearchFailed
    ? "UNAVAILABLE" as const
    : webSearchUsed || citationList.length > 0
      ? "SUCCEEDED" as const
      : "NOT_USED" as const;
  return {
    content: text || null,
    toolCalls: ModelToolCallSchema.array().max(8).parse(toolCalls),
    ...(outputTruncated ? { outputTruncated: true } : {}),
    providerOutput: response.output,
    ...(includeWebSearch ? {
      webSearch: {
        status: webSearchStatus,
        citations: webSearchStatus === "UNAVAILABLE" ? [] : citationList,
      },
    } : {}),
  };
}

async function readResponsesStreamingResponse(
  response: Response,
  maxBytes: number,
  options: ModelResponseOptions,
  onTransportActivity: (byteLength: number) => void,
  signal: AbortSignal,
) {
  if (!response.body) throw new Error("response body is empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let total = 0;
  let completed: z.infer<typeof ResponsesApiResponseSchema> | null = null;
  let terminalSeen = false;
  let streamedText = "";
  let responseId = "resp_stream_compat";
  let responseUsage: z.infer<typeof ResponsesUsageSchema> | null = null;
  let terminalStatus = "completed";
  let terminalIncompleteDetails: z.infer<typeof ResponsesApiResponseSchema>["incomplete_details"] = null;
  let terminalOutput: z.infer<typeof ProviderOutputSchema> | null = null;
  let compatibilityFailureCode: ModelProtocolFailureCode | null = null;
  let completedEventSeen = false;
  let observedEventTypesTruncated = false;
  let streamObservationEmitted = false;
  let completedTextLength = 0;
  const completedTextParts = new Map<string, string>();
  const completedTextPartIndexes = new Map<string, { outputIndex: number; contentIndex: number } | null>();
  const textOutputIndexes = new Set<number>();
  const streamedTextOutputIndexes = new Set<number>();
  const completedTextOutputIndexes = new Set<number>();
  let streamedTextUsesIndexes: boolean | null = null;
  let lastStreamedTextPosition: { outputIndex: number; contentIndex: number } | null = null;
  const indexedOutputItems = new Map<number, z.infer<typeof ProviderOutputItemSchema>>();
  const unindexedOutputItems: z.infer<typeof ProviderOutputItemSchema>[] = [];
  const pendingActionIndexes = new Set<number>();
  const observedActionIdentities = new Map<number, string>();
  const actionTypesSeen = new Set<string>();
  const observedEventTypes = new Map<string, { count: number; unknown: boolean }>();

  const rejectCompatibility = (code: ModelProtocolFailureCode) => {
    compatibilityFailureCode ??= code;
  };

  const actionOutputType = (type: string) => !["message", "reasoning"].includes(type);
  const eventTypeIsKnownForCompatibility = (type: string) =>
    type === "response.created"
    || type === "response.queued"
    || type === "response.in_progress"
    || type === "response.completed"
    || type === "response.incomplete"
    || type === "response.output_text.delta"
    || type === "response.output_text.done"
    || type === "response.output_item.added"
    || type === "response.output_item.done"
    || type === "response.content_part.added"
    || type === "response.content_part.done"
    || type.startsWith("response.reasoning")
    || type.startsWith("response.function_call_arguments.")
    || type.startsWith("response.web_search_call.");

  const safeEventTypeLabel = (type: string) => type
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "�")
    .slice(0, MAX_OBSERVED_EVENT_TYPE_LENGTH);

  const observeEventType = (type: string, unknown: boolean) => {
    const label = safeEventTypeLabel(type);
    if (!label) return;
    const current = observedEventTypes.get(label);
    if (current) {
      current.count = Math.min(current.count + 1, 999);
      current.unknown ||= unknown;
      return;
    }
    if (observedEventTypes.size >= MAX_OBSERVED_EVENT_TYPES) {
      observedEventTypesTruncated = true;
      return;
    }
    observedEventTypes.set(label, { count: 1, unknown });
  };

  const outputItemType = (item: z.infer<typeof ProviderOutputItemSchema>) =>
    typeof item.type === "string" ? item.type : null;

  const actionIdentity = (item: z.infer<typeof ProviderOutputItemSchema>) => {
    const functionCall = ResponsesFunctionCallSchema.safeParse(item);
    if (functionCall.success) {
      return `function_call:${functionCall.data.call_id}:${functionCall.data.name}`;
    }
    if (outputItemType(item) === "web_search_call") {
      return typeof item.id === "string" ? `web_search_call:${item.id}` : null;
    }
    return null;
  };

  const validatedOutputSummary = (output: z.infer<typeof ProviderOutputSchema>) => {
    const outputTypes = new Set<string>();
    const messageTextParts: string[] = [];
    let messageTextLength = 0;
    const functionCallIds = new Set<string>();
    let hasCompletedMessage = false;
    for (const item of output) {
      const type = outputItemType(item);
      if (!type) throwModelResponseProtocolError("OUTPUT_SCHEMA_INVALID");
      outputTypes.add(type);
      if (type === "message") {
        const message = ResponsesOutputMessageSchema.safeParse(item);
        if (!message.success) throwModelResponseProtocolError("OUTPUT_SCHEMA_INVALID");
        hasCompletedMessage = true;
        for (const content of message.data.content) {
          messageTextLength += content.text.length;
          if (messageTextLength > MAX_RESPONSE_TEXT_LENGTH) {
            throwModelResponseProtocolError("TEXT_LIMIT");
          }
          messageTextParts.push(content.text);
        }
      } else if (type === "function_call") {
        const functionCall = ResponsesFunctionCallSchema.safeParse(item);
        if (!functionCall.success) {
          throwModelResponseProtocolError("OUTPUT_SCHEMA_INVALID");
        }
        if (functionCallIds.has(functionCall.data.call_id)) {
          throwModelResponseProtocolError("ACTION_IDENTITY_INVALID");
        }
        functionCallIds.add(functionCall.data.call_id);
      } else if (type !== "reasoning" && type !== "web_search_call") {
        throwModelResponseProtocolError("OUTPUT_SCHEMA_INVALID");
      }
    }
    return { hasCompletedMessage, messageText: messageTextParts.join(""), outputTypes };
  };

  const assertObservedActionsComplete = (output: z.infer<typeof ProviderOutputSchema>) => {
    const summary = validatedOutputSummary(output);
    const completedActionIdentities = new Set<string>();
    for (const item of output) {
      const identity = actionIdentity(item);
      if (identity === null) continue;
      if (completedActionIdentities.has(identity)) {
        throw new Error("response action output identity is duplicated");
      }
      completedActionIdentities.add(identity);
    }
    for (const type of actionTypesSeen) {
      if (!summary.outputTypes.has(type)) throw new Error("response action output is incomplete");
    }
    for (const outputIndex of pendingActionIndexes) {
      const observedIdentity = observedActionIdentities.get(outputIndex);
      if (observedIdentity !== undefined && completedActionIdentities.has(observedIdentity)) continue;
      const type = output[outputIndex] && outputItemType(output[outputIndex]);
      if (!type || !actionOutputType(type)) throw new Error("response action output index is incomplete");
    }
    for (const identity of observedActionIdentities.values()) {
      if (!completedActionIdentities.has(identity)) {
        throw new Error("response action output identity changed");
      }
    }
    return summary;
  };

  const completedText = () => {
    const parts = [...completedTextParts.entries()];
    const hasIndexedParts = parts.some(([key]) => completedTextPartIndexes.get(key) !== null);
    const hasUnindexedParts = parts.some(([key]) => completedTextPartIndexes.get(key) === null);
    const orderAmbiguous = hasIndexedParts && hasUnindexedParts;
    if (hasIndexedParts && !hasUnindexedParts) {
      parts.sort(([leftKey], [rightKey]) => {
        const left = completedTextPartIndexes.get(leftKey)!;
        const right = completedTextPartIndexes.get(rightKey)!;
        return left.outputIndex - right.outputIndex || left.contentIndex - right.contentIndex;
      });
    }
    return {
      orderAmbiguous,
      text: parts.map(([, text]) => text).join(""),
    };
  };

  const sortedIndexes = (indexes: ReadonlySet<number>) => [...indexes].sort((left, right) => left - right);

  const compareIndexes = (
    leftSource: "streamedText" | "doneText" | "completedMessageText",
    leftIndexes: number[],
    rightSource: "streamedText" | "doneText" | "completedMessageText",
    rightIndexes: number[],
  ) => ({
    leftSource,
    rightSource,
    leftOnly: leftIndexes.filter((index) => !rightIndexes.includes(index)),
    rightOnly: rightIndexes.filter((index) => !leftIndexes.includes(index)),
  });

  const safeRunId = () => {
    if (!options.runId) return null;
    return options.runId
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || null;
  };

  const messageTextFromOutput = (output: unknown) => {
    if (!Array.isArray(output)) return "";
    let text = "";
    for (const item of output) {
      const message = ResponsesOutputMessageSchema.safeParse(item);
      if (!message.success) continue;
      for (const content of message.data.content) {
        text += content.text;
        if (text.length >= MAX_RESPONSE_TEXT_LENGTH) return text.slice(0, MAX_RESPONSE_TEXT_LENGTH);
      }
    }
    return text;
  };

  const createStreamObservation = (output?: unknown): ModelResponseObservation => {
    const doneText = (() => {
      try {
        return completedText().text;
      } catch {
        return "";
      }
    })();
    const completedMessageText = messageTextFromOutput(
      output ?? completed?.output ?? terminalOutput ?? [
        ...[...indexedOutputItems.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, item]) => item),
        ...unindexedOutputItems,
      ],
    );
    const sourceTexts = [streamedText, doneText, completedMessageText];
    const sourceHashes = sourceTexts
      .filter((text) => text.length > 0)
      .map((text) => createHash("sha256").update(text).digest("hex"));
    return {
      eventTypes: [...observedEventTypes.entries()].map(([type, value]) => ({
        type,
        count: value.count,
        unknown: value.unknown,
      })),
      eventTypesTruncated: observedEventTypesTruncated,
      completedSeen: completedEventSeen,
      textLengths: {
        streamedText: Math.min(streamedText.length, MAX_RESPONSE_TEXT_LENGTH),
        doneText: Math.min(doneText.length, MAX_RESPONSE_TEXT_LENGTH),
        completedMessageText: Math.min(completedMessageText.length, MAX_RESPONSE_TEXT_LENGTH),
      },
      attemptComplete: completedEventSeen && sourceHashes.length > 0 && new Set(sourceHashes).size === 1,
    };
  };

  const emitStreamObservation = (observation: ModelResponseObservation) => {
    if (streamObservationEmitted) return;
    const hasUnknownEvent = observation.eventTypes.some(({ unknown }) => unknown);
    if (!hasUnknownEvent && !compatibilityFailureCode) return;
    streamObservationEmitted = true;
    try {
      process.stderr.write(`${JSON.stringify({
        event: "model_response_stream_observation",
        recordedAt: new Date().toISOString(),
        runId: safeRunId(),
        ...observation,
      })}\n`);
    } catch {
      // Observability must never replace the model response or its protocol error.
    }
  };

  const attachStreamObservation = (error: unknown, observation: ModelResponseObservation) => {
    if (error instanceof ModelResponseProtocolError) {
      return new ModelResponseProtocolError(error.protocolCode, observation);
    }
    if (typeof error === "object" && error !== null) {
      try {
        Object.defineProperty(error, "responseObservation", {
          configurable: true,
          enumerable: false,
          value: observation,
          writable: false,
        });
      } catch {
        // Error decoration is best effort; the original protocol error remains primary.
      }
    }
    return error;
  };

  const emitContentConsensusWarning = (input: {
    shape: "MISSING_COMPLETED_MESSAGE" | "OUTPUT_INDEX_DRIFT" | "OTHER";
    missingSources: Array<"streamedText" | "doneText" | "completedMessageText">;
    lengths: {
      streamedText: number;
      doneText: number;
      completedMessageText: number;
    };
    hashes: {
      streamedText: string | null;
      doneText: string | null;
      completedMessageText: string | null;
    };
    indexes: {
      streamedText: number[];
      doneText: number[];
      completedMessageText: number[];
    };
    indexDifferences: Array<{
      leftSource: "streamedText" | "doneText" | "completedMessageText";
      rightSource: "streamedText" | "doneText" | "completedMessageText";
      leftOnly: number[];
      rightOnly: number[];
    }>;
    details: string[];
  }) => {
    try {
      process.stderr.write(`${JSON.stringify({
        event: "model_response_content_consensus_warning",
        recordedAt: new Date().toISOString(),
        runId: safeRunId(),
        ...input,
      })}\n`);
    } catch {
      // Observability must never replace an otherwise valid model response.
    }
  };

  const reconcileContent = (output: z.infer<typeof ProviderOutputSchema>) => {
    const summary = assertObservedActionsComplete(output);
    const { orderAmbiguous, text: doneText } = completedText();
    const completedMessageText = summary.messageText;
    const sourceTexts = {
      streamedText,
      doneText,
      completedMessageText,
    };
    const sourceHashes = {
      streamedText: streamedText ? createHash("sha256").update(streamedText).digest("hex") : null,
      doneText: doneText ? createHash("sha256").update(doneText).digest("hex") : null,
      completedMessageText: completedMessageText
        ? createHash("sha256").update(completedMessageText).digest("hex")
        : null,
    };
    const nonEmptyHashes = Object.values(sourceHashes).filter((hash): hash is string => hash !== null);
    const hasCompletedAction = summary.outputTypes.has("function_call")
      || summary.outputTypes.has("web_search_call");
    if (nonEmptyHashes.length === 0) {
      // A completed action-only turn has no final prose yet; it must remain available to the tool loop.
      if (hasCompletedAction) {
        return { summary, text: "" };
      }
      throwModelResponseProtocolError("OUTPUT_EMPTY");
    }
    if (new Set(nonEmptyHashes).size > 1) {
      throwModelResponseProtocolError("TEXT_MISMATCH");
    }

    const text = completedMessageText || doneText || streamedText;
    const missingSources = (Object.entries(sourceTexts) as Array<[
      "streamedText" | "doneText" | "completedMessageText",
      string,
    ]>)
      .filter(([, value]) => value.length === 0)
      .map(([source]) => source);
    const completedMessageTextIndexes = output.flatMap((item, outputIndex) => {
      const message = ResponsesOutputMessageSchema.safeParse(item);
      if (!message.success) return [];
      return message.data.content.some((content) => content.text.length > 0) ? [outputIndex] : [];
    });
    const indexes = {
      streamedText: sortedIndexes(streamedTextOutputIndexes),
      doneText: sortedIndexes(completedTextOutputIndexes),
      completedMessageText: completedMessageTextIndexes,
    };
    const indexDifferences = [
      compareIndexes("streamedText", indexes.streamedText, "doneText", indexes.doneText),
      compareIndexes(
        "streamedText",
        indexes.streamedText,
        "completedMessageText",
        indexes.completedMessageText,
      ),
      compareIndexes("doneText", indexes.doneText, "completedMessageText", indexes.completedMessageText),
    ].filter(({ leftSource, rightSource }) => (
      sourceTexts[leftSource].length > 0
      && sourceTexts[rightSource].length > 0
      && indexes[leftSource].length > 0
      && indexes[rightSource].length > 0
    ));
    const outputIndexDrift = indexDifferences.some(({ leftOnly, rightOnly }) => (
      leftOnly.length > 0 || rightOnly.length > 0
    ));
    const missingCompletedMessage = !summary.hasCompletedMessage || completedMessageText.length === 0;
    const details = [
      ...(orderAmbiguous ? ["DONE_TEXT_ORDER_AMBIGUOUS"] : []),
      ...(missingSources.length > 0 ? ["TEXT_SOURCE_MISSING"] : []),
    ];
    if (missingCompletedMessage || outputIndexDrift || details.length > 0) {
      emitContentConsensusWarning({
        shape: missingCompletedMessage
          ? "MISSING_COMPLETED_MESSAGE"
          : outputIndexDrift
            ? "OUTPUT_INDEX_DRIFT"
            : "OTHER",
        missingSources,
        lengths: {
          streamedText: streamedText.length,
          doneText: doneText.length,
          completedMessageText: completedMessageText.length,
        },
        hashes: sourceHashes,
        indexes,
        indexDifferences,
        details,
      });
    }
    return { summary, text };
  };

  const completedOutput = () => {
    if (!terminalOutput?.length && indexedOutputItems.size > 0 && unindexedOutputItems.length > 0) {
      throw new Error("response output order is ambiguous");
    }
    const streamedItems = [
      ...[...indexedOutputItems.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, item]) => item),
      ...unindexedOutputItems,
    ];
    const authoritativeTerminalOutput = terminalOutput?.length ? terminalOutput : null;
    const hasTerminalOutput = Boolean(authoritativeTerminalOutput);
    const output = [...(authoritativeTerminalOutput ?? streamedItems)];
    if (compatibilityFailureCode) {
      const observation = createStreamObservation(output);
      emitStreamObservation(observation);
      throw new ModelResponseProtocolError(compatibilityFailureCode, observation);
    }
    const { summary: initialSummary, text } = reconcileContent(
      ProviderOutputSchema.parse(output),
    );
    let syntheticTextIndex: number | null = null;
    if ((!initialSummary.hasCompletedMessage || !initialSummary.messageText) && text) {
      const syntheticMessage = {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      };
      const emptyMessageIndex = output.findIndex((item) => {
        const message = ResponsesOutputMessageSchema.safeParse(item);
        return message.success && message.data.content.every((content) => content.text.length === 0);
      });
      if (emptyMessageIndex >= 0) {
        output[emptyMessageIndex] = {
          ...output[emptyMessageIndex],
          ...syntheticMessage,
        };
      } else if (hasTerminalOutput) {
        output.push(syntheticMessage);
      } else if (
        indexedOutputItems.size > 0
        && unindexedOutputItems.length === 0
        && textOutputIndexes.size === 1
      ) {
        const [textOutputIndex] = textOutputIndexes;
        if (textOutputIndex === undefined || indexedOutputItems.has(textOutputIndex)) {
          throw new Error("response text output index conflicts with another item");
        }
        syntheticTextIndex = textOutputIndex;
        const insertionIndex = [...indexedOutputItems.keys()]
          .filter((outputIndex) => outputIndex < textOutputIndex).length;
        output.splice(insertionIndex, 0, syntheticMessage);
      } else {
        const [textOutputIndex] = textOutputIndexes;
        if (textOutputIndex === 0) syntheticTextIndex = textOutputIndex;
        output.push(syntheticMessage);
      }
    }
    const hasCompletedAction = initialSummary.outputTypes.has("function_call")
      || initialSummary.outputTypes.has("web_search_call");
    if (!hasTerminalOutput && indexedOutputItems.size > 0 && hasCompletedAction) {
      const reconstructedIndexes = [...indexedOutputItems.keys()];
      if (syntheticTextIndex !== null) reconstructedIndexes.push(syntheticTextIndex);
      reconstructedIndexes.sort((left, right) => left - right);
      if (
        reconstructedIndexes.length !== output.length
        || reconstructedIndexes.some((outputIndex, position) => outputIndex !== position)
      ) {
        throw new Error("response output indexes are incomplete");
      }
    }
    assertObservedActionsComplete(ProviderOutputSchema.parse(output));
    emitStreamObservation(createStreamObservation(output));
    return ResponsesApiResponseSchema.parse({
      id: responseId,
      status: terminalStatus,
      output: ProviderOutputSchema.parse(output),
      usage: responseUsage,
      ...(terminalIncompleteDetails ? { incomplete_details: terminalIncompleteDetails } : {}),
    });
  };

  const finalizeCompletedResponse = (response: z.infer<typeof ResponsesApiResponseSchema>) => {
    if (response.status !== "completed" && !responseReachedOutputTokenLimit(response)) {
      throw new Error("response stream did not complete");
    }
    responseId = response.id;
    responseUsage = response.usage ?? null;
    terminalStatus = response.status;
    terminalIncompleteDetails = response.incomplete_details ?? null;
    terminalOutput = response.output;
    return completedOutput();
  };

  const consumeEvent = (rawEvent: string) => {
    const lines = rawEvent.split(/\r?\n/);
    const eventName = lines
      .filter((line) => line.startsWith("event:"))
      .map((line) => line.slice(6).trim())
      .at(-1) || null;
    const failureEventTypes = [
      "error",
      "response.error",
      "response.failed",
      "response.cancelled",
    ];
    if (eventName && failureEventTypes.includes(eventName)) {
      observeEventType(eventName, false);
      throw new Error("response stream failed");
    }
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    if (data.trim() === "[DONE]") {
      if (eventName) observeEventType(eventName, false);
      if (eventName && !["done", "response.completed", "response.incomplete"].includes(eventName)) {
        throw new Error("response terminal marker has an invalid event type");
      }
      terminalSeen = true;
      return;
    }
    const { parsed, object } = parseResponsesStreamEvent(data);
    const dataType = typeof object.type === "string" ? object.type : null;
    const eventTypes = new Set([eventName, dataType].filter((type): type is string => Boolean(type)));
    if (eventTypes.has("response.completed") || eventTypes.has("response.incomplete")) {
      completedEventSeen = true;
    }
    for (const type of eventTypes) {
      observeEventType(
        type,
        !eventTypeIsKnownForCompatibility(type) && !failureEventTypes.includes(type),
      );
    }
    if ([...eventTypes].some((type) => failureEventTypes.includes(type))) {
      throw new Error("response stream failed");
    }
    const directCompletionPayload = (eventName === "response.completed" || eventName === "response.incomplete")
      && ResponsesApiResponseSchema.safeParse(parsed).success;
    if (eventName && dataType && eventName !== dataType && !directCompletionPayload) {
      throw new Error("response SSE event type mismatch");
    }
    if (eventTypes.size === 0) {
      rejectCompatibility("EVENT_TYPE_MISSING");
      return;
    }
    for (const type of eventTypes) {
      if (type.startsWith("response.function_call_arguments.")) {
        actionTypesSeen.add("function_call");
      }
      if (type.startsWith("response.web_search_call.")) {
        actionTypesSeen.add("web_search_call");
      }
    }

    if (eventTypes.has("response.output_text.delta")) {
      const delta = parseResponsesStreamPayload(ResponsesTextDeltaPayloadSchema, object);
      if (delta.output_index !== undefined) {
        if (streamedTextUsesIndexes === false) throw new Error("response text delta order is ambiguous");
        streamedTextUsesIndexes = true;
        const position = {
          outputIndex: delta.output_index,
          contentIndex: delta.content_index ?? 0,
        };
        if (
          lastStreamedTextPosition
          && (
            position.outputIndex < lastStreamedTextPosition.outputIndex
            || (
              position.outputIndex === lastStreamedTextPosition.outputIndex
              && position.contentIndex < lastStreamedTextPosition.contentIndex
            )
          )
        ) {
          throw new Error("response text deltas are out of order");
        }
        lastStreamedTextPosition = position;
        textOutputIndexes.add(delta.output_index);
        streamedTextOutputIndexes.add(delta.output_index);
      } else {
        if (streamedTextUsesIndexes === true) throw new Error("response text delta order is ambiguous");
        streamedTextUsesIndexes = false;
      }
      if (delta.delta) {
        streamedText += delta.delta;
        if (streamedText.length > 32_000) throw new Error("response content too large");
        options.onTextDelta?.(delta.delta);
      }
    }
    if (eventTypes.has("response.output_text.done")) {
      const done = parseResponsesStreamPayload(ResponsesTextDonePayloadSchema, object);
      if (done.output_index !== undefined) {
        textOutputIndexes.add(done.output_index);
        completedTextOutputIndexes.add(done.output_index);
      }
      const key = done.output_index === undefined
        ? `event-${completedTextParts.size}`
        : `${done.output_index}:${done.content_index ?? 0}`;
      const existingText = completedTextParts.get(key);
      if (existingText !== undefined && existingText !== done.text) {
        throw new Error("response completed text index conflicts");
      }
      if (existingText === undefined) {
        completedTextLength += done.text.length;
        if (completedTextLength > MAX_RESPONSE_TEXT_LENGTH) {
          throw new Error("response content too large");
        }
      }
      completedTextParts.set(key, done.text);
      completedTextPartIndexes.set(key, done.output_index === undefined
        ? null
        : { outputIndex: done.output_index, contentIndex: done.content_index ?? 0 });
    }
    if (eventTypes.has("response.content_part.added") || eventTypes.has("response.content_part.done")) {
      const part = z.object({
        part: z.object({ type: z.string().min(1).max(80) }).passthrough(),
      }).passthrough().safeParse(object);
      if (!part.success || part.data.part.type !== "output_text") {
        rejectCompatibility("EVENT_SCHEMA_INVALID");
      }
    }

    for (const streamEventType of ["response.output_item.added", "response.output_item.done"] as const) {
      if (!eventTypes.has(streamEventType)) continue;
      const outputItem = parseResponsesStreamPayload(ResponsesOutputItemStreamPayloadSchema, object);
      const itemType = outputItemType(outputItem.item);
      if (!itemType) {
        throwModelResponseProtocolError("OUTPUT_SCHEMA_INVALID");
      }
      const isAction = actionOutputType(itemType);
      if (isAction) {
        actionTypesSeen.add(itemType);
        if (outputItem.output_index === undefined) {
          throw new Error("response action output index is missing");
        }
        const identity = actionIdentity(outputItem.item);
        const observedIdentity = observedActionIdentities.get(outputItem.output_index);
        if (observedIdentity !== undefined && observedIdentity !== identity) {
          throw new Error("response action output identity changed");
        }
        if (observedIdentity === undefined && identity !== null) {
          for (const [otherIndex, otherIdentity] of observedActionIdentities) {
            if (otherIndex !== outputItem.output_index && otherIdentity === identity) {
              throw new Error("response action output identity is duplicated");
            }
          }
          observedActionIdentities.set(outputItem.output_index, identity);
        }
        if (streamEventType === "response.output_item.added") {
          pendingActionIndexes.add(outputItem.output_index);
        }
      }
      if (streamEventType === "response.output_item.done") {
        if (outputItem.output_index === undefined) {
          unindexedOutputItems.push(outputItem.item);
        } else {
          const existingItem = indexedOutputItems.get(outputItem.output_index);
          if (existingItem && JSON.stringify(existingItem) !== JSON.stringify(outputItem.item)) {
            throw new Error("response output item index conflicts");
          }
          indexedOutputItems.set(outputItem.output_index, outputItem.item);
          if (isAction) pendingActionIndexes.delete(outputItem.output_index);
        }
      }
    }

    const outputItem = ResponsesOutputItemAddedEventSchema.safeParse(parsed);
    if (outputItem.success) options.onWebSearchProgress?.({ status: "RUNNING" });
    const webSearchProgress = ResponsesWebSearchProgressEventSchema.safeParse(parsed);
    if (webSearchProgress.success) {
      options.onWebSearchProgress?.({
        status: webSearchProgress.data.type.endsWith(".completed") ? "SUCCEEDED" : "RUNNING",
      });
    }
    const completion = ResponsesCompletedEventSchema.safeParse(parsed);
    if (completion.success) {
      completedEventSeen = true;
      completed = finalizeCompletedResponse(completion.data.response);
      return;
    }
    const incompleteCompletion = ResponsesIncompleteEventSchema.safeParse(parsed);
    if (incompleteCompletion.success) {
      completedEventSeen = true;
      completed = finalizeCompletedResponse(incompleteCompletion.data.response);
      return;
    }
    if (eventTypes.has("response.completed") || eventTypes.has("response.incomplete")) {
      const directCompletion = ResponsesApiResponseSchema.safeParse(parsed);
      if (directCompletion.success) {
        completed = finalizeCompletedResponse(directCompletion.data);
        return;
      }
      const hasWrappedResponse = Object.hasOwn(object, "response");
      const wrappedResponse = hasWrappedResponse
        ? z.record(z.string(), z.unknown()).safeParse(object.response)
        : null;
      if (hasWrappedResponse && !wrappedResponse?.success) {
        rejectCompatibility("COMPLETION_SCHEMA_INVALID");
      }
      const hasDirectCompletionFields = ["id", "status", "output", "usage", "incomplete_details"]
        .some((field) => Object.hasOwn(object, field));
      if ((dataType === "response.completed" || dataType === "response.incomplete")
        && !hasWrappedResponse && !hasDirectCompletionFields) {
        rejectCompatibility("COMPLETION_SCHEMA_INVALID");
      }
      const candidate = wrappedResponse?.success ? wrappedResponse.data : object;
      const parsedIncompleteDetails = candidate.incomplete_details === undefined || candidate.incomplete_details === null
        ? null
        : ResponsesApiResponseSchema.shape.incomplete_details.safeParse(candidate.incomplete_details);
      if (parsedIncompleteDetails && !parsedIncompleteDetails.success) {
        rejectCompatibility("COMPLETION_SCHEMA_INVALID");
      }
      const candidateIncompleteDetails = parsedIncompleteDetails && parsedIncompleteDetails.success
        ? parsedIncompleteDetails.data
        : null;
      const candidateReachedOutputTokenLimit = candidate.status === "incomplete"
        && candidateIncompleteDetails?.reason === "max_output_tokens";
      if (typeof candidate.status === "string"
        && candidate.status !== "completed"
        && !candidateReachedOutputTokenLimit) {
        throw new Error("response stream did not complete");
      }
      if (eventTypes.has("response.incomplete") && !candidateReachedOutputTokenLimit) {
        throw new Error("response stream did not complete");
      }
      if (candidate.status !== undefined && typeof candidate.status !== "string") {
        rejectCompatibility("COMPLETION_SCHEMA_INVALID");
      }
      if (typeof candidate.status === "string") {
        terminalStatus = candidate.status;
        terminalIncompleteDetails = candidateIncompleteDetails;
      }
      const parsedId = ResponsesApiResponseSchema.shape.id.safeParse(candidate.id);
      if (parsedId.success) responseId = parsedId.data;
      else if (candidate.id !== undefined) rejectCompatibility("COMPLETION_SCHEMA_INVALID");
      if (candidate.usage !== undefined && candidate.usage !== null) {
        const parsedUsage = ResponsesUsageSchema.safeParse(candidate.usage);
        if (parsedUsage.success) responseUsage = parsedUsage.data;
        else rejectCompatibility("USAGE_INVALID");
      }
      if (candidate.output !== undefined) {
        const parsedOutput = ProviderOutputSchema.safeParse(candidate.output);
        if (parsedOutput.success) terminalOutput = parsedOutput.data;
        else rejectCompatibility("OUTPUT_SCHEMA_INVALID");
      }
      terminalSeen = true;
    }
  };

  try {
    while (!completed && !terminalSeen) {
      const { done, value } = await readModelResponseChunk(reader, signal);
      if (done) break;
      onTransportActivity(value.byteLength);
      total += value.byteLength;
      if (total > maxBytes) {
        cancelModelResponseReader(reader);
        throw new Error("response too large");
      }
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const separator = /\r?\n\r?\n/.exec(buffer);
        if (!separator || separator.index === undefined) break;
        const rawEvent = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        consumeEvent(rawEvent);
        if (completed || terminalSeen) {
          buffer = "";
          break;
        }
      }
    }
    if (completed || terminalSeen) {
      cancelModelResponseReader(reader);
    }
  } catch (error) {
    cancelModelResponseReader(reader);
    const observation = createStreamObservation();
    emitStreamObservation(observation);
    throw attachStreamObservation(error, observation);
  } finally {
    reader.releaseLock();
  }
  try {
    buffer += decoder.decode();
    if (buffer.trim() && !completed && !terminalSeen) consumeEvent(buffer);
    if (completed) return completed;
    if (!terminalSeen) throw new Error("response stream ended without completion");
    return completedOutput();
  } catch (error) {
    const observation = createStreamObservation();
    emitStreamObservation(observation);
    throw attachStreamObservation(error, observation);
  }
}

export function createModelClient(
  rawConfig: { baseUrl: string; apiKey: string; model: string; maxOutputTokens?: number },
  dependencies: {
    fetchImpl?: FetchImplementation;
    idleTimeoutMs?: number;
    totalTimeoutMs?: number;
    /** @deprecated Use totalTimeoutMs. */
    timeoutMs?: number;
    /** Byte cap for non-streaming responses and Chat Completions streams. */
    maxResponseBytes?: number;
    /** Raw SSE wire cap; parsed Responses content keeps its stricter schema limits. */
    maxResponsesStreamBytes?: number;
  } = {},
): ModelClient {
  const config = ConfigSchema.parse(rawConfig);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  if (dependencies.timeoutMs !== undefined && dependencies.totalTimeoutMs !== undefined) {
    throw new Error("timeoutMs and totalTimeoutMs cannot be used together");
  }
  const totalTimeoutMs = timeoutValue(
    dependencies.totalTimeoutMs ?? dependencies.timeoutMs,
    DEFAULT_TIMEOUT_MS,
  );
  const idleTimeoutMs = dependencies.idleTimeoutMs === undefined
    ? undefined
    : timeoutValue(dependencies.idleTimeoutMs, totalTimeoutMs);
  if (idleTimeoutMs !== undefined && idleTimeoutMs >= totalTimeoutMs) {
    throw new Error("idleTimeoutMs must be lower than totalTimeoutMs");
  }
  const resolveRequestIdleTimeoutMs = (
    options: CompletionOptions,
    requestTotalTimeoutMs: number,
  ) => {
    const configuredIdleTimeoutMs = options.idleTimeoutMs ?? idleTimeoutMs;
    if (configuredIdleTimeoutMs === undefined || requestTotalTimeoutMs <= 1) return undefined;
    return Math.min(
      timeoutValue(configuredIdleTimeoutMs, requestTotalTimeoutMs),
      requestTotalTimeoutMs - 1,
    );
  };
  const maxResponseBytes = z.number().int().positive().max(1024 * 1024).parse(
    dependencies.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
  );
  const maxResponsesStreamBytes = z.number().int().positive().max(MAX_RESPONSES_STREAM_BYTES).parse(
    dependencies.maxResponsesStreamBytes ?? DEFAULT_MAX_RESPONSES_STREAM_BYTES,
  );
  const chatEndpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const responsesEndpoint = `${config.baseUrl.replace(/\/$/, "")}/responses`;
  const providerHost = new URL(config.baseUrl).hostname.toLowerCase();
  const usesDeepSeekControls = providerHost === "api.deepseek.com";
  const usesOpenAIControls = providerHost === "api.openai.com";
  const usesResponsesApi = isGpt56ModelId(config.model);

  async function requestChat(
    rawMessages: z.infer<typeof ProviderConversationMessageSchema>[],
    options: ModelResponseOptions = {},
    structuredOutput = false,
  ): Promise<ModelResponse> {
    let messages = z.array(ProviderConversationMessageSchema).min(1).max(60).parse(rawMessages);
    const tools = z.array(ModelToolDefinitionSchema).max(20).parse(options.tools ?? []);
    const reasoningEffort = ModelReasoningEffortSchema.optional().parse(options.reasoningEffort);
    const strictStructuredOutput = ModelStructuredOutputSchema.optional().parse(
      options.structuredOutput,
    );
    const images = responseImages(options);
    if (images.length > 0) {
      const userIndex = messages.findLastIndex((message) => message.role === "user");
      const userMessage = messages[userIndex];
      if (userIndex < 0 || !userMessage || typeof userMessage.content !== "string") {
        throw new ModelServiceError("INVALID_RESPONSE");
      }
      messages = z.array(ProviderConversationMessageSchema).parse(messages.map((message, index) =>
        index === userIndex ? {
          role: "user" as const,
          content: [
            { type: "text" as const, text: userMessage.content as string },
            ...images.map((image) => ({
              type: "image_url" as const,
              image_url: { url: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}` },
            })),
          ],
        } : message));
    }
    const streaming = Boolean(options.onTextDelta || options.onStreamActivity);
    const requestTotalTimeoutMs = Math.min(
      totalTimeoutMs,
      timeoutValue(options.totalTimeoutMs, totalTimeoutMs),
    );
    const requestIdleTimeoutMs = streaming
      ? resolveRequestIdleTimeoutMs(options, requestTotalTimeoutMs)
      : undefined;
    const requestAbort = createRequestAbortController({
      callerSignal: options.signal,
      ...(requestIdleTimeoutMs === undefined ? {} : { idleTimeoutMs: requestIdleTimeoutMs }),
      totalTimeoutMs: requestTotalTimeoutMs,
    });
    try {
      const requestBody = (useStructuredOutput: boolean) => ({
          model: config.model,
          ...(!usesOpenAIControls ? { temperature: 0.2 } : {}),
          ...(usesOpenAIControls
            ? { max_completion_tokens: config.maxOutputTokens }
            : { max_tokens: config.maxOutputTokens }),
          messages,
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          ...(useStructuredOutput ? {
            response_format: strictStructuredOutput ? {
              type: "json_schema",
              json_schema: {
                name: strictStructuredOutput.name,
                strict: true,
                schema: strictStructuredOutput.schema,
              },
            } : { type: "json_object" },
          } : {}),
          ...(tools.length > 0 ? {
            tools: tools.map((tool) => ({ type: "function", function: tool })),
            tool_choice: options.toolChoice ?? "auto",
          } : options.toolChoice === "none" ? { tool_choice: "none" } : {}),
          ...(usesDeepSeekControls ? { thinking: { type: "disabled" } } : {}),
          ...(streaming ? { stream: true, stream_options: { include_usage: true } } : {}),
      });
      const send = async (useStructuredOutput: boolean) => {
        try {
          return await waitForAbortable(fetchImpl(chatEndpoint, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
            body: JSON.stringify(requestBody(useStructuredOutput)),
            signal: requestAbort.signal,
          }), requestAbort.signal);
        } catch (error) {
          if (error instanceof ModelServiceError) throw error;
          throwForAbortCause(requestAbort.abortCause);
          throw new ModelServiceError(
            "TRANSPORT", null, null, safeModelTransportFailureCode(error), null, error,
          );
        }
      };
      const useStructuredOutput = structuredOutput || Boolean(strictStructuredOutput);
      let response = await send(useStructuredOutput);
      throwForAbortCause(requestAbort.abortCause);
      if (
        structuredOutput
        && !strictStructuredOutput
        && !usesDeepSeekControls
        && [400, 422].includes(response.status)
      ) {
        await response.body?.cancel();
        response = await send(false);
        throwForAbortCause(requestAbort.abortCause);
      }
      if (!response.ok) {
        throw new ModelServiceError(
          response.status === 429 ? "RATE_LIMIT" : "PROVIDER_STATUS",
          retryAfterMs(response.headers.get("retry-after")),
          response.status,
        );
      }
      const parsed = streaming
        ? await readStreamingResponse(
            response,
            maxResponseBytes,
            options,
            (byteLength) => {
              requestAbort.noteTransportActivity(byteLength);
              if (byteLength > 0) options.onStreamActivity?.();
            },
            requestAbort.signal,
          )
        : ProviderResponseSchema.parse(JSON.parse(await readBoundedResponse(
            response,
            maxResponseBytes,
            requestAbort.signal,
          )));
      throwForAbortCause(requestAbort.abortCause);
      if (parsed.usage) {
        options.onUsage?.({
          inputTokens: parsed.usage.prompt_tokens,
          outputTokens: parsed.usage.completion_tokens,
          totalTokens: parsed.usage.total_tokens,
        });
      }
      const choice = parsed.choices[0];
      const message = choice.message;
      return {
        content: message.content?.trim() || null,
        toolCalls: (message.tool_calls ?? []).map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        })),
        ...(choice.finish_reason === "length" ? { outputTruncated: true } : {}),
      };
    } catch (error) {
      if (error instanceof ModelServiceError) throw error;
      throwForAbortCause(requestAbort.abortCause);
      if (error instanceof ModelResponseTransportError) {
        throw new ModelServiceError("TRANSPORT", null, null, error.transportCode, null, error);
      }
      throw new ModelServiceError(
        "INVALID_RESPONSE",
        null,
        null,
        null,
        safeModelProtocolFailureCode(error),
        error,
      );
    } finally {
      requestAbort.dispose();
    }
  }

  async function requestResponses(
    rawMessages: ModelConversationMessage[],
    options: ModelResponseOptions = {},
  ): Promise<ModelResponse> {
    const messages = z.array(ModelConversationMessageSchema).min(1).max(60).parse(rawMessages);
    const tools = z.array(ModelToolDefinitionSchema).max(20).parse(options.tools ?? []);
    const hostedTools = z.array(ModelHostedToolDefinitionSchema).max(1).parse(options.hostedTools ?? []);
    const maxHostedToolCalls = z.number().int().min(1).max(10).optional().parse(options.maxHostedToolCalls);
    const reasoningEffort = ModelReasoningEffortSchema.optional().parse(options.reasoningEffort);
    const strictStructuredOutput = ModelStructuredOutputSchema.optional().parse(
      options.structuredOutput,
    );
    const images = responseImages(options);
    const imageTargetIndex = images.length > 0
      ? messages.findLastIndex((message) => message.role === "user")
      : -1;
    if (images.length > 0 && imageTargetIndex < 0) throw new ModelServiceError("INVALID_RESPONSE");
    const inputItems = messages.flatMap((message, index): Record<string, unknown>[] => {
      if (message.role === "tool") {
        return [{ type: "function_call_output", call_id: message.toolCallId, output: message.content }];
      }
      if (message.role === "assistant") {
        if (message.providerOutput?.length) return message.providerOutput;
        return [
          ...(message.content ? [{ role: "assistant", content: message.content }] : []),
          ...(message.toolCalls ?? []).map((call) => ({
            type: "function_call",
            call_id: call.id,
            name: call.name,
            arguments: call.arguments,
          })),
        ];
      }
      if (images.length > 0 && index === imageTargetIndex) {
        return [{
          role: "user",
          content: [
            { type: "input_text", text: message.content },
            ...images.map((image) => ({
              type: "input_image",
              detail: "auto",
              image_url: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`,
            })),
          ],
        }];
      }
      return [{ role: message.role, content: message.content }];
    });
    const streaming = Boolean(options.onTextDelta || options.onStreamActivity);
    const requestTotalTimeoutMs = Math.min(
      totalTimeoutMs,
      timeoutValue(options.totalTimeoutMs, totalTimeoutMs),
    );
    const requestIdleTimeoutMs = streaming
      ? resolveRequestIdleTimeoutMs(options, requestTotalTimeoutMs)
      : undefined;
    const requestAbort = createRequestAbortController({
      callerSignal: options.signal,
      ...(requestIdleTimeoutMs === undefined ? {} : { idleTimeoutMs: requestIdleTimeoutMs }),
      totalTimeoutMs: requestTotalTimeoutMs,
    });
    try {
      let lastWebSearchProgress: ModelWebSearchProgress["status"] | null = null;
      const reportWebSearchProgress = (event: ModelWebSearchProgress) => {
        if (event.status === lastWebSearchProgress) return;
        lastWebSearchProgress = event.status;
        options.onWebSearchProgress?.(event);
      };
      const responseOptions = {
        ...options,
        onWebSearchProgress: reportWebSearchProgress,
      };
      const requestBody = (
        includeHostedTools: boolean,
        includeHostedToolCallLimit: boolean,
      ) => {
        const requestTools = [
          ...tools.map((tool) => ({ type: "function" as const, ...tool })),
          ...(includeHostedTools ? hostedTools.map((tool) => ({
            type: "web_search" as const,
            ...(tool.searchContextSize ? { search_context_size: tool.searchContextSize } : {}),
          })) : []),
        ];
        return {
          model: config.model,
          input: inputItems,
          max_output_tokens: config.maxOutputTokens,
          store: false,
          include: ["reasoning.encrypted_content"],
          ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
          ...(strictStructuredOutput ? {
            text: {
              format: {
                type: "json_schema",
                name: strictStructuredOutput.name,
                strict: true,
                schema: strictStructuredOutput.schema,
              },
            },
          } : {}),
          ...(includeHostedTools && includeHostedToolCallLimit && maxHostedToolCalls
            ? { max_tool_calls: maxHostedToolCalls }
            : {}),
          ...(requestTools.length > 0 ? {
            tools: requestTools,
            tool_choice: options.toolChoice ?? "auto",
          } : options.toolChoice === "none" ? { tool_choice: "none" as const } : {}),
          stream: streaming,
        };
      };
      const send = async (
        includeHostedTools: boolean,
        includeHostedToolCallLimit = true,
      ) => {
        try {
          return await waitForAbortable(fetchImpl(responsesEndpoint, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
            body: JSON.stringify(requestBody(includeHostedTools, includeHostedToolCallLimit)),
            signal: requestAbort.signal,
          }), requestAbort.signal);
        } catch (error) {
          if (error instanceof ModelServiceError) throw error;
          throwForAbortCause(requestAbort.abortCause);
          throw new ModelServiceError(
            "TRANSPORT", null, null, safeModelTransportFailureCode(error), null, error,
          );
        }
      };
      let response = await send(hostedTools.length > 0);
      throwForAbortCause(requestAbort.abortCause);
      const retryHostedToolsWithoutCallLimit = hostedTools.length > 0
        && maxHostedToolCalls !== undefined
        && await indicatesUnsupportedMaxToolCalls(response, requestAbort.signal);
      throwForAbortCause(requestAbort.abortCause);
      if (retryHostedToolsWithoutCallLimit) {
        await response.body?.cancel();
        response = await send(true, false);
        throwForAbortCause(requestAbort.abortCause);
      }
      let hostedWebSearchUnavailable = false;
      const hostedWebSearchCanFallback = hostedTools.length > 0
        && options.retryWithoutHostedTools !== false;
      const hostedToolIncompatible = hostedWebSearchCanFallback
        ? await indicatesHostedToolIncompatibility(response, requestAbort.signal)
        : false;
      throwForAbortCause(requestAbort.abortCause);
      const canRetryWithoutHostedTools = hostedWebSearchCanFallback && hostedToolIncompatible;
      if (canRetryWithoutHostedTools) {
        await response.body?.cancel();
        hostedWebSearchUnavailable = true;
        reportWebSearchProgress({ status: "UNAVAILABLE" });
        response = await send(false);
        throwForAbortCause(requestAbort.abortCause);
      }
      if (!response.ok) {
        throw new ModelServiceError(
          response.status === 429 ? "RATE_LIMIT" : "PROVIDER_STATUS",
          retryAfterMs(response.headers.get("retry-after")),
          response.status,
        );
      }
      const parsed = streaming
        ? await readResponsesStreamingResponse(
            response,
            maxResponsesStreamBytes,
            responseOptions,
            (byteLength) => {
              requestAbort.noteTransportActivity(byteLength);
              if (byteLength > 0) responseOptions.onStreamActivity?.();
            },
            requestAbort.signal,
          )
        : ResponsesApiResponseSchema.parse(JSON.parse(await readBoundedResponse(
            response,
            maxResponseBytes,
            requestAbort.signal,
          )));
      throwForAbortCause(requestAbort.abortCause);
      if (parsed.usage) {
        options.onUsage?.({
          inputTokens: parsed.usage.input_tokens,
          outputTokens: parsed.usage.output_tokens,
          totalTokens: parsed.usage.total_tokens,
        });
      }
      const result = modelResponseFromResponses(parsed, {
        hostedWebSearchOffered: hostedTools.length > 0,
        hostedWebSearchUnavailable,
      });
      if (result.webSearch?.status === "SUCCEEDED") {
        reportWebSearchProgress({ status: "SUCCEEDED" });
      } else if (result.webSearch?.status === "UNAVAILABLE") {
        reportWebSearchProgress({ status: "UNAVAILABLE" });
      }
      return result;
    } catch (error) {
      if (error instanceof ModelServiceError) throw error;
      throwForAbortCause(requestAbort.abortCause);
      if (error instanceof ModelResponseTransportError) {
        throw new ModelServiceError("TRANSPORT", null, null, error.transportCode, null, error);
      }
      throw new ModelServiceError(
        "INVALID_RESPONSE",
        null,
        null,
        null,
        safeModelProtocolFailureCode(error),
        error,
        responseObservationFrom(error),
      );
    } finally {
      requestAbort.dispose();
    }
  }

  async function completeWithImages(
    rawMessages: ModelMessage[],
    rawImages: ModelVisionImage[],
    options?: CompletionOptions,
  ) {
    const messages = z.array(MessageSchema).min(1).max(30).parse(rawMessages);
    const images = ModelImagesSchema.parse(rawImages);
    const response = usesResponsesApi
      ? await requestResponses(messages, { ...options, images })
      : await requestChat(messages, { ...options, images }, true);
    if (!response.content) throw new ModelServiceError("INVALID_RESPONSE");
    return response.content;
  }

  return {
    async complete(rawMessages, options) {
      const messages = z.array(MessageSchema).min(1).max(30).parse(rawMessages);
      const response = usesResponsesApi
        ? await requestResponses(messages, options)
        : await requestChat(messages, options, true);
      if (!response.content) throw new ModelServiceError("INVALID_RESPONSE");
      return response.content;
    },
    respond(rawMessages, options) {
      const messages = z.array(ModelConversationMessageSchema).min(1).max(60).parse(rawMessages);
      if (usesResponsesApi) return requestResponses(messages, options);
      const providerMessages = messages.map((message) => {
        if (message.role === "tool") {
          return { role: "tool" as const, tool_call_id: message.toolCallId, content: message.content };
        }
        if (message.role === "assistant") {
          if (message.toolCalls?.length) {
            return {
              role: "assistant" as const,
              content: message.content,
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: call.arguments },
              })),
            };
          }
          return { role: "assistant" as const, content: message.content ?? "" };
        }
        return { role: message.role, content: message.content };
      });
      return requestChat(providerMessages, options, false);
    },
    async completeWithImage(rawMessages, rawImage, options) {
      const image = ImageSchema.parse(rawImage);
      return completeWithImages(rawMessages, [image], options);
    },
    completeWithImages,
  };
}
