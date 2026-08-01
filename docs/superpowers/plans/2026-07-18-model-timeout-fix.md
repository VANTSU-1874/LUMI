# 修复：模型超时闸门卡死推理模型（for Codex 重建会话）

> ## ⚠️ 2026-07-18 晚间更新：超时问题已修复，但评测仍失败——原因不同
>
> 本文最初的超时诊断**已被采纳并修复**（现为 idle 120s / total 600s，线上另设 45s/120s）。但 `npm run agent:eval` 在提交 `ebd2a8c` 上仍然 case 0 失败、`errorCode: TRANSPORT`、20 秒内放弃。**新的诊断见下方"第二轮诊断"，T1/T2 已无需执行。**

> **优先级：最高。**它阻塞重建第 7 阶段（体感验证），而第 7 阶段是 V3 转正的前提，也是冲刺计划 S0 之后一切工作的地基。
>
> **影响面：不只是评测，线上同样受影响。**按当前配置，学生问一个稍复杂的问题、模型思考超过 50 秒，学生就会收到失败。**Lumi 配 `gpt-5.6-sol` 在真实使用中当前是坏的。**

## 现象

```json
{"status":"MODEL_UNAVAILABLE","errorCode":"TRANSPORT",
 "completedCaseCount":0,"caseCount":37,"nextCaseIndex":0}
```

## 诊断（已核实，非推测）

**先排除网络**：`LLM_BASE_URL = https://arlowoods.cc.cd/v1` 解析到 `38.65.95.96`（即自有洛杉矶服务器）。实测 DNS 正常、丢包 0%、延迟 175ms、TLS 握手 0.39s、`/v1/models` 返回 401（未带密钥，符合预期）。**服务活着，网络通畅。**

**真正原因：超时闸门远小于推理模型所需时间。**

| 位置 | 内容 | 问题 |
| --- | --- | --- |
| `lib/agent/policy-registry.ts:55` | V3 `modelTimeoutMs: 50_000` | 实际闸门 50 秒 |
| `lib/agent/policy-contract.ts:17` | `.max(60_000)` | **schema 硬上限，配都配不过 60 秒** |
| `lib/ai/client.ts:605` | `.max(60_000)` | 二次封顶 |
| `lib/ai/client.ts:305` | `DEFAULT_TIMEOUT_MS = 10_000` | 默认仅 10 秒 |
| `lib/agent/policy-contract.ts:32` | `modelTimeoutMs < turnTimeoutMs` | 提高时必须同步提高 `turnTimeoutMs` |

模型为 `gpt-5.6-sol`（ultra 推理档）。A/B 测试记录显示该模型完成一项文档任务约 540 秒，远超 50 秒闸门。

**关键佐证：`completedCaseCount: 0`。**真正的网络故障会产生部分成功；37 个用例一个不剩，只可能是系统性超时。

**第二个缺陷：超时是总时长，不是停顿检测。**`lib/ai/client.ts:772-775` 是一次性 `setTimeout`，**收到流式数据也不重置**。即使模型正常吐字，到点照样中断。

## 修复

### Task T1：解封闸门（立即，让评测能跑）

- [ ] `lib/agent/policy-contract.ts:17`：`.max(60_000)` 提高到足以容纳推理模型（建议 600_000 / 10 分钟）
- [ ] `lib/ai/client.ts:605`：同步提高该 `.max()`
- [ ] `lib/agent/policy-registry.ts:55`：V3 `modelTimeoutMs` 提到合理值
- [ ] 同步提高 `turnTimeoutMs`，满足 `modelTimeoutMs < turnTimeoutMs`（`policy-contract.ts:32`）
- [ ] **改为可配置**：通过环境变量注入，使评测与线上可用不同值（评测可长，线上要短）
- [ ] `lib/ai/client.ts:305` 的默认值一并复核

**验收**：`pnpm` 评测脚本能跑完至少若干用例，不再 0 完成。

### Task T2：修正超时语义（正确的架构，不要跳过）

当前是"总时长上限"，应改为**停顿检测**：

