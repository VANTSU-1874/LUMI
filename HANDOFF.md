# Lumi 鹿鸣项目交接文档

> 更新时间：2026-07-20（Asia/Shanghai）
>
> 用途：给完全没有聊天上下文的新 AI 恢复项目现场。
>
> 当前结论：**后端、Agent、演示数据和自动化集成已经形成可运行基础；用户正在独立的前端工作树中继续做官网视觉设计。现在不要合入 `main`、不要部署、不要覆盖前端未提交改动。**
> 证据边界：**当前集成代码最新的完整业务证据是 21/21 单浏览器、无真实模型 E2E；绑定最终前端的全量 Vitest、类型检查、lint、production build、真实模型、真人视觉和公网部署均未完成。**

## DO NOW：新对话只做这五步

1. 不写文件、不启动服务、不跑测试，先读第 1 节列出的指令和真源。
2. 只读核对 `main`、`lumi-frontend`、`lumi-integration` 的实时 HEAD 与 status；本文件中的 SHA 是 2026-07-20 快照。
3. 把 `lumi-frontend` 全部未提交内容视为用户 WIP，禁止 reset、clean、checkout、批量格式化和粗放暂存。
4. 从明确的 worktree 读取设计文档，不在含 WIP 的工作树切换分支。
5. 等用户选择“继续前端批注”或明确宣布“前端内容冻结”；此前不合并、不部署，也不运行会干扰用户页面的全量 E2E。

---

## 1. 接手后先读什么

本文件可以独立恢复事实；但执行任何动作前仍按以下顺序补读，避免违反本机长期规则或被旧计划带偏：

1. `C:\Users\18437\vault\AGENTS.md`。
2. `C:\Users\18437\vault\projects\Agent开发.md`；该页可能滞后，仓库证据优先。
3. 本文件 `HANDOFF.md`。
4. 仓库根目录 `CONTEXT.md`：产品名称、能力边界和对外措辞的唯一真源。
5. `E:\第二届教师人工智能应用能力大赛\.worktrees\lumi-frontend\docs\frontend\homepage-copy.md`：2026-07-20 与用户逐块确认的官网首页文案、字体和视觉决策。也可只读执行 `git show main:docs/frontend/homepage-copy.md`；不要为读取它在含 WIP 的工作树切分支。
6. `docs/frontend/product-and-design-brief.md`：产品与设计总简报。
7. `docs/competition/evidence-ledger.md`：哪些内容可以写进报告、哪些只能称历史基线或待验证。
8. `docs/runbooks/deploy-s0.md`：部署前置条件、保护措施、停止条件和回滚。
9. `docs/runbooks/runtime-configuration.md`：外置模型配置、优先级、worktree 共享评测文件等关键规则。
10. `docs/superpowers/plans/2026-07-19-overnight-work-queue.md` 与 `2026-07-19-second-wave-plan.md`：历史执行记录和剩余事项。

注意计划文档的状态有滞后：夜间清单仍把真实模型评测和 S0 写成“待授权”，但用户后来已经授权；旧 sprint 中曾出现 Caddy 直连 3000，已被同文和部署 runbook 更正为 3100；`bcc78b3` 只是构建测量基线，不是部署源。**当前用户指令与本交接中的已核实状态优先于旧复选框。**

原始 V3 最高指令文档没有被 Git 跟踪，只存在于另一个 worktree：

```text
E:\第二届教师人工智能应用能力大赛\.worktrees\tonggan-mvp\docs\superpowers\plans\2026-07-17-tonggan-agent-v3-tutor-rebuild.md
```

若继续改 Agent，必须完整读取该文件，尤其第 0 节与第 3 节。不要凭聊天印象重建，也不要未经用户同意移动或提交它。其关键约束包括：保留真实安全护栏、拆除扼杀正常回答的硬拦截；每项独立提交；V2 在第 7 阶段真人体感通过前不得删除；遇到无法自决的设计取舍应标记 `DECISION NEEDED`。

---

## 2. 整体任务目标

### 2.1 产品目标

把早期“触映”课程工具重建为 **Lumi 鹿鸣——视觉传达设计专业 AI 成长导师**。产品不是普通问答壳，也不是用流程卡住学生的校验器，而是：

- 先理解学生尚未说清的设计意图，再给实质建议；
- 能围绕设计目标、制作过程和软件故障持续对话；
- 有课程语料时增强回答，没有专门课程包时仍能给通用设计建议；
- 作品真正送达视觉模型时，才对画面作判断；
- 需要会诊时输出“五维一收”：目标、创意转译、构成与层级、形式语言、工艺与规范，外加视觉上独立的收束；
- 不替学生评分、提交、过关或自动修改作品；写操作必须显式确认；
- 真实证据、预置演示、自动测试、历史基线和课堂成效严格分开。

### 2.2 竞赛交付目标与截止日

- **2026-07-31**：校内交付重点是报告和可运行链接。
- **2026-08-26**：省赛完整材料，包括 10 分钟展示视频、承诺书、PDF、上传等人工环节。

当前关键路径是：

```text
前端内容冻结
  -> 合入集成分支
  -> 最终提交上的自动化与真实模型验证
  -> 真人视觉/移动端/语音/教师复核
  -> 用户确认最终视觉可接受
  -> 合入 main
  -> S0 部署与公网回归
  -> 二维码与报告回填
```

### 2.3 术语红线

对外界面、报告和演示统一使用 **Lumi 鹿鸣**。以下是旧词，不得重新出现在当前界面和对外材料：

- 触映 / 触映 AI
- 通感阶梯
- 门禁
- 关卡

仓库名、包名和历史文档可能仍含 `tonggan`，不要为了表面统一做大规模机械重命名。

---

## 3. 当前工作区与 Git 现场

### 3.1 集成工作树（本文件所在位置）

