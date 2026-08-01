# Lumi 参赛报告证据账本

> 用途：限定参赛报告能够公开表达的能力与证据边界。状态为 `PENDING`、`PARTIAL` 或 `HISTORICAL_BASELINE` 的条目不得被改写成当前已验证成果。
>
> 安全规则：本账本只记录仓库相对路径、提交号、脱敏指标和泛化角色；不记录密钥、凭据、身份码、学生原文或服务器内部路径。

## 状态词典

- `VERIFIED_AUTOMATED`：当前能力已有代码与自动测试证据，但没有真人或课堂结论。
- `PARTIAL_DEMONSTRATION`：只完成预置素材、fixture 或 mock，不代表真实数据链路完整。
- `HISTORICAL_BASELINE`：只对指定历史提交和当时套件成立。
- `SINGLE_SAMPLE`：只有一次探针，不能外推稳定性或时延承诺。
- `LOCAL_BASELINE`：仅在记录的本地环境成立。
- `PARTIAL`：条目中的部分交付与观测已经验证，但列明的真人、长期或最终质量要求仍未完成；只能逐项陈述，不得概括为全部通过。
- `PENDING`：不得写成已完成。
- `NOT_DELIVERED`：当前公开报告必须明确排除。

## CLM-001 自然回答与可选会诊隔离

| 字段 | 记录 |
| --- | --- |
| claimId | `CLM-001` |
| publicClaim | 自然回答始终是主体；结构化会诊是可选副产物，缺失或无效时不重试模型、不进入规则降级、不覆盖正文。 |
| capability | 自然导师正文与五维会诊 sidecar 的解析、校验和失败隔离。 |
| status | `VERIFIED_AUTOMATED` |
| evidenceType | 代码审查 + 单元/集成契约测试。 |
| sourceCommit | `9c13841`（包含 `bce69c3` 的可选 sidecar 实现）；前端共享契约见 `bbf94a8`。 |
| sourceTrackedTreeClean | `true`（W2 分支在记录验证时；不代表此后集成工作树状态）。 |
| suiteVersion | `critique-contract-v1`；非发布质量套件。 |
| method | 使用假模型覆盖有效、缺失、格式无效与证据不合格 sidecar；比较正文、模型调用次数、运行模式与流式输出。 |
| observedAt | `2026-07-19`（Asia/Shanghai）。 |
| environment | Windows 本地测试环境；无外部模型调用。 |
| dataScope | 合成测试输入；不含真实学生数据。 |
| sampleSize | W2 合入前目标批次 145 个自动测试；本次报告对账在集成分支复核 7 个相关文件、69 个测试；均不计真人样本。 |
| metrics | W2 目标批次 145/145；本次相关复核 69/69。有效/无效/缺失 sidecar 分支均保持一次模型调用；无效或缺失时正文与 `MODEL_ASSISTED` 路径不被替换。 |
| artifactPath | `tests/integration/agent-v3-critique-sidecar.test.ts`；`tests/unit/critique-sidecar.test.ts`；`tests/unit/lumi-student-session.test.tsx`。 |
| limitations | 假模型只证明控制流与契约；不证明真实视觉判断、文本质量或课堂效果。 |
| allowedPublicWording | “自动测试验证了会诊副产物的结构与失败隔离契约。” |
| forbiddenWording | “会诊永不出错”“模型点评质量已验证”“失败时会用规则答案替代正文”。 |
| nextEvidenceNeeded | 在固定最终提交上运行真实视觉模型，并由教师复核正文和会诊是否同时成立。 |
| owner | 工程验证负责人；视觉质量由课程教师复核。 |

## CLM-002 三类课程深度与五维框架