- [ ] 流式路径改为：每收到一个数据块就重置计时器；只有**持续 N 秒没有任何数据**才判超时
- [ ] 另设一个大得多的总时长兜底（防止无限流）
- [ ] 非流式路径保留总时长上限，但取值要匹配推理模型

**理由**：一个流畅吐字 3 分钟的推理模型是**在正常工作**，砍掉它是错的。停顿检测才能区分"在思考/在输出"与"真的挂了"。

**验收**：模拟一个缓慢但持续输出的响应，不被误杀；模拟一个中途静默的响应，能及时判超时。

### Task T3：回归与记录

- [ ] 补测试覆盖 T2 的两种场景（缓慢但持续 / 中途静默）
- [ ] 重跑 37 个用例的黄金集，记录通过率与实际耗时分布
- [ ] 把实际单次调用耗时写进 `docs/runbooks/`，供后续容量与体验判断

## 需要用户拍板的产品决策

**`gpt-5.6-sol`（ultra 推理档）适合做线上导师吗？**

- 评测/评判场景：慢没关系，质量优先，用 sol 合理。
- **线上学生对话：学生不会等几分钟。**

关键在于该模型**是否早早开始吐字**：

- 若**首字很快、边想边说** → 流式下体验可接受，学生看到文字持续出现，总时长长也无妨。
- 若**长时间静默思考、最后一次性输出** → 对线上聊天不可用，线上需换更快的模型或更低推理档，sol 留给评测与 LLM 评判。

- [ ] Codex 实测一次真实调用的**首字延迟**与**总时长**，用数据回答这个问题，再由用户决定线上模型策略。

## 纪律

修复超时属于"拆笼子"，符合重建计划第 0 节的最高指令：**不要因为怕超时就加更多拦截**。遇到取舍无法自决，写 `> DECISION NEEDED:` 停下等确认。

---

# ✅ 根因已确定并修复（2026-07-19 02:19）

**故障：`LLM_BASE_URL` 缺少 `/v1`。**

评测读取的是**仓库外的全局配置** `%LOCALAPPDATA%\ChuyingAI\config\service.env`，且其优先级覆盖一切（`scripts/evaluate-agent.ts`：`{ ...process.env, ...serviceEnvironment }`）。该文件中 `LLM_BASE_URL=https://wawazz.xyz` 缺少 `/v1` 路径段，导致**流式 + 工具**的响应格式与解析器预期不符。

**实测证据**（用项目自己的 `createOpenAICompatibleModelProvider`，真实 service.env 凭据）：

| baseUrl | 非流式+工具 | 流式+工具（评测走这条） |
| --- | --- | --- |
| `https://wawazz.xyz`（原配置） | ✅ 34.6s | ❌ 68.7s → `INVALID_RESPONSE`，cause: `TypeError: Cannot read properties of undefined (reading 'type')` |
| `https://wawazz.xyz/v1`（已修） | ✅ 4.8s | ✅ 18.9s |

修复后**顺带快了 3–7 倍**。原文件已备份为 `service.env.bak-20260719-021925`。

**为什么长时间定位不到**：仓库内 `.env.local` 指向 `arlowoods.cc.cd`，而实际生效的是 `service.env` 中的 `wawazz.xyz`。所有针对 `.env.local` 端点的测试（包括本文档第二轮诊断里的 11 个场景）**打的都是另一台服务器**，因此全部通过却毫无意义。

**关于"回归"的补充判断**：`1a34a4f` 通过时配置很可能同样缺 `/v1`，只是当时的流式解析较宽容；`ebd2a8c` 重写流式中继后变严格，于是暴露。故配置本身一直有小错，新代码只是不再兜底。**T3.5 回归二分已作废，无需执行。**

## 后续（仍需做）

- [ ] **T4 错误可见性**照常执行：本次定位靠人工复现，正常应由报错直接给出 `INVALID_RESPONSE` 与 cause，而非笼统的 `TRANSPORT`
- [ ] 评估 `ebd2a8c` 的流式解析是否应更防御（对缺失字段给出可读错误，而非 `undefined.type` 崩溃）
- [ ] **T6 配置单一真源**（见下）
- [ ] T5 嵌入解耦仍然有效（`/embeddings` 在中转上不可用的问题独立存在，需在**正确的 baseUrl** 下重新确认）

