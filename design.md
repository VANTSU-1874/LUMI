# Lumi Teacher Workbench Design System

Scope: `/teacher`, `/teacher/inspiration-wiki`, and the private ReviewPack workspace only. `/login`, authentication, student routes, and the public inspiration experience are deliberately excluded.

## A. Design principles

- Editorial workbench, not a generic dashboard: dense ruled information, clear hierarchy, and restrained decoration.
- Truth before activity: distinguish real classroom data, demonstration data, governance material, and teacher-ready ReviewPacks.
- Teacher judgment stays visible and reversible: preserve original system results and show the teacher decision beside them.
- Private by construction: student visibility, Current Page, R2, embedding, and Lumi retrieval remain visibly disabled throughout S2.
- Responsive by reflow: the desktop rail becomes a horizontal destination bar; the 62/38 review workspace becomes a single reading column.

## B. Visual system

- The current student workspace is the palette source of truth. Teacher surfaces consume the same shared `--lumi-workbench-*` tokens instead of maintaining a parallel approximation.
- Base: white and soft neutral surfaces; foreground and primary accent: near-black ink. Active navigation uses the same quiet grey as the student task rail.
- Neutral grey is reserved for readiness and attention; red is reserved for blocked rights or destructive rejection. No green accent remains in the teacher workspace.
- Chinese UI uses the existing Noto Sans SC stack; review titles use the existing Noto Serif SC stack; IDs and gate counts use the existing monospace stack.
- Corners are small (4–8px). Borders and rules create structure; shadows are almost absent.
- Motion is limited to 120–180ms color/transform feedback and respects reduced-motion preferences.

## C. Component patterns

- `TeacherAppShell`: full-height light neutral rail, compact mobile destination strip, and white work surface, matching the student workspace chrome.
- `MetricStrip`: actual values only; labels disclose whether counts are students, evidence, governance material, or ReviewPacks.
- `RuledPanel`: title rail, optional action, and dense table/list body.
- `ReadinessBoard`: two explicit teacher tracks: Strict ReviewPack `9/9` and Evidence Gap `x/9`; current counts and the private capability boundary remain visible together.
- `ReviewWorkbench`: inspectable controlled media at ~62% and teacher judgment at ~38%; Evidence Gap must show all nine states and use the same four evidence tabs as Strict ReviewPack. Only work-source match, source role, and rights evidence may read as confirmed unknown; normalized classification, artistic style, visual observations, duplicate analysis, curation, and teaching recommendations remain fully visible.
- `ReviewedQueue`: every reviewed item keeps its current status and exposes a compact “再次编辑” action. Re-submission appends a new review revision, prefills the latest judgment, and never overwrites the earlier audit record.
- Teacher-facing evidence copy is Chinese-only for prose, categories, roles, recommendations and safety conclusions. Stable source names, creator names, work titles and URLs may retain proper nouns for identification; raw evidence remains intact. A separate `zh-CN` display layer must replace any untranslated English sentence with a field-aware Chinese fallback instead of exposing it, without mutating ReviewPack material hashes.
- Empty state: state why no action is available and what condition will change it.

## D. Export conventions

- `data-ui` carries stable UI regions (`teacher-shell`, `review-pack-readiness`, `review-workbench`).
- `data-state` carries current navigation, readiness, and decision state; it is not a hidden publication flag.
- ReviewPack images must use controlled relative preview URLs. Remote artwork URLs are never rendered.
- Teacher final actions are restricted to `RETURN_TO_CODEX`, `REJECT_CANDIDATE`, and `ENTER_PRIVATE_WIKIDRAFT`. Evidence Gap labels the third action “进入私有草稿（保留缺口）”. `UNKNOWN` is a confirmed fact and needs neither acceptance nor a note; only unresolved `PRESENT_UNVERIFIED/MISSING/BLOCKED` gates require explicit acceptance. Return and rejection still require a reason, and no action implies publication or formal admission.

## E. D-19 private draft compilation

- `PRIVATE_WIKIDRAFT` and `PRIVATE_WIKIDRAFT_WITH_GAPS` are intake decisions, not editable Wiki entities. D-19 compiles accepted decisions into a separate private working-draft ledger with immutable revision history.
- The queue exposes seven editorial completion domains: title, visual summary, normalized classification, artistic style, curation, teaching, and controlled media. Every generated draft starts at `EDITING`, even when all seven fields are complete.
- The editor preserves source evidence and an explicit `UNKNOWN` rights status while allowing teachers to edit Chinese copy, classification, artistic style, recommendations, prompts, cautions, notes, and media order.
- `READY_FOR_DOMAIN_REVIEW` is a private handoff to curation, teaching, rights, and safety review. It does not create canonical Page, Revision, Compiled Truth, catalog admission, release, student visibility, R2, Embedding, or Lumi retrieval.

## D-20 教师私有教学域批量预复核

- `/teacher/inspiration-wiki/domain-reviews` 每页固定展示 12 件作品，卡片必须同时展示受控主图、规范化分类、艺术表现风格、教学价值、课堂问题和教学提醒；不让教师为普通通过项反复打开详情。
- 策展、权利、安全使用一次教师整批确认，但仍为每个作品生成独立的追加式决定；不能仅隐藏三域界面而留下未判断状态。权利仍只是 `UNKNOWN_PRIVATE_ONLY`，不推导再发布许可。
- 当前页可处理项支持一次全选，默认为“教学可用”；一次请求最多 12 项，每项仍使用独立 revision/state hash 和幂等键。
- “需要调整”必须至少选择教学目标、课堂问题或教学提醒中的一个结构化原因；“排除”必须填写说明。已通过、已调整和已排除项仍保留“再次编辑”入口。
- `/teacher/inspiration-wiki/domain-reviews/[reviewCaseId]` 作为异常项的单条教学复核页，不再显示可编辑的策展、权利、安全页签。桌面三列、平板两列、手机单列，320/375/414/768px 下均不得横向溢出。

