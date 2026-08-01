# assistant-ui 正式前端接入 Lumi 后端（对话链路 + 持久化）

> **执行者**：Codex。
>
> **定位（2026-07-21 用户定）**：`/assistant-lab` 的 assistant-ui 界面**升格为正式前端基座**，后续界面工作都在它之上修改；**旧自建对话界面弃用**（`2026-07-18-lumi-frontend-rewrite.md` F3 中自建对话主界面的部分作废，作品上传、五维会诊展示等改为在 assistant-ui 基座上实现）。本计划负责把 Lumi 后端接上这个基座：**对话链路**（模型编排、流式、工具调用）与**持久化**（替换 localStorage）。
>
> **背景**：经 2026-07-21 评估，**不引入 Assistant Cloud**——Cloud 只托管线程与消息，Lumi 的工程、课程、runs、教师数据必然留在自己库里，拆两套库徒增同步成本；学生对话属教育数据，托管出境不可行。后端模型链路本体已验证可用（`2026-07-18-model-timeout-fix.md`：适配器 11 场景实测全过）。
>
> **版本**：v4（2026-07-21）。v1 发出后 Codex 完成 Task 0 盘点（结果附文末，保留原文）；v3 按盘点作出五项裁决；**v4 由用户拍板反转裁决 2**——新增规范化 message 表（即采纳 Codex 盘点时的原推荐），原 run 记录保护方案随之作废。**本文任务清单以 v4 为准。**
>
> **事实来源**：`CONTEXT.md`（术语）、`2026-07-18-lumi-frontend-rewrite.md`（轨道边界）、文末 Task 0 盘点结果（代码现状）、assistant-ui 官方文档（加 `.md` 后缀取 markdown 版）：
> - 适配器契约：https://www.assistant-ui.com/docs/runtimes/concepts/threads
> - 自有数据库示例（仅参考契约面，存储方案见决策 5）：https://www.assistant-ui.com/docs/integrations/persistence/custom-adapter

---

## 已定死的决策（执行中不得重开；v3 按盘点修订了 4、5）

1. **不用 Assistant Cloud**。也不写任何指向 `assistant-api.com` 的配置。
2. **assistant-ui 是正式前端基座**，不是实验页。对话相关 UI 不再自建第二套。
3. **对话必须走 Lumi 现有编排链路**（课程知识库、工具调用、runs 记录），不允许为 assistant-ui 新开"裸模型直连"的 `/api/chat`。
4. **运行时保留现状架子**：`useRemoteThreadListRuntime` + `useLocalRuntime`（盘点确认这就是 assistant-lab 现有结构）。**不迁移** `useChatRuntime` / AI SDK 路径——Lumi 回复是结构化 `replyJson`（教学策略、episode 等），LocalRuntime 的 `ChatModelAdapter` 直接消费 Lumi 自有流最贴合，省掉一层 AI SDK `UIMessage` 流协议转换；历史适配器随之用 `ThreadMessage`，**不需要 `withFormat`**。
5. **存储分两层，各管各的（2026-07-21 用户拍板）**：**新增规范化 message 表**（一行一条消息）作为 **UI 历史的权威**——界面读写它，`ThreadHistoryAdapter.append` 回归官方逐条落库契约，学生消息发出瞬间即持久化（"已发消息不丢"天然成立）；**`agent_turns` 及关联表保持教学/运行事实源**——洞察台、教师复核、runs 只读它，一行不改。**防两本账对不上的纪律**：message 表是 **Lumi 自定义 schema 的结构化列**（role、正文、附件引用、工具调用引用、`turnId` 回链），**禁止**存 assistant-ui / AI SDK 内部格式 blob（UI 库一升级历史就废）；写入单向——user 行由适配器 append 写，assistant 行由 `persistAgentTurn()` **同一事务**写（保证"turn 有则 message 必有"），**不写任何双向同步/对账逻辑**；删除 task 两处级联。已知代价：同一对话存两处，占双份空间，且两表理论上可漂移——靠"同事务写入"压住，出现漂移属 bug 要修。
6. **授权只有两条规则**：学生只见本人数据；教师可见学生数据。班级、课程是**数据字段，不是权限边界**。
7. **消息分支（branching）禁用**：UI 关闭"编辑消息后重新生成"，历史按线性链投影（`parentId` 指向前一条即可满足接口）。理由：分支污染洞察台统计与成长档案输入；线性存储配开启的编辑入口会造成"能点、刷新就丢"。
8. **对话搜索不做**（赛后 SQLite FTS5 补）。本期新增功能只有：自动标题、归档。
9. **数据库继续 SQLite + Drizzle**；赛后规模扩大直接升 PostgreSQL，不套 Cloud。

