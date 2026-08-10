import {
  createModelClient,
  type CompletionOptions,
  type ModelClient,
  type ModelConversationMessage,
  type ModelMessage,
  type ModelResponse,
  type ModelResponseOptions,
  type ModelVisionImage,
} from "@/lib/ai/client";
import { isGpt56ModelId } from "@/lib/ai/model-id";

export type ModelProviderAdapter = {
  provider: "OPENAI_COMPATIBLE" | "TEST";
  protocol?: "OPENAI" | "DEEPSEEK_ANTHROPIC";
  modelId?: string;
  capabilities: { vision: boolean; webSearch?: boolean };
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
};

export function createOpenAICompatibleModelProvider(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  idleTimeoutMs: number;
  totalTimeoutMs: number;
  vision: boolean;
}): ModelProviderAdapter {
  const client = createModelClient({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    model: input.model,
    maxOutputTokens: input.maxOutputTokens,
  }, {
    idleTimeoutMs: input.idleTimeoutMs,
    totalTimeoutMs: input.totalTimeoutMs,
  });
  return {
    provider: "OPENAI_COMPATIBLE",
    protocol: "OPENAI",
    modelId: input.model,
    capabilities: {
      vision: input.vision,
      webSearch: isGpt56ModelId(input.model),
    },
    complete: client.complete,
    respond: client.respond,
    completeWithImage: input.vision ? client.completeWithImage : undefined,
  };
}

export function modelClientAdapter(client: ModelClient): ModelProviderAdapter {
  return {
    provider: "TEST",
    capabilities: { vision: Boolean(client.completeWithImage) },
    complete: client.complete,
    respond: client.respond,
    completeWithImage: client.completeWithImage,
  };
}
