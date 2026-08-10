# Lumi 设计灵感 Wiki：P0 决策与 Gate 台账

> 状态：P0_REQUIRED_REGISTER / TEMPLATE_WITH_PROVISIONAL_DEFAULTS / NOT_IMPLEMENTATION_AUTHORIZATION
>
> 关联主计划：docs/superpowers/plans/2026-08-09-lumi-inspiration-wiki-current-plan.md
>
> 使用规则：每一项必须有状态、责任角色、证据、日期和生效范围。D-14 只定义“已获准来源进入 P1 后可以怎样处理”，不能单独授权访问或下载任一外部来源：手工/单次采集须先在 D-08 明确到来源与行为，自动 pull 还须 D-15 另行启用。PENDING、UNKNOWN、DENY 或空白均为禁止执行该行为，不能由开发、模型或运营人员自行补全。`UNKNOWN` 绝不等于授权、Lumi 所有权或可公开展示。

## 0. 状态和签核规则

| 状态 | 含义 | 是否可执行 |
| --- | --- | --- |
| ADOPTED | 用户或被授权决策者已明确确认，且证据完整 | 仅在生效范围内 |
| ADOPTED_FOR_DESIGN_ONLY | 用户已确认设计方向；不授权迁移、持久化写路径、DB-backed 集成、后台运行、批量采集、部署、生产路由或学生端启用 | 仅可更新设计/schema/契约，并执行无数据库、无真实数据、无外部访问的纯函数或合成 fixture 合同测试；本计划中只覆盖 S1 |
| PROVISIONAL_FOR_PLANNING | 只用于本计划收敛；尚未成为生产或数据处理授权 | 否 |
| PENDING_USER | 等待用户确认 | 否 |
| UNKNOWN | 证据不足或权限不明 | 否 |
| DENY | 明确禁止 | 否 |
| SUPERSEDED | 被新决定替代，但保留审计链 | 否，除非新决定允许 |

签核必须至少记录：决策编号、决定、决策者角色、日期、适用受众、来源/资产范围、到期或复审日期、证据位置和 supersedes 关系。涉及权利、未成年人、安全、公开受众、外部 Provider 或生产启用的决定，不能仅由模型生成或代码提交替代。

## 1. P0 决策台账

