# “触映”比赛 MVP 发布审计

> **⚠️ 历史材料（已被 Lumi 当前材料取代）**：本文仅保留作历史记录，不代表当前产品能力、评测或发布状态。现行演示与部署边界见 [Lumi 比赛演示脚本](../runbooks/demo-script.md) 和 [Lumi S0 部署冒烟 Runbook](../runbooks/deploy-s0.md)。

> 本文是2026-07-13的历史基线快照。当前Agent架构、安装版、临时公网和真实试用准备状态以[2026-07-16教育Agent竞赛可交付完成度审计](agent-competition-readiness.md)为准；下方旧数字保留用于追溯，不得当作当前发布状态。

## 审计结论

- 审计日期：2026-07-13（Asia/Shanghai）
- 审计对象：`feature/tonggan-mvp`，实现基线 `ae7d1e8931e0036284f2cfb18172c5ae3b9d7c73`
- 本地结论：核心课程闭环已通过自动化验证和一次机器辅助本地演练。
- 发布结论：**不可创建 `competition-mvp-v1` 标签**。
- 阻断原因：公网地址、HTTPS 实机健康检查、正式二维码、两台设备跨网络扫码、人工 10 分钟讲解演练和比赛冒烟表双人签名均未完成。
- 真实性边界：当前结果证明的是原型逻辑、演示数据和本地运行，不证明真实学生人数、成绩提升、满意度或课堂成效。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| `VERIFIED_AUTOMATED` | 有本仓库单元、集成或浏览器自动化测试证明。 |
| `VERIFIED_LOCAL` | 2026-07-13 在独立本地演示库中实际启动网站并由浏览器走查。机器辅助演练不等于人工讲解或公网实测。 |
| `PENDING_EXTERNAL` | 需要已确认公网环境、实体设备、人工签名或真实课程资料，本地不可替代。 |

## 规格到实现映射

