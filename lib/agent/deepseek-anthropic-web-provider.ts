import { z } from "zod";

import {
  ModelServiceError,
  type ModelConversationMessage,
  type ModelMessage,
  type ModelResponse,
  type ModelResponseOptions,
  type ModelTransportFailureCode,
} from "@/lib/ai/client";

import type { ModelProviderAdapter } from "./model-provider-adapter";

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_RESPONSE_TEXT_CHARACTERS = 32_000;
const MAX_STRUCTURED_WEB_RESULTS = 32;

const AnthropicWebResultSchema = z.object({
  type: z.literal("web_search_result"),
  url: z.string().trim().min(1).max(4_096),
  title: z.string().trim().max(1_024),
}).passthrough();

const AnthropicWebResultErrorSchema = z.object({
  type: z.literal("web_search_tool_result_error"),
  error_code: z.string().trim().min(1).max(100),
}).passthrough();

const AnthropicContentBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string().max(MAX_RESPONSE_TEXT_CHARACTERS),
    citations: z.array(z.object({
      url: z.string().trim().min(1).max(4_096),
      title: z.string().trim().min(1).max(1_024),
    }).passthrough()).max(64).optional(),
  }).passthrough(),
  z.object({
    type: z.literal("thinking"),
  }).passthrough(),
  z.object({
    type: z.literal("server_tool_use"),
    name: z.string().trim().min(1).max(100),
  }).passthrough(),
  z.object({
    type: z.literal("web_search_tool_result"),
    content: z.union([
      z.array(z.union([
        AnthropicWebResultSchema,
        AnthropicWebResultErrorSchema,
      ])).max(MAX_STRUCTURED_WEB_RESULTS),
      AnthropicWebResultErrorSchema,
    ]),
  }).passthrough(),
]);

const AnthropicMessageResponseSchema = z.object({
  type: z.literal("message"),
  content: z.array(AnthropicContentBlockSchema).max(64),
  stop_reason: z.string().nullable().optional(),
  usage: z.object({
    input_tokens: z.number().int().min(0),
    output_tokens: z.number().int().min(0),
  }).passthrough().optional(),
}).passthrough();

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function sanitizedTransportCode(error: unknown): ModelTransportFailureCode {
  let current = error;
  const visited = new Set<object>();
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null || visited.has(current)) break;
    visited.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") {
      const allowed = [
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
      ] as const;
      if ((allowed as readonly string[]).includes(candidate.code)) {
        return candidate.code as ModelTransportFailureCode;
      }
    }
    current = candidate.cause;
  }
  return "OTHER";
}

function validPublicUrl(value: string) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol)
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

export function deepSeekAnthropicMessagesUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  let pathname = url.pathname.replace(/\/+$/, "");
  if (/\/anthropic\/v1$/i.test(pathname)) {
    pathname = `${pathname}/messages`;
  } else if (/\/anthropic$/i.test(pathname)) {
    pathname = `${pathname}/v1/messages`;
  } else if (/\/v1$/i.test(pathname)) {
    pathname = `${pathname.slice(0, -3)}/anthropic/v1/messages`;
  } else {
    pathname = `${pathname}/anthropic/v1/messages`;
  }
  url.pathname = pathname.replace(/\/+/g, "/");
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function isDeepSeekV4HostedWebModel(model: string) {
  return /^deepseek-v4(?:-|$)/i.test(model.trim());
}

function anthropicConversation(
  messages: ModelConversationMessage[],
) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
    .trim();
  const conversation: Array<{
    role: "user" | "assistant";
    content: string;
  }> = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      throw new ModelServiceError("INVALID_RESPONSE");
    }
    if (
      message.role === "assistant"
      && (
        (message.toolCalls?.length ?? 0) > 0
        || (message.providerOutput?.length ?? 0) > 0
      )
    ) {
      throw new ModelServiceError("INVALID_RESPONSE");
    }
    const content = message.content?.trim();
    if (!content) throw new ModelServiceError("INVALID_RESPONSE");
    conversation.push({
      role: message.role,
      content,
    });
  }
  if (conversation.length === 0) {
    throw new ModelServiceError("INVALID_RESPONSE");
  }
  return { system, conversation };
}