| ID | 决策 | 当前状态 | 当前默认/待确认内容 | 责任角色 | 需要的证据 | 生效范围 |
| --- | --- | --- | --- | --- | --- | --- |
| D-01 | 学生可见受众 | ADOPTED | V1 为 AUTHENTICATED_STUDENT_ONLY；认证及学生范围校验是浏览、搜索、详情、画板、Lumi AI 引用卡和资产交付的前置条件。V1 不提供匿名 sitemap、公开分享链接或图片直链 | 用户/产品负责人 | 本线程用户明确决策（2026-08-09）；实施前补身份/访问策略与匿名拒绝测试记录 | V1；P2 实施时执行 |
| D-02 | 来源与展示信息标准 | PENDING_USER | P1 可保留 UNKNOWN 的作者、原始路径、许可与权利主体字段；出库时必须如实披露可得来源/许可信息，不能伪造 Lumi 创作、拥有或许可有效 | 用户/权利审核负责人 | 可见来源记录、许可文本/条款快照（如有）、披露文案与复核记录 | P1 起逐对象；P2/P3 出库复核 |
| D-03 | 行为级权限矩阵 | PENDING_USER | 保存、派生预览、本地解析、OCR、本地 embedding、外部 embedding、对象存储、学生展示、机构公开、互联网公开、商业复用分别记录 `ALLOW / DENY / UNKNOWN`；embedding 项只为未来 P4 预留，不是 P1 授权。UNKNOWN 不阻断 P1 私有采集/无向量 Wiki 草稿分析，显式 DENY 阻断对应动作与出库 | 用户/权利审核负责人 | 逐行为 RightsDecision 与实际处理通道记录 | 每个 source version 与 evidence |
| D-04 | 审核角色与权限分离 | PENDING_USER | 必须冻结 `CANDIDATE_PROPOSER/WIKI_EDITOR`、`CURATION_REVIEWER`、`TEACHING_REVIEWER`、`RIGHTS_REVIEWER`、`SAFETY_REVIEWER`、`RELEASE_APPROVER`、`WITHDRAWAL_OPERATOR` 的角色域矩阵；默认禁止创建者/编辑者审核自己的精确 revision。须定义替补、失效、申诉/恢复和 `requiredReviewerCount` 触发表；至少权利争议/例外、安全高风险、申诉后恢复及 `dualReviewRequired=true` 需要两名不同且同时有效的相应域审核人 | 用户/项目负责人及各域负责人 | 版本化角色矩阵、自审例外、双人复审触发表、替补/失效规则、角色赋予记录、负向测试 | S2 起；未签核只允许 S1 |
| D-05 | 安全与适龄分级 | PENDING_USER | 年龄范围、风险标签、默认动作、双人复审、申诉、处理时限和紧急 hold 条件 | 用户/安全审核负责人 | 分级矩阵与培训/复审说明 | 所有学生可见 case |
| D-06 | 学生私人数据与上传图 | PENDING_USER | owner 绑定、TTL 数值和起算点、删除传播、备份例外、未成年人/监护、外部 Provider 条件 | 用户/隐私负责人 | 数据流与保留期表、隐私文案 | P2 起；未定前不处理真实数据 |
| D-07 | 撤下与投诉 | PENDING_USER | 接收渠道、可信投诉工作定义、紧急时效、URL/CDN/cache 处理、通知规则、恢复/申诉与审计期 | 用户/运营与权利负责人 | 撤下 runbook、责任人和值班安排 | P2 起 |
| D-08 | 公开来源清单 | PENDING_USER | 第一批来源须逐项写明可访问入口与允许的 metadata-only、单次保存候选副本、定期 pull、视觉理解草稿和 Wiki 草稿编译行为；未列入的来源不可由 D-14 推断获准 | 用户/策展与权利负责人 | SourceRecord、入口与行为级 intake 决定清单 | 任一 P1 外部访问/导入前 |
| D-09 | Wiki 与课程库边界 | ADOPTED | 课程知识与灵感 Wiki 共用同一对话入口、按轮协作；Knowledge V2 不被替换或迁移。后台保持独立对象、审核、可见性、检索投影、排序、引用类型和撤下；Wiki 只可用 COURSE_CONCEPT_REF 引用稳定课程概念 ID，不复制课程正文/ACL/权威语义 | 用户/产品与教学负责人 | 本线程用户明确决策（2026-08-09，2026-08-10 澄清“不替换 Knowledge V2”）；首次 P3 WIKI_RETRIEVAL=ACTIVE 及范围变更时复审；主计划第 0、4、6.4 节 | V1 全阶段；不构成实施或生产授权 |
| D-10 | 视觉检索路线 | ADOPTED_FOR_DESIGN_ONLY | V1/P1/P2/P3 固定无向量依赖；P4 是可选视觉旁路，只能从图片召回候选 Wiki Page ID，不得写入 Compiled Truth、Timeline 或 Wikilink。是否实际启动 P4 仍需另行授权 | 用户/技术负责人 | 本线程架构澄清（2026-08-10）；未来 Provider 评估、许可、成本和 Wiki qrels | V1 无向量设计；P4 实施前重签 |
| D-11 | 策展与排序原则 | PENDING_USER | 教学问题、可解释性、多样性、权利可用性优先；不按个人画像或外部热度 | 用户/教学与策展负责人 | 受控词表、选择准则和偏差复审模板 | P1 起 |
| D-12 | 预算与维护能力 | PENDING_USER | 案例规模、更新频率、审核容量、存储/Provider 月度预算、故障响应边界 | 用户/项目负责人 | 容量与成本基线 | P1 前 |
| D-13 | V1 后公开化二次决策门 | PENDING_USER | 是否开放 INSTITUTIONAL_PUBLIC 或 PUBLIC_INTERNET 必须单独决定；不得由 D-01、P2 或 P3 推导 | 用户/产品负责人 | 新受众说明、逐案例权利复审、运营/安全/隐私影响评估与受影响 Gate 复验 | P5 前；未签核即禁止公开 |
| D-14 | P1 宽进严出私有候选政策 | ADOPTED | 仅对已由 D-08 逐来源批准进入 P1 的公开教育型来源：可按获准行为保存候选副本并做去重、视觉理解草稿、Wiki Page/Timeline 编译草稿、Alias/Facet 与 Wikilink 提案；P1 不生成 embedding 或向量索引。作者/原始路径/许可缺失记 UNKNOWN，不阻断已获准 intake 后的内部分析。候选绝不自动进入学生浏览、Lumi 引用、公开或分享 | 用户/产品负责人 | 本线程用户明确修订（2026-08-09；2026-08-10 收敛为无向量 P1）；D-08 来源清单、私有存储隔离、状态机与候选审计记录 | 已由 D-08 获准的 P1 内部候选；不构成外部访问、学生端或公开发布授权 |
| D-15 | 受控来源注册与增量导入 | ADOPTED_FOR_DESIGN_ONLY | 统一 Source Registry 管理用户选择的来源、入口、adapter/字段映射、频率、限速、启停、cursor/hash、健康、失败重试、撤下同步与 run audit；自动 pull 和手工批量导入共用 PRIVATE_CANDIDATE 管线。D-08 可授权手工/单次导入，但任何自动 pull、定时任务或批量运行仍须把本项升级为对应来源的实际授权 | 用户/产品负责人 | 本线程用户明确方向（2026-08-09）；registry 合同、停用 adapter 候选、运行日志设计 | P1 设计；自动/定时运行前逐来源与频率明确批准 |
| D-16 | 灵感 Wiki 的 LLM Wiki-first 架构 | ADOPTED_FOR_DESIGN_ONLY | Lumi canonical governance store 是真相源；只把获准对象编译为稳定 Page、Current Compiled Truth、append-only Timeline、Schema/Facet/Alias 和经审核 Wikilink；V1 以中文 FTS + 可见子图 1–2 跳检索。当前状态只允许 S1 无数据库纯函数/schema/contract/合成 fixture 测试，不允许 S2+ 的迁移、持久化、DB-backed 集成或任何生产路径 | 用户/产品与技术负责人 | 本线程用户明确架构方向（2026-08-10）；主计划第 0、4、6、12 节；实施前另需状态升级记录 | P0-P3 设计；S2+ 尚未授权 |
| D-17 | GBrain 运行时集成方式 | PROVISIONAL_FOR_PLANNING | 方法论已固定；直接嵌入固定 GBrain 上游版本还是实现 Lumi 兼容 Adapter，须在独立实施计划中固定 commit、Schema Pack、无向量语义、allowlist/可见子图能力、输入输出、升级和回滚合同 | 用户/技术负责人 | 上游版本审查、兼容测试、威胁模型与实施 ADR | P1 实施计划前；未固定不接 runtime |
| D-18 | LLM Wiki S2+ 实施授权 | PENDING_USER | 必须明确允许的切片、仓库/分支、迁移与持久化范围、数据类别、测试账户、运行环境、回滚、截止日期和禁止事项。可选择把 D-16 在该精确范围内升级为 ADOPTED，或将本项 ADOPTED；二者都不能自动授权生产部署、真实数据、外部访问或学生通道 | 用户/项目与技术负责人 | 签核记录、精确实施范围、数据/环境清单、回滚计划、关联 D-04/D-17 与 supersedes 关系 | 任一 S2–S11 迁移、持久化、DB-backed 集成、后台或生产路径前 |

