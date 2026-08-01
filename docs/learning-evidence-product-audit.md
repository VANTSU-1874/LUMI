# 学习证据闭环产品审查

审查日期：2026-07-15
审查基准：`Product-Spec.md`、`Design-Brief.md`、`DEV-PLAN.md`
审查范围：学生证据提交、Agent 证据上下文、确定性排障、迁移门禁、教师复核、书籍设计微闭环

> 2026-07-16 实施追踪：P0-1 至 P0-4 均已实现。下文 HIGH-01 至 HIGH-05 保留为问题来源快照；每项“完成标准”之后追加当前修复证据。全量测试、浏览器、安装版和真实模型复评仍是重新验收门，不因专项测试通过而提前关闭发布门。

## 结论

**Stage 1 未通过。** 当前实现已经具备安全存储、结构化探针、确定性排障、历史记录和删除能力，但“学习证据 → Agent 判断 → 教师核验 → 迁移评价”的完整闭环仍有 5 个 P0 断点。

这不是代码有没有的问题，而是产品语义没有闭合：界面称为“教师可复核”，实际教师不能查看多数证据内容，也不能通过当前教师界面把 `SUBMITTED` 证据变成 `TEACHER_VERIFIED`；Agent 读取的是证据元数据，不是证据证明的事实；书籍设计证据只能看汇总，不能成为教师复核对象。

按飞才代码审查规则，Stage 1 存在 HIGH 问题，本轮不进入一般代码风格和低优先级视觉细节的 Stage 2。应先完成 P0 闭环修复，再从 Stage 1 重新验收。

## 已完整实现

### 1. 证据安全与所有权

- 学生只能向自己的项目提交证据，且只能在 `BUILD` / `TROUBLESHOOT` 阶段写入：`lib/services/evidence.ts:245-249`、`lib/services/evidence.ts:328-342`。
- 图片限制类型、大小、路径和私有存储；学生与授权教师读取受所有权/班级约束：`lib/services/private-evidence.ts:78-121`。
- 删除同时处理数据库记录、私有文件、审计事件和失败恢复：`lib/services/private-evidence.ts:123-190`。

### 2. 结构化探针与确定性排障

- 输入、映射、传输、绑定和输出五层探针均有严格 Schema：`lib/domain/evidence-probe.ts:9-92`。
- 只有规则或教师验证的证据才会推进排障：`lib/services/troubleshooting-service.ts:71-78`。
- 排障逐层推进，连续三轮没有新证据后转教师，不由模型猜测：`lib/services/troubleshooting.ts:89-165`。

### 3. 草稿、正式证据与删除边界

- 书籍设计草稿、正式提交和重置已分离；重置不删除历史正式证据：`components/student/BookLayoutLab.tsx:122-187`。
- 学生历史证据支持分页、失败重试和二次确认删除：`components/common/EvidenceHistory.tsx:38-118`、`components/common/EvidenceDeletionList.tsx:14-77`。

## P0 / HIGH 问题

### HIGH-01：教师“追加决定”没有完成证据验证

**规格要求：** `Product-Spec.md` FLOW-003、FLOW-005 与 REQ-009 要求教师查看证据链并确认、纠正或要求复核。

**实际实现：**

- 教师页面的“保存教师决定”调用的是追加审计决定：`components/teacher/LearnerDetail.tsx:42`。
- `appendTeacherDecision` 只写 `teacher_decisions`，不会修改证据的 `verification_status`：`lib/services/teacher-decisions.ts:72-124`。
- 真正能把证据改为 `TEACHER_VERIFIED` / `REJECTED` 的 `verifyEvidenceAsTeacher` 存在于服务层，但没有公开 API，也没有教师 UI 调用；生产代码中没有调用点：`lib/services/evidence-verification.ts:33-62`。
- 排障只接受 `RULE_VERIFIED` / `TEACHER_VERIFIED`，所以普通文本、数值、图片和视频即使教师点击“确认”，仍然不能推进排障：`lib/services/troubleshooting-service.ts:71-78`。

**用户结果：** 页面让教师以为已经确认证据，但学生的正式学习状态没有改变。当前“等待规则或教师确认”文案属于死引导。

**完成标准：** 教师必须先看到证据内容，再通过一个事务化操作追加教师决定并更新证据的派生验证状态；原始提交和历史决定必须保留，不允许覆盖审计记录。

### HIGH-02：教师无法看到多数证据内容

**实际实现：**

