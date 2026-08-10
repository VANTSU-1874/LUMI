import type { ModelProviderAdapter } from "./model-provider-adapter";
import type { PreparedAgentArtwork } from "./artwork-attachment";

export type AgentResponseText = {
  title: string;
  message: string;
  whyThisStep: string;
  uncertainty: string;
};

export function artworkModelCapability(
  client: ModelProviderAdapter | null,
  artwork?: PreparedAgentArtwork,
) {
  const canObserve = Boolean(
    artwork && client?.capabilities.vision && client.completeWithImage,
  );
  return {
    canObserve,
    shouldRunModel: Boolean(client && (!artwork || canObserve)),
  };
}

export function decisionUsedArtwork(
  artwork: PreparedAgentArtwork | undefined,
  canObserve: boolean,
  sourceIds: ReadonlySet<string>,
) {
  return Boolean(
    artwork && canObserve && sourceIds.has(`artwork:${artwork.id}`),
  );
}

export function applyArtworkBoundary(
  text: AgentResponseText,
  observed: boolean,
) {
  const boundary = observed
    ? "作品观察仅基于这张静态画面；交互、材质、动态、制作状态和真实使用效果仍未被验证。"
    : "当前模型未能可靠读取这张作品图片；以下内容不包含画面观察，其他依据会在回答下方单独标注。";
  return {
    ...text,
    message: observed || /不能.{0,8}读取|未能.{0,8}读取|无法.{0,8}查看/.test(text.message)
      ? text.message
      : `我目前不能可靠读取这张图片，所以先不对画面作具体描述。\n\n${text.message}`.slice(0, 1_200),
    uncertainty: Array.from(new Set([boundary, text.uncertainty])).join(" ").slice(0, 500),
  };
}
