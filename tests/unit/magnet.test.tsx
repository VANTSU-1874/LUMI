import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Magnet from "@/components/ui/Magnet";

const originalMatchMedia = window.matchMedia;
let scheduledFrames: FrameRequestCallback[] = [];

function installMatchMedia({ reduced = false, fine = true } = {}) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : fine,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("Magnet", () => {
  beforeEach(() => {
    installMatchMedia();
    scheduledFrames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("clamps the pull and returns to the origin outside the activation area", async () => {
    render(
      <Magnet data-testid="magnet" magnetStrength={1} maxOffset={10} padding={50}>
        <span>相机</span>
      </Magnet>,
    );

    const wrapper = screen.getByTestId("magnet");
    vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    });

    await waitFor(() => expect(window.matchMedia).toHaveBeenCalledTimes(2));

    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 140, clientY: 140 }));
      scheduledFrames.shift()?.(0);
    });

    await waitFor(() => expect(wrapper).toHaveAttribute("data-magnet-active", "true"));
    expect(wrapper.firstElementChild).toHaveStyle({
      transform: "translate3d(10px, 10px, 0)",
    });

    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 500, clientY: 500 }));
      scheduledFrames.shift()?.(0);
    });

    await waitFor(() => expect(wrapper).toHaveAttribute("data-magnet-active", "false"));
    expect(wrapper.firstElementChild).toHaveStyle({
      transform: "translate3d(0px, 0px, 0)",
    });
  });

  it("stays still when reduced motion is requested", async () => {
    installMatchMedia({ reduced: true, fine: true });
    render(
      <Magnet data-testid="magnet" magnetStrength={1} maxOffset={10} padding={50}>
        <span>画笔</span>
      </Magnet>,
    );

    const wrapper = screen.getByTestId("magnet");
    vi.spyOn(wrapper, "getBoundingClientRect");

    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 40, clientY: 40 }));
    });

    await waitFor(() => expect(wrapper).toHaveAttribute("data-magnet-active", "false"));
    expect(wrapper.getBoundingClientRect).not.toHaveBeenCalled();
    expect(wrapper.firstElementChild).toHaveStyle({
      transform: "translate3d(0px, 0px, 0)",
    });
  });
});