- 教师分析只取 `id / kind / layer / verification / code / sequence`，不取标签、文本、数值、探针详情或图片预览：`lib/services/teacher-analytics.ts:180-195`。
- 教师页面展示的是“证据 OUTPUT：RULE_VERIFIED”一类摘要和删除按钮，没有“查看证据”入口：`components/teacher/LearnerDetail.tsx:41-42`。
- 本机 3100 生产界面实测，教师学习者详情中没有证据预览链接、没有图片，只有复核下拉框和删除按钮。

**用户结果：** 教师无法判断图片、视频、文本或数值是否真的支持学生的判断，却可以点击“确认”。这不构成有效复核。

**完成标准：** 教师详情提供受保护的证据查看器：文本/数值/探针显示结构化内容，图片走授权流式预览，视频只显示经过校验的外链；默认不暴露私有路径和摘要哈希。

### HIGH-03：单工具路径无法从 UI 提交正确的传输层探针

**实际实现：**

- 学生表单在传输层始终生成 OSC `TRANSPORT_RECEIPT`：`components/student/EvidencePanel.tsx:123-126`。
- 服务端规定：协同路径使用 OSC 回执；DigiShow 或 TouchDesigner 单工具路径必须使用 `LOCAL_CHANNEL_RECEIPT`：`lib/domain/evidence-probe.ts:123-138`。
- 当前 UI 没有本地通道的“源通道 / 目标通道 / 接收值”字段。
- 预置演示 A、B 已直接写入本地回执，因此完成态演示掩盖了真实学生无法填写的问题。

**用户结果：** DigiShow 或 TouchDesigner 单工具项目无法由学生界面完成五层规则证据链，后续完整排障和迁移可能被卡死。

**完成标准：** EvidencePanel 必须读取当前工具路径；单工具显示本地通道回执，协同路径显示 OSC 回执，并增加两条端到端测试，禁止用种子数据替代真实填写。

### HIGH-04：Agent 读取的是证据元数据，不是“证据事实”

**规格要求：** Agent 应结合项目与证据，引导学生识别关系、验证判断并迁移方法。

**实际实现：**

- Agent 最近证据上下文只有 `kind / signalLayer / label / verificationStatus`，最多 5 条：`lib/agent/orchestrator.ts:50-63`、`lib/agent/orchestrator.ts:109-127`。
- 没有注入已确认代码、结构化观察结果、前后数值、教师复核结论或“这条证据证明了什么”。
- 因此 Agent 能知道“存在一条映射证据”，但不知道“输入 0–1 被映射为 0–360”这一学习事实。

**用户结果：** “导师正在读取学习证据”的文案成立得不充分。Agent 目前只能根据证据状态导航，不能真正依据已验证事实解释下一步。

**完成标准：** 建立不泄露私有文件的 `VerifiedEvidenceFact` 摘要，由确定性规则/教师决定生成；Agent 只接收已授权、已验证、与当前问题相关的事实摘要，并保留“不知道图片具体内容”的边界。

**2026-07-16 修复证据：**

- `lib/agent/verified-evidence-facts.ts` 用确定性 Schema 将规则探针、教师确认文本/数值和媒体存在性转换为事实；未经验证的清单项不产生事实。
- `lib/agent/orchestrator-context.ts` 按当前问题筛选最多 5 条事实；`lib/agent/model-decision.ts` 将“证据清单”和“已验证事实”分区，并强制事实来源与媒体不确定性。
- `lib/agent/orchestrator.ts` 只把实际使用的事实公开为 `LEARNING_RECORD` 来源；确定性降级与项目工具复用同一脱敏事实。
- 路径、URL、主机和端口在进入模型前脱敏；图片/视频只说明存在与教师验证状态，不声称识别画面。专项 3 个测试文件、27 项通过。

### HIGH-05：书籍设计证据不能被教师复核

**规格要求：** `Product-Spec.md` FLOW-004 第 5 步要求书籍设计结果进入通用迁移记录并由教师复核。

**实际实现：**

- 书籍证据以 `BOOK_LAYOUT_EVIDENCE_SUBMITTED` 审计事件保存并在教师端显示分数摘要：`lib/services/teacher-analytics.ts:275-283`。
- 它没有进入 `reviewTargets`；教师只能看到“4/4 通过”卡片，不能选择该证据执行确认、纠正或待复核：`lib/services/teacher-analytics.ts:193-196`、`components/teacher/LearnerDetail.tsx:66`。

**用户结果：** 书籍设计证明了第二课程包可以提交结果，但没有证明两个课程包共享同一教师证据闭环。

**完成标准：** 将书籍版面证据纳入通用教师复核目标，至少展示受众、页序、诊断答案、迁移选择、4 项规则结果和历史教师决定。

