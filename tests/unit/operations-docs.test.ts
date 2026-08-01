// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

async function text(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("operational documentation contract", () => {
  it("exposes the exact supported operation scripts and safe environment template", async () => {
    const packageJson = JSON.parse(await text("package.json")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    const example = await text(".env.example");

    expect(packageJson.scripts).toMatchObject({
      "db:migrate": "tsx lib/db/migrate.ts",
      "db:seed": "tsx scripts/seed-demo.ts",
      "db:reset": "tsx scripts/reset-db.ts",
      "evidence:recover": "tsx scripts/recover-evidence.ts",
      "qr:generate": "tsx scripts/generate-qr.ts",
      "backup:create": "tsx scripts/create-backup.ts",
      "backup:verify": "tsx scripts/verify-backup.ts",
      "local-host:setup": "tsx scripts/setup-local-host.ts",
      "local-host:prepare": "tsx scripts/prepare-local-release.ts",
      "local-host:start": "tsx scripts/start-local-host.ts",
      "local-host:verify": "tsx scripts/verify-local-host.ts",
      "agent:benchmark": "tsx scripts/benchmark-agent-runtime.ts",
      "agent:harness": "tsx scripts/run-agent-harness.ts",
      "runtime:preflight": "node scripts/check-runtime-tools.mjs --tools tsx,next,vitest,drizzle-kit",
      "preagent:eval": "node scripts/check-runtime-tools.mjs --tools tsx",
      "pilot:prepare": "tsx scripts/prepare-pilot.ts",
      "pilot:observation": "tsx scripts/generate-pilot-observation-pack.ts",
      "pilot:preflight": "tsx scripts/preflight-pilot.ts",
      start: "next start --hostname 127.0.0.1 --port 3000",
    });
    expect(packageJson.dependencies.qrcode).toBeDefined();
    expect(example).toMatch(/ALLOW_DEMO_SEED=true/);
    expect(example).toMatch(/AGENT_HARNESS_REPORT_PATH=/);
    expect(example).toMatch(/^# PUBLIC_APP_URL=$/m);
    expect(example).not.toMatch(/^# PUBLIC_APP_URL=.+$/m);
    expect(example).not.toMatch(/shuzi-yijing-community-map/i);
  });

  it("keeps the README and runbooks discoverable without inventing a public URL", async () => {
    const files = await Promise.all([
      text("README.md"),
      text("docs/runbooks/local-development.md"),
      text("docs/runbooks/local-computer-hosting.md"),
      text("docs/runbooks/deployment.md"),
      text("docs/runbooks/competition-smoke-test.md"),
      text("docs/pilot-protocol.md"),
      text("docs/templates/pilot-observation-sheet.md"),
      text("docs/release/agent-competition-readiness.md"),
      text("docs/runbooks/runtime-configuration.md"),
    ]);
    const combined = files.join("\n");

    expect(files[0]).toContain("docs/runbooks/local-development.md");
    expect(files[0]).toContain("docs/runbooks/local-computer-hosting.md");
    expect(files[0]).toContain("docs/runbooks/deployment.md");
    expect(files[0]).toContain("docs/runbooks/competition-smoke-test.md");
    expect(files[0]).toContain("docs/pilot-protocol.md");
    expect(files[0]).toContain("docs/templates/pilot-observation-sheet.md");
    expect(combined).toContain("pnpm install --frozen-lockfile");
    expect(combined).toContain("pnpm db:migrate");
    expect(combined).toContain("pnpm db:seed");
    expect(combined).toContain("pnpm local-host:setup");
    expect(combined).toContain("pnpm local-host:verify");
    expect(combined).toContain("pnpm agent:harness");
    expect(combined).toContain("pnpm pilot:prepare");
    expect(combined).toContain("pnpm pilot:observation");
    expect(combined).toContain("pnpm pilot:preflight");
    expect(combined).toContain("127.0.0.1:3100");
    expect(combined).toContain("ChuyingAI-LocalHost");
    expect(combined).toContain("install-local-release.ps1");
    expect(combined).toContain("register-local-host-task.ps1");
    expect(combined).toContain("stop-local-host-task.ps1");
    expect(combined).toContain("prepare-local-release.ts");
    expect(combined).toContain("ChuyingAI\\releases");
    expect(combined).toContain("Unregister-ScheduledTask");
    expect(combined).toContain("pnpm test:e2e");
    expect(combined).toContain("pnpm qr:generate");
    expect(combined).toContain("PUBLIC_APP_URL");
    expect(combined).toContain("CHUYING_SERVICE_ENV");
    expect(combined).toContain("effective-model-config");
    expect(combined).toContain("TOOLCHAIN_TSX_SHIM_MISSING");
    expect(combined).not.toMatch(/shuzi-yijing-community-map/i);
    expect(files[7]).toContain("123个文件、1059项通过");
    expect(files[7]).toContain("Harness 16/16");
    expect(files[7]).toContain("浏览器E2E");
    expect(files[7]).toContain("READY_FOR_HUMAN");
    expect(files[7]).toContain("PENDING_EXTERNAL");
    expect(files[7]).toContain("当前NXDOMAIN");
    expect(files[7]).not.toContain("发布决定：PASS");
  });

  it("documents every deployment safety boundary and signable competition check", async () => {
    const deployment = await text("docs/runbooks/deployment.md");
    const smoke = await text("docs/runbooks/competition-smoke-test.md");

    for (const phrase of [
      "HTTPS", "SQLite", "EVIDENCE_ROOT", "服务账户", "密钥", "10 秒", "/api/health",
      "回滚", "迁移不可逆", "一致性备份", "恢复演练", "日志脱敏", "tombstone", "备案",
      "pnpm backup:create", "pnpm backup:verify", "$LASTEXITCODE", "WaitForServiceStatus",
      "127.0.0.1:3000",
    ]) expect(deployment).toContain(phrase);
    expect(deployment.match(/\$LASTEXITCODE/g)?.length).toBeGreaterThanOrEqual(10);
    for (const phrase of [
      "签名", "日期时间", "设备", "HTTPS", "演示入口", "开放学习支架", "真实截图净化",
      "确定性降级", "演示数据", "隐私删除", "/api/health", "两台设备", "Agent 三知识包",
      "匿名真实试用报告", "教师真人 10 分钟演练", "真实学生试用与双人复核",
    ]) expect(smoke).toContain(phrase);
    const observation = await text("docs/templates/pilot-observation-sheet.md");
    for (const phrase of ["试用匿名编号", "首次下一步", "认知参与", "教师代操作次数", "第二复核人", "停止条件"]) expect(observation).toContain(phrase);
  });

  it("publishes immutable releases only after an in-place install completes", async () => {
    const installer = await text("scripts/install-local-release.ps1");
    const registrar = await text("scripts/register-local-host-task.ps1");
    expect(installer).toContain('$IncompleteMarker = Join-Path $Target ".installing"');
    expect(installer).toContain("& $PnpmPath install --frozen-lockfile --prod=false");
    expect(installer).not.toContain("--config.node-linker=hoisted");
    expect(installer).toContain('$NodePath (Join-Path $Target "node_modules\\next\\dist\\bin\\next") build');
    expect(installer).toContain("Installed runtime link escapes the immutable release");
    expect(installer).toContain("$OwnedIncomplete.installId -eq $InstallId");
    expect(installer).toContain('[IO.File]::WriteAllText((Join-Path $Target "release.json")');
    expect(installer.indexOf('[IO.File]::WriteAllText((Join-Path $Target "release.json")')).toBeLessThan(
      installer.indexOf("Remove-Item -LiteralPath $IncompleteMarker -Force"),
    );
    expect(registrar).toContain("Release installation is incomplete");
    expect(registrar).toContain("$Health.competitionReady -eq $true");
    expect(registrar).not.toContain("if ($ExistingWasRunning) { Start-ScheduledTask");
    expect(await text("docs/runbooks/local-computer-hosting.md")).toContain("旧任务定义但保持停止");
  });
});
