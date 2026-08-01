# 公开部署、备份与回滚

## 当前边界

本手册描述与供应商无关的生产拓扑，不选择云厂商、域名或模型提供方。当前 S0 的 `PUBLIC_APP_URL=https://lumi.bot.cd` 已确认并完成自动公网 API 冒烟，具体记录见 [`deploy-s0.md`](./deploy-s0.md)；任何新环境仍必须先确认可从评审网络访问的 HTTPS 主机，不得沿用已放弃地址或为生成二维码虚构地址。

若使用中国内地服务器和自有域名，应把 ICP 备案及适用的后续备案/安全手续纳入上线倒排计划；未能在提交前完成时，应改用学校批准且届时确实可激活的合规 HTTPS 环境。主机确认后再生成、扫描二维码。

## 目标拓扑

```text
公网 HTTPS -> 边缘反向代理 -> 可信代理 127.0.0.1:3100 -> 应用服务 127.0.0.1:3000 -> 持久 SQLite 与 EVIDENCE_ROOT
```

- 只运行一个写入 SQLite 的 Node.js 应用实例；MVP 不做多实例共享写入。
- 反向代理终止 TLS，应用端口只监听内网/loopback，并由防火墙阻止公网直连。
- 认证入口遵循 `docs/runbooks/trusted-auth-proxy.md`：代理删除客户端伪造头，使用独立密钥签名可信来源标识。
- SQLite 主文件与 `EVIDENCE_ROOT` 必须位于同一块持久卷，不能放在临时容器层；证据目录不能在 `public/` 中。
- 健康检查为公开 `GET /api/health`，代理不得缓存响应。

## 服务账户与目录权限

创建只用于本应用的服务账户。它只需要：读取发布目录；读写持久数据目录；读取外置环境配置。不要授予交互式管理员权限，也不要让反向代理账户直接读取证据。

Windows 权限示例（先替换变量，确认路径后再执行）：

```powershell
$ServiceAccount = "<machine-or-domain>\<tonggan-service-account>"
$ReleaseRoot = "D:\Tonggan\current"
$DataRoot = "D:\TongganData"
New-Item -ItemType Directory -Force $DataRoot, (Join-Path $DataRoot "evidence") | Out-Null
icacls $ReleaseRoot /grant "${ServiceAccount}:(OI)(CI)RX"
icacls $DataRoot /grant "${ServiceAccount}:(OI)(CI)M"
```

由管理员核对 ACL 输出。不要把发布目录或持久卷开放为 Everyone 可写。

## 外置配置与密钥

在服务管理器或受控密钥文件中配置，文件不在 Git 仓库且只允许服务账户读取：