| 规格要求 | 状态 | 路由与界面 | 测试与手册 | 关键提交 |
| --- | --- | --- | --- | --- |
| 学生、教师双入口与角色隔离 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | `/`、`components/entry/EntryForm.tsx`、`/student`、`/teacher`、`/api/auth/student`、`/api/auth/teacher` | `tests/integration/auth-routes.test.ts`、`tests/e2e/student-flow.spec.ts`、`tests/e2e/teacher-flow.spec.ts` | `571928c`、`dc7c041` |
| 班级邀请码、预签发匿名编号、签名会话 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | `/api/auth/student`、`lib/auth/identity-code.ts`、`lib/auth/session.ts` | `tests/integration/access.test.ts`、`tests/unit/identity-code.test.ts`、`docs/runbooks/trusted-auth-proxy.md` | `4df06a0`、`599ae9b` |
| 10 道情境诊断、五维画像、L1–L4 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | `/api/diagnostic`、`components/student/DiagnosticFlow.tsx`、`data/diagnostic/questions.ts` | `tests/unit/diagnostic.test.ts`、`tests/integration/diagnostic-profile.test.ts`、`tests/e2e/release-rehearsal.spec.ts` | `9b7b3bd`、`3976bf4`、`ee03ed5`、`21f33ee` |
| 诊断完成后进入六元交互逻辑 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | `lib/services/diagnostic-profile.ts`、`components/student/StudentShell.tsx` | `tests/integration/diagnostic-profile.test.ts`、`tests/e2e/release-rehearsal.spec.ts` | `ee03ed5`、`21f33ee` |
| 六元逻辑不可绕过；无模型语义审查不自动放行 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | `/api/projects/[projectId]/logic-card`、`components/student/LogicCardForm.tsx`、`lib/services/logic-card-service.ts` | `tests/integration/project-workflow-routes.test.ts`、`tests/e2e/student-flow.spec.ts`、`tests/e2e/release-rehearsal.spec.ts` | `264a7d2`、`4b2894e` |
| DigiShow、TouchDesigner、协同三条路径 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | `/api/projects/[projectId]/tool-path`、`components/student/ToolPathPlan.tsx`、`lib/services/tool-path.ts` | `tests/unit/tool-path.test.ts`、`tests/integration/tool-path-plan.test.ts`、`tests/e2e/tool-path-persistence.spec.ts`、`tests/e2e/release-rehearsal.spec.ts` | `d9b99ce`、`5c45c0d`、`ae7d1e8` |
| 生成后的路径原因、里程碑、证据条件可回看 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | `components/student/ToolPathPlan.tsx` 中的 `ToolPathSummary`、学生 BUILD/TROUBLESHOOT/TRANSFER/COMPLETE 工作区 | `tests/e2e/tool-path-persistence.spec.ts`、`tests/e2e/release-rehearsal.spec.ts` | `ae7d1e8` |
| 三级提示；必须先有个人判断和阶段证据 | `VERIFIED_AUTOMATED` | `/api/projects/[projectId]/hints`、`components/student/StudentShell.tsx` 中的 `HintPanel`、`lib/services/hints.ts` | `tests/unit/hints.test.ts`、`tests/integration/evidence-hints.test.ts`、`tests/unit/student-hint-panel.test.tsx` | `8fe95cd`、`5708bb6`、`695377e` |
| 文本、数值、链接、图片和结构化探针证据；图片私有存储 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | `/api/projects/[projectId]/evidence`、`/api/evidence`、`/api/evidence/[evidenceId]`、`EvidencePanel`、`EvidenceHistory` | `tests/integration/evidence-routes.test.ts`、`tests/integration/private-evidence-route.test.ts`、`docs/runbooks/evidence-storage.md` | `f4a35e8`、`36feb0e`、`1a79c55` |
| 五层证据驱动排障；证据不足时给唯一下一步或转教师 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | `/api/projects/[projectId]/troubleshooting`、`components/student/TroubleshootingFlow.tsx` | `tests/integration/troubleshooting-service.test.ts`、`tests/unit/troubleshooting.test.ts`、`tests/e2e/release-rehearsal.spec.ts` | `f4a35e8`、`edaf6ce` |
| 有边界迁移挑战、统一量规、最多两次、失败转教师 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | `/api/projects/[projectId]/transfer`、`components/student/TransferChallenge.tsx`、`lib/services/transfer.ts` | `tests/integration/transfer-service.test.ts`、`tests/unit/transfer.test.ts`、`tests/e2e/release-rehearsal.spec.ts` | `522c234`、`b956d54`、`8cc8ddf`、`08f8fd3` |
| 教师班级分析、个体档案、原判断留存和教师覆盖决定 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | `/api/teacher/dashboard`、`/api/teacher/learners/[studentId]`、`/api/teacher/decisions`、`TeacherWorkspace`、`LearnerDetail` | `tests/integration/teacher-analytics.test.ts`、`tests/integration/teacher-decision.test.ts`、`tests/e2e/teacher-flow.spec.ts`、`tests/e2e/release-rehearsal.spec.ts` | `7a5f8e1`、`87e1aca`、`4c17f42`、`562217d` |
| 三个预置案例、四档演示画像、演示数据全链路标注 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | `data/demo/cases.ts`、`scripts/seed-demo.ts`、`DemoBadge`、学生/教师工作区 | `tests/integration/demo-seed.test.ts`、`tests/e2e/demo-mode.spec.ts`、`tests/e2e/release-rehearsal.spec.ts` | `291aa82`、`e5f228c`、`a4eb0d1` |
| 演示数据默认不进入真实教学统计，显式包含后仍分栏 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | `/api/teacher/dashboard?includeDemo=true`、`ClassOverview` | `tests/integration/teacher-analytics.test.ts`、`tests/e2e/demo-mode.spec.ts`、`tests/e2e/release-rehearsal.spec.ts` | `e5f228c`、`87e1aca` |
| 预置演示案例回放与原型测试结果 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | 预签发 A/B/C 演示档案、学生只读逻辑/路径摘要、教师个体档案 | `tests/integration/demo-seed.test.ts`、`tests/e2e/release-rehearsal.spec.ts` | `291aa82`、`ae7d1e8` |
| 匿名化、证据删除、图片净化说明、不接收人脸原视频 | `VERIFIED_AUTOMATED` | `/privacy`、私有证据 GET/DELETE、`lib/security/uploads.ts` | `tests/unit/privacy-error.test.tsx`、`tests/integration/private-evidence-route.test.ts`、`docs/runbooks/competition-smoke-test.md` | `8059bbb`、`08f56bd`、`2207231` |
| 模型不可用时明确“确定性降级”，规则/本地资料/排障继续，绝不自动通过 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | `FallbackModeBadge`、`lib/ai/client.ts`、`lib/services/semantic-logic-review.ts`、`/api/health` | `tests/unit/fallback-mode.test.ts`、`tests/integration/health-route.test.ts`、`tests/e2e/demo-mode.spec.ts`、`tests/e2e/release-rehearsal.spec.ts` | `57e6dcc`、`291aa82` |
| 响应式独立网站、手机/键盘基本可用 | `VERIFIED_AUTOMATED` | Next.js 页面、学生/教师工作区、全局错误页 | `tests/e2e/accessibility.spec.ts`、`tests/e2e/student-flow.spec.ts` | `44d4bc4`、`40516d8`、`bfbad3b` |
| 64 课时四阶段嵌入 | `VERIFIED_AUTOMATED`、`VERIFIED_LOCAL` | `scripts/seed-demo.ts`、`CurrentProject` | `tests/integration/demo-seed.test.ts`、`tests/e2e/release-rehearsal.spec.ts` | `291aa82` |
| 健康检查、恢复、备份与回滚手册 | `VERIFIED_AUTOMATED` | `/api/health`、backup/restore/recover scripts | `tests/integration/health-route.test.ts`、`tests/integration/backup-operations.test.ts`、`docs/runbooks/deployment.md` | `7db0267`、`dfd485b`、`85e817b`、`36db0ed` |
| 公开 HTTPS 链接 | `PENDING_EXTERNAL` | 代码支持 `PUBLIC_APP_URL`，当前未设置 | `docs/runbooks/deployment.md`、`docs/runbooks/competition-smoke-test.md` | `7db0267` |
| 正式二维码、两台设备跨网络扫码 | `PENDING_EXTERNAL` | `scripts/generate-qr.ts`；当前 `public/competition-qr.svg` 不存在 | `tests/unit/generate-qr.test.ts`、`docs/runbooks/competition-smoke-test.md` | `c43dd35` |