## Task 0 裁决（对盘点提出的 5 个问题；2026-07-21 规划侧定，有异议以用户后续指示为准）

1. **线程主键映射：`remoteId` ↔ `design_project_tasks.id`**（采纳盘点推荐）。UI 会话列表需要的一切——`title`、`ACTIVE/ARCHIVED`、改名归档端点、runs 与 project brief 归属——都在 task 上。`agent_conversations` 降为 task 内部的运行容器（课程包版本上下文），对 UI 不可见；历史 load 按 task 聚合其**全部** conversation 的 turns 按时间升序投影。
2. **单消息持久化口径：新增规范化 message 表（v4 用户拍板，采纳盘点原推荐）**，`agent_turns` 保留为教学/运行事实。演变记录：规划侧原判"不建表、turns 投影"→ 用户否决其代价（已发消息刷新即丢）→ 中间方案 run 记录保护 → **最终定案 message 表**（append 逐条落库天然解决丢消息，且免去投影转换层）。分工与纪律见决策 5。
3. **runtime 口径：保留 `useLocalRuntime`**（采纳盘点推荐），直接做 `ThreadMessage ↔ Lumi turn` 投影，无 `withFormat`。
4. **产品状态字段**：`mode`（`conversation | engineering`）**本期必须持久化**——它决定界面形态，丢了会导致跨设备后线程打开方式错乱；`pinned` 顺手保。两者作为 task 表新列（enum / boolean，Drizzle migration）。实验页 `projectId` 的工程分组语义与后端课程工程外键**不是一回事，禁止直接塞入**；其语义对齐另列后续，本期允许随 localStorage 丢弃。
5. **教师读取：新对话读取端点单独实现"任意合法教师可读任意学生对话"**（采纳盘点推荐），不复用 `assertTeacherClassAccess()`；现有班级边界机制在原有端点上原处不动，赛后多校时再统一收紧。

## 文件所有权

本计划横跨两条轨道。若前端轨道与重建轨道仍并行，后端任务（`app/api/**`、`lib/**`、`drizzle/**`）归重建轨道，前端接线归前端轨道，跨界改动走 F0 契约变更请求流程；若已合并为单会话执行，按任务顺序做即可。

---

## Task 1：对话运行时接 Lumi 编排（先能正确地聊，再谈存储）

- [ ] 确认并接通 assistant-lab 的 `ChatModelAdapter` → Lumi 现有 agent 对话端点（携带 task id、课程上下文）；若当前 adapter 连的是别的端点/直连模型，切换到编排链路。**编排逻辑本身不动**
- [ ] **停止**：assistant-ui 的取消信号（abort）必须传播到编排的停止逻辑，不能前端断了后端还在跑
- [ ] **重试**：接 runtime 的 reload（重发最后一轮），复用现有 runs 重试语义
- [ ] **中断恢复 UI**：user 消息已由 append 落库（决策 5），故刷新/换设备后，末尾"有 user 行无 assistant 行"的状态渲染为"已发消息 + 回答中断提示 + 重试"（重试走上一条的 runs 语义），不显示半截回复
- [ ] **工具调用透明展示**：`makeAssistantToolUI` 为主要工具各做展示组件（至少：知识库检索、五维会诊）。五维会诊卡遵守既有铁律——收束不得渲染成第六个并列维度
- [ ] **等待用户确认的操作**：映射为工具调用的 human-in-the-loop（前端确认后续跑）。若现有实现与此模式差距大，写 `DECISION NEEDED` 带现状描述，不硬改编排
- [ ] 验证：assistant-lab 发问能命中课程知识库、触发工具调用、runs 有记录；中途停止后端确实停

