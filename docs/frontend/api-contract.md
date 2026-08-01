# Lumi 前后端 API 契约

> 状态：F0 冻结版（2026-07-19）
>
> 适用范围：学生端、教师端、产品演示与后端重建轨道
>
> 规则：本文件是界面所需 HTTP 形状的唯一真源。改变字段或语义前先改本文，再分别实现前后端。

## 1. 契约边界

- `当前` 表示仓库内 `app/api/**` 已实现；类型以现有服务端 Zod schema 为运行时真源。
- `拟新增` 表示前端已经冻结形状、后端尚未实现；不得让正式页面把 mock 冒充真实能力。
- 除公开 catalog、health 与诊断题读取外，接口均依赖同源请求和 `HttpOnly` session cookie。
- JSON 错误必须按宽松形状读取：`{ error: string; ok?: false; code?: string }`。当前各路由并不完全统一。
- `204`、图片二进制、Markdown 下载和 SSE 不是 JSON，客户端不得无条件调用 `response.json()`。
- 演示数据必须显著标注，响应头使用 `x-lumi-data-type: DEMONSTRATION_DATA`；教师统计默认只看真实数据。

## 2. Mock 与实盘切换

前端统一入口位于 `components/client-api/`。正式环境默认走真实接口；本地可设置：

```dotenv
# 全部使用 mock
NEXT_PUBLIC_USE_MOCK=all

# 只替换尚未交付的端点，其他端点立即接实盘
NEXT_PUBLIC_USE_MOCK=critique,courses

# 全部实盘（默认）
NEXT_PUBLIC_USE_MOCK=none
```

可选端点组：

| 组 | 路径范围 |
| --- | --- |
| `auth-student` | `/api/auth/student` |
| `auth-teacher` | `/api/auth/teacher` |
| `agent-tasks` | `/api/agent/tasks*` |
| `agent-conversation` | `/api/agent/conversation` |
| `agent-runs` | `/api/agent/runs*`，事件与作品附件除外 |
| `agent-events` | `/api/agent/runs/:runId/events*` |
| `artwork` | `/api/agent/artworks/*` |
| `critique` | 会诊读取 |
| `courses` | 课程注册表与切换 |
| `student-dashboard` | 学生看板 |
| `teacher-config` | 教师资料配置台 |
| `teacher-insights` | 教师工作台与洞察台 |

为兼容 F0 配置，`agent` 是 `agent-tasks,agent-conversation,agent-runs,agent-events` 的别名，不包含作品与会诊。生产环境忽略 `NEXT_PUBLIC_USE_MOCK`，禁止用环境变量拼出半真半假的正式页面；只有地址参数 `?demo=1` 或代码显式的开发自检会强制使用 mock，且所有 mock 响应均带 `x-lumi-data-type: DEMONSTRATION_DATA`，界面必须显著显示“预置演示”。

`/dev/mock` 是仅开发环境可见的自检页；生产构建中访问该路径返回 404。mock 运行事件使用与真实端一致的递增 `sequence`，且覆盖排队、运行、`TOKEN` 与终态。

## 3. 当前接口总表

### 3.1 身份与 Agent