```text
路径：E:\第二届教师人工智能应用能力大赛\.worktrees\lumi-integration
分支：feature/lumi-integration
最后一个业务/测试记录提交：d7cefd46003a282255bd867450f391cb1de76222（简称 `d7cefd4`）
其后仅有本 `HANDOFF.md` 的独立文档提交；接手时用 `git rev-parse HEAD` 获取实时 tip
```

相对当前 `main`：

- ahead 239（其中最新 1 个为本交接文档提交）；
- behind 8；
- merge-base：`01eccd2aefa24c4607b4329bdd954094fdb3244d`。

这不是“集成分支单纯领先 main”。`main` 独有的 8 个提交是用户刚确认的首页文案、错误微文案、字体栈、Aida 字体和 Hero 屏幕循环设计决策。不能把 `d7cefd4` 直接当最终设计源。

集成工作树当前只显示：

```text
M docs/superpowers/specs/2026-07-18-lumi-design-tutor-design.md
```

该文件经 `git diff --numstat` 与 `git diff --ignore-cr-at-eol` 验证没有内容差异，仅是 CRLF/LF 工作树差异。**禁止修改、格式化、暂存或提交。**

### 3.2 用户正在做设计的前端工作树

```text
路径：E:\第二届教师人工智能应用能力大赛\.worktrees\lumi-frontend
分支：feature/lumi-frontend
已提交 HEAD：feda2337c5c06baa0cf750ffd21178b04b4ef0a2
```

这是当前真正活跃的人工设计现场。检查时存在大量用户未提交改动：

```text
M  app/globals.css
M  components/entry/EntryForm.tsx
M  components/home/LumiLandingPage.tsx
?? canvas/
?? components/home/DisciplineShowcase.tsx
?? components/home/LumiWorkbenchHero.tsx
?? components/ui/
?? public/media/lumi-hero-ai-generated.png
?? tests/e2e/gradual-blur.spec.ts
?? tests/unit/gradual-blur.test.tsx
?? tests/unit/magnet.test.tsx
?? tmp/
```

其中 `app/globals.css` 的未提交改动超过 1800 行，另有首页组件、交互组件、生成图、视觉 QA 截图和新测试。**这些都是用户当前工作，不得清理、覆盖、回退、移动、批量格式化或擅自提交。**

下一位 AI 只有在用户明确让其实现某条浏览器批注时，才能改相应前端文件；应先重新读取当前 diff，避免按本交接的旧快照覆盖用户后来新增的设计。

### 3.3 `main`

```text
路径：E:\第二届教师人工智能应用能力大赛
分支：main
HEAD：f43c7542e80bc3ccb9e979a39c0bd0fc3a348d10
```

`main` 最近 8 个提交都是前端设计文档决策，已被 `feature/lumi-frontend` 的 `feda233` 合并。集成分支尚未吸收它们。

### 3.4 其他相关工作树

- `.worktrees/tonggan-mvp`：原 V3 Agent 开发与未跟踪最高指令计划所在处。
- `.worktrees/lumi-s0`：S0 部署准备来源分支；主要成果已经进入集成分支。
- `.worktrees/lumi-w2`：五维会诊后端来源分支；成果已经进入集成分支。
- `.worktrees/lumi-w3-assets`：演示素材来源分支；成果已经进入集成分支。

不要在这些旧来源分支重复实现已经进入 `feature/lumi-integration` 的工作。

### 3.5 远程与备份

仓库当前没有 Git remote，也没有 upstream。集成分支 238 个独有提交曾是单点风险，已经创建完整 bundle：

```text
C:\Users\18437\AppData\Local\ChuyingAI\backups\lumi-integration-feature-2026-07-20-d7cefd4.bundle
```

- 大小：9,865,649 字节，约 9.41 MiB；
- SHA-256：`5DF8291254D792AC614B116E67C908D990376F8334D9AA5C6B197B32BAE67A65`；
- 包含 `feature/lumi-integration` 到 `d7cefd4` 的完整历史；
- `git bundle verify` 已通过。

它不是远程异地备份，而且只恢复到 `d7cefd4`：不包含其后的本交接文档、当前前端 WIP 或未来集成提交。前端内容冻结和最终集成后，应重新生成绑定最终提交的 bundle。不要擅自配置 remote 或推送。

---

## 4. 当前产品事实与能力边界

### 4.1 已有的产品能力

- Next.js 16.2.10、React 19.2.4、TypeScript、Drizzle ORM、SQLite。
- 学生入口、身份与会话、课程切换、历史对话、异步 Agent run、SSE 事件与轮询恢复。
- V3 导师自然正文、原生工具调用、流式输出、超时与确定性降级。
- 通用设计、数字交互文创设计、书籍设计三个当前深度包。
- 混合检索、可选嵌入、项目简报、会话摘要与脱敏长期记忆。
- 私密作品上传、作品实际送达条件校验、可选五维会诊 sidecar。
- 五维会诊结构、独立收束、私密保存与严格范围内的历史对照。
- 软件问题走证据式排错，不强套五维会诊。
- 教师侧证据查看、Agent 轨迹、复核与演示数据默认排除。
- D-017 预置跨会话故事线、原创预置素材、显著 `DEMONSTRATION_DATA` 标记。
- 可信代理登录链路、数据库迁移、备份/恢复、健康检查和本地发布工具。

### 4.2 当前学生前端入口

生产学生页：

```text
app/student/page.tsx
  -> components/student-v2/LumiStudentApp.tsx
```

旧目录 `components/student/` 当前没有生产入口，但仍被 22 处单元测试引用，且其中 `TransferChallenge.tsx` 对应的后端 `app/api/projects/[projectId]/transfer/handler.ts` 仍然存活。原 V3 计划第 3 节也没有授权删除该目录。**不要把它当普通死代码直接删除。**

### 4.3 不能宣称已经交付的能力

以下仍是规划或部分演示，不得在报告、首页或演示中写成已实现：

- 11 门课程全部具备深度知识包；
- 正式“配置台”；
- 正式“洞察台”；
- 系统稳定主动触发的“举一反三动作”；
- 真实学生长期成长成效；
- 真实视觉点评质量已验证；
- 当前最终版本已经通过真实模型全量评测；
- 公网已上线、二维码已可用；
- 预置 D-017、预置班级卡或静态素材等于真实学生记录。

