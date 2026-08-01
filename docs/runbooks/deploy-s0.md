# Lumi S0 部署冒烟 Runbook

## 当前状态

2026-07-22（Asia/Shanghai），S0 服务器端安装与自动公网链路已按 `main@e60ddd0` 的执行令完成，外部 E 真人验收仍待用户完成。固定部署源为 `feature/lumi-integration@e9b91785151a600aa6f47e3b435907a10fe9a8d4`；`lumi-s0.service` 已启用且为 `active`，正式入口 [https://lumi.bot.cd](https://lumi.bot.cd) 返回 200。内部与公网 `/api/health` 均为 `ok`，数据库可用，知识库为 34 条（通用设计 8、数字交互 17、书籍设计 9）。

自动公网 API 冒烟已实际完成学生登录、唯一任务创建、活动运行 API 读取、会话 API 重读和一次真实模型回答；该回合为 `MODEL_ASSISTED`，总耗时 9.416 秒。两个既有站点均保持 HTTP 200 与原稳定页面标志，Lumi 服务最近 15 分钟无 warning。当前仍未完成浏览器加载/首字/真实刷新/退出登录、两台实体设备两种网络的二维码实扫；服务器健康页中的最终模型质量评测与 harness 也仍为 `not_run`，因此 `competitionReady=false`，不得把 S0 上线写成最终比赛质量全通过。

当前目标拓扑固定为：

```text
https://lumi.bot.cd
  -> 服务器现有 Caddy :443
  -> 127.0.0.1:3100 Lumi 可信代理
  -> 127.0.0.1:3000 Next.js
```

2026-07-21 已从服务器侧确认 `lumi.bot.cd` 的 A 记录解析为 `38.65.95.96`，且远端公网 IP 同为 `38.65.95.96`。不再启用临时 IP:端口公网暴露；3100 保持 loopback，仅由 Caddy 反代。Caddy 永远不得直连 3000；生产登录需要 3100 可信代理清除伪造头并生成 HMAC 签名的内部来源头，绕过它会导致登录返回 403。

服务器同时承载其他站点。本次只在 Caddyfile 末尾新增 Lumi 独立站点块，未修改既有块；Caddy 校验与 reload、旧站回归均已通过。

## 本次执行结论与剩余人工项

- 部署源：`feature/lumi-integration` 的 `e9b91785151a600aa6f47e3b435907a10fe9a8d4`。其业务代码与已留档 E2E 的 `d7cefd4` 相同，之后只增加了交接文档；`main@e60ddd0` 是最终执行令，不含应用源码。
- 传输：固定提交的 `git archive`，不用 remote。
- 正式入口：`https://lumi.bot.cd`，默认“公网可访问、不对外宣传”。DNS、Caddy、TLS 与 HTTPS 验收均已完成。
- 源归档已上传并完成双端 SHA-256 核对；归档不含本地未提交 WIP、`data/evidence-dev/`、数据库、上传目录或密钥，仅含受控的 `.env.example` 模板。
- 用户只在交互终端输入 sudo 密码；密码未进入聊天、脚本、日志或仓库。
- 已保留系统 Node 18，不替换同机运行时；Lumi 使用独立 Node `v22.23.1` 与 pnpm `11.7.0`，并配置专用 4 GiB swap 后完成服务器构建。
- 正式二维码已生成，但两台实体设备跨网络实扫仍由用户完成；未实扫前不得把“扫码可用”写成已验证事实。

## 配套文件

- [本地构建基线](deploy-s0-build-baseline.md)
- [systemd 模板](deploy-s0/lumi-s0.service.example)
- [Caddy 站点块](deploy-s0/Caddyfile.lumi.example)
- [外置环境模板](deploy-s0/lumi.env.example)

环境与 systemd 模板含未替换占位符，不能原样投入运行；Caddy 示例使用正式域名，但仍必须按服务器现有配置保护流程追加，不能覆盖整份 Caddyfile。

## 变量表

执行前由操作人与复核人共同填写，不把密钥写进本表：

| 变量 | 实测值 |
| --- | --- |
| SSH 用户 | `arlo`（别名 `arlo-vps`） |
| SSH 主机 | `38.65.95.96`；远端主机名 `9e477e46-4eee-41a6-8775-6f0c08fcbcd9` |
| 最终源提交 | `e9b91785151a600aa6f47e3b435907a10fe9a8d4` |
| 服务用户/组 | `lumi` / `lumi` |
| Node 绝对路径 | `/opt/lumi/runtime/node-v22.23.1/bin/node` |
| 发行目录 | `/opt/lumi/releases/e9b91785151a600aa6f47e3b435907a10fe9a8d4` |
| 当前发行链接 | `/opt/lumi/current` |
| 状态目录 | `/var/lib/lumi`；本次独立数据根 `/var/lib/lumi-deployments/demo-e9b91785151a.ZDrxvyMf` |
| 外置配置 | `/etc/lumi/lumi.env` |
| systemd 单元 | `lumi-s0.service` |
| 正式公网入口 | `https://lumi.bot.cd` |
| Caddy upstream | `127.0.0.1:3100`（绝不直连 3000） |
| Caddy 备份路径 | `/etc/caddy/Caddyfile.bak-20260721T162507Z` |
| 源归档 SHA-256 | `76c32d39e41d597ad02684b74e147c470dd64b3f2aea6851bb3374b16aba1d51` |
| 首次恢复点 | `/var/backups/lumi/2026-07-22T04-12-25-055Z-2601335b-8147-40dc-aba2-4b5b14aea8bf`，安装事务内验证成功 |
| 备份包装器恢复点 | `/var/backups/lumi/2026-07-22T05-11-51-752Z-fd8e6b98-2946-427a-969c-be73c39f86ed`，包装器端到端验证成功 |
| 现有站点基线清单 | `api.arlowoods.cc.cd`、`arlowoods.cc.cd`，详见下方执行记录 |

## 2026-07-21 至 2026-07-22 实际执行记录

以下结果来自 `arlo-vps`，不得用计划值替代：

| 检查项 | 实测结果 | 结论 |
| --- | --- | --- |
| 公网 IP | `38.65.95.96` | 与执行令一致 |
| 主机名 | `9e477e46-4eee-41a6-8775-6f0c08fcbcd9` | 已记录 |
| 系统 | Ubuntu 24.04.2 LTS，2 vCPU | 身份匹配 |
| 内存 / swap | 3.8 GiB 总量、约 2.8 GiB available、0 swap | 未加 swap 前禁止原机构建 |
| 根分区 | 58 GiB，总计约 43 GiB 可用 | 容量门通过 |
| Node / Corepack / pnpm | Node 18.19.1；Corepack、pnpm 不存在 | 不满足项目 `>=20.19 <25` / pnpm 11.7.0 |
| 3000 / 3100 | 变更前均未监听 | 端口无冲突 |
| Caddy | `active`，2.6.2；配置校验通过 | 允许在保护流程内追加站点块 |
| Caddyfile | `/etc/caddy/Caddyfile`，`root:root 0644` | 写入与 reload 需要 sudo |
| sudo | `sudo -n` 不可用，需要交互密码 | 阶段 B 与 Caddy 写操作阻塞 |
| Lumi 既有目录/服务 | `/opt/lumi`、`/var/lib/lumi`、`/etc/lumi` 与 `lumi-s0.service` 均不存在 | 确认为首次部署 |
| 域名解析 | `lumi.bot.cd -> 38.65.95.96` | DNS 门通过 |

变更前现有站点基线：

| 站点 | HTTPS | 响应体字节 | 响应体 SHA-256 | 证书到期 |
| --- | --- | ---: | --- | --- |
| `api.arlowoods.cc.cd` | 200 | 2676 | `a5bec1ae8a408e0b18fd14aa955143c9467c3ee366af0ace8b1de417bdb06604` | 2026-09-24 |
| `arlowoods.cc.cd` | 200 | 116 | `3c6e73504d9192a1f6db10d45f4b2633b7e757e708b14ca19efea5a0a7d3378b` | 2026-09-24 |

源码传输记录：

- 候选源码：`feature/lumi-integration@e9b91785151a600aa6f47e3b435907a10fe9a8d4`；`main@e60ddd0` 只含执行令而不含可部署应用树。
- 本地归档：`.runtime/deploy-s0/lumi-e9b91785151a600aa6f47e3b435907a10fe9a8d4.tar`，30,310,400 字节。
- 远端归档：`/tmp/lumi-e9b91785151a600aa6f47e3b435907a10fe9a8d4.tar`，`arlo:arlo 0600`。
- 双端 SHA-256：`76c32d39e41d597ad02684b74e147c470dd64b3f2aea6851bb3374b16aba1d51`，一致。
- 已执行：解包、独立运行时与依赖安装、服务器构建、迁移、预置种子、知识入库、systemd、首次一致性备份、每日备份 cron、Caddy 接入和自动公网 API 冒烟。

Caddy 接入尝试 1：用户通过交互 sudo 执行保护脚本，脚本创建 `/etc/caddy/Caddyfile.bak-20260721T161530Z` 后触发保护并恢复；复核显示 Caddyfile SHA-256 仍为变更前摘要、`lumi.bot.cd` 块数量为 0、Caddy 为 active，两个既有站点仍与变更前基线一致。原因是 `api.arlowoods.cc.cd` 的动态页面响应每次 SHA 不同，整页摘要不能作为稳定标志。

Caddy 接入最终结果：修订脚本改用稳定页面标志，2026-07-21 成功创建 `/etc/caddy/Caddyfile.bak-20260721T162507Z`，只在末尾新增 1 个 `lumi.bot.cd` 块及 1 个 `reverse_proxy 127.0.0.1:3100`；Caddyfile SHA-256 从 `433502cfa42a98d2a940435fe3384596a1e3375f7903c43a7fece6ac0611200e` 变为 `20aa52958e1f49bcf6c3e99fe012e875fdb8903fe3e1499d9a211d7cecc40b52`。`caddy validate` 通过、服务为 active，两个旧站点的 HTTP 200 与稳定页面标志均通过。`lumi.bot.cd` 证书主题正确，到期时间为 2026-10-19 15:26:39 UTC；应用启动前曾按预期返回 502，服务完成后已转为 200。

2026-07-22 最终部署与自动公网 API 冒烟：

| 检查项 | 实测结果 | 结论 |
| --- | --- | --- |
| 服务器构建 | Node `v22.23.1`、pnpm `11.7.0`；Build ID `7NjjjuloKr5kxSvOliUCK` | 固定源码构建成功，系统 Node 18 未改动 |
| systemd | `lumi-s0.service` 为 `active/enabled`；`User=lumi`、`Group=lumi`、`NoNewPrivileges=yes`、`ProtectSystem=strict`、`ProtectHome=yes` | 服务与基础收紧生效 |
| 监听端口 | `127.0.0.1:3000`、`127.0.0.1:3100`；公网 `38.65.95.96:3000/:3100` 均不可达 | 未临时暴露应用端口 |
| 健康检查 | 内部与公网均 `status=ok`；数据库可用；知识 34（8/17/9）；AI 已配置 | S0 运行链路通过 |
| 质量状态 | `agentQuality=not_run`、`agentHarness=not_run`、`competitionReady=false` | 部署成功不替代最终质量闸门 |
| 公网真实回合 | 登录、唯一任务、活动运行 API 读取、会话 API 重读、真实回答均成功；`MODEL_ASSISTED`；9.416 秒；回答 1086 字符 | 证明一次线上 API 端到端模型闭环，不构成浏览器真人体验或稳定性 SLA |
| TLS | TLS 1.3；`CN=lumi.bot.cd`；有效期至 2026-10-19 15:26:39 UTC | HTTPS 通过 |
| 代理与会话边界 | HTTP→HTTPS 为 308；health 为 `no-store`；直连 3000 登录为 403；向 3100 发送伪造可信头仍由代理清除并正常签名，登录为 200；Cookie 的 Secure、HttpOnly、SameSite=Lax、Path=/、Max-Age 均存在 | 生产登录必须经过可信代理，基础会话属性通过 |
| 旧站回归 | `api.arlowoods.cc.cd`、`arlowoods.cc.cd` 均 200，稳定标志通过 | 未观察到既有站点回归 |
| 首次备份 | `FIRST_BACKUP_VERIFY=SUCCEEDED`；恢复点见变量表 | 首次一致性恢复点已建立 |
| 运维基线 | cron 为 active；`/swapfile-lumi` 4 GiB 且 fstab 仅 1 条；根盘余 37 GiB；Lumi 日志敏感模式计数 0；Caddy 最近错误计数 0；已安装备份包装器单独运行成功 | 自动运维与备份包装器链路通过；隔离恢复演练仍待完成 |
| 二维码 | `public/competition-qr.svg`，SHA-256 `4ae0e5ae0a410f31754673aefacd7f558f9d2c93c2ee6df020d76b6974592490` | 生成与 72 项单元测试通过；双设备实扫待用户完成 |

最终安装输出中，服务刚启动时的有界等待循环曾出现 3 次 `curl: (7)`（`127.0.0.1:3100` 尚未开始监听）；随后同一脚本通过严格健康门，并确认服务为 `active/enabled`。2026-07-22 又从本机复核公网首页为 200、健康状态为 `ok`、数据库可用、AI 已配置、知识 34 条，因此这 3 次属于冷启动期间的短暂重试，不是最终部署失败。该复核仍不替代真人浏览器体验或最终质量评测。

最终安装前有两次 fail-closed 预检失败，均发生在正式 env、unit、current、cron 和备份程序落盘之前，Caddy 与既有站点未被修改：第一次发现 `umask 077` 令候选 env 实际为 `0600`，与预期 `root:lumi:0640` 不一致，随后改为在已打开文件描述符上显式 `fchmod(0640)`；第二次发现只读 SQLite 校验会为 WAL 模式数据库重新留下空 WAL 与 SHM，经隔离复现后改为由 SQLite 完成 `wal_checkpoint(TRUNCATE)`、切换 `journal_mode=DELETE`、再进入 query-only 完整性校验。两项修复均经过双重静态审计、语法检查与目标机 SHA 校验后重跑。最终安装输出 `STATUS=SUCCEEDED`，源配置暂存文件已安全移除（`SOURCE_ENV_REMOVED=true`）。失败现场保留为 root-only 证据，不作为运行数据复用。

部署辅助脚本最终摘要：安装脚本 `ff073099daaedec1268e904498a64b63b5342508ea4b3fc1acf6a90f66f9b379`；备份脚本 `b35fd4135d2101bc0939048e7232b8a4143a0439a758d658153ab86c88535f48`；公网 smoke `b20ca252b932633e3172742d3fa10a117840b0a352959a1081be4f63eac2e83d`。三者位于本地忽略目录 `.runtime/deploy-s0/`，只作为本次受控执行工具，不构成产品源码交付。

> **在线实例保护：** 首次安装已经完成。`lumi-finalize-service.sh` 明确是 `MODE=FRESH_INSTALL_ONLY`，不得在当前在线实例重跑本手册第一至第九阶段，不得覆盖 `/etc/lumi/lumi.env`，也不得重复追加 Caddy 站点块。后续变更只能走本手册“增量更新流程”，并先取得已验证恢复点。

## 第一阶段：只读体检

以下阶段只读。尚未获得写操作授权时，只能执行到这里。

本机已配置 SSH Host alias，身份检查命令：

```powershell
ssh -o BatchMode=yes -o ConnectTimeout=10 arlo-vps
```

登录后记录系统与资源：

```bash
id
hostnamectl
cat /etc/os-release
uptime
free -h
grep -E 'MemAvailable|SwapTotal|SwapFree' /proc/meminfo
swapon --show
df -hT
nproc
command -v node || true
node -v || true
command -v corepack || true
corepack --version || true
command -v pnpm || true
pnpm --version || true
git --version || true
```

记录 Caddy、监听端口和现有服务，不输出完整配置中的潜在敏感值：

```bash
systemctl is-active caddy
sudo systemctl status caddy --no-pager -l
sudo systemctl cat caddy
sudo caddy version
sudo caddy validate --config /etc/caddy/Caddyfile
sudo ss -ltnp
sudo ss -ltnp '( sport = :3000 or sport = :3100 )'
ps -eo pid,user,etimes,cmd | grep -E '[n]ode|[n]ext|[p]npm' || true
sudo grep -nE '^[[:space:]]*([A-Za-z0-9*_.:-]+([[:space:]]*,[[:space:]]*[A-Za-z0-9*_.:-]+)*)[[:space:]]*\{' /etc/caddy/Caddyfile
sudo grep -nE '^[[:space:]]*(import|reverse_proxy|bind)[[:space:]]+' /etc/caddy/Caddyfile
systemctl list-units --type=service --state=running --no-pager
systemctl list-unit-files --type=service --no-pager | grep -Ei 'lumi|node|next' || true
sudo ufw status verbose
```

若 Caddyfile 使用 `import`，继续只读检查实际导入文件的站点标题与 upstream；不得只看主文件就开始追加。

对每个既有站点记录：URL、HTTP 状态、最终跳转地址、证书到期时间和一个稳定页面标志。下面命令中的 URL 必须来自体检结果：

```bash
curl -fsSIL --max-time 15 https://<EXISTING_SITE_1>
curl -fsS --max-time 15 https://<EXISTING_SITE_1> | grep -F '<STABLE_MARKER>'
```

### 只读体检停止条件

出现任一项即停止写操作并上报：

1. SSH 用户、认证方式或 sudo 权限不明确。
2. Caddy 当前已失败，或任何既有站点基线在变更前就不正常。
3. 3000 或 3100 已被其他进程占用。
4. `MemAvailable < 4 GiB`，却仍计划在服务器原机构建。
5. Node 不满足 `>=20.19.0 <25`，或 pnpm 不是项目批准版本。
6. Caddy 配置位置不是 `/etc/caddy/Caddyfile`，或包含尚未核对的导入层。
7. 磁盘、inode 或 swap 状态不足以安全构建并保留旧发行。
8. 最终源提交、传输方式或回滚恢复点未确认。

本地实测构建进程树峰值为 3475.6 MiB。若服务器要原机构建，除了这部分还必须给现有站点和操作系统保留余量；建议至少约 6 GiB 可用内存。否则使用匹配 Ubuntu 与 Node ABI 的 Linux 构建环境生成产物，或经用户授权增加 swap。**不得把 Windows `node_modules` 或 Windows 原生模块上传到 Ubuntu。**

## 第二阶段：准备固定源提交

此阶段及以后均属于写操作，需要用户授权。

仓库当前没有 remote。若选择归档传输，在本地干净 worktree 中执行：

```powershell
$SourceCommit = '<SOURCE_COMMIT>'
$ArchivePath = "lumi-$SourceCommit.tar"
git status --short
git show --no-patch --oneline $SourceCommit
git archive --format=tar --output=$ArchivePath $SourceCommit
Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256
```

只有 `git status --short` 符合预期、提交已复核、SHA-256 已记录后才能上传。上传命令需在用户批准后补入真实 SSH 用户：

```powershell
scp -o ConnectTimeout=10 $ArchivePath <SSH_USER>@38.65.95.96:/tmp/
```

服务器先核对摘要，再解包到不可变发行目录：

```bash
sha256sum /tmp/lumi-<SOURCE_COMMIT>.tar
sudo install -d -m 0755 /opt/lumi/releases/<SOURCE_COMMIT>
sudo tar -xf /tmp/lumi-<SOURCE_COMMIT>.tar -C /opt/lumi/releases/<SOURCE_COMMIT>
```

若改用私有 remote，必须先确认服务器最小权限部署凭据和目标提交，再以 detached commit 部署；不得直接跟随一个会移动的分支头。

## 第三阶段：运行用户、目录与依赖

先创建专用非登录服务用户。示例中的名称须与最终 systemd 模板一致：

```bash
sudo useradd --system --home /var/lib/lumi --shell /usr/sbin/nologin <SERVICE_USER>
sudo install -d -o <SERVICE_USER> -g <SERVICE_GROUP> -m 0750 /var/lib/lumi
sudo install -d -o root -g <SERVICE_GROUP> -m 0750 /var/lib/lumi-deployments
sudo install -d -o <SERVICE_USER> -g <SERVICE_GROUP> -m 0750 /var/lib/lumi-deployments/<DATA_ROOT>
sudo install -d -o <SERVICE_USER> -g <SERVICE_GROUP> -m 0750 /var/lib/lumi-deployments/<DATA_ROOT>/evidence
sudo install -d -o <SERVICE_USER> -g <SERVICE_GROUP> -m 0750 /var/lib/lumi-deployments/<DATA_ROOT>/quality
sudo install -d -o root -g <SERVICE_GROUP> -m 0750 /etc/lumi
```

`<DATA_ROOT>` 必须替换为本次发布唯一且不可复用的目录名，并与 `lumi.env` 中四个数据/质量路径使用同一个值；不得把运行数据重新放回固定的 `/var/lib/lumi/evidence` 或 `/var/lib/lumi/quality`。

在已通过内存门的情况下，于发行目录安装依赖并构建：

```bash
cd /opt/lumi/releases/<SOURCE_COMMIT>
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm build
test -f .next/BUILD_ID
```

如果 Node、Corepack、编译工具或原生依赖缺失，停止并取得安装授权。不要为了赶进度升级同机其他站点正在使用的全局 Node；优先为 Lumi 使用固定的独立 Node 路径。

## 第四阶段：外置生产配置

从 `docs/runbooks/deploy-s0/lumi.env.example` 复制到仓库外 `/etc/lumi/lumi.env`，替换全部占位值。密钥建议使用 base64url 字符，避免空格、引号与 shell 元字符。

```bash
sudo install -o root -g <SERVICE_GROUP> -m 0640 docs/runbooks/deploy-s0/lumi.env.example /etc/lumi/lumi.env
sudo grep -nE 'REPLACE_|replace-with-' /etc/lumi/lumi.env
```

只要第二条命令仍输出任何一行，就禁止启动。真实配置不得通过终端回显、聊天、截图或 Git 传递。

必须确认：

- `DATABASE_PATH`、`EVIDENCE_ROOT` 与质量报告目录位于 root 管理的唯一 `/var/lib/lumi-deployments/demo-<commit>.<random>/` 数据根；`/var/lib/lumi` 只作为服务 home/状态根。不得回退到历史固定数据库路径；
- 三个模型变量成组配置，`LLM_BASE_URL` 含供应商要求的 `/v1`；
- `PUBLIC_APP_URL=https://lumi.bot.cd`；
- `ALLOW_DEMO_SEED=false`、`ALLOW_QUICK_TUNNEL_ORIGIN=false`；
- `AGENT_V2_ENABLED=true`、`AGENT_V3_ENABLED=true`；
- `CHUYING_SERVICE_ENV` 由 systemd 固定为该文件，避免误读其他环境。

## 第五阶段：迁移、演示种子与知识入库

应用保持停止。首次演示库可以在明确的非生产准备步骤中写入预置数据，但生产服务本身永远保持 `ALLOW_DEMO_SEED=false`。

由于环境文件包含密钥，以下命令不得开启 shell trace，也不得把环境打印到日志：

```bash
cd /opt/lumi/releases/<SOURCE_COMMIT>
sudo -u <SERVICE_USER> bash -c 'set -a; . /etc/lumi/lumi.env; set +a; NODE_ENV=production corepack pnpm db:migrate'
sudo -u <SERVICE_USER> bash -c 'set -a; . /etc/lumi/lumi.env; set +a; NODE_ENV=development ALLOW_DEMO_SEED=true corepack pnpm db:seed'
sudo -u <SERVICE_USER> env CHUYING_SERVICE_ENV=/etc/lumi/lumi.env NODE_ENV=production corepack pnpm knowledge:ingest
```

种子输出含演示访问资料，只能保存到权限受控的演示交接记录，不得粘贴进公开日志或报告。所有预置数据必须在界面和报告中明确标为“预置”。

知识入库必须显式设置 `CHUYING_SERVICE_ENV`；否则脚本可能读取另一份仓库外配置并写错数据库。期望三包计数为：书籍设计 9、数字交互 17、通用设计 8；若最终源提交改变语料，按该提交重新记录实际值。

重复部署或已有数据库升级前，先停止服务，并用项目的 `backup:create` 与 `backup:verify` 为 SQLite 和 evidence 建立一致恢复点。未拿到已验证恢复点不得执行迁移。

## 第六阶段：安装并启动 systemd

从模板生成 `/etc/systemd/system/lumi-s0.service`，替换：

- `@@SERVICE_USER@@`
- `@@SERVICE_GROUP@@`
- `@@RELEASE_ROOT@@`
- `@@NODE_BINARY@@`

确认 `.next/cache` 和 `/var/lib/lumi` 可由服务用户写入，然后验证并启动：

```bash
sudo systemd-analyze verify /etc/systemd/system/lumi-s0.service
sudo systemctl daemon-reload
sudo systemctl enable --now lumi-s0.service
sudo systemctl status lumi-s0.service --no-pager -l
sudo journalctl -u lumi-s0.service --since '-5 minutes' --no-pager
sudo ss -ltnp '( sport = :3000 or sport = :3100 )'
curl -fsS http://127.0.0.1:3100/api/health
```

正常链路必须同时监听 3000 与 3100，公网只会接触 3100。日志不得出现密钥、访问码、Cookie、模型提示或上传内容。

## 第七阶段：接入 `lumi.bot.cd`

前置检查与接入已于 2026-07-21 完成：服务器侧解析 `lumi.bot.cd` 得到 `38.65.95.96`；服务器公网 IP 同为 `38.65.95.96`；Caddy 为 `active`；变更前配置 SHA-256 为 `433502cfa42a98d2a940435fe3384596a1e3375f7903c43a7fece6ac0611200e`。实际备份路径、变更后摘要、校验、reload、证书与旧站回归见本手册执行记录。

先生成唯一备份并记录摘要：

```bash
export CADDY_BACKUP="/etc/caddy/Caddyfile.bak-$(date -u +%Y%m%dT%H%M%SZ)"
sudo cp --preserve=all /etc/caddy/Caddyfile "$CADDY_BACKUP"
sudo sha256sum /etc/caddy/Caddyfile "$CADDY_BACKUP"
```

仅在完整 Caddyfile **末尾**追加下面的独立站点块，不修改、重排或格式化任何既有块：

```caddyfile
lumi.bot.cd {
    reverse_proxy 127.0.0.1:3100
}
```

随后先校验，只有校验通过才允许 reload：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl is-active caddy
sudo journalctl -u caddy --since '-5 minutes' --no-pager
```

必须使用 `reload`，不能 `restart`。验证失败时不允许 reload。

## 第八阶段：现有站点无损回归

Caddy reload 后立即逐项执行，并与变更前基线比较：

- [x] Caddy 为 `active`，最近日志无新错误；
- [x] 每个既有站点 HTTP 状态与最终跳转一致；
- [x] 每个既有站点证书仍有效；
- [x] 每个既有站点的稳定页面标志仍出现；
- [x] 既有 upstream 端口与服务状态未变化；
- [x] Lumi 的 3000/3100 仅监听 loopback；
- [x] 公网 443 可达，`38.65.95.96:3000/:3100` 均不可达；
- [x] 未触发 Caddy 回滚条件。

回归命令对每个既有站点重复：

```bash
curl -fsSIL --max-time 15 https://<EXISTING_SITE>
curl -fsS --max-time 15 https://<EXISTING_SITE> | grep -F '<STABLE_MARKER>'
```

## 第九阶段：公网、HTTPS 与二维码

`lumi.bot.cd` 已由用户创建 A 记录并直连 `38.65.95.96`，本轮不修改任何其他 DNS 记录，也不要求 CDN/Cloudflare 变更。Caddy 应通过公网 80/443 自动签发证书；失败时先检查入站可达性和 Caddy 日志，不改现有站点。

公网验证：

```bash
curl -fsSIL --max-time 20 https://lumi.bot.cd
curl -fsS --max-time 20 https://lumi.bot.cd/api/health
```

随后由真人完成演示登录和一次真实对话，确认加载态、首字反馈、刷新恢复与退出登录。不得用健康检查代替登录和对话。

2026-07-22 自动公网 API 冒烟使用公开演示身份完成了登录、唯一任务创建、活动 run API 读取、真实模型回答与 conversation API 重读：该回合为 `MODEL_ASSISTED`，总耗时 9.416 秒，脚本字段 `refreshRecovery=true` 仅表示持久状态可由 API 重读，不等于真实浏览器刷新体验。脚本不输出 Cookie、内部任务/运行标识或回答正文。浏览器加载态、首字感受、真实刷新、退出登录、视觉体感与移动端操作仍由真人检查，不由该自动回合代签。

自动公网 API 冒烟通过后，才在目标源码工作区中使用已确认的正式地址生成二维码：

```powershell
$env:PUBLIC_APP_URL = 'https://lumi.bot.cd'
pnpm qr:generate
Get-FileHash -LiteralPath 'public/competition-qr.svg' -Algorithm SHA256
```

二维码必须由校园 Wi-Fi 与蜂窝网络两台设备实扫，并记录同一 SHA-256。

正式二维码已生成到 `public/competition-qr.svg`，SHA-256 为 `4ae0e5ae0a410f31754673aefacd7f558f9d2c93c2ee6df020d76b6974592490`；生成器定向测试 1/1 文件、72/72 用例通过。两台实体设备跨网络实扫仍为 `PENDING_MANUAL`。

## 每日一致性备份（cron，保留 7 份）

首次迁移与种子完成后已创建 `/var/backups/lumi`，所有权为 `root:lumi`、权限为 `1770`；已验证标志位于独立的 root-only `/var/backups/lumi-verified`。该目录与 `/var/lib/lumi` 分离且不是软链接。备份脚本固定使用 `/opt/lumi/current`、`/etc/lumi/lumi.env` 和独立 Node 绝对路径，不依赖交互 shell 的 PATH。

每日低峰期按以下顺序执行：

1. 停止 `lumi-s0.service` 并等待进入 inactive，避免备份过程中源文件继续变化；
2. 从 `/etc/lumi/lumi.env` 读取 `DATABASE_PATH`、`EVIDENCE_ROOT`，设置 `BACKUP_BASE=/var/backups/lumi`；
3. 执行 `backup:create`，从单行 JSON 读取这次真实 `backupPath`；
4. 只对该路径执行 `backup:verify`；
5. 验证成功后启动服务并检查内部 `/api/health`；
6. **只有本次新备份验证成功后**，才按创建时间保留最近 7 个已完成目录。名字以 `.incomplete` 结尾的现场不得自动删除；
7. 输出写入 `/var/log/lumi-backup.log`，任一步失败必须返回非零并恢复启动服务。

实际安装位置：

```text
/usr/local/sbin/lumi-backup
/etc/cron.d/lumi-backup
/var/backups/lumi
/var/log/lumi-backup.log
```

实际 cron：

```cron
17 3 * * * root /usr/local/sbin/lumi-backup >> /var/log/lumi-backup.log 2>&1
```

安装事务在服务启动前已执行首次 `backup:create` 与 `backup:verify`，输出 `FIRST_BACKUP_VERIFY=SUCCEEDED`，首次恢复点绝对路径见变量表；cron 文件为 `root:root 0644`。

2026-07-22 又以安装后的 `/usr/local/sbin/lumi-backup` 独立执行一次端到端验证。包装器按预期停服，创建并验证包含 3 个文件的新恢复点，校验结果为 `evidenceReferenceCount=0`，封存后输出 `STATUS=SUCCEEDED`、`COMPLETED_BACKUP_COUNT=2`，随后自动启动服务。启动等待循环出现 3 次短暂 `curl: (7)` 后通过内部健康门；代理另行复核服务为 `active/enabled`、内部和公网健康均为 `ok`，两个既有站点仍为 200 且稳定标志存在。该结果验证了包装器的停服、创建、校验、封存、保留清单与复起链路；当前只有 2 个恢复点，未触发超过 7 份时的实际删除分支，也未覆盖含真实 evidence 引用的非空证据树。

本次没有执行破坏性的真实恢复演练，因此“可恢复”仍需以后在隔离目录验证，不能仅凭备份创建与验证成功扩大表述。恢复前必须停服，使用 `BACKUP_BASE`、选定的 `BACKUP_PATH` 与独立的 `RESTORE_BASE` 运行 `backup:restore`，再切换外置环境中的数据库与 evidence 路径。数据库迁移没有自动 down，禁止让旧版本直接读取未经验证的新结构。

## 增量更新流程

当前仓库没有 remote，禁止把计划中的 `git pull` 当成真实上线流程。每次更新执行：

1. 在本地冻结一个可审计的精确提交，记录该提交绑定的测试与构建证据；
2. 服务保持运行时先创建并验证一致恢复点；
3. 对精确提交执行 `git archive`，记录 SHA-256，经 `scp arlo-vps:/tmp/` 传输并在服务器复核；
4. 在新的不可变 `/opt/lumi/releases/<NEW_COMMIT>` 安装与构建，绝不覆盖当前发行；
5. 停服，按新提交执行迁移；
6. 将 `/opt/lumi/current` 原子切换到新发行，启动并完成内部健康检查；
7. 验证 `https://lumi.bot.cd` 的登录、真实聊天与刷新恢复，再重跑两个既有站点基线；
8. 任一项失败，停服并切回上一发行；若迁移结构不兼容，同时恢复步骤 2 的已验证 SQLite + evidence 恢复点。

将来如配置最小权限 private remote，可以把第 3 步换成 detached commit fetch；仍不得直接跟随可移动分支头执行 `git pull && build` 后上线。

## 临时公网暴露收回记录

域名在应用启动前已经生效，因此本轮没有把 3100 改为 `0.0.0.0`，也没有新增 IP:端口防火墙或 NAT 规则。验收时必须确认：

- 3100 仅监听 `127.0.0.1`；
- 3000 仅监听 `127.0.0.1`；
- 从外网访问 `38.65.95.96:3000` 与 `:3100` 均失败；
- 只有 `https://lumi.bot.cd` 经 Caddy 到 3100 可达。

## Caddy 回滚

任一既有站点在 reload 后异常：

```bash
export CADDY_BACKUP=/etc/caddy/Caddyfile.bak-20260721T162507Z
sudo cp --preserve=all "$CADDY_BACKUP" /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl is-active caddy
```

然后完整重跑所有既有站点基线。备份恢复也失败时，停止进一步操作，保留文件和日志现场，不执行删除或重装。

## 应用回滚

如果 Caddy 与既有站点正常，但 Lumi 冒烟失败：

```bash
sudo systemctl stop lumi-s0.service
sudo systemctl status lumi-s0.service --no-pager -l
```

首次部署直接保持服务停止，并回滚 Lumi 的 Caddy 独立块。不要删除 `/var/lib/lumi`、`/var/lib/lumi-deployments` 或 `/var/backups/lumi`，以便取证和恢复。

升级部署则把 `/opt/lumi/current` 切回已知良好发行，再启动验证：

```bash
sudo ln -sfn /opt/lumi/releases/<PREVIOUS_COMMIT> /opt/lumi/current
sudo systemctl start lumi-s0.service
curl -fsS http://127.0.0.1:3100/api/health
```

数据库迁移没有自动 down。若新版本迁移后旧版本不兼容，必须在服务停止时恢复发布前已验证的 SQLite 与 evidence 一致恢复点，再启动旧发行。不得让旧代码直接读取未知的新结构，也不得覆盖或删除旧数据来“回滚”。

## 授权与人工动作记录

用户已授权执行 S0：连接 `arlo-vps`、上传固定源码归档、创建 Lumi 专用目录/用户、配置独立运行时与必要 swap、写外置配置、迁移/种子/知识入库、安装 systemd 与每日备份、保护性接入 Caddy、异常时回滚，以及完成自动公网 API 冒烟。`lumi.bot.cd` 的 A 记录已由用户建立；本轮不修改 Cloudflare 或其他 DNS 记录。

用户已按要求只在本地终端为服务器 sudo 提示输入密码；密码未发送到聊天、脚本、日志或环境文件。已执行的单用途 Caddy 脚本为 `/home/arlo/lumi-caddy-domain.sh`，所有者 `arlo:arlo`、权限 `0700`、最终版 SHA-256 `fcbed5a1ff1ee651d71ee7a2a7945ac9ac65af9c671040ad40e794519ad67f2c`。执行命令为：

```powershell
ssh -t arlo-vps "sudo bash /home/arlo/lumi-caddy-domain.sh"
```

该脚本有 Caddyfile 预检摘要门、先备份、只追加独立块、validate-before-reload、现有站点前后内容对比和自动恢复。执行结果及生成的备份绝对路径已经回填到本手册的实际执行记录。
