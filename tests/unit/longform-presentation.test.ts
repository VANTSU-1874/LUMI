import { describe, expect, it } from "vitest";

import {
  LONGFORM_MIN_RENDERED_HEIGHT_PX,
  longformCollapseThreshold,
  shouldCollapseLongform,
} from "@/components/assistant-lab/longform-presentation";

describe("longform presentation", () => {
  it("uses two message viewports with a 1200px lower bound", () => {
    expect(longformCollapseThreshold(360)).toBe(LONGFORM_MIN_RENDERED_HEIGHT_PX);
    expect(longformCollapseThreshold(800)).toBe(1_600);
  });

  it("waits for streaming to settle before it collapses a rendered response", () => {
    expect(shouldCollapseLongform({
      contentHeight: 1_500,
      isStreaming: true,
      viewportHeight: 600,
    })).toBe(false);
    expect(shouldCollapseLongform({
      contentHeight: 1_200,
      isStreaming: false,
      viewportHeight: 600,
    })).toBe(false);
    expect(shouldCollapseLongform({
      contentHeight: 1_201,
      isStreaming: false,
      viewportHeight: 600,
    })).toBe(true);
  });
});