## 2. Gate Specification

所有数值、样本、错误预算、设备条件和批准人必须在对应实施或评测开始前冻结。没有漂亮的数字不是放宽门槛的理由；尚未冻结就是不可进入下一阶段。

| Gate | 通过条件 | 冻结前必须填写 | 所需证据 | 批准角色 | 阻止的阶段 |
| --- | --- | --- | --- | --- | --- |
| G-01 来源、披露与明确限制 | P1 私有候选可带 UNKNOWN 元数据；P2/P3 服务对象必须有如实的来源/可见许可披露，且不存在显式 DENY、撤下或投诉 hold | 披露完整率、UNKNOWN 呈现规则、显式 DENY/hold 规则、抽样量 | RightsDecision、来源快照、披露样例、抽样复核 | 权利审核负责人 | P2 展示、P3 WIKI_RETRIEVAL=ACTIVE、P4 VISUAL_RAG=ACTIVE；不阻断 P1 intake/analysis |
| G-02 安全与适龄 | 每个学生可见 case 有适龄与敏感内容决定；hold 和报告可验证 | 年龄范围、标签标准、审核资格、处理时限、申诉规则 | 审核包、报告演练、hold 记录 | 安全审核负责人 | P2 |
| G-03 私隐与身份 | 所有 V1 学生入口均经认证与学生范围校验；私有板/注记/上传图仅按 owner 可访问；删除、TTL、备份例外与外部传输符合决定 | 数据字段、目的、TTL、删除覆盖面、测试账户模型、匿名路由/链接/资产拒绝规则 | 数据流、登录与权限测试、匿名 sitemap/公开分享/图片直链负向测试、删除回执 | 隐私负责人 | P2、P3 |
| G-04 Citation 与事实边界 | 每条 Wiki 主张有 ClaimSupportMap，渲染前可见性复查通过 | claim 类别、映射完整率、抽样量、错误上限、降级文案 | 引用测试、人工抽样、撤下重放 | 教学与产品负责人 | P3 WIKI_RETRIEVAL=ACTIVE |
| G-05 检索与无答案 | 正例、硬负例、越权、已撤下、跨库混淆均按冻结门通过 | qrels 版本、样本覆盖、准确率/错误预算、评测方法 | 离线报告、失败分类 | 技术与教学负责人 | P3 WIKI_RETRIEVAL=ACTIVE、P4 VISUAL_RAG=ACTIVE |
| G-06 可访问性 | 核心任务在冻结的浏览器、读屏、缩放和窄屏矩阵下通过 | WCAG 版本、设备/辅助技术矩阵、任务脚本、缺陷严重度标准 | 可复跑手工/自动测试记录 | 无障碍负责人或指定审核人 | P2 |
| G-07 性能、成本与降级 | 在冻结规模、设备和网络下满足预算，故障不会泄露或伪造空结果 | p50/p95、并发、成本、存储、错误预算、降级策略 | 基准报告、故障注入、成本报告 | 技术与项目负责人 | P2、P3 WIKI_RETRIEVAL=ACTIVE、P4 VISUAL_RAG=ACTIVE |
| G-08 撤下与回滚 | hold、withdraw、恢复和技术回滚可按范围传播，且不会复活受限资产 | 时效、覆盖面、直链/CDN/cache/索引/旧引用策略、通知规则 | 对抗演练、审计回执 | 运营与权利负责人 | P2、P3 WIKI_RETRIEVAL=ACTIVE、P4 VISUAL_RAG=ACTIVE |
| G-09 同一对话接入契约 | 每轮路由、Wiki 引用资格、课程引用/案例卡分型、视觉相似性校验和失败降级均符合主计划 6.4；Shadow 结果不进入学生回答 | 意图分类、逻辑输出 schema 版本、资格谓词、学生可见文案、测试集、样本量与错误预算 | schema fixtures、路由/负向测试、Shadow 对照报告、关闭 Wiki 后课程回归报告 | 产品、教学、权利与技术负责人 | P3 WIKI_RETRIEVAL=ACTIVE、P4 VISUAL_RAG=ACTIVE |
| G-10 Schema 与图完整性 | 所有发布 Page/Revision/Link 符合固定 Schema Pack；无未知类型、悬空边、越界课程正文复制或未经审核关系 | page/link 类型、必填字段、lint 规则、图密度/孤点预算 | schema fixtures、lint 报告、抽样复核 | 技术与策展负责人 | P2、P3 WIKI_RETRIEVAL=ACTIVE |
| G-11 编译真相与时间线一致性 | Current Compiled Truth 只来自当前获准 canonical 版本；Timeline append-only；任一 release 可由 receipt 重建 | 输入集合/hash、compiler/runtime identity、重建比对、历史保留规则 | WikiCompilationReceipt、重建报告、版本/撤下重放 | 技术、权利与审核负责人 | P2、P3 WIKI_RETRIEVAL=ACTIVE |
| G-12 非向量检索质量 | 中文规范化、Alias、Facet、全文和 1–2 跳图检索在冻结 qrels/硬负例下通过，排名与路径可解释 | tokenizer/词表、hop/edge 白名单、样本覆盖、错误预算 | 离线报告、失败分类、路径解释抽样 | 技术与教学负责人 | P2、P3 WIKI_RETRIEVAL=ACTIVE |
| G-13 图权限与撤下 | 图遍历严格限制在 eligible Page 诱导子图；隐藏/撤下节点不能作桥，也不泄露存在性 | allowlist 生成、边可见性、缓存/旧 release 规则、对抗样本 | 越权/撤下路径测试、缓存演练、审计回执 | 权利、隐私与技术负责人 | P2、P3、P4 |
| G-14 向量关闭完整运行 | 分阶段验收：P2 在 `VECTOR_DISABLED` 下通过浏览、STUDENT_SEARCH、Facet、关系发现、比较与回滚；P3 增加 Lumi 引用、ClaimSupportMap 和课程回归；P4 证明关闭视觉旁路不改变 Wiki truth 或 P2/P3 基线 | 各阶段测试矩阵、功能覆盖、降级文案、性能预算 | 分阶段端到端记录、课程/Wiki 回归、故障注入 | 产品与技术负责人 | P2 仅阻止其学生浏览/搜索 ACTIVE；P3 阻止 WIKI_RETRIEVAL=ACTIVE；P4 阻止 VISUAL_RAG=ACTIVE |
| G-15 角色域审核与双人复审 | S2/S5 决定只由当前有效且具备精确审核域的 actor 作出，并绑定精确 candidate/canonical/draft/Page/release revision/hash；职责分离、自审限制和 requiredReviewerCount 全部满足，角色或策略失效会触发重审/REVIEW_HOLD | 角色矩阵版本、域权限、自审例外、双审触发与唯一性、角色失效传播、decision/release 字段 | 错误角色、失效审核人、禁止自审、同人双签、缺第二审核、陈旧 revision/hash 的 fail-closed 测试与审计回执 | 项目负责人及策展、教学、权利、安全负责人 | S2 持久化实施、S5 release 激活、P2/P3 ACTIVE |
| G-16 Preview resolver 隔离 | 教师 Candidate Preview 只解析该教师当前可审的精确 candidate/review-package revision；学生 Preview 只解析当前 eligible Page/release；两者输入、授权函数与 handler 互斥，失败时不调用另一条或旧 admission/Candidate fallback | 两类 input schema、角色/受众谓词、current/revision 规则、撤下传播、错误响应与字节交付边界 | 错误身份/域、失效审核人、旧 revision/release、HOLD/WITHDRAWN、旧 URL、跨 resolver fallback 的负向测试与零字节证明 | 权利、隐私、教学与技术负责人 | S9 Shadow、P2 BROWSE_RELEASE/STUDENT_SEARCH ACTIVE；P3 持续满足 |