| 字段 | 记录 |
| --- | --- |
| claimId | `CLM-002` |
| publicClaim | 当前课程深度只写通用设计、数字交互文创设计与书籍设计；会诊采用五维加独立收束。 |
| capability | 三个课程框架配置、固定维度顺序、只深谈 1–2 维、独立收束。 |
| status | `VERIFIED_AUTOMATED` |
| evidenceType | 配置清点 + schema/单元测试。 |
| sourceCommit | `30b6bf2`，防御修订见 `9c13841`。 |
| sourceTrackedTreeClean | `true`（W2 分支在记录验证时）。 |
| suiteVersion | `critique-framework-v1`。 |
| method | 枚举框架映射并校验五个固定维度、课程标签、深谈数量、收束必填和软件故障分流。 |
| observedAt | `2026-07-19`（Asia/Shanghai）。 |
| environment | Windows 本地测试环境。 |
| dataScope | 课程配置与合成请求。 |
| sampleSize | 3 个课程框架；每个框架 5 个维度 + 1 个独立收束。 |
| metrics | `general-design`、`digital-interaction`、`book-design` 三个框架存在；结构 schema 自动校验。 |
| artifactPath | `lib/agent/critique-framework.ts`；`lib/agent/critique-contract.ts`；`tests/unit/critique-framework.test.ts`。 |
| limitations | 自动校验不证明课程表述已获得教师共识，也不证明其他课程已深度覆盖。 |
| allowedPublicWording | “当前深度支持三类课程，并以五维加独立收束约束会诊结构。” |
| forbiddenWording | “覆盖全部专业课程”“五维结论已获教师一致认可”“具备真实课堂成效”。 |
| nextEvidenceNeeded | 课程教师复核检查要点，并用代表性作品验证不同课程下的判断质量。 |
| owner | 课程内容负责人 + 工程验证负责人。 |

## CLM-003 私密会诊记录与历史引用

| 字段 | 记录 |
| --- | --- |
| claimId | `CLM-003` |
| publicClaim | 有效会诊可私密保存；只有同学生、同班级、同课程、同数据类型且可核对时才引用历史。 |
| capability | 会诊持久化、私有读取、访问角色与作品证据绑定、历史比较约束。 |
| status | `VERIFIED_AUTOMATED` |
| evidenceType | 数据库迁移 + 路由/持久化集成测试。 |
| sourceCommit | `b3ec5f0`，证据与角色防御见 `9c13841`、`65512c5`。 |
| sourceTrackedTreeClean | `true`（W2 分支在记录验证时）。 |
| suiteVersion | `agent-critique-storage-v1`。 |
| method | 在隔离数据库创建合成记录，验证保存、删除级联、401/403/404/200、历史范围与无历史分支。 |
| observedAt | `2026-07-19`（Asia/Shanghai）。 |
| environment | Windows 本地 SQLite 测试环境。 |
| dataScope | 合成私密记录；不含真实学生数据。 |
| sampleSize | 以目标路由和持久化测试覆盖的合成记录为准；无真人样本。 |
| metrics | 访问状态和同范围历史筛选通过自动测试；无效 sidecar 不阻断正文保存。 |
| artifactPath | `drizzle/0043_agent-critiques.sql`；`lib/agent/critique-store.ts`；`app/api/agent/turns/[turnId]/critique/route.ts`；相关集成测试。 |
| limitations | 尚未通过真实班级、真实删除请求或多教师协作验证。 |
| allowedPublicWording | “代码与隔离数据库测试验证了私密读取和历史范围约束。” |
| forbiddenWording | “已在真实课堂长期跟踪学生”“隐私风险为零”“历史比较一定准确”。 |
| nextEvidenceNeeded | 在经授权的试用环境执行隐私清单、删除流程和跨角色人工复核。 |
| owner | 隐私验证负责人 + 课程教师。 |

## CLM-004 原创预置素材与 D-017 前端演示

