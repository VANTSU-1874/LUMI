# Lumi 设计灵感 Wiki 当前版本计划

> 状态：CURRENT_PRODUCT_AND_GOVERNANCE_PLAN / DOCUMENT_ONLY / NOT_IMPLEMENTED
>
> 日期：2026-08-10
>
> 适用范围：面向学生的可浏览设计灵感素材库，以及 Lumi 在回答中检索、解释、引用其中已获准案例的能力。
>
> 本轮边界：修订产品与技术计划，固定 GBrain/LLM Wiki-first 架构；P1 只可对 D-08 已逐来源、逐行为批准的公开候选，在与学生端物理隔离的 `PRIVATE_CANDIDATE` 库按获准行为采集、保留候选副本并编译内部 Wiki 草稿；自动 pull 另需 D-15 授权。不得部署、公开发布、写入学生页面或真实学生数据，不构建向量索引，也不得把候选自动送入 Lumi 回答。

## 0. 当前决定

Lumi 的设计灵感 Wiki 是一个经过策展、可追溯、可撤下的学生设计参考库。它让学生浏览、搜索、筛选、保存案例，并在合适时让 Lumi 用案例帮助学生理解设计关系；它不是课程事实库、整书全文检索库、社交媒体、作品搬运站或自动抓取器。

本文中的“公开”不等于公开互联网。V1 已决策为 AUTHENTICATED_STUDENT_ONLY，即通过 Lumi 身份与学生范围校验的账号才可进入；校内公开和互联网公开均不是 V1 功能，并保留为未来独立二次决策，不能由 V1 或 P2/P3 的上线自动推导。受众层级统一为：

| 受众 | 含义 | 当前是否可用 |
| --- | --- | --- |
| INTERNAL_REVIEWER_ONLY | 仅获授权的策展、权利与安全审核角色 | P1 可用 |
| AUTHENTICATED_STUDENT_ONLY | 通过 Lumi 身份与范围校验的学生 | V1 已决；尚未实施 |
| INSTITUTIONAL_PUBLIC | 经机构入口可浏览但不等于互联网公开 | V1 明确不做；未来须独立二次决策 |
| PUBLIC_INTERNET | 不登录即可访问 | V1 明确不做；仅 P5 候选，未来须独立二次决策 |

### 0.1 V1 身份与匿名访问边界

- 认证及服务端学生范围校验是浏览、搜索、筛选、案例详情、私有灵感板、Lumi AI 引用卡和任何已获准资产交付的共同前置条件；未认证请求不得返回案例元数据、预览、引用内容或资产 URL。
- V1 不创建面向匿名用户的 sitemap、公开分享链接或图片直链；原站链接仍须在已登录详情页按该案例的权利与展示决定提供，不能借此绕过 Lumi 的资产访问控制。
- 是否开放 INSTITUTIONAL_PUBLIC 或 PUBLIC_INTERNET 必须经过 P0 台账 D-13 的独立二次决策、逐案例权利复审和受影响 Gate 复验；该决定不会因 V1 的登录可见而被预先授予。

当前版本固定以下产品决策：

1. **不替换 Knowledge V2。**课程知识库和灵感 Wiki 在同一 Lumi 对话入口按每轮意图协作，后台仍是两个独立知识产品。它们可共享来源身份、资产哈希、受控资源路由和基础设施适配边界，但不得共享对象、审核状态、可见性、引用类型、检索投影、活动指针或排序语义。
2. **灵感 Wiki 独立采用 GBrain/LLM Wiki 方法论。**Lumi 的 `SourceRecord / SourceVersion / RightsDecision / InspirationCase / VisualEvidenceAnchor / CaseAnalysis / FacetAssignment / WikiLinkDecision / ReviewDecision / WithdrawalRecord / WikiChangeEventLedger` 继续作为 canonical truth；只把当前获准版本编译为带稳定 Page ID 的类型化 Wiki Page。页面由 Current Compiled Truth、append-only Timeline、受控 Facet、Alias 和经审核的显式 Wikilinks 组成。
3. **V1 不依赖向量。**第一版检索固定为中文全文、别名、受控标签和 Facet 产生种子，再在当前用户可见子图中做白名单边类型的一至两跳有界遍历。向量模型、向量库或视觉 Provider 关闭时，浏览、搜索和 Lumi 案例引用仍必须完整工作。
4. **P1 宽进严出且不做 embedding。**仅对 D-08 已逐来源、逐行为批准进入 P1 的教育型灵感汇总来源，`PRIVATE_CANDIDATE` 才可按获准行为采集公开候选、保留候选副本，并做去重、视觉理解草稿、Wiki 页面编译草稿、关系草稿与课程概念受控引用；自动 pull 另需 D-15 授权。作者、原始路径、可见署名或许可字段缺失时记录 `UNKNOWN`，不伪造、也不阻断已获准 intake 后的内部分析；这不表示 Lumi 创作、拥有或已取得展示权。
5. **未来视觉检索只是旁路。**P4 若另行通过许可、成本和 Wiki 专属评测，可用视觉向量从图片产生候选 Page ID；候选必须回到 Wiki Page，由 Lumi 再做权限、撤下、证据和引用复查。视觉向量不得创建 Page、Compiled Truth、Timeline、Wikilink 或事实主张。
6. 只有通过来源/可见许可信息如实披露、教学价值、质量与去重、安全与适龄、课程审核及 AI 引用资格的候选，才可准备为学生案例。学生看到的是案例卡、项目语境、可得来源信息和可学习的观察点，不是 Lumi 自称拥有的原作或可替代原作品的镜像。
7. Lumi 回答只能把 Wiki 当作案例和视觉观察的证据来源。它必须区分来源事实、可见视觉观察、教学性推断和不确定性；Wiki 案例不得自动升级为课程事实或评分规范。
8. V1 不做匿名公开浏览、面向匿名的 sitemap、公开分享链接、图片直链、公开投稿、关注/点赞、评论、私信、公开学生作品墙、全站全文 OCR、整书预切块或“以图生图”能力。P1 的受控候选自动采集是按 Source Registry 逐来源启用的私有导入，不是无边界通用抓取器：不绕过登录、付费墙、robots、技术保护或站点安全限制。

“采用 GBrain/LLM Wiki 方法论”与“直接嵌入某一版 GBrain 上游运行时”是两个决定。前者已固定；后者必须在独立实施计划中固定上游 commit、Schema Pack、无向量运行语义、数据边界、升级与回滚合同。无论选择直接集成还是 Lumi 内兼容 Adapter，都不得改变上述 page/schema/revision/link 合同。

P0 的决策、门槛、证据和签核状态集中记录在：

docs/superpowers/plans/2026-08-09-lumi-inspiration-wiki-p0-decision-and-gate-register.md

该台账中任何仍为 UNKNOWN、PENDING 或禁止执行的项，都不是实施时可以自行补全的空白。

## 1. 基线、继承与非宣称

本计划整合以下历史基线中的可复用约束，而不把历史规划写成当前已实现：

| 基线 | 对本计划的作用 | 不能据此宣称 |
| --- | --- | --- |
| 2026-07-28 Lumi 全自建多模态知识系统总计划 | 版本化对象、证据包、独立视觉检索评测、降级和 generation 原则 | 视觉检索已适合 Wiki 或已经上线 |
| 2026-08-03 Lumi 第四批来源盘点与分流建议 | 42 份灵感 Wiki 候选、视觉优先、权利未知和不展示原页的停止边界 | 任一候选已经获准处理或展示 |
| 2026-08-03 Lumi 知识加工闭环与 Loop Engineering 方案 | 来源冻结、页/跨页/区域证据、审核发布、撤回和可重建投影 | 流程对象、Provider 或运行时已经实施 |
| 2026-08-04 Knowledge V2 技术架构与底层信息架构 | 课程库与 Wiki 的隔离、来源回链、关系和可见性原则 | Knowledge V2、R2、Jina、Qdrant 或图谱已启用 |
| 2026-07-31 GBrain 检索核心替代评估 | 固定版本、中文词法、图信号、隔离运行和评测合同方面的技术经验 | 该评估只回答是否替换 Knowledge V2；其阶段结果不能外推为 LLM Wiki 方法不适合独立灵感产品 |
| 2026-08-10 LLM Wiki-first 架构决定 | 灵感 Wiki 独立采用 Compiled Truth、Timeline、Schema 与显式 Wikilink；V1 非向量检索 | 不替换或迁移 Knowledge V2；不等于已接入、部署或验收 GBrain runtime |

历史多模态方案的 T4 曾因无答案校准未通过而判定 No-Go。因此，任何未来视觉检索能力只能作为 Wiki 的影子评测候选，直到以 Wiki 自己的查询集、硬负例、权利过滤和学生展示语义重新通过验收；不得复用旧课程语料结果作为上线证据。

历史文档所引用的“统一知识与视觉检索”方向在本计划中被收敛为一条更严格的规则：检索投影可以重建，来源版本、权利决定、案例分析、审核决定和撤下记录才是长期真相。

旧 GBrain 评估使用课程语料、稀疏关系 fixture 和特定固定版本来判断“能否替换 Knowledge V2”，不是对独立灵感 Wiki 的 LLM Wiki 知识组织方法做产品判决。后续只继承其隔离、版本固定、中文检索与可复现实验经验，不继承“替换课程核心”这一问题设定。

## 2. 产品形态与参考模式

### 2.1 借鉴模式，而不是复制产品

| 成熟模式 | Lumi 借鉴什么 | Lumi 明确不复制什么 |
| --- | --- | --- |
| Pinterest 式发现 | 视觉优先卡片流、主题探索、渐进筛选、私人收藏板 | 无尽流成瘾设计、社交分发、未审内容聚合 |
| Behance 式案例阅读 | 项目语境、作者/机构/年份、过程与成果关联、来源归属 | 把学生收藏变成公开个人主页，或把外部作品搬运到 Lumi |
| 博物馆/档案目录 | provenance、权利声明、对象版本、撤下记录、稳定引用 | 以“档案”名义弱化版权或将扫描件视为公共领域 |
| 设计工作室评图 | 观察—命名—比较—迁移的学习提示 | 让模型替学生复刻风格、直接生成作业或给出单一“正确审美” |

### 2.2 学生可见体验

学生入口应是“灵感”而非“资料库”：

1. 浏览：编辑精选、主题入口、最近新增和已保存内容；首屏是少量高质量案例，非无限加载。
2. 搜索：支持自然语言和关键词，如“适合公益海报的低成本双色排版”或“信息层级清楚的展览导视”。
3. 筛选：按成果形态、能力维度、媒介/工艺、主题、时代/地域、案例角色、课程入口和可见性安全标签筛选；任何过滤只缩小候选，不把学生锁死在某门课程。
4. 案例详情：显示获准缩略图或原站链接、简短项目语境、来源、许可/展示说明、经审核的观察点、适用条件、反例或不适用提示，以及“加入我的灵感板”。
5. 保存：学生可创建私有灵感板、写个人注记、从板中发起与 Lumi 的讨论；默认不公开给同学或教师。
6. 对话接入：学生问“为什么这个案例层级清楚”时，Lumi 可以引用具体案例并解释观察，不要求学生跳出当前设计任务。

### 2.3 明确不做

- 不提供原杂志/PDF 的在线翻阅、下载、批量导出或镜像阅读。
- 不以“相似风格”代替来源身份，不推荐规避版权的临摹、去标识化复制或商用套用。
- 不让模型根据未经核验的图像自动编造作者、年代、设计意图、奖项、许可或教学结论。
- 不把学生收藏、搜索词、注记或上传作品变成公开案例，亦不默认用于模型训练。
- 不以收藏数、停留时长或点赞数作为学习质量、审美水平或教师评价依据。

### 2.4 策展与排序的最小治理

编辑精选、最近新增和主题排序不是“自然流量”。每个面向学生的集合必须记录选择准则、入选理由、来源角色、最近复审日期和变更版本；默认按教学问题、案例多样性、可解释性和权利可用性排序，不按学生行为画像或外部热度排序。P1 每次小样复审都要检查成果形态、地域/文化语境、媒介和创作主体是否被单一来源类型系统性淹没。

