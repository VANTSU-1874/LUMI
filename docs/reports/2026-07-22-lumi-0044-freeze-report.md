# Lumi 0044 冻结候选正式验证报告

结论：`0044_condemned_venus` 可以干净叠加在已含 `0043_agent-critiques` 的真实形态库上；回填可幂等重跑，回滚可精确恢复；最终全量门全部通过。

**迁移安全：是。**

## 冻结范围

- 分支：`feature/lumi-candidate`
- 验证输入提交：`324b6f8ec739e25691a5e799abe7d6935e9b7380`
- 报告及修复提交：本报告所在的最终候选 `HEAD`；交接时记录完整提交号
- integration 种子来源：`feature/lumi-integration` 工作树，提交 `423c050`
- 迁移：`0043_agent-critiques -> 0044_condemned_venus`
- 真实数据库：未读取、未迁移、未回填、未回滚
- 部署：未执行；未运行 `lumi-finalize-service.sh`

环境：Windows，Node `v24.14.0`，pnpm `11.9.0`，Next.js `16.2.10`，SQLite/better-sqlite3，系统 Chrome。现有 `node_modules` 有 lockfile 不同步警告；遵照约束未清理、未安装。所有 pnpm 运行均设置 `pnpm_config_verify_deps_before_run=warn`。

## 1. 存量回填脚本

既有脚本 `scripts/backfill-agent-messages.ts` 存在，并调用 `backfillAgentMessages()`：

- user ID：`${turnId}#u`
- assistant ID：`${turnId}#a`
- 写入：`INSERT OR IGNORE`
- 首次运行：扫描 3 turns，插入 6 messages
- 第二次运行：扫描 3 turns，插入 0 messages；总数仍为 6，无重复 ID

没有新造回填脚本。

## 2. 0043 -> 0044 迁移安全

隔离库由 integration 的 `scripts/seed-demo.ts` 创建，数据库和证据目录均位于临时路径。详细机器可读证据见 `2026-07-22-lumi-0044-freeze-324b6f8-migration-safety.json`。

| 检查点 | 迁移数 | agent_turns | agent_critiques | agent_messages | tasks | 结论 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 0043 基线 | 44 | 3 | 2 | 表不存在 | 2 | 最新为 `0043_agent-critiques` |
| 仅跑候选迁移 | 45 | 3 | 2 | 0 | 2 | 只新增 0044；`mode/pinned` 已出现 |
| 首次回填 | 45 | 3 | 2 | 6 | 2 | 每 turn 恰好 user/assistant 各 1 行 |
| 第二次回填 | 45 | 3 | 2 | 6 | 2 | 新增 0，幂等 |
| 还原 0043 备份 | 44 | 3 | 2 | 表不存在 | 2 | 文件 SHA256 与备份逐字节一致 |

事实表全行内容哈希在迁移前、迁移后、回填后、还原后均保持：

- `agent_turns`: `c03f1343848b699bef825258032a17677f2df1ae122fd95d6a48fee2422bfaa4`
- `agent_critiques`: `caa7a20854fc70ecf9bd0015b87493637285c870221edf0c25e6ccc5ff835be0`

所有检查点 `PRAGMA foreign_key_check` 均为 0。回滚后的库 SHA256 为 `11A44FE4B1D5ECE72ECF6B99791039304765BAFB8BBFFC62C251D8FD0B3A48D8`，与迁移前备份完全相同。

## 3. message round-trip 与事务原子性

覆盖并通过：

- 纯文本：append user -> `runAgentTurn()`/持久化 -> load，parts 合法
- 带作品图：attachment metadata 从事实表重建为 UI parts，不存 UI 库 blob
- 带工具调用：tool call/result 从事实表重建为合法 parts
- 实时一致性：adapter 的 TOKEN 文本、完成事件 parts、持久化 assistant content 三者一致
- 事务原子性：turn 落库时 assistant 行同事务存在；故意制造 assistant 不匹配会一起回滚 turn/tool/steps/message

定向验证先后通过 14/14 与 21/21；以上用例也包含在最终 2079 个 Vitest 中。

## 4. 最终全量门