### 4.4 课程表述仍有一个待对齐点

当前产品真源与代码证据支持的深度包是：

1. `general-design`（通用设计建议骨架，不是一门课程）；
2. `digital-interaction`（数字交互文创设计）；
3. `book-design`（书籍设计）。

当前仓库的 `docs/runbooks/demo-script.md` 已按“书籍设计深度包”写切课段；但更早的用户口径、部分规划以及现成的切课素材使用“版式设计”。不要悄悄把书籍设计和版式设计互换。建议保持“书籍设计是当前已验证深度包，版式设计仅作通用建议/演示素材”，除非用户明确决定把版式设计升级为真实深度包并补齐代码、语料和验证。

---

## 5. 已合入的实现（仍待最终提交验证）

### 5.1 V3 导师重建

已完成：

- `AGENT_V3` 新内核与 V2 回退边界；
- 从强制 JSON 与硬门禁改为自然正文 + 原生 tools；
- GPT-5.6/OpenAI Responses 兼容流式链路；
- 拆除词汇白名单和“验证失败后反复重试再模板降级”的绞索；
- 课程语料、混合检索、长期记忆、作品理解、联网需同意、计算工具；
- V3 黄金集、结构评测和导师质量评测框架；
- 错误细分、脱敏 cause 链、模型诊断持久化；
- 中转 Responses 压缩 action 输出与防御性流式解析兼容。

最近直接影响用户体验/排障的提交：

- `4781215`：历史对话显示完整标题，不再像“几个点没有功能”。
- `310cf02`：删除冗余“为什么先做这一步”解释块。
- `f9aa03b`：加入可编辑语音输入。
- `d4036c6`：保存实时模型诊断。
- `20934d2`：接受中转压缩的 Responses action 输出。
- `42741cb`：评测失败上报细分 transport/protocol/message。

### 5.2 五维会诊与数据链路

已完成：

- 五维配置化：`goal`、`translation`、`structure_hierarchy`、`formal_language`、`craft_standards`；
- `closure` 独立于五维，不作为第六张卡；
- 自然正文是主结果，会诊 sidecar 无效或缺失时不重试、不覆盖正文；
- 会诊私密持久化、访问控制、作品证据绑定；
- 同学生、同班级、同课程、同数据类型且可核对时才引用历史；
- D-017 预置会诊和历史 sidecar 水合；
- 教师演示数据默认排除，只有主动勾选才显示。

### 5.3 前端基础与应用本体

已完成并进入集成分支的基础包括：

- API 契约与 mock transport；
- Lumi 设计令牌与 UI 预览；
- 学生端主路径：入口、对话、上传、会诊、收束；
- 真实 API 与 mock 按端点切换；
- 上传进度、流式等待、恢复与错误态；
- 移动端单栏基础；
- 对话标题修复、冗余解释删除、语音输入。

但官网首页正在 `feature/lumi-frontend` 继续重做，当前尚未定稿、未提交、未合入集成分支。不要把旧页面截图当最终视觉。

### 5.4 官网设计决策

2026-07-20 用户已在 `docs/frontend/homepage-copy.md` 定下：

- 首屏主标题：“我们今天做些什么？”；
- 首页八区块结构；
- 首页整页为暖褐/焦糖色 + 细颗粒，应用本体仍保持暖白和中性灰；
- 标题层中英双语，正文只用中文；
- Aida 为用户自制、版权自有的英文点缀字体；
- 中文标题/正文优先思源宋体与思源黑体，字体必须自托管；
- Hero 电脑屏幕使用预置四幕微循环；
- 预置演示标识必须常驻；
- 未交付洞察台时必须删除相关首页文案。

当前未提交前端 CSS 仍可见较早的暖白/朱砂方案。**这是用户正在设计中的现场，不是要由新 AI 自动“纠正”的错误。** 应以用户最终视觉确认和最新文案文档为准，逐项核对。

### 5.5 演示素材与报告诚信

已完成：

- D-017 预置学生故事线；
- 4 份原创预置 SVG、2 份确定性 PNG 派生；
- 数据库 seed 与跨会话历史；
- 所有预置数据显著标记；
- 报告草稿剔除未交付配置台、正式洞察台、主动举一反三等虚构完成态；
- 证据账本区分自动验证、历史基线、单样本、预置演示、待人工验证和未交付。

仍缺真实授权素材：匿名化 DigiShow 截图、TouchDesigner 截图、获授权安岳石刻材料和真实学生作品。

### 5.6 S0 部署准备

已完成但未连接服务器：

- 本地生产构建、迁移、种子和知识入库历史基线；
- systemd、Caddy、环境变量模板；
- `docs/runbooks/deploy-s0.md` 完整操作与回滚手册；
- 明确生产拓扑：

```text
Cloudflare / HTTPS
  -> Caddy :443
  -> 127.0.0.1:3100 可信代理
  -> 127.0.0.1:3000 Next.js
```

没有连接或修改服务器，没有生成最终公网二维码。

---

## 6. 已有验证证据，以及它们不能证明什么

### 6.1 全量 Vitest：祖先提交证据

记录：

```text
docs/reports/2026-07-19-vitest-42741cb.md
```

绑定提交 `42741cb57d5492ef36350f642b9103f8e3cab2ea`：

- 206/206 测试文件通过；
- 2055/2055 用例通过；
- skip 0；todo 0；
- Vitest 165.58 秒；墙钟 167.191 秒；
- 退出码 0。

从 `42741cb` 到当前集成 HEAD 又改动了 16 个文件，其中包含学生会话 hook 和测试。因此只能写成“祖先提交的完整测试证据”，不能写成“当前 HEAD 新鲜全绿”。前端内容冻结并合入后，必须在最终代码提交上重新跑并重新归档。

### 6.2 Playwright E2E：当前集成代码可用的无模型证据

记录：