## 3. 审查结论与已修复的计划缺口

| 审查维度 | 历史计划的可用基础 | 原缺口或冲突 | 当前版本的修复 | 优先级 |
| --- | --- | --- | --- | --- |
| 产品范围 | 有课程知识和视觉检索方向 | 容易把案例库误写成课程库或全书 RAG | 将 Wiki 定义为独立案例产品，并列出不做事项 | P0 |
| 信息架构 | 有来源、证据、教学知识分层 | 缺少案例、展示权、收藏和撤下的产品实体 | 增加 InspirationCase、展示策略、收藏板、CitationReceipt 与 WithdrawalRecord | P0 |
| 知识组织 | 有案例 metadata、分析与 facet | 尚未定义稳定 Wiki Page、当前编译真相、时间线、类型化关系和重建合同 | 增加 LLM Wiki Schema Pack、Page/Revision/Timeline/Link 与可重建编译投影 | P0 |
| 数据与元数据 | 有哈希、版本、页/区域锚点思路 | 只有内容/索引字段不足以保证可公开 | 每个学生可见案例必须具备来源、版本、权利、可见范围、锚点和审核记录 | P0 |
| 来源、版权、许可 | 第四批已明确 RIGHTS_UNKNOWN | 容易把缺失作者链误写成不可分析，或把候选副本误写成学生可见 | P1 候选可带 UNKNOWN 字段和私有副本；显式 DENY、撤下或不安全证据阻断出库，学生端仍须如实披露来源/许可信息 | P0 |
| 采集与审核 | 有 K0 到 K12 闭环 | 尚无 Wiki 特有的展示、退稿和撤下规则 | 增设 case 审核状态、退回理由、权利 hold、下架传播和复审 | P0 |
| 检索与引用 | 有 EvidenceBundle 与回退原则 | 泛化 RAG 容易把 embedding 当默认动作，也可能把案例召回当事实证据 | V1 固定中文全文/别名/facet 加可见子图有界遍历；案例级 citation 和事实/观察/推断分层 | P0 |
| 学生体验 | 现有学生优先与作品让路原则 | 收藏可能变成社交曝光或素材下载入口 | 私有灵感板、可学习观察点、受控预览、原站回链 | P1 |
| 隐私与账号 | 匿名学生和过程记录边界已有基础 | 收藏、注记、上传图的保留/删除未定义 | 私有默认、可查看/导出/删除、上传临时化、作业证据另走显式流程 | P0 |
| 内容安全与教育适配 | 导师不代做原则 | 视觉案例可能含成人、歧视、暴力、误导性或不适龄内容 | 年龄/敏感主题标签、人工适龄审核、报告入口、反临摹教学提示 | P0 |
| 性能、成本、运维 | 有不可变 generation、熔断和降级方向 | 可能过早引入海量图片、外部向量与缓存成本 | V1 以可重建词法/图投影为基线；视觉向量仅在 P4 以独立旁路验证 | P1 |
| 指标与治理 | 有检索与证据评测思路 | 容易只看点击/回答满意度，不看权利和引用正确性 | 增加权利覆盖、撤下时效、引用正确率、零结果和学生安全指标 | P0 |
| 上线分期与回滚 | 有 shadow、generation 和 rollback 原则 | 未区分技术回滚与权利撤下 | 分阶段、默认关闭、case 级撤下优先于技术回滚 | P0 |

## 4. 逻辑信息架构

### 4.1 两个库、一个受控连接面

~~~text
Course Knowledge V2
  教学事实、方法、课程证据
  独立对象 / 审核 / ACL / 检索 / 引用

Lumi canonical governance store
  SourceVersion / Rights / InspirationCase / Evidence / CaseAnalysis /
  Facet & WikiLink decisions / Review / Withdrawal / ChangeEventLedger
                    |
                    | 仅编译当前获准内容
                    v
Inspiration LLM Wiki projection
  WikiPage / Current Compiled Truth / Timeline / Facet / Alias / Wikilink
                    |
                    v
  中文 FTS + facet 种子 + 当前可见子图 1–2 跳有界遍历
                    |
                    v
  Page ID / 匹配概念 / 获准关系路径 -> Lumi 资格复查与案例卡

Shared controlled primitives
  source identity, source version, asset hash, secure asset resolver,
  trace, withdrawal propagation；不共享知识对象或权限结论
~~~

课程库可在回答中解释“版式层级的一般原则”；Wiki 可呈现“某案例怎样通过留白和字号形成层级”。两者共用一个对话入口，但查询路由、权限过滤、召回、重排、引用资格和撤下传播均按库独立执行。两者在同一回答中并列时必须各自带来源类型，不能把案例观察伪装成课程事实，也不能让课程授权覆盖案例展示权。

### 4.2 核心逻辑实体

以下是产品和治理合同，不是立即新增的数据表或 API：

| 实体 | 所属层 | 最小职责 | 必填身份与边界 |
| --- | --- | --- | --- |
| SourceRecord | Canonical governance | 记录来源主体、获取方式、原站或出版物身份 | source id、来源类型、获得日期、身份核验状态；文件路径不是身份 |
| SourceVersion | Canonical governance | 固定某一版原件或合法页面的字节与处理范围 | source version id、哈希、版本/页或 URL 快照、processing scope、supersedes |
| RightsDecision | Canonical governance | 将许可按行为拆开记录 | 保存、派生预览、本地解析、外部处理、嵌入、学生展示、AI 引用、公开展示、商业复用分别为 ALLOW / DENY / UNKNOWN，并保留许可依据、范围和审稿记录 |
| InspirationCase | Canonical governance | 面向学生的案例语义对象 | case id、标题、项目/作者信息的核验状态、案例角色、适用范围、可见性、source version refs |
| VisualEvidenceAnchor | Canonical governance | 一张获准图片、页面、跨页、区域或原站链接的可回链证据 | evidence id、页/区域、裁切配方、原/派生哈希、展示权、review state |
| CaseAnalysis | Canonical governance | 经审核的观察点与教学提问 | 观察、依据 anchors、适用条件、反例/不适用情形、作者为 HUMAN 或 MODEL_DRAFT |
| FacetAssignment | Canonical governance | 支持浏览和检索的受控标签决定 | 成果形态、能力、媒介、主题、案例角色、课程入口；模型只能提出候选 |
| WikiLinkDecision | Canonical governance | 保存关系提案的审核与依据 | 稳定 decision id、from/to identity、relation type、evidence/reason、review state、validity、supersedes |
| WikiChangeEventLedger | Canonical append-only ledger | 保存可重建页面时间线的权威事件流 | 稳定 event id、occurredAt、recordedAt、event type、受影响 canonical version/link decision、supersedes/corrects；只追加 |
| ReviewDecision / WithdrawalRecord | Canonical governance | 记录审核、退回、下架与影响范围 | 决定、理由、审核者角色、时间、supersedes、投影和缓存传播状态 |
| WikiPage | Wiki compiled projection | Inspiration Wiki 的稳定语义页 | page id、page type、case/source refs、当前获准 revision、visibility policy；不得承载 Course Knowledge V2 正文 |
| WikiPageRevision | Wiki compiled projection | 一次可审核、可重建的页面编译结果 | revision id、schema pack、compiler/runtime identity、输入对象版本、compiled content hash、review state、supersedes |
| WikiTimelineEvent | Wiki compiled projection | 将权威 ledger 事件投影为页面时间线 | ledger event id、page/revision、事件类型、发生/记录时间、evidence refs；不得独立写入或被新版本覆盖 |
| WikiLink | Wiki compiled projection | 把已批准关系决定投影为类型化关系 | from/to、relation type、支持证据、decision id、有效期、visibility policy |
| WikiCompilationReceipt | Canonical audit receipt | canonical 输入到 Wiki 投影的可重建证明 | release id、input object/version set hash、event-ledger high-watermark/hash、schema pack、compiler/runtime、output page/link set hash、rights snapshot |
| WikiRetrievalProjection | Retrieval projection | 为已批准 Page 建立可重建中文词法/图投影 | release id、page/revision/link set、tokenizer/alias/facet/edge catalog、visibility snapshot、build result；V1 不含向量 |
| FutureVisualCandidateProjection | Future P4 sidecar | P4 可选的图片到候选 Page ID 旁路 | visual generation、eligible page set、模型/预处理/index version、rights filter；不得成为 Wiki truth |
| InspirationBoard / SavedCase | Student-owned data | 学生的私有收藏与个人注记 | owner、可见性、删除状态；不等于公开投稿或课程证据 |
| CitationReceipt | Canonical audit receipt | 记录一次回答引用的案例及证据 | response/run id、case/evidence/version、呈现文本、可见性判断、降级原因 |

RightsDecision 不是三个状态词的孤立字段。每个拟向学生呈现的 case 或 evidence 都必须保留以下许可证据：

- 权利主体、许可方或未知状态，以及身份核验依据；
- 条款、书面许可、来源页面或合同摘要的受控证据引用与快照 hash；
- 允许的受众、地域、期限、署名文本、禁止用途、是否允许裁切/低清预览；
- 直接跳转链接、页面嵌入、Lumi 托管预览、OCR、本地 embedding、外部 embedding 和商业复用各自的决定；
- 审核人、审核日期、复审日期、争议/投诉记录和撤下触发条件。

“链接可打开”与“可以嵌入”，“可以嵌入”与“可以托管缩略图”，均是独立决定。涉及肖像、商标、文化敏感内容或多个权利层时，RightsDecision 必须显式记录附加限制，而不能由主来源许可覆盖。

### 4.3 案例 metadata 最小合同

每个候选案例至少应携带：

- 稳定 case id、标题、来源类型、来源语言、来源版本和可验证 locator；
- 作品/项目/设计者字段及其核验状态，未知时明确为 UNKNOWN，不补全猜测；
- 成果形态、能力、媒介、主题、时代/地域等受控 facet 与人工审核状态；
- 案例角色：CASE、REFERENCE、COUNTERPOINT 或 PRACTICE_CURRENT，不能以单一“权威分”代替；
- 面向受众：INTERNAL_REVIEWER_ONLY、AUTHENTICATED_STUDENT_ONLY、INSTITUTIONAL_PUBLIC 或 PUBLIC_INTERNET；每一层均单独受 RightsDecision 约束；
- 权利矩阵、允许的预览派生物、原站回链、到期/复审日期与撤下联系人或渠道；
- 每个视觉证据的原始/派生 hash、页/跨页/区域 anchor、裁切与渲染配置；
- 分析的证据 refs、范围、审稿状态、模型/人工来源和模型版本；
- 版本、审核记录、撤回传播状态和构建该投影的 generation identity。

禁止用文件名、目录名、图片相似度、OCR 结果或模型 caption 自动填充作者、许可、案例质量、适用课程或事实性描述。

### 4.4 审核状态与检索状态必须正交

~~~text
案例审核：
CANDIDATE -> IDENTITY_AND_RIGHTS_REVIEW -> FROZEN_PRIVATE
  -> ROUTED_FOR_CASE_REVIEW -> CASE_DRAFT -> HUMAN_REVIEW
  -> APPROVED_INTERNAL 或 APPROVED_STUDENT

任一审核阶段可进入：
RIGHTS_HOLD / SAFETY_HOLD / WITHDRAWAL_HOLD / RETURNED / REJECTED / WITHDRAWN

服务状态（独立于案例审核）：
BROWSE_RELEASE、STUDENT_SEARCH、WIKI_RETRIEVAL、VISUAL_RAG 各自为 DISABLED / SHADOW / ACTIVE
~~~

只有同时满足“案例语义审核通过、目标受众展示权明确、预览资产和来源回链可用、撤下路径可用”的对象可进入 APPROVED_STUDENT。APPROVED_STUDENT 可以进入 BROWSE_RELEASE，却不自动进入 STUDENT_SEARCH、WIKI_RETRIEVAL 或 VISUAL_RAG。P2 的 `STUDENT_SEARCH` 与 P3 的 `WIKI_RETRIEVAL` 可复用同一中文全文/facet/图检索引擎，但具有独立 activation、输入输出与评测门：前者只返回学生界面结果，后者才允许结果进入 Lumi 模型上下文。若历史实现保留 `TEXT_RAG` 字段，只能通过版本化适配映射到 WIKI_RETRIEVAL，字段名不表示使用文本向量。