## 3. 实施前核对单

S1 合同与纯函数影子编译开始前：

- D-09 保持 ADOPTED，D-10、D-16 保持 ADOPTED_FOR_DESIGN_ONLY；该状态只允许 S1 的无数据库纯函数、schema/contract 和合成 fixture 测试。只使用仓库合成 fixture 或人工冻结、明确授权且无需读取数据库的 fixture，不扫描真实数据库行、不访问外部来源。
- `VECTOR_DISABLED` 是默认运行条件；不生成 embedding、不建向量索引、不选择或连接向量 Provider。
- S1 的目标就是产出并版本化 Schema Pack、Page/Link 类型、caseId/pageId 映射、`CanonicalInputBundle`、`DRAFT_COMPILED_PREVIEW`、Timeline/Link 草稿和 WikiCompilationReceipt 草稿合同；这些产物不是 S1 的循环前置条件。
- S1 不新增 migration/table、持久化 repository、DB-backed integration、后台 job、runtime/route 接线或生产 feature flag；完成 S1 不自动升级 D-16，也不授权 S2。

S2 实现开始前：

- D-16 不得仍仅以 `ADOPTED_FOR_DESIGN_ONLY` 作为依据：必须由用户把 D-16 在精确 S2 范围内升级为 ADOPTED，或将 D-18 在精确 S2 范围内置为 ADOPTED。未升级时，migration、持久化 repository、DB-backed 测试和现有 route/runtime 接线全部禁止。
- D-04 的版本化角色域矩阵、自审限制、双人复审触发表/失效规则，以及 D-17 的 compiler/runtime 或 Lumi Adapter 路线已在 S2 实施范围内签核；WikiDraft 独立状态/版本、逐域决定精确绑定 candidate/canonical/draft revision/hash、旧自动 admission 退场和回滚测试合同已版本化。
- 错误角色、失效审核人、禁止自审、同人双签、缺第二审核、陈旧 revision/hash 的 fail-closed 测试已冻结；仅使用明确授权的合成/冻结 fixture 时可继续不接外部来源、不处理真实教师或学生数据。S2 结果必须止于 INTERNAL_CATALOG_ACTIVE。