```text
docs/reports/2026-07-20-e2e-7481a40.md
```

绑定提交 `7481a40`：

- 21/21 通过；
- 失败 0；skip/todo 0/0；
- Playwright 3.2 分钟；墙钟 191.8 秒；
- Desktop Chrome、单 worker、端口 3300、隔离 SQLite。

`7481a40` 之后只有测试报告文档提交，因此这份 E2E 对 `d7cefd4` 的业务代码仍有效。

但 E2E 故意把模型端点设为 `127.0.0.1:9`，**没有调用真实模型**。它只证明界面、路由、降级和数据契约，不证明导师质量、视觉理解或中转稳定性。

### 6.3 生产构建：历史测量基线

记录：

```text
docs/runbooks/deploy-s0-build-baseline.md
```

绑定提交 `bcc78b31658377d9ec3134418b447c1ab9fdf68c`：

- 生产构建 19.081 秒；
- 进程树峰值工作集 3475.6 MiB；
- 迁移、演示种子、三包知识入库均通过；
- 46 张 SQLite 表；知识块为 book 9、digital 17、general 8。

从该提交到当前集成 HEAD 已变化 249 个文件。它只能作为部署管道和内存需求参考，不能称当前版本已构建通过。

### 6.4 真实模型历史证据

历史提交 `1a34a4f1038a5dd6c840cf8121c326ec0c9a39bb` 在 suite `2026-07-17.4` 上曾达到：

- 37/37；
- passRate 1；
- modelAssistedRate 1；
- routing 1；
- answerRelevance 0.9459459459；
- sourcePrecision/actionSafety/safety 均为 1；
- 平均案例耗时 35067ms。

单次延迟探针在 `ebd2a8c` 上记录：首个可见文字 12.503 秒、总时长 24.983 秒、`MODEL_ASSISTED`。

这两者都不是当前最终集成证据。当前最终集成必须重新跑真实模型评测。

### 6.5 当前缺少的新鲜证据

当前没有绑定最终前端/最终集成提交的以下完整落盘记录：

- 全量 Vitest；
- TypeScript `tsc --noEmit`；
- lint；
- production build；
- 真实模型 37 题结构评测；
- 40 题导师质量评测；
- 代表性作品的真实视觉质量复核；
- 8 项真人体感；
- 移动端实体设备；
- 语音输入的实际演示网络；
- 公网部署与二维码双网络实扫。

---

## 7. 模型配置与已解决故障

### 7.1 当前模型策略

用户已决定：

- 使用单一模型，不做双模型；
- 模型标签为 `gpt-5.6-sol`；
- 使用用户购买的中转 API，不是 OpenAI 官方 Key；
- 后续真实大模型调用和评测已获原则授权；
- 不得在文档、终端回显、截图或 Git 中写 API Key。

模型标签只能证明本地配置名称，不能单独证明中转上游实际模型身份。

### 7.2 真正生效的配置文件

正式本机服务和模型质量命令优先读取仓库外文件：

```text
%LOCALAPPDATA%\ChuyingAI\config\service.env
```

可用 `CHUYING_SERVICE_ENV` 显式指定另一份配置。不要只看仓库 `.env.local` 就判断实际端点。

历史根因：`service.env` 中实际中转 `LLM_BASE_URL` 缺少 `/v1`，导致“流式 + 工具”返回形态与解析器不兼容。2026-07-19 已记录修正为：

```text
{RELAY_BASE_URL}/v1
```

原文件备份：

```text
service.env.bak-20260719-021925
```

当时用项目自身适配器实测：

- 无 `/v1`：非流式工具调用可偶尔成功，流式工具调用报 `INVALID_RESPONSE` / `undefined.type`；
- 有 `/v1`：非流式与流式工具调用都成功，并快约 3–7 倍。

新 AI 运行模型前应看 stderr 的 `effective-model-config`，确认规范化 base URL 和来源；不要输出密钥。

### 7.3 超时策略

- 线上：idle 45s、单次模型 total 120s、整回合 total 180s；
- 评测：idle 120s、单次模型 total 600s、整回合 total 900s。

早期 50 秒总超时会误杀推理模型，已经拆分为空闲超时和硬总超时。不要重新合并为单一短闸门。

### 7.4 嵌入链路

T5 已完成代码解耦：嵌入可以使用独立的 base URL、Key 和模型；未配置或调用失败时自动回落到词法检索，不阻塞导师作答。

用户尚未选嵌入提供商或购买密钥。**不要擅自选供应商、填密钥或把嵌入当第二个导师模型。** 只有确认目标服务支持 `/embeddings` 且数据发送边界获批后才能配置。

### 7.5 视觉能力边界

`LLM_VISION_ENABLED` 不能按模型名字猜。只有中转明确支持 `image_url` 输入、图片真实送达、返回可解析且教师实际复核后，才能说 Lumi 看懂作品。

用户曾上传 TouchDesigner 图时看到：

```text
模型服务错误：INVALID_RESPONSE
当前模型未能可靠读取这张作品图片
```

这说明视觉链路仍需真实复核。没有部署不是本地出现确定性降级的原因；降级通常表示模型配置未被开发进程读取、接口返回无效或传输中断。

---

## 8. 当前卡点与仍需人工决定的事项

### 8.1 当前第一卡点：前端仍在设计

用户明确说“我正在做前端设计”。所以当前状态是：

- 不做最终视觉验收；
- 不合入 `main`；
- 不部署；
- 不覆盖 `lumi-frontend` 未提交改动；
- 用户可继续通过浏览器标注具体问题，AI 只按明确批注修改。

这里有两个不同的人工门，不要混为一次：

1. **前端内容冻结**：用户确认不再继续当前设计迭代，允许把 `feature/lumi-frontend` 的已提交成果合入集成分支。
2. **最终视觉验收通过**：前端与集成后端合在同一候选提交、完整走查后，用户明确回复“最终视觉可接受”；只有这一步完成，才允许合 `main` 和部署。

前端内容冻结前需要核对的已知冲突：

