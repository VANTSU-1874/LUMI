import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApiFetch, resetMockApiState } from "@/components/client-api/mock/router";
import { DesignTaskListResponseSchema } from "@/lib/agent/design-project-task-contract";
import {
  AgentRunCreateResponseSchema,
  AgentRunEventsResponseSchema,
} from "@/lib/agent/runtime/agent-run-event";
import { LUMI_D017_STORYLINE } from "@/data/demo/lumi-d017";

const activeStoryTask = LUMI_D017_STORYLINE.tasks.find((task) => task.status === "ACTIVE")!;
const archivedStoryTask = LUMI_D017_STORYLINE.tasks.find((task) => task.status === "ARCHIVED")!;
const taskId = activeStoryTask.id;

function runRequest(idempotencyKey: string, body: BodyInit) {
  return mockApiFetch("/api/agent/runs", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body,
  });
}

async function d017Snapshot() {
  const tasks = await (await mockApiFetch("/api/agent/tasks")).json();
  const conversations = await Promise.all(LUMI_D017_STORYLINE.tasks.map(async (task) =>
    (await mockApiFetch(`/api/agent/conversation?taskId=${task.id}`)).json()));
  const critiques = await Promise.all(LUMI_D017_STORYLINE.critiques.map(async ({ turnId }) =>
    (await mockApiFetch(`/api/agent/turns/${turnId}/critique`)).json()));
  const insights = await (await mockApiFetch(
    `/api/teacher/insights?courseId=${LUMI_D017_STORYLINE.identity.courseId}&classId=${LUMI_D017_STORYLINE.identity.classId}`,
  )).json();
  return { tasks, conversations, critiques, insights };
}

