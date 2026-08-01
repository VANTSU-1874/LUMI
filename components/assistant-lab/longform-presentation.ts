export const LONGFORM_MIN_RENDERED_HEIGHT_PX = 1_200;

export function longformCollapseThreshold(viewportHeight: number) {
  return Math.max(LONGFORM_MIN_RENDERED_HEIGHT_PX, Math.max(0, viewportHeight) * 2);
}

export function shouldCollapseLongform({
  contentHeight,
  isStreaming,
  viewportHeight,
}: {
  contentHeight: number;
  isStreaming: boolean;
  viewportHeight: number;
}) {
  return !isStreaming && contentHeight > longformCollapseThreshold(viewportHeight);
}