## Task T6：消除"改了 A 却生效 B"的配置陷阱

当前存在两套互相矛盾的配置，且优先级不直观：

| 文件 | LLM_BASE_URL | 是否生效 |
| --- | --- | --- |
| `.worktrees/tonggan-mvp/.env.local` | `arlowoods.cc.cd/v1` | ❌ 被覆盖 |
| `%LOCALAPPDATA%\ChuyingAI\config\service.env` | `wawazz.xyz/v1` | ✅ **实际生效** |

- [ ] 确定唯一真源：要么删除仓库内 `.env.local` 的模型相关项，要么让两者一致
- [ ] 在 `docs/runbooks/` 写明**配置优先级与"哪个文件说了算"**，并说明 `service.env` 位于仓库外、不随 worktree 变化
- [ ] 启动时打印**生效的 baseUrl 与配置来源文件**（密钥不打印），使此类错配一眼可见
- [ ] `.env.example` 补注释说明 `service.env` 的存在与覆盖关系
- [ ] ⚠️ 新建 worktree 不会带 `.env.local`，但会共用 `service.env` 与 `AGENT_EVAL_REPORT_PATH`（全局路径）——**多 worktree 并行跑评测会互相覆盖进度文件**，需在 runbook 中警示或改为按 worktree 隔离

---

# 第二轮诊断（2026-07-18 晚间，提交 `ebd2a8c`）——已被上方结论取代

## 已用实验排除的范围——模型客户端层完全健康

用**与评测完全相同的参数**（`vision: true`、模型 `gpt-5.6-sol` 故 `webSearch: true`、idle 120s / total 600s）直接调用他们自己的适配器，11 个场景全部成功：

| 层 | 场景 | 结果 |
| --- | --- | --- |
| 网络 | 到中转 `arlowoods.cc.cd`（即自有 LA 服务器） | 0% 丢包 / 175ms |
| HTTP | `/chat/completions` 非流式 / 流式 | ✅ 14.4s / 512 数据块 |
| HTTP | `/responses` 裸调 / +function / +hosted web_search | ✅ 3.1s / 2.6s / 43.7s |
| 应用 | `adapter.complete` 非流式 / 流式 | ✅ 14.0s / 13.8s |
| 应用 | `adapter.respond` +工具 / +web_search / +流式 | ✅ 13.5s / 14.9s / 24.8s |

**结论：不要再在 `lib/ai/client.ts`、适配器、中转 API、网络上找原因。**故障在其上的编排层（`runTutorTurn`：检索、DB、工具循环、图像处理）或评测夹具本身。

## 为什么至今抓不到元凶——错误码被压平了

`scripts/evaluate-agent.ts` 的 `stopForServiceInterruption` 只上报：

```js
errorCode: input.failure.code,     // 永远只是 "TRANSPORT"
```

而 `lib/ai/client.ts` 定义了 **19 种** TRANSPORT 细分码（`ECONNRESET`、`ECONNREFUSED`、`ETIMEDOUT`、`UND_ERR_CONNECT_TIMEOUT`、`UND_ERR_HEADERS_TIMEOUT`、`UND_ERR_BODY_TIMEOUT`、`UND_ERR_SOCKET`、各类 TLS 错误、`OTHER` …）。**细分码在上报时被丢弃**，所以重跑多少次都只得到同一个无信息量的 "TRANSPORT"。

### Task T3.5：先确认回归窗口（**最先做，约 20 分钟出结果**）

评测在 `1a34a4f` 上**通过过**（37/37，`passRate: 1`），在 `ebd2a8c` 上失败。中间只隔两个提交，其中 `bc45c2e` 仅新增测试数据，`ebd2a8c` 改了 `lib/ai/client.ts` **604 行**。

**与其继续开放式排查，不如直接二分验证。**

- [ ] 用**临时 worktree** 检出 `1a34a4f`（不要在当前工作区切换分支，避免干扰进行中的改动），跑 `npm run agent:eval`
- [ ] 通过 → 回归由 `ebd2a8c` 引入，进入下方"定夺"
- [ ] 同样失败 → 不是代码回归，而是环境或外部因素（中转服务状态、本地数据库、种子数据等），改查这些