## Task 2：持久化后端端点（复用 tasks API，缺的补）

- [ ] 线程元数据复用 `GET/POST /api/agent/tasks` 与 `PATCH /api/agent/tasks/:taskId`（改名、`ACTIVE/ARCHIVED` 映射归档），**补单个 GET 与 DELETE**；DELETE 级联删除该 task 下 conversations / turns / 附件 / 工具调用（与现有库风格一致）
- [ ] task 表 Drizzle migration 加 `mode`、`pinned` 列（裁决 4）；列表返回形状适配 `RemoteThreadListAdapter`（含 `updatedAt` 倒序）
- [ ] **新增 message 表**（命名与列风格随现有库）：Drizzle migration 建表——`id`、`taskId`（FK，级联删）、`role`（`user | assistant`）、正文、附件引用、工具调用引用、`turnId`（回链教学事实，user 行可空）、`createdAt`；**Lumi 自定义 schema，禁止 UI 库格式 blob**（决策 5）
- [ ] **消息端点**：按 task 全量升序 load；append 单条（user 行走此路）。assistant 行不走端点——由 `persistAgentTurn()` 同一事务写入（若编排侧实现确有困难，写 `DECISION NEEDED`，不许改成前端双写）
- [ ] **存量回填**：一次性脚本把既有 turns 生成 message 行（一 turn 两行，ID 沿用 `${turnId}#u` / `${turnId}#a` 规则），老对话在新界面可见；脚本幂等可重跑
- [ ] 授权：学生端点沿用 `requireStudentSession` 仅本人；**教师读取按裁决 5 单独实现**，就两条规则，不写更细的

## Task 3：适配层与消息转换（技术核心）

- [ ] `RemoteThreadListAdapter` 指向 Task 2 端点（含 `mode`/`pinned` 经 custom 字段往返）
- [ ] `ThreadHistoryAdapter`：load 读 message 表全量升序，重建 `ThreadMessage` 线性链（`parentId` 指向前一条）；append 只负责把 user 消息写入消息端点；对 assistant 消息（已由后端事务写入）幂等 no-op
- [ ] **assistant 行内容转换**：`persistAgentTurn()` 写 message 行时从 `replyJson` 提取渲染所需内容（正文 + Lumi 自定义结构化 parts；作品附件挂 user 行，工具调用引用挂 assistant 行）
- [ ] **稳定 ID 规则**：回填数据 user = `${turnId}#u`、assistant = `${turnId}#a`、工具调用 = `${turnId}:${callSequence}`；新发的 user 消息用前端生成的 message id（append 时 turn 尚不存在），turn 落库后回填 `turnId` 列、id 不变
- [ ] **round-trip 测试**：纯文本、带作品图、带工具调用三类各至少一个"append/事务写入 → load → parts 结构合法"用例；从 `replyJson` 提取的内容与实时流式显示一致；外加"turn 落库后 assistant message 行同事务存在"的一致性用例
- [ ] 关闭消息编辑重发入口（禁用 branching 的 UI 面）
- [ ] 若转换发现某类信息无法呈现（丢真），写 `DECISION NEEDED` 报告丢的是什么

## Task 4：自动标题

- [ ] 首个回合完成后，异步调用现有模型网关生成标题（≤10 个汉字，无标点无引号），写回 `design_project_tasks.title`；失败静默保留默认标题，不阻塞对话
- [ ] 接 `RemoteThreadListAdapter` 的 `generateTitle` 约定（以官方契约页为准），列表即时刷新
- [ ] 提示词与调用在后端，不在前端拼 prompt

