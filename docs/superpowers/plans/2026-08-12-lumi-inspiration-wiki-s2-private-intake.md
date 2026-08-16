# Lumi 灵感 Wiki S2 私有候选持久化

日期：2026-08-12
状态：D-18 已授权并本地验收；200 个候选已全部完成教师判断，待审为 0；严格审核包 97 个私有草稿、1 个已拒绝，缺证候选 80 个保留缺口的私有草稿、22 个已拒绝；不含生产部署

## 授权边界

D-18 允许为已校验的 Hermes 候选新增独立数据库表、迁移、导入仓储和教师私有审核入口。候选只能停留在 `PRIVATE_CANDIDATE` 或后续受 S1 合同约束的 `WikiDraft`，数据库与接口必须保持 `studentVisible=false`。

本切片不实现或连接正式发布、Current Page、R2、Embedding、学生浏览/搜索、Lumi 引用和生产部署，也不调用旧 `inspiration_admissions` 或旧教师发布决定服务。

## 首批事实

- 批次：`hermes-2026-08-11-kanban-bulk-008`
- legacy v1 候选：200；失败记录：35；包摘要：`747713bc081b1170a949ef8f4566467342dea5161449dcddc869a3ffa96cdec2`
- 所有候选为 `PENDING_REVIEW`，本地资产为 0；授权字段全部未知。
- v1 不具备 S1 v2 要求的来源 taxonomy/raw terms、媒体角色/尺寸/时长、work modality 和严格动态证据，不能自动伪装成 v2 canonical material。

## 实施步骤

1. 复用 legacy v1 严格验真规则，对目录结构、secret guard、schema、数量、文件摘要、package digest 和资产引用做 DB 写入前校验。
2. 新增独立 `inspiration_wiki_hermes_*` 表，保存不可变批次和候选原始 material；硬约束学生、Current Page、R2、Embedding、Lumi 通道全部关闭。
3. v1 候选统一标记 `V1_UPGRADE_REQUIRED`，保留 null 和来源事实；它们只作为只读治理材料，不产生教师逐条 triage 任务。
4. 新增教师鉴权的治理材料只读索引与严格 ReviewPack 空队列；响应不返回工作区路径、Cookie、凭证或内部资产 locator，也不直接渲染未受控远程媒体。
5. 在本地隔离 SQLite 执行 migration/import，输出表计数、状态分布、通道关闭断言和零 admission 写入的验收报告。

## 验收标准

- 篡改文件、摘要不符、包内秘密、非法 URL、跨批 candidate、重复 ID/fingerprint 均在事务前失败。
- 相同 package digest 重导幂等；同 batchId 不同 digest 冲突失败。
- 200 条候选仅进入独立私有表，`student_visible=0` 且所有发布/检索/引用能力为 `DISABLED`。
- legacy v1 全部保持 `V1_UPGRADE_REQUIRED`；缺失描述、许可、角色和动态证据不被补写。
- 教师 API 对未登录/学生身份失败关闭；triage 使用 revision 与 idempotency key 防止并发覆盖。
- 本次导入前后旧 admission 表行数不变；没有创建 Page、Revision、Compiled Truth 或 release。

## 本地验收结果

- `hermes-2026-08-11-kanban-bulk-008` 已严格校验并导入本地隔离 SQLite；200 条候选、35 条失败审计与 package digest 均匹配。
- 精确重导返回幂等结果；`inspiration_admissions`、正式 draft/revision 与旧候选表均保持 0 行。
- 200/200 均为 `PRIVATE_CANDIDATE`、`PENDING_REVIEW`、`V1_UPGRADE_REQUIRED`，学生可见性关闭，Current Page、R2、Embedding 与 Lumi Retrieval 全部为 `DISABLED`。
- 教师 API 将 200 条 v1 候选继续保留为治理材料；其中 98 个候选已补齐九项严格证据并作为独立 ReviewPack 进入真实教师流程，累计为 98/200；当前 22 条待审、76 条已进入私有 WikiDraft，其他 102 条仍不冒充审核任务。
- 内容治理没有被本次技术验收替代：200/200 许可仍未知，22 条跨批重叠仍待项目级处置，分类、作者角色、动态证据和 v2 规范化仍待审核。