- `NODE_ENV=production`
- `SESSION_SECRET`、`IDENTITY_CODE_PEPPER`、`AUTH_PROXY_SECRET`：分别生成、至少 32 字符。
- `TEACHER_ACCESS_CODE`：随机私有值；不要发送到比赛材料或日志。
- `DATABASE_PATH`：持久卷中的 SQLite 文件。
- `EVIDENCE_ROOT`：同一持久卷中的私有证据目录。
- 可选 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`；三项必须同时存在。
- 可选嵌入配置 `LLM_EMBEDDING_BASE_URL`、`LLM_EMBEDDING_API_KEY`、`LLM_EMBEDDING_MODEL`；它是检索向量器而非第二个导师模型。聊天三项完整时，嵌入基址与密钥可以分别省略并回落到聊天对应值；只启用嵌入时则必须完整提供嵌入三项。任何嵌入字段残缺都会拒绝启动。仅在目标服务明确支持 `/embeddings`，且已批准发送去敏课程语料、经过手机号/邮箱/学号遮蔽的学生检索问题，以及每轮最多三条脱敏长期记忆候选片段时配置；长期记忆写入向量后，后续召回只发送脱敏查询并在本地比较向量。未配置或调用失败时自动降级为词法检索，不影响导师作答。
- 可选 `LLM_MAX_OUTPUT_TOKENS`，默认 `4096`，应用允许范围为 `1–4096`。
- 可选 `LLM_VISION_ENABLED`，默认 `false`；只有供应商明确支持 Chat `image_url` 或 Responses `input_image` 输入时才设为 `true`。
- `AGENT_MODEL_IDLE_TIMEOUT_MS` / `AGENT_MODEL_TOTAL_TIMEOUT_MS` / `AGENT_TURN_TOTAL_TIMEOUT_MS`：V4 线上流式空闲、单次模型硬总、整回合硬总时长，默认 `75000` / `600000` / `900000` 毫秒。
- `AGENT_EVAL_MODEL_IDLE_TIMEOUT_MS` / `AGENT_EVAL_MODEL_TOTAL_TIMEOUT_MS` / `AGENT_EVAL_TURN_TOTAL_TIMEOUT_MS`：结构与质量评测专用配置，默认 `120000` / `600000` / `900000` 毫秒；每组必须满足 `idle < model total < turn total`。

生产环境会拒绝默认教师码、占位密钥、缺少代理签名密钥和缺少身份 pepper。服务显式环境变量优先于 `.env.local`；生产建议完全由服务管理器注入，避免发布时误带开发文件。

裸模型客户端在调用方未指定策略时默认 10 秒硬总超时；当前 V3 导师运行时使用 `competition-core@4`。线上默认 idle/model total/turn total 为 75/600/900 秒；长推理评测使用独立的 120/600/900 秒配置。流式请求每收到非空原始传输块就重置 idle，但硬总时长永不重置；非流式请求只使用硬总时长。V2 回退链继续显式使用历史策略 `competition-core@1` 的 10/30/60 秒预算，`competition-core@2` 的 30/50/60 秒预算只用于历史记录兼容。提示与迁移反馈仍使用各自更短的任务级超时。反向代理和进程管理器的上游时限必须高于对应线上整回合时长但仍保持有限；评测应在不经过交互代理硬时限的受控任务中运行。模型失败后应用进入确定性降级，不得通过无限重试延长请求，也不得自动把语义检查标为通过。

## 首次发布

在隔离的构建环境验证目标提交：

```powershell
$ErrorActionPreference = "Stop"
git status --short
if ($LASTEXITCODE -ne 0) { throw "git status failed: $LASTEXITCODE" }
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed: $LASTEXITCODE" }
pnpm lint
if ($LASTEXITCODE -ne 0) { throw "pnpm lint failed: $LASTEXITCODE" }
pnpm test
if ($LASTEXITCODE -ne 0) { throw "pnpm test failed: $LASTEXITCODE" }
pnpm test:e2e
if ($LASTEXITCODE -ne 0) { throw "pnpm test:e2e failed: $LASTEXITCODE" }
pnpm build
if ($LASTEXITCODE -ne 0) { throw "pnpm build failed: $LASTEXITCODE" }
```

部署同一提交和同一锁文件。维护窗口内、服务停止或尚未首次启动时执行：

```powershell
$ErrorActionPreference = "Stop"
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed: $LASTEXITCODE" }
pnpm db:migrate
if ($LASTEXITCODE -ne 0) { throw "db:migrate failed: $LASTEXITCODE" }
pnpm evidence:recover
if ($LASTEXITCODE -ne 0) { throw "evidence:recover failed: $LASTEXITCODE" }
& '<NODE_BINARY>' node_modules/tsx/dist/cli.mjs scripts/start-local-host.ts
if ($LASTEXITCODE -ne 0) { throw "start-local-host failed: $LASTEXITCODE" }
```

生产必须通过 `scripts/start-local-host.ts` 同时启动仅监听 loopback 的 3000 应用与 3100 可信代理；边缘反向代理的 upstream 固定为 `http://127.0.0.1:3100`，绝不能直连 3000、改成 `0.0.0.0` 或把任一应用端口暴露到公网。裸 `pnpm start` 只启动 3000，不满足当前生产信任链。正式环境不可运行 `pnpm db:seed`：脚本会拒绝 production。比赛演示库应在受控的非生产准备阶段生成并核对清单，然后作为已审核的持久数据快照部署；真实课堂库必须与演示库分开，绝不把演示记录伪装成真实数据。

若将 Node 注册为 Windows 服务，所有启停必须等待真实状态，且任何外部命令非零都要立即失败。先在管理员 PowerShell 定义：

```powershell
$ErrorActionPreference = "Stop"
$ServiceName = "<confirmed-node-service-name>"
function Assert-LastExitCode([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "$Step failed with exit code $LASTEXITCODE" }
}
function WaitForServiceStatus([string]$Name, [string]$Expected, [int]$TimeoutSeconds = 60) {
  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $Status = (Get-Service -Name $Name -ErrorAction Stop).Status.ToString()
    if ($Status -eq $Expected) { return }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $Deadline)
  throw "Service $Name did not reach $Expected in $TimeoutSeconds seconds"
}

Start-Service -Name $ServiceName -ErrorAction Stop
WaitForServiceStatus -Name $ServiceName -Expected "Running"
(Get-Service -Name $ServiceName).Status
```