WITHDRAWAL_HOLD 是收到具有具体来源 locator、权利主张或安全风险说明的投诉后立即停止服务的临时状态。它在复审后只能进入 WITHDRAWN、RETURNED，或以新的审核决定恢复到先前批准状态；恢复不得抹去 hold、投诉或复审记录。WITHDRAWN 对所有受众与服务状态均为不可见。

### 4.5 P1 宽进严出状态机

~~~text
Source Registry 增量拉取 / 用户手工批量导入（同一模型）
  -> Candidate: DISCOVERED -> DOWNLOADED/IMPORTED -> NORMALIZED/DEDUPED
  -> Candidate: VISUALLY_ANALYZED
  -> WikiDraft: WIKI_DRAFTED -> LINKED/LINTED
     - 后台自动完成私有保存、metadata/hash、去重、视觉理解草稿、Wiki Page 编译草稿、Alias/Facet 与 Wikilink 候选、质量/新颖性/多样性信号与 AI 理由
     - 作者、原始路径、许可可为 UNKNOWN；AI 信号必须可解释，不能当作质量、权利或课程事实
     - 物理隔离，不返回学生 API，不进入模型上下文
  -> Candidate: READY_FOR_TEACHER_REVIEW
     - 生成预览、来源、Wiki 类型、DRAFT_COMPILED_PREVIEW、Timeline 事件草稿、关系提案、标签、课程概念引用、重复风险、AI 理由和处理日志的教师审阅包
  -> Candidate APPROVED + WikiDraft DRAFT_ACCEPTED -> INTERNAL_CATALOG_ACTIVE
     - 教师工作台是人工审核入口，但 `TEACHER` 不是可直接批准所有事项的通用权限；系统必须按策展、教学、权利、安全等审核域写入 `DomainReviewDecision`。若修改课程标签、Facet 或关系，系统必须先生成并重新展示新的不可变草稿 revision/hash，再由具备对应域权限的后续决定绑定；同一个决定请求不得边改标签边批准旧 hash
     - 只有 P1 角色矩阵要求的域决定全部有效，Candidate/WikiDraft 才可进入内部目录；系统持久化逐域决定、被批准的 canonical/draft revision/hash、link-decision set/hash 与内部目录审计。P1 不创建正式 Wiki release、Current Compiled Truth 或正式词法/图索引。INTERNAL_CATALOG_ACTIVE 仍为 `studentVisible=false`，Browser/Search/Bridge 均保持 DISABLED，不产生学生可见或可推荐资格
  -> REJECTED / WITHDRAWN
     - 永不自动发布或重新激活；投诉 hold、撤下或安全不通过立即阻断
~~~

`UNKNOWN` 可存在于私有候选、自动分析或学生可见的诚实披露字段；它绝不能被渲染为“Lumi 原创”“已获授权”或“许可有效”。显式 `DENY`、收到投诉的 hold、已撤下或安全不通过均立即阻断 `APPROVED`、`DRAFT_ACCEPTED`、`INTERNAL_CATALOG_ACTIVE`、后续正式 Wiki release 与全部学生通道。

逐域候选/草稿审核、正式 Wiki 编译发布和学生通道激活是三组独立持久化决定。S2 的逐域决定只绑定内部 canonical/draft 版本；S4 只有在 canonical input、Review/LinkDecision 与 ledger 连续性通过后才生成正式 Page/Revision/release；S5 再由具备 `RELEASE_APPROVER` 权限且满足职责分离的人，以独立审计记录把该 release 的受众、学生展示、来源披露、教学、安全、质量和撤下准备度逐项明确为 `ALLOW / READY`。只有基础发布资格完整通过，`BROWSE_RELEASE / STUDENT_SEARCH / WIKI_RETRIEVAL` 才能分别进入 SHADOW 或 ACTIVE；P2 可以激活前两者而保持 WIKI_RETRIEVAL=DISABLED。数据库必须拒绝缺基础资格却打开任一通道的组合；缺字段、PENDING、错误角色、失效审核人、缺第二审核、陈旧 revision/hash、旧 cookie、仅有通用教师 APPROVE 或仅有正式 Page 均保持学生不可见且不得进入模型上下文。

#### 4.5.1 角色域审核、职责分离与精确绑定合同

`D-04` 必须冻结并版本化以下最小角色矩阵；未被矩阵明确授予的审核域一律无权决定，不能用 `TEACHER`、`ADMIN` 或运营角色作通配符：

| 角色 | 可作出的决定 | 明确限制 |
| --- | --- | --- |
| `CANDIDATE_PROPOSER / WIKI_EDITOR` | 创建 Candidate、Analysis、WikiDraft 与修订提案 | 不能批准自己创建或编辑的精确 revision；不能激活 release |
| `CURATION_REVIEWER` | 案例选择、Schema/Facet/Alias、Wikilink 策展决定 | 仅限策展域；不能替代权利、教学、安全或 release 决定 |
| `TEACHING_REVIEWER` | 教学价值、适用任务、`COURSE_CONCEPT_REF` 与教学文案决定 | 仅限教学域；不能改写 Knowledge V2 权威语义 |
| `RIGHTS_REVIEWER` | 来源披露、展示/预览/派生行为与权利例外决定 | 仅限权利域；UNKNOWN、过期或争议状态不能被当作 ALLOW |
| `SAFETY_REVIEWER` | 适龄、敏感内容、文化风险、hold 与恢复建议 | 仅限安全域；高风险或申诉/恢复按 D-05 触发双人复审 |
| `RELEASE_APPROVER` | 对一个精确 Wiki PageRevision/release 作基础发布与通道激活决定 | 必须复核全部前置域决定和职责分离；不能以自己的通用教师身份补齐缺失审核 |
| `WITHDRAWAL_OPERATOR` | 紧急 hold、撤下、恢复流程启动和传播确认 | 可立即收紧可见性，不能批准内容或单独恢复 release |

默认禁止创建者/编辑者自审自己提交的精确 revision。D-04/D-05 必须冻结允许例外、替补人、失效条件和 `requiredReviewerCount` 触发表；至少权利争议/例外、安全高风险、申诉后恢复以及政策标记 `dualReviewRequired=true` 的决定需要两名不同且同时有效的相应域审核人。第二审核不能与第一审核同一 actor，也不能由 release approver 在无对应域资格时补签；触发表尚未签核、需要双人复审但缺一人、或任一审核人失效时均 fail closed。

每条 S2 `DomainReviewDecision` 至少绑定：`decisionId / reviewDomain / decision / actorId / actorRoleAssignmentId / rolePolicyVersion / reviewerStatusAtDecision / candidateRevisionId+hash / canonicalInputBundleId+hash / pageDraftRevisionId+hash / compiledPreviewHash / wikiLinkDecisionSetHash / requiredReviewerCount / coReviewerDecisionIds / decidedAt / supersedesDecisionId`。每条 S5 `ReleaseDecision` 还必须绑定：`pageId / pageRevisionId+hash / releaseId+hash / compiledTruthHash / ledgerWatermark+hash / rightsDecisionSetHash / audiencePolicyHash / channelStates`。任何输入或输出 revision/hash 改变，都使旧决定变为历史证据而非当前授权，必须重新审核。

决定写入时与 S5 激活时都必须从数据库重新验证 actor、角色域、角色有效期、职责分离、第二审核唯一性和所有绑定 hash。审核人在激活前被停用/撤权，旧决定不得计入资格；影响当前 ACTIVE release 的审核人或角色策略随后失效时，系统必须生成审计事件并将受影响 release 置为 `REVIEW_HOLD`，从新 allowlist、Preview、搜索和 Lumi 上下文中移除，直至新决定重新满足矩阵。S2/S5 的冻结测试集必须逐项覆盖错误角色、失效审核人、禁止自审、同一人充当第二审核、缺第二审核、陈旧 candidate/canonical/draft/Page/release revision/hash，并断言全部 fail closed。

### 4.6 LLM Wiki Schema Pack 与编译合同

V1 Schema Pack 固定以下页面类型：`INSPIRATION_CASE`、`VISUAL_STRATEGY`、`MEDIUM_OR_TECHNIQUE`、`TASK_OR_CONTEXT`、`CURATED_COLLECTION`、`VERIFIED_SOURCE_OR_CREATOR`、`COURSE_CONCEPT_REF`。`COURSE_CONCEPT_REF` 只保存 Knowledge V2 的稳定概念 ID、显示标签和受控跳转，不复制课程正文、证据、ACL、审核状态或权威排序。

V1 允许的关系类型为：`EXEMPLIFIES`、`CONTRASTS_WITH`、`USES_MEDIUM`、`SUITABLE_FOR`、`PART_OF_COLLECTION`、`SUPPORTED_BY_EVIDENCE`、`RELATES_TO_COURSE_CONCEPT`。未知关系不得由模型自行发明类型；每条关系必须有证据或审核理由、状态、版本和可见性。

每个 Page 的 Current Compiled Truth 只来自当前获准 canonical 对象版本；候选阶段只能称为 `DRAFT_COMPILED_PREVIEW`，模型输出永远先是 `MODEL_DRAFT`，经人工审核才可进入 release。Timeline 的权威来源是 `WikiChangeEventLedger`：审核、权利、撤下、版本和关系决定每次变化都先写稳定 event id、发生/记录时间与所引用 canonical 版本，再由编译器按 Page 确定性投影；receipt 固定 ledger high-watermark 与 hash。重编译不得删除、重排或伪造历史，只能以 `corrects/supersedes` 新事件修正。Wiki release 不反向覆盖任何 canonical governance 对象。Schema Pack 或编译器变化必须生成新 revision 与 WikiCompilationReceipt，并能回滚活动指针。

## 5. 来源、许可、采集与人工审核

### 5.1 候选采集与学生出库按行为拆分

| 来源类别 | V1 默认 | 可以进入学生端的条件 | 禁止推断 |
| --- | --- | --- | --- |
| 用户提供的书籍、杂志、案例文件 | PRIVATE_CANDIDATE / RIGHTS_UNKNOWN | 可做候选登记与经用户明确同意的私有分析；学生出库前通过本节与 4.5 的严格审查 | 购买、拥有 PDF、加密可读、文件在本机，不等于 Lumi 创作、拥有或已取得学生展示许可 |
| D-08 逐来源批准的 Recent 等公开教育型灵感汇总来源 | PRIVATE_CANDIDATE；只按 D-08 获准行为保留公开候选副本和可见元数据，自动 pull 另需 D-15 授权 | 后续出库时如实显示可得署名、原始路径和许可状态，并通过教学、质量、安全、课程及 AI 引用资格审查 | “公开可访问”不自动等于允许抓取、作者或完整原始路径已知；缺失字段必须是 UNKNOWN，不能编造 |
| 学生上传作品 | TRANSIENT_QUERY_INPUT，默认不入 Wiki | 学生独立投稿、权利声明、明确用途、教师审核和单独可见性决定均通过 | 作业上传、收藏或会话附件不等于公开授权 |
| 第三方投稿或委托内容 | V1 不接收 | 以后另立投稿协议、身份核验、撤回和未成年人规则 | 口头同意或社交平台链接不构成使用授权 |

### 5.2 P1 采集与分析规则

