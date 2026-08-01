# “触映”教育 Agent 竞赛可交付完成度审计

> **⚠️ 历史材料（已被 Lumi 当前材料取代）**：本文仅保留作历史记录，不代表当前产品能力、评测或发布状态。现行演示与部署边界见 [Lumi 比赛演示脚本](../runbooks/demo-script.md) 和 [Lumi S0 部署冒烟 Runbook](../runbooks/deploy-s0.md)。

## 审计结论

- 审计日期：2026-07-16（Asia/Shanghai）
- 审计基准功能提交：`d9700d8`；当前安装功能提交：`d9700d8`
- 代码结论：长期计划中的 Agent 内核、双课程包、受控工具、教师审查、证据闭环、测试与本机发布门均有直接证据。
- 公网结论：临时 HTTPS 入口已经验证，但它不是固定 `PUBLIC_APP_URL`，不能生成正式二维码或签署双设备发布通过。
- 真实试用结论：首轮专用 REAL 班、8个未认领编号、01—08预编号匿名观察包和聚合报告已经准备；安装版开场预检为 `READY_TO_START`、8/8检查通过。没有真实学生完成记录，不能声称教学成效。
- 发布决定：暂不创建正式比赛标签。剩余门禁是固定地址、两台物理设备跨网络扫码、教师真人计时、真实学生试用和双人签名。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| `VERIFIED_CODE` | 代码、Schema和专项测试共同证明。 |
| `VERIFIED_BROWSER` | 完整浏览器流程在隔离数据库中通过。 |
| `VERIFIED_INSTALLED` | 不可变安装版、真实配置和健康门通过。 |
| `VERIFIED_TEMPORARY_PUBLIC` | 临时HTTPS入口实际访问通过，但不等于固定发布地址。 |
| `READY_FOR_HUMAN` | 工具和材料已准备，必须由真人或物理设备完成。 |
| `PENDING_EXTERNAL` | 当前证据不足，不能签署通过。 |

## 长期计划逐项证据

| 计划要求 | 当前状态 | 权威证据 |
| --- | --- | --- |
| 通用课程包协议与静态注册中心 | `VERIFIED_CODE` | `lib/course-packs/contract.ts`、`lib/course-packs/registry.ts`、`tests/unit/course-packs.test.ts` |
| 数字交互完整课程包和书籍设计微闭环 | `VERIFIED_CODE`、`VERIFIED_BROWSER` | `lib/course-packs/digital-interaction.ts`、`lib/course-packs/book-design.ts`、`tests/e2e/release-rehearsal.spec.ts` |
| 会话、回合、行动、教师复核和通用画像迁移 | `VERIFIED_CODE` | `lib/db/schema.ts`、`lib/db/migrations/`、Agent迁移与数据库集成测试 |
| 课程包版本锁定、知识命名空间、哈希和来源权威 | `VERIFIED_CODE`、`VERIFIED_INSTALLED` | `lib/knowledge/course-pack-store.ts`、`tests/integration/course-pack-knowledge.test.ts`；安装版知识块5/3 |
| 非线性 EXPLORE/UNDERSTAND/BUILD/DEBUG/TRANSFER/REFLECT 路由 | `VERIFIED_CODE` | `lib/agent/contracts.ts`、`lib/agent/orchestrator.ts`、`tests/integration/agent-orchestrator.test.ts` |
| 服务端模型回答、Zod校验、来源和不确定性 | `VERIFIED_CODE`、`VERIFIED_INSTALLED` | Agent编排测试；真实模型固定评估31/31；健康门 `agentQuality.status=passed` |
| 模型只提出行动，学生确认后执行 | `VERIFIED_CODE` | `/api/agent/action`、`lib/agent/orchestrator-store.ts`；所有权、过期和幂等测试 |
| 注册工具、有界模型—工具循环和异常Harness | `VERIFIED_CODE`、`VERIFIED_INSTALLED` | `lib/agent/tools/`、`lib/agent/tool-executor.ts`；Harness 16/16 |
| 完整问答与悬浮问答共享会话 | `VERIFIED_CODE`、`VERIFIED_BROWSER` | `components/student/use-agent-conversation.ts`、学生工作台测试 |
| 数字交互节点/案例/知识/排障/迁移适配器 | `VERIFIED_CODE`、`VERIFIED_BROWSER` | 工具注册中心、三类证据路径E2E、TouchDesigner案例测试 |
| 书籍设计诊断、8页结构、证据和受众迁移 | `VERIFIED_CODE`、`VERIFIED_BROWSER` | `components/student/BookLayoutLab.tsx`、书籍服务/路由测试、书籍E2E |
| 教师查看策略、工具、来源、降级和追加式纠正 | `VERIFIED_CODE`、`VERIFIED_BROWSER` | `AgentDecisionTimeline.tsx`、教师Agent复核测试、教师E2E |
| `AGENT_V2_ENABLED` 回退路径 | `VERIFIED_CODE`、`VERIFIED_INSTALLED` | 环境配置、Agent路由测试、安装版健康接口 |
| 真实试用专用班、开场预检和匿名证据报告 | `VERIFIED_CODE`、`VERIFIED_INSTALLED`、`READY_FOR_HUMAN` | `pilot:prepare`、`pilot:observation`、`pilot:preflight`、`/api/teacher/pilot-report`；首轮8个编号未认领，开场门8/8通过 |