### 规格边界说明

- 设计说明 §5.2 的教师“创建任务、配置设备、管理案例”是完整产品场景；比赛原型 §13 的交付范围只落实了教师分析、个体档案和复核覆盖。仓库没有课程任务编辑器或案例管理后台，不把它们伪报为已完成。
- 当前知识库包含课程原则、DigiShow 信号、TouchDesigner 基础和排障资料。设计说明 §11 所列“10–20 份历届匿名作业、教师评语和学生反馈”尚未由课程负责人提供；当前三个案例是明确标注的演示数据，不是历史课堂实证。
- 没有真实新生试用数据。设计说明 §14 的真实案例比对和开课后课堂实证仍属 `PENDING_EXTERNAL`，不得将演示画像或自动化结果改写为教学成效。

## 排除范围审计

搜索范围为应用、组件、库、脚本、数据与测试；文档中的“明确不做”单独列出。搜索词覆盖 `desktop/electron/pyautogui/autohotkey`、项目文件生成、`camera/webcam/getUserMedia/MediaStream`、视频流、小程序/WeChat、multi-school/多学校/教务。

| 排除项 | 代码搜索结果 | 文档命中 | 结论 |
| --- | --- | --- | --- |
| 自动控制学生桌面 | 无 Electron、桌面控制或自动化实现。`Desktop Chrome` 只出现在 Playwright 浏览器配置。 | 设计说明 §13、实施计划开头明确排除。 | 保持排除。 |
| 自动生成或编辑完整项目文件 | 无 DigiShow/TouchDesigner 文件写出器。课程知识仅声明不生成完整项目文件。 | 设计说明 §4.3、§13 明确排除。 | 保持排除。 |
| 摄像头和实时视频识别 | 无 `getUserMedia`、MediaStream 或摄像头采集。证据支持外部 HTTPS 视频链接，但不抓取视频流。 | `/privacy` 与设计说明 §13、§16 明确不接收原始人脸视频。 | 保持排除。 |
| 微信小程序 | 无小程序工程、微信 SDK 或接口。 | 设计说明 §9.2、§13 明确排除。 | 保持排除。 |
| 多课程、多学校管理 | 无学校租户、学校管理员、课程 CRUD。教师班级列表只是授权范围内的查询，不是多校管理。 | 设计说明 §13 明确排除，§18 列为后续扩展。 | 保持排除。 |
| 教务系统对接 | 无教务 API、同步任务或账号联邦。 | 设计说明 §13、§18 明确排除。 | 保持排除。 |

未发现意外范围扩张。

## 演示数字追溯

