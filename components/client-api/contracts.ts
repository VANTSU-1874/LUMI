export const mockEndpointGroups = [
  "auth-student",
  "auth-teacher",
  "agent-tasks",
  "agent-conversation",
  "agent-runs",
  "agent-events",
  "artwork",
  "critique",
  "courses",
  "student-dashboard",
  "teacher-config",
  "teacher-insights",
] as const;

export type MockEndpointGroup = (typeof mockEndpointGroups)[number];

export type ApiFailure = {
  error: string;
  code?: string;
  details?: unknown;
};

export type AuthSuccess = { ok: true };

export type StudentAuthRequest = {
  classCode: string;
  alias: string;
};

export type TeacherAuthRequest = { code: string };

export type DesignTask = ServerDesignTask;
export type AgentView = ServerAgentView;
export type AgentRunStatus = ServerAgentRunStatus;
export type AgentTurnRequest = ServerAgentTurnRequest;

export const critiqueDimensionIds = SERVER_CRITIQUE_DIMENSION_IDS;

export type CritiqueDimensionId = ServerCritiqueDimensionId;
export type CritiqueEvidence = ServerCritiqueEvidence;
export type CritiqueDimension = ServerCritiqueDimension;
export type CritiqueClosure = ServerCritiqueClosure;
export type CritiqueResult = ServerCritiqueResult;

export type AgentTurnResult = ServerAgentTurnResponse & { critique?: CritiqueResult };
export type AgentRun = Omit<ServerAgentRun, "result"> & { result: AgentTurnResult | null };
export type AgentRunEvent = ServerAgentRunEvent;
export type AgentConversationResponse = Omit<ServerAgentConversationResponse, "turns"> & {
  turns: AgentTurnResult[];
};

export type AgentRunCreateResponse = {
  run: AgentRun;
  created: boolean;
  nextEventSequence: number;
};

export type AgentRunCurrentResponse = {
  run: AgentRun | null;
  nextEventSequence: number;
};

export type AgentRunEventsResponse = {
  runId: string;
  events: AgentRunEvent[];
  nextEventSequence: number;
};

export type CourseSummary = {
  id: string;
  label: string;
  description: string;
  version: string;
  status: "READY" | "DRAFT";
  capabilities: Array<"DIALOGUE" | "ARTWORK_CRITIQUE" | "SOFTWARE_TROUBLESHOOTING">;
};

export type CourseRegistryResponse = {
  currentCourseId: string;
  courses: CourseSummary[];
};

export type CourseSwitchRequest = { courseId: string };

export type CourseSwitchResponse = {
  currentCourseId: string;
  course: CourseSummary;
};

export type TeacherResource = {
  id: string;
  courseId: string;
  title: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  status: "UPLOADING" | "INDEXING" | "READY" | "FAILED";
  createdAt: string;
  error?: string;
};

export type TeacherResourceListResponse = { resources: TeacherResource[] };

export type TeacherInsight = {
  id: string;
  kind: "COMMON_DIFFICULTY" | "RETEACH_SUGGESTION";
  title: string;
  summary: string;
  evidenceCount: number;
  affectedLearners: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

export type TeacherInsightsResponse = {
  courseId: string;
  classId: string | null;
  generatedAt: string;
  dataScope: "REAL_ONLY" | "DEMONSTRATION_ONLY";
  insights: TeacherInsight[];
};

export type UploadProgress = {
  phase: "IDLE" | "READING" | "UPLOADING" | "PROCESSING" | "COMPLETE" | "FAILED";
  percent: number;
  /** True when the browser cannot calculate a byte total; callers must not display percent as measured. */
  indeterminate?: boolean;
  message: string;
};
import type {
  AgentConversationResponse as ServerAgentConversationResponse,
  AgentTurnRequest as ServerAgentTurnRequest,
  AgentTurnResponse as ServerAgentTurnResponse,
  AgentView as ServerAgentView,
} from "@/lib/agent/contracts";
import type { DesignTask as ServerDesignTask } from "@/lib/agent/design-project-task-contract";
import type {
  AgentRun as ServerAgentRun,
  AgentRunEvent as ServerAgentRunEvent,
  AgentRunStatus as ServerAgentRunStatus,
} from "@/lib/agent/runtime/agent-run-event";
import {
  CRITIQUE_DIMENSION_IDS as SERVER_CRITIQUE_DIMENSION_IDS,
  type CritiqueClosure as ServerCritiqueClosure,
  type CritiqueDimension as ServerCritiqueDimension,
  type CritiqueDimensionId as ServerCritiqueDimensionId,
  type CritiqueEvidence as ServerCritiqueEvidence,
  type CritiqueResult as ServerCritiqueResult,
} from "@/lib/agent/critique-contract";
