import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantLabSectionView } from "@/components/assistant-lab/AssistantLabSections";
import { LAB_PLUGIN_CATALOG } from "@/components/assistant-lab/assistant-lab-data";

const capabilityMocks = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("@/components/assistant-lab/assistant-lab-capability-state", () => ({
  useComposerCapability: () => ({
    clear: vi.fn(),
    select: capabilityMocks.select,
    selected: null,
  }),
}));

describe("Lumi plugin directory", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("aggregates plugins and Skills without the retired Cowart entry", () => {
    render(
      <AssistantLabSectionView
        activeProjectId={null}
        onBackToChat={vi.fn()}
        onOpenProject={vi.fn()}
        section="plugins"
      />,
    );

    expect(screen.getByText("插件与 Skill")).toBeInTheDocument();
    expect(screen.getByText("Skill 创建")).toBeInTheDocument();
    expect(screen.getByText("TouchDesigner 案例库")).toBeInTheDocument();
    expect(screen.queryByText(/Cowart/)).not.toBeInTheDocument();
    expect(screen.queryByText("TouchDesigner 实时检查")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "需连接" })).not.toBeInTheDocument();
    expect(LAB_PLUGIN_CATALOG.map(({ id }) => id)).not.toContain("cowart");
    expect(LAB_PLUGIN_CATALOG.map(({ id }) => id)).not.toContain("touchdesigner-live");
  });

  it("selects an available capability and returns to chat", () => {
    const onBackToChat = vi.fn();
    render(
      <AssistantLabSectionView
        activeProjectId={null}
        onBackToChat={onBackToChat}
        onOpenProject={vi.fn()}
        section="plugins"
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "在对话中使用" })[0]!);

    expect(capabilityMocks.select).toHaveBeenCalledWith("course-reference");
    expect(onBackToChat).toHaveBeenCalledTimes(1);
  });

  it("links authorization-required plugins only to official HTTPS sites", () => {
    render(
      <AssistantLabSectionView
        activeProjectId={null}
        onBackToChat={vi.fn()}
        onOpenProject={vi.fn()}
        section="plugins"
      />,
    );

    const links = screen.getAllByRole("link", { name: /去官网授权/ });
    expect(links).toHaveLength(5);
    for (const link of links) {
      const url = new URL(link.getAttribute("href")!);
      expect(url.protocol).toBe("https:");
      expect([
        "www.figma.com",
        "www.notion.so",
        "drive.google.com",
        "www.canva.com",
        "slack.com",
      ]).toContain(url.hostname);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
  });

  it("filters the unified catalog by authorization state", () => {
    render(
      <AssistantLabSectionView
        activeProjectId={null}
        onBackToChat={vi.fn()}
        onOpenProject={vi.fn()}
        section="plugins"
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "需授权" }));

    expect(screen.getByText("Figma")).toBeInTheDocument();
    expect(screen.queryByText("Skill 创建")).not.toBeInTheDocument();
    expect(screen.queryByText("TouchDesigner 实时检查")).not.toBeInTheDocument();
  });
});