## Task 5：归档 + 收口

- [ ] ThreadList UI 接通归档/取消归档（映射 `ACTIVE/ARCHIVED`）与置顶
- [ ] assistant-lab 全面切到新链路与新适配层，**删除 localStorage 读写代码**；旧 localStorage 数据不迁移（实验期数据）
- [ ] 端到端手工验证：新建对话 → 发消息（含传图、触发工具调用）→ 中途停止一次 → 刷新完整恢复 → 换浏览器同账号可见同一列表 → 改名 → 归档 → 删除
- [ ] 验证洞察台通路：直接 SQL 查 `agent_turns` 能读到学生消息与回复正文（事实源未被 blob 化）

---

## 验收标准

1. assistant-lab 对话走 Lumi 编排链路：命中课程知识库、工具调用透明展示、runs 有记录——**不是裸模型直连**
2. 停止/重试可用，停止后后端确实终止
3. 刷新与跨设备后已完成回合完整恢复（含图片与工具调用展示）；**进行中回合的学生消息不丢**——恢复为中断提示 + 可重试；AI 半截回复不要求恢复
4. 会话列表有自动标题；可归档、置顶；`mode` 跨设备保持；按最近更新排序
5. 代码无对话相关 localStorage 依赖，无任何 Assistant Cloud 配置
6. `agent_turns` 教学事实源一行未改，洞察台数据通路完好；message 表为 Lumi 自定义结构化 schema，**全库无 UI 库格式 blob**
7. 三类消息的 round-trip 测试与"turn↔message 同事务一致"用例全绿

## 裁剪顺序（时间紧时）

置顶/`mode` 持久化 → 归档 → 等待确认操作的 human-in-the-loop（可先降级为纯文本提示）→ 无。**Task 1 运行时接编排与 Task 2/3 持久化不可裁**。自动标题尽量保（演示观感最大收益项）。搜索已裁，不要顺手实现。

## 纪律

1. 术语一律用 `CONTEXT.md`；文案不出现旧词
2. 不越文件所有权边界；跨轨道改动走契约变更请求
3. 官方文档拿不准的以 `.md` 版原文为准，不凭记忆写 API 名
4. 遇取舍无法自决，写 `> DECISION NEEDED:` 停下等用户确认

---

## Task 0 盘点结果（2026-07-21，Codex；保留原文，其 DECISION NEEDED 已由上方"Task 0 裁决"回答）

盘点范围：`feature/lumi-frontend` worktree 当前代码、已安装的 `@assistant-ui/react@0.14.27` 类型，以及 assistant-ui 官方 persistence / threads 契约。以下仅记录现状。

### `/assistant-lab` 当前 localStorage 形状

- 线程列表 key：`lumi:assistant-ui-lab:threads:v1`
- 单线程历史 key：`lumi:assistant-ui-lab:history:v1:${threadId}`
- 线程元数据 `LabStoredThread`：`status`、`remoteId`、可选 `title`、`lastMessageAt`、`projectId`、`pinned`、`mode`（`conversation | engineering`）
- 消息仓库是 assistant-ui 的 `ExportedMessageRepository`：可选 `headId`，以及 `messages[] = { message: ThreadMessage, parentId, runConfig? }`
- `append()` 以 `message.id` upsert 单条消息并更新 `headId`；`delete()` 删除单条/多条消息。当前数据形状保留 `parentId`，因此能表达分支；按已定死决策，正式接入时不再提供分支 UI，且实验页数据默认不迁移。
- 线程列表通过 `updateCustom()` 持久化 `pinned`、`projectId`、`mode`。这些不是 assistant-ui 必需字段，却是当前 Lumi 实验界面正在使用的产品状态。
- 当前 runtime 是 `useRemoteThreadListRuntime(...) + useLocalRuntime(...)`，不是 `useChatRuntime` / `useAISDKRuntime`。