## 2026-08-12 教师端整体重构修订

### 信息架构

- `/teacher` 改为全高“左侧导航 + 右侧工作区”，目的地固定为课堂总览、学生与班级、判断复核、灵感 Wiki、证据与隐私。
- `/teacher/inspiration-wiki` 是独立教师私有工作区；课堂总览只显示来自严格队列 API 的准确准备度，不再嵌入原始候选列表。
- `/teacher/inspiration-wiki/review/[reviewPackId]` 是单作品审核工作区；真实库没有 ReviewPack，因此真实详情请求失败关闭，严格 fixture 只用于 UI 与状态机测试。

### ReviewPack 合同与状态机

只有以下九项全部齐备，候选才从 `PACKAGING` 进入 `READY_FOR_TEACHER_REVIEW`：受控图/图组、作品与原始来源匹配、来源角色、权利证据、规范化分类、视觉描述、重复关系、策展建议、教学建议。

教师审核覆盖作品匹配、分类与描述、策展价值、教学价值、权利与安全、重复关系六个结论；最终动作只有 `RETURN_TO_CODEX`、`REJECT_CANDIDATE`、`ENTER_PRIVATE_WIKIDRAFT`。进入私有 WikiDraft 仍保持学生不可见、Current Page/R2/Embedding/Lumi Retrieval 全部禁用。

### 来源角色

- Pinterest 只能作为发现入口。
- Behance/Notefolio 可作为作者作品页证据，但不代表再发布许可。
- Recent.design、BP&O、Typographic Posters 是策展索引，必须同时保留策展来源与原始创作者关系；Hesign 按具体页面判定，官方 `/works` 项目页可作为工作室作品页，策展项目仍须拆分策展人与视觉设计职责。

### 准确状态

Hermes v1 共 200 条治理材料。23 个实际批次共 98 个项目已完成九项严格审核包；当前数据库中 97 条为 `PRIVATE_WIKIDRAFT`、1 条为 `REJECTED`。其余 102 条已取得本地受控媒体，并完成规范化分类、视觉描述、重复关系、策展与教学建议；作品与原始来源匹配、来源角色、权利证据精确保留为 `UNKNOWN`，其中 98 条待审、3 条为保留缺口的私有草稿、1 条已拒绝。

### 2026-08-12 并发批次 004—006

- 第四批 Typographic Posters：6 条、12 张受控图；丢弃与像素证据冲突的 `Weingart Typografie` Hermes 描述，保留逐图观察。共享展览照片仍只允许作为跨作品 `CONTEXT`，本批未选用。
- 第五批 BP&O：4 条、16 张受控图；文章作者与设计者分开记录，排除 Portal 广告；Next Steps 的旧 pilot 重复折叠到当前 bulk Candidate。
- 第六批 Hesign：4 条、12 张受控图；按具体官方作品页记录工作室职责，隔离尺寸衍生重复和孤立低清图。
- 三批共新增 14 个严格 ReviewPack、40 张受控图；逐条复制和再发布权利仍保持 `UNKNOWN`，不得据此开启学生或发布通道。

### 2026-08-12 并发批次 007—009

- 第七批 Typographic Posters：6 条、11 张受控图；共享展览图涉及的两个项目继续延后，排除冲突图和非必要人物场景。
- 第八批 BP&O：5 条、18 张受控图；排除 Portal 广告、成人/儿童和非必要人物图，折叠 Ancestrel 的旧治理重复，Windham Campbell 只保留同组高分辨率版本。
- 第九批 Hesign：5 条、15 张受控图；每条按具体官方页面核对职责，媒体均保留同尺寸族最大版本，并维持权利决定 `UNKNOWN`。
- 三批共新增 16 个严格 ReviewPack、44 张受控图；全新数据库顺序重放第一至第九批后总数精确为 40，未出现跨批 Candidate 或 ReviewPack 冲突。

### 2026-08-12 Hermes 资产补充包

