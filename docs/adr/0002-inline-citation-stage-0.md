# 内联引用 Stage 0：只开放 manifest/viewer-bound 候选

## Status

Accepted as a Stage 0 contract only.

## Context

模型生成的 claim、citation 和展示文案都不具备来源授权。若公开 raw schema 或未绑定解析器，调用方可绕过 manifest、viewer 与来源范围校验；若只检查显式 URL/路径字段，`title`、`label`、`excerpt` 或 Markdown claim 又会成为第二 locator 通道。

单点正则无法给出稳定边界：嵌套 Markdown label/目标、递归 character reference、双层 percent encoding、Unicode 兼容分隔符和紧贴 CJK 的 scheme 都能改变后续 token 结构；反过来，把 `。` 或单字母冒号一律视作 locator，又会误拒“你好。世界”“目标。方法。结果”和“方案A:先观察”。因此展示字段必须先经过有界、无副作用的扫描规范化，再进入结构性 tokenizer，而不是继续累加样例正则。

## Decision

- `lib/agent/inline-citation-contract.ts` 只有一个运行时导出：`parseManifestBoundInlineCitationCandidateSet`。manifest、raw candidate、claim、citation 和中间 schema 均为模块私有；导出的只读 TypeScript 类型不会形成运行时旁路。
- 唯一入口同时解析不可信 candidate set、受信 manifest 与当前 viewer，并绑定 manifest ID/revision/digest、viewer、source、display、block、range、excerpt 与结构化 locator。输出的 set、claim、citation 每层都带 `STAGE_0_CANDIDATE` 和 `DO_NOT_RENDER`，并递归冻结。
- 来源保持 `MARKDOWN`、`FILE`、`WEB` 三分支。Markdown 只接受 manifest 的 `documentId`，文件只接受 `fileId`；网页必须是公开 HTTPS，origin 不得带 path/query/fragment。page URL 先把 percent hex 统一为大写，并把 percent-encoded ASCII unreserved 字符解码，因此 `%7e`、`%7E` 与 `~` 等价；其余 reserved escape 保持编码，再与同源 manifest 页面精确比较。
- claim 保留多段 Markdown；claim 与 excerpt 的 CRLF/CR 在解析时统一为 LF，绑定在规范化值上精确比较。所有可展示字符串——manifest 与 candidate 的 title/label/excerpt，以及 claim——复用 `inline-citation-locator-guard.ts`；该内部 guard 不导出 candidate/schema/授权入口，契约模块仍只有唯一运行时入口。
- guard 最多执行三轮扫描规范化：使用固定版本的 `decode-named-character-reference` 表解析 CommonMark named reference，同时线性解析合法数字 reference；逐字符收集连续 `%HH` byte run，并要求每个 run 都是合法 UTF-8。任一轮出现无效 UTF-8，或 `%` 后呈现 ASCII 字母/数字转义意图却不足一个合法 byte，都会立即失败关闭，不把整段原样退回为安全文本；字面百分号仅在后文不呈现该转义意图时保留，如“50% 标记”“50%且完成”。之后再执行 NFKC、移除 `Default_Ignorable_Code_Point` 并折叠 slash lookalike；若第四轮仍会改变文本也失败关闭。规范化副本只用于判定且不写回公开结果；除上一条明定的换行规范化外，接受时展示文字保持调用方原文。`a%2F%FFb`、`file%2E%FFpsd`、`a%252F%25FFb`、`a%EF%BC%8Fb` 与双层 `&amp;...;` 均无法绕过 tokenizer。
- Markdown 检测使用转义感知的单次 bracket stack 与预计算 whitespace index，而非 link regex：matched label 后的 `(`/`[` destination opener 即失败关闭，因此目标内部任意括号深度不影响判定；同一扫描覆盖嵌套 link/image、reference link、单行/多行 reference definition 与 wiki link，HTML `href/src` 作为独立简单 token 检查。
- 冒号 tokenizer 先向左提取 ASCII scheme/单盘符，再要求字符串/词法边界，或紧邻“访问/打开/从/读取/open/from”等明确 cue（cue 与 token 间只允许空白或引号/冒号/括号）。因此 `C:课程`、`请打开C:课程`、`请从vscode:workspace打开` 被拒绝，而“方案A:先观察”和“练习A:明暗层级”保留。
- ASCII `.` 默认按 locator 分隔符处理；夹在 token 字符间的任意连续 `[.。]` 组合也失败关闭。只有单点两侧都是数字，且 ASCII 前缀/后缀满足版本、编号或已知设计单位规则时才放行。因此 `file。。psd`、`file．。psd`、`file。．psd` 和 `file..psd` 被拒绝，而 `v1.2`、`3.5mm`、`图1.2` 和 `1.2.3` 保留。
- U+3002 token 不查 TLD 表，而按 label 脚本族与上下文判定：ASCII/其他脚本、label 内混合日/韩脚本、label 间 Han/日文/韩文脚本族变化、`www` 或明确 cue 均失败关闭；同一 Han、日文或韩文脚本族且无 cue 的 prose 保留。因此“例子内容。한국주소”“デザイン例。한국주소”“请访问：例子网站。中国域名”被拒绝，而“你好。世界”“光。影”“目标。方法。结果”以及裸“例子。中国”保留。
- 任意斜线或反斜线式分隔符在展示字段中都失败关闭。`A/B` 与 `a/b` 无法在无外部语义的安全边界内可靠区分；需要表达比较、任选或比例时，应改写为“A 与 B”“A 或 B”或自然语言比例，把真实 locator 留在结构化 manifest 分支。
- 唯一入口把所有预期拒绝统一为 `INLINE_CITATION_STAGE_0_REJECTED`；稳定 `reason` 区分 `INVALID_INPUT` 与各类未授权绑定。Zod custom message 只用于模块内部校验，不作为外部错误输出。

