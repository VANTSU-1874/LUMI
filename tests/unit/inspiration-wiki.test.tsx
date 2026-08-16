import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InspirationWiki } from "@/components/inspiration/InspirationWiki";
import { inspirationEntries } from "@/components/inspiration/inspiration-wiki-data";

vi.mock("@/components/Masonry", () => ({
  default: ({
    items,
    renderItem,
  }: {
    items: readonly { id: string }[];
    renderItem: (item: { id: string }) => ReactNode;
  }) => (
    <div aria-label="灵感案例" role="list">
      {items.map((item) => <div key={item.id}>{renderItem(item)}</div>)}
    </div>
  ),
}));

afterEach(cleanup);

describe("InspirationWiki in the Lumi app shell", () => {
  it("starts with a curated browse flow before a student searches", () => {
    render(<InspirationWiki embedded entries={inspirationEntries} />);

    expect(screen.getByText(`${inspirationEntries.length} 个正式案例`)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(inspirationEntries.length);
  });

  it("turns a natural-language book design request into visible filters and cards", () => {
    render(<InspirationWiki embedded entries={inspirationEntries} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索灵感资料" }), {
      target: { value: "我想找一些书籍设计的参考示范" },
    });

    expect(screen.getByText("已识别：书籍设计")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "材质可以参与叙事，不只是装饰" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "网格先服务阅读，再服务整齐" })).not.toBeInTheDocument();
  });

  it("returns a selected case to the existing chat instead of navigating to a separate site", () => {
    const onBackToChat = vi.fn();
    const onUseInChat = vi.fn();
    render(
      <InspirationWiki
        embedded
        entries={inspirationEntries}
        onBackToChat={onBackToChat}
        onUseInChat={onUseInChat}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "带回当前对话" })[0]!);
    expect(onUseInChat).toHaveBeenCalledWith(expect.objectContaining({ id: "balance" }));

    fireEvent.click(screen.getByRole("button", { name: "返回对话" }));
    expect(onBackToChat).toHaveBeenCalledOnce();
  });
});