首次外部 intake、真实候选处理或真实教师审核前：

- D-02、D-03、D-04、D-08、D-11、D-12、D-14 均已在对应来源、行为、角色和容量范围内 ADOPTED；若为自动 pull/定时/批量运行，D-15 还必须升级为该来源和频率的实际授权。D-14 单独不足以发起外部访问或下载。
- P1 对象被物理隔离为 `PRIVATE_CANDIDATE`，没有学生读模型、公开 URL、浏览器资产 URL 或 Lumi 上下文注入。
- 每个候选至少记录 curation source、可得显示来源、抓取日期、资产 hash 或 metadata-only 状态、实际处理通道与撤下状态；字段缺失记 UNKNOWN。
- 不存在把“候选已下载/已分析/草稿已批准”自动当成正式 Wiki release、学生展示、Lumi 引用、公开发布或 Lumi 所有权的例外。

P2 开发开始前：

- D-01、D-09 保持 ADOPTED，D-10 保持 ADOPTED_FOR_DESIGN_ONLY；D-16 已在精确 P2 开发范围内升级为 ADOPTED，或 D-18 已在该范围内 ADOPTED。仅有 D-16 的设计状态不能开始 S3–S9、migration、持久化、DB-backed Shadow 或 route 切换。
- P2 范围、Schema Pack、STUDENT_SEARCH/BROWSE_RELEASE、角色域 release decision、教师 Candidate Preview 与学生 Page Preview 两条互斥合同及待取证 Gate 已版本化。
- 只能使用合成、人工冻结或明确授权的测试对象与账户；不得因此启用学生可见路由或处理真实学生数据。