| 展示数字/状态 | 唯一来源 | 自动核对 |
| --- | --- | --- |
| 64 课时 = 8 + 16 + 24 + 16 | `scripts/seed-demo.ts` 的 `MODULES` | `tests/integration/demo-seed.test.ts`；本地工作台显示 64 课时/4 模块。 |
| 3 个案例、3 条工具路径 | `data/demo/cases.ts` 的 `DEMO_CASES` | `tests/integration/demo-seed.test.ts` 核对 DIGISHOW、TOUCHDESIGNER、COLLABORATIVE。 |
| 4 个演示画像，L1–L4 各 1 | `data/demo/cases.ts` 的 `DEMO_PROFILES` | `scripts/seed-demo.ts` 事务写入；教师本地演练显示真实 0 人、演示 4 人。 |
| 每案例 5 条结构证据，共 15 条 | `data/demo/cases.ts` 每案 INPUT/MAPPING/TRANSPORT/BINDING/OUTPUT 探针 | `tests/integration/demo-seed.test.ts` 核对 15 条均为 `RULE_VERIFIED` 和 `DEMONSTRATION_DATA`；本地 C 档显示 5 条。 |
| 每案 1 个注入故障、1 个预期层、1 个确定性下一步 | `data/demo/cases.ts` 的 `injectedFault` | `scripts/seed-demo.ts` 写入 troubleshooting；本地 C 档显示 TRANSPORT 与“核对 OSC 地址、端口和接收值”。 |
| 每案 1 个迁移挑战、1 次通过记录 | `data/demo/cases.ts` 与 `scripts/seed-demo.ts` | `tests/integration/demo-seed.test.ts`；本地 C 档学生端和教师端均显示 PASSED。 |
| 10 道诊断题、5 个维度、L1–L4 | `data/diagnostic/questions.ts`、`lib/services/diagnostic.ts` | `tests/unit/diagnostic.test.ts`；本地 D 档完成 10 题后进入六元卡。 |
| 3 级提示 | `lib/services/hints.ts` 的顺序门控 | `tests/unit/hints.test.ts`、`tests/integration/evidence-hints.test.ts`。 |
| 迁移最多 2 次 | `lib/domain/transfer.ts` 与数据库约束 | `tests/integration/transfer-service.test.ts`、`tests/unit/transfer.test.ts`。 |
| 本地演练耗时 | `tests/e2e/release-rehearsal.spec.ts` 当次 `performance.now()` 输出 | 仅代表机器辅助操作，不作为教学成效或人工演讲速度。 |

身份码只从受控 seed 当次输出取得；本清单不复制完整匿名编号，不把演示登录凭据写入比赛截图。

## 机器辅助本地演练

- 时间：2026-07-13 17:43（UTC+08:00，最终全量 E2E 运行）
- 环境：Windows；Node `v24.14.0`；pnpm `11.7.0`；Playwright Desktop Chrome；本地 Next.js；独立 `.runtime` SQLite 与私有证据目录。
- 模型：没有设置任何 `LLM_*` 变量，界面显示“确定性降级模式”。
- 数据：`tests/e2e/seed-student-flow.ts` 只创建普通 E2E 初始库并调用真实 `seedDemoDatabase`；`tests/e2e/release-rehearsal.spec.ts` 每轮单独创建演示 D 的诊断项目，完成后删除项目与本轮审计记录、复原画像和 C 档快照。发布专用状态不进入全局种子。
- 回放边界：测试仅在隔离数据库中把 C 的同一预置快照依次置于 TOOL_PATH、TROUBLESHOOT、TRANSFER、COMPLETE 以展示持久记录；这不是伪造的新学生学习过程，也不修改生产数据。

| 环节 | 当次机器操作耗时（单次样本） | 实际看到的结果 |
| --- | ---: | --- |
| 首页问题陈述 | 246 ms | 首页标题、课程智能体用途和角色入口。 |
| 诊断 | 446 ms | D 档完成 10 题后直接进入六元卡，无工作台错误。 |
| 六元素门 | 886 ms | 无模型提交完整卡后保持 PENDING，工具路径仍锁定。 |
| TouchDesigner 路径 | 644 ms | B 档本地界面显示 TOUCHDESIGNER 的只读推荐原因、里程碑和证据条件。 |
| 协同路径 | 957 ms | C 档生成 COLLABORATIVE；原因、里程碑、证据条件在 BUILD 和 reload 后可见。 |
| 排障 | 147 ms | 当前层 TRANSPORT，已确认事实/待验证假设/唯一下一步可见。 |
| 迁移 | 132 ms | 有边界挑战与 PASSED 结果可见。 |
| 教师分析 | 814 ms | 默认排除演示；显式包含后显示真实 0/演示 4，并打开 C 档证据、排障和迁移结果。 |
| 总计 | 5,420 ms | 这是测试内单次计时，会随机器负载浮动，不是固定性能阈值；所在全量浏览器命令为 `13 passed (23.4s)`。 |

### 10 分钟人工讲解预算

这只是演讲预算，**尚未由教师真人计时并签名**。