| 门 | 样本量 | 结果 | 耗时 | skip/todo | 原始输出 |
| --- | --- | --- | ---: | --- | --- |
| Full Vitest | 212 files / 442 suites / 2079 tests | 2079 passed，0 failed | 151.886s（JSON） | pending 0，todo 0 | `...-vitest.json` |
| Typecheck | 全项目 `tsc --noEmit` | exit 0 | 23.331s | 不适用 | `...-typecheck.txt` |
| ESLint | 660 files | 0 errors，0 warnings | 31.5s（shell） | 不适用 | `...-eslint.json` |
| Production build | Next webpack build，27 静态页 | exit 0 | 43.1s | 不适用 | `...-build.txt` |
| Playwright | 23 tests / Chromium | 23 passed，0 failed | 68.746s（JUnit） | skipped 0 | `...-playwright-junit.xml` |

Playwright 使用隔离 `.runtime/e2e-*` 数据，覆盖 1440px 桌面以及 390px、375px、320px 移动视口。production build 是独立正式门；浏览器写操作按仓库原有安全模型运行在 `next dev --webpack` E2E 环境，因为无签名直连生产服务应被生产代理边界拒绝。

最终失败清单：无。

## 5. 首轮失败及归因

所有失败均先保留原始证据，再修复或调整验证编排；不存在无法解释的回归。

1. integration seed 首次使用 `baseline-0043.sqlite`，被“路径必须显式含 demo/dev/test”保护拒绝。归因：QA 调用路径错误；改为 `demo-baseline-0043.sqlite` 后通过。
2. 首次只读 SQLite 检查误把 `table` 当列名。归因：QA 查询引用错误；参数化查询后通过。
3. 新增流式一致性测试第一次 typecheck 报 TS2504。归因：证据测试对 Promise/AsyncGenerator 联合类型未收窄；仅修测试类型后通过。
4. 首轮 lint 发现 `DecryptedText.jsx` 的 effect 同步 setState 与 `TextType.jsx` 的动态组件 ref 两项。归因：frontend 输入中的真实代码缺陷；分别改为可取消 animation frame，并将唯一实际用法固定为语义化 `span`。原始 JSON 已保留。
5. Playwright 默认端口 3000 被占用。归因：本机环境冲突；未终止未知服务，改用隔离端口。
6. 首轮浏览器 18/23 失败，均从新首页寻找旧身份入口或旧 `.lumi-scroll-blur/#how`。归因：frontend 输入中的真实回归与陈旧测试；新首页曾移除 integration 已有的 `EntryForm`，同时新增测试仍指向上一版 DOM。已恢复双身份入口并把首页测试对齐当前桌面/移动契约。
7. 直接对 production `next start` 跑写操作时 4 个 API 返回 403。归因：预期安全行为；生产写端点要求代理签名，无签名浏览器不得绕过。保留去除 reporter 配置段后的 results-only 失败 JSON，正式 production build 与开发型 E2E 门分开执行。
8. Playwright 自管 Windows webServer 曾在用例结束后不释放收尾句柄。归因：测试编排问题；最终由本会话精确启动隔离服务、让 Playwright 复用，并按 PID 关闭，runner 正常退出。

分类：第 4、6 项为 frontend 输入经会话 2 合并带入的真实缺陷/漏测；第 1、2、3、5、8 项为验证编排或证据测试问题；第 7 项为被正确触发的生产安全边界。没有 0044 迁移缺陷，没有 agent 事实源或现有教师权限回归。

## 6. 代码边界核对

本次认证修复只涉及首页入口、两个动画组件、Playwright 编排与测试断言；未修改：

- `lib/db/schema.ts`、`drizzle/` 或任何迁移
- `agent_turns` 结构、内容或教学事实语义
- 现有教师端点的班级边界或权限逻辑
- 真实库、部署脚本、remote
- `HANDOFF.md`、`data/evidence-dev/`

原始与机器可读证据均位于本目录，文件名前缀为 `2026-07-22-lumi-0044-freeze-324b6f8-`。Playwright JSON reporter 会序列化继承的 `webServer.env`，因此未把该配置段提交进仓库；最终正式结果改用原生 JUnit XML，生产直连失败证据仅保留不含 `config` 的 results-only JSON。提交前扫描确认这些 Playwright 证据不含敏感环境键名。