| 字段 | 记录 |
| --- | --- |
| claimId | `CLM-004` |
| publicClaim | 仓库已备自创预置素材、确定性栅格派生，以及 D-017 的前端 fixture/mock 历史；它们只用于演示。 |
| capability | 预置作品展示、前端历史回放、按回合读取预置会诊。 |
| status | `PARTIAL_DEMONSTRATION` |
| evidenceType | 资产清单哈希测试 + fixture/mock 契约测试。 |
| sourceCommit | `e48bb23`（故事线）、`3680547`（栅格派生）、`d7db67c`（mock 历史）；原始 SVG 见 `4d5ceae`。 |
| sourceTrackedTreeClean | `true`（各提交形成时；本条只记录前端夹具与素材）。 |
| suiteVersion | `d017-demo-fixture-v1`。 |
| method | 校验 manifest、文件哈希/格式、显著预置标记、两段历史与逐回合会诊 mock。 |
| observedAt | `2026-07-19`（Asia/Shanghai）。 |
| environment | Windows 本地前端与文件系统测试环境。 |
| dataScope | `DEMONSTRATION_DATA`；全部为预置/合成内容。 |
| sampleSize | 4 份自创 SVG、2 份确定性 PNG 派生、1 条 D-017 前端演示故事线。 |
| metrics | manifest 权利字段、预置标记、哈希与 mock 契约通过自动测试。 |
| artifactPath | `public/demo/manifest.json`；`data/demo/lumi-d017.ts`；`components/client-api/mock/fixtures.ts`；相关单元测试。 |
| limitations | 不是学生上传、软件实拍或课堂数据；数据库种子另见 `CLM-012`。 |
| allowedPublicWording | “原创预置素材和前端演示夹具已备，用于不依赖真实学生数据的功能展示。” |
| forbiddenWording | “真实学生成长档案”“真实课堂案例”“证明学习提升”。 |
| nextEvidenceNeeded | 真实素材仍需授权与匿名复核；前端夹具与真实服务端读取路径仍需人工联调。 |
| owner | 演示内容负责人 + 数据验证负责人。 |

## CLM-005 历史 37/37 结构评测

| 字段 | 记录 |
| --- | --- |
| claimId | `CLM-005` |
| publicClaim | 历史提交 `1a34a4f` 在 suite `2026-07-17.4` 上通过 37/37；该结果不代表当前最终集成。 |
| capability | 当时版本的课程路由、回答相关性代理指标、来源精度、动作安全与安全结构。 |
| status | `HISTORICAL_BASELINE` |
| evidenceType | 真实模型结构评测历史报告。 |
| sourceCommit | `1a34a4f1038a5dd6c840cf8121c326ec0c9a39bb`。 |
| sourceTrackedTreeClean | `true`。 |
| suiteVersion | `2026-07-17.4`。 |
| method | 37 个固定案例通过应用自身 V3 导师入口运行；nearest-rank 统计案例端到端耗时。 |
| observedAt | `2026-07-18T14:44:46.780Z`。 |
| environment | 当时配置的 OpenAI 兼容中转；模型名仅为本地配置标签。 |
| dataScope | 固定评测案例；非真实学生课堂样本。 |
| sampleSize | 37。 |
| metrics | 37/37；passRate 1；modelAssistedRate 1；routing 1；answerRelevance 0.9459459459；sourcePrecision 1；actionSafety 1；safety 1；平均案例耗时 35067ms。 |
| artifactPath | `docs/runbooks/model-latency-and-timeouts.md`。 |
| limitations | 是历史提交和历史套件，不是当前集成；结构指标不等于教师认可、真人体验或课堂效果。 |
| allowedPublicWording | “历史版本曾在指定 37 题结构评测中全部通过，当前版本仍须重跑。” |
| forbiddenWording | “最终版本 37/37”“真实教学质量 100%”“真人验证通过”。 |
| nextEvidenceNeeded | 固定最终集成提交，重新运行完整真实模型评测并归档报告。 |
| owner | 模型评测负责人。 |

## CLM-006 单样本模型延迟

| 字段 | 记录 |
| --- | --- |
| claimId | `CLM-006` |
| publicClaim | 单次模型辅助探针首个可见文字为 12.503 秒、总时长为 24.983 秒；只作为体感设计参考。 |
| capability | 一次 V3 导师流式回合的可见输出时间。 |
| status | `SINGLE_SAMPLE` |
| evidenceType | 真实模型单次探针。 |
| sourceCommit | `ebd2a8ce1144ebaead1310d952a227aabb07fea1`。 |
| sourceTrackedTreeClean | `true`。 |
| suiteVersion | `model-latency-probe-v1`；单样本。 |
| method | 通过应用导师入口运行固定演示案例，记录首个非空可见文字和回合总时长，不记录正文。 |
| observedAt | `2026-07-18T17:36:26.653Z`。 |
| environment | Windows 本地调用 OpenAI 兼容中转；模型名不证明上游真实身份。 |
| dataScope | 固定预置演示问题；不含真实学生数据。 |
| sampleSize | 1。 |
| metrics | firstVisibleTextMs 12503；totalMs 24983；最终模式 `MODEL_ASSISTED`。 |
| artifactPath | `docs/superpowers/plans/2026-07-18-lumi-sprint-to-0731.md`（摘要记录；原始脱敏 JSON 待归档）。 |
| limitations | 单次结果受模型负载和链路波动影响；不是百分位、稳定性结论或服务等级目标。 |
| allowedPublicWording | “一次探针约 12.5 秒出现首个可见文字，界面因此持续提供等待反馈。” |
| forbiddenWording | “首字保证 12.5 秒内”“平均响应 12.5 秒”“达到线上 SLA”。 |
| nextEvidenceNeeded | 在固定部署链路进行多次、分时段测量，并给出样本数与 p50/p90/p95。 |
| owner | 性能验证负责人。 |