若实际主机使用其他服务管理器，保留同样的单实例、工作目录、环境和自动重启约束，替换为该系统的等价命令并记录在部署单中。

## HTTPS 与健康检查

反向代理必须：

1. 强制 HTTP 跳转 HTTPS，启用有效证书和现代 TLS。
2. 只代理到本机 Node 端口，不把 SQLite、证据目录或源码暴露为静态文件。
3. 限制请求体大小，保留应用对截图 5 MB 的更严格校验。
4. 对认证路由实施可信来源签名，对所有客户端同名头先删除再重建。
5. 不记录 Cookie、Authorization、请求体、模型提示或上传内容。

上线后检查：

```powershell
$PublicBaseUrl = "https://<confirmed-public-host>"
$Health = Invoke-RestMethod "$PublicBaseUrl/api/health"
$Health | ConvertTo-Json -Depth 4
```

正常状态返回 HTTP 200、`status=ok`、`database.available=true`、非负的 `knowledge.chunkCount` 与布尔 `aiConfigured`。数据库打不开或知识查询失败返回 HTTP 503、`status=degraded`。响应绝不应出现数据库路径、密钥、班级码、匿名编号或证据内容。

## 每日一致性备份

SQLite 与证据文件必须作为一个恢复点备份。`BACKUP_BASE` 是管理员预先创建、权限受控且不与 `DATABASE_PATH`/`EVIDENCE_ROOT` 重叠的本地绝对目录。脚本拒绝根目录、UNC、junction/软链接、非 canonical 路径、源重叠与空文件。

每天低峰窗口执行下列完整流程。交互执行命令分别是 `pnpm backup:create` 与 `pnpm backup:verify`；下方加 `--silent` 只是为了让 PowerShell 可靠捕获脚本输出的单行 JSON。不要只发出 Stop/Start 而不等待状态：

```powershell
$ErrorActionPreference = "Stop"
$env:DATABASE_PATH = "D:\TongganData\competition-demo.sqlite"
$env:EVIDENCE_ROOT = "D:\TongganData\evidence"
$env:BACKUP_BASE = "E:\TongganBackups"

Stop-Service -Name $ServiceName -ErrorAction Stop
WaitForServiceStatus -Name $ServiceName -Expected "Stopped"
try {
  $BackupJson = pnpm --silent backup:create
  Assert-LastExitCode "backup:create"
  $Backup = $BackupJson | ConvertFrom-Json
  if (-not $Backup.ok) { throw "backup:create did not return ok" }
  $env:BACKUP_PATH = $Backup.backupPath
  $VerifyJson = pnpm --silent backup:verify
  Assert-LastExitCode "backup:verify"
  $Verify = $VerifyJson | ConvertFrom-Json
  if (-not $Verify.ok) { throw "backup:verify did not return ok" }
} finally {
  Start-Service -Name $ServiceName -ErrorAction Stop
  WaitForServiceStatus -Name $ServiceName -Expected "Running"
}
```

`backup:create` 要求 checkpoint 的 `busy=0`；在唯一 `.incomplete` 目录中复制数据库和整个 evidence（即使为空也创建），为每个文件记录相对路径、字节数和 SHA-256，并在复制后重新计算源和目标。只有写入 `COMPLETE` 后才原子改名。失败返回非零并保留 `.incomplete` 供取证，不得把它当恢复点。`backup:verify` 会在 approved base 中创建自己的唯一临时恢复目录，核对 COMPLETE、manifest 缺失/多余/空文件/hash、SQLite integrity/FK 与所有 READY 图片引用，随后只清理自己创建的临时目录。

把最终恢复点复制到独立、加密、受访问控制且尽量不可变的介质；设置保留周期并监控退出码。把 `manifest.json` 本身的 SHA-256 另存到不同的受控系统，恢复时同时核对。manifest 能发现普通损坏或单边修改，但它不是签名，无法抵抗攻击者同时篡改数据文件、manifest 与 COMPLETE 的协同篡改。跨介质复制后必须把它放回一个 approved base，再运行 `pnpm backup:verify`。不要只复制 SQLite 主文件而遗漏 WAL checkpoint，也不要只备份数据库而遗漏图片。

## 恢复副本、切换与回退演练