| 时间 | 内容 | 演示动作 |
| --- | --- | --- |
| 0:00–1:00 | 课程痛点与证据边界 | 说明 64 课时、高职学生认知负担；明确演示数据不代表成效。 |
| 1:00–2:00 | 情境诊断与画像 | 快速展示 10 题、五维画像和分层支持。 |
| 2:00–3:30 | 六元交互逻辑 | 用安岳石刻案例解释六项；演示无模型不自动放行。 |
| 3:30–5:00 | DigiShow 入门路径 | 展示距离输入、三档映射和阶段证据。 |
| 5:00–6:30 | DigiShow + TouchDesigner 协同 | 展示 OSC 路径、推荐原因、里程碑和证据条件。 |
| 6:30–8:00 | 证据驱动排障 | 展示 TRANSPORT 层故障、已确认/待验证/唯一下一步。 |
| 8:00–9:00 | 迁移挑战 | 展示只改变一到两个条件与结构量规。 |
| 9:00–10:00 | 教师分析与真实性说明 | 展示真实/演示分栏、个体档案、教师决定；说明课堂实证待开课后完成。 |

## 外部发布门

| 门禁 | 状态 | 通过所需证据 |
| --- | --- | --- |
| 项目负责人确认新的 `PUBLIC_APP_URL` | `PENDING_EXTERNAL` | 书面确认且能在比赛提交前激活；当前环境变量未设置。 |
| 公网 HTTPS、证书、HTTP 跳转和 `/api/health` | `PENDING_EXTERNAL` | 两种网络实测，证书无警告，health 脱敏且数据库可用。 |
| 正式 `public/competition-qr.svg` 与 SHA-256 | `PENDING_EXTERNAL` | 仅在确认 URL 后生成；当前文件不存在。 |
| 两台设备跨网络扫码 | `PENDING_EXTERNAL` | 校园 Wi-Fi 与蜂窝网络均到达同一 HTTPS 地址。 |
| 人工 10 分钟演练 | `PENDING_EXTERNAL` | 教师真人按上表计时，记录实际总时长和超时点。 |
| 比赛冒烟表双人签名 | `PENDING_EXTERNAL` | `docs/runbooks/competition-smoke-test.md` 九项实测、执行人和复核人签名。 |
| 10–20 份真实历届匿名作业回放与教师标注验证 | `PENDING_EXTERNAL` | 课程负责人完成脱敏、授权和教师先验标注；报告与演示数据分栏。 |

## 最终验证记录

以下结果均为 2026-07-13 在当前工作树上的新鲜运行，不引用早先代理报告。

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | PASS，exit 0，无 ESLint 错误。 |
| `pnpm test` | PASS，76 个测试文件、852 项测试全部通过。 |
| `pnpm test:e2e` | PASS，Chromium 单 worker，13 项全部通过；包含完整演练与工具路径刷新持久性。 |
| `pnpm exec playwright test tests/e2e/release-rehearsal.spec.ts --repeat-each=2 --reporter=line` | PASS，同一初始库连续 2 轮均通过；每轮发布专用项目独立创建并清理。 |
| `pnpm build` | PASS，Next.js 16.2.10 生产构建、TypeScript、14 个静态页面生成全部完成。 |
| `pnpm audit:prod` | PASS，`No known vulnerabilities found`。 |
| `pnpm audit:all` | PASS，`No known vulnerabilities found`。 |
| `pnpm exec drizzle-kit check` | PASS，`Everything's fine`。 |
| `pnpm db:generate` 后检查无新迁移 | PASS，识别 22 张表，`No schema changes, nothing to migrate`。 |
| 范围、秘密、旧域名和测试产物搜索 | PASS。无排除功能实现、无常见真实凭据签名、无已跟踪 runtime/SQLite/报告产物。旧域名字符串只存在两条 `not.toMatch` 防回归断言，不是配置或链接；占位地址只在 `.env.example`、手册和测试中。 |
| `git diff --check` | PASS，exit 0，无空白错误。 |
| `git status --short`、`git log --oneline -15` | PASS，可重复性修复提交后工作树为空；`test: make release rehearsal repeatable` 位于提交历史顶部，随后为 `e6160ab`、`2453b7e` 两项审计文档提交和 `ae7d1e8`、`21f33ee`、`ee03ed5` 三项业务修复。 |

## 标签决定

`competition-mvp-v1`：**NO / NOT CREATED**。

只有上面的公网、二维码、跨网络扫码、人工演练和冒烟签名全部由实际责任人完成，且修复后重新跑完本清单的本地验证，才可以由项目负责人授权创建标签。本文档的存在不是发布批准。