## D-21 教师私有编译页

- `/teacher/inspiration-wiki/private-pages` 只展示四域全部通过后生成的教师私有页面目录；首屏必须同时说明私有页面、修订、真相快照与正式页面的真实数量。
- 页面卡使用受控媒体、中文分类和艺术风格作为主要扫描信息；严格审核来源与保留缺口来源可筛选，但不得把缺口隐藏或转写为已核验证据。
- 详情页用左侧受控图、右侧编纂正文的工作台结构，完整呈现视觉、教学、策展、来源、权利、安全与证据缺口，并显示不可变内容/真相哈希。
- UI 统一使用“私有页面、页面修订、真相快照、当前页面”等中文产品文案；作品名、作者名和来源品牌可保留原文，内部枚举与证据键不得直接暴露。
- D-21 不提供发布按钮。`PRIVATE_COMPILED_PREVIEW` 只代表教师私有编译完成，学生端、正式 Current Page、发布、对象存储、语义索引和 Lumi 引用继续关闭。

## D-23 发布准备审计

- `/teacher/inspiration-wiki/release-readiness` 是只读的激活前检查，不是发布控制台；页面必须显示真实可激活数、被阻断数、权利状态与八道发布门。
- 门状态只使用“已通过 / 阻断 / 未开始”，并解释正式权利、canonical 物料、撤下准备、受众策略、发布决定、Current Page 和通道激活之间的依赖。
- 权利为 `UNKNOWN_PRIVATE_ONLY` 时，项目固定为 `BLOCKED_FOR_FORMAL_RELEASE`；不得把私有目录准入或教师教学确认显示为学生展示许可。
- 页面没有发布按钮。浏览、学生搜索、R2、Embedding、Lumi 引用和正式 Release 继续关闭；逐项清单只链接回教师私有页面证据。

## D-24 学生通道 Shadow

- 学生灵感 Wiki 继续使用白色画布与 `ruler-carousel` 分类尺；搜索框是主扫描入口，不能因正式案例为 0 而消失。
- 搜索框聚焦态与当前对话输入框一致：白底、浅灰边框、3px 低对比外环和 14px 柔和阴影，180–220ms 过渡；不得改变控件尺寸或造成布局位移。
- Shadow 的 Browse、Search、Preview 和 Lumi context 都返回空集合；UI 可显示真实“0 个正式案例”，但不能把私有目录或资格试点渲染给学生。

## D-25 首批正式发布资格工作台

- `/teacher/inspiration-wiki/release-readiness` 顶层改为 D-25 试点资格台账；D-23 八门只读审计折叠保留，不能覆盖或伪装成新决定。
- 首批固定 5 个跨类别、0 证据缺口且有受控预览的私有目录项目；卡片展示作品、分类、艺术表现风格和五道门完成数。
- 五道门分别是学生正式展示权利、学生受众与预览策略、来源与署名披露、撤下与回滚准备、发布角色签核。权利通过必须绑定可核验依据，其余决定仍需说明范围。
- 教师只能记录“确认满足”或“保持阻断”；资格 5/5 只进入 canonical 物料构建候选，不在当前页面提供发布、激活或学生可见按钮。
- D-24 Browse/Search 继续为 Shadow。页面必须固定显示学生暴露为 0，并在桌面、平板和手机宽度下保持单列回流和无横向溢出。

## D-26 五条试点正式发布

- D-26 只消费 D-25 五道资格门全部满足、精确绑定 D-21 私有 Page revision 和受控媒体的试点；资格决定、Canonical Page、Revision、Release 与 Current Page 事件均为追加式记录。
- 用户权利声明以 `USER_RIGHTS_ATTESTATION:2026-08-13:D25-PILOT-5` 绑定五条试点，允许本地受控存储、必要缩略图、已登录学生展示和作者/来源署名，并保留随时撤下能力。
- 正式学生通道只开启 Browse、Search、Preview；页面继续使用白色画布、`ruler-carousel` 和对话输入框同源聚焦态。任何预览只解析本地受控资产，不回退到远程图片 URL。
- Current Page 使用追加式 `ACTIVATED` / `WITHDRAWN` 事件；每次变化生成精确活动集合快照。学生读取只有在活动集合、快照哈希和 Release 集合完全一致时才开放。
- 本次不消费更宽的公开传播、商业再许可、R2、Embedding 或 Lumi 引用授权；这些能力以及生产部署继续为 `DISABLED`，后续启用必须建立独立工件和验收。

## Wiki 站内多模态检索

- 学生端继续使用白色画布、`ruler-carousel` 与同源聚焦态；图片检索是搜索框旁的紧凑工具按钮，不建立第二套检索页面。
- 图片按钮必须具备明确图标、悬浮提示、选中态、可清除的文件名和无图时的稳定尺寸；仅接受 JPG、PNG、WebP，不展示远程图片 URL。
- 文字查询进入文字找图，图片查询进入图片找图，两者同时存在时进入图文组合排序；结果仍使用同一案例卡、受控预览、来源与署名披露。
- 索引不可用时保留原文字搜索，并用一行中文状态说明降级；不得用演示数据、未审核候选或远程图片替代。
- 该能力仅是已登录学生 Wiki 内的本地双通道检索；R2、外部 Embedding Provider、匿名访问和 Lumi 回答链继续关闭。
- 完整检索索引不进入公开源代码历史，随签名生产构建包作为受控侧车读取；客户端响应不返回向量、文件路径或内部存储定位符。
