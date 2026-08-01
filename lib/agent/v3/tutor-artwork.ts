import type { PreparedAgentArtwork } from "../artwork-attachment";
import type { AgentResponseText } from "../artwork-turn-support";
import type { ModelProviderAdapter } from "../model-provider-adapter";

const MAX_TUTOR_MESSAGE_CHARACTERS = 32_000;

export function canNativeTutorObserveArtwork(
  client: ModelProviderAdapter | null,
  artwork?: PreparedAgentArtwork,
) {
  return Boolean(
    artwork
    && client?.capabilities.vision
    && (client.respond || client.completeWithImage),
  );
}

export function applyTutorArtworkBoundary(
  text: AgentResponseText,
  delivered: boolean,
) {
  const boundary = delivered
    ? "作品观察仅基于这张静态画面中实际可见的构图、色彩、文字、形态与层级；不臆断动态、材质、交互或使用效果。"
    : "当前模型未能可靠读取这张作品图片；以下内容不包含画面观察，其他依据会在回答下方单独标注。";
  const unreadPrefix = "我目前不能可靠读取这张图片，所以先不对画面作具体描述。\n\n";
  const prefixedMessage = `${unreadPrefix}${text.message}`;
  return {
    ...text,
    message: delivered || /不能.{0,8}读取|未能.{0,8}读取|无法.{0,8}查看/.test(text.message)
      ? text.message
      : prefixedMessage.length <= MAX_TUTOR_MESSAGE_CHARACTERS
        ? prefixedMessage
        : text.message,
    uncertainty: Array.from(new Set([boundary, text.uncertainty])).join(" ").slice(0, 500),
  };
}