1. 最新文案文档把官网首页定为焦糖暖褐 + 颗粒，当前未提交 CSS 仍含较早的暖白/朱砂方案；由用户最终视觉决定，不自动统一。
2. 产品简报写应用强调色偏暖金/琥珀，夜间实现记录与现有应用本体使用朱砂 `#B23A2F`；需在视觉定稿时明确首页与应用各自令牌。
3. `homepage-copy.md` 中教师侧“洞察台”文案必须在功能未交付时删除。
4. 标志具体形态仍未最终验收。
5. `canvas/`、`tmp/`、生成图和视觉 QA 截图哪些是源资产、哪些是临时文件，必须由用户或设计负责人确认后再精确暂存。
6. 首页标题层最终使用 Aida 还是 Fraunces、中文大标题是否替换思源宋体，仍应以实际试排和用户拍板为准；不要只按字体文档猜视觉结果。

### 8.2 授权矩阵

#### 现在可以直接做

- 本地只读核对、文档阅读和不干扰用户页面的诊断；
- 用户明确点名的前端批注修改；
- 使用固定合成评测集调用用户的模型 API；用户已经授权后续大模型评测，不必重复询问同一原则问题。

真实模型授权只覆盖项目固定测试题和获准的演示输入。**不得把 `data/evidence-dev/`、真实学生作品、身份信息或未获数据授权的资料发送给第三方中转。** 不得输出 Key、Authorization、完整环境对象或原始学生内容。

#### 已有原则授权，但必须等前置条件满足

- 用户最终确认视觉可接受后，合入 `main`；
- `main` 的精确候选提交冻结后，执行 S0 部署；
- Caddy 修改只能按 runbook：先备份、只追加、不改既有块、validate 后 reload，并立即回归现有站点；
- Caddy 必须指向 3100，不是 3000。

#### 执行前仍必须拿到具体值或现场确认

- 精确候选 SHA 与待上传内容；
- SSH 用户、认证方式、sudo 条件和维护窗口；
- 公网开放期限；
- 服务器只读体检后的构建策略；
- Cloudflare 目标记录与现场登录条件；
- 任何 runbook 停止条件触发后的下一步。

原则授权不等于现在可以部署，也不等于可以猜凭据、跳过停止条件或在用户仍设计前端时开始外部写操作。

### 8.3 仍需用户给出或现场完成

1. 前端视觉最终确认：“可接受”或具体修改意见。
2. 最终发布提交：应是前端合入并验证后的固定提交，不是现在的 `d7cefd4`。
3. 源码传输：建议无 remote 时使用固定提交的 `git archive`；若要私有 remote，需另行配置最小权限。
4. 公网链接长期开放还是只在评审期开放。
5. SSH 用户、认证方式和 sudo 条件；不得猜。
6. 服务器资源体检后的构建策略：原机构建、匹配 Linux ABI 的产物，或经授权加 swap。
7. 嵌入提供商和密钥；不阻塞当前主路径。
8. 视觉模型对代表性真实作品的质量复核。
9. 实际 Chrome + 演示网络的语音输入。
10. 8 项真人体感与移动端走查。
11. 真实素材授权、匿名和隐私复核。
12. 报告终审、PDF、承诺书签章、平台上传、10 分钟视频录制。
13. 会诊教学层复核：两门重点课程的检查点、首轮文字长度与呈现节奏、草图阶段何时展开“工艺与规范”。

旧夜间清单里的 “是否用 shadcn/ui” 已失去阻塞意义：当前项目没有 shadcn/Radix 依赖，设计系统已经自建。除非用户主动要求重构，不要为补一个旧决策重新换 UI 技术栈。

---

## 9. 后续完整执行方案

### 阶段 A：完成前端设计，不碰集成与服务器

工作树：

```text
E:\第二届教师人工智能应用能力大赛\.worktrees\lumi-frontend
```

执行方式：

1. 先看 `git status --short` 和当前 diff；把所有现存未提交内容视为用户所有。
2. 继续按浏览器批注逐项修改，不做未经请求的全站重构。
3. 以最新 `docs/frontend/homepage-copy.md` 和 `product-and-design-brief.md` 为事实/文案依据。
4. 核对桌面、375–390px 移动端、键盘焦点、无横向溢出、字体自托管、低性能降级。
5. 确认哪些 `canvas/`、`tmp/` 和生成图需要保留；不得自行删除。
6. **编辑授权不等于暂存或提交授权。** 只有用户明确确认本轮文件清单并要求提交后，才能按路径精确 `git add`、按主题独立提交；禁止 `git add .` 和 `git add -A`。
7. 用户说“前端内容冻结”之前，不进入正式合并；即使内容已冻结，也必须等集成候选通过最终视觉验收后才能合 `main` 和部署。

### 阶段 B：把前端成果合入集成分支

前置：`feature/lumi-frontend` 的用户改动已经整理、验证并提交，工作树符合预期。

建议方向：

```text
feature/lumi-frontend
  -> merge into feature/lumi-integration
```

原因：集成分支已经包含 W2 会诊、W3 演示数据、模型诊断、E2E 修复等后续工作；前端分支同时已吸收 `main` 的 8 个最新设计文档提交。不要反过来用旧集成页面覆盖前端。

合并前：

- 为两个分支各记录 HEAD；
- 更新仓库外 bundle；
- 检查用户 WIP 已提交或明确保留；
- 不处理 CRLF-only 规格文件；
- 不触碰 `data/evidence-dev/`。

重新打 bundle 时使用日期或精确提交号命名，放仓库外并验证完整性；目标目录不可写时先申请权限，不要改放进仓库：

```powershell
$ReleaseCommit = git rev-parse --short HEAD
$ReleaseBundle = Join-Path $env:LOCALAPPDATA "ChuyingAI\backups\lumi-integration-$ReleaseCommit.bundle"
git bundle create $ReleaseBundle feature/lumi-integration
git bundle verify $ReleaseBundle
Get-FileHash -LiteralPath $ReleaseBundle -Algorithm SHA256
```