## 当前发布门证据

| 门禁 | 结果 |
| --- | --- |
| Vitest | 123个文件、1059项通过 |
| TypeScript / lint / build | 严格类型、零警告lint、生产构建通过 |
| Agent Harness | 16/16通过 |
| 浏览器E2E | 20/20通过，覆盖双课程、教师审查、证据、移动布局 |
| 生产依赖审计 | 无已知漏洞 |
| 不可变安装 | `d9700d8`独立目录运行，Windows计划任务指向该目录 |
| 一致性备份 | 切换前创建并验证；数据库、证据和知识迁移通过 |
| `/api/health` | 数据库、AI、Agent V2、知识5/3、Eval、Harness均通过，`competitionReady=true` |
| 临时公网 | 首页、学生页、教师页、健康、双端登录、驾驶舱和匿名报告均为HTTP 200 |
| 隐私边界 | 报告不含学生标识、问题/证据原文和教师备注；四项效果指标固定待人工观察；01—08观察包完整身份码与班级码命中均为0 |
| 真实试用开场门 | `READY_TO_START`，课程、编号、材料、本机与公网8/8检查通过；0名学生、0个项目 |

## 尚不能签署通过的项目

| 项目 | 当前证据 | 下一步 |
| --- | --- | --- |
| 固定 `PUBLIC_APP_URL` | `chuyingai.cc.cd` 当前NXDOMAIN；Cloudflared没有命名隧道证书 | 完成域名委派和命名隧道，再验证固定HTTPS |
| 正式二维码 | 仓库没有 `public/competition-qr.svg` | 固定地址通过后运行 `pnpm qr:generate` 并记录SHA-256 |
| 两台设备跨网络扫码 | 只有桌面浏览器和移动视口自动化证据 | 用校园Wi-Fi和手机蜂窝网络分别实扫并签名 |
| 教师真人10分钟演练 | 只有机器辅助流程计时 | 教师完整讲一次，记录总时长、卡顿点和复测结果 |
| 真实学生试用 | 班级、编号和表格已准备，学生数仍为0 | 邀请5—8名学生独立完成20—30分钟任务并提交证据 |
| 双人复核 | 未签名 | 执行人与第二复核人完成冒烟表和争议样本抽查 |

## 真实性边界

- 自动测试证明系统行为，不证明学生理解、高阶思维或教学成效。
- 真实学生完成前，报告只能写“已具备试用条件”，不能写“显著提升”或“普遍有效”。
- 临时Quick Tunnel证明公网链路可用，不证明比赛当天地址稳定。
- 正式发布标签只能在全部 `PENDING_EXTERNAL` 项有真人或物理设备证据后创建。