| 方法 | 路径 | 请求 | 成功响应 | 主要错误 | 状态 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/auth/student` | `{classCode, alias}` | `200 {ok:true}` + session cookie | 400/401/403/415/429/500 | 当前 |
| POST | `/api/auth/teacher` | `{code}` | `200 {ok:true}` + session cookie | 400/401/403/415/429/500 | 当前 |
| POST | `/api/agent/turn` | JSON 或 multipart `AgentTurnRequest` | `201 AgentTurnResponse` | 400/401/403/404/409/413/415/500 | 当前，兼容入口 |
| POST | `/api/agent/action` | `{turnId,actionId,idempotencyKey}` | `200 AgentActionExecution` | 400/401/403/404/409/413/415/500 | 当前 |
| GET | `/api/agent/conversation` | query `view?`, `taskId?` | `AgentConversationResponse` | 400/401/403/404/409/500 | 当前 |
| GET | `/api/agent/runs` | query `taskId?` | `AgentRunCurrentResponse` | 400/401/403/404/409/500 | 当前 |
| POST | `/api/agent/runs` | JSON 或 multipart；`Idempotency-Key?` | `200/202 AgentRunCreateResponse` + Location | 400/401/403/404/409/413/415/500 | 当前，主入口 |
| GET | `/api/agent/runs/:runId` | UUID path | `{run:AgentRun}` | 400/401/403/404/500 | 当前 |
| GET | `/api/agent/runs/:runId/events` | `after>=0`, `limit=1..200` | `AgentRunEventsResponse` | 400/401/403/404/500 | 当前 |
| GET | `/api/agent/runs/:runId/events/stream` | `after>=0`，支持 `Last-Event-ID` | SSE | 预握手 400/401/403/404/500 | 当前 |
| POST | `/api/agent/runs/:runId/cancel` | `{idempotencyKey}` | `{run,alreadyApplied,abortRequested}` | 400/401/403/404/409/413/415/500 | 当前 |
| POST | `/api/agent/runs/:runId/retry` | `{idempotencyKey}` | `202 {run,alreadyApplied}` + Location | 同上 | 当前 |
| POST | `/api/agent/runs/:runId/approvals/:actionId` | `{decision,idempotencyKey}` | `{run,action}` | 同上 | 当前 |
| GET | `/api/agent/artworks/:attachmentId` | 不支持 Range | 私有图片二进制 | 401/404/416/500 | 当前 |
| GET | `/api/agent/tasks` | 无 | `{tasks:DesignTask[]}` | 401/403/404/500 | 当前 |
| POST | `/api/agent/tasks` | `{title?}` | `201 DesignTask` | 400/401/403/404/413/415/500 | 当前 |
| PATCH | `/api/agent/tasks/:taskId` | `{title?,status?}`，至少一项 | `DesignTask` | 400/401/403/404/413/415/500 | 当前 |

身份输入约束：

```ts
type StudentAuthRequest = {
  classCode: string; // trim, 1..64
  alias: string;     // 匿名编号，会在服务端规范化
};
type TeacherAuthRequest = { code: string }; // trim, 1..128
```

新学生端统一使用异步 runs，不再新增对同步 `/api/agent/turn` 的依赖。

课程包标识与后端注册表严格一致，不得使用界面文案自造 id：`digital-interaction@1`、`book-design@1`、`general-design@1`。

```ts
interface AgentTurnRequest {
  taskId?: UUID;
  message: string; // trim, 1..2000
  externalSearchConsent?: {
    nonce: UUID;
    messageDigest: Sha256Hex;
    issuedAt: number;
  };
  context?: {
    view?: "AGENT" | "WORKSPACE" | "EVIDENCE" | "RESOURCES" |
      "NODE_CANVAS" | "CASE_LIBRARY" | "KNOWLEDGE_MAP" |
      "PROJECT" | "BOOK_LAYOUT_LAB";
    focus?: string | null; // trim, 1..160
  }; // 默认 {view:"AGENT"}
}
```

`POST /api/agent/runs`：

- 纯文本：`application/json`，硬限 16 KiB。
- 带作品：`multipart/form-data`，必须且只能有 `payload`（上述 JSON 字符串）与 `artwork`。
- 作品仅接受 PNG/JPEG/WebP，校验真实文件，最大 5 MiB，最大 10000×10000。
- 前端重试必须复用同一个 UUID `Idempotency-Key`。
- 首次排队通常返回 202；幂等命中且已完成可返回 200。

```ts
type AgentRunStatus =
  | "QUEUED" | "RUNNING" | "WAITING_APPROVAL"
  | "COMPLETED" | "FAILED" | "CANCELLED";