- 补充包覆盖剩余 197 条候选：192 条取得本地媒体，5 条保留失败；原始包共 1,068 张图片，package digest 为 `4cde4699bd3660d1836f011d3e6ae2fc35da28ee6f625d816aa556696eaa4adf`。
- 原始包保持不可变。Codex 派生层隔离 117 张 Hesign 低分辨率重复图和 5 张 BP&O 站内广告；两张跨作品共用展览图只能作为共享 `CONTEXT` 证据。派生可继续处理集合为 192 条、946 张图片。
- Notefolio 不再按来源整体暂停；用户声明已取得转存授权，但在授权主体、范围、日期和可核验记录绑定到逐条权利证据前，仍不得把口头确认写成 `CREATOR_PERMISSION` 或自动计入严格 ReviewPack。

### 2026-08-12 批次 010—024 与最终封口

- 第 010—012 批新增 16 个严格 ReviewPack；第 013—015 批新增 14 个；第 016—018 批新增 7 个；第 019—022 与第 024 批新增 21 个。第 023 批已取消且无工件、无数据库写入。
- 23 个实际包共包含 98 个唯一候选和 271 张受控资产：BP&O 46 条、Hesign 22 条、Typographic Posters 30 条；缺失资产、闲置包内资产、跨包 Candidate/ReviewPack 重复和能力边界违规均为 0。
- 全新 SQLite 先导入 200 条治理候选，再顺序重放全部 23 个包，最终精确得到 98 个 `READY_FOR_TEACHER_REVIEW`；实际数据库新增批次精确复导均为幂等。
- 实际数据库最终只读审计为 98 个 ReviewPack、22 个待审、76 个私有 WikiDraft、76 个教师决定；Candidate/ReviewPack 学生暴露违规为 0，旧 `inspiration_admissions` 为 0。
- 剩余 102 条治理材料按来源精确封口：BP&O 28、Hesign 8、Typographic Posters 15、Notefolio 51。它们已进入独立 Evidence Gap 教师判断轨，逐门保留缺失或未核验状态；Notefolio 51/51 均有本地封面，但可核验授权材料覆盖仍为 0/51。
- 所有 129 条权利证据的正式再发布决定均为 `UNKNOWN`；站点条款对私有审核的 `ALLOW` 不得提升为包级再发布许可。

### 2026-08-12 Evidence Gap 媒体补正

- 102 个 Evidence Gap 包全部进入教师私有判断轨；其中原 97 个有图，5 个 Notefolio 封面因 CDN 返回通用 `octet-stream` 响应头而被旧抓取器误判为格式失败。
- 5 个作品页公开声明的封面在无 Cookie 条件下重新取得；补正仅接受同一 HTTPS CDN 主机的安全重定向，并以 JPEG/WebP 魔数、完整解码、尺寸、字节数与 SHA-256 联合验真。
- 5 个包由 revision 1 升至 revision 2，受控媒体仍标记 `UNVERIFIED`、`role=null`、`alt=null`；只把受控媒体门从 `MISSING` 改为 `PRESENT_UNVERIFIED`，不改变其余证据门、权利结论或能力边界。
- 当前数据库精确为 98 个严格 ReviewPack + 102 个 Evidence Gap，候选交集为 0；Evidence Gap 本地媒体覆盖 102/102、无图 0、媒体补正审计 5 条，学生可见、Current Page、R2、Embedding 与 Lumi Retrieval 违规均为 0。

### 2026-08-12 已审核再次编辑与教师端汉化

- Strict ReviewPack 与 Evidence Gap 的已审核队列均提供“再次编辑”；详情读取当前审核 revision 并预填上次判断、说明及已接受缺口。
- 再次提交复用 revision CAS 与幂等保护，向既有 append-only decision 表追加新决定；`previous_stage` 记录上次结果，旧决定不更新、不删除，当前 pack 只投影最新 stage。
- 教师端新增独立 `zh-CN` 显示层，先覆盖 HotDog 全部四个证据页签，并把来源角色、推荐、安全、权利和重复关系枚举统一显示为中文；原始 ReviewPack、来源 URL、署名、material hash 与能力边界均不改写。

### 2026-08-12 缺证候选六项分析 / 三项未知

