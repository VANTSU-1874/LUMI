# 本地开发与比赛演示

## 适用场景

在 Windows PowerShell 中首次安装、启动本地演示、重建演示库或完成提交前验证。命令以仓库根目录为当前目录。

模型命令与正式本机服务的配置来源、优先级和 worktree 共享限制见 `docs/runbooks/runtime-configuration.md`。

## 前置条件

- Node.js 满足 `package.json` 的 `>=20.19.0 <25`；仓库当前 `.node-version` 为 24.14.0。
- pnpm 11.7.0。
- 3000 端口未被其他程序占用。
- 不把 `.env.local`、终端中的密钥或匿名编号提交到 Git。

核对版本：

```powershell
node --version
pnpm --version
```

## 1. 安装依赖

```powershell
pnpm install --frozen-lockfile
```

`--frozen-lockfile` 保证安装内容与已审核的 `pnpm-lock.yaml` 一致。若失败，先核对 Node/pnpm 版本，不要直接删除锁文件。

## 2. 创建本地环境

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

生成四个不同的随机值，再手工替换 `.env.local` 中对应占位值：

```powershell
node -e "const {randomBytes}=require('node:crypto'); for (const n of ['SESSION_SECRET','IDENTITY_CODE_PEPPER','AUTH_PROXY_SECRET']) console.log(n+'='+randomBytes(32).toString('hex')); console.log('TEACHER_ACCESS_CODE='+randomBytes(18).toString('base64url'))"
```

本地演示应保留：

```text
DATABASE_PATH=./data/course-dev.sqlite
EVIDENCE_ROOT=./data/evidence-dev
ALLOW_DEMO_SEED=true
SEED_AFTER_RESET=false
```

要求：

- `SESSION_SECRET`、`IDENTITY_CODE_PEPPER`、`AUTH_PROXY_SECRET` 至少 32 个字符且彼此不同。
- `TEACHER_ACCESS_CODE` 使用刚生成的私有值；教师从首页“教师入口”输入它。不要使用示例占位值或弱口令。
- `DATABASE_PATH` 和 `EVIDENCE_ROOT` 必须留在当前工作区，且为 `dev`、`test` 或 `demo` 明确标记的路径。
- 命令行中显式设置的环境变量优先于 `.env.local`，适合一次性覆盖；完成后用 `Remove-Item Env:<名称>` 清除。

### 可选模型配置

模型辅助只有在以下三项全部配置时才启用：

```text
LLM_BASE_URL=https://<approved-model-endpoint>/v1
LLM_API_KEY=<private-key>
LLM_MODEL=<approved-model-name>
LLM_EMBEDDING_BASE_URL=https://<approved-embedding-endpoint>/v1
LLM_EMBEDDING_API_KEY=<private-embedding-key>
LLM_EMBEDDING_MODEL=<approved-embedding-model-name>
LLM_VISION_ENABLED=false
AGENT_MODEL_IDLE_TIMEOUT_MS=75000
AGENT_MODEL_TOTAL_TIMEOUT_MS=600000
AGENT_TURN_TOTAL_TIMEOUT_MS=900000
AGENT_EVAL_MODEL_IDLE_TIMEOUT_MS=120000
AGENT_EVAL_MODEL_TOTAL_TIMEOUT_MS=600000
AGENT_EVAL_TURN_TOTAL_TIMEOUT_MS=900000
```

前三项全部留空时，聊天导师进入“确定性降级”。`LLM_EMBEDDING_MODEL` 是可选的检索向量器，不是第二个导师模型；配置了完整聊天三项时，未单独设置的 `LLM_EMBEDDING_BASE_URL` / `LLM_EMBEDDING_API_KEY` 会分别回落到聊天基址 / 密钥。需要在不启用聊天模型的进程中只使用嵌入时，嵌入基址、密钥、模型三项必须全部提供。嵌入任一字段不完整都会拒绝启动，避免把请求误发到另一条链路。只有服务明确支持 `/embeddings`，且允许把已去敏课程语料、经过手机号/邮箱/学号遮蔽的学生检索问题，以及每轮最多三条脱敏长期记忆候选片段发送到该服务时才配置。长期记忆写入向量后，后续召回只发送脱敏查询并在本地比较向量。未配置、超时或接口失败时，V3 自动使用放宽阈值的词法检索，导师回答不受阻断。`LLM_VISION_ENABLED` 不是按模型名称猜测的开关：只有服务明确兼容 `image_url` 输入时才设为 `true`；文本模型保持 `false`，作品图片会保存到对话但回答会明确说明未读取画面。课程规则、本地知识、证据与排障仍工作；语义审查不会自动通过。不要把真实模型地址或密钥写进文档、截图或 Git。