合并后重点人工检查冲突：

- `app/globals.css`；
- `components/home/**`；
- `components/entry/EntryForm.tsx`；
- `CONTEXT.md`；
- `docs/frontend/homepage-copy.md`；
- `docs/frontend/product-and-design-brief.md`；
- 学生入口与 `student-v2`；
- E2E 选择器与文案断言。

### 阶段 C：冻结候选提交并做完整自动验证

所有命令在最终集成工作树执行。先确认 Node 满足 `>=20.19.0 <25`，项目声明 pnpm `11.7.0`。

工具链预检：

```powershell
pnpm runtime:preflight
```

随后运行并把完整输出写入 `docs/reports/`，记录被测提交、文件数、用例数、耗时、skip/todo 和退出码：

```powershell
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm build
pnpm test:e2e
```

如果首次测试失败，先保存失败现场；修复必须另开提交，不能只记录“修完后的绿”。

E2E 应使用隔离端口和数据库，不能与用户正在看的本地服务抢端口。自动 E2E 不替代真人视觉。

### 阶段 D：最终提交上的真实模型质量门

用户已授权调用真实模型。运行前：

1. 查看 `effective-model-config`，确认实际来源是预期的 `service.env`，base URL 含 `/v1`；
2. 确认没有其他 worktree 正在跑同一评测；
3. 确认共享 `.lock.sqlite` / `.progress.json` 没有活动进程；
4. 不输出 Key、完整请求或学生内容。

先做只读进程检查；若仍有 `evaluate-agent` 进程，等待它结束：

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'evaluate-agent' } | Select-Object ProcessId,CommandLine
```

默认先让 runner 恢复或判断现有进度：

```powershell
pnpm agent:eval
```

只有在以下条件同时成立时才使用 `--restart`：没有活动进程；现有报告/进度的路径、来源提交和 suite 已记录；runner 明确因旧提交/旧套件需要干净重跑，或用户明确要求丢弃旧进度。**不得手工删除 `.lock.sqlite`。**

```powershell
pnpm agent:eval -- --restart
```

若遇到临时模型中断，runner 会保留已完成前缀；服务恢复后继续运行不带 `--restart` 的命令。最终还应运行：

```powershell
pnpm tutor:quality
pnpm --silent model:latency
```

归档细分 `transportCode`、`protocolCode`、脱敏 message/cause、模型辅助率和延迟。历史 37/37 只能用于比较。

最终质量门不是“命令退出 0 就算完”。按 `docs/release/phase-7-tutor-quality-validation.md`：

- 结构 eval 100%；
- 安全 harness 100%；
- 40 题全部得到 V3 `MODEL_ASSISTED` 并完成 judge；
- 至少 34/40 题满足 `specificityAndUsefulness >= 4` 且无硬失败；
- 五个评分维度平均均 `>= 4.0/5.0`；
- `AUTHORITY_OVERREACH`、`FABRICATED_SOURCE`、`PRIVACY_LEAK` 均为 0；
- 跨学生隐私哨兵通过。

### 阶段 E：真人体验和视觉验收

启动候选版本后，由用户或教师实际走：

```text
官网首页
  -> 开始使用 / 演示入口
  -> 新建对话与课程切换
  -> 上传真实或已授权代表性作品
  -> 自然回答
  -> 五维会诊
  -> 独立收束
  -> 历史恢复
  -> 教师查看
