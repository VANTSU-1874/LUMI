# 运行时配置来源

## 唯一真源规则

项目开发使用仓库根目录的 `.env.local`；正式本机服务和模型质量命令优先使用仓库外的 `service.env`：

```text
%LOCALAPPDATA%\ChuyingAI\config\service.env
```

也可以在启动进程中显式设置 `CHUYING_SERVICE_ENV` 指向另一份文件。这个显式路径不存在时命令会以 `SERVICE_ENV_NOT_FOUND` 失败，不会静默改用另一套模型配置。

服务感知命令的优先级为：

1. runner 明确设置的 `NODE_ENV`；
2. `service.env`；
3. 启动进程已有的环境变量；
4. Next 加载的项目 `.env.*` 文件；
5. 应用默认值。

模型配置不是跨来源逐字段合并。只要加载了 `service.env`，对话模型、`LLM_EMBEDDING_BASE_URL` / `LLM_EMBEDDING_API_KEY` / `LLM_EMBEDDING_MODEL`、视觉开关、输出上限和两套 Agent 超时配置就整体以该文件为准；`.env.local` 中同名旧值只会被标记为 `shadowedProjectModelConfig`，不会混进实际配置。同一份最终配置内部允许嵌入基址与密钥分别回落到聊天对应值；这不会跨越 `service.env` 与项目配置边界。

以下命令会自动查找默认外置配置：

- `agent:eval`、`tutor:quality`、`model:latency`；
- `agent:benchmark`、`agent:harness`、`tutor:promotion:verify`；
- `local-host:start`。

`knowledge:ingest` 默认只操作当前项目配置的数据库。只有显式设置 `CHUYING_SERVICE_ENV` 时，它才选择服务数据库，避免本地构建或测量意外写入全局演示库。

## 安全启动日志

服务感知命令在 stderr 输出一行 `effective-model-config`，只包含规范化的 `baseUrl`、安全来源名和是否遮蔽项目模型配置。它不会输出 API Key、Authorization、环境变量对象或模型正文，stdout 的最终 JSON 合同保持不变。

示意：

```json
{"event":"effective-model-config","baseUrl":"https://model.example/v1","source":"service-env","sourceFile":"%LOCALAPPDATA%\\ChuyingAI\\config\\service.env","shadowedProjectModelConfig":true}
```

## Worktree 与评测文件

新建 Git worktree 不会复制 ignored `.env.local`，但所有 worktree 都能看到同一份仓库外 `service.env`。以下任一配置在 `service.env` 中使用同一绝对路径时，对应最终报告、断点和锁都会被所有 worktree 共享：

- `AGENT_EVAL_REPORT_PATH`：`agent:eval` 的报告，以及同路径追加的 `.progress.json`、`.lock.sqlite`；
- `TUTOR_QUALITY_REPORT_PATH`：`tutor:quality` 的报告，以及同路径追加的 `.progress.json`、`.lock.sqlite`。

只要上述路径发生共享，同一种评测同一时间只能从一个 worktree 运行。另一个 worktree 不得带 `--restart` 抢跑，否则可能清除共享断点；发现 `AGENT_EVAL_ALREADY_RUNNING` 或对应质量评测锁冲突时，应等待现有进程结束，而不是删除锁文件。

## tsx 工具链自检

关键 npm/pnpm 命令在 runner 启动前，由纯 JavaScript 的 `scripts/check-runtime-tools.mjs` 按命令检查 `tsx`、`next`、`vitest` 或 `drizzle-kit` 的包入口和平台 shim。这样 `node_modules/.bin` 损坏时会直接报告：

```text
TOOLCHAIN_TSX_SHIM_MISSING
运行：pnpm install --frozen-lockfile
```

也可以单独执行：

```powershell
npm run runtime:preflight
```

不要把这个错误解释成模型、网络或业务代码故障，也不要删除锁文件。

## 待用户事项

- 用户方便时，可手工删除或同步 ignored `.env.local` 中过期的 `LLM_*` 项；在此之前代码已保证它们不会覆盖或拼入外置服务配置，此项不阻塞开发和部署准备。