## CLM-007 Windows 本地生产构建基线

| 字段 | 记录 |
| --- | --- |
| claimId | `CLM-007` |
| publicClaim | 固定提交在 Windows 本地生产构建耗时 19.081 秒，观测峰值工作集 3475.6 MiB。 |
| capability | 本地构建管道与部署资源估算参考。 |
| status | `LOCAL_BASELINE` |
| evidenceType | 隔离 scratch worktree 生产构建测量。 |
| sourceCommit | `bcc78b31658377d9ec3134418b447c1ab9fdf68c`。 |
| sourceTrackedTreeClean | `true`。 |
| suiteVersion | `deploy-s0-build-baseline-2026-07-19`。 |
| method | Windows 本地执行 `npm run build`，以进程树采样观测峰值工作集；模型配置移除，无外部 API 调用。 |
| observedAt | `2026-07-19`（Asia/Shanghai）。 |
| environment | Windows；Node.js v24.14.0；npm 11.9.0；隔离演示数据库。 |
| dataScope | 预置演示与隔离知识数据。 |
| sampleSize | 1 次生产构建。 |
| metrics | 19.081s；3475.6MiB 观测峰值工作集。 |
| artifactPath | `docs/runbooks/deploy-s0-build-baseline.md`。 |
| limitations | 峰值是采样下限；不是 Ubuntu/服务器测量，不证明服务器资源、部署或公网可用。 |
| allowedPublicWording | “Windows 本地固定提交构建通过，并记录了资源基线。” |
| forbiddenWording | “服务器已构建部署”“生产只需 3.5GB 内存”“公网已上线”。 |
| nextEvidenceNeeded | 经授权后记录服务器体检、实际部署构建或产物部署、健康检查和回滚演练。 |
| owner | 部署验证负责人。 |

## CLM-008 教师一致率、重复稳定性与真实视觉质量

| 字段 | 记录 |
| --- | --- |
| claimId | `CLM-008` |
| publicClaim | 真实视觉判断、教师一致率、重复稳定性和教学成效尚未完成，只能列为实证计划。 |
| capability | 真实作品会诊质量与课堂适用性。 |
| status | `PENDING` |
| evidenceType | 尚无合格外部证据。 |
| sourceCommit | `PENDING`。 |
| sourceTrackedTreeClean | `PENDING`。 |
| suiteVersion | `PENDING`。 |
| method | 计划由教师对经授权、脱敏的代表性作品先验标注，再与固定提交的会诊分类、可见证据与重复运行比较。 |
| observedAt | `PENDING`。 |
| environment | 经授权的受控真实视觉模型与教师复核环境。 |
| dataScope | 待取得授权并脱敏的真实作品；不得混入预置数据。 |
| sampleSize | `PENDING`；未收集前不得填写。 |
| metrics | `PENDING`；自动测试数量不得代替教师一致率。 |
| artifactPath | `PENDING——完成后写入脱敏验证报告`。 |
| limitations | 当前只有代码契约与合成输入。 |
| allowedPublicWording | “真实视觉质量、教师一致率和重复稳定性将在授权样本上验证。” |
| forbiddenWording | “教师一致率已达某数值”“视觉判断准确”“已提升学生成绩/效率”。 |
| nextEvidenceNeeded | 授权样本、教师标注方案、固定模型/提交、重复运行报告与教师签核。 |
| owner | 课程教师 + 数据与隐私负责人。 |

## CLM-009 最终模型评测与 8 项真人体验