至少每月执行一次。服务必须从 Git 工作区外、ACL 受控的 `$ServiceEnvFile` 读取 `DATABASE_PATH` 和 `EVIDENCE_ROOT`，并在每次启动时重新加载；不得把这两个生产路径写回 `.env*`、仓库脚本或服务定义的 Git 跟踪文件。`RESTORE_BASE` 是管理员预先创建的独立 approved 目录，不能与 backup、当前数据库或 evidence 重叠。

先定义只更新这两个路径的外部环境文件操作。环境文件必须已存在；脚本保留其中其他设置且不输出内容：

```powershell
$ErrorActionPreference = "Stop"
$ServiceEnvFile = "D:\TongganConfig\tonggan-service.env"
$ServiceName = "<confirmed-node-service-name>"
$PublicBaseUrl = "https://<confirmed-public-host>"

function Get-ServiceDataPath([string]$Name) {
  $Matches = @(Get-Content -LiteralPath $ServiceEnvFile | Where-Object { $_ -match "^$([Regex]::Escape($Name))=" })
  if ($Matches.Count -ne 1) { throw "External service env must contain exactly one $Name" }
  return $Matches[0].Substring($Matches[0].IndexOf("=") + 1)
}
function Set-ServiceDataPaths([string]$DatabasePath, [string]$EvidenceRoot) {
  foreach ($Value in @($DatabasePath, $EvidenceRoot)) {
    if (-not [IO.Path]::IsPathFullyQualified($Value) -or $Value.StartsWith("\\") -or $Value -match "[\r\n]") {
      throw "Unsafe service data path"
    }
  }
  $Lines = @(Get-Content -LiteralPath $ServiceEnvFile | Where-Object { $_ -notmatch "^(DATABASE_PATH|EVIDENCE_ROOT)=" })
  $Lines += "DATABASE_PATH=$DatabasePath"
  $Lines += "EVIDENCE_ROOT=$EvidenceRoot"
  $Temp = Join-Path (Split-Path $ServiceEnvFile) ("." + [IO.Path]::GetFileName($ServiceEnvFile) + "." + [Guid]::NewGuid() + ".tmp")
  try {
    [IO.File]::WriteAllLines($Temp, $Lines, [Text.UTF8Encoding]::new($false))
    [IO.File]::Replace($Temp, $ServiceEnvFile, $null)
  } finally {
    if (Test-Path -LiteralPath $Temp) { Remove-Item -LiteralPath $Temp -Force }
  }
}
```

按下列顺序完成 `create -> verify -> restore copy -> stop/wait -> switch external env -> start/wait -> health/smoke`。`backup:restore` 只从已完成的恢复点创建一个全新的副本：先保留 `.restore-*.incomplete`，复制原 manifest/COMPLETE 而不重算，再核对 missing/extra/size/hash、SQLite integrity/FK 和 READY 图片引用；随后带着 INCOMPLETE 原子改名为 `restore-*`，改名成功后才删除新目录中的 marker。rename 冲突或失败时，原 `.restore-*.incomplete` 与 marker 原样保留；marker 删除失败时，`restore-*` 仍带 INCOMPLETE，验证器和服务切换都必须拒绝。它不覆盖或删除旧 live 路径。

```powershell
$OldDatabasePath = Get-ServiceDataPath "DATABASE_PATH"
$OldEvidenceRoot = Get-ServiceDataPath "EVIDENCE_ROOT"
$env:DATABASE_PATH = $OldDatabasePath
$env:EVIDENCE_ROOT = $OldEvidenceRoot
$env:BACKUP_BASE = "E:\TongganBackups"
$env:RESTORE_BASE = "F:\TongganRestores"

$Backup = (pnpm --silent backup:create | ConvertFrom-Json)
Assert-LastExitCode "backup:create"
if (-not $Backup.ok) { throw "backup:create did not return ok" }
$env:BACKUP_PATH = $Backup.backupPath
$Verify = (pnpm --silent backup:verify | ConvertFrom-Json)
Assert-LastExitCode "backup:verify"
if (-not $Verify.ok) { throw "backup:verify did not return ok" }
$Restore = (pnpm --silent backup:restore | ConvertFrom-Json)
Assert-LastExitCode "backup:restore"
if (-not $Restore.ok) { throw "backup:restore did not return ok" }

try {
  Stop-Service -Name $ServiceName -ErrorAction Stop
  WaitForServiceStatus -Name $ServiceName -Expected "Stopped"
  Set-ServiceDataPaths -DatabasePath $Restore.databasePath -EvidenceRoot $Restore.evidenceDir
  Start-Service -Name $ServiceName -ErrorAction Stop
  WaitForServiceStatus -Name $ServiceName -Expected "Running"
  $Health = Invoke-RestMethod "$PublicBaseUrl/api/health"
  if ($Health.status -ne "ok" -or -not $Health.database.available) { throw "Restored health check failed" }
  # 立即按 competition-smoke-test.md 实测演示登录、教师登录和一条私有图片读取；任一失败都 throw。
} catch {
  if ((Get-Service -Name $ServiceName -ErrorAction Stop).Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -ErrorAction Stop
    WaitForServiceStatus -Name $ServiceName -Expected "Stopped"
  }
  Set-ServiceDataPaths -DatabasePath $OldDatabasePath -EvidenceRoot $OldEvidenceRoot
  Start-Service -Name $ServiceName -ErrorAction Stop
  WaitForServiceStatus -Name $ServiceName -Expected "Running"
  $RollbackHealth = Invoke-RestMethod "$PublicBaseUrl/api/health"
  if ($RollbackHealth.status -ne "ok") { throw "Rollback health check failed; keep service state for incident response" }
  throw
}
```

