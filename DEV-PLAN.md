# Development Plan — 触映 Design Agent Kernel

规格版本：Product-Spec v2.9
计划日期：2026-07-17
当前分支：`feature/tonggan-mvp`

## 当前状态

- 当前开发阶段：**K8 全部完成；下一阶段 K9 Capability Manifest v2 与 MCP 只读网关**。
- K6 已提交基线：`1dcf441`；K5 任务与插件运行时提交为 `163a05e`。
- 旧系统状态：课程包、知识检索、只读工具循环、教师复核、证据、Harness 和浏览器发布能力已完成并保留。
- 本轮结果：学生主对话已切换到可恢复 Agent Run，具备 SSE / 轮询事件、图片运行输入、刷新恢复、取消、有限重试和持久审批；全领域设计回答与历史数据继续保留。
- 非目标：不增加后台页面，不实现 TouchDesigner 写入，不升级技术栈，不删除历史证据。

## 技术栈与验证

| 层级 | 仓库版本 | 本轮决策 |
|---|---|---|
| Runtime | Node.js `>=20.19 <25` | 保持 |
| Web | Next.js `16.2.10` | 保持；官方 16.2 系列适用当前 App Router |
| UI | React `19.2.4` + Tailwind CSS 4 | 保持现有组件与视觉体系 |
| 类型 / Schema | TypeScript `5.9.3` + Zod `4.4.3` | strict；所有模型和持久化边界继续校验 |
| 数据 | SQLite + better-sqlite3 + Drizzle `0.45.2` | 新增非破坏性 Durable Run / Event migration |
| 模型 | OpenAI Chat Completions 兼容接口 | 适配器显式声明可选视觉能力，不从模型名推断 |
| 测试 | Vitest `4.1.10` + Playwright `1.61.1` | 增加行为测试并保留旧回归 |

技术核对：Next.js 官方已发布 16.2；OpenAI 官方仍公开 Chat Completions 消息接口；Drizzle 官方支持从 TypeScript schema 生成 SQL migration 并使用 SQLite / better-sqlite3。仓库版本已通过既有发布门，本轮不做无关升级。

## 功能依赖图

```text
ModelProviderAdapter ─┐
ConversationSession ─┼─> DesignAgentKernel ─> 回答与 ProjectBriefMemory 合并
ActionPolicy ─────────┘          │
                                ├─> SpecialtyRouter ─> KnowledgeRetriever
                                │                       └─> ToolRegistry
                                └─> 来源分层与 AgentEvalHarness

DesignAgentKernel + ProjectBriefMemory
  -> 学生对话主界面
  -> 过程记录次级入口
  -> 全量回归 / Harness / 浏览器验收
```

---

## Phase K0：架构冲突审查与文档迁移

**状态：** 已完成

### 交付

- 审查当前课程路由、模型提示、来源策略、工具白名单、会话分片和学生入口。
- 更新 `Product-Spec.md` 为 v2.0。
- 建立 `Product-Spec-CHANGELOG.md`。
- 重写本开发计划，并保留旧功能兼容边界。

### 关键文件

- `docs/design-agent-kernel-architecture-review.md`
- `Product-Spec.md`
- `Product-Spec-CHANGELOG.md`
- `DEV-PLAN.md`

### 验收

- 冲突、保留资产、迁移边界和第一稳定切片均有明确文字证据。
- 新 Spec 不再包含“无命中拒答”或“默认数字交互”的许可逻辑。

---

## Phase K1：通用设计内核、连续会话与项目简报记忆

**状态：** 已完成

### 目标

让艺术设计专业全领域的问题先获得正常回答，并把模糊对话逐轮沉淀为可恢复项目理解。海报、IP、TouchDesigner 和书籍仅作为测试样例或现有资源增强点，不构成能力边界。

### Task K1.1 — ModelProviderAdapter 与身份提示

- 建立 OpenAI 兼容模型适配器接口，复用现有超时、限流和响应校验。
- 把触映身份、自由设计回答、模糊表达、单问题追问和来源边界移出具体模型客户端。
- 固定“艺术设计博士层级、覆盖艺术设计全专业”的导师人格；测试中列举的专业不得成为回答白名单。
- 模型输出增加受控 `briefPatch`，只允许更新八个项目简报字段。

**关键文件：**

- `lib/agent/model-provider-adapter.ts`
- `lib/agent/design-agent-prompt.ts`
- `lib/agent/model-decision.ts`
- `lib/agent/contracts.ts`
- `lib/ai/client.ts`

### Task K1.2 — ConversationSession

- 跨课程包读取同一学生最近 30 回合，保留每回合专业增强信息。
- 短追问使用跨专业最近上下文，不再先按课程包切断。
- 完整问答和悬浮问答恢复同一合并会话。

**关键文件：**