- 只有已在 D-08 逐来源、逐行为批准的 Recent 等公开来源可作为 P1 候选发现源；D-14 单独不授权外部访问。只访问浏览器可直接取得且已获准 intake 的公开内容，不绕过登录、付费墙、robots 限制、技术保护或站点安全限制；自动 pull/定时/批量运行还需 D-15 对该来源与频率的实际授权。
- 每个候选先写入 `PRIVATE_CANDIDATE / DISCOVERED`：保留 Recent 条目 URL 与显示来源为不同字段，尽量提取标题、作者/署名、描述、分类、风格、颜色、可见许可和抓取日期；缺失值为 UNKNOWN，不伪造也不阻断自动入库。
- Source Registry 对每个用户选定来源记录 adapter/字段映射、入口、频率、限速、启停、cursor/hash、健康、失败重试、删除/撤下同步和运行日志；定期拉取与手工批量导入走同一 pipeline。当前所有 registry 均为 DISABLED，不启动计划任务、批量抓取或部署。
- 候选图只能保存在 Git 忽略的私有候选存储，使用不向浏览器、学生 API、对象公开 URL 或对话上下文暴露的 opaque asset ref 与 hash。下载、分析或去重完成不是发布。
- P1 可做去重、视觉理解草稿、Wiki Page/Timeline 编译草稿、Alias/Facet 归一化、Wikilink 提案与图 lint；所有输出只能是 DRAFT / PROPOSED。P1 不生成 embedding、不建向量索引，也不以向量 Provider 作为验收依赖。
- 外部 OCR、未来 P4 外部 embedding、对象存储上传、学生展示和 Lumi 引用仍是不同记录项。UNKNOWN 不阻断 P1 私有采集或分析；显式 DENY、撤下、投诉 hold 或安全不通过阻断对应动作与所有出库。若实际处理经过外部服务，必须记录真实 Provider、传输发生与时间，不得写作本地处理。
- 若后续直接集成 GBrain 上游 runtime，实施计划必须固定 commit、Schema Pack、编译入口、无向量运行语义、输入输出 schema、故障降级和升级/回滚合同；在此之前以 Lumi 兼容端口定义行为，不把未固定的上游实现写成既成事实。

### 5.3 审核、退回与撤下

审核包至少包含：来源身份、来源版本、权利矩阵、候选案例、展示资产、视觉 anchors、观察点、facet、学生安全标签、差异、引用闭包和撤下方案。审核者必须能够查看“不展示给学生的原始来源定位”，但学生只看到已获准的最小必要信息。

退回不是删除。RETURNED 必须记录缺什么，例如“作者未核验”“展示许可缺失”“案例观察无 anchor”“适龄标签待审”；修订产生新的对象版本。REJECTED 保留理由，避免同一不合格来源反复进入队列。

收到可信的权利、事实或安全投诉时：

1. 立即将受影响 case/evidence 标为 WITHDRAWAL_HOLD，停止浏览、检索和新回答引用；
2. 阻断缩略图、预览、向量结果和缓存命中，保留最小审计记录；
3. 将已有学生回答的引用降级为“该案例当前不可用”，不得继续展示受限资产；
4. 审核来源、范围、许可和替代方案；结果为恢复、永久撤下或新版本；
5. 权利撤下不能用普通技术 rollback 恢复。若前代也含该资产，必须生成净化 release。

紧急下架必须经中心化、fail-closed 的资源和检索解析器执行；新签发的预览 URL、详情页、搜索、推荐、缓存、向量命中和回答引用均以该解析器为准。已经被用户下载、截屏或外部站点缓存的副本不能被技术上收回，产品只能停止继续分发并在可见处如实告知。

紧急下架的责任人、联络渠道、目标时效、已签发 URL/CDN 处理、审计保留期和是否通知既有收藏者，需在首个学生可见版本前由用户明确确认，并写入 P0 台账。

## 6. Wiki 检索、解释与可见引用

### 6.1 查询路由

1. 先理解学生意图：在问课程事实、案例启发、相似视觉、作品比较、来源核查还是私人灵感板。
2. 课程事实优先查 Course Knowledge；案例启发优先查 Inspiration Wiki；混合问题可以双库并列，但必须保持证据类型标签。
3. 在任何 query expansion、全文检索或图遍历前，由 Lumi 根据学生身份、课程/年龄、安全标签、RightsDecision、审核、可见性和 withdrawal 状态生成 eligible Page ID allowlist。过滤失败不能在排名后补救。
4. 对查询做中文规范化、受控同义词/别名展开和 facet 识别；只在 allowlist 覆盖的当前 release 上，对标题、Alias、Facet、Current Compiled Truth 与获准 Timeline 摘要执行全文检索，产生种子 Page ID。
5. 只在由 allowlist 诱导出的可见子图中，按 Schema Pack 白名单边类型做一至两跳有界遍历；禁止通过隐藏节点作为桥、无界扩散或临时生成关系类型。
6. 用冻结的词法命中、facet 匹配、经审核关系路径、教学适配和多样性规则做可解释排名；不得把不可比信号直接相加成“权威分”。
7. 检索层只返回 Page ID、case/evidence refs、匹配概念、获准关系路径、release/revision 和排名解释。Lumi 在进入模型上下文前再次执行资格谓词，并用 ClaimSupportMap 约束回答与案例卡。
8. P4 未来视觉通道可从临时图片独立召回候选 Page ID，再回到上述 allowlist、Wiki 关系解释和 Lumi 复查。关闭所有向量能力时，浏览、搜索、比较与 Lumi 案例引用仍必须完整可用。

#### 6.1.1 GBrain/LLM Wiki 运行边界

`GbrainInspirationPort` 是行为合同，不宣称已经存在 API。输入至少包含 `normalizedQuery`、`eligiblePageIds`、`wikiReleaseId`、允许的 page/link types、hopLimit 和 resultLimit；输出只允许 `pageId`、`revisionId`、匹配字段、facet、获准关系路径和可解释排名信号。它不得自行授予权限、修改 canonical truth、生成最终 citation、把候选写成事实或访问 Knowledge V2 正文。

若使用 GBrain 的 `think`/整理能力，其输出只进入内部 `MODEL_DRAFT` 编译与审核队列；学生回答必须使用已发布 revision，并继续经过 Lumi 的 ClaimSupportMap。若上游运行时不能接受预过滤 allowlist、不能在可见子图内遍历或不能无向量运行，则该版本不符合本计划；应使用 Lumi 兼容 Adapter 或停止集成，而不是放宽治理合同。

### 6.2 回答与 citation 合同

回答生成前必须建立 ClaimSupportMap。每一条将要呈现的 Wiki 相关主张，都必须绑定：

- claimType：SOURCE_FACT、VISIBLE_OBSERVATION 或 TEACHING_INFERENCE；
- case、evidence、source version、analysis/review version 与当前服务状态；
- 所需受众、RightsDecision、anchor 和显示策略。

渲染前再次校验 ClaimSupportMap 的可见性、撤下状态和 source/evidence identity。任何映射缺失、权限变化、证据失效或状态不一致，都必须移除该 Wiki 主张和预览，并以“当前无法核查或展示该案例”的诚实降级替代。CitationReceipt 只记录上述最小引用映射和响应 identity；不记录学生原始提问、私人注记、上传图或完整模型上下文。

当 Lumi 使用 Wiki 案例时，回答至少包含：

- 案例名称或稳定可读标题；
- 其来源类型和可打开的受控详情页或原站链接；
- 使用的是哪一项获准 evidence，例如“封面缩略图”“第 12–13 页跨页的已获准低清预览”或“项目简介”；
- 明确区分“来源可核验事实”“可见视觉观察”“Lumi 的教学性推断”；
- 与当前学生任务相关的适用条件和不可直接照搬的边界。

系统不得：

- 对未获展示许可的原图、原页、整段原文或高分辨率裁切生成可见 citation；
- 用检索标题、OCR、caption 或相似度冒充来源事实；
- 把单一案例写成普遍规律，或把案例的风格命名为学生必须复制的答案；
- 在 citation 中泄露本地路径、签名 URL、私有来源 ID、权限备注或学生个人数据。

每次引用都要生成 CitationReceipt，绑定 case/evidence/version/retrieval generation。引用正确性、可访问性、授权状态和撤下传播必须可离线抽查。

### 6.3 Wiki 专属评测

在连接到学生回答前，至少建立以下冻结测试集：

- V1 覆盖文本到案例、Alias/同义改写、facet 查询、一跳/两跳关系、案例比较、私人收藏限定查询和无答案查询；图片到案例只属于 P4 独立测试集；
- 同主题但错误课程、错误媒介、错误关系、仅能经隐藏节点连接、权利不允许、已撤下、成人或不适龄等硬负例；
- 事实/观察/推断分层、来源回链、引用资产权限、撤下后不可召回和降级文案；
- 按成果形态、能力、媒介、来源角色和学生可见性拆分报告，并单列中文分词/别名误差、图稀疏/过密、路径解释正确率和 `VECTOR_DISABLED` 完整运行结果。

只有 Wiki 专属的召回、错误引用、负例、权限过滤、撤下和延迟门全部通过，才允许把相应检索通道从 SHADOW 变为 ACTIVE。历史课程检索分数不能替代这些门。

### 6.4 同一对话入口接入契约（规范性）

本节是课程知识与灵感 Wiki 的逻辑输出和失败契约，不等同于已经存在的 API。实现可以选择具体协议，但不得把两个库合并为同一引用类型、同一权限判断或同一无来源文本块。路由按每一轮及每一项主张重新判定；上一轮曾展示某案例，不代表下一轮仍有权检索或引用。

#### 6.4.1 路由与回答模式

| 当前轮意图或状态 | Course Knowledge | Inspiration Wiki | 对话结果 |
| --- | --- | --- | --- |
| 课程概念、方法、步骤、评分依据或事实核查，未要求案例 | 检索并承担事实支持 | 默认不检索 | `COURSE_ONLY`；不为了“更丰富”自动塞入案例 |
| 明确索要灵感、案例、视觉参照、作品比较，或追问已显示案例 | 可补充一般原则与边界 | 通过资格过滤后允许检索 | 有合格案例时为 `INSPIRATION_ONLY` 或 `MIXED` |
| 同时询问一般原则和案例如何体现该原则 | 分别检索课程证据 | 分别检索合格案例 | `MIXED`；两类证据分别渲染，不互相代替 |
| 引用本人私有灵感板 | 仅在需要一般原则时检索 | 先校验认证、owner 与案例当前资格，再检索 | 不得因板中曾保存而绕过撤下、许可或 AI 引用状态 |
| 用户请求案例，但资格过滤后为空、相关性低于冻结门或只有无证据的视觉相似结果 | 若课程库能帮助则继续 | 不生成案例卡 | `COURSE_PLUS_NO_WIKI_CASE` 或 `NO_CITABLE_INSPIRATION`，明确说明当前无可引用案例 |

只有案例启发、案例比较、视觉参照、来源核查、已显示案例追问或私人板引用等意图，才允许启动 Wiki 通道。纯课程问题、普通寒暄、与设计案例无关的任务，以及任何不满足身份或服务 Gate 的请求只走课程/普通对话路径。用户明确需要案例而系统不能提供时，推荐文案为：“当前没有通过审核且可展示、可引用的灵感案例；下面仅依据课程知识回答。”若课程库也无足够证据，则同时诚实说明无法可靠回答，不得把 Wiki 候选或模型常识补成事实。

#### 6.4.2 Wiki 引用资格谓词

任何 case/evidence 进入模型上下文、回答、AI 引用卡或资产交付前，必须同时满足：

~~~text
WIKI_CITABLE =
  authenticated_student
  AND authorized_for_current_student
  AND display_allowed_for_audience
  AND source_disclosure_approved
  AND no_explicit_rights_denial
  AND review_state == APPROVED_STUDENT
  AND ai_citation_decision == ALLOW
  AND withdrawal_state == CLEAR
  AND evidence_anchor_resolvable
  AND corresponding_rag_channel == ACTIVE
~~~