切换成功后仍保留旧 database、SQLite sidecar 和 evidence，直到双人复核、保留期到期后另行处置；本流程绝不移动、覆盖或删除它们。记录原/新两组路径、恢复点、manifest 外部 digest、耗时、健康结果、冒烟记录与执行/复核人。失败时必须先停服务，再把外部 service env 两个路径切回原值并启动验证；不要用文件复制“回滚”覆盖旧 live。

## 发布回滚

发布前记录当前和上一提交，并先完成一致性备份：

```powershell
$CurrentCommit = git rev-parse HEAD
$PreviousCommit = git rev-parse HEAD^
git show --no-patch --oneline $CurrentCommit
git show --no-patch --oneline $PreviousCommit
```

应用版本回滚：

```powershell
$ErrorActionPreference = "Stop"
Stop-Service -Name $ServiceName -ErrorAction Stop
WaitForServiceStatus -Name $ServiceName -Expected "Stopped"
git switch --detach $PreviousCommit
Assert-LastExitCode "git switch"
pnpm install --frozen-lockfile
Assert-LastExitCode "pnpm install"
pnpm build
Assert-LastExitCode "pnpm build"
Start-Service -Name $ServiceName -ErrorAction Stop
WaitForServiceStatus -Name $ServiceName -Expected "Running"
```

数据库迁移不可逆：当前迁移链只定义向前升级，没有自动 down migration。若新版本已执行迁移，不能假设上一提交可读取新结构，也不要删除迁移记录来“伪回滚”。先查兼容性；不兼容时必须停止服务，同时恢复发布前同一恢复点的 SQLite 与 evidence，再启动上一提交。恢复点之后的新提交会丢失，必须先隔离保存并由负责人决定人工补录或放弃。

回滚后重新检查 HTTPS、`/api/health`、登录、演示标签、证据读取与删除恢复，并记录实际提交与恢复点。

## 日志脱敏与日常维护

- 应用和代理日志只留时间、状态码、路由、请求 ID、错误类型和耗时；不留 Cookie、Authorization、匿名编号、班级码、教师码、手机号、邮箱、学号、证据内容、文件路径、模型密钥或完整提示。
- 访问日志关闭查询字符串；当前二维码 URL 本身也不允许查询参数。
- 每次发布和每日备份后执行健康检查；503 必须告警，但不要把原始异常或环境内容返回公网。
- 定期在维护窗口执行 `pnpm evidence:recover`。`.deleting-*` tombstone 是删除恢复机制的一部分，不得手工清除；命令非零时保持服务关闭并按 `docs/runbooks/evidence-storage.md` 排查。
- 定期核对磁盘余量、备份可读性、证书到期、系统时钟、服务账户权限和反向代理签名密钥轮换计划。

## 正式对外发布停止条件

出现任一情况时，不得把候选环境宣布为“最终比赛入口”或主动对外宣传：HTTPS/证书未通过；域名在截止日前无法合规激活；健康检查为 503；生产仍使用占位或默认密钥；数据不在持久卷；备份验证或隔离恢复演练未通过；日志会记录敏感数据；演示记录未明确标注；二维码未从第二台设备实扫。受控 S0 可以先在线完成自动检查，但必须在部署记录中逐项标明尚未通过的人工门，不能因此宣称最终比赛就绪。