- `lib/agent/conversation-session.ts`
- `lib/agent/conversation-context.ts`
- `lib/agent/orchestrator-store.ts`

### Task K1.3 — ProjectBriefMemory

- 新建项目简报 Schema、增量合并器、存储表和 migration。
- 字段区分 `INFERRED` / `CONFIRMED`，记录来源回合和更新时间。
- 模型失败、非法字段或空补丁不覆盖已有简报。
- 回合接口和会话恢复接口都返回当前简报。

**关键文件：**

- `lib/agent/project-brief-memory.ts`
- `lib/db/schema.ts`
- `drizzle/0031_*.sql`
- `lib/agent/orchestrator-store.ts`
- `tests/unit/project-brief-memory.test.ts`
- `tests/integration/agent-conversation-session.test.ts`

### Task K1.4 — DesignAgentKernel

- 将现有编排入口收敛为 DesignAgentKernel，先处理通用回答，再接可选增强。
- 无课程知识时允许模型使用通用设计知识，并返回 `GENERAL_DESIGN` 依据类型。
- 旧回合缺少新字段时兼容恢复。

**关键文件：**

- `lib/agent/design-agent-kernel.ts`
- `lib/agent/orchestrator.ts`
- `lib/agent/policy-enforcement.ts`
- `lib/agent/deterministic-response.ts`
- `tests/integration/design-agent-kernel.test.ts`

### Phase K1 验收

- 海报、IP 以及产品、空间、服装、影像等跨专业问题不显示超范围或无依据拒答。
- 模糊输入返回 2—3 个假设且至多一个问号句。
- ProjectBriefMemory 刷新恢复，旧数据库迁移后旧回合仍可读。
- 课程、案例和工具的具体事实仍不能由模型伪造。

---

## Phase K2：专业路由、知识增强与目标导向工具

**状态：** 已完成基础重构；TouchDesigner 本机实时只读传输层留到下一切片

### Task K2.1 — SpecialtyRouter

- 新增 `GENERAL_DESIGN`、`DIGITAL_INTERACTION`、`BOOK_DESIGN` 路由结果。
- 未识别问题默认通用设计；界面焦点和明确专业词只提升专业增强置信度。
- route 不再控制回答许可或把问题规范化为课程任务。

**关键文件：**

- `lib/agent/specialty-router.ts`
- `lib/agent/router.ts`
- `lib/course-packs/registry.ts`
- `tests/unit/specialty-router.test.ts`

### Task K2.2 — KnowledgeRetriever 与来源分层

- 专业增强时检索课程知识；通用设计不创建伪课程来源。
- 回答生成 `GENERAL_DESIGN / COURSE_KNOWLEDGE / CASE_EVIDENCE / TOOL_OBSERVATION / LEARNING_RECORD`。
- 旧的“source-free 必须无依据”改为“具体外部事实必须有对应来源”。

**关键文件：**

- `lib/agent/knowledge-retriever.ts`
- `lib/agent/contracts.ts`
- `lib/agent/answer-grounding.ts`
- `lib/agent/model-grounding.ts`
- `tests/unit/agent-answer-basis.test.ts`

### Task K2.3 — ToolRegistry 与 ActionPolicy

- 候选工具按学生目标、专业、能力和权限选择。
- 保留执行器的注册、Schema、超时、重复调用和输出大小限制。
- 将只读自动、写入确认、正式评价禁止独立为 ActionPolicy。
- TouchDesigner 现阶段使用案例网络和现有可读节点数据；本机实时桥接传输层在下一切片实现，只允许读取，不实现写入。

**关键文件：**

- `lib/agent/tool-registry.ts`
- `lib/agent/action-policy.ts`
- `lib/agent/tool-executor.ts`
- `lib/agent/tools/course-tools.ts`
- `tests/unit/agent-tool-selection.test.ts`

### Phase K2 验收

- 没有专门资源的所有艺术设计方向均使用通用专业能力回答，不获得错误的数字交互课程标签或工具。
- TouchDesigner 问题使用课程、案例或工具依据，并明确未读取的现场信息。
- 工具空结果或失败不阻断通用回答。
- 只读自动、写入确认和正式评价禁止继续通过 Harness。

---

## Phase K3：学生对话主界面与过程记录降级

**状态：** 已完成

### Task K3.1 — 对话与项目理解

- 空状态示例改为海报、IP、TouchDesigner、书籍四类。
- 对话头部显示当前专业增强而不是默认课程包。
- 增加轻量“项目理解”折叠区，显示已确认 / 暂时理解，并通过对话修正。
- 回答正文显示依据类型标签；工程策略继续折叠。

**关键文件：**

- `components/student/MentorChat.tsx`
- `components/student/AgentMentorAnswer.tsx`
- `components/student/ProjectBriefSummary.tsx`
- `components/student/use-agent-conversation.ts`
- `tests/unit/mentor-chat.test.tsx`

