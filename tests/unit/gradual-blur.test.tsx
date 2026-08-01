import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GradualBlur } from "@/components/ui/GradualBlur";

describe("GradualBlur", () => {
  it("renders a click-through page overlay with a stable maximum blur", () => {
    const { container } = render(
      <GradualBlur
        className="test-blur"
        curve="ease-out"
        divCount={5}
        position="top"
        strength={10}
        target="page"
        zIndex={30}
      />,
    );

    const root = container.firstElementChild as HTMLElement;
    const layers = root.querySelectorAll<HTMLElement>("[data-gradual-blur-layer]");

    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root).toHaveClass("test-blur");
    expect(root).toHaveStyle({
      pointerEvents: "none",
      position: "fixed",
      zIndex: "30",
    });
    expect(layers).toHaveLength(5);
    expect(layers[layers.length - 1]).toHaveStyle({ backdropFilter: "blur(10.00px)" });
  });

  it("clamps excessive layer counts without changing the requested maximum blur", () => {
    const { container } = render(<GradualBlur divCount={20} strength={8} />);
    const layers = container.querySelectorAll<HTMLElement>("[data-gradual-blur-layer]");

    expect(layers).toHaveLength(8);
    expect(layers[layers.length - 1]).toHaveStyle({ backdropFilter: "blur(8.00px)" });
  });
});