V3 使用两套超时配置。线上默认流式空闲 45 秒、单次模型硬总时长 120 秒、整回合硬总时长 180 秒；评测默认 120/600/900 秒。流式请求从发出时开始计算 idle，每收到一个非空原始传输块就重置；持续有数据也不能超过 model total。非流式请求只使用 model total。评测变量单独存在，是为了让长推理模型完成质量回归而不把线上交互无限拉长。每组都必须满足 `idle < model total < turn total`；修改任一评测超时后必须带 `--restart` 重新开始评测，不能复用旧断点。裸模型客户端未显式传入策略时仍保持 10 秒硬总默认。

## 3. 迁移并初始化演示数据

```powershell
pnpm db:migrate
pnpm db:seed
```

迁移、初始化和重置命令都会先读取项目根目录的 `.env.local`。初始化命令是事务性、可重复执行的；再次运行不会重复插入。成功输出包含：

- 演示班级码 `DIGI2026`；
- 四个预先签发的演示匿名编号；
- “仅供竞赛演示”的真实性提示。

匿名编号的获取方式以这次 `pnpm db:seed` 的终端输出为准。不要把编号硬编码进 README、演示截图或公开日志。每个编号用于一个演示学习者；需要从头复演时使用尚未进入过的编号，或按下一节安全重置。

## 4. 启动、检查与停止

```powershell
pnpm dev
```

浏览器访问 `http://localhost:3000`。本地 HTTP 仅用于开发，不可作为比赛公网入口。另开 PowerShell 检查健康状态：

```powershell
Invoke-RestMethod http://localhost:3000/api/health | ConvertTo-Json -Depth 4
```

期望 `status` 为 `ok`、`database.available` 为 `true`。`knowledge.chunkCount` 可以是 0；`aiConfigured` 只表示模型三项配置是否齐全，不返回配置值。

在运行开发服务的窗口按 `Ctrl+C` 停止。若窗口丢失，先确认占用进程再停止：

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess
Stop-Process -Id <确认后的OwningProcess>
```

不要对未确认的进程执行 `Stop-Process`。

## 5. 安全重置演示库

只重建空库：

```powershell
pnpm db:reset
```

重建并重新初始化演示数据：

```powershell
$env:SEED_AFTER_RESET = "true"
pnpm db:reset
Remove-Item Env:SEED_AFTER_RESET
```

重置脚本会拒绝生产环境、UNC/盘符根目录、工作区外路径、软链接/junction、相互包含的路径，以及名称中没有 `dev`、`test` 或 `demo` 的目标。它会暂存 SQLite 主文件和 sidecar，清理 `EVIDENCE_ROOT/demo`，迁移新库；任一步失败都会恢复原数据。不要绕过保护或手工删除真实证据目录。

## 6. 无模型降级演练

1. 停止服务。
2. 确认 `.env.local` 中 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 均未设置，而不是只删除其中一项。
3. 重新运行 `pnpm dev`。
4. 登录演示学习者，确认页面显示“确定性降级”。
5. 提交逻辑卡，确认规则反馈仍可用，语义审查保持待处理且不会自动判定通过。

## 7. 隐私清理与恢复

- 上传前清除截图中的姓名、人脸、手机号、邮箱、学号和聊天通知；只保留证明交互信号所需区域。
- 学生或授权教师从界面删除证据后，确认记录不再可见。
- 私有文件清理异常时执行 `pnpm evidence:recover`。不要手工删除 `.deleting-*` tombstone；详见 `docs/runbooks/evidence-storage.md`。

## 8. 完整验证

先停止本地开发服务，再依次执行：

```powershell
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

浏览器测试使用自己的隔离数据库与私有证据目录。生产构建检查可在构建后运行：

```powershell
$env:NODE_ENV = "production"
pnpm start
```

`pnpm start` 会先执行证据恢复；失败时不会启动服务。检查完成后按 `Ctrl+C`，再执行 `Remove-Item Env:NODE_ENV`。

## 9. 确认公网地址后生成二维码

只有项目负责人确认新的可访问 HTTPS 地址后，才在 `.env.local` 设置：

```text
PUBLIC_APP_URL=https://<confirmed-public-host>
```

然后执行：

```powershell
pnpm qr:generate
Get-FileHash public/competition-qr.svg -Algorithm SHA256
```

脚本拒绝 HTTP、凭据、查询参数、片段、localhost、私网 IP、`.local` 和不合法端口。成功后必须按 `docs/runbooks/competition-smoke-test.md` 用第二台设备扫码。当前地址未确认时，命令失败是正确行为，不得填入旧项目或虚构地址。

## 常见失败

- `ALLOW_DEMO_SEED`：确认路径含 `dev/test/demo`、`ALLOW_DEMO_SEED=true`，且 `NODE_ENV` 不是 production。
- 环境占位值：重新生成四个私有值，不能直接使用 `.env.example` 中的 `replace-with-*`。
- 3000 端口占用：按停止步骤确认进程，或先结束自己的开发服务。
- `503 degraded`：检查数据库文件是否存在、迁移是否完成、服务账户是否有读取权限；不要从健康响应寻找路径或密钥。
- E2E 浏览器缺失：安装 Playwright Chromium，或确认本机 Chrome 路径；不要复用正在运行的 3000 端口服务。