### Task K3.2 — 导航与旧流程兼容

- 一级导航“学习对话”改为“创作对话”。
- “学习证据”改为次级“过程记录”，教师和历史数据仍保留。
- 项目工作台不再把诊断、逻辑卡或门禁描述为使用 Agent 的前置条件。
- 不新增后台页面。

**关键文件：**

- `components/student/StudentStudioNav.tsx`
- `components/student/StudentShell.tsx`
- `Design-Brief.md`
- `tests/unit/student-shell.test.tsx`

### Phase K3 验收

- 375px 和桌面均可完成提问、查看项目理解、查看依据和确认行动。
- 普通对话路径不出现学习证据必填或专业字段表单。
- 既有工作空间、案例库、过程记录和教师端入口仍可达。

---

## Phase K4：Agent 行为评测、全量回归与稳定提交

**状态：** 已完成

### 交付

- 扩展固定 Agent Eval 与 Harness，覆盖 Product-Spec v2.0 第一稳定切片。
- 运行专项单元 / 集成，再运行全量 Vitest、typecheck、lint、build、Harness 和核心 Playwright。
- 按 Stage 1 功能完整性、Stage 2 质量与安全进行代码审查，修复后重跑质量门。
- 建立一个包含规格、计划、实现、测试和 UI 收敛的稳定 Git 提交；不自动 push。

### 本切片验证结果

- TypeScript、ESLint、生产构建通过。
- Vitest：127 个测试文件、1095 项测试全部通过。
- Agent Harness：14/14 通过。
- Playwright：20 项场景通过；19 项全套运行通过后，因示例文案变更失败的 1 项经兼容修复并单独重跑通过。

### 下一切片

- TouchDesigner 本机实时只读桥接：选中节点、连接、参数、表达式、范围、错误与输出状态。
- 通用设计参考检索。
- ProjectBriefMemory 的对话式确认、否定、修正与显式编辑入口。

### 关键文件

- `data/evals/agent-core.json`
- `lib/agent/evaluation.ts`
- `lib/agent/harness.ts`
- `scripts/run-agent-harness.ts`
- `tests/integration/agent-evaluation.test.ts`
- `tests/integration/agent-harness.test.ts`
- `tests/e2e/student-flow.spec.ts`

### 验收命令

- `pnpm test`
- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `pnpm agent:harness`
- `pnpm test:e2e`
- `git diff --check`

### 完成条件

- Product-Spec 第一稳定切片 8 条验收逐项有测试或浏览器证据。
- 旧案例、节点解析、教师复核、历史数据与真实/演示边界回归通过。
- 无新增硬编码密钥、任意命令、客户端工具伪造或未经确认写入。
- Git 提交成功，并记录修改、验证结果和下一阶段。

---

## Phase K5：网页版项目对话与 Plugin / Skill Runtime

**状态：** 已完成

### 目标

建立网页版 ChatGPT 风格的项目对话工作区：左侧组织项目任务与历史，中央保持持续对话，底部输入始终可达。Agent 根据任务目标按需调用 Plugin / Skill；基础设计专业能力始终存在，课程知识和专用功能只作增强。

### Task K5.1 — DesignProjectTask 与兼容迁移

- 新建任务实体，保存标题、状态、学生、班级、当前 ProjectBriefMemory、创建和最近活动时间。
- `agent_conversations` 归属任务；不同任务的会话、简报和执行记录严格隔离。
- 把既有学生的跨专业会话迁移到一个兼容任务，不重写旧回合和教师记录。
- 提供新建、列表、切换、重命名和归档接口；所有写操作校验归属和幂等边界。

**关键文件：**

- `lib/agent/design-project-task.ts`
- `lib/db/schema.ts`
- `drizzle/0032_*.sql`
- `app/api/agent/tasks/route.ts`
- `app/api/agent/tasks/[taskId]/route.ts`
- `lib/agent/conversation-session.ts`

### Task K5.2 — Plugin / Skill Runtime 与全局 ToolRegistry

- 新增受控能力清单：Plugin / Skill 声明身份、能力、学生可自主进入的学习空间、工具、激活信号和权限。
- 每个工具必须声明所属 Plugin / Skill 和学生可读动作名；注册器拒绝无归属裸工具。
- ToolRegistry 从“课程包先过滤”改为“全局注册 + 任务目标选择 + ActionPolicy 裁决”。
- 课程包改为推荐插件组合；没有课程命中、插件未启用或工具失败都不阻断基础回答。
- 第一批能力映射：TouchDesigner 插件、书籍设计 Skill、课程参考 Skill、过程记录 Skill；为后续作品理解 Skill 预留注册结构，但不展示未完成能力。

**关键文件：**

- `lib/agent/capability-registry.ts`
- `lib/agent/tool-registry.ts`
- `lib/agent/action-policy.ts`
- `lib/course-packs/registry.ts`

