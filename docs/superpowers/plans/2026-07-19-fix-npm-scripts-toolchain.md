# 修复：`npm run` 脚本因缺少 bin shim 而不可用（for Codex 新会话）

> **独立小任务**，与评测排查、S0 部署、前端重写互不依赖，可单开会话完成。
>
> **不要**在本任务中顺带改评测逻辑或模型配置——只修工具链。

## 现象

在 `.worktrees/tonggan-mvp` 下：

```
> npm run agent:eval -- --restart
> tsx scripts/evaluate-agent.ts --restart
'tsx' is not recognized as an internal or external command,
operable program or batch file.
```

用户自己的 PowerShell 与后台 shell 均复现，**不是环境差异**。

## 已知线索

- `node_modules/tsx/dist/cli.mjs` **存在**，包本身装好了
- `node_modules/.bin/` 中**没有 tsx 的 shim**（`ls node_modules/.bin | grep -i tsx` 无输出）
- `node_modules/.pnpm/` 存在 → **这份 node_modules 是 pnpm 装的**
- 绕开 PATH 的写法可用：`node node_modules/tsx/dist/cli.mjs scripts/evaluate-agent.ts`
- 项目根有 `pnpm-lock.yaml` 与 `pnpm-workspace.yaml`

**核心矛盾：包装好了，但可执行文件的 shim 没生成。**`npm run` 与 `pnpm run` 都依赖 `node_modules/.bin` 在 PATH 中，shim 缺失则所有此类脚本都会挂——不只 `agent:eval`。

## Task A：先诊断，别急着重装

- [ ] `node_modules/.bin/` 到底有没有内容？是完全空/不存在，还是只缺 tsx？（决定是整体安装问题还是单包问题）
- [ ] 对照 `package.json` 的 `scripts`，列出**还有哪些脚本会因此挂**（drizzle-kit、vitest、playwright、next 等大概率同样受影响）
- [ ] 检查安装是否被中断或跳过脚本：查 pnpm 日志、`better-sqlite3` 等原生模块是否编译成功（原生模块编译失败可能中断后续的 bin 链接）
- [ ] 确认当时用的是 `npm install` 还是 `pnpm install`（混用是常见诱因）
- [ ] 记录仓库是否位于 OneDrive 等同步盘下——同步盘会干扰 pnpm 的硬链接与 Windows shim 创建（重建计划第 8 阶段已就此提过运维警示）

**产出**：一句话结论——是"整体 bin 未链接"还是"个别包异常"。

## Task B：按诊断结果修复

**统一用 pnpm**（仓库有 pnpm lock 与 workspace 配置，混用 npm 是主要风险源）：

- [ ] `pnpm install`（必要时先删 `node_modules` 再装；**不要删 `pnpm-lock.yaml`**）
- [ ] 若原生模块编译失败：单独处理 `better-sqlite3`，确保 `pnpm rebuild` 通过
- [ ] 验证：`node_modules/.bin/` 中出现 tsx 及其他脚本所需的可执行文件
- [ ] 验证：`npm run agent:eval -- --restart` 能进入脚本（**能启动即算通过，评测本身通不通过是另一件事，不在本任务范围**）

## Task C：其余 worktree 一并处理

每个 worktree 是独立检出，**各自需要自己的 `node_modules`**：

- [ ] `.worktrees/lumi-frontend`：前端轨道要跑 dev server，必须能用
- [ ] 其余存活的 worktree 按需处理
- [ ] 若磁盘吃紧，评估 pnpm 的 store 复用是否已生效（正常情况下多 worktree 共享全局 store，不会成倍占用）

## Task D：让它不再复发

- [ ] **失败信息要能自解释**：`'tsx' is not recognized` 与真实问题（依赖未正确安装）毫无关联，任何人第一次遇到都会误判为 PATH 或环境问题。加一个 `pnpm run doctor` 之类的检查脚本，或在 README/runbook 顶部写明"必须用 pnpm 安装，且 `node_modules/.bin` 需存在"
- [ ] 在 `docs/runbooks/` 记录本次故障与修法：症状、根因、修复命令、验证方法
- [ ] 评估是否在 CI/本地校验中加一步"关键 bin 存在性检查"，让缺失在第一时间暴露

## 验收

1. `npm run agent:eval -- --restart` 与 `pnpm run agent:eval -- --restart` 都能**进入脚本**
2. `package.json` 中其他常用脚本同样可用（至少 test、dev、db 相关）
3. runbook 中有本次故障的记录，新人照做即可复现修复
4. 未修改任何评测逻辑、模型配置或应用代码

## 纪律

- 只修工具链，不碰业务代码与配置
- 不要为了"能跑"就把脚本改成 `node node_modules/...` 的绕路写法——那是临时手段，正解是把安装修对
- 遇取舍无法自决，写 `> DECISION NEEDED:` 停下等确认