- 102/102 个缺证候选使用已校验的本地受控图进行逐图分析；规范化分类、视觉描述、重复关系、策展建议、教学建议和受控图组共六项完成。
- 作品与原始来源匹配、来源角色、权利证据三项均保留为 `UNKNOWN`；没有把 Hermes 原始元数据、页面入口或用户口头授权改写为已核验事实。
- 102 条分析以 revision CAS、material hash 与 append-only audit 写入，当前仍全部为 `READY_FOR_TEACHER_TRIAGE`，旧的教师决定数为 0，不存在被覆盖的人工结论。
- 当前教师待判共 98 条，均为“6 项已分析 + 3 项未知”的缺证候选；98 个严格审核包已全部处理。学生可见、正式页面、对象存储、向量索引、Lumi 引用和生产部署继续全部关闭。

### 2026-08-12 已确认未知与艺术表现风格

- 三项 `UNKNOWN` 的产品语义改为“已确认为未知”；它们不再进入 `acceptedGapKeys`，教师可在不勾选、不填说明的情况下进入保留缺口的私有草稿。
- `RETURN_TO_CODEX` 和 `REJECT_CANDIDATE` 仍由合同、服务和数据库三层强制填写 1–300 字理由；普通的 `PRESENT_UNVERIFIED/MISSING/BLOCKED` 门仍须逐门接受。
- 视觉分析新增独立“艺术表现风格”结构，使用 18 类受控风格词表与兜底类；102/102 条均写入 1–2 个风格标签及与封面可见元素绑定的中文依据。
- 第二轮分析追加 102 条 immutable audit，累计 204 条分析修订；当前已有 4 条缺证教师决定，能力边界违规为 0。

### 2026-08-12 教师端全量汉化

- 98 个严格审核包的说明、分类、来源角色、权利、策展、教学与安全字段统一经过 `zh-CN` 展示层；未命中逐项译文时使用字段相关的中文摘要，不再把英文原句直接回退到教师界面。
- Kanal 项目使用逐字段精确中文文案；23 个导入批次均纳入自动本地化审计，原始 ReviewPack、URL、媒体哈希与 material hash 保持不变。
- Hermes 只读治理索引使用中文类别摘要代替外文标题和署名正文；队列中的英文角色枚举统一转换为中文。

### 2026-08-12 缺证详情与严格审核信息对齐

- 缺证详情不再使用压缩的“当前可见材料”列表，改为与严格审核一致的“作品与来源 / 策展与教学 / 权利与安全 / 重复关系”四个证据标签页。
- 作品与原始来源匹配、来源角色、权利证据继续显示各自的真实状态；当前 102 条均为“已确认：未知”，不需要教师再次勾选或填写说明。
- 规范化分类、艺术表现风格、视觉描述与逐条画面观察、重复关系、策展建议、教学建议、课堂提问和教学提醒全部展开供教师判断，不因处于 Evidence Gap 轨而降级或隐藏。

### 2026-08-12 教师退回三条视觉补充

- 对 `200 years Bodoni`、`morphee` 与 `Ellis Butchers` 三条教师退回项重新核对受控图，按教师说明修正视觉描述、艺术表现风格、策展建议和教学建议。
- 补充写入采用当前 revision/material hash 的 CAS，保留原教师决定、说明和旧物料快照，并向追加式分析审计新增 3 条 revision；不直接覆盖或删除历史判断。
- 三条分别升至 revision 5、6、5，重新进入 `READY_FOR_TEACHER_TRIAGE`；作品与原始来源匹配、来源角色、权利证据继续为 `UNKNOWN`，其余六项保持已分析。
- 最终精确分布：严格审核包 97 个私有草稿、1 个已拒绝；Evidence Gap 80 个保留缺口的私有草稿、22 个已拒绝、待审为 0。学生、发布、Current Page、R2、Embedding 与 Lumi 引用违规为 0。

### 2026-08-12 教师端配色与学生端对齐

- 当前学生工作台实际使用的白色、浅灰、近黑与危险红被提升为共享 `--lumi-workbench-*` 语义 token；学生端改为引用这些 token，计算后颜色不变。
- 教师端 `tokens.css` 直接消费同一组共享 token，左侧导航由深绿色改为学生端同款浅灰工作台轨道，主操作与选中态改为近黑；危险/拒绝仍使用独立红色。
- 教师端既有信息架构、ReviewPack 状态机、三项最终动作、认证流程与学生/发布能力边界均不改变。