interface AgentRun {
  id: UUID;
  taskId: UUID;
  request?: AgentTurnRequest;
  status: AgentRunStatus;
  runtime: { id: string; version: string };
  attempt: number;
  checkpoint: {
    stage: "CREATED" | "CLAIMED" | "CANCEL_REQUESTED" | "CANCELLED" |
      "RETRY_QUEUED" | "TURN_PERSISTED" | "WAITING_APPROVAL" |
      "COMPLETED" | "FAILED";
    turnId?: UUID;
    approvalId?: UUID;
  };
  result: AgentTurnResponse | null;
  lastErrorCode: string | null;
  cancelRequestedAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  startedAt: ISODate | null;
  completedAt: ISODate | null;
}
```

最终响应继续复用 `lib/agent/contracts.ts::AgentTurnResponseSchema`，核心字段是：`taskId?`、`conversationId`、`turnId`、`studentMessage`、`coursePack`、`specialty?`、`episode`、`decisionCode`、`aiMode`、`policy`、`executionSteps`、`runtime`、`runtimeEvents`、`createdAt`、`reply`、`artworkAttachment?`、`projectBrief?`。前端只做 type-only import，不复制这组巨型 schema。

SSE 语义：

```ts
interface AgentRunEvent {
  id: UUID;
  runId: UUID;
  sequence: number;
  kind: "RUN_CREATED" | "STATUS_CHANGED" | "RUN_CLAIMED" | "STEP" |
    "TOOL" | "APPROVAL" | "COMPLETION" | "ERROR" | "CANCELLED" | "TOKEN";
  label: string;
  summary: string;
  payload: {
    status?: AgentRunStatus;
    previousStatus?: AgentRunStatus;
    stepKind?: "CONTEXT" | "RETRIEVAL" | "MODEL" | "TOOL" | "PERSISTENCE" | "RESPONSE";
    text?: string; // 仅 TOKEN
    errorCode?: string;
    [key: string]: unknown;
  };
  createdAt: ISODate;
}
```

- 事件名 `agent-run-event`，SSE `id` 等于 `sequence`，`data` 是完整事件 JSON。
- 10 秒 keepalive。流内异常发 `transport-error` 与 `{"retry":true}` 后关闭。
- 客户端必须回退到 `/events` polling，并按 `sequence` 去重；连接中断不等于模型失败。
- `transport-error` 只触发“流已中断、运行仍继续”的回调，不得把 run 写成 `FAILED`；只有轮询读到终态 `FAILED` 才能显示本轮失败。

### 3.2 学生学习与证据

| 方法 | 路径 | 请求 | 成功响应 | 主要错误 |
| --- | --- | --- | --- | --- |
| GET | `/api/student/dashboard` | 无 | `StudentDashboard` | 401/403/404/500 |
| GET | `/api/diagnostic` | 公开，无 | `{questionSetVersion,questions[]}` | — |
| POST | `/api/diagnostic` | `DiagnosticSubmission` | `DiagnosticProfileResponse` | 400/401/403/409/415/500 |
| GET | `/api/book-layout` | 无 | `BookLayoutWorkspaceResponse` | 400/401/403/404/413/415/500 |
| PUT | `/api/book-layout` | `BookLayoutDraftRequest` | `BookLayoutDraftResponse` | 同上 |
| DELETE | `/api/book-layout` | `{reset:true}` | `BookLayoutResetResponse` | 同上 |
| POST | `/api/book-layout` | `BookLayoutEvidenceRequest` | `201 BookLayoutEvidenceResponse` | 同上 |
| POST | `/api/projects/:projectId/evidence` | JSON evidence 或 multipart image | `201 PublicEvidenceRecord` | 400/401/403/404/409/413/415/429/500 |
| POST | `/api/projects/:projectId/hints` | `{question}` | `StudentHintPublicResponse` | 400/401/403/404/409/413/415/429/500 |
| POST | `/api/projects/:projectId/logic-card` | `LogicCardSchema` | `LogicCardResponse` | 400/401/403/404/409/413/415/500 |
| POST | `/api/projects/:projectId/logic-card/coach` | `LogicCardCoachRequest` | `LogicCardCoachResponse` | 400/401/403/404/409/413/415/429/500 |
| POST | `/api/projects/:projectId/tool-path` | `ToolPathRequirements` | `{plan:ToolPathPlan}` | 400/401/403/404/409/413/415/500 |
| POST | `/api/projects/:projectId/troubleshooting` | `TroubleshootingInput` | `TroubleshootingPublicState` | 400/401/403/404/409/413/415/429/500 |
| POST | `/api/projects/:projectId/transfer` | START 或 SUBMIT union | `TransferPublicState` | 400/401/403/404/409/413/415/429/500 |
| GET | `/api/evidence` | `limit?`, `cursor?`, teacher-only `studentId?` | `{items,nextCursor}` | 400/401/404/500 |
| GET | `/api/evidence/:evidenceId` | 不支持 Range | 私有图片二进制 | 401/404/416/500 |
| DELETE | `/api/evidence/:evidenceId` | 无 | 204，缺失也为 204 | 401/500 |

对话作品与学习证据是两套存储，不得混用：

```ts
// 对话作品：随 Agent run 上传
type AgentArtworkAttachment = {
  id: UUID;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  byteSize: number;
  width: number;
  height: number;
  previewUrl: `/api/agent/artworks/${UUID}`;
} | {
  id: UUID;
  mimeType: "image/svg+xml";
  byteSize: number;
  width: number;
  height: number;
  previewUrl: `/demo/${RegisteredPresetName}.svg`;
};