- `authenticated_student` 与 `authorized_for_current_student`：当前会话已认证，且学生、课程/年龄范围和私人板 owner 条件均通过。
- `display_allowed_for_audience`：case、evidence、预览和来源回链均允许向 AUTHENTICATED_STUDENT_ONLY 展示；只允许内部处理不算可展示。
- `source_disclosure_approved`：可得的策展来源、显示来源、署名、原始路径与许可状态被如实呈现；`UNKNOWN` 必须明确为未知，不能渲染为 Lumi 原创、拥有、获授权或许可有效。
- `no_explicit_rights_denial`：对学生展示或 AI 引用没有 `DENY`、过期/撤销、投诉 hold 或撤下结论；未知信息不是 P1 或经严格审核后的出库的自动否决理由。
- `APPROVED_STUDENT` 与 AI 引用资格审核通过：人工审核通过不自动等于 AI 可引用，浏览可见也不自动等于可进入回答。
- `withdrawal_state == CLEAR`：RIGHTS_HOLD、SAFETY_HOLD、WITHDRAWAL_HOLD 或 WITHDRAWN 均不得召回、引用或交付资产。
- `evidence_anchor_resolvable`：至少一个获准、版本一致的 source/evidence anchor 能支持将要呈现的主张。
- `corresponding_rag_channel == ACTIVE`：只有进入 Lumi 模型上下文或回答的 Page 才要求 `WIKI_RETRIEVAL` 为 ACTIVE；P2 学生界面搜索只要求 `STUDENT_SEARCH` 为 ACTIVE，且不得复用该状态注入模型。现有实现若暂用 `TEXT_RAG` 字段，必须在版本化适配层明确映射为“中文全文/facet/图遍历”，不能推断存在文本向量。视觉相似召回还要求 P4 的 `VISUAL_RAG` 独立为 ACTIVE。

上述条件是合取关系，必须在检索过滤前和回答渲染前各检查一次。任一失败都移除整个受影响案例卡及其资产，不能只隐藏许可字段后继续使用正文。

#### 6.4.3 结构化输出合同

每轮输出必须保留以下四个互不混合的逻辑区块；字段名是规范性语义，具体序列化格式由后续实施计划版本化：

| 区块 | 必填内容 | 禁止混入 |
| --- | --- | --- |
| `answerParts` | `partType`（COURSE_EXPLANATION / CASE_OBSERVATION / TEACHING_INFERENCE）、正文、支持该段的 claim ids | 无 ClaimSupportMap 的案例事实或视觉结论 |
| `courseCitations[]` | `kind=COURSE_CITATION`、课程证据标题、source/version/locator、许可或允许使用范围摘要、支持的 claim ids、与当前问题的关联理由 | 案例相似度、Wiki 展示资产或案例观察 |
| `inspirationCaseCards[]` | `kind=INSPIRATION_CASE_CARD`、case id/标题、来源与版本、受控 locator、面向学生的许可/署名/有效期摘要、evidence ref、关联理由、事实/观察/推断标签、适用边界、受控详情路由 | 课程事实权威性、内部许可证据、私有 locator、签名 URL 或原始相似度分数 |
| `wikiOutcome` | `CITED / NOT_REQUESTED / AUTH_REQUIRED / NO_CITABLE_CASE / SHADOW_ONLY / TEMPORARILY_UNAVAILABLE` 与安全的学生可见说明 | 候选数量、内部拒绝原因或受限案例身份 |

课程引用和灵感案例卡即使支持同一段回答，也必须分别返回。`relationReason`/关联理由必须说明“这项课程证据支持哪条一般原则”或“这个案例的哪项已审核观察与当前任务相关”，不能只写“相似”“推荐”或一个分数。许可字段只展示学生需要理解的许可、署名和使用边界摘要，不泄露合同、审核备注或内部证据地址。

#### 6.4.4 视觉相似性校验

- 本节只适用于未来 P4；V1/P1/P2/P3 不以视觉向量为依赖。
- 视觉相似度只能作为候选召回或排序信号，不是来源事实、作者意图、影响关系、年代、质量、有效性或设计结论的证据。
- 视觉旁路只能返回候选 Wiki Page ID，不得新建 Page/Revision/Timeline/Link，不得绕过当前 release 与 eligible allowlist。
- 案例卡的关联理由必须回到人工审核 facet、可见 evidence anchor 或已审核 CaseAnalysis；“模型认为相似”不能独立通过 ClaimSupportMap。
- 对形状、色彩、构图或材质的比较只能标为 VISIBLE_OBSERVATION，并说明观察范围；从观察迁移到教学建议时必须标为 TEACHING_INFERENCE，附适用条件和不可直接照搬的边界。
- 若唯一支持是向量相似分或自动 caption，结果按无证据处理，返回 `NO_CITABLE_CASE`，不得生成事实语气的案例卡。

#### 6.4.5 失败路径

| 失败条件 | 内部动作 | 学生可见动作 |
| --- | --- | --- |
| 匿名会话 | 不启动 Wiki 检索，不返回候选存在性、元数据或资产 | `AUTH_REQUIRED`：“登录后才能检索和查看灵感案例。” |
| 已登录但无当前案例/板权限 | fail-closed，按不可见处理，不区分“没有”与“无权” | 不暴露对象身份；按请求语境返回无可用案例或权限提示 |
| 明确 DENY、许可过期/撤销、撤下，或 AI 引用审核未通过 | 检索前排除，渲染时复查并移除 | 用户要求案例时返回 `NO_CITABLE_CASE`；不披露内部权利细节 |
| 未审核、证据缺失、anchor/version 不一致 | 不进入模型上下文，不允许模型补写来源或分析 | 明确当前无可引用案例；可继续给有证据的课程回答 |
| RIGHTS/SAFETY/WITHDRAWAL_HOLD 或 WITHDRAWN | 立即阻断召回、卡片、预览和资产；旧 citation 降级 | “该案例当前不可用。”不得继续显示旧标题、图像或说明 |
| Wiki 通道为 SHADOW、DISABLED、超时或故障 | 不把影子/失败结果注入回答；课程通道独立继续 | 用户请求案例时返回 `SHADOW_ONLY` 或 `TEMPORARILY_UNAVAILABLE` 的诚实说明 |

#### 6.4.6 Shadow、评测与上线 Gate

- `STUDENT_SEARCH=SHADOW`、`WIKI_RETRIEVAL=SHADOW`（兼容旧字段 `TEXT_RAG=SHADOW`）或 `VISUAL_RAG=SHADOW` 时，结果只能进入受控评测记录；前者不得进入学生界面，后两者不得进入模型上下文、学生回答、AI 引用卡或资产交付。P0 隐私决定与 G-03 未通过前，只能使用合成、人工冻结或明确授权的测试查询，不使用真实学生查询。
- Shadow 评测必须覆盖课程-only、案例-only、混合、私人板、匿名、越权、过期许可、未审核、无证据、撤下、无答案、跨库冲突和“视觉相似但事实错误”硬负例；按路由错误、漏过滤、错误引用、输出混型、降级文案和延迟/成本分别报告。
- 任何匿名/越权/撤下资产泄漏、课程引用与案例卡混型、无证据事实化或 Shadow 结果进入学生回答，均直接判 Gate 失败；其余阈值、样本量和错误预算须在评测前冻结，不得为通过结果临时调整。
- STUDENT_SEARCH 从 SHADOW 到 ACTIVE 前按 P2 范围通过非向量检索、权限、撤下、性能与可访问性 Gate。WIKI_RETRIEVAL 从 SHADOW 到 ACTIVE 前，P2 条件必须持续满足，G-04、G-05、G-07、G-08、G-09 及 LLM Wiki 专属 Gate 通过，并验证 `VECTOR_DISABLED` 下 Lumi Wiki 引用可完整工作、关闭 Wiki 通道后课程回答仍可独立工作。VISUAL_RAG 还必须按 P4 对视觉 qrels、许可、成本和相似性事实化风险独立复验。
- 上线与回滚开关按通道独立：Wiki 文本或视觉通道可回到 DISABLED，而不关闭同一对话入口的 Course Knowledge。任何 ACTIVE 状态仍须在每次渲染前执行资格谓词。

## 7. 学生保护、隐私与可访问性

### 7.1 教育适配与内容安全

- 案例卡强调“观察什么、为什么在此语境有效、换一个任务会怎样变化”，不提供一键复刻模板或临摹指令。
- 每个学生可见案例至少经过适龄、暴力/裸露、仇恨/歧视、误导性商业承诺、文化挪用，以及历史/政治/文化语境风险审查；不确定即 SAFETY_HOLD。
- 为可能引发不适的合规案例提供内容提示、默认隐藏和替代推荐；未成年人场景采用更严格的默认屏蔽。
- 提供“报告此案例/来源/说明”的入口，报告不自动删除内容，但应进入可追踪审核队列。
- 案例分析不对设计师、地区、群体或风格做贬损性、刻板化或“优劣天生”的评价；涉及文化符号时要求语境和来源。

P0 必须签核下列安全分级矩阵，实施不得自行改变默认动作：

| 风险类别 | 默认动作 | 复审要求 | 紧急处理 |
| --- | --- | --- | --- |
| 未成年人不适龄、裸露或极端暴力 | 不进入学生端 | 具备适龄审核职责的人工复审 | 有具体 locator 的投诉立即进入 WITHDRAWAL_HOLD |
| 仇恨、歧视、剥削或骚扰 | 默认不推荐、不展示 | 安全与教学双人复审 | 有现实伤害或违法风险时立即 hold |
| 文化、历史或政治语境争议 | 先保留语境与来源，不以模型判断定性 | 具备相关语境的人工复审；必要时只限内部 | 具体事实/权利争议进入 hold |
| 虚假署名、误导性商业承诺或来源不实 | 不展示、不作为案例事实引用 | 来源与权利复审 | 来源可疑时立即停止新引用 |

“可信投诉”在 P0 的工作定义为：投诉者能给出受影响 case/evidence 的 locator，并说明权利、事实、安全或受众风险。它触发临时 hold，不等于系统已裁定投诉内容成立。每项投诉均应有分级、处理时限、申诉/纠错路径、复审人和审计记录；具体时限在 P0 台账冻结。

### 7.2 账号、收藏与数据最小化

- 学生以现有 Lumi 身份体系进入；灵感板和个人注记默认仅本人可见。所有私人读取、保存、删除和对话引用都以服务端 owner identity 强制过滤，而不是只靠前端隐藏。
- 学生可以查看、导出和删除自己的灵感板与注记。若未来某项收藏需作为教师可复核的作业证据，必须进入独立、可见、可申辩的证据流程，不能暗中改变收藏的可见性。
- 搜索、点击和保存事件只保留提供服务、排障和聚合改进所需的最少数据；不以个人“审美画像”或消费轨迹做排名。
- 学生临时上传的图片只用于本次会话/任务内的受控检索或讨论，默认 TTL 删除、不公开、不入 Wiki、不进入长期 trace；独立投稿必须另行同意。
- 教师或管理员不能因运营便利直接查看学生私有板。角色、审计和例外访问规则需先明确且学生可见。

P0 要建立以下数据流与保留期表。TTL、备份例外和外部 Provider 条件未填定前，禁止处理真实学生数据：

| 数据 | 目的 | 可访问角色/处理者 | 默认保留与删除传播 |
| --- | --- | --- | --- |
| 灵感板、保存 case id、个人注记 | 学生私人组织与继续讨论 | 本人；服务端最小存储 | 用户删除后从主存储、缓存和搜索投影移除；备份与审计例外需 P0 明示 |
| 会话内板引用 | 将学生选择传给本轮 Lumi 讨论 | 本人当前会话、受控回答服务 | 会话结束或任务 TTL 到期后删除，不进入案例检索库 |
| 临时上传图片 | 当前受控讨论/检索 | 本人当前会话、必要的受控处理器 | 明确 TTL 从上传完成起计算；删除传播到临时对象、缓存、队列和派生物 |
| CitationReceipt | 排障、引用复核、撤下传播 | 受限运维/审核角色 | 仅保存无学生正文的最小映射；到期或用户删除请求的例外规则需 P0 明示 |
| 聚合运营事件 | 发现零结果、可访问性或权利问题 | 受限产品/运维角色 | 去标识、聚合后保留；不得回推个人审美或行为排名 |

学生个人数据、上传图和私人注记默认不得发送给外部 Provider。任何例外需同时经过学生数据、来源/资产处理许可、未成年人/监护要求、保留期和 Provider 数据处理条款的独立确认。

### 7.3 可访问性