### 2026-08-12 D-19 私有 WikiDraft 编纂

- 97 条严格审核通过项与 80 条保留缺口通过项被编译为 177 条独立私有工作草稿；23 条拒绝项没有进入草稿层。
- 每条草稿绑定原 ReviewPack、教师决定与对应 revision，保存内容 hash，并从 revision 1 开始写入 append-only 编纂历史；重复编译按来源决定幂等。
- 草稿七项编纂域为标题、视觉摘要、规范化分类、艺术表现风格、策展建议、教学建议和受控媒体；177/177 初始物料均为 7/7，但仍停留在 `EDITING`，由教师确认后才能送入分域复核。
- 教师工作台新增私有草稿队列、搜索/阶段/来源/分类筛选、批量送审和单条编辑器；支持中文内容修订、艺术风格依据、课堂问题/提醒、图片顺序与重新打开编辑，所有变更追加 revision。
- 权利状态 177/177 保持 `UNKNOWN`；学生可见、Current Page、R2、Embedding、Lumi Retrieval 全部关闭。原 S1 canonical draft revision、分域决定和内部目录表继续为 0。

### 2026-08-13 D-20 教师私有教学域批量预复核

- 177 条私有草稿保留四域独立审计，但根据教师对本批的明确确认，策展、权利、安全不再逐条点击；系统对尚未判断的 174 条生成 522 条追加式通过决定，不覆盖原有 3 条完成项。
- 最终准确状态：非教学三域 531/531 已确认；教学域 177/177 已通过，四域累计 708 条当前决定；177 条任务全部为 `DOMAIN_REVIEW_COMPLETE`，无调整、排除或待处理项。权利依然是 `UNKNOWN_PRIVATE_ONLY`，不表示再发布获准。
- 教学队列每页 12 条，支持当前页全选和混合提交“教学可用 / 需要调整 / 排除”；调整使用结构化原因，排除继续强制说明。已审核项保留再次编辑。
- 批量提交一次最多 12 条，每条继续使用 revision/state hash、幂等键与 CAS；任何冲突在事务中失败关闭。
- D-20 仍使用独立私有表和合同；正式 canonical draft revision、domain review decision 与 internal catalog 保持 0。学生可见、Current Page、R2、Embedding、Lumi Retrieval 与 canonical compilation 全部关闭。

### 2026-08-13 D-21 教师私有 Page / Revision / 编译真相快照

- 只消费 177 条 `DOMAIN_REVIEW_COMPLETE` 且四域当前状态均为 `APPROVED` 的 D-20 任务；每条编译前重新核对工作草稿 revision/content hash、复核任务 revision/state hash 与四个当前决定 ID。
- 新增独立的 `inspiration_wiki_private_pages`、`inspiration_wiki_private_page_revisions`、`inspiration_wiki_private_compiled_truths`，不写正式 S1 的 draft revision、domain review decision 或 internal catalog 表。
- 私有 Page 使用稳定候选身份；Revision 与 Truth 为追加式不可变记录。相同输入重放幂等，源草稿或审核状态变化时只新增修订并更新“最新私有修订”，不创建正式 Current Page 指针。
- 177/177 已生成私有 Page、Revision 与 `PRIVATE_COMPILED_PREVIEW`；97 条来自严格审核轨，80 条保留证据缺口，权利 177/177 继续为 `UNKNOWN_PRIVATE_ONLY`。
- 教师端新增私有编纂页目录与详情，可查看受控图、中文分类/艺术风格、视觉观察、策展、教学、来源、权利、安全、缺口及哈希绑定；没有发布或学生通道动作。
- 正式页面 0、正式 S1 三表 0；学生可见、canonical compilation、Current Page、正式发布、R2、Embedding 与 Lumi Retrieval 全部关闭。

### 2026-08-13 D-22 角色治理与教师私有内部目录