P2 BROWSE_RELEASE/STUDENT_SEARCH=ACTIVE 前：

- 所有 D-01 到 D-08、D-11、D-12 为 ADOPTED。
- G-01、G-02、G-03、G-06、G-07、G-08、G-10、G-11、G-12、G-13、G-14、G-15、G-16 的 P2 范围通过。
- 所有学生可见对象仅面向 D-01 批准的受众；任何缺失安全、保留、来源披露或严格出库审核决定的对象保持不可见，明确 DENY、过期/撤销或 HOLD 的对象不可见。
- 匿名访问的浏览、搜索、详情、画板、AI 引用卡、资产交付、sitemap、公开分享链接和图片直链负向测试通过。

P3 Shadow 实施与评测开始前：

- P2 的条件持续满足。
- D-09 保持 ADOPTED；D-16 已在精确 P3 Shadow 范围内升级为 ADOPTED，或 D-18 已覆盖该范围。仅有设计状态不能实现 S10、DB-backed Shadow 或 runtime/prompt/response 接线；6.1/6.4 的 allowlist、中文规范化、逻辑 schema、资格谓词、失败文案、冻结测试集和评测方法已版本化。
- STUDENT_SEARCH 已按 P2 独立验收；WIKI_RETRIEVAL 只能为 SHADOW。旧实现若保留 TEXT_RAG 字段，必须有版本化映射且不表示向量检索。WIKI_RETRIEVAL 结果不能进入模型上下文、学生回答、AI 引用卡或资产交付，G-03 未允许真实学生查询前只使用合成、人工冻结或明确授权的测试查询。