### Task K5.3 — 任务工作区界面

- 左侧任务区支持新建、最近任务、切换、重命名和归档；移动端使用抽屉。
- 中央区保持当前对话为主，项目理解与插件执行过程渐进展开。
- 回答附近显示实际调用的 Plugin / Skill、学生可读动作、读取状态和权限；不显示内部工具 ID、提示词或模型推理。
- 工作空间、过程记录和课程资源成为当前任务的次级能力入口。
- 节点画布与知识地图保留学生自主入口，同时允许 Agent 从对话定位打开；页面本身不被误记成一次工具调用。

**关键文件：**

- `components/student/MentorChat.tsx`
- `components/student/StudentStudioNav.tsx`
- `components/student/use-agent-conversation.ts`
- `components/student/StudentShell.tsx`
- `tests/unit/mentor-chat.test.tsx`

### Phase K5 验收

- 一句话新建任务，刷新与任务切换后恢复各自对话和项目理解。
- 无插件时可正常回答所有设计专业问题；插件只增加深度。
- TouchDesigner、书籍和现有只读能力从全局插件清单按任务目标选择。
- 只读工具自动，写入确认，工具调用和来源可见。
- 旧会话迁移后继续可读，不同学生和不同任务严格隔离。
- 专项测试后运行全量 Vitest、typecheck、lint、build、Harness 与 Playwright。

### K5 验证结果

- 任务接口、任务隔离、旧会话迁移、Plugin / Skill 注册、课程非门禁和客户端任务恢复均有单元或集成测试。
- 全量 Vitest：132 个测试文件、1104 项测试通过。
- TypeScript strict、ESLint、生产构建通过；Agent Harness 14/14 通过。
- Playwright：21/21 通过，包含项目任务新建、重命名、切换、刷新恢复和自主学习入口。

---

## Phase K6：通用作品理解插件

**状态：** 已完成

### Task K6.1 — 私有作品附件与会话恢复

- 在任务输入中支持一张私有作品图片，不复用学习证据门禁。
- 服务端解码并限制 PNG、JPEG、WebP、5MiB、像素和尺寸；文件保存到学生私有路径。
- 数据库记录任务、回合、学生、班级、摘要和尺寸，刷新后恢复附件缩略图。
- 附件读取接口只允许所属学生，未登录、教师和其他学生均不返回资源。

**关键文件：**

- `lib/agent/artwork-attachment.ts`
- `lib/agent/artwork-request.ts`
- `app/api/agent/artworks/[attachmentId]/route.ts`
- `drizzle/0033_keen_switch.sql`

### Task K6.2 — 可选视觉模型与诚实降级

- `ModelProviderAdapter` 显式声明 `vision` 能力；纯文本适配器继续正常工作。
- 视觉调用使用 OpenAI 兼容内容数组传入服务端已验证图片字节。
- 只有真实视觉调用成功才标记 `STUDENT_ARTWORK` 与 `ARTWORK_OBSERVATION`。
- 无视觉能力、上游失败或伪视觉描述均明确降级，并继续提供通用设计建议。

**关键文件：**

- `lib/ai/client.ts`
- `lib/agent/model-provider-adapter.ts`
- `lib/agent/model-decision.ts`
- `lib/agent/orchestrator.ts`

### Task K6.3 — 学生端上传与行为验证

- Plugin / Skill 菜单提供“理解作品图片”，选择后显示预览、格式、体积、移除和错误状态。
- 海报、草图、产品、空间、服装、界面等共用同一入口，不建立媒介白名单。
- 继续兼容原有 JSON 回合请求；仅附图回合使用有界 multipart。
- 增加视觉成功、文本模型降级、所有权、路由、模型客户端、界面和配置测试。

### K6 验证结果

- 全量 Vitest：133 个测试文件、1117 项测试通过。
- TypeScript strict 与 ESLint 通过；Next.js 生产构建通过。
- Agent Harness：14/14 通过；Playwright：21/21 通过。
- 真实浏览器验证桌面与 390px 手机布局，图片上传、明确降级、缩略图和刷新恢复均通过。

---

## Phase K6.4：真实模型兼容与自由回答发布加固

**状态：** 已完成并发布（不可变发布提交 `ea0db0c`）

### Task K6.4.1 — OpenAI 兼容结构化输出

- 兼容客户端默认请求 JSON 对象输出，减少截断、思考文本混入和非 JSON 决策。
- 官方 DeepSeek 端点关闭非必要思考输出；其他兼容端点若拒绝 JSON 参数，自动重试基础 Chat Completions 协议。
- Agent 人格、来源、工具和行动规则继续位于 DesignAgentKernel，不绑定具体模型名。

### Task K6.4.2 — 课程增强与回答许可彻底解耦

