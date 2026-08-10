import {
  createDeepSeekAnthropicWebProvider,
  isDeepSeekV4HostedWebModel,
} from "./deepseek-anthropic-web-provider";
import {
  createOpenAICompatibleModelProvider,
  type ModelProviderAdapter,
} from "./model-provider-adapter";

export function createHostedWebModelProvider(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens?: number;
  idleTimeoutMs: number;
  totalTimeoutMs: number;
}): ModelProviderAdapter {
  if (isDeepSeekV4HostedWebModel(input.model)) {
    return createDeepSeekAnthropicWebProvider(input);
  }
  return createOpenAICompatibleModelProvider({
    ...input,
    vision: false,
  });
}
