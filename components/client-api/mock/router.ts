import type {
  AgentConversationResponse,
  AgentRun,
  AgentRunCreateResponse,
  AgentRunEvent,
  AgentRunEventsResponse,
  AgentTurnRequest,
  DesignTask,
  TeacherResource,
} from "../contracts";
import { AgentTurnRequestSchema } from "@/lib/agent/contracts";
import {
  AgentRunCreateResponseSchema,
  AgentRunEventsResponseSchema,
} from "@/lib/agent/runtime/agent-run-event";
import {
  createMockTurn,
  mockConversationTurns,
  mockCourses,
  mockCritiquesByTurn,
  mockTasks,
  mockTeacherInsights,
  mockTeacherResources,
  MOCK_ARTWORK_ID,
  MOCK_NOW,
  MOCK_TASK_ID,
} from "./fixtures";

type StoredRun = {
  run: AgentRun;
  request: AgentTurnRequest;
  createdAtMs: number;
  hasArtwork: boolean;
  courseId: string;
  artworkId: string;
  idempotencyKey: string;
};

function cloneDemo<T>(value: T): T {
  return structuredClone(value);
}

const runs = new Map<string, StoredRun>();
const turns: AgentConversationResponse["turns"] = cloneDemo(mockConversationTurns);
const critiques = new Map<string, NonNullable<AgentConversationResponse["turns"][number]["critique"]>>(
  mockCritiquesByTurn.map(({ turnId, critique }) => [turnId, cloneDemo(critique)]),
);
const tasks: DesignTask[] = cloneDemo(mockTasks);
const resources: TeacherResource[] = cloneDemo(mockTeacherResources.resources);
let currentCourseId = mockCourses.currentCourseId;

function uuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function json(payload: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-lumi-data-type", "DEMONSTRATION_DATA");
  return new Response(JSON.stringify(payload), { ...init, headers });
}

function failure(status: number, error: string, code = "MOCK_REQUEST_FAILED") {
  return json({ error, code }, { status });
}

function mockUrl(input: RequestInfo | URL) {
  const value = input instanceof Request ? input.url : String(input);
  return new URL(value, "http://lumi.mock");
}