P3 WIKI_RETRIEVAL=ACTIVE 前：

- P3 Shadow 对照报告和关闭 Wiki 后课程回归报告已完成。
- G-04、G-05、G-07、G-08、G-09、G-10、G-11、G-12、G-13、G-14、G-15、G-16 的 P3 范围通过。
- 每条 Wiki 主张在回答前接受 ClaimSupportMap 和撤下状态复查。
- 课程引用与灵感案例卡保持不同 kind 和字段集合。

P4 VISUAL_RAG=SHADOW 实施与评测开始前：

- P3 的条件持续满足。
- D-10 已另行升级为实际 P4 授权；视觉 qrels、硬负例、实际 Provider/本地路线、预处理、许可行为、成本基线、相似性事实化风险和评测方法已版本化。
- 视觉旁路只返回当前获准候选 Page ID；不得创建或修改 Page、Revision、Compiled Truth、Timeline 或 Link。
- VISUAL_RAG 只能为 SHADOW；结果不能进入模型上下文、学生回答、AI 引用卡或资产交付，G-03 未允许真实学生查询/图片前只使用合成、人工冻结或明确授权的测试输入。

P4 VISUAL_RAG=ACTIVE 前：

- P4 视觉 Shadow 对照报告已相对 V1 无向量基线证明增益，关闭 VISUAL_RAG 后 Wiki/课程回归报告已完成。
- G-01、G-05、G-07、G-08、G-09、G-13、G-14 按视觉检索实际 Provider、本地处理、预处理、成本和权利范围重新通过。

P5 开始前：

- D-13 为 ADOPTED；未签核时不得创建任何匿名可用入口。
- 对新增受众重新通过受影响的 G-01、G-02、G-03、G-06、G-07、G-08。

## 4. 变更规则

改变受众、权利动作、数据保留、Schema Pack、Page/Link 类型、GBrain runtime/commit、编译器、Alias/Facet 词表、hop/edge 白名单、外部 Provider、模型、预处理、公开范围、检索状态或撤下策略时，必须新增台账版本并重新判定受影响 Gate。不得只改运行时开关、提示词或排序配置来绕过本台账。

本文件是规划辅助物，不授予素材处理、外部访问、生产部署或真实学生数据操作权限。