- 具体工艺未被课程知识直接覆盖时，不再注入边界课程来源，也不再清空基础模型能力。
- 模型对设计问题输出 `OUT_OF_SCOPE` 时由服务端拒绝并重试；失败降级仍提供通用设计步骤。
- 允许课程知识与通用设计建议同时显示，课程、案例和工具事实仍要求真实来源。

### Task K6.4.3 — 37 场景真实模型发布门

- 固定覆盖 TouchDesigner、书籍、海报、IP、包装、产品、空间、服装、模糊输入、连续追问和教师权限。
- 发布阈值：37/37 内容通过；路由、相关性、来源、行动与权限安全均为 100%；模型参与率不低于 95%。
- 正式安装版真实模型报告：37/37 通过；路由、相关性、来源、行动与权限安全均为 100%；模型参与率 100%，平均响应 6056ms。
- 报告版本 `2026-07-16.2`；发布判定要求每个案例单独通过，不允许平均分掩盖单条失败。
- 全量 Vitest：136 个文件、1132 项测试；TypeScript、ESLint、生产构建、生产依赖审计、Agent Harness 14/14 与 Playwright 21/21 全部通过。

### 完成条件

- 全量 Vitest、TypeScript、ESLint、生产构建、Agent Harness、真实模型 Eval 和 Playwright 全部通过。
- 新提交安装为独立不可变 Release；实际安装产物完成敏感信息和生产依赖审计。
- 一致性备份与迁移完成，本地托管任务已切换到 `ea0db0c`；本机完整发布验证通过并返回 `competitionReady=true`，命名 Cloudflare Tunnel 已恢复，`chuyingai.cc.cd` 公网健康请求成功。

---

## Phase K7：跨项目基准与 Runtime 可观测基座

**状态：** K7.2 完成；下一阶段 K8

### 目标

把开源项目研究转化为可重复的产品与技术基准，并在不改变现有回答行为的前提下拆开运行时边界。详细方法和候选队列见 `docs/research/agent-architecture-benchmark-roadmap.md`。

### Task K7.1 — 跨专业 Agent Benchmark

**状态：** 完成

- 在现有数字交互和书籍评测之外，加入视觉传达、品牌、包装、UI/UX、产品、空间、服装、首饰、影像、动画和工艺美术情境。
- 加入模糊需求、20 回合长会话、任务切换、工具超时、模型离线、写入等待确认和服务重启恢复场景。
- 固定同一模型、提示、数据和工具输入，形成当前 runtime 基线报告与候选评分卡。
- 固定测试适配器 30/30，只用于结构回归。DeepSeek 在干净提交上完成正式 30/30，报告为 `REAL_MODEL_BASELINE`、`workingTreeClean=true`、`releaseComparable=true`，六维评分均为 100%。
- 同阶段门禁：核心行为 Eval 37/37、Agent Harness 16/16、Vitest 1149/1149、Playwright 21/21；TypeScript、ESLint、生产构建和生产依赖审计通过。

**关键文件：**

- `data/evals/agent-core.json`
- `data/evals/agent-runtime-benchmark.json`
- `lib/agent/evaluation.ts`
- `lib/agent/agent-eval-harness.ts`
- `lib/agent/runtime-benchmark.ts`
- `lib/agent/runtime-benchmark-probes.ts`
- `scripts/benchmark-agent-runtime.ts`
- `docs/research/agent-architecture-benchmark-roadmap.md`

### Task K7.2 — Runtime Port 与 TraceSink

**状态：** 完成

- 新增 `AgentRuntimePort`，把上下文准备、运行、策略裁决、回合持久化从单一请求编排器中分离。
- 新增 `TraceSink` 和公开事件契约，记录模型、检索、工具、权限、来源、耗时、用量和错误分类，不保存内部推理。
- 当前自研 runtime 先实现接口；本阶段不引入候选框架到生产链。
- `orchestrator.ts` 降为兼容 façade，当前实现移入 `orchestrator-engine.ts`；请求入口、DesignAgentKernel 与 Benchmark Probe 均可注入 Runtime Port。
- 新增 `agent_runtime_events` 表与同事务写入；公开会话响应恢复 Runtime 身份和事件，旧回合使用兼容 Runtime 标识。
- OpenAI 兼容适配器读取真实 token 用量；端点不返回时记录 `UNAVAILABLE`，错误只保存稳定分类代码。
- 既有 `agent_steps` 继续服务当前学生与教师界面，K7.2 不改变可见交互，也不提前实现 durable checkpoint、流式 token、取消或持久审批。
- 完成门禁：固定 Runtime Benchmark 30/30、Harness 16/16、Vitest 1155/1155、Playwright 21/21；TypeScript、ESLint、生产构建、`git diff --check` 和生产依赖审计通过。
- 干净提交真实模型首次复跑 29/30；唯一 UI 用例的有效回答使用“显眼、颜色鲜明、固定位置”等词，旧词表未识别为入口可见性。套件升至 `2026-07-17.8` 并加入该真实回答防回归，专业维度要求仍为至少 2 组。
- `.8` 第二次干净复跑 29/30，失败转为包装用例；有效回答使用“A4纸包装盒、实物模拟、退后3米、视觉优先级”等等价表达。套件升至 `2026-07-17.9` 并加入对应防回归，仍不降低专业维度门槛。

