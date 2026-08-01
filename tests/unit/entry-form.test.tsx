import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  destinationForRole,
  EntryForm,
} from "@/components/entry/EntryForm";

function successfulResponse() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("EntryForm", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("maps each role to its dashboard destination", () => {
    expect(destinationForRole("STUDENT")).toBe("/student");
    expect(destinationForRole("STUDENT", "/assistant-lab")).toBe("/assistant-lab");
    expect(destinationForRole("STUDENT", "//example.com")).toBe("/student");
    expect(destinationForRole("STUDENT", "https://example.com")).toBe("/student");
    expect(destinationForRole("TEACHER")).toBe("/teacher");
  });

  it("shows accessible student and teacher tabs with identity-code guidance", () => {
    render(<EntryForm />);

    const studentTab = screen.getByRole("tab", { name: "学生" });
    const teacherTab = screen.getByRole("tab", { name: "教师" });
    expect(studentTab).toHaveAttribute("aria-selected", "true");
    expect(studentTab).toHaveAttribute("tabindex", "0");
    expect(teacherTab).toHaveAttribute("tabindex", "-1");
    expect(screen.getByLabelText("班级邀请码")).toBeInTheDocument();
    expect(screen.getByLabelText("匿名编号")).toHaveAttribute(
      "placeholder",
      "例如：7K9M-2Q4R-P8TX",
    );
    expect(screen.getByLabelText("匿名编号")).toHaveAttribute("pattern", "[A-Za-z0-9\\-]+");
    expect(screen.getByText(/教师分发的 12–32 位高熵学习身份码/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "教师" }));

    expect(screen.getByRole("tab", { name: "教师" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("教师访问码")).toBeInTheDocument();
    expect(screen.getByLabelText("教师访问码")).toHaveAttribute(
      "autocomplete",
      "one-time-code",
    );
  });

  it("supports arrow, Home, and End keyboard navigation between tabs", () => {
    render(<EntryForm />);
    const studentTab = screen.getByRole("tab", { name: "学生" });
    const teacherTab = screen.getByRole("tab", { name: "教师" });
    studentTab.focus();

    fireEvent.keyDown(studentTab, { key: "ArrowRight" });
    expect(teacherTab).toHaveFocus();
    expect(teacherTab).toHaveAttribute("aria-selected", "true");
    expect(teacherTab).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(teacherTab, { key: "Home" });
    expect(studentTab).toHaveFocus();
    expect(studentTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(studentTab, { key: "End" });
    expect(teacherTab).toHaveFocus();
    fireEvent.keyDown(teacherTab, { key: "ArrowLeft" });
    expect(studentTab).toHaveFocus();
  });

  it("fills the starter demo that begins at the diagnostic step", () => {
    render(<EntryForm />);
    fireEvent.click(screen.getByRole("button", { name: /填入可学习的演示账号/ }));
    expect(screen.getByLabelText("班级邀请码")).toHaveValue("DIGI2026");
    expect(screen.getByLabelText("匿名编号")).toHaveValue("4P6R-8T2W-Y5BC");
  });

  it("disables submission while a request is pending", async () => {
    const navigate = vi.fn();
    let resolveRequest!: (response: Response) => void;
    const pendingRequest = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => pendingRequest));
    render(<EntryForm navigate={navigate} />);
    fireEvent.change(screen.getByLabelText("班级邀请码"), {
      target: { value: "CLASS001" },
    });
    fireEvent.change(screen.getByLabelText("匿名编号"), {
      target: { value: "7K9M-2Q4R-P8TX" },
    });

    fireEvent.click(screen.getByRole("button", { name: "学生进入" }));

    expect(screen.getByRole("button", { name: "正在进入…" })).toBeDisabled();
    await act(async () => resolveRequest(successfulResponse()));
    expect(navigate).toHaveBeenCalledWith("/student");
  });

  it("shows an inline server error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false, error: "班级邀请码无效" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(<EntryForm navigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("班级邀请码"), {
      target: { value: "WRONG" },
    });
    fireEvent.change(screen.getByLabelText("匿名编号"), {
      target: { value: "7K9M-2Q4R-P8TX" },
    });

    fireEvent.click(screen.getByRole("button", { name: "学生进入" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("班级邀请码无效");
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it("navigates to the teacher destination after successful entry", async () => {
    const navigate = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => successfulResponse()));
    render(<EntryForm navigate={navigate} />);
    fireEvent.click(screen.getByRole("tab", { name: "教师" }));
    fireEvent.change(screen.getByLabelText("教师访问码"), {
      target: { value: "private-teacher-code" },
    });

    fireEvent.click(screen.getByRole("button", { name: "教师进入" }));

    await expect.poll(() => navigate.mock.calls).toEqual([["/teacher"]]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/teacher",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns a student to the requested assistant-lab page after login", async () => {
    const navigate = vi.fn();
    window.history.replaceState({}, "", "/?returnTo=%2Fassistant-lab");
    vi.stubGlobal("fetch", vi.fn(async () => successfulResponse()));
    render(<EntryForm navigate={navigate} />);
    fireEvent.change(screen.getByLabelText("班级邀请码"), {
      target: { value: "CLASS001" },
    });
    fireEvent.change(screen.getByLabelText("匿名编号"), {
      target: { value: "7K9M-2Q4R-P8TX" },
    });

    fireEvent.click(screen.getByRole("button", { name: "学生进入" }));

    await expect.poll(() => navigate.mock.calls).toEqual([["/assistant-lab"]]);
  });
});
