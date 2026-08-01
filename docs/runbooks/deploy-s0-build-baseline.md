# S0 本地构建基线

## 结论

固定提交 `bcc78b31658377d9ec3134418b447c1ab9fdf68c` 的生产构建、迁移、演示种子和三课程知识入库均已在本地隔离环境通过。

这只是部署管道测量基线，**不是最终部署源**。最终部署分支与提交仍需用户确认。

生产构建观测到的进程树峰值工作集为 **3475.6 MiB**，高于原计划估计的 2–3 GB。服务器若 `MemAvailable` 低于 4 GiB，不得原机构建；即使高于 4 GiB，也必须为同机现有站点保留余量，优先在本地构建后上传经过校验的产物。

## 测量边界

- 日期：2026-07-19（Asia/Shanghai）
- 源提交：`bcc78b31658377d9ec3134418b447c1ab9fdf68c`
- 源状态：tracked tree clean，detached scratch worktree
- 操作系统：Windows 本地开发机
- Node.js：`v24.14.0`
- npm：`11.9.0`
- 本机 pnpm：`11.9.0`
- 项目声明的包管理器：`pnpm@11.7.0`
- 模型配置：全部移除；没有模型或外部 API 调用
- 数据：只使用 scratch 内占位密钥、隔离演示数据库和私有证据目录

本地 scratch 为避免联网，使用本机 pnpm store 完成离线依赖准备；577 个包全部复用，下载数为 0。`better-sqlite3` 使用同一 Node ABI、同一依赖版本的已验证本机二进制，SHA-256 为 `E75B8C024A85179D8E0E51203A8B8867916E9A51327CE3953DB5F8483CC9A91E`。该 Windows scratch 处理仅用于测量，**不得复制到 Ubuntu 部署流程**。

## 结果

| 步骤 | 命令 | 环境 | 耗时 | 观测峰值工作集 | 结果 |
| --- | --- | --- | ---: | ---: | --- |
| 生产构建 | `npm run build`，解析为 `next build` | `NODE_ENV=production` | 19.081 s | 3475.6 MiB | 通过 |
| 数据库迁移 | `pnpm db:migrate` | `NODE_ENV=production` | 1.735 s | 150.3 MiB | 通过 |
| 演示种子 | `pnpm db:seed` | `NODE_ENV=development`、`ALLOW_DEMO_SEED=true` | 1.703 s | 150.7 MiB | 通过 |
| 知识入库 | `pnpm knowledge:ingest` | `NODE_ENV=production`、隔离 `CHUYING_SERVICE_ENV` | 1.760 s | 150.4 MiB | 通过 |

构建期间观测到的系统最低可用内存为 30853.8 MiB。构建进程树按 250 ms 目标间隔轮询，实际采样还包含 Windows WMI 查询开销；峰值是**已观测下限**，不是严格内存上限。

生产构建使用 `npm run build` 是因为离线 scratch 的依赖目录已完成且该命令直接执行仓库同一条 `next build` 脚本。正式 Ubuntu 部署仍应使用项目声明的 pnpm 版本完成 `pnpm install --frozen-lockfile` 和 `pnpm build`。

## 数据验证

最终隔离数据库验证结果：

- SQLite 表：46
- 预置演示班：1
- `book-design`：9 个知识块
- `digital-interaction`：17 个知识块
- `general-design`：8 个知识块

种子脚本在生产环境会主动拒绝执行。正式部署若需要预置演示数据，必须在隔离准备阶段以 `NODE_ENV=development`、`ALLOW_DEMO_SEED=true` 写入名称明确包含 `demo` 的数据库；完成后关闭种子开关，再以生产环境启动服务。预置数据必须在界面和报告中标明“预置”。

## 配置优先级警示

`pnpm knowledge:ingest` 会读取 `CHUYING_SERVICE_ENV`，若未显式设置，还会尝试读取仓库外的本机 `service.env`，并以它覆盖当前进程环境。所有迁移、种子、知识入库和部署命令都必须先确认配置源；自动化演练必须把 `CHUYING_SERVICE_ENV` 固定到隔离占位配置，避免误写既有数据库。

## 服务器决策阈值

1. `MemAvailable < 4 GiB`：禁止服务器原机构建，改为本地构建上传。
2. `MemAvailable >= 4 GiB`：仍需把现有站点占用计入；没有至少约 2 GiB 额外余量时，不原机构建。
3. 加 swap、停止任何现有服务或在服务器安装编译工具都属于需用户授权的写操作。