学生端 MVP 必须满足 P0 冻结的 WCAG AA 版本、支持浏览器、屏幕阅读器、缩放比例和窄屏设备基线，并至少验证：

- 全键盘浏览、搜索、筛选、保存、取消保存、报告和关闭弹窗；
- 合理的焦点顺序、可见焦点、跳转主内容和无鼠标替代路径；
- 每张可见预览具备来源标识和简短、人工审核的替代文本；复杂视觉关系提供可展开文字观察，而不是用自动 caption 伪装完整理解；
- 不只靠颜色表达筛选、状态、权利或风险；文字对比度、缩放、窄屏重排和屏幕阅读器名称可用；
- 图像加载失败、案例撤下、无结果、权限受限和服务降级有可理解的文案与恢复路径。

P2 实施计划必须为上述核心任务附上可复跑的键盘、读屏、缩放、窄屏和错误/撤下状态测试记录；视觉截图不能替代该记录。

## 8. 性能、成本、运维与治理

### 8.1 运行边界

浏览、详情、保存和检索使用受控 API。浏览器不直接访问原始文件、对象存储桶、向量库、模型权重或私有 locator。预览仅使用为对应可见性生成的派生资产；原件和预览不可由同一 URL 权限模型混用。

V1 Wiki release 与词法/图投影必须记录 Schema Pack、中文 tokenizer/规范化规则、Alias/Facet 词表、允许边类型、Page/Revision/Link set hash、canonical 输入版本集合、权限快照、构建结果和 WikiCompilationReceipt。Current Compiled Truth 与 Timeline 由相同 release 可重建，但 Timeline 历史不得因重建丢失。

P4 若启用视觉旁路，必须与 Wiki 词法/图投影分开记录模型 revision、预处理、rights filter、collection/namespace 与评测报告。视觉 generation 只绑定可召回 Page ID 集，不能成为 Wiki 的 canonical generation。

### 8.2 性能与成本策略

- V1 限制为人工审过的小样案例集，先建立 Wiki 编译、中文 FTS、有界图遍历、缩略图和受控预览的性能/成本基线；不采购或依赖向量 Provider。
- 浏览列表采用固定大小的缩略图、分页或有界加载、懒加载和缓存；详情页按需取最小预览，不能在列表页加载原件。
- Wiki 编译、查询、图遍历、重排、预览读取分别设置并发、超时、速率和成本预算；P4 Provider 调用另设独立预算。任一预算触发时走诚实降级。
- 不在本计划中预设好看的绝对延迟、召回或成本数字。实施前先对目标设备、网络、案例规模和 Provider 建立基线，冻结预算与阈值后再验证；阈值不得为通过结果而临时放宽。
- 每次新增案例、预览、模型或 Provider 前，都要报告新增存储、索引体积、构建时间、查询 p50/p95、缓存命中、失败率和预估月度成本。

### 8.3 可观测性和治理指标

| 指标组 | 必须回答的问题 | 不采用的伪指标 |
| --- | --- | --- |
| 来源与权利 | 学生可见案例中展示权、回链和撤下规则是否完整 | “已收集素材总数” |
| 审核 | 候选在哪个门停住、退回原因、队列时长和重复问题是什么 | 仅看审核吞吐量 |
| 检索 | 是否找到正确且可展示的案例，是否正确拒绝无答案和无权限结果 | 单一平均相似度分 |
| 引用 | 引用能否回到正确 case/evidence/version，事实和观察是否混淆 | 回答字数或模型调用数 |
| 学生体验 | 搜索后是否能保存、比较、理解和继续创作，是否有可访问性阻断 | 停留时长、连续滚动、点赞 |
| 安全与隐私 | 敏感内容、越权访问、学生数据删除和临时上传 TTL 是否符合承诺 | 个人审美/行为排名 |
| 运维 | generation 是否可重建、熔断/降级/撤下是否通过、成本是否在预算 | “Provider 已连接” |
| 链接与策展 | 原站链接是否仍可用，精选理由和多样性复审是否可解释 | 外部热度或转发量 |

trace 只记录最小必要的版本、hash、结果类别、耗时、降级和审核身份，不记录密钥、签名 URL、原始私密内容、完整供应商载荷或学生敏感正文。

## 9. 分期路线图

| 阶段 | 目标 | 允许范围 | 退出门 |
| --- | --- | --- | --- |
| P0 决策与台账 | 冻结 Schema Pack、Page/Link 类型、权利矩阵、受控词表、审核角色、受众范围、数据保留、安全分级、Gate Specification 和撤下流程 | 文档、空白模板、只读候选登记 | P0 决策与 Gate 台账已签核；无向量运行合同、canonical/Wiki 边界与变更规则已冻结 |
| P1 内部策展小样 | 以不超过 20 个 `PRIVATE_CANDIDATE` 验证候选采集、私有副本、metadata、去重、Wiki Page/Revision/Timeline/Link 草稿编译和审核包 | 仅内部；草稿词法/图投影可建，所有学生与 AI 通道为 DISABLED；不得生成 embedding 或向量索引 | 每个样例有稳定 caseId/pageId、`DRAFT_COMPILED_PREVIEW`、Timeline/关系草稿、图 lint、WikiCompilationReceipt 草稿、撤下入口与出库审查结果；不得称为 Current Compiled Truth |
| P2 学生 MVP | 学生通过中文全文、Alias、Facet 和一至两跳关系浏览/搜索/筛选，并可私有保存与报告案例 | 仅 APPROVED_STUDENT 且受众为 AUTHENTICATED_STUDENT_ONLY 的 Page；`BROWSE_RELEASE` 与 `STUDENT_SEARCH` 独立启用，不接视觉相似检索或 Lumi 上下文注入 | Schema/图完整性、非向量检索、权利、可访问性、隐私、账号隔离、无下载绕过和人工验收通过 |
| P3 Lumi 引用接入 | 让回答用已批准 Wiki Page、匹配概念和获准关系路径解释并显示 citation | 双库明确分层；每条主张经 Lumi ClaimSupportMap 校验；关闭向量仍完整工作 | G-04、G-05、G-07 至 G-13，以及 G-14 的 P3 范围和 Wiki 专属引用、无答案、权限过滤、撤下、降级、回归评测通过 |
| P4 可选视觉向量旁路 | 只为已获批 Page 增加“图片到候选 Page ID”的影子召回 | 独立 namespace、冻结 qrels、硬负例、成本/许可验证；不得写 Wiki truth/link | 对无向量基线证明增益，且无越权、无安全退化、可随时关闭 |
| P5 扩展与公开 | 扩大来源和可能的公开目录 | 逐来源授权、独立风控和运营准备 | D-13 已独立签核且受影响 Gate 复验通过；不得由 P2/P3 自动推导 |

P2 至 P5 均须新建独立实施计划和明确授权。本文件不授予任何生产、部署、Provider、R2、抓取或真实学生数据操作权限。

当前 D-16 仍为 `ADOPTED_FOR_DESIGN_ONLY`，因此上表 P1 描述的是目标阶段而非当前实施许可：现阶段只允许 S1 的无数据库纯函数、schema/contract 与合成 fixture 测试。S2 以及任何迁移、持久化写路径、DB-backed 集成、后台任务或生产路由，必须先由用户把 D-16 在精确范围内升级为 `ADOPTED`，或另行将 D-18 签核为 `ADOPTED`；否则不得以“P1 已规划”为由开始。

## 10. 验收标准与回滚

### 10.1 分阶段 V1 验收

1. **P2：**每个学生可见案例可追溯到 SourceRecord、SourceVersion、RightsDecision 和至少一个可用 Citation anchor。
2. **P2/P3：**有明确 DENY、过期/撤销、投诉 hold 或 WITHDRAWN 的案例绝不出现在浏览、搜索、推荐、详情、保存建议或回答引用中；UNKNOWN 仅能在来源披露、教学/质量/安全/课程审核、AI 引用资格和撤下入口均已通过后出现，且不得被表述为授权或 Lumi 所有。
3. **P2/P3：**来源事实、视觉观察、教学推断、模型草稿和人工审核状态在数据与 UI 中均可区分。
4. **P2/P3：**同一原件作为课程证据和 Wiki 案例时，两个对象、审核、可见性、引用和撤下记录保持独立。
5. **P2/P3：**Knowledge V2 无需迁移、替换或复制正文/ACL；Wiki 只能通过 `COURSE_CONCEPT_REF` 保存稳定概念 ID 和显示标签。
6. **P2/P3：**未认证会话不能浏览、搜索、打开详情、读取/写入画板、看到 Lumi AI 引用卡或取得任何资产；不存在匿名 sitemap、公开分享链接或图片直链的可用路径。
7. **P2：**私有灵感板无法被其他学生、教师或匿名访问；删除、导出和临时上传 TTL 均有自动化与人工验收。
8. **P2：**所有核心操作以键盘和屏幕阅读器可完成；可访问性验收不以视觉截图替代。
9. **P2/P3：**无答案、无权限、服务不可用、案例已撤下和图片加载失败均给出诚实、可恢复的结果，不伪装成空搜索或完整答案。
10. **P2/P3：**每个发布 Page 具有稳定 pageId/revision、由获准 canonical 对象支持的 Current Compiled Truth、从 WikiChangeEventLedger 确定性投影的 append-only Timeline；每次搜索或推荐返回匹配概念或获准关系路径，不能只给相似度。
11. **P2：**`VECTOR_DISABLED` 环境中，浏览、中文搜索、Facet、关系发现与比较全部通过；`STUDENT_SEARCH` 关闭不影响普通浏览。
12. **P3：**`VECTOR_DISABLED` 环境中，Lumi 案例引用、ClaimSupportMap、CitationReceipt 与诚实降级全部通过；关闭 WIKI_RETRIEVAL 后课程回答仍可工作。
13. **P2/P3：**离线评测覆盖 P0 Gate Specification 冻结的正例、Alias/中文改写、一至两跳关系、硬负例、隐藏节点路径、撤下、权限过滤、引用回链和跨库混淆用例，并按查询类型报告。
14. **P2/P3：**每个 Wiki generation 可由固定 canonical input set、event-ledger watermark/hash、Schema Pack、compiler/runtime、release/hash、权限快照和评测报告重建。
15. **P1/P2/P3：**S2/S5 审核与发布决定按角色域记录并绑定精确 canonical/draft/Page/release revision/hash；错误角色、失效审核人、禁止自审、缺少或重复第二审核、陈旧 revision/hash 均 fail closed，不能由普通 `TEACHER APPROVE` 替代。
16. **P2：**教师 Candidate Preview 与学生 Page Preview 使用互斥 resolver；前者只读精确可审 candidate revision，后者只读当前 eligible Page/release，任何撤下、旧 revision/release、错误身份或旧 admission/Candidate fallback 均不交付资产字节。
17. **P2/P3：**审核记录、拒绝理由、投诉、撤下和回滚均留有最小可审计证据，且不泄露受限原件。
18. **P4：**关闭视觉旁路不改变 Page 身份、Compiled Truth、Timeline、关系、可见性或 P2/P3 基线能力。

### 10.2 回滚与撤下

- 功能回滚：关闭 Wiki 浏览、保存、引用或视觉检索中的任一独立开关，回到课程知识和普通对话；不删除审核与运行审计。
- generation 回滚：活动 Wiki 投影切换回上一代已验 release；仅适用于技术、排序或性能问题。
- case/evidence 撤下：立即从所有投影、缓存、搜索、保存推荐和回答引用中隔离；不得被旧 generation 恢复。
- 数据修订：创建新版本与 supersedes 链，不覆盖历史来源、审核或 citation receipt。

撤下验收必须覆盖直链、短期 URL、CDN/应用缓存、浏览列表、详情、搜索、推荐、私人保存建议、文本 RAG、视觉 RAG、回答渲染和旧 citation 的降级。若某个已发出的副本无法从用户设备或第三方缓存回收，系统必须停止后续分发、记录覆盖范围并按 P0 决策通知受影响用户。

## 11. 风险优先级与需要用户确认的事项

### P0 风险