**关键文件：**

- `lib/agent/runtime/agent-runtime-port.ts`
- `lib/agent/runtime/current-agent-runtime.ts`
- `lib/agent/runtime/trace-sink.ts`
- `lib/agent/runtime/agent-runtime-event-store.ts`
- `lib/agent/orchestrator-engine.ts`
- `lib/agent/orchestrator.ts`
- `drizzle/0034_bizarre_boomerang.sql`
- `tests/integration/agent-runtime-baseline.test.ts`
- `tests/unit/agent-trace-sink.test.ts`

### Phase K7 验收

- 当前 runtime 在新的跨专业基准中保持所有设计类问题默认可答。
- 现有 Harness、来源分层、ActionPolicy 和任务隔离无回归。
- 每回合有可查询的公开执行事件、耗时和失败类型，不暴露提示词或隐藏推理。
- 现有自研 runtime 通过新接口运行，学生界面行为不变。

---

## Phase K8：Durable Run、可恢复事件与通用确认

**状态：** K8.1、K8.2、K8.3 全部完成

### 目标

补齐类 Codex 长任务的基础运行状态，使工具确认、失败恢复和任务取消不依赖一个持续存在的 HTTP 请求。数据库是事实源，SSE / 轮询只是可替换传输。

### K8.1：Durable Run 基础（完成）

- [x] 新增 `agent_runs` 与 `agent_run_events`，保存所有权、请求快照、Runtime、状态、checkpoint、租约、attempt、幂等键和最终结果。
- [x] 以 run ID 唯一关联 `agent_turns`；重启恢复或重复执行先复用已完成回合，不重复写入。
- [x] 新增创建、状态查询、事件增量查询 API；创建接口持久化后快速返回 202，后台执行使用独立数据库连接。
- [x] 过期 `RUNNING` 可安全重新认领；每次状态转换和事件追加处于同一事务。
- [x] 保留同步 `/api/agent/turn`，本阶段不切换学生主界面。

### K8.2：取消、重试与持久审批（完成）

- [x] 新增取消意图与幂等键；队列中可直接取消，运行中先持久化再触发进程内 Abort，越过回合持久化边界后拒绝取消。
- [x] 外部取消信号贯穿模型与只读工具；落库事务再次核对取消意图，安全取消不保存半回合；本机托管恢复循环续跑队列和过期租约。
- [x] `FAILED` / 安全 `CANCELLED` 可用新幂等键有限重试；复用原请求和 Runtime，总 attempt 不超过 3。
- [x] 将现有受控行动升级为 DurableApproval，保存 effect 与 ActionPolicy 模式；已登记导航行动使 run 进入 `WAITING_APPROVAL`。
- [x] 批准 / 拒绝在同一事务结算选中行动、其他候选和 run；正式评价与教师权力仍禁止进入审批。
- [x] 新增取消、重试、审批 API 与所有权、并发、重启、幂等、安全边界测试；同步入口保持兼容且不能绕过 DurableApproval。
- [x] 明确 K8.2 只执行已登记 `NAVIGATE`；写项目、改软件和提交评价等待 K9 注册受控执行器。

### K8.3：学生端事件流与恢复（完成）

- [x] 学生端显示理解、检索、工具读取、等待确认、完成、失败与可重试状态，并能刷新恢复。
- [x] 事件传输支持从最后序号断点续读；优先 SSE，代理缓冲或非流式模型下回退增量轮询。
- [x] 只有适配器提供已经过学生可见内容校验的回答流时才发送 token；当前非流式适配器不伪造 token，且不暴露结构化规划 JSON 或隐藏推理。
- [x] Durable Run 接收经校验的作品图片，将上传流转为私有持久运行输入；失败 / 安全取消可复用，回合保存后清理临时输入。
- [x] 学生端通过数据库恢复当前任务最近运行与原问题；浏览器缓存只可加速，不作为状态事实源。

**关键文件：**

- `lib/agent/runtime/run-state-store.ts`
- `lib/agent/runtime/agent-run-event.ts`
- `lib/agent/runtime/agent-run-executor.ts`
- `lib/agent/runtime/agent-run-control.ts`
- `lib/agent/runtime/agent-run-approval.ts`
- `lib/agent/runtime/agent-run-recovery.ts`
- `lib/agent/action-policy.ts`
- `app/api/agent/runs/route.ts`
- `app/api/agent/runs/[runId]/route.ts`
- `app/api/agent/runs/[runId]/events/route.ts`
- `app/api/agent/runs/[runId]/events/stream/route.ts`
- `app/api/agent/runs/[runId]/cancel/route.ts`
- `app/api/agent/runs/[runId]/retry/route.ts`
- `app/api/agent/runs/[runId]/approvals/[actionId]/route.ts`
- `components/student/use-agent-run.ts`
- `components/student/AgentRunProgress.tsx`