### Lumi 现有后端形状

- `design_project_tasks`：有 `id`、`studentId`、`classId`、非空 `title`、`status = ACTIVE | ARCHIVED`、`createdAt`、`updatedAt`；runs、project brief、附件均以 `taskId` 归属它。
- `agent_conversations`：有 `id`、`taskId`、学生/班级、可选 `projectId`、课程包及时间；**没有** `title`、`status`。同一 task 会按课程包版本和 project 上下文选择/创建 conversation。
- `agent_turns`：不是一行一条消息，而是一行一个已完成问答回合；同一行同时保存 `studentMessage` 和结构化 `replyJson`，并包含教学策略、episode、来源、延迟等字段。
- 图片：`agent_artwork_attachments` 以 `turnId` 关联，当前约束为每 turn 最多一张，保存 MIME、路径、摘要、尺寸等结构化字段。
- 工具调用：`agent_tool_calls` 以 `turnId + callSequence` 关联，结构化保存工具、适配器、输入、输出、状态和错误。
- 写入路径：`persistAgentTurn()` 在模型回复完成后用一个事务创建/更新 conversation，并一次性写入配对的学生输入与助手回复，再写附件、工具调用、行动、步骤和 runtime events。不存在"先 append 用户消息、后 append 助手消息"的现成写入原语。
- 读取路径：`GET /api/agent/conversation` 只接受学生会话，按 task 读取最近 30 个完整 turn；它不是"按 thread 全量升序读取独立消息"的端点。
- 线程 API 近似物：`GET/POST /api/agent/tasks` 和 `PATCH /api/agent/tasks/:taskId` 已支持学生自己的列表、创建、改名、归档/取消归档；缺少单个 GET 和 DELETE。
- 鉴权现状：agent conversation / task / run 路由全部使用 `requireStudentSession`。教师端现有通用机制 `readTeacherScope()` / `assertTeacherClassAccess()` 明确区分 GLOBAL 与 CLASS，并把班级作为读取边界。

### 现状 ↔ 适配器契约

| 契约面 | assistant-ui / 实验页现状 | Lumi 现有后端 | 结论（v3 裁决后） |
|---|---|---|---|
| thread identity | `remoteId` 是一个线程 ID | task 与 conversation 两个候选 | **定为 task.id**（裁决 1） |
| list / create | `RemoteThreadListAdapter.list/initialize` | tasks 已有 GET/POST | 复用，返回形状适配 |
| rename / archive | `rename/archive/unarchive` | task PATCH 支持标题与 `ACTIVE/ARCHIVED` | 直接映射 |
| fetch / delete | Adapter 要求单个 fetch/delete | task 单路由只有 PATCH | Task 2 补 GET/DELETE |
| custom metadata | `pinned/projectId/mode` | task 无对应列 | `mode`/`pinned` 加列；`projectId` 延后（裁决 4） |
| history load | 全量线性消息仓库 | conversation API 上限 30 turn | 新增 message 表 + 全量 load 端点（v4 裁决 2） |
| history append | 逐条 append | `persistAgentTurn()` 回合事务 | user 行逐条 append；assistant 行随 turn 同事务写入（v4 裁决 2） |
| text | `ThreadMessage` text part | `student_message` + 结构化 `reply_json` | 投影重建（Task 3） |
| image | 消息附件 | 每 turn 最多一个作品附件 | 挂 user 消息（Task 3） |
| tool call | tool-call parts | `agent_tool_calls` 按 `turnId+callSequence` | 挂 assistant 消息，稳定 ID（Task 3） |
| runtime format | LocalRuntime + `ThreadMessage` | — | **保留 LocalRuntime**（裁决 3），无 `withFormat` |
| authorization | Adapter 不管授权 | 学生仅本人；教师按班级边界 | 教师读取单独实现全局路径（裁决 5） |