- 用户提供的版权材料被误认为可以学生端展示、外部 embedding 或公开。
- 未经审核的案例分析被模型写成设计事实或教学规范。
- 已撤下或不适龄的案例仍由缓存、向量索引或旧引用返回。
- 私有收藏、注记或学生上传作品被扩大为教师可见、公开或长期训练数据。
- 同一案例与课程库混用，导致“案例观察”看起来像“课程真理”。
- 模型编译草稿未经审核进入 Current Compiled Truth，或重编译覆盖 Timeline，造成幻觉被持久化、历史不可追溯。
- 图遍历经过隐藏/撤下节点泄露对象存在性，或稀疏/过密关系让解释路径失真。
- 未固定的 GBrain 上游版本改变 Schema、无向量语义或输出合同，导致 Wiki release 不可重建。
- 把 `TEACHER` 当通用批准角色，或让自审、失效审核人、缺失第二审核和陈旧 revision/hash 继续计入发布资格。
- 教师 Candidate Preview 与学生 Page Preview 共享 fallback，导致学生路径从旧 admission/Candidate 取回私有或已撤下资产。

### P1 风险

- P4 视觉相似检索在风格上相似但课程、媒介、权利或适龄性不匹配。
- 为了提升 P4 召回而对视觉材料整书 OCR、全量向量化，扩大成本和权利面。
- 案例 taxonomy 过密或过于学术，学生找不到；过粗又缺乏可解释筛选。
- 外部 Provider 成本、模型漂移或故障让体验不可预期。

### 用户需在 P0 前拍板

V1 的登录可见范围已由用户拍板，不再是 P0 待决；未来是否扩大到 INSTITUTIONAL_PUBLIC 或 PUBLIC_INTERNET 由 D-13 独立处理。

1. 第一批可用来源清单，以及每类来源允许的保存、预览、OCR、外部 embedding、学生展示和公开使用范围。
2. 对用户提供杂志/书籍的默认政策：只做书目信息与原站链接，还是在取得明确许可后展示受控低清预览。
3. 策展、教学、权利、安全、release、撤下的责任人/替补人，禁止自审规则、双人复审触发表、角色失效传播、投诉接收渠道、紧急撤下目标时效和审计保留期。
4. 学生灵感板是否可能成为作业过程证据；若可能，何时、如何征得可见性确认。
5. 适用学生年龄段、敏感内容标准、地区/文化审查准则和允许的案例主题范围。
6. 是否允许在 P2 前先以无图、元数据加原站链接的“轻量案例目录”验证学生需求。
7. P4 是否启动视觉检索；只有另行授权启动时才选择本地或外部 Provider，并通过独立许可、成本和评测门。该决定不阻断 V1/P1/P2/P3。
8. V1 的案例规模、维护预算、期望更新频率和撤下后的替代策略。
9. 对公开/合法来源的署名、链接、许可文案和商业使用边界的统一模板。
10. 是否以及在什么精确切片、分支、数据与环境范围内授权 S2+ 持久化实施；未把 D-16 升级为 ADOPTED 或签核 D-18 前，只能执行 S1 无数据库纯函数影子工作。

## 12. 实施切片与现有工作对齐（规范性附录）

本附录只定义后续代码工作的拆分边界，不授权实施、部署、数据迁移、学生端启用或外部访问。当前 `7a7fe7952` 已完成的正式发布与安全投影不是废弃工作：它们构成 LLM Wiki 上下游的治理外壳；需要替换的是中间的平面 read model 与检索实现。D-16 当前仅允许 S1 无数据库纯函数、schema/contract 和合成 fixture 测试；S2–S11 只是待授权切片，任何持久化、迁移、DB-backed 集成或生产路径必须先满足 D-18 或 D-16 的实施状态升级。

### 12.1 当前实现中可直接复用的层

| 现有能力 | 代表实现 | 在新架构中的位置 | 复用边界 |
| --- | --- | --- | --- |
| Source Registry、私有 Candidate 合同与状态推进 | `inspiration_sources`、`inspiration_candidates`、`inspiration_candidate_analyses`、`inspiration-case-intake.ts`、`inspiration-review-pipeline.ts` | Candidate 与 canonical governance 输入 | 保留来源隔离、revision、处理通道记录和 `PRIVATE_CANDIDATE` fail-closed；现有管线本来没有 embedding 执行路径，P1 必须保持无执行路径且禁止接入向量 Provider，只保留未来 P4 的行为级权限槽位 |
| 教师身份、审核队列、幂等与并发保护 | `inspiration-review-access.ts`、教师候选 API、`inspiration_review_decisions`、`expectedRevision`、idempotency key | Candidate → 分域审核 → canonical DomainReviewDecision | 复用数据库身份复核、expectedRevision、幂等和并发安全语义；把通用教师决定迁移为 4.5.1 的角色域矩阵、自审限制、双人复审和精确 hash 绑定，不能原样复用普通 `TEACHER APPROVE` |
| 正式学生发布合取门与数据库约束 | `FormalWikiStudentPublicationInputSchema`、`inspiration_admissions` publication contract、`isFormalWikiStudentEligible` | Wiki release 之后的学生可见白名单生成 | 只复用“普通 APPROVE 不等于学生发布”、行为决定合取、撤下 fail-closed 和审计语义；现有 Browser/Bridge 同时 ACTIVE 的具体 schema/DB CHECK 必须迁移为独立通道状态，不能原样复用或用默认值自动激活 |
| DB-backed viewer scope 与安全投影 | `inspiration-viewer-scope.ts`、`inspiration-student-projection.ts`、public id/source/preview resolver | eligible Page allowlist 前置过滤与最终渲染复查 | 复用身份复核、私有 locator 拒绝、公开来源白名单、受控字节交付和最小字段投影；只可共享授权后的 opaque asset reader，Preview 授权必须拆成教师 Candidate 与学生 Page 两个互斥 resolver |
| Browser、Preview、Bridge 的受控 API 壳与卡片/trace 输出 | `/api/inspiration/browse`、`/previews/:publicId`、`/bridge`、`InspirationBrowseResponse`、`InspirationBridgeResponse` | P2/P3 交付边界 | 保留认证、限长、分页、案例卡、独立 trace 形状及诚实降级；Preview 只保留路由壳和安全响应，不复用当前 Candidate/admission fallback。当前实现没有 ClaimSupportMap/CitationReceipt，它们由 S10 新增；Browser/Bridge 内部数据源改接 Page ID 检索端口，不保留当前匹配算法 |
| 撤下、审计与旧投影隔离 | `withdrawInspirationCandidate`、`inspiration_candidate_audit_events`、admission 删除与受控资源解析 | Canonical event ledger 与投影撤下传播 | 保留即时阻断语义；扩展为 append-only `WikiChangeEventLedger`，并同步移除 Page、入边/出边、词法投影、缓存和旧 citation 可用性 |

### 12.2 必须替换或迁移的检索核心

以下实现只能作为旧行为 fixture 或迁移参照，不能成为 LLM Wiki V1 的正式检索核心：

- `inspiration-review-pipeline.ts::activeReadModel` 当前把获准内容压成单个 candidate JSON；应改为 canonical 对象到 `WikiPage / WikiPageRevision / WikiTimelineEvent / WikiLink / WikiCompilationReceipt` 的确定性编译器。`inspiration_admissions` 继续承担发布门，不再兼任 Wiki 内容真相。
- 当前 Candidate、Analysis、Rights、ReviewPackage 是可变整块 JSON，Analysis 也不是多版本事实；不能直接冒充计划中的不可变 canonical 版本对象。正式编译前必须建立 `CanonicalInputBundle` 兼容层：为所消费的 Source/Candidate/Analysis/Rights/Review/Withdrawal 快照分配稳定版本身份与 hash，并让后续决定引用这些身份。长期可再拆为独立 canonical 表，但不得在无版本快照时启动 S4 正式编译。
- `advanceAutomatedInspirationCandidate` 当前只推进 state/revision，不持久化每版分析、编译草稿和审核包；教师 APPROVE 也只绑定 candidate revision。新流程必须先版本化 Analysis、`DRAFT_COMPILED_PREVIEW`、Timeline/Link 草稿与审核包，并让 ReviewDecision 绑定 `pageDraftRevisionId`、compiled hash、link-decision set/hash，才能证明教师批准的是哪一版。
- `inspiration_candidate_audit_events` 当前是普通候选审计，不是完整 WikiChangeEventLedger；withdraw 还会删除 admission。切换前必须在同一事务中同时写 canonical version 与 ledger event，建立基线 watermark/hash，并让 review/rights/withdrawal/link 变更全部经过该接缝；缺事件或 hash 不一致时正式编译 fail-closed。
- `FormalWikiStudentPublicationInputSchema`、`isFormalWikiStudentEligible` 和数据库 CHECK 当前强制 `browserChannel` 与 `bridgeChannel` 同时 ACTIVE。必须拆为基础发布资格谓词，以及 `BROWSE_RELEASE / STUDENT_SEARCH / WIKI_RETRIEVAL` 各自的 DISABLED/SHADOW/ACTIVE 谓词；迁移后全部新通道默认 DISABLED，P2 激活不得顺带授权 P3 模型上下文。
- 当前 `publicId` 由 candidateId 派生，Preview 也按 publicId 回查 Candidate/admission；新引擎却返回 pageId/revision/release。迁移必须明确身份链：V1 只有 `INSPIRATION_CASE` Page 可成为案例卡，保持稳定 `pageId → caseId/candidateId → 现有 publicId` 映射；学生 Preview 每次由 publicId 只解析到当前 eligible Page/Revision/release，再解析获准 evidence asset 并复查资格。旧 URL 只有映射仍存在且当前 release 合格时才继续工作，否则统一 404/不可用；不得直接回读旧 admission 或 Candidate 绕过 Page release。教师 Candidate Preview 使用另一条按精确 candidate/review-package revision 解析的私有合同，不得复用学生 publicId fallback。
- `inspiration-browser.ts` 当前逐行加载 ACTIVE admission，再以硬编码 `intentFacets`、token substring 和内存过滤匹配；应改为“先生成 eligible Page ID allowlist，再做中文 FTS/Alias/Facet 种子召回，再在 allowlist 诱导子图内做白名单边类型 1–2 跳遍历”。
- `inspiration-bridge.ts` 当前复用 Browser 查询并用 tags 拼接 `matchingExplanation`；应改接独立 `WIKI_RETRIEVAL` 端口，返回 Page/Revision、匹配概念和经审核关系路径，再由 Lumi 执行 ClaimSupportMap。
- 真实 Tutor 注入不只经过 Bridge：`orchestrator-context.ts → inspiration-case-retriever.ts → run-tutor-turn.ts → tutor-prompt.ts/contracts.ts` 仍可把旧平面 CaseReadModel 注入模型。兼容 schema 虽携带 `textRag/visualRag` 与 `match.score`，当前资格判断实际上只检查 `browseRelease`，score 也不参与排序；正式切换必须覆盖整条 runtime/prompt/response 链，并让旧 adapter 只作冻结 fixture。任何 `TEXT_RAG` 旧字段只可显式映射到无向量 `WIKI_RETRIEVAL`，不能推断文本向量存在。
- 现有 `AUTO_ADMITTED/INDEXED` 不能继续表示“已经建好正式检索索引”。迁移后必须拆成审核通过、Wiki 编译发布、词法/图投影完成和学生通道激活的独立持久化状态；失败不得跳过中间 receipt 或回退到旧平面检索。

#### 12.2.1 两条互斥的 Preview resolver 合同