function methodOf(input: RequestInfo | URL, init?: RequestInit) {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

function headerOf(input: RequestInfo | URL, init: RequestInit | undefined, name: string) {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  return headers.get(name);
}

async function bodyOf(input: RequestInfo | URL, init?: RequestInit) {
  const body = init?.body ?? (input instanceof Request ? await input.clone().blob() : null);
  if (!body) return null;
  if (body instanceof FormData) {
    const payload = body.get("payload");
    return {
      payload: typeof payload === "string" ? JSON.parse(payload) as unknown : null,
      artwork: body.get("artwork"),
      file: body.get("file"),
      title: body.get("title"),
      courseId: body.get("courseId"),
    };
  }
  if (typeof body === "string") return JSON.parse(body) as unknown;
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  if (body instanceof Blob) return JSON.parse(await body.text()) as unknown;
  return body;
}

function requestFromBody(raw: unknown): { request: AgentTurnRequest; hasArtwork: boolean } {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const payload = record.payload && typeof record.payload === "object"
    ? record.payload as Record<string, unknown>
    : record;
  const context = payload.context && typeof payload.context === "object"
    ? payload.context as AgentTurnRequest["context"]
    : { view: "AGENT" as const };
  return {
    request: AgentTurnRequestSchema.parse({
      taskId: typeof payload.taskId === "string" ? payload.taskId : MOCK_TASK_ID,
      message: typeof payload.message === "string" ? payload.message : "请帮我看看这份作品方案。",
      context,
    }),
    hasArtwork: Boolean(record.artwork),
  };
}

function stripCritique(result: AgentConversationResponse["turns"][number]) {
  const turn = { ...result };
  delete turn.critique;
  return turn;
}

function materialize(stored: StoredRun, now = Date.now()) {
  const elapsed = now - stored.createdAtMs;
  const next: AgentRun = { ...stored.run };
  if (elapsed >= 2_600) {
    const result = createMockTurn(stored.request, stored.run.id, {
      hasArtwork: stored.hasArtwork,
      courseId: stored.courseId,
      artworkId: stored.artworkId,
    });
    next.status = "COMPLETED";
    next.result = result;
    next.checkpoint = { stage: "COMPLETED", turnId: result.turnId };
    next.startedAt = next.startedAt ?? next.createdAt;
    next.completedAt = new Date(stored.createdAtMs + 2_600).toISOString();
    next.updatedAt = next.completedAt;
    if (!turns.some((turn) => turn.turnId === result.turnId)) turns.push(stripCritique(result));
    if (result.critique) critiques.set(result.turnId, result.critique);
  } else if (elapsed >= 550) {
    next.status = "RUNNING";
    next.checkpoint = { stage: "CLAIMED" };
    next.startedAt = new Date(stored.createdAtMs + 550).toISOString();
    next.updatedAt = next.startedAt;
  }
  stored.run = next;
  return next;
}

function eventsFor(stored: StoredRun, after: number): AgentRunEventsResponse {
  const run = materialize(stored);
  const all: AgentRunEvent[] = [
    {
      id: `${run.id.slice(0, -1)}1`,
      runId: run.id,
      sequence: 1,
      kind: "RUN_CREATED",
      label: "已收到问题",
      summary: "演示请求已进入队列。",
      payload: { status: "QUEUED" },
      createdAt: run.createdAt,
    },
  ];
  if (run.status !== "QUEUED") {
    all.push({
      id: `${run.id.slice(0, -1)}2`,
      runId: run.id,
      sequence: 2,
      kind: "STEP",
      label: "正在理解作品与意图",
      summary: "只依据本轮可见内容与学生自述整理判断。",
      payload: { status: "RUNNING", stepKind: "MODEL" },
      createdAt: run.startedAt ?? run.createdAt,
    });
  }
  if (run.status === "COMPLETED") {
    all.push(
      {
        id: `${run.id.slice(0, -1)}3`,
        runId: run.id,
        sequence: 3,
        kind: "TOKEN",
        label: "导师回复",
        summary: "先确认最影响目标的一处。",
        payload: { text: run.result?.reply.message ?? "会诊完成。" },
        createdAt: run.completedAt ?? run.updatedAt,
      },
      {
        id: `${run.id.slice(0, -1)}4`,
        runId: run.id,
        sequence: 4,
        kind: "COMPLETION",
        label: "本轮完成",
        summary: "回答与会诊结果已保存。",
        payload: { status: "COMPLETED" },
        createdAt: run.completedAt ?? run.updatedAt,
      },
    );
  }
  const selected = all.filter((event) => event.sequence > after);
  return AgentRunEventsResponseSchema.parse({
    runId: run.id,
    events: selected,
    nextEventSequence: (selected.at(-1)?.sequence ?? after) + 1,
  }) as AgentRunEventsResponse;
}

function currentRun(taskId: string | null) {
  return [...runs.values()]
    .filter((stored) => !taskId || stored.run.taskId === taskId)
    .sort((left, right) => right.createdAtMs - left.createdAtMs)
    .map((stored) => materialize(stored))
    .find((run) => run.status !== "COMPLETED") ?? null;
}

function studentDashboard() {
  return {
    snapshotVersion: "a".repeat(64),
    updatedAt: MOCK_NOW,
    aiMode: "MODEL_ASSISTED",
    dataType: "DEMONSTRATION_DATA",
    student: { alias: "演示同学 07", dataType: "DEMONSTRATION_DATA" },
    profile: null,
    course: { totalHours: 0, modules: [] },
    assignment: null,
    project: null,
    logicCard: null,
    toolPath: null,
    evidence: { total: 0, verified: 0, recent: [] },
    troubleshooting: null,
    hints: { count: 0, latestLevel: null, latestAt: null },
    latestHint: null,
    transfer: null,
  };
}

export async function mockApiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = mockUrl(input);
  const path = url.pathname;
  const method = methodOf(input, init);

  if (init?.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");

  if (path === "/api/auth/student" && method === "POST") return json({ ok: true });
  if (path === "/api/auth/teacher" && method === "POST") return json({ ok: true });

  if (path === "/api/agent/tasks" && method === "GET") return json({ tasks });
  if (path === "/api/agent/tasks" && method === "POST") {
    const raw = await bodyOf(input, init) as { title?: string } | null;
    const now = new Date().toISOString();
    const task: DesignTask = {
      id: uuid(),
      title: raw?.title?.trim() || "新的设计对话（演示数据）",
      status: "ACTIVE",
      mode: "conversation",
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    tasks.unshift(task);
    return json(task, { status: 201 });
  }
  const taskMatch = path.match(/^\/api\/agent\/tasks\/([^/]+)$/);
  if (taskMatch && method === "PATCH") {
    const task = tasks.find((item) => item.id === decodeURIComponent(taskMatch[1]!));
    if (!task) return failure(404, "设计任务不存在", "TASK_NOT_FOUND");
    const update = await bodyOf(input, init) as Partial<Pick<DesignTask, "title" | "status">>;
    if (update.title) task.title = update.title;
    if (update.status) task.status = update.status;
    task.updatedAt = new Date().toISOString();
    return json(task);
  }

  if (path === "/api/agent/conversation" && method === "GET") {
    const taskId = url.searchParams.get("taskId") ?? MOCK_TASK_ID;
    const course = mockCourses.courses.find((item) => item.id === currentCourseId) ?? mockCourses.courses[0]!;
    const selectedTurns = turns.filter((turn) => turn.taskId === taskId);
    return json({
      taskId,
      conversationId: selectedTurns[0]?.conversationId ?? null,
      coursePack: {
        id: course.id,
        version: course.version,
        label: course.label,
      },
      turns: selectedTurns,
      features: { externalSearch: false },
    } satisfies AgentConversationResponse);
  }

  if (path === "/api/agent/runs" && method === "GET") {
    return json({ run: currentRun(url.searchParams.get("taskId")), nextEventSequence: 1 });
  }
  if (path === "/api/agent/runs" && method === "POST") {
    const idempotencyKey = headerOf(input, init, "idempotency-key")?.trim() || uuid();
    const existing = [...runs.values()].find((stored) => stored.idempotencyKey === idempotencyKey);
    if (existing) {
      const run = materialize(existing);
      const response = AgentRunCreateResponseSchema.parse({
        run: run.result ? { ...run, result: stripCritique(run.result) } : run,
        created: false,
        nextEventSequence: eventsFor(existing, 0).nextEventSequence,
      });
      return json({ ...response, run }, {
        status: run.status === "COMPLETED" ? 200 : 202,
        headers: { Location: `/api/agent/runs/${run.id}` },
      });
    }
    const { request, hasArtwork } = requestFromBody(await bodyOf(input, init));
    const runId = uuid();
    const now = new Date();
    const run: AgentRun = {
      id: runId,
      taskId: request.taskId ?? MOCK_TASK_ID,
      request,
      status: "QUEUED",
      runtime: { id: "lumi-mock-runtime", version: "1.0.0" },
      attempt: 0,
      checkpoint: { stage: "CREATED" },
      result: null,
      lastErrorCode: null,
      cancelRequestedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      startedAt: null,
      completedAt: null,
    };
    runs.set(runId, {
      run,
      request,
      createdAtMs: now.getTime(),
      hasArtwork,
      courseId: currentCourseId,
      artworkId: hasArtwork ? runId : MOCK_ARTWORK_ID,
      idempotencyKey,
    });
    const response = AgentRunCreateResponseSchema.parse({ run, created: true, nextEventSequence: 1 });
    return json(response satisfies AgentRunCreateResponse, {
      status: 202,
      headers: { Location: `/api/agent/runs/${run.id}` },
    });
  }

  const runMatch = path.match(/^\/api\/agent\/runs\/([^/]+)$/);
  if (runMatch && method === "GET") {
    const stored = runs.get(runMatch[1]!);
    return stored ? json({ run: materialize(stored) }) : failure(404, "运行不存在", "RUN_NOT_FOUND");
  }
  const eventsMatch = path.match(/^\/api\/agent\/runs\/([^/]+)\/events$/);
  if (eventsMatch && method === "GET") {
    const stored = runs.get(eventsMatch[1]!);
    if (!stored) return failure(404, "运行不存在", "RUN_NOT_FOUND");
    return json(eventsFor(stored, Number(url.searchParams.get("after") ?? 0)));
  }
  const controlMatch = path.match(/^\/api\/agent\/runs\/([^/]+)\/(cancel|retry)$/);
  if (controlMatch && method === "POST") {
    const stored = runs.get(controlMatch[1]!);
    if (!stored) return failure(404, "运行不存在", "RUN_NOT_FOUND");
    if (controlMatch[2] === "cancel") {
      stored.run = {
        ...stored.run,
        status: "CANCELLED",
        checkpoint: { stage: "CANCELLED" },
        cancelRequestedAt: new Date().toISOString(),
      };
      return json({ run: stored.run, alreadyApplied: false, abortRequested: true });
    }
    stored.createdAtMs = Date.now();
    stored.run = { ...stored.run, status: "QUEUED", attempt: stored.run.attempt + 1, result: null };
    return json({ run: stored.run, alreadyApplied: false });
  }

  const critiqueMatch = path.match(/^\/api\/agent\/turns\/([^/]+)\/critique$/);
  if (critiqueMatch && method === "GET") {
    const turnId = decodeURIComponent(critiqueMatch[1]!);
    const critique = critiques.get(turnId);
    return critique
      ? json({ critique })
      : failure(404, "本轮没有会诊记录", "CRITIQUE_NOT_FOUND");
  }

  if (path === "/api/courses" && method === "GET") {
    return json({ ...mockCourses, currentCourseId });
  }
  if (path === "/api/courses/switch" && method === "POST") {
    const raw = await bodyOf(input, init) as { courseId?: string } | null;
    const course = mockCourses.courses.find((item) => item.id === raw?.courseId);
    if (!course) return failure(404, "课程不存在", "COURSE_NOT_FOUND");
    currentCourseId = course.id;
    return json({ currentCourseId, course });
  }

  if (path === "/api/teacher/config/resources" && method === "GET") return json({ resources });
  if (path === "/api/teacher/config/resources" && method === "POST") {
    const raw = await bodyOf(input, init) as Record<string, unknown>;
    const file = raw.file instanceof File ? raw.file : null;
    if (!file) return failure(400, "请选择资料文件", "FILE_REQUIRED");
    const resource: TeacherResource = {
      id: uuid(),
      courseId: typeof raw.courseId === "string" ? raw.courseId : currentCourseId,
      title: typeof raw.title === "string" && raw.title ? raw.title : file.name,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      byteSize: file.size,
      status: "READY",
      createdAt: new Date().toISOString(),
    };
    resources.unshift(resource);
    return json({ resource }, { status: 201 });
  }
  const resourceMatch = path.match(/^\/api\/teacher\/config\/resources\/([^/]+)$/);
  if (resourceMatch && method === "DELETE") {
    const index = resources.findIndex((resource) => resource.id === resourceMatch[1]);
    if (index < 0) return failure(404, "资料不存在", "RESOURCE_NOT_FOUND");
    const [deleted] = resources.splice(index, 1);
    return json({ deleted: true, id: deleted!.id });
  }

  if (path === "/api/teacher/insights" && method === "GET") {
    const courseId = url.searchParams.get("courseId") ?? mockTeacherInsights.courseId;
    const classId = url.searchParams.get("classId") ?? mockTeacherInsights.classId;
    const matchesStoryline = courseId === mockTeacherInsights.courseId
      && classId === mockTeacherInsights.classId;
    return json({
      ...mockTeacherInsights,
      courseId,
      classId,
      insights: matchesStoryline ? mockTeacherInsights.insights : [],
    });
  }
  if (path === "/api/teacher/dashboard" && method === "GET") {
    return json({
      aiMode: "MODEL_ASSISTED",
      classes: [],
      classesMeta: { total: 0, returned: 0, truncated: false },
    });
  }
  if (path === "/api/student/dashboard" && method === "GET") return json(studentDashboard());

  if (path.startsWith("/api/agent/artworks/") && method === "GET") {
    const bytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2,
      0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 252, 255, 31, 0, 3,
      3, 2, 0, 239, 191, 111, 181, 0, 0, 0, 0, 73, 69, 78, 68, 174,
      66, 96, 130,
    ]);
    return new Response(bytes.buffer, {
      headers: {
        "content-type": "image/png",
        "content-length": String(bytes.byteLength),
        "x-lumi-data-type": "DEMONSTRATION_DATA",
      },
    });
  }

  return failure(501, `mock 尚未实现 ${method} ${path}`, "MOCK_ENDPOINT_NOT_IMPLEMENTED");
}

export function resetMockApiState() {
  runs.clear();
  turns.splice(0, turns.length, ...cloneDemo(mockConversationTurns));
  critiques.clear();
  mockCritiquesByTurn.forEach(({ turnId, critique }) => critiques.set(turnId, cloneDemo(critique)));
  tasks.splice(0, tasks.length, ...cloneDemo(mockTasks));
  resources.splice(0, resources.length, ...cloneDemo(mockTeacherResources.resources));
  currentCourseId = mockCourses.currentCourseId;
}
