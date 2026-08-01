# 触映本机托管

> **⚠️ 历史材料（已被 Lumi 当前材料取代）**：本文仅保留作历史记录，不代表当前产品能力或部署方案。现行演示与生产部署边界见 [Lumi 比赛演示脚本](demo-script.md) 和 [Lumi S0 部署冒烟 Runbook](deploy-s0.md)。

## 用途与边界

本方案将教师电脑作为比赛阶段的单实例服务器，后续可通过一致性备份迁移到云服务器。应用只监听 `127.0.0.1:3000`，本机可信代理只监听 `127.0.0.1:3100`；公网隧道只能连接 3100，不能直接连接 3000。

电脑关机、休眠、断网或退出当前 Windows 用户后，公网网站会离线。本方案适合原型验证和比赛演示准备，不替代学校批准的长期生产环境。

## 本机目录

所有密钥、数据库、证据图片和访问资料均位于 `%LOCALAPPDATA%\ChuyingAI`，不进入 Git 或 OneDrive：

- `config\service.env`：生产密钥和运行配置，不得发送或截图。
- `config\access-info.txt`：教师访问码、演示班级码和演示匿名编号，仅供演示人员使用。
- `data\competition-demo.sqlite`：明确标注为演示数据的 SQLite 数据库。
- `data\evidence`：私有证据图片目录。
- `logs`：本机服务日志，不记录身份码、教师码、Cookie 或上传内容。

`service.env` 的优先级、启动安全日志与多 worktree 共享评测文件的限制见 `docs/runbooks/runtime-configuration.md`。禁止从两个 worktree 并行运行模型评测。

## 初始化与启动

在项目目录执行：

```powershell
pnpm local-host:setup
pnpm agent:eval
pnpm agent:harness
pnpm agent:benchmark
pnpm local-host:prepare
pnpm build
pnpm local-host:start
pnpm local-host:verify
```

`local-host:setup` 首次运行时生成独立随机密钥和教师码，创建演示数据库；重复运行保留现有配置和数据。聊天模型三项配置需提前写入外置 `service.env`；可选嵌入链路按 `docs/runbooks/runtime-configuration.md` 使用同源回落或完整独立三项，不在安装流程中自动选择服务或写入密钥。`agent:eval` 生成当前模型与评估集匹配的结构报告：专业路由、真实来源账本、写/外呼确认和正式权限是硬门，episode、固定标题、关键词和动作卡只作诊断；回答体感由 40 题质量报告负责。若真实模型暂时超时或服务不可用，runner 以 75 退出、保留已完成前缀且不覆盖最终报告，服务恢复后直接再次运行 `pnpm agent:eval` 续跑；只有明确重做才加 `--restart`。`agent:harness` 在隔离临时库中重放既有异常、安全和旧库迁移场景，并新增模型离线降级与写作用确认，共16类场景。`agent:benchmark` 使用相同外置模型配置运行11个设计专业和连续项目基线，报告不会输出密钥；`--fixture` 只能验证结构。`local-host:prepare` 只有在 Eval 与 Harness 两份发布报告都新鲜且通过时，才会在端口关闭后备份并验证，再迁移数据库、导入通用设计、数字交互和书籍设计三个知识包；Runtime Benchmark 当前作为 K7 对照门单独运行。`local-host:start` 先执行证据恢复，再启动应用和可信代理。

临时验证阶段，外置配置中的 `ALLOW_QUICK_TUNNEL_ORIGIN=true` 只允许同源的 `*.trycloudflare.com` 浏览器请求。固定域名生效并通过跨网络扫码后必须将它改为 `false`，重启服务并确认临时域名不能再登录。

