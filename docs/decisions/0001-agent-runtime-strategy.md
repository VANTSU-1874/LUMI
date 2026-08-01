# ADR-0001：保留领域内核，以适配器评估通用 Agent Runtime

状态：当前阶段已采纳，完成 Runtime Bake-off 后复审

日期：2026-07-16

关联：`Product-Spec.md` v2.2、`DEV-PLAN.md`、`docs/research/agent-architecture-benchmark-roadmap.md`

## 背景

触映已经实现全设计专业自由对话、ProjectBriefMemory、专业增强、来源分层、任务隔离、Plugin / Skill 注册、有界模型—工具循环和 ActionPolicy。与此同时，当前编排仍是应用内自研实现：缺少流式事件、持久 checkpoint、通用 interrupt、插件生命周期、远程能力协议和长会话压缩。

开源系统在不同层面更成熟，但没有一个现成项目同时满足触映的教育产品身份、全部设计专业默认可答、课程只增强、学生数据隔离、教师权力边界和现有 TouchDesigner/书籍资产兼容。

## 决策

1. K6 通用作品理解完成前，不整体替换现有 DesignAgentKernel 和模型—工具循环。
2. 触映的身份规则、ProjectBriefMemory、来源分层、ActionPolicy、课程/案例资产与学生数据所有权继续作为框架无关的领域层。
3. 新增 `AgentRuntimePort`、`RunStateStore`、`TraceSink`、`CapabilityProvider` 等边界，当前 runtime 先实现这些接口。
4. OpenAI Agents SDK TypeScript 与 LangGraph JS 只通过最小 spike 进入对照，不直接写入主链。
5. Microsoft Agent Framework 暂作架构参考；当前不引入 Python/.NET sidecar。
6. MCP 作为外部 Tools / Resources / Prompts 的兼容协议；所有 MCP 能力必须经过本地清单、所有权校验、最小权限、输出限制和 ActionPolicy。
7. Dify、Open WebUI、LobeHub、OpenHands 等完整产品不作为触映代码底座；只吸收经验证的信息架构、运行状态和插件治理模式。

## 原因

- 当前最有价值且最难迁移的是触映的领域规则与既有数据，不是通用 Agent loop。
- 直接 fork 平台会同时带入其租户、工作流、权限、部署和 UI 假设，后续同步上游的成本过高。
- 先建立 port 可以让候选在相同输入、相同模型、相同工具和相同数据上公平比较，也保留快速回退。
- TypeScript 候选与当前 Next.js/Zod/Vitest 栈更接近，迁移风险低于立即引入双栈服务。

## 后果

### 正面

- K6 继续交付，不因框架调研停摆。
- 可逐步获得 durable run、HITL、MCP 和 tracing，而不重写产品规则。
- 框架选择由行为与故障恢复数据决定。

### 代价

- 短期仍需维护自研 runtime。
- 在接口拆分完成前，流式、checkpoint 和插件生命周期不会一次到位。
- 对照 spike 会产生一部分不进入生产的实验代码，必须限制在独立目录或分支。

## 复审触发条件

- Runtime Bake-off 完成并满足路线文档中的替换门。
- TouchDesigner 写操作、跨小时后台任务或多 Agent 协作成为已确认需求。
- 当前编排器的恢复、可观测性或维护成本已阻塞连续两个稳定切片。