### Phase K8 验收

- K8.1：运行、事件和最终结果可在连接断开与服务重启后恢复；相同幂等请求不会重复保存回合。
- K8.2：已登记的需确认行动在关闭页面或重启服务后仍可批准、拒绝或停止等待；取消和重试不重复回合或副作用。写操作执行器仍须在 K9 单独注册和验证。
- K8.3：学生能看到理解、检索、读取工具、等待确认、完成和可重试状态；事件断线后续读。
- 不支持流式的 OpenAI 兼容模型始终能通过步骤与完成事件正常工作。

---

## Phase K9：Capability Manifest v2 与 MCP 只读网关

**状态：** 待开始（K8 已完成）

### 目标

把当前代码内静态 Plugin / Skill 清单升级为受控能力生态，同时明确“学生自主空间”和“Agent 可调用动作”不是同一概念。

### 交付

- Manifest 增加版本、提供者、Schema、权限域、效果、配置、依赖、健康、激活信号和学生自主空间。
- 按 MCP 语义区分 Tools、Resources、Prompts：节点画布和知识地图是可自主浏览的资源空间；读取节点、搜索概念等才是工具。
- 建立可信 MCP server allowlist、连接健康与最小权限；首批仅接项目内只读能力。
- Plugin / Skill 的安装、升级、停用只对管理员开放；学生可在项目级启用已审核能力，但不能上传或执行任意服务端代码。

**关键文件：**

- `lib/agent/capabilities/manifest.ts`
- `lib/agent/capabilities/provider.ts`
- `lib/agent/capabilities/mcp-provider.ts`
- `lib/agent/capability-registry.ts`
- `lib/agent/tool-registry.ts`
- `components/student/CapabilityPicker.tsx`

### Phase K9 验收

- 未安装或失效插件不阻断通用设计回答。
- Agent 可发现项目已启用的只读能力，工具结果仍进入来源分层和 TraceSink。
- 远程工具不能绕过所有权、输出限制和 ActionPolicy。
- 学生可以独立进入知识地图、节点画布等空间，不需要先发起工具调用。

---

## Phase K10：长会话记忆与统一知识上下文

**状态：** 待 K9

### 目标

让长周期设计项目在多轮、多任务和多类资料下保持准确项目理解，并以统一契约组合通用参考、课程、案例、作品和实时工具结果。

### 交付

- ConversationSession 增加分段摘要、压缩版本和关键回合保留，不以固定最近 30 回合作为唯一上下文。
- ProjectBriefMemory 增加修订史、明确否定、删除、学生显式编辑和冲突提示。
- KnowledgeRetriever 输出统一候选：通用设计参考、课程知识、案例、工具观察、作品观察和已验证记录各自保留来源类型。
- 先建立词法 + 结构过滤 + 重排基线；只有离线检索评测证明收益后才引入向量或图 RAG。

**关键文件：**

- `lib/agent/conversation-session.ts`
- `lib/agent/project-brief-memory.ts`
- `lib/agent/knowledge-retriever.ts`
- `lib/agent/knowledge/retrieval-result.ts`
- `components/student/ProjectBriefEditor.tsx`

### Phase K10 验收

- 20 回合以上项目、刷新和任务切换后，已确认内容不丢失、不串线。
- 学生能否定、修改或删除 Agent 的暂时理解，并查看修订来源。
- 回答继续区分通用建议、课程、案例、工具、作品和学习记录。
- 检索无命中或重排失败仍不阻断通用设计回答。

---

## Phase K11：Agent Runtime Bake-off 与最终决策

**状态：** 待 K10

### 目标

用同一基准判断是否把当前模型—工具循环替换为通用框架；不预设必须迁移。

### 对照对象

- 当前自研 runtime：正式基线。
- OpenAI Agents SDK TypeScript：Tools、MCP、Sessions、Tracing、HITL 和 RunState 候选。
- LangGraph JS：checkpoint、interrupt、thread 和故障恢复候选。
- Microsoft Agent Framework：只做架构对照；除非双栈收益已被证明，否则不建立 Python/.NET sidecar。

### 交付

- 三个 runtime adapter 在隔离实验目录运行相同任务、模型、工具和数据。
- 输出行为通过率、延迟、用量、工具正确率、故障恢复、确认恢复、接入成本和许可/部署报告。
- 更新 `docs/decisions/0001-agent-runtime-strategy.md`：选择直接采用、局部采用或继续自研。
- 只有路线文档中的替换门全部通过，候选才进入正式依赖；否则移除 spike 依赖和实验代码。