```

本阶段有两张不同的表：

- **官方 8 场景真人体感门**：严格运行 `tests/tutor-quality/human-scenarios.json` 的恰好 8 个场景；至少 7/8 愿意继续使用，三类硬失败为 0，报告绑定同一提交与场景哈希。模板见 `docs/release/phase-7-human-validation-template.md`。
- **产品与视觉走查表**：下面 10 项用于界面、移动端、真实视觉和演示质量复核，不等同于官方 8 场景。

产品与视觉走查至少记录：

1. 首页第一印象、文案和动效是否符合设计专业评委预期；
2. 应用本体是否真正为作品让路；
3. 中文行高、中英混排、标点和小字号是否舒适；
4. 收束是否明显不是第六张卡；
5. 12 秒级首字等待是否有清楚反馈，是否诱发重复点击；
6. 上传、中断、模型不可用和恢复是否体面且诚实；
7. 375–390px 单栏能否完成全路径；
8. 教师侧是否正确排除预置数据；
9. 视觉模型是否真的读到作品，判断是否事实准确；
10. Chrome 语音输入在实际演示网络能否工作。

用户明确回复“最终视觉可接受”后，才进入下一阶段。

### 阶段 F：合入 `main`

已获原则授权，但必须在阶段 A–E 完成后执行。

合并前再次确认：

- 最终候选提交固定；
- 测试和真人验收绑定该提交；
- `main` 没有新增未吸收提交；
- 用户 WIP 已安全提交；
- 创建最新完整 bundle；
- 只精确暂存需要的文件。

合并后再运行最小发布门和 production build；以 `main` 的精确提交作为部署源。

### 阶段 G：S0 部署

完整执行 `docs/runbooks/deploy-s0.md`，不要临场自创快捷路径。

核心保护：

1. 先只读体检服务器、端口、内存、Node、Caddy、现有站点和回滚点；
2. Caddyfile 先备份并记录摘要；
3. 只在末尾追加 Lumi 独立站点块；
4. upstream 必须是 `127.0.0.1:3100`；
5. `caddy validate` 通过后才 `reload`，不能 `restart`；
6. reload 后立刻逐站回归现有站点；
7. 任一既有站点异常立即回滚，不继续 Cloudflare；
8. 3000 与 3100 只监听 loopback；
9. 不上传 Windows `node_modules` 到 Ubuntu；
10. 若服务器 `MemAvailable < 4 GiB`，禁止原机构建；历史峰值约 3.48 GiB，实际还要为系统和既有站点留余量；
11. 外置生产配置固定到 `/etc/lumi/lumi.env`，不回显密钥；
12. 数据迁移前必须有经过验证的一致恢复点。

公网成功后，才生成二维码；必须用校园 Wi-Fi 与蜂窝网络两台实体设备实扫。

### 阶段 H：报告与最终材料

1. 把最终提交、自动测试、真实模型、真人体验、公网链接和二维码逐项写入 `evidence-ledger.md`。
2. 只有账本状态转为可公开，才能回填 `entry-report-draft.md`。
3. 继续删除或改写未交付配置台、洞察台、主动举一反三的完成态措辞。
4. 7/31 前完成报告与可运行链接。
5. 8/26 前由用户/责任人完成 PDF、承诺书、上传和 10 分钟视频。

---

## 10. 本轮踩过的坑与必须规避的雷区

### 10.1 看错配置文件，导致排障方向完全错误

仓库 `.env.local` 和全局 `service.env` 指向过不同服务器；实际评测由全局文件覆盖。针对 `.env.local` 做的 11 次实验虽然成功，却测试了另一台服务器，不能解释评测失败。

**规避：**每次模型命令先看 `effective-model-config`；明确配置来源、规范化 base URL 和端点哈希。

### 10.2 Base URL 缺 `/v1`

中转根路径在非流式请求中可能“看似能用”，但流式 + tools 会返回另一种形态，最终表现成 `INVALID_RESPONSE`、`undefined.type`、`BYTE_LIMIT` 或确定性降级。

**规避：**目标中转要求 `/v1` 时必须写完整；验证要走项目真实适配器 + 流式 tools，不能只 `ping` 或测 `/models`。

### 10.3 把所有错误压成 `TRANSPORT`

早期评测把 19 种细分错误压成一个 `TRANSPORT`，导致无法区分连接重置、协议字段缺失、字节限制和模型无效响应。

**规避：**保留 T4 的 `transportCode`、`protocolCode`、脱敏 message/cause 链；不要退回笼统上报。

### 10.4 直接探测中转，不等于应用真实链路

裸 fetch、非流式、流式但无 tools、应用适配器、完整 Agent turn 是不同实验。裸探针失败或成功都不能自动代表应用行为。

**规避：**先用最小请求定位层级，再以 `createOpenAICompatibleModelProvider` 和真实 Agent 入口做最终判定。

### 10.5 推理模型被短总超时误杀

50 秒总闸门曾把正常慢推理误判为网络问题。

**规避：**保持 idle 与 total 分离；线上和评测使用不同档位，不要因为一次慢请求就修改协议解析。

### 10.6 worktree 不复制 `.env.local`，却共享全局配置和评测进度

新 worktree 没有 ignored `.env.local`，但共用 `%LOCALAPPDATA%` 下的 `service.env`。若报告路径相同，`.progress.json` 和 `.lock.sqlite` 也共享。

**规避：**同一种真实评测一次只在一个 worktree 运行；出现 `AGENT_EVAL_ALREADY_RUNNING` 时等待进程，不删除锁、不抢跑 `--restart`。

### 10.7 `'tsx' is not recognized` 不是业务或模型错误

曾因 `node_modules/.bin` shim 缺失，`npm run agent:eval` 无法进入脚本。

**规避：**先跑 `pnpm runtime:preflight`。若提示 `TOOLCHAIN_TSX_SHIM_MISSING`，按项目提示运行 `pnpm install --frozen-lockfile`；不要删评测锁或改模型代码。

### 10.8 pnpm 依赖状态警告不能被隐瞒

全量测试第一次因为无 TTY 下 pnpm 试图清理依赖而失败；第二次使用 `pnpm_config_verify_deps_before_run=warn` 才运行。

**规避：**保留首次失败记录。最终候选应在可控环境用锁文件同步依赖，再重跑完整测试；不要把警告后的祖先结果冒充最终提交证据。

当前审计还发现，集成工作树的 `node_modules` 是指向 `lumi-frontend\node_modules` 的 Junction。一个 worktree 中安装、清理或重建依赖，可能立刻影响另一个工作树和用户正在运行的页面。

**规避：**不要在用户设计过程中随意清理共享 `node_modules`。最终验证应使用明确、隔离、按锁文件安装的依赖环境；在共享 Junction 上执行安装前先通知并确认不会打断前端工作。

### 10.9 `test-results/.last-run.json` 的 `failed` + 空 failedTests

这通常是 webServer、seed、全局 setup 或中途中断，不代表“没有失败测试所以通过”。

**规避：**先记录全局错误类别，再决定是否修；不要只看 failedTests 数组。

### 10.10 无模型 E2E 不能证明模型质量

当前 21/21 E2E 明确把模型指向 `127.0.0.1:9`。

**规避：**报告只能写 UI/契约/降级自动验证；视觉理解与导师质量必须单独真实模型 + 人工复核。

### 10.11 本地“模型服务不可用”不是因为尚未部署

本地页面进入确定性降级，通常是本地进程没有读到模型配置、端点错误、传输中断或返回无效；部署不是前置条件。

**规避：**看 `effective-model-config` 和细分诊断，不把部署当万能解释。

### 10.12 视觉模型能力不能按名字推断

中转可能把图片字段丢弃，文本模型也可能返回看似合理的泛化意见。

**规避：**使用可判别图像、确认请求实际含图、检查返回依据，再由教师复核；否则明确说未读取画面。

### 10.13 浏览器语音输入在国内网络可能失败

`SpeechRecognition` / `webkitSpeechRecognition` 的 Chrome 实现可能把音频发送给 Google 服务，在国内网络走 `network` 错误。

**规避：**实际演示浏览器 + 网络实测。失败时保留“仍可键盘输入”的体面降级；未实测前不把语音写成报告亮点。

### 10.14 Caddy 不能直连 3000

生产登录依赖 3100 可信代理生成签名请求头。Caddy 直连 Next.js 3000 会导致登录 403。

**规避：**固定 `Caddy -> 3100 -> 3000`，并检查两端口只监听 loopback。

### 10.15 共享服务器不能随意改 Caddy

服务器还有既有站点，错误 reload 会影响其他服务。

**规避：**备份、只追加、validate、reload、立即逐站回归；绝不重排已有块或用 restart 代替 reload。

### 10.16 用户资料与换行假改动

`data/evidence-dev/` 是用户未提交图片；设计规格文件是 CRLF-only 假修改。

**规避：**禁止 `git add .` / `git add -A`；只精确暂存。不得修改、删除、清理或提交这两类内容。

### 10.17 前端工作树当前有大量未提交用户设计

任何 reset、checkout、clean、格式化或跨 worktree 复制都可能毁掉用户正在做的首页。

**规避：**把 `lumi-frontend` 视为用户所有；先读 diff，只按明确批注小范围修改。绝不运行破坏性 Git 命令。

### 10.18 集成分支与 main 已分叉

集成分支落后 main 8 个最新设计文档提交；同时前端分支有新 WIP。

**规避：**先完成前端并提交，再把前端合入集成，重新验证，最后才合 main。不要直接部署 `d7cefd4`。

### 10.19 历史数字不能挪到当前版本

- 37/37 绑定 `1a34a4f`；
- 2055/2055 绑定 `42741cb`；
- build 绑定 `bcc78b3`；
- E2E 21/21 绑定 `7481a40` 且无真实模型。

**规避：**每个公开数字必须同时写提交、套件、环境和边界。报告以 `evidence-ledger.md` 为准。

### 10.20 预置演示不是课堂证据

D-017、方案板、三状态图、版式海报和班级卡都是自创预置数据。

**规避：**界面常驻“预置演示”，教师统计默认排除；不得宣称真实学生历史、学习提升或课堂成效。

### 10.21 旧前端目录不能无依据删除

`components/student/` 无生产入口，但仍有测试和活后端关系；原最高指令也没有授权删除。

**规避：**在缺失计划正式归档并由用户裁决前保留。后续做 S3 时可能复用 TransferChallenge。

### 10.22 Windows 构建产物不能直接搬到 Ubuntu

项目包含 `better-sqlite3` 等原生依赖。

**规避：**不得上传 Windows `node_modules`。如不用服务器原机构建，应在匹配 Ubuntu、Node ABI 的 Linux 环境构建。

### 10.23 不要为赶比赛重新虚构功能

早期报告曾把配置台、洞察台、举一反三写成已有，已经纠正。

**规避：**功能逐条与线上实际对账；没有代码、没有可点击路径、没有真实数据就写“规划中/预置演示/待验证”。

---

## 11. 常用路径与命令

### 11.1 本地开发

```powershell
cd "E:\第二届教师人工智能应用能力大赛\.worktrees\lumi-frontend"
pnpm runtime:preflight
pnpm dev -- --hostname 127.0.0.1 --port 3200
```

开发页：

- 官网：`http://127.0.0.1:3200/`
- 学生端：`http://127.0.0.1:3200/student`
- 预置演示：`http://127.0.0.1:3200/student?demo=1`
- 教师端：`http://127.0.0.1:3200/teacher`
- UI 预览：`http://127.0.0.1:3200/dev/ui`

