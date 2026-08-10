# Lumi 检索质量评测

这套评测把“有没有找对知识和图片”与最终导师回答评分分开。它不调用数据库或模型，T0 基线只读取：

- `data/knowledge/*.md`
- `data/courses/**/*.md`
- `data/manifests/course-png-sha256.v1.json`
- `tests/retrieval-quality/golden-suite.json`

## 运行

```powershell
$env:pnpm_config_verify_deps_before_run = "false"
corepack pnpm course-assets:verify
corepack pnpm retrieval:quality
```

默认报告写入：

```text
.runtime/retrieval-quality/t0-caption-lexical-baseline.json
```

命令会在 stderr 打印知识、课程、资产清单和 suite 的真实来源，并明确标记 `database=NOT_USED`。

## 模式

- `TEXT_TO_TEXT`：自然语言问题检索知识节点。
- `TEXT_TO_IMAGE`：自然语言描述检索图片；T0 把每张图确定性绑定到对应小节说明后，直接对 156 个资产说明逐图排序。150 张海报标注图按 `layout/type/color` 精确绑定三级小节，6 张网格案例图使用文档级说明，不把它们伪装成六步截图。
- `IMAGE_TO_IMAGE`：图片检索相似或同案例图片。
- `IMAGE_TEXT_TO_EVIDENCE`：图片和问题共同检索节点、资产和父级证据。
- `NEGATIVE`：无答案或跨课程干扰。

没有视觉索引时，带图片输入的模式必须返回 `UNSUPPORTED`，不得丢掉图片后伪装成完整成功，也不得把它们计为 Recall 0。

## 指标

- `Recall@1/3/5` 只对 `required=true` 的目标计算。
- `MRR` 取首个相关结果的倒数排名。
- `nDCG@5` 使用 1–3 级相关度。
- `Precision@5` 固定以 5 为分母；节点与资产分别汇总。
- 负例单独计算 `negativePassRate`。
- 父级证据计算 `parentCoverage`；图文组合用节点、资产和父级全部满足的 `combinedEvidencePassRate`。
- 超时、错误和降级成功率分别统计，不把超时混进一般错误。
- 延迟用 nearest-rank 的 `p50/p95`，不包含 suite、语料和索引的启动加载时间。

`query.coursePackId` 是检索器唯一可见的课程上下文；`expectedSourceCoursePackId` 和 `expectedLegacyPlacementCoursePackId` 只用于打分与审计，不得进入检索输入。负例的期望来源必须为 `null`。

## T0 冻结基线

Suite：`2026-07-28.4`，51 条；suite SHA-256：

```text
69f7a0b39c0b7a3417338cbcd4a6da702f0c76bc134e542e845ab3c3b401517b
```

| 模式 | 样本（可回答/负例） | Evaluated | Unsupported | Exact-role Recall@5 | Group Recall@5 | MRR | nDCG@5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TEXT_TO_TEXT | 5（5/0） | 5 | 0 | 0.4000 | — | 0.4000 | 0.4000 |
| TEXT_TO_IMAGE | 24（24/0） | 24 | 0 | 0.2917（7/24） | 0.4583（11/24） | 0.3243 | 0.2288 |
| IMAGE_TO_IMAGE | 7（6/1） | 0 | 7 | — | — | — | — |
| IMAGE_TEXT_TO_EVIDENCE | 7（6/1） | 0 | 7 | — | — | — | — |
| NEGATIVE | 8（0/8） | 8 | 0 | — | — | — | — |

冻结集含 5 条文本正例、36 条可回答视觉正例和 10 条自然负例。36 条视觉正例由
24 条 text→image（18 个独立 poster group + 6 张 raw grid）、6 条跨海报
image→image、6 条 image+text→evidence 组成；另有 2 条图片输入负例，因此
caption 基线共将 14 条图片输入明确报为 `UNSUPPORTED`。

总体 `attempted=51`、`evaluated=37`、`unsupported=14`、`errors=0`，
`Precision@5=0.144828`、父级覆盖率 `0.5000`、禁止目标命中为 `0`。8 条纯文本
负例在词法基线下均返回了结果，故已评测负例通过率为 `0`；这是如实冻结的基线，
不是为获得更好数字而改题。Group Recall@5 将同一海报的 layout/type/color
视为一个相关组，6 张 raw grid 各自是单例组。

基线同时冻结并在每次运行前核验：

- corpus anchor commit 以及 `data/knowledge`、`data/courses` 的 Git tree；
- 116 条知识 Markdown、转换报告和 82 份课程源文的规范 LF 摘要；
- PNG manifest 的原始字节摘要、156 张实际图片的 82,049,135 字节和逐图 SHA-256；
- 156 条资产说明映射摘要（150 条小节别名、6 条文档级 fallback）。

## T3 POC 闸门

1. 156/156 图片必须成功索引，且 PNG 哈希清单不变。
2. 36 条可回答视觉案例全部按冻结查询运行；6 条 image→image 必须排除 query
   poster group，6 条 evidence 必须命中节点、非 query 资产和 parent，不能靠
   回显输入图过关。
3. text→image 以 24 条 case 的 caption exact-role `7/24` 和 group `11/24`
   为配对基线；主要提升使用固定 seed、10,000 次、按唯一 `cluster-*` 标签
   重采样的 paired bootstrap，95% 置信区间下界必须大于 `0`。MRR、nDCG@5
   和各模态结果同时原样报告，不能只挑有利指标。
4. 10 条负例单独报告，不混入正例 bootstrap；禁止目标、自图或 query group
   命中数必须保持 `0`。
5. text→text `Recall@5` 不得低于 `0.4000`。视觉服务超时、退出、空索引或
   损坏时，带文本的查询必须回到冻结 caption 基线；纯 image→image 没有诚实
   的词法输入，必须 fail-closed 为 `UNSUPPORTED`，不得丢弃图片后伪装成功。

这些阈值在运行视觉模型前固定，不因结果好坏临时调整。

156 张 PNG 是课程教学标注页。`poster-*` 的下半页直接含分析说明，T3
索引必须只读取冻结的上部原作区域
`[x=0.038674,y=0.203125,w=0.453039,h=0.390625]`，并将归一化 bbox 写入索引
配置；不得把说明段 OCR 命中记为视觉提升。同一 `poster-XX` 的
layout/type/color 三页属于一个 poster group，冻结集与 paired bootstrap 按
group 聚类，不把三张衍生页当三份独立样本。