| 字段 | 记录 |
| --- | --- |
| claimId | `CLM-009` |
| publicClaim | 最终集成提交的真实模型评测和 8 项真人体感验证尚未完成。 |
| capability | 当前集成版本的模型质量、流式等待、上传反馈、异常恢复和会诊可读性。 |
| status | `PENDING` |
| evidenceType | 仅有 CLM-010 的单次部署链路真实模型 smoke；尚无最终提交的完整质量套件或 8 项真人记录。 |
| sourceCommit | `PENDING——先冻结最终集成提交`。 |
| sourceTrackedTreeClean | `PENDING`。 |
| suiteVersion | `PENDING`。 |
| method | 固定提交重跑完整真实模型套件；由真人逐项记录入口、等待、上传、中断、降级、恢复、会诊与移动端体感。 |
| observedAt | `PENDING`。 |
| environment | 最终候选部署或等价受控环境。 |
| dataScope | 固定评测案例 + 经授权的真人试用；两类结果分栏。 |
| sampleSize | `PENDING`。 |
| metrics | `PENDING`。 |
| artifactPath | `PENDING——最终评测报告与真人检查表`。 |
| limitations | 历史 37/37 和单次延迟探针均不能替代本条。 |
| allowedPublicWording | “历史基线已记录，最终集成评测和 8 项真人检查待完成。” |
| forbiddenWording | “当前版本全部通过”“真人体验良好”“异常恢复已获用户验证”。 |
| nextEvidenceNeeded | 运行授权、固定提交、完整报告、8 项检查结果与问题闭环。 |
| owner | 模型评测负责人 + 真人验收负责人。 |

## CLM-010 部署、可运行链接与二维码

| 字段 | 记录 |
| --- | --- |
| claimId | `CLM-010` |
| publicClaim | 固定提交已完成 S0 服务器安装，`https://lumi.bot.cd` 可访问；公网健康、登录、唯一任务、活动运行与会话 API 重读、一次真实模型回答、旧站回归、首次备份、已安装备份包装器端到端运行和二维码生成已有证据。 |
| capability | 生产服务、可信代理链路、公网访问与移动设备扫码。 |
| status | `PARTIAL` |
| evidenceType | 固定提交归档与双端摘要、服务器执行记录、内部/公网健康检查、真实公网单回合 smoke、端口/TLS 检查、既有站点回归、首次备份验证、已安装备份包装器端到端运行、二维码生成器及定向测试。 |
| sourceCommit | 部署源码为 `e9b91785151a600aa6f47e3b435907a10fe9a8d4`；二维码产物由包含本条记录的后续文档提交首次纳入 Git，不属于该部署归档。 |
| sourceTrackedTreeClean | 部署归档为 `true`（由精确提交生成，未提交 WIP 未进入归档）；二维码在目标源码工作区生成、校验，并与本条记录一同精确提交。两类来源不得合并解释为同一个干净提交。 |
| suiteVersion | `deploy-s0-2026-07-22`（finalizer `ff073099…b379`；backup runner `b35fd413…5f48`，已安装并单独端到端运行成功）；`public-smoke-v1`（`b20ca252…e83d`）；`competition-qr-v1`。 |
| method | 使用 Caddy 到 3100 可信代理再到 3000 的链路部署；核对内部/公网健康、loopback 与公网端口、TLS、学生登录、唯一任务、活动 run API、真实模型回答、会话 API 重读、两个旧站稳定标志、首次一致性备份与正式二维码摘要。 |
| observedAt | `2026-07-22`（Asia/Shanghai）。 |
| environment | Ubuntu 24.04.2 LTS、Caddy、独立 Node 22、systemd `lumi` 服务用户；公网域名 `lumi.bot.cd`。 |
| dataScope | 生产配置与显著标注的预置演示；不得混称真实课堂数据。 |
| sampleSize | 2 个健康入口、1 次演示登录、1 个唯一任务、1 个真实模型回合、1 次活动运行/会话 API 重读、2 个既有站点、2 个已验证恢复点（其中 1 个由已安装包装器端到端创建）、1 份正式二维码；真人扫码样本为 0。 |
| metrics | 服务 active/enabled 且使用 `lumi` 用户与 systemd 收紧；Lumi 首页 200，HTTP→HTTPS 308；数据库可用；知识 34（8/17/9）；真实回合 `MODEL_ASSISTED`、总耗时 9.416 秒、回答 1086 字符；旧站 2/2 为 200 且稳定标志通过；3000/3100 仅 loopback 且公网不可达；直连 3000 登录为 403，3100 清除伪造可信头后为 200；会话 Cookie 的 Secure/HttpOnly/SameSite=Lax/Path/Max-Age 均存在；TLS 1.3、证书主题正确且有效至 2026-10-19；首次备份验证成功；已安装包装器另一次创建/校验 3 个文件，`evidenceReferenceCount=0`，并输出 `STATUS=SUCCEEDED`、`COMPLETED_BACKUP_COUNT=2`，服务复起后内外健康和旧站回归通过；二维码 SHA-256 `4ae0e5ae0a410f31754673aefacd7f558f9d2c93c2ee6df020d76b6974592490`，定向测试 72/72。 |
| artifactPath | `docs/runbooks/deploy-s0.md`；`public/competition-qr.svg`；`tests/unit/generate-qr.test.ts`。执行工具摘要记录于 runbook。 |
| limitations | 线上健康页的最终质量评测与 harness 均为 `not_run`，`competitionReady=false`；只完成一次真实模型回合，不能外推 SLA；API 重读不等于真实浏览器刷新；尚未完成浏览器加载/首字/退出登录、生产作品上传/视觉判断、移动端视觉体验和两台实体设备跨网络扫码；本次备份的 `evidenceReferenceCount=0`，未覆盖含真实 evidence 引用的非空证据树；包装器尚未实际触发超过 7 份时的删除分支，且未执行破坏性恢复演练。 |
| allowedPublicWording | “Lumi S0 服务器端已部署到 `https://lumi.bot.cd`；一次预置演示账号的公网模型回合与会话 API 重读通过，正式二维码已生成，浏览器真人体验和实体设备跨网络扫码仍待完成。” |
| forbiddenWording | “最终比赛质量全部通过”“线上长期稳定”“扫码已经通过”“移动端体验已验证”“真实课堂应用已验证”。 |
| nextEvidenceNeeded | 当前提交的最终质量评测与 harness、生产作品上传/视觉路径、退出登录、两台实体设备跨网络扫码、移动端真人体验和隔离恢复演练。 |
| owner | 部署负责人 + 最终材料负责人。 |