**定夺（若确认为 `ebd2a8c` 引入）**：**优先考虑回退该提交**，而非正向修复。理由：已实测证明 `respond` 的流式/非流式、带 function 工具、带 hosted web_search 共 11 个场景在当前代码下全部成功，说明该提交想修的问题未必仍然存在；而 13 天倒计时下，回退能立刻恢复评测，代价远低于修一个成因不明的东西。若回退后评测恢复，再评估 bounded relay streams 是否真有必要重做。

### Task T4：让错误自己说话（**与 T3.5 并行，一处小改动**）

- [ ] `scripts/evaluate-agent.ts` 的失败上报中，除 `failure.code` 外**一并输出 `transportCode` / `protocolCode` 与错误 message**（`evaluate-tutor-quality.ts` 同理）
- [ ] 失败时把完整错误链（含 `cause`）写入进度文件或旁路日志，不要只留一个枚举值
- [ ] 重跑 `npm run agent:eval`，用真实细分码定位

**验收**：失败输出能指明是连接被重置、DNS、握手、还是读超时——而不是笼统的 TRANSPORT。

> 诊断提示：进度文件显示 `startedAt 17:38:49` → `updatedAt 17:39:10`，**整轮仅 20 秒**即放弃，远未触及 120s 空闲或 600s 总时长闸门。故不是超时，更像连接被对端或中间层主动断开，或编排层在调用模型前就抛错。

## 附带发现：`/embeddings` 端点 404（独立问题，需决策）

实测该中转对 `/embeddings` 返回 **404**（`text-embedding-3-small` 与 `text-embedding-ada-002` 均是）。它只代理对话模型，不提供嵌入服务。

- 影响：**"混合语义检索"的向量半边在当前配置下不可用**，实际只跑词法匹配，检索质量受损。
- 现状：`.env.local` 未设 `LLM_EMBEDDING_MODEL`，`retrievalModelId: null`，所以**这不是评测失败的原因**，但会拉低导师回答的资料命中率。
**用户已决策（2026-07-18）：另配一家嵌入 API**，对话继续走现有中转。

### Task T5：让嵌入可以独立配置

当前 `lib/agent/orchestrator-context.ts:173-175` 把嵌入的 `baseUrl` 与 `apiKey` **写死为对话模型的同一套**，env 中也只有 `LLM_EMBEDDING_MODEL`，因此换一家提供商必须先解开这个耦合。

- [ ] `lib/config/env.ts` 新增 `LLM_EMBEDDING_BASE_URL`、`LLM_EMBEDDING_API_KEY`（均可选）
- [ ] **回落逻辑**：未设置时沿用 `LLM_BASE_URL` / `LLM_API_KEY`，保持现有部署不受影响
- [ ] 校验规则同步调整：现在的 `LLM_EMBEDDING_MODEL requires a complete AI configuration`（`env.ts:150`）需要允许"嵌入独立成组"的组合
- [ ] `orchestrator-context.ts` 构造嵌入 provider 时改用嵌入专属配置
- [ ] `.env.example` 补充三个字段并注明"可与对话模型不同源"
- [ ] 补单测：只配对话 / 对话+嵌入同源 / 对话与嵌入异源，三种组合都能正确构造

**验收**：填入一家外部嵌入服务的地址与密钥后，混合检索的向量半边恢复工作；不填时行为与现在完全一致。

### 选型判据（供用户挑提供商）

1. 提供 **OpenAI 兼容的 `/embeddings`** 端点（代码走的是 OpenAI 兼容协议）
2. **中文效果好**——语料全是中文设计教学内容，中文原生模型通常优于通用多语种模型
3. 能从**洛杉矶服务器**访问（调用在服务端发起，不经过国内网络）

> 成本提示：嵌入比对话便宜两三个数量级，且语料仅约 100 个文件，费用可忽略。
>
> 注意 `orchestrator-context.ts:176` 给嵌入的超时是 `Math.min(5_000, …)` 即 5 秒——换用境外或较慢的服务后需复核该值是否够用。