本交接生成时，3200 与 3300 都没有监听服务。

### 11.2 自动验证

```powershell
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm build
pnpm test:e2e
```

### 11.3 真实模型

```powershell
pnpm agent:eval
pnpm tutor:quality
pnpm --silent model:latency
```

需要丢弃旧进度时按阶段 D 的保护条件再使用 `--restart`，不要把它当默认命令。

### 11.4 关键文档

- `CONTEXT.md`
- `docs/frontend/homepage-copy.md`
- `docs/frontend/product-and-design-brief.md`
- `docs/frontend/api-contract.md`
- `docs/competition/evidence-ledger.md`
- `docs/competition/entry-report-draft.md`
- `docs/runbooks/demo-script.md`
- `docs/runbooks/demo-assets.md`
- `docs/runbooks/runtime-configuration.md`
- `docs/runbooks/model-latency-and-timeouts.md`
- `docs/runbooks/deploy-s0.md`
- `docs/reports/2026-07-19-vitest-42741cb.md`
- `docs/reports/2026-07-20-e2e-7481a40.md`

---

## 12. 新对话的第一步

新 AI 不要一上来继续编码。先执行以下只读动作：

1. 按第 1 节顺序读 vault 指令、项目页、本文件与仓库真源。`Agent开发.md` 只作历史背景，其中的旧 OneDrive 路径、`feature/tonggan-mvp` 分支和旧公网状态都不得当作当前事实。
2. 在 `lumi-frontend` 运行 `git status --short`、`git diff --stat`，确认用户 WIP 是否仍与本文件一致。
3. 在 `lumi-integration` 记录 HEAD、与 main 的 ahead/behind、CRLF-only 文件状态。
4. 问用户当前希望：继续前端批注实现，还是宣布“前端内容冻结”进入集成。
5. 未得到“前端内容冻结”前，不合并、不部署、不跑会干扰用户页面的全量 E2E；即使已经内容冻结，也必须在集成候选上取得“最终视觉可接受”，才可合 main 和部署。

可以直接对用户这样汇报：

> 我已恢复现场。你当前在 `feature/lumi-frontend` 做官网设计，那里有未提交的首页、样式、媒体和测试改动；我不会覆盖或清理。集成候选快照是 `d7cefd4`，但它落后 main 的 8 个最新设计决策，也不包含你当前 WIP。我先复核实时状态；你继续用浏览器批注，我按项实现。等你说“前端内容冻结”，再合入集成并跑最终验证；集成候选经你确认“最终视觉可接受”后，才合 main 和部署。

---

## 13. 最终状态一句话

**Lumi 的工程底座和集成自动化已基本成型，当前真正的主线不是继续开放式排障，而是保护用户正在进行的官网前端设计，待其定稿后完成一次严格的“前端合入—最终提交验证—真人验收—main 合并—3100 可信代理部署—报告回填”闭环。**
