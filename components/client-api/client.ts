import type {
  AgentConversationResponse,
  AgentRun,
  AgentRunCreateResponse,
  AgentRunCurrentResponse,
  AgentRunEventsResponse,
  AgentRunInterventionCreateResponse,
  AgentRunInterventionListResponse,
  AgentRunInterventionRequest,
  AgentTurnRequest,
  AgentMessageListResponse,
  AuthSuccess,
  CourseRegistryResponse,
  CourseSwitchResponse,
  CritiqueResult,
  DesignTask,
  StudentAuthRequest,
  TeacherAuthRequest,
  TeacherInsightsResponse,
  TeacherResourceListResponse,
} from "./contracts";
import { createLumiFetch, jsonOrThrow, type LumiFetchOptions } from "./request";

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export function createClientApi(options: LumiFetchOptions = {}) {
  const fetcher = createLumiFetch(options);
  return {
    fetch: fetcher,
    enterStudent: (input: StudentAuthRequest) =>
      fetcher("/api/auth/student", jsonInit("POST", input)).then(jsonOrThrow<AuthSuccess>),
    enterTeacher: (input: TeacherAuthRequest) =>
      fetcher("/api/auth/teacher", jsonInit("POST", input)).then(jsonOrThrow<AuthSuccess>),
    listTasks: () =>
      fetcher("/api/agent/tasks", { headers: { accept: "application/json" } })
        .then(jsonOrThrow<{ tasks: DesignTask[] }>),
    createTask: (title?: string) =>
      fetcher("/api/agent/tasks", jsonInit("POST", title ? { title } : {})).then(jsonOrThrow<DesignTask>),
    updateTask: (taskId: string, update: Partial<Pick<DesignTask, "title" | "status">>) =>
      fetcher(`/api/agent/tasks/${encodeURIComponent(taskId)}`, jsonInit("PATCH", update)).then(jsonOrThrow<DesignTask>),
    conversation: (taskId?: string, view = "AGENT") => {
      const query = new URLSearchParams({ view });
      if (taskId) query.set("taskId", taskId);
      return fetcher(`/api/agent/conversation?${query}`, { headers: { accept: "application/json" } })
        .then(jsonOrThrow<AgentConversationResponse>);
    },
    currentRun: (taskId?: string) => {
      const query = new URLSearchParams();
      if (taskId) query.set("taskId", taskId);
      const suffix = query.size ? `?${query}` : "";
      return fetcher(`/api/agent/runs${suffix}`, { headers: { accept: "application/json" } })
        .then(jsonOrThrow<AgentRunCurrentResponse>);
    },
    createRun: (request: AgentTurnRequest, idempotencyKey: string) =>
      fetcher("/api/agent/runs", {
        ...jsonInit("POST", request),
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "idempotency-key": idempotencyKey,
        },
      }).then(jsonOrThrow<AgentRunCreateResponse>),
    getRun: (runId: string) =>
      fetcher(`/api/agent/runs/${encodeURIComponent(runId)}`, { headers: { accept: "application/json" } })
        .then(jsonOrThrow<{ run: AgentRun }>),
    getEvents: (runId: string, after = 0) =>
      fetcher(`/api/agent/runs/${encodeURIComponent(runId)}/events?after=${after}&limit=100`, {
        headers: { accept: "application/json" },
      }).then(jsonOrThrow<AgentRunEventsResponse>),
    listRunInterventions: (runId: string) =>
      fetcher(`/api/agent/runs/${encodeURIComponent(runId)}/interventions`, {
        headers: { accept: "application/json" },
      }).then(jsonOrThrow<AgentRunInterventionListResponse>),
    createRunIntervention: (
      runId: string,
      request: AgentRunInterventionRequest,
      idempotencyKey: string,
    ) => fetcher(`/api/agent/runs/${encodeURIComponent(runId)}/interventions`, {
      ...jsonInit("POST", request),
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "idempotency-key": idempotencyKey,
      },
    }).then(jsonOrThrow<AgentRunInterventionCreateResponse>),
    listMessages: (taskId: string) =>
      fetcher(`/api/agent/tasks/${encodeURIComponent(taskId)}/messages`, {
        headers: { accept: "application/json" },
      }).then(jsonOrThrow<AgentMessageListResponse>),
    cancelRun: (runId: string, idempotencyKey: string) =>
      fetcher(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, jsonInit("POST", { idempotencyKey }))
        .then(jsonOrThrow<{ run: AgentRun; alreadyApplied: boolean; abortRequested: boolean }>),
    retryRun: (runId: string, idempotencyKey: string) =>
      fetcher(`/api/agent/runs/${encodeURIComponent(runId)}/retry`, jsonInit("POST", { idempotencyKey }))
        .then(jsonOrThrow<{ run: AgentRun; alreadyApplied: boolean }>),
    resolveApproval: (
      runId: string,
      actionId: string,
      decision: "APPROVE" | "REJECT",
      idempotencyKey: string,
    ) => fetcher(
      `/api/agent/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(actionId)}`,
      jsonInit("POST", { decision, idempotencyKey }),
    ).then(jsonOrThrow<{
      run: AgentRun;
      action: {
        id: string;
        status: "EXECUTED" | "REJECTED";
        alreadyApplied: boolean;
        navigation: { target: string; focus: string | null } | null;
      };
    }>),
    getCritique: (turnId: string) =>
      fetcher(`/api/agent/turns/${encodeURIComponent(turnId)}/critique`, {
        headers: { accept: "application/json" },
      }).then(jsonOrThrow<{ critique: CritiqueResult }>),
    courses: () =>
      fetcher("/api/courses", { headers: { accept: "application/json" } })
        .then(jsonOrThrow<CourseRegistryResponse>),
    switchCourse: (courseId: string) =>
      fetcher("/api/courses/switch", jsonInit("POST", { courseId })).then(jsonOrThrow<CourseSwitchResponse>),
    teacherResources: () =>
      fetcher("/api/teacher/config/resources", { headers: { accept: "application/json" } })
        .then(jsonOrThrow<TeacherResourceListResponse>),
    deleteTeacherResource: (resourceId: string) =>
      fetcher(`/api/teacher/config/resources/${encodeURIComponent(resourceId)}`, { method: "DELETE" })
        .then(jsonOrThrow<{ deleted: true; id: string }>),
    teacherInsights: (courseId: string, classId?: string) => {
      const query = new URLSearchParams({ courseId });
      if (classId) query.set("classId", classId);
      return fetcher(`/api/teacher/insights?${query}`, { headers: { accept: "application/json" } })
        .then(jsonOrThrow<TeacherInsightsResponse>);
    },
  };
}

export type ClientApi = ReturnType<typeof createClientApi>;
