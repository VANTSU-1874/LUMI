import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDesignTasks } from "@/components/student/use-design-tasks";
import type { DesignTask } from "@/lib/agent/design-project-task";

afterEach(() => { cleanup(); window.localStorage.clear(); });

const first: DesignTask = { id: "11111111-1111-4111-8111-111111111111", title: "展览海报", status: "ACTIVE", mode: "conversation", pinned: false, createdAt: "2026-07-16T08:00:00.000Z", updatedAt: "2026-07-16T08:00:00.000Z" };
const second: DesignTask = { id: "22222222-2222-4222-8222-222222222222", title: "儿童座椅", status: "ACTIVE", mode: "conversation", pinned: false, createdAt: "2026-07-16T07:00:00.000Z", updatedAt: "2026-07-16T07:00:00.000Z" };

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("useDesignTasks", () => {
  it("restores tasks and moves to the next active task after archiving the current one", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/agent/tasks" && !init?.method) return response({ tasks: [first, second] });
      if (url === `/api/agent/tasks/${first.id}` && init?.method === "PATCH") {
        return response({ ...first, status: "ARCHIVED", updatedAt: "2026-07-16T09:00:00.000Z" });
      }
      throw new Error(`unexpected ${url}`);
    });
    const { result } = renderHook(() => useDesignTasks(fetchImpl as typeof fetch));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activeTaskId).toBe(first.id);

    await act(async () => { await result.current.updateTask(first.id, { status: "ARCHIVED" }); });
    expect(result.current.activeTaskId).toBe(second.id);
    expect(result.current.tasks.find(({ id }) => id === first.id)?.status).toBe("ARCHIVED");
  });

  it("restores the last selected task after a browser refresh", async () => {
    window.localStorage.setItem("chuying-active-design-task", second.id);
    const fetchImpl = vi.fn(async () => response({ tasks: [first, second] }));
    const { result } = renderHook(() => useDesignTasks(fetchImpl as typeof fetch));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.activeTaskId).toBe(second.id);
  });
});