**关键文件：**

- `experiments/agent-runtime-bakeoff/`
- `scripts/benchmark-agent-runtime.ts`
- `docs/research/agent-architecture-benchmark-roadmap.md`
- `docs/decisions/0001-agent-runtime-strategy.md`

### Phase K11 验收

- 决策可由固定报告复现，不以 star 数、演示效果或单个样例决定。
- 任何候选均不能修改触映硬规则来换取通过。
- 最终生产 runtime 可通过 feature flag 回退，旧任务和回合继续可读。

---

## Phase K12：类 Codex 设计项目工作区深化

**状态：** 待 K11

### 目标

在已经可靠的任务和 runtime 之上完善项目工作区，而不是只模仿 Codex/ChatGPT 的视觉外壳。

### 交付

- 任务搜索、归档恢复、运行状态、取消/重试、上下文附件、项目资料和项目级 Skill。
- 输入区提供可搜索的 Plugin / Skill / Resource 菜单，以及 `@资源`、`/流程` 入口；Agent 仍能按目标自动选择。
- 工具步骤、依据、批准和错误以公开轨迹渐进显示，不展示内部推理。
- 知识地图、节点画布、案例库和后续创作画布保持可自主浏览，也能从回答定位打开。

**关键文件：**

- `components/student/MentorChat.tsx`
- `components/student/StudentStudioNav.tsx`
- `components/student/CapabilityPicker.tsx`
- `components/student/AgentRunTimeline.tsx`
- `components/student/use-design-tasks.ts`

### Phase K12 验收

- 桌面和 375px 移动端均能管理任务、上下文、能力和长任务状态。
- 学生不需要理解工作流图、工具 ID 或课程包即可使用 Agent。
- 自主知识空间与可调用工具在界面和数据模型中清楚区分。
- 插件数量增加后，首屏仍以创作对话和当前项目为中心。

---

## Phase K13：真实试点、插件治理与季度复审

**状态：** 待 K12

### 交付

- 按设计专业、项目阶段和模型形成真实试点观察，跟踪追问负担、任务推进、工具失败、错误来源和教师介入。
- 建立插件来源、许可、版本、升级、停用、数据保留、凭据、作用域和安全复审清单。
- 每季度复审高相关项目；每个稳定切片最多引入一个 runtime、retrieval 或 protocol 级新依赖。
- 将试点结果反馈到 AgentEvalHarness，删除没有证据改善学生任务的复杂功能。

### Phase K13 验收

- 新插件或框架均有版本、权限、数据和回退记录。
- 试点能证明 Agent 对不同设计专业都可用，TouchDesigner 的深度来自增强而不是能力边界。
- 教师分析可查看过程摘要，但学习证据仍不是学生自由对话门禁。

---

## 数据库变更

| 表 | 阶段 | 用途 |
|---|---|---|
| `agent_project_briefs` | K1 | 学生跨专业项目理解、字段状态和来源回合 |
| `agent_conversations` | K1 | 保留旧表；会话读取改为跨专业聚合 |
| `agent_turns` | K1/K2 | 继续保存回合；专业增强和依据类型保存在版本化 reply 中 |
| `agent_tool_calls` / `agent_steps` | K2 | 继续保存只读工具与公开执行链 |
| `design_project_tasks` | K5 | 设计项目任务、标题、状态、归属与最近活动 |
| `agent_conversations.task_id` | K5 | 把连续会话归入任务并隔离 ProjectBriefMemory |
| `agent_artwork_attachments` | K6 | 私有对话作品图片、所属学生与回合；不等同于学习证据 |
| `agent_runs` / `agent_run_events` | K7/K8 | 可恢复运行状态、公开事件、runtime 版本、耗时和错误分类 |
| `agent_run_controls` / `agent_actions` | K8 | 取消、有限重试、待确认动作、决定、幂等和恢复状态 |
| `agent_run_artwork_inputs` | K8.3 | 异步图片回合的私有临时输入；回合持久化后提升为正式附件并清理 |
| `agent_capability_installations` | K9 | 受控 Plugin / Skill 版本、配置、健康和项目级启用状态 |
| `agent_project_brief_revisions` | K10 | 项目理解修订、否定、删除、来源与冲突记录 |
| 证据与教师决定表 | 兼容保留 | 不删除、不重写历史数据 |

## 开发规则

- 每个 Task 修改前先列引用和存量数据影响；修改后跑相应专项测试。
- 单文件保持 300 行以内；TypeScript strict；不新增 `any`。
- UI 使用现有触映视觉与相邻组件，不引入新设计系统。
- 模型完整上下文与 UI 摘要分离，不为界面简洁截断模型所需数据。
- migration 必须在空库和旧库上验证，失败不得损坏旧数据。
- 每次中间修复后重跑受影响质量门；最终全量结果以当场输出为准。