// 项目证据：POST /api/projects/:projectId/evidence
type EvidenceDraft =
  | { kind:"TEXT"; label:string; signalLayer:Layer; text:string }
  | { kind:"VALUE"; label:string; signalLayer:Layer; value:number }
  | { kind:"VIDEO_LINK"; label:string; signalLayer:Layer; url:string }
  | { kind:"PROBE"; label:string; signalLayer:Layer; probe:unknown }
  | { kind:"IMAGE"; label:string; signalLayer:Layer; file:File };
type Layer = "INPUT" | "MAPPING" | "TRANSPORT" | "BINDING" | "OUTPUT";
```

第二个分支只允许 `?demo=1` / mock 回合使用，路径必须登记在 `public/demo/manifest.json`，且登记项必须为 `DEMONSTRATION_DATA` / “预置”。真实学生上传仍只允许第一个私有 raster 分支；demo 原生图片不得访问 `/api/agent/artworks/*`，避免越过 mock transport 触发真实身份 API。

`StudentDashboard` 的完整运行时 schema 仍在 `lib/domain/student-dashboard.ts::StudentDashboardSchema`。它包含学生匿名身份、能力档案、课程与任务、当前项目、逻辑卡、工具路径、证据、排障、提示与迁移状态；F0 mock 提供 schema 可接受的最小空看板。

### 3.3 教师端

| 方法 | 路径 | 请求 | 成功响应 | 主要错误 |
| --- | --- | --- | --- | --- |
| GET | `/api/teacher/dashboard` | `classId?`, `includeDemo?` | class list 或 `ClassAnalytics` | 400/401/403/404/500 |
| GET | `/api/teacher/learners/:studentId` | required `classId`, `includeDemo?` | `LearnerDetail` | 400/401/403/404/500 |
| GET | `/api/teacher/learners/:studentId/memories` | `classId`, pagination, `includeDemo?` | `StudentMemoryCollection` | 400/401/403/404/500 |
| DELETE | `/api/teacher/learners/:studentId/memories/:memoryId` | required `classId` | 幂等 204 | 401/403/404/500 |
| GET | `/api/teacher/evidence/:evidenceId` | 无 | `TeacherEvidenceDetail` | 401/403/404/500 |
| POST | `/api/teacher/decisions` | `TeacherDecisionInput` | `201 TeacherDecisionPublic` | 400/401/403/404/409/413/415/429/500 |
| POST | `/api/teacher/agent-reviews` | `AgentDecisionReviewInput` | `201 AgentDecisionReviewPublic` | 400/401/403/404/413/415/500 |
| GET | `/api/teacher/pilot-report` | required `classId` | Markdown attachment | 401/403/404/500 |

教师统计中的 `includeDemo` 必须显式为 `true` 或 `false`。正式洞察默认 `REAL_ONLY`，不得把 mock 或预置数据混入对学生的教学判断。

### 3.4 公开与支持接口

| 方法 | 路径 | 成功响应 | 备注 |
| --- | --- | --- | --- |
| GET | `/api/health` | `200/503 PublicHealth` | 503 是健康状态，不等于请求未到达 |
| GET | `/api/touchdesigner-cases` | `TouchDesignerCaseLibrary` | catalog 未生成时 503 |
| GET | `/api/touchdesigner-cases/:structureId` | `TouchDesignerStructure` | id 为 sha256；400/404 |
| GET | `/api/touchdesigner-node-catalog` | `NodeCatalogResponse` | catalog 未生成时 503 |

## 4. 拟新增契约

以下端点尚未在 `app/api/**` 实现。前端 mock 可以用于开发，但正式页面必须在对应端点转实盘后才宣称功能可用。

### 4.1 五维会诊

提交仍复用 `POST /api/agent/runs` 的作品附件。作品类 run 完成后：

1. `AgentTurnResponse` 新增可选 `critique?: CritiqueResult`；
2. 持久化后可用 `GET /api/agent/turns/:turnId/critique` 读取；
3. 无会诊记录返回 404 `{error,code:"CRITIQUE_NOT_FOUND"}`。

```ts
type CritiqueDimensionId =
  | "goal"
  | "translation"
  | "structure_hierarchy"
  | "formal_language"
  | "craft_standards";

type CritiqueResult = {
  id: UUID;
  frameworkId: "critique-framework-five-plus-closure";
  frameworkVersion: "1.0";
  courseId: string;
  artworkId: UUID;
  createdAt: ISODate;
  dimensions: Array<{
    id: CritiqueDimensionId;
    label: string;
    displayOrder: 1 | 2 | 3 | 4 | 5;
    status: "ESTABLISHED" | "DEVELOPING" | "NEEDS_EVIDENCE";
    observation: string;
    evidence: Array<{
      kind: "ARTWORK_REGION" | "STUDENT_STATEMENT" | "COURSE_REFERENCE" | "HISTORY_RECORD";
      label: string;
      reference?: string;
    }>;
    guidance: {
      level: "QUESTION" | "HINT" | "DEMONSTRATION";
      message: string;
      understandingCheck?: string;
    };
    isDeepDive: boolean;
  }>;
  closure: {
    established: string;
    nextStep: string;
    historyReference?: {
      recordId: string;
      label: string;
      comparison: string;
    };
  };
};
```

强制约束：

- `dimensions` 必须恰好包含五个固定 id，顺序 1–5，不得多出 `closure`。
- 只深谈 1–2 维时，其余维仍给有证据边界的总览。
- `closure` 必须始终存在，且在 UI 中不是第六张并列卡片。
- `historyReference` 仅在有可核对成长档案时出现。
- 软件操作/故障问题走证据式排错，不生成这套五维结构。

### 4.2 课程注册表

```ts
// GET /api/courses
type CourseRegistryResponse = {
  currentCourseId: string;
  courses: Array<{
    id: string;
    label: string;
    description: string;
    version: string;
    status: "READY" | "DRAFT";
    capabilities: Array<"DIALOGUE" | "ARTWORK_CRITIQUE" | "SOFTWARE_TROUBLESHOOTING">;
  }>;
};

// POST /api/courses/switch {courseId}
type CourseSwitchResponse = {
  currentCourseId: string;
  course: CourseRegistryResponse["courses"][number];
};
```

不存在或未开放课程返回 404 `COURSE_NOT_FOUND`。切换只改变当前会话课程，不迁移或覆盖历史作品。

### 4.3 教师配置台

```ts
// GET /api/teacher/config/resources?courseId?
type TeacherResourceListResponse = { resources: TeacherResource[] };

// POST /api/teacher/config/resources, multipart: file, courseId, title?
type TeacherResource = {
  id: UUID;
  courseId: string;
  title: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  status: "UPLOADING" | "INDEXING" | "READY" | "FAILED";
  createdAt: ISODate;
  error?: string;
};
// 201 {resource: TeacherResource}

// DELETE /api/teacher/config/resources/:resourceId
// 200 {deleted:true,id:UUID}; 重复删除可返回相同幂等结果
```

具体文件大小、类型与索引提供商不在 F0 决策范围；后端实现前需另定安全限额。T5 只做解耦，不在此选择嵌入提供商或密钥。

### 4.4 教师洞察台

```ts
// GET /api/teacher/insights?courseId=...&classId?=...
type TeacherInsightsResponse = {
  courseId: string;
  classId: string | null;
  generatedAt: ISODate;
  dataScope: "REAL_ONLY" | "DEMONSTRATION_ONLY";
  insights: Array<{
    id: UUID;
    kind: "COMMON_DIFFICULTY" | "RETEACH_SUGGESTION";
    title: string;
    summary: string;
    evidenceCount: number;
    affectedLearners: number;
    confidence: "HIGH" | "MEDIUM" | "LOW";
  }>;
};
```

如果 S5 被裁，端点可不实现、页面不上线；不得用 mock 洞察冒充正式能力。

正式响应只允许 `REAL_ONLY`；预置 mock 必须返回 `DEMONSTRATION_ONLY`，文字只能称“预置学习记录”，不得称“真实学习记录”。

## 5. 上传与真实延迟

- 作品上传采用 XHR 以获得浏览器真实 `upload.onprogress`；不伪造真实上传百分比。
- 浏览器无法计算 `Content-Length` 时，上传进度返回 `indeterminate:true`，不得显示假 50%；调用方重试同一次提交时复用原 `Idempotency-Key`。
- XHR 成功状态若响应为空或不是合法运行对象，客户端返回可恢复的格式错误，不把 `null` 当作成功；浏览器自动生成 multipart boundary，客户端不得手写 `Content-Type`。
- 上传完成与模型完成是两个阶段：前者显示“上传完成，正在阅读作品”，后者由 Agent run 事件驱动。
- 12 秒无首字时仍需展示可感知的运行步骤；不得让学生误以为点击无效。
- `transport-error` 后继续 polling；只有 run 终态 `FAILED` 才显示本轮失败。
- 重试必须复用原提交的 idempotency key，避免创建重复会诊。

## 6. 当前已知不一致与后端变更请求

1. **错误体不统一**：auth/部分项目接口常有 `{ok:false,error,code?}`，Agent/Teacher 多为 `{error}`。前端使用容错解析器，后端后续再统一。
   客户端 `ApiError` 保留 `status`、`code` 与数字型 `Retry-After`。只有 401 或带明确身份错误码的 403 可触发身份入口；普通业务 403 不能把学生踢回入口。
2. **跨源 evidence 行为**：`GET/DELETE /api/evidence*` 当前跨源错误可能落 500，而非其他路由的 403；mock 不应掩盖此差异。
3. **缺独立响应 schema**：diagnostic GET、教师 class list、private evidence list、health 需要后端导出 schema。
4. **Agent SSE 不可注入**：旧 hook 直接 `new EventSource`；新界面统一使用 `components/client-api/transport.ts`，才可 mock 与测试 polling fallback。
5. **五维会诊**：后端需把本节 `CritiqueResult` 加入 Agent turn 持久化与读取端点。
6. **课程/配置/洞察**：按第 4 节实现；变更字段前先更新本文。

## 7. 验收场景

F0/F3 至少覆盖：

- 未登录 401、无权限 403、限流 429 与 `Retry-After`；
- 空看板、有/无 active run、刷新后恢复；
- SSE 正常、`transport-error` 后 polling、`WAITING_APPROVAL` 与各终态；
- 作品 413/415、真实上传进度、上传后模型等待；
- stale context 409；
- 204、二进制、Markdown 与 SSE 的非 JSON 分支；
- 五维齐全、只深谈 1–2 维、独立收束必出、无历史时不虚构比较。

## 8. 源码类型索引

| 领域 | 当前运行时真源 |
| --- | --- |
| Agent 请求/回复 | `lib/agent/contracts.ts` |
| Agent run/事件/控制 | `lib/agent/runtime/agent-run-event.ts` |
| 设计任务 | `lib/agent/design-project-task-contract.ts` |
| 身份 | `lib/auth/route-handler.ts` |
| 学生看板 | `lib/domain/student-dashboard.ts` |
| 教师分析/学生详情 | `lib/domain/teacher.ts` |
| 项目证据 | `lib/services/evidence.ts`, `lib/domain/evidence.ts` |
| TouchDesigner catalog | `lib/touchdesigner/types.ts`, `lib/touchdesigner/node-catalog-shared.ts` |
| 拟新增前端类型 | `components/client-api/contracts.ts` |
