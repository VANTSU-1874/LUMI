import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantLabSectionView } from "@/components/assistant-lab/AssistantLabSections";
import type { DesignTask } from "@/lib/agent/design-project-task-contract";
import type { StudentProject, StudentProjectDetail } from "@/lib/agent/student-project-contract";

const task: DesignTask = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "展览海报",
  status: "ACTIVE",
  mode: "conversation",
  pinned: false,
  createdAt: "2026-08-17T06:00:00.000Z",
  updatedAt: "2026-08-17T06:00:00.000Z",
};
const project: StudentProject = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "毕业展项目",
  icon: "folder",
  color: "emerald",
  instructions: "保持展览视觉一致",
  memoryMode: "PROJECT_ONLY",
  status: "ACTIVE",
  threadCount: 1,
  fileCount: 0,
  createdAt: "2026-08-17T06:00:00.000Z",
  updatedAt: "2026-08-17T06:00:00.000Z",
};
const detail: StudentProjectDetail = { project, threads: [task] };

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Lumi student library and projects", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders real private assets with project, source, download and delete controls", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/agent/library" && !init?.method) return json({ assets: [{
        id: "22222222-2222-4222-8222-222222222222",
        source: "DIRECT_UPLOAD",
        fileName: "版式草图.png",
        mimeType: "image/png",
        byteSize: 1200,
        width: 800,
        height: 600,
        createdAt: "2026-08-17T06:00:00.000Z",
        project: { id: task.id, title: task.title },
        previewUrl: "/api/agent/library/22222222-2222-4222-8222-222222222222/content",
        downloadUrl: "/api/agent/library/22222222-2222-4222-8222-222222222222/content?download=1",
        canDelete: true,
      }] });
      if (url.includes("/api/agent/library/22222222") && init?.method === "DELETE") {
        return json({ deleted: "22222222-2222-4222-8222-222222222222" });
      }
      return json({ error: "unexpected" }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <AssistantLabSectionView
        activeProjectId={task.id}
        onBackToChat={vi.fn()}
        onOpenProject={vi.fn()}
        section="library"
      />,
    );

    expect(await screen.findByText("版式草图.png")).toBeInTheDocument();
    expect(screen.getAllByText("独立上传")).toHaveLength(2);
    expect(screen.getByText("展览海报")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载 版式草图.png" })).toHaveAttribute("href", expect.stringContaining("download=1"));
    fireEvent.click(screen.getByRole("button", { name: "删除 版式草图.png" }));
    await waitFor(() => expect(screen.queryByText("版式草图.png")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/agent/library/22222222"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("lists real project containers and opens one of their persisted conversations", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/agent/projects") return json({ projects: [project] });
      if (String(input) === `/api/agent/projects/${project.id}`) return json(detail);
      if (String(input) === "/api/agent/tasks") return json({ tasks: [task] });
      if (String(input) === "/api/agent/library") return json({ assets: [] });
      return json({ error: "unexpected" }, 500);
    });
    const onOpenProject = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AssistantLabSectionView
        activeProjectId={null}
        onBackToChat={vi.fn()}
        onOpenProject={onOpenProject}
        section="projects"
      />,
    );

    expect(await screen.findByText("毕业展项目")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开" }));
    expect(await screen.findByText("保持展览视觉一致")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /展览海报/ }));
    expect(onOpenProject).toHaveBeenCalledWith(task);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent/projects",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });
});