## CLM-011 当前未交付的公开能力

| 字段 | 记录 |
| --- | --- |
| claimId | `CLM-011` |
| publicClaim | 课程资料配置界面、正式教师洞察视图和系统主动发起的变式练习不列为当前已交付能力。 |
| capability | 教师侧内容管理、正式聚合洞察、主动变式学习动作。 |
| status | `NOT_DELIVERED` |
| evidenceType | 第二波计划与当前功能清点。 |
| sourceCommit | `N/A`。 |
| sourceTrackedTreeClean | `N/A`。 |
| suiteVersion | `N/A`。 |
| method | 对照当前路由、页面、契约与第二波计划逐项清点。 |
| observedAt | `2026-07-19`（Asia/Shanghai）。 |
| environment | 当前集成代码与竞赛文档。 |
| dataScope | 功能范围清点。 |
| sampleSize | 3 类未交付能力。 |
| metrics | 0 项可作为当前公开交付能力。 |
| artifactPath | `docs/superpowers/plans/2026-07-19-second-wave-plan.md`。 |
| limitations | 后续实现后需新立证据，不得直接修改本条状态而不附验证。 |
| allowedPublicWording | “当前原型聚焦学生主路径；上述能力不列为现有交付。” |
| forbiddenWording | “教师可上传课程并即时生效”“教师可查看正式共性洞察”“系统已自动发起并记录变式练习”。 |
| nextEvidenceNeeded | 独立实现提交、权限/隐私测试、集成验证和真人验收。 |
| owner | 产品负责人 + 对应实现负责人。 |

## CLM-012 D-017 可恢复数据库种子