健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:3100/api/health
```

比赛演示的正常结果必须同时满足 `status=ok`、`database.available=true`、`aiConfigured=true`、`agentV2Enabled=true`、通用设计、数字交互和书籍设计三个知识包均大于0、`agentQuality.status=passed`、`agentHarness.status=passed`（16/16）和 `competitionReady=true`。直接向 3000 端口提交生产登录请求必须返回 403；通过 3100 登录应成功。

服务启动后运行 `pnpm local-host:verify`，它会以真实 HTTP 链路检查全部Agent发布门、3000 未签名拒绝、3100 学生/教师同源登录、安全 Cookie 和跨站拒绝，但不会输出任何访问码、Cookie 或模型密钥。

## 自动启动

Windows 计划任务名称为 `ChuyingAI-LocalHost`，在当前用户登录后启动，失败时最多自动重试三次。计划任务只在用户登录会话中运行，不绕过 Windows 登录，也不修改系统休眠策略。

正式计划任务不得指向 Git worktree 或 Codex 缓存中的包管理器。先从干净提交运行 `scripts/install-local-release.ps1`，将经过依赖安装和生产构建的精确提交安装到 `%LOCALAPPDATA%\ChuyingAI\releases\<commit>-node<ABI>`；随后让计划任务使用安装时同一套系统 Node 直接执行该版本自带的 `tsx` 和启动脚本。安装过程强制包含开发依赖，并校验 Node 路径、版本、原生模块 ABI 和关键运行依赖。pnpm 的 Windows 隔离依赖链接直接在最终不可变目录中创建；安装期间 `.installing` 会阻止计划任务注册，全部校验成功后才写入 `release.json` 并移除该阻断标记。失败只清理本次安装拥有的目录，不会留下可被误用的半成品，也不会删除并发安装。这样删除 worktree 或清理 Codex runtime cache 不会破坏已安装版本。每次更新都创建新的版本目录，旧版本保留用于回退，不做递归覆盖。

安装新版本并重建计划任务（下面三个程序路径必须使用本机实际路径）：

```powershell
$ErrorActionPreference = "Stop"
$GitPath = (Get-Command git.exe).Source
$PnpmPath = (Get-Command pnpm.cmd).Source
$NodePath = (Get-Command node.exe).Source
$InstallResult = (.\scripts\install-local-release.ps1 -GitPath $GitPath -PnpmPath $PnpmPath -NodePath $NodePath | Select-Object -Last 1) | ConvertFrom-Json
if (-not $InstallResult.ok) { throw "版本安装失败" }
$ReleasePath = $InstallResult.releasePath
$PreviousReleasePath = (Get-ScheduledTask -TaskName ChuyingAI-LocalHost -ErrorAction SilentlyContinue).Actions.WorkingDirectory
if ($PreviousReleasePath) { .\scripts\stop-local-host-task.ps1 -ReleasePath $PreviousReleasePath }
$PrepareResult = (& $NodePath "$ReleasePath\node_modules\tsx\dist\cli.mjs" "$ReleasePath\scripts\prepare-local-release.ts" | Select-Object -Last 1) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $PrepareResult.ok) { throw "备份、验证或迁移失败" }
try {
  & "$ReleasePath\scripts\register-local-host-task.ps1" -ReleasePath $ReleasePath -NodePath $NodePath -Start
  $Verification = (& $NodePath "$ReleasePath\node_modules\tsx\dist\cli.mjs" "$ReleasePath\scripts\verify-local-host.ts" | Select-Object -Last 1) | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or -not $Verification.ok) { throw "本机服务复核失败" }
} catch {
  & "$ReleasePath\scripts\stop-local-host-task.ps1" -ReleasePath $ReleasePath
  Write-Warning "新服务已停止。已验证备份：$($PrepareResult.backupPath)。迁移后不要直接启动旧代码。"
  throw
}
```

`prepare-local-release.ts` 只允许在 3000/3100 端口均已释放后运行；它先创建并验证数据库与证据的一致性备份，再显式执行迁移和三课程包知识导入。日常重启只启动应用，不会静默执行迁移。注册脚本仍会再次等待旧端口释放，保存旧任务定义，注册指定版本，并在启动后等待完整 `competitionReady` 健康门；如果注册或健康检查失败，脚本只恢复旧任务定义但保持停止，绝不让旧代码自动读取已升级数据库。

迁移和知识主题都没有自动降级。若迁移或知识导入后新版本启动失败，不要直接用旧代码连接已升级数据库；先按 `deployment.md` 用准备脚本输出的已验证备份恢复 SQLite 与 evidence，再把旧版本目录传给 `register-local-host-task.ps1`。手动停止、启动和查看状态：

```powershell
.\scripts\stop-local-host-task.ps1 -ReleasePath (Get-ScheduledTask -TaskName ChuyingAI-LocalHost).Actions.WorkingDirectory
Start-ScheduledTask -TaskName ChuyingAI-LocalHost
Get-ScheduledTask -TaskName ChuyingAI-LocalHost | Get-ScheduledTaskInfo
```

只有明确不再使用本机托管时才删除任务；删除任务不会删除数据库、证据或配置：

```powershell
Stop-ScheduledTask -TaskName ChuyingAI-LocalHost -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName ChuyingAI-LocalHost -Confirm:$false
```

## 公网接入

正式公网隧道建立前，不给 `chuyingai.cc.cd` 添加虚构的 A/CNAME 记录。隧道必须：

1. 提供有效 HTTPS；
2. 仅回源 `http://127.0.0.1:3100`；
3. 在 DNS 服务商页面使用隧道提供的真实记录值；
4. 上线后通过 `/api/health`、学生/教师登录和第二台设备跨网络扫码；
5. 扫码通过后再生成正式比赛二维码。

## 迁移到云服务器

迁移时先按 `deployment.md` 执行数据库与证据一致性备份、验证和恢复；云服务器仍保持单 Node 实例、SQLite 与证据位于同一持久卷、应用端口不直接暴露公网。切换成功并完成回滚演练前，保留本机原数据。