**2026-07-16 修复证据：**

- `BOOK_LAYOUT_EVIDENCE` 已进入 `TeacherDecisionInput`、原始快照联合类型、数据库约束和追加式决定时间线；书籍目标固定 `projectId=null`，项目型目标仍禁止空项目。
- `BookLayoutReviewViewer` 完整显示受众、8 页顺序、3 个诊断答案、迁移选择、4 项规则、得分和通过状态，并复用确认/纠正/待复核表单。
- `readLearnerDetail` 返回书籍完整不可变复核快照、历史决定与每目标最新决定；书籍决定也更新班级分析时间。
- 迁移 `0030_gigantic_blur.sql` 保留旧决定、外键和既有触发器，并校验书籍页序唯一性、选择集合、四项规则与得分一致性。专项服务、迁移、组件和工作区测试已通过；完整 E2E 已加入本轮门禁。

## P1 / MEDIUM 问题

### MEDIUM-01：默认演示入口无法体验学习证据

- “可学习的演示账号”进入后停在逻辑卡，尚未出现证据记录。
- A/B/C 三个完成态账号只显示历史证据，不显示证据提交和排障操作。
- 本机实测 5 个受控演示身份，没有一个处于 `BUILD` / `TROUBLESHOOT` 可直接体验证据提交的状态。

**建议：** 增加一个明确标注的“证据排障演示档案”，从 Agent 问题开始，允许评委亲自提交一条结构化证据并看到排障推进。

### MEDIUM-02：术语与高职学生交互不够一致

- Spec FLOW-003 使用“输入、处理、映射、绑定、输出”，课程包与代码使用“输入、映射、传输、绑定、输出”。
- 历史证据仍显示 `OUTPUT · PROBE · RULE_VERIFIED` 等英文枚举。
- EvidencePanel 将五类证据、五层信号和多字段探针一次性交给学生，缺少“Agent 已请求哪条证据”的预选与示例。

**建议：** 统一五层术语；面向学生全部中文化；由行动卡带入预选层、证据类型、示例标签和“为什么现在记录它”，高级字段再展开。

## 测试与实机证据

- `GET http://127.0.0.1:3100/api/health`：200；数据库、模型、Agent V2、两个课程包知识和 31 题质量报告均显示就绪。
- 针对性 Vitest：6 个文件、48 项测试全部通过。
- 本机受控生产界面实测：学生默认演示停在逻辑卡；完成态档案只能看历史证据；教师详情没有证据内容查看器。
- 原 Playwright 全量启动未重复执行，因为 3000/3100 正被当前临时预览占用；没有停止用户正在使用的预览服务。本轮使用独立无头 Chrome 直接验证 3100 的真实生产界面。

## 修复顺序

1. **P0-1 教师证据查看与事务化验证**：先让教师“看得见、验得动”，闭合普通证据状态。
2. **P0-2 路径感知探针表单**：补齐 DigiShow/TouchDesigner 本地回执，建立真实填写 E2E。
3. **P0-3 VerifiedEvidenceFact**：让 Agent 读取证据证明的事实，不读取私有路径或假装理解图片。
4. **P0-4 书籍设计通用复核目标**：用相同教师决定协议复核书籍证据。
5. **P1 引导与演示档案**：行动卡预填证据、中文化状态、增加中段体验账号。

## 重新验收门槛

**当前状态：** 功能项与发布门已通过：120 个 Vitest 文件、1052 项测试、严格 typecheck、零警告 lint、生产构建、14/14 Harness、20/20 Playwright 和生产依赖零已知漏洞。`2bf6af7` 不可变安装版复用已通过且仍匹配当前Agent内核的31题真实模型报告，健康门为 `competitionReady=true`；临时公网学生/教师登录、0人试用班可见和匿名报告下载均已复验。Phase 6 已创建首轮专用 REAL 试用班、8个未认领编号、匿名聚合报告和四项强制人工观察，但真实学生试用、真人计时和第二设备仍是外部验收项，不能用当前演示记录替代。

- 文本、数值、图片、视频和探针均能被教师查看并作出有效复核。
- 教师确认后证据状态和排障可用性同步变化，原始提交与决定时间线仍可追溯。
- DigiShow、TouchDesigner、协同路径都能从真实 UI 完成五层证据链。
- Agent 回答能引用已验证事实，同时对未读取的图片/视频内容明确不确定性。
- 书籍设计版面证据能够被教师确认、纠正或标记待复核。
- 新增失败用例后全量 Vitest、lint、build、Playwright、Agent Eval 全部通过。
