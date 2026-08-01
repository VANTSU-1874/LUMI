# 触映：数字交互文创课程智能体

“触映”是面向 64 课时《数字交互文创设计》课程的独立 Web 应用。它用诊断、六元交互逻辑、DigiShow/TouchDesigner/协作路径、证据化排障和迁移挑战，帮助学生从照背操作步骤走向理解交互因果链。

## 事实边界

- 预置比赛案例始终标为“演示数据”，不代表真实学生成效；教师统计默认排除演示数据。
- 未配置模型时，系统明确显示“确定性降级”：课程规则与本地知识仍可使用，语义审查保持待处理，绝不自动判定通过。
- 截图保存在服务端私有目录，不放入 `public/`；只接收 PNG、JPEG、WebP，不接收摄像头原始视频。
- 临时 HTTPS 入口已经通过公网演练，但尚未确认固定 `PUBLIC_APP_URL`；因此仓库不把临时隧道写成正式二维码。固定地址通过后再按手册生成并用第二台设备实扫。

## 本地启动

Windows PowerShell 的完整步骤见 [本地开发与演示手册](docs/runbooks/local-development.md)。核心命令是：

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm dev
```

执行前必须从 `.env.example` 创建 `.env.local`，替换所有占位值，并保持开发数据库路径含 `dev`、`test` 或 `demo`。`pnpm db:seed` 成功后会在终端给出演示班级码和四个演示匿名编号；不要把这些登录信息写入 Git 或公开截图。

## 验证命令

```powershell
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

浏览器测试自带隔离数据库和登录数据；运行前先停止占用 3000 端口的开发服务。

## 运维入口

- [本地开发与演示](docs/runbooks/local-development.md)
- [本机常驻托管](docs/runbooks/local-computer-hosting.md)
- [公开部署、备份与回滚](docs/runbooks/deployment.md)
- [比赛前冒烟测试记录表](docs/runbooks/competition-smoke-test.md)
- [教育Agent竞赛可交付完成度审计](docs/release/agent-competition-readiness.md)
- [真实试用协议](docs/pilot-protocol.md)与[匿名观察表](docs/templates/pilot-observation-sheet.md)
- [私有证据存储与恢复](docs/runbooks/evidence-storage.md)
- [可信认证反向代理约定](docs/runbooks/trusted-auth-proxy.md)
- 隐私说明页面：`/privacy`
- 公开健康检查：`/api/health`

只有在新 HTTPS 入口由项目负责人确认后，才在环境中设置 `PUBLIC_APP_URL` 并运行：

```powershell
pnpm qr:generate
```

该命令只接受不含凭据、查询参数或片段的公网 HTTPS 地址，并原子写入 `public/competition-qr.svg`。