| 合同 | 唯一输入与解析目标 | 必须通过的权限/状态 | fail-closed 负向测试 |
| --- | --- | --- | --- |
| `resolveTeacherCandidatePreview` | DB 已复核的 teacher/reviewer scope、`candidateId`、精确 `candidateRevisionId+hash`、`reviewPackageRevisionId+hash`；只解析该私有 Candidate revision 的受控资产 | actor 当前有效且具有该 case 所需审核域；Candidate 仍处于该 actor 可审状态；requested revision/hash 等于审阅包绑定值；预览行为获准；无 withdrawal/hold | 非教师/错误域/失效审核人、不可审状态、陈旧 candidate 或 review-package revision/hash、WITHDRAWN/HOLD、无预览权、资源缺失均拒绝且不返回字节；不得转调学生 resolver、旧 admission 或 publicId 兜底 |
| `resolveStudentPagePreview` | DB 已复核的 STUDENT scope 与 `publicId`；只解析映射到的当前 eligible `PageId / PageRevision / release` 和该 release 获准 evidence asset | viewer 命中当前 release allowlist；基础发布、`BROWSE_RELEASE`、受众、权利/预览、安全、撤下和 evidence 资格当前均通过；若请求携带 revision/release 声明，必须与 current 完全一致 | 匿名/错误用户、隐藏 Page、陈旧 PageRevision/release、WITHDRAWN/REVIEW_HOLD、无 evidence/预览权、旧 URL 映射失效均返回 404 或安全不可用且不返回字节；绝不回退旧 admission、Candidate 或教师 resolver |

两条合同必须使用不同的输入 schema、授权函数和路由 namespace/handler；学生路由不得接受 candidateId/candidateRevision，教师路由不得签发学生 public URL/token。二者可以在授权成功后共享只接受 opaque asset reference 的字节读取与内容净化层，但该层不得自行尝试其他身份链或 fallback。测试必须证明撤下传播同时关闭相应路径，并证明任何一条 resolver 失败时不会调用另一条。

### 12.3 可拆分实施工作项

| 切片 | 阶段 / 依赖 | 输入与动作 | 产物 | 硬停止边界 |
| --- | --- | --- | --- | --- |
| S1 合同与纯函数影子编译 | P1 / 无依赖 | 只复用现有 Candidate/Analysis/Review fixture 的类型与合成、人工冻结 fixture；固定 `CanonicalInputBundle`、page/link types、稳定 `caseId ↔ pageId` 和纯编译端口 | Wiki Page/Revision/LinkDecision/ChangeEvent/CompilationReceipt 的版本化 schema；`DRAFT_COMPILED_PREVIEW` 与 lint 结果 | 不扫描或读取真实数据库行，不新增持久化写路径，不改 Browser/Bridge，不创建 Current Compiled Truth，不生成 embedding/向量索引 |
| S2 分析、草稿与角色域决定版本化 | P1 / S1 + D-18 ADOPTED 或 D-16 精确升级 | 新增独立 WikiDraft 状态/版本持久化，避免把新草稿状态硬塞进旧 Candidate CHECK；把 Analysis、CanonicalInputBundle、Page/Timeline/Link 草稿和 ReviewPackage 按不可变 revision/hash 保存。迁移 `decideInspirationCandidate`：按 4.5.1 角色矩阵写逐域决定、自审限制与需要时双人复审；通用 APPROVE 不再立即创建旧 readModel/admission 或推进 `AUTO_ADMITTED/INDEXED → ACTIVE` | 每条 DomainReviewDecision 绑定精确 candidate/canonical/draft revision/hash、compiled preview 与 canonical WikiLinkDecision set/hash；角色策略快照、co-review 链、状态迁移、失效审核人处理和旧自动 admission 退场回归测试 | D-04 未签核、实施授权未升级、错误角色、禁止自审、缺/重复第二审核或任一陈旧 hash 均阻断；标签/Facet/关系修改先生成新 revision 再审；逐域决定最多进入 INTERNAL_CATALOG_ACTIVE，不打开学生通道 |
| S3 Canonical 兼容快照与 ledger 接缝 | P2 开发前置 / S2 | 将现有 Source/Candidate/Analysis/Rights/Review/Withdrawal 的当前获准版本物化为不可变 `CanonicalInputBundle`；所有后续 review/rights/withdrawal/link 变化与 ledger event 在同一事务写入 | 版本 ID/hash、初始 ledger watermark/hash、事件连续性检查和缺事件 fail-closed 规则 | 无单独迁移授权时只处理 synthetic/授权小样；不启用学生通道，不把普通 audit event 直接冒充完整 ledger |
| S4 正式 Wiki 编译发布 | P2 开发前置 / S3 | 只消费被批准的 CanonicalInputBundle、绑定其 hash 的 Review/LinkDecision 和连续 event ledger；幂等编译 | 稳定 WikiPage、WikiPageRevision、Current Compiled Truth、append-only Timeline、已批准 Wikilink、WikiCompilationReceipt | 编译失败保持上一已验 release；不得覆盖 canonical 对象、跳过 receipt 或由旧 generation 复活撤下内容 |
| S5 发布资格、通道与公开身份迁移 | P2 开发前置 / S4 + 实施授权持续有效 | 拆分基础正式发布资格与 `BROWSE_RELEASE / STUDENT_SEARCH / WIKI_RETRIEVAL` 三个独立三态谓词；`RELEASE_APPROVER` 只对一个精确 PageRevision/release 作决定，并在激活时重验策展、教学、权利、安全域角色有效性、自审限制、requiredReviewerCount 与全部 canonical/release hash；迁移 admission/page release 引用；建立 `INSPIRATION_CASE pageId → caseId/candidateId → publicId → evidence/asset` 映射 | 绑定 PageRevision/release/compiledTruth/ledger/rights/audience hash 的 ReleaseDecision；独立 activation、schema/DB CHECK、REVIEW_HOLD/撤下审计、全量默认 DISABLED 的迁移证明，以及仅解析当前 Page/release 的学生 resolver | 错误/失效角色、禁止自审、缺/重复第二审核、陈旧 canonical/Page/release hash 全部 fail closed；不把旧 Browser/Bridge 同时 ACTIVE 自动映射为新通道 ACTIVE；P2 状态不得授权 P3；旧 URL 不得回读旧 admission/Candidate |
| S6 当前查看者的 Page allowlist | P2 / S5 | `buildEligibleWikiPageAllowlist({ viewerScope, releaseId })` 接受 DB 已复核的 STUDENT scope，合取 Page visibility、Rights/Review/Safety/Withdrawal 和受控资源资格 | 针对当前学生与 release 的 eligible Page ID 集；V1 仅显式批准的 `ALL_AUTHENTICATED_STUDENTS`，或进一步匹配 class/student/age 限制的 Page 可进入 | 没有 visibility policy、viewer 不匹配、隐藏/撤下 Page 一律排除；allowlist 必须先于 query expansion、FTS 和图遍历 |
| S7 非向量种子检索 | P2 / S6 | 在 eligible Page 上做中文规范化、Alias、Facet、标题/Compiled Truth/获准 Timeline 摘要 FTS | 可解释的种子 Page ID、匹配字段与 facet；`STUDENT_SEARCH=SHADOW` | 无 embedding、无向量库、无 Provider；无答案必须诚实返回 |
| S8 可见子图 1–2 跳 | P2 / S7 | 只在 S6 allowlist 诱导子图内，按 Schema Pack 白名单边类型有界扩展和去重排序 | Page ID、匹配概念、经审核关系路径、release/revision 与排名解释 | 禁止无界游走、动态发明边类型、隐藏节点作桥、用关系路径替代 evidence 或 ClaimSupportMap |
| S9 Browser/Preview 切换 | P2 / S8 | 保留现有认证、安全 projection、分页与案例卡 schema，把旧 substring matcher 替换为 S6–S8 端口；按 12.2.1 分别接入精确 candidate revision 的教师 resolver 与仅当前 Page/release 的学生 resolver | `BROWSE_RELEASE/STUDENT_SEARCH` 的 P2 Shadow；两类权限/撤下/陈旧 revision/hash/旧 URL 合格与失效用例；跨 resolver 零 fallback 证明和回归报告 | 未通过 G-10 至 G-16 的 P2 范围不 ACTIVE；旧 matcher 仅保留冻结对照；任一 Preview 失败不得回退旧 admission/Candidate 或另一 resolver，且不得返回资产字节 |
| S10 Lumi runtime 与 Bridge 切换 | P3 / S9 | 同时切换 `/bridge` 与 `orchestrator-context → inspiration-case-retriever → run-tutor-turn → tutor-prompt/contracts`；显式 `@灵感 Wiki` 使用独立 WIKI_RETRIEVAL activation，并在注入前后二次资格复查 | Page/Revision、匹配概念、关系路径、ClaimSupportMap、CitationReceipt、prompt/response contract 和案例卡 | STUDENT_SEARCH ACTIVE 不授权模型上下文；旧 adapter 不得继续注入；未通过 P3 Gate 时只可 SHADOW |
| S11 旧模型退场与授权回填 | P3 后 / S10 | 对已正式批准的 synthetic/授权小样做幂等回填，对照旧 readModel，验证撤下/回滚与 runtime 无旧注入 | 迁移报告、差异清单、旧字段只读兼容期和删除前置条件 | 不把 UNKNOWN/caption/自动推断编译为 truth；不复制 Knowledge V2 正文；不启用 P4 视觉旁路 |

S3 的 ledger 切换必须采用明确 cutover：先冻结获准输入快照并写 `IMPORTED_BASELINE` 事件与 watermark/hash；从 cutover 事务开始，Review、Rights、Withdrawal、LinkDecision 和版本变化必须与对应 ledger event 原子写入；影子编译器只消费该 watermark 之后连续、可校验的事件。任何漏号、hash 不一致或“只删 admission 未写 withdrawal event”的路径都阻断 S4。旧学生通道在 S9/S10 Shadow 对照通过前继续保持 DISABLED，不允许以双写成功代替 Gate。

规范执行顺序为：

~~~text
Candidate
  -> 去重/视觉理解与 Wiki 草稿（P1，无 embedding）
  -> READY_FOR_TEACHER_REVIEW
  -> 教师审核与 canonical 决定
  -> 正式 Wiki Page / Revision
  -> Current Compiled Truth + append-only Timeline + reviewed Wikilinks
  -> 当前学生、当前 release 的 eligible Page ID allowlist
  -> 中文 FTS / Alias / Facet 种子
  -> allowlist 诱导子图内 1–2 跳
  -> Browser 或 Lumi 再校验、解释、引用
~~~

任何切片都不得把“已获准 Candidate”“已编译 Page”“可供学生浏览”“可进入 Lumi 上下文”合并为同一状态。目标 P1 包含 S1–S2，完成定义止于内部草稿、逐域决定绑定的草稿版本与可重建合同验证；但在 D-16 仍为 `ADOPTED_FOR_DESIGN_ONLY` 且 D-18 未 ADOPTED 时，只能执行 S1，S2 的 schema migration、持久化、DB-backed 测试和生产路径全部阻断。S3–S9 属于 P2 开发及 Shadow，S10 属于 P3，均要求实施授权覆盖精确切片。P1 全程 `VECTOR_DISABLED`，不得生成 embedding、不得建立向量索引、不得选择或调用向量 Provider。

### 12.4 建议的第一项代码切片

在当前授权状态下，第一项只能执行 S1，而不是先改数据库或搜索 UI：新增 `CanonicalInputBundle`、最小 Wiki projection schema 与纯函数编译端口，输入只接受仓库合成 Candidate/Analysis/Review fixture 或人工冻结、明确授权且不需读取数据库的 fixture，输出稳定 `pageId/revisionId`、`DRAFT_COMPILED_PREVIEW`、Timeline event 草稿、LinkDecision 草稿和 CompilationReceipt 草稿；同时加入幂等、非法 page/link type、Knowledge V2 正文越界、模型草稿误入 truth、`VECTOR_DISABLED` 零向量调用测试。S1 不读取真实数据库行、不新增迁移/持久化、不做 DB-backed 集成、不接 Browser/Bridge，也不改变现有正式发布合取门；S1 完成不自动授权 S2。

## 13. 本轮执行声明

本轮只修订当前版本计划、P0 Gate 台账与经验教训，固定 LLM Wiki-first、V1 无向量、未来视觉旁路，以及与现有正式发布/安全投影工作的复用边界和实施切片。没有新增或修改生产代码、数据库、素材、对象存储、索引、Provider 配置、部署、线上开关或真实学生数据；没有读取凭证、私密站点或外部账号信息。