## False-positive / false-negative trade-off

- 有意偏向误报：slash 写法、email、dotfile、结构性 Markdown link/reference、连续点号、颜色资源名、跨脚本 `标签。标签`、ASCII 紧贴在 `%` 后的畸形转义式文字，以及超过三轮仍可解码的普通实体文本可能被拒绝。这些文本可无损改写（百分号后加空格或改用自然语言），而把无效 byte run 原样放行或允许无限解码都会破坏可证明的边界。
- 有意保留普通教学文本：无 locator 分隔符的多语自然语言、普通中文句号、Markdown 段落/列表、`v1.2`、`3.5mm`、紧凑编号、纯数字版本和 `#FFFFFF` 色值可通过。数字点号豁免不覆盖 `3.5psd` 或带任意 ASCII 前缀的点分 token。
- 无法仅凭文本证明裸的同脚本族 CJK `label。label` 是 host 还是 prose；Stage 0 选择保留 prose，承认无 `www`、无结构化链接、无跨脚本且无 cue 的同族 CJK host 存在漏报窗口。网页结构化字段仍按 HTTPS origin/page 绑定，后续收紧必须版本化评审，不能增加调用点旁路。

## Stage 0 boundary

本 ADR 和本轮代码没有接入 Agent runtime、数据库、SSE、API route 或 UI，没有迁移或渲染组件，也没有 manifest 签发、存储、防重放或端到端身份认证。Stage 0 只证明一个候选通过了本地结构与授权绑定检查；`DO_NOT_RENDER` 仍是硬约束，不能声称产品已支持内联引用。

## Consequences

- 旧 revision 只能授权自身 viewer、来源和 block 集合；新增来源或任何 display/locator/range/excerpt 漂移都会失败关闭。
- 展示字段没有第二 locator 通道，raw schema 也不能被外部直接执行。
- 后续 runtime、DB 或 UI 集成必须单独设计信任链、版本迁移与渲染安全，并重新评审此边界。
