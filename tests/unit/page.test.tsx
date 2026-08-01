import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("Home", () => {
  it("introduces Lumi as a design learning partner without retired product terms", () => {
    const { container } = render(<Home />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "我们今天做什么",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lumi 鹿鸣首页" })).toHaveTextContent("LUMI");
    expect(screen.getByText("设计路上，多一位随时能反馈的老师")).toBeInTheDocument();
    expect(screen.getByText("一个讲话有出处的老师")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "以演示学生身份进入" })).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "登录 Lumi" })
        .some((link) => link.getAttribute("href") === "/login"),
    ).toBe(true);
    expect(container.querySelector(".lumi-f35-staggered-menu")).toHaveAttribute(
      "data-position",
      "left",
    );
    expect(screen.getByText("我有班级码")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/触映|通感阶梯|门禁/);
  });
});
