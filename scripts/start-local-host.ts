import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer, request } from "node:http";
import path from "node:path";

import { readEnv } from "@/lib/config/env";
import {
  loadRuntimeEnvironment,
  writeEffectiveModelConfigNotice,
} from "@/lib/config/runtime-environment";
import {
  buildTrustedProxyHeaders,
  stripProxyHeaders,
} from "@/lib/operations/local-host";
import { recoverPendingAgentRuns } from "@/lib/agent/runtime/agent-run-recovery";
import { runEvidenceRecovery } from "@/scripts/recover-evidence";

const APP_HOST = "127.0.0.1";
const APP_PORT = 3000;
const APP_INTERNAL_ORIGIN = `http://localhost:${APP_PORT}`;
const PROXY_HOST = "127.0.0.1";
const PROXY_PORT = 3100;
const PROXY_TIMEOUT_MS = 65_000;
const AGENT_RUN_RECOVERY_INTERVAL_MS = 15_000;

async function waitForHealthyApplication(child: ChildProcess, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`应用启动失败，退出码 ${child.exitCode}`);
    try {
      const response = await fetch(`http://${APP_HOST}:${APP_PORT}/api/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok && (await response.json() as { status?: string }).status === "ok") return;
    } catch {
      // The application is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("等待应用健康检查超时");
}

async function main() {
  const loadedEnvironment = await loadRuntimeEnvironment({
    mode: "SERVICE_REQUIRED",
    nodeEnv: "production",
  });
  const runtimeEnvironment: NodeJS.ProcessEnv = {
    ...loadedEnvironment.environment,
    NODE_ENV: "production",
  };
  const config = readEnv(runtimeEnvironment);
  writeEffectiveModelConfigNotice(config, loadedEnvironment.provenance);
  const publicUrl = runtimeEnvironment.PUBLIC_APP_URL;
  if (!publicUrl) throw new Error("PUBLIC_APP_URL 未配置");
  const allowQuickTunnelOrigin = runtimeEnvironment.ALLOW_QUICK_TUNNEL_ORIGIN === "true";
  await access(path.join(process.cwd(), ".next", "BUILD_ID"));
  await runEvidenceRecovery(runtimeEnvironment);

  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "--hostname", APP_HOST, "--port", String(APP_PORT)], {
    cwd: process.cwd(),
    env: runtimeEnvironment,
    stdio: "inherit",
    windowsHide: true,
  });

  let shuttingDown = false;
  let proxy: ReturnType<typeof createServer> | undefined;
  let recoveryTimer: NodeJS.Timeout | undefined;
  let recoveryInFlight = false;
  const recoverAgentRuns = async () => {
    if (recoveryInFlight || shuttingDown) return;
    recoveryInFlight = true;
    try {
      const summary = await recoverPendingAgentRuns(runtimeEnvironment);
      if (summary.found > 0) console.log(JSON.stringify({ event: "agent-run-recovery", ...summary }));
    } catch {
      console.error("Agent run recovery failed");
    } finally {
      recoveryInFlight = false;
    }
  };
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (recoveryTimer) clearInterval(recoveryTimer);
    await new Promise<void>((resolve) => proxy?.close(() => resolve()) ?? resolve());
    if (child.exitCode === null) child.kill("SIGTERM");
    process.exitCode = exitCode;
  };

  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));
  child.once("exit", (code) => {
    // Any unexpected application exit is a service failure, even when Next
    // reports exit code 0.  A non-zero parent exit lets Task Scheduler apply
    // its configured restart policy.
    if (!shuttingDown) void shutdown(code && code !== 0 ? code : 1);
  });

  try {
    await waitForHealthyApplication(child);
    proxy = createServer((incoming, outgoing) => {
      let trustedHeaders;
      try {
        trustedHeaders = buildTrustedProxyHeaders({
          headers: incoming.headers,
          peerAddress: incoming.socket.remoteAddress,
          secret: config.authProxySecret,
          publicUrl,
          upstreamOrigin: APP_INTERNAL_ORIGIN,
          allowQuickTunnelOrigin,
        });
      } catch {
        outgoing.writeHead(403, { "content-type": "application/json; charset=utf-8" });
        outgoing.end(JSON.stringify({ ok: false, error: "请求来源无效" }));
        return;
      }
      const upstream = request({
        hostname: APP_HOST,
        port: APP_PORT,
        method: incoming.method,
        path: incoming.url,
        headers: trustedHeaders,
        timeout: PROXY_TIMEOUT_MS,
      }, (response) => {
        const failResponse = () => {
          if (outgoing.destroyed) return;
          if (outgoing.headersSent) outgoing.destroy();
          else {
            outgoing.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
            outgoing.end("服务暂时不可用");
          }
        };
        response.setTimeout(PROXY_TIMEOUT_MS, () => upstream.destroy(new Error("UPSTREAM_RESPONSE_TIMEOUT")));
        response.on("aborted", failResponse);
        response.on("error", failResponse);
        outgoing.writeHead(
          response.statusCode ?? 502,
          response.statusMessage,
          stripProxyHeaders(response.headers),
        );
        response.pipe(outgoing);
      });
      upstream.on("timeout", () => upstream.destroy(new Error("UPSTREAM_REQUEST_TIMEOUT")));
      upstream.on("error", () => {
        if (outgoing.destroyed) return;
        if (outgoing.headersSent) outgoing.destroy();
        else {
          outgoing.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
          outgoing.end("服务暂时不可用");
        }
      });
      incoming.on("aborted", () => upstream.destroy());
      outgoing.on("close", () => {
        if (!outgoing.writableEnded) upstream.destroy();
      });
      incoming.pipe(upstream);
    });
    proxy.headersTimeout = 10_000;
    proxy.requestTimeout = PROXY_TIMEOUT_MS + 5_000;
    proxy.keepAliveTimeout = 5_000;
    proxy.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
    await new Promise<void>((resolve, reject) => {
      proxy!.once("error", reject);
      proxy!.listen(PROXY_PORT, PROXY_HOST, () => resolve());
    });
    recoveryTimer = setInterval(() => void recoverAgentRuns(), AGENT_RUN_RECOVERY_INTERVAL_MS);
    recoveryTimer.unref();
    void recoverAgentRuns();
    console.log(`触映本机服务已就绪：http://${PROXY_HOST}:${PROXY_PORT}`);
  } catch (error) {
    await shutdown(1);
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "本机服务启动失败");
  process.exitCode = 1;
});