| 字段 | 记录 |
| --- | --- |
| claimId | `CLM-012` |
| publicClaim | 仓库已具备显著标注为预置的 D-017 跨会话数据库种子，并能在隔离环境中幂等写入、安全重置和重新生成。 |
| capability | 两段项目历史、三轮对话、私有作品、逐轮会诊、会话摘要、成长记忆与审计记录的确定性种子。 |
| status | `VERIFIED_AUTOMATED` |
| evidenceType | SQLite/私有文件系统集成测试 + 并发与故障注入测试 + 独立代码复核。 |
| sourceCommit | `028bfcd`。 |
| sourceTrackedTreeClean | `true`（该提交形成后）。 |
| suiteVersion | `d017-database-seed-v1`。 |
| method | 在隔离数据库和私有作品目录中重复 seed，并以 8 个进程并发执行；随后验证安全 reset、重新 seed、REAL/DEMONSTRATION 双向混标拒绝，以及文件删除和提交前故障时的文件恢复与数据库回滚。 |
| observedAt | `2026-07-19`（Asia/Shanghai）。 |
| environment | Windows 本地 SQLite 与私有文件系统测试环境；未调用外部模型。 |
| dataScope | `DEMONSTRATION_DATA`；全部为自创预置或合成内容。 |
| sampleSize | 2 个任务、2 个会话、3 个轮次、2 份私有 PNG、2 条会诊、2 条摘要、3 条记忆、1 条审计记录。 |
| metrics | 作者目标集 64/64、seed 24/24、reset 7/7 通过；独立复核核心测试 38/38 通过；TypeScript、定向 ESLint 与差异检查通过。 |
| artifactPath | `scripts/seed-demo.ts`；`scripts/reset-demo-agent-history.ts`；`data/demo/lumi-d017.ts`；`tests/integration/demo-seed.test.ts`；`tests/integration/demo-agent-history-reset.test.ts`。 |
| limitations | 只证明预置数据链路、并发幂等和清理边界；不证明真实学生历史、真实视觉判断、课堂效果或生产部署。 |
| allowedPublicWording | “D-017 预置跨会话历史已通过隔离数据库、私有文件、并发和故障回滚自动测试。” |
| forbiddenWording | “真实学生成长档案”“真实课堂数据”“视觉判断已经准确”“生产数据重置已验证”。 |
| nextEvidenceNeeded | 在最终候选版本上完成真实服务端到前端的人工走查；真实素材、视觉质量与课堂证据仍须分别授权和验证。 |
| owner | 演示数据负责人 + 工程验证负责人。 |

## 发布前使用规则

1. 报告、演示口播与截图说明只能复用每条 `allowedPublicWording` 的语义，不能跨越 `limitations`。
2. 任何指标必须同时带上提交、套件、样本量、环境、数据范围和观察时间；缺一项则保留 `PENDING`。
3. 历史基线不得与当前集成测试拼接成一个“最终通过率”。
4. 自动测试不得换算为教师一致率；预置数据不得计入课堂人数、学习轨迹或成效。
5. 最终材料回填链接、二维码、真实模型指标或真人结果前，必须先新增相应证据条目并完成复核。

## 对账校验记录

### 2026-07-19 报告结构基线

- 相关自动测试：7/7 个文件通过，69/69 个测试通过；范围为会诊框架、sidecar、流式隐藏、学生端消费契约与真人验证报告 schema，不含外部模型或真人执行。
- 当时的文档静态检查：简介 157 个汉字，关键词 3 个，12 条 claim 的 20 个必填字段均存在，弃用词命中 0，`git diff --check` 通过。

### 2026-07-22 S0 证据补充

- 本机独立公网复核：`https://lumi.bot.cd` 首页为 200；健康接口为 `ok`，数据库可用、AI 已配置、知识 34 条；`agentQuality=not_run`、`agentHarness=not_run`、`competitionReady=false`。两个既有站点均为 200 且稳定页面标志仍存在。
- 二维码复验：`tests/unit/generate-qr.test.ts` 为 1/1 文件、72/72 测试通过；`public/competition-qr.svg` SHA-256 为 `4ae0e5ae0a410f31754673aefacd7f558f9d2c93c2ee6df020d76b6974592490`。该结果不包含实体设备扫码。
- 文档结构复核：简介 157 个汉字，关键词 3 个，12 条 claim 的 20 个必填字段均存在，弃用词命中 0；本次提交前 `git diff --cached --check` 通过。
