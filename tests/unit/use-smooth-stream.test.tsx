import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSmoothStream } from "@/components/student/use-smooth-stream";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useSmoothStream", () => {
  it("drains streaming text on animation frames and immediately flattens a completed answer", async () => {
    let frameId = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList));
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameId += 1;
      callbacks.set(frameId, callback);
      return frameId;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => callbacks.delete(id)));

    const { result, rerender } = renderHook(
      ({ text, isStreaming }) => useSmoothStream(text, isStreaming, 10),
      { initialProps: { text: "abcd", isStreaming: true } },
    );
    await waitFor(() => expect(callbacks.size).toBeGreaterThan(0));
    const firstFrame = callbacks.get(frameId);
    expect(firstFrame).toBeDefined();
    act(() => firstFrame?.(0));
    expect(result.current).toBe("a");

    const secondFrame = callbacks.get(frameId);
    expect(secondFrame).toBeDefined();
    act(() => secondFrame?.(100));
    expect(result.current).toBe("ab");

    rerender({ text: "abcd", isStreaming: false });
    expect(result.current).toBe("abcd");
  });

  it("does not flash a prior completed response when a new stream begins", async () => {
    let frameId = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList));
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameId += 1;
      callbacks.set(frameId, callback);
      return frameId;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => callbacks.delete(id)));

    const { result, rerender } = renderHook(
      ({ text, isStreaming }) => useSmoothStream(text, isStreaming, 10),
      { initialProps: { text: "earlier answer", isStreaming: false } },
    );
    expect(result.current).toBe("earlier answer");

    rerender({ text: "new", isStreaming: true });
    expect(result.current).toBe("");

    const firstFrame = callbacks.get(frameId);
    expect(firstFrame).toBeDefined();
    act(() => firstFrame?.(0));
    expect(result.current).toBe("n");
  });

  it("keeps a continuation prefix visible while the replacement stream replays from zero", async () => {
    let frameId = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList));
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameId += 1;
      callbacks.set(frameId, callback);
      return frameId;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => callbacks.delete(id)));

    const prefix = "已交付的正文保持不动。";
    const { result, rerender, unmount } = renderHook(
      ({ text, isStreaming, instantPrefix }) => useSmoothStream(text, isStreaming, 10, instantPrefix),
      { initialProps: { text: prefix, isStreaming: false, instantPrefix: "" } },
    );
    expect(result.current).toBe(prefix);

    rerender({ text: "", isStreaming: true, instantPrefix: prefix });
    expect(result.current).toBe(prefix);

    rerender({ text: prefix.slice(0, 4), isStreaming: true, instantPrefix: prefix });
    expect(result.current).toBe(prefix);

    rerender({ text: `${prefix}新`, isStreaming: true, instantPrefix: prefix });
    expect(result.current).toBe(prefix);
    const firstNewCharacter = callbacks.get(frameId);
    expect(firstNewCharacter).toBeDefined();
    act(() => firstNewCharacter?.(100));
    expect(result.current).toBe(`${prefix}新`);

    unmount();
    const remounted = renderHook(
      ({ text, isStreaming, instantPrefix }) => useSmoothStream(text, isStreaming, 10, instantPrefix),
      { initialProps: { text: "", isStreaming: true, instantPrefix: prefix } },
    );
    expect(remounted.result.current).toBe(prefix);
  });

  it("keeps the continuation prefix for reduced-motion users", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList));
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const prefix = "已有正文不应因减少动效而消失。";
    const { result, rerender } = renderHook(
      ({ text }) => useSmoothStream(text, true, 10, prefix),
      { initialProps: { text: "" } },
    );
    expect(result.current).toBe(prefix);

    rerender({ text: prefix.slice(0, 4) });
    expect(result.current).toBe(prefix);

    rerender({ text: `${prefix}新内容` });
    expect(result.current).toBe(`${prefix}新内容`);
  });
});