describe("Lumi mock contract", () => {
  beforeEach(() => {
    resetMockApiState();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T02:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses canonical backend course identities and marks success, failure, and binary responses as demonstration data", async () => {
    const response = await mockApiFetch("/api/courses");
    const payload = await response.json() as {
      currentCourseId: string;
      courses: Array<{ id: string; version: string }>;
    };
    expect(response.headers.get("x-lumi-data-type")).toBe("DEMONSTRATION_DATA");
    expect(payload.currentCourseId).toBe("digital-interaction");
    expect(payload.courses.map(({ id, version }) => `${id}@${version}`)).toEqual([
      "digital-interaction@1",
      "book-design@1",
      "general-design@1",
    ]);

    const tasks = await (await mockApiFetch("/api/agent/tasks")).json();
    expect(DesignTaskListResponseSchema.safeParse(tasks).success).toBe(true);

    const insights = await (await mockApiFetch("/api/teacher/insights?courseId=digital-interaction")).json() as {
      dataScope: string;
      insights: Array<{ summary: string }>;
    };
    expect(insights.dataScope).toBe("DEMONSTRATION_ONLY");
    expect(JSON.stringify(insights)).not.toContain("真实学习记录");
    expect(JSON.stringify(insights)).toContain("预置学习记录");

    const jsonResponses = await Promise.all([
      mockApiFetch("/api/agent/tasks"),
      mockApiFetch(`/api/agent/conversation?taskId=${taskId}`),
      mockApiFetch(`/api/agent/turns/${LUMI_D017_STORYLINE.critiques[0].turnId}/critique`),
      mockApiFetch("/api/not-implemented"),
    ]);
    jsonResponses.forEach((item) => {
      expect(item.headers.get("x-lumi-data-type")).toBe("DEMONSTRATION_DATA");
      expect(item.headers.get("content-type")).toContain("application/json");
    });
  });

  it("hydrates the archived and active D-017 conversations without embedding critique sidecars", async () => {
    const taskPayload = await (await mockApiFetch("/api/agent/tasks")).json() as {
      tasks: Array<{ id: string; status: string }>;
    };
    expect(taskPayload.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: archivedStoryTask.id, status: "ARCHIVED" }),
      expect.objectContaining({ id: activeStoryTask.id, status: "ACTIVE" }),
    ]));

    for (const storyTask of LUMI_D017_STORYLINE.tasks) {
      const response = await mockApiFetch(`/api/agent/conversation?taskId=${storyTask.id}`);
      const payload = await response.json() as {
        taskId: string;
        conversationId: string | null;
        turns: Array<{ turnId: string; reply: { message: string }; critique?: unknown }>;
      };
      const storyTurns = LUMI_D017_STORYLINE.turns.filter((turn) => turn.taskId === storyTask.id);
      expect(payload.taskId).toBe(storyTask.id);
      expect(payload.conversationId).toBe(storyTurns[0]?.conversationId ?? null);
      expect(payload.turns.map(({ turnId }) => turnId)).toEqual(storyTurns.map(({ id }) => id));
      expect(payload.turns.map(({ reply }) => reply.message)).toEqual(storyTurns.map(({ assistantMessage }) => assistantMessage));
      expect(payload.turns.every((turn) => !("critique" in turn))).toBe(true);
    }
  });

  it("serves each D-017 critique by its own turn and rejects unknown turns", async () => {
    for (const storyCritique of LUMI_D017_STORYLINE.critiques) {
      const response = await mockApiFetch(`/api/agent/turns/${storyCritique.turnId}/critique`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        critique: {
          id: storyCritique.id,
          artworkId: storyCritique.artworkId,
          closure: storyCritique.closure,
        },
      });
    }

    const missing = await mockApiFetch("/api/agent/turns/ffffffff-ffff-4fff-8fff-ffffffffffff/critique");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "CRITIQUE_NOT_FOUND" });

    const activeConversation = await (await mockApiFetch(`/api/agent/conversation?taskId=${taskId}`)).json() as {
      turns: Array<{ reply: { message: string }; aiMode: string }>;
    };
    expect(activeConversation.turns.at(-1)?.reply.message).toBe(LUMI_D017_STORYLINE.turns.at(-1)?.assistantMessage);
    expect(activeConversation.turns.at(-1)?.aiMode).toBe(LUMI_D017_STORYLINE.turns.at(-1)?.aiMode);
  });

  it("returns 202 plus Location and reuses an idempotency key as a completed 200", async () => {
    const key = "90000000-0000-4000-8000-000000000001";
    const body = JSON.stringify({ taskId, message: "请帮我明确设计目标", context: { view: "AGENT" } });
    const first = await runRequest(key, body);
    const firstPayload = await first.json();
    expect(first.status).toBe(202);
    expect(first.headers.get("location")).toMatch(/^\/api\/agent\/runs\//);
    expect(AgentRunCreateResponseSchema.safeParse(firstPayload).success).toBe(true);

    const runId = (firstPayload as { run: { id: string } }).run.id;
    const eventPage = await (await mockApiFetch(`/api/agent/runs/${runId}/events?after=0`)).json();
    expect(AgentRunEventsResponseSchema.safeParse(eventPage).success).toBe(true);

    vi.advanceTimersByTime(2_700);
    const repeated = await runRequest(key, body);
    const repeatedPayload = await repeated.json() as { created: boolean; run: { id: string; status: string } };
    expect(repeated.status).toBe(200);
    expect(repeated.headers.get("location")).toBe(`/api/agent/runs/${runId}`);
    expect(repeatedPayload).toMatchObject({ created: false, run: { id: runId, status: "COMPLETED" } });
    expect(AgentRunCreateResponseSchema.safeParse(repeatedPayload).success).toBe(true);
  });

  it("keeps the natural reply primary and associates an optional critique with its artwork and course", async () => {
    const form = new FormData();
    form.set("payload", JSON.stringify({ taskId, message: "请看这份稿子", context: { view: "AGENT" } }));
    form.set("artwork", new File([new Uint8Array([137, 80, 78, 71])], "draft.png", { type: "image/png" }));
    const created = await runRequest("90000000-0000-4000-8000-000000000002", form);
    const runId = ((await created.json()) as { run: { id: string } }).run.id;

    vi.advanceTimersByTime(2_700);
    const runPayload = await (await mockApiFetch(`/api/agent/runs/${runId}`)).json() as {
      run: { result: { turnId: string; reply: { message: string }; coursePack: { id: string; version: string }; artworkAttachment: { id: string; previewUrl: string }; critique?: { courseId: string; artworkId: string } } };
    };
    const turn = runPayload.run.result;
    expect(turn.reply.message.length).toBeGreaterThan(0);
    expect(turn.coursePack).toMatchObject({ id: "digital-interaction", version: "1" });
    expect(turn.critique).toMatchObject({
      courseId: turn.coursePack.id,
      artworkId: turn.artworkAttachment.id,
    });
    expect(turn.artworkAttachment.previewUrl).toBe("/demo/digital-interaction-proposal-board-preset.svg");
    expect(turn.artworkAttachment.previewUrl).not.toMatch(/^\/api\/agent\/artworks\//);

    const critiqueResponse = await mockApiFetch(`/api/agent/turns/${turn.turnId}/critique`);
    expect(critiqueResponse.status).toBe(200);
    expect(await critiqueResponse.json()).toMatchObject({ critique: turn.critique });
  });

  it("serves artwork as an allowed raster MIME instead of SVG", async () => {
    const response = await mockApiFetch("/api/agent/artworks/50000000-0000-4000-8000-000000000001");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-lumi-data-type")).toBe("DEMONSTRATION_DATA");
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("deep-resets tasks, history, per-turn critiques, and canonical insight counts", async () => {
    const baseline = await d017Snapshot();
    await mockApiFetch(`/api/agent/tasks/${archivedStoryTask.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "被修改的标题", status: "ACTIVE" }),
    });

    const form = new FormData();
    form.set("payload", JSON.stringify({ taskId, message: "新增会诊", context: { view: "AGENT" } }));
    form.set("artwork", new File([new Uint8Array([137, 80, 78, 71])], "draft.png", { type: "image/png" }));
    const created = await runRequest("90000000-0000-4000-8000-000000000099", form);
    const runId = ((await created.json()) as { run: { id: string } }).run.id;
    vi.advanceTimersByTime(2_700);
    await mockApiFetch(`/api/agent/runs/${runId}`);
    expect((await mockApiFetch(`/api/agent/turns/${runId}/critique`)).status).toBe(200);
    const changedConversation = await (await mockApiFetch(`/api/agent/conversation?taskId=${taskId}`)).json() as {
      turns: Array<{ turnId: string; reply: { message: string }; critique?: unknown }>;
    };
    expect(changedConversation.turns.at(-1)).toMatchObject({ turnId: runId, reply: { message: expect.any(String) } });
    expect(changedConversation.turns.at(-1)).not.toHaveProperty("critique");

    resetMockApiState();
    expect((await mockApiFetch(`/api/agent/turns/${runId}/critique`)).status).toBe(404);
    expect(await d017Snapshot()).toEqual(baseline);
    expect((baseline.conversations as Array<{ turns: unknown[] }>).reduce((count, item) => count + item.turns.length, 0))
      .toBe(LUMI_D017_STORYLINE.turns.length);
    expect((baseline.critiques as unknown[]).length).toBe(LUMI_D017_STORYLINE.critiques.length);
    expect((baseline.insights as { insights: unknown[] }).insights.length).toBe(LUMI_D017_STORYLINE.classInsights.length);
  });
});