function modelMessagesAsConversation(
  messages: ModelMessage[],
): ModelConversationMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export function createDeepSeekAnthropicWebProvider(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  idleTimeoutMs: number;
  totalTimeoutMs: number;
  fetchImpl?: FetchImplementation;
}): ModelProviderAdapter {
  const endpoint = deepSeekAnthropicMessagesUrl(input.baseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  const maxOutputTokens = Math.min(
    4_096,
    Math.max(1, input.maxOutputTokens ?? 2_048),
  );

  async function respond(
    messages: ModelConversationMessage[],
    options: ModelResponseOptions = {},
  ): Promise<ModelResponse> {
    if (
      options.image
      || (options.images?.length ?? 0) > 0
      || (options.tools?.length ?? 0) > 0
      || options.structuredOutput
    ) {
      throw new ModelServiceError("INVALID_RESPONSE");
    }
    const hostedWebOffered = (options.hostedTools ?? [])
      .some((tool) => tool.type === "web_search");
    const { system, conversation } =
      anthropicConversation(messages);
    const timeoutSignal = AbortSignal.timeout(
      Math.min(
        600_000,
        Math.max(
          1_000,
          options.totalTimeoutMs ?? input.totalTimeoutMs,
        ),
      ),
    );
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": input.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: input.model,
          max_tokens: maxOutputTokens,
          ...(system ? { system } : {}),
          messages: conversation,
          ...(hostedWebOffered
            ? {
                tools: [{
                  type: "web_search_20250305",
                  name: "web_search",
                  max_uses: Math.min(
                    8,
                    Math.max(
                      1,
                      options.maxHostedToolCalls ?? 1,
                    ),
                  ),
                }],
              }
            : {}),
          ...(options.toolChoice
            ? {
                tool_choice: hostedWebOffered
                  && options.toolChoice !== "none"
                  ? {
                      type: "tool",
                      name: "web_search",
                    }
                  : options.toolChoice === "required"
                    ? { type: "any" }
                    : { type: options.toolChoice },
              }
            : {}),
          stream: false,
        }),
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw new ModelServiceError("CANCELLED", null, null, null, null, error);
      }
      if (timeoutSignal.aborted) {
        throw new ModelServiceError("TIMEOUT", null, null, null, null, error);
      }
      throw new ModelServiceError(
        "TRANSPORT",
        null,
        null,
        sanitizedTransportCode(error),
        null,
        error,
      );
    }
    if (!response.ok) {
      throw new ModelServiceError(
        response.status === 429
          ? "RATE_LIMIT"
          : "PROVIDER_STATUS",
        null,
        response.status,
      );
    }
    const bodyText = await response.text();
    if (
      bodyText.length === 0
      || Buffer.byteLength(bodyText, "utf8")
        > MAX_RESPONSE_BYTES
    ) {
      throw new ModelServiceError("INVALID_RESPONSE");
    }
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch (error) {
      throw new ModelServiceError(
        "INVALID_RESPONSE",
        null,
        response.status,
        null,
        "JSON_INVALID",
        error,
      );
    }
    const parsed =
      AnthropicMessageResponseSchema.safeParse(parsedBody);
    if (!parsed.success) {
      throw new ModelServiceError(
        "INVALID_RESPONSE",
        null,
        response.status,
        null,
        "EVENT_SCHEMA_INVALID",
      );
    }
    const text = parsed.data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .slice(0, MAX_RESPONSE_TEXT_CHARACTERS);
    const resultBlocks = parsed.data.content
      .filter((block) =>
        block.type === "web_search_tool_result");
    const hasServerWebUse = parsed.data.content.some(
      (block) =>
        block.type === "server_tool_use"
        && block.name === "web_search",
    );
    const structuredResults = resultBlocks.flatMap(
      (block) => Array.isArray(block.content)
        ? block.content.filter(
            (item) =>
              item.type === "web_search_result",
          )
        : [],
    );
    const webErrors = resultBlocks.flatMap(
      (block) => Array.isArray(block.content)
        ? block.content.filter(
            (item) =>
              item.type
              === "web_search_tool_result_error",
          )
        : [block.content],
    );
    const webUnavailable =
      structuredResults.length === 0
      && webErrors.length > 0;
    const candidates = [
      ...structuredResults,
      ...parsed.data.content
        .filter((block) => block.type === "text")
        .flatMap((block) => block.citations ?? []),
    ];
    const seen = new Set<string>();
    const citations = candidates
      .filter(({ url }) => validPublicUrl(url))
      .filter(({ url }) => {
        const normalized = new URL(url).toString();
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      })
      .slice(0, MAX_STRUCTURED_WEB_RESULTS)
      .map(({ url, title }) => {
        const normalizedUrl = new URL(url);
        const normalizedTitle = title
          .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
        return {
          url: normalizedUrl.toString(),
          title:
            normalizedTitle
            || normalizedUrl.hostname.slice(0, 200),
          startIndex: 0,
          endIndex: 0,
        };
      });
    if (hasServerWebUse) {
      options.onWebSearchProgress?.({ status: "RUNNING" });
    }
    if (webUnavailable) {
      options.onWebSearchProgress?.({ status: "UNAVAILABLE" });
    } else if (structuredResults.length > 0) {
      options.onWebSearchProgress?.({ status: "SUCCEEDED" });
    }
    if (parsed.data.usage) {
      const usage = {
        inputTokens: parsed.data.usage.input_tokens,
        outputTokens: parsed.data.usage.output_tokens,
        totalTokens:
          parsed.data.usage.input_tokens
          + parsed.data.usage.output_tokens,
      };
      options.onUsage?.(usage);
    }
    if (text) options.onTextDelta?.(text);
    return {
      content: text || null,
      toolCalls: [],
      ...(hostedWebOffered
        ? {
            webSearch: {
              status: webUnavailable
                ? ("UNAVAILABLE" as const)
                : structuredResults.length > 0
                  ? ("SUCCEEDED" as const)
                  : ("NOT_USED" as const),
              citations,
            },
          }
        : {}),
    };
  }

  return {
    provider: "OPENAI_COMPATIBLE",
    protocol: "DEEPSEEK_ANTHROPIC",
    modelId: input.model,
    capabilities: {
      vision: false,
      webSearch: true,
    },
    async complete(messages, options) {
      const response = await respond(
        modelMessagesAsConversation(messages),
        options,
      );
      if (!response.content?.trim()) {
        throw new ModelServiceError("INVALID_RESPONSE");
      }
      return response.content;
    },
    respond,
  };
}