- 177 个 D-21 私有页面以精确 Page revision、compiled truth、草稿/复核哈希和 708 条当前人工决定为输入，完成私有内部目录准入。
- 使用版本化单教师显式角色策略：同一真实教师账号分别承担策展、教学、权利、安全四个明确角色；系统不伪造多人身份，也不把私有预复核冒充 canonical S1 角色决定。
- 新增 177 个治理任务、708 条追加式域决定和 177 条教师私有目录记录；相同输入重放全部幂等，不重复写入。
- 权利 177/177 保持 `UNKNOWN_PRIVATE_ONLY`；该状态只允许私有编纂和内部教学治理，不代表复制、展示或正式再发布许可。
- 教师端新增 `/teacher/inspiration-wiki/private-catalog`，展示来源轨、证据缺口、中文分类、艺术表现风格和精确私有修订绑定；页面没有发布动作。
- 正式 canonical draft、domain decision、旧 internal catalog 与 admission 均保持 0；学生可见、canonical compilation、Current Page、正式发布、R2、Embedding 与 Lumi Retrieval 全部关闭。

### 2026-08-13 D-23 正式发布准备只读审计

- 对 177 个 D-22 私有目录项目逐项核对私有目录绑定、正式展示权利、canonical 物料、撤下准备、受众策略、发布决定、Current Page 和通道激活八道门。
- 实际结果为 0 条可激活、177 条被阻断；私有目录绑定门通过，正式展示权利门因 177/177 为 `UNKNOWN_PRIVATE_ONLY` 而阻断，其余七门保持未开始。
- 生成固定审计工件 `data/inspiration-wiki/release-readiness/d23-release-readiness-audit.json`，包含 177 个唯一页面和逐项门状态；不写数据库、不新增 migration。
- 教师端新增 `/teacher/inspiration-wiki/release-readiness`，展示真实总览、八门说明与逐项阻断清单；没有发布、激活或学生可见动作。
- 正式 canonical draft、domain decision、旧 internal catalog 与 admission 继续为 0；Current Page、正式 Release、浏览、学生搜索、R2、Embedding 与 Lumi Retrieval 全部关闭。

### 2026-08-13 D-24 P2 学生通道 Shadow

- 只创建不对学生出数的 Browse/Search Shadow 快照，用真实 177 条私有目录验证学生通道的零暴露边界。
- 正式发布合格为 0，Browse、Search、Preview 与 Lumi context 暴露集合均为空；学生 admission 保持 0。
- D-24 不创建正式 Release、Current Page、R2、Embedding 或 Lumi Retrieval；从 Shadow 升为 Active 需要另行授权。

### 2026-08-13 D-25 首批正式发布资格补齐

- 从受控媒体完整、证据缺口为 0 的 D-22 私有目录中确定性选择 5 个跨类别试点，并绑定精确 Page revision 与 64 位内容摘要。
- 每个试点独立审核学生正式展示权利、学生受众与预览策略、来源与署名披露、撤下与回滚准备、发布角色签核五道门。
- 学生正式展示权利只有绑定可核验依据才能标记为满足；决定按门追加 revision，具备幂等键和不可更新、不可删除的数据库审计约束。
- 5 个试点当前均为 `QUALIFICATION_IN_PROGRESS`，资格完成 0；D-24 Browse/Search 继续为 Shadow，学生 admission 与能力边界违规均为 0。
- D-25 只产生正式发布资格任务，不创建 canonical Release、Current Page，不开放学生浏览、搜索、R2、Embedding、Lumi Retrieval 或生产部署。

### 2026-08-13 D-26 五条试点正式发布

- 用户补充声明其有权授予 D-25 五条试点的学生展示许可；声明以稳定证据引用绑定到每条学生正式展示权利资格决定，五条均完成 5/5 资格门。
- 每条试点新增稳定 Canonical Page、不可变 Page Revision、正式 Release 与 `ACTIVATED` Current Page 事件，并绑定 D-21 精确 revision/content hash、五个资格决定和受控媒体 SHA-256。
- P2 Active 快照按当前五条活动 Release 的精确集合生成；已登录学生 Browse、Search、Preview 返回五条正式案例，旧 `inspiration_admissions` 继续为 0。
- 撤下通过追加 `WITHDRAWN` Current Page 事件完成，不更新或删除 Release；读取端只接受与最新事件集合及哈希完全一致的活动快照。
- 本次实际开启仅为本地受控媒体、已登录学生 Browse/Search/Preview 和来源署名。R2、Embedding、Lumi Retrieval、生产部署及匿名公开通道继续关闭。
