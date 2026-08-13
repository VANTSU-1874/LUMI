import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { InspirationCitationCard } from "@/components/inspiration/InspirationCitationCard";
import { inspirationCitationPreviewFor } from "@/components/inspiration/inspiration-citation-mocks";

afterEach(cleanup);

describe("InspirationCitationCard", () => {
  it("does not render a citation surface when no case is eligible", () => {
    const view = render(<InspirationCitationCard citations={[]} />);

    expect(view.container).toBeEmptyDOMElement();
  });

  it("keeps course references and inspiration cases visibly distinct", () => {
    const citation = inspirationCitationPreviewFor("balance");
    if (!citation) throw new Error("expected the local balance preview citation");

    render(
      <InspirationCitationCard
        citations={[citation]}
        courseReferences={[{
          id: "course-layout",
          title: "版式设计 · 信息层级",
          detail: "本回答使用的课程资料",
        }]}
      />,
    );

    expect(screen.getByText("课程引用")).toBeInTheDocument();
    expect(screen.getByText("版式设计 · 信息层级")).toBeInTheDocument();
    expect(screen.getAllByText(/灵感 Wiki 推荐案例|推荐案例/).length).toBeGreaterThan(0);
    expect(screen.getByText("留白与重心的非对称平衡")).toBeInTheDocument();
    expect(screen.getByText("Lumi 原创合规示意 · 本地 mock")).toBeInTheDocument();
    expect(screen.getByText("原创示意，仅作课程原型展示")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看详情/ })).toHaveAttribute(
      "href",
      "/student?inspiration=1&entry=balance#inspiration-entry-detail",
    );
    expect(screen.getByRole("status")).toHaveTextContent("尚未接入实际检索");
  });
});
