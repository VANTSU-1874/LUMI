import { createHash } from "node:crypto";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import { isIP } from "node:net";

import { signTrustedSource } from "@/lib/auth/trusted-source";

export { parseServiceEnvironment } from "@/lib/config/service-environment";

const STRIPPED_REQUEST_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-prefix",
  "x-forwarded-proto",
  "x-forwarded-server",
  "x-real-ip",
  "cf-connecting-ip",
  "origin",
]);

export class UntrustedProxyOriginError extends Error {
  constructor() {
    super("请求来源无效");
    this.name = "UntrustedProxyOriginError";
  }
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizedIp(value: string | undefined) {
  const candidate = value?.trim().replace(/^::ffff:/i, "");
  return candidate && isIP(candidate) ? candidate : undefined;
}

export function deriveTrustedSourceId(
  headers: IncomingHttpHeaders,
  peerAddress: string | undefined,
) {
  const source = normalizedIp(firstHeaderValue(headers["cf-connecting-ip"]))
    ?? normalizedIp(peerAddress)
    ?? "local-tunnel";
  const digest = createHash("sha256").update(source, "utf8").digest("hex");
  return `proxy-${digest.slice(0, 32)}`;
}

export function stripProxyHeaders(headers: IncomingHttpHeaders) {
  const sanitized: OutgoingHttpHeaders = {};
  const connectionHeaders = new Set(
    firstHeaderValue(headers.connection)?.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (
      value === undefined
      || STRIPPED_REQUEST_HEADERS.has(name)
      || connectionHeaders.has(name)
      || name.startsWith("x-tonggan-source-")
    ) continue;
    sanitized[name] = value;
  }
  return sanitized;
}

function isLoopbackAddress(value: string | undefined) {
  const normalized = value?.trim().replace(/^::ffff:/i, "").toLowerCase();
  return normalized === "127.0.0.1" || normalized === "::1";
}

function isLoopbackHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

export function resolveExternalRequestOrigin(options: {
  headers: IncomingHttpHeaders;
  peerAddress?: string;
  publicUrl: string;
  allowQuickTunnelOrigin?: boolean;
}) {
  const rawHost = firstHeaderValue(options.headers.host)?.trim();
  if (!rawHost || /[\s/@\\]/.test(rawHost)) throw new UntrustedProxyOriginError();
  const forwardedProtocol = firstHeaderValue(options.headers["x-forwarded-proto"])
    ?.split(",", 1)[0]
    ?.trim()
    ?.toLowerCase();
  const fallbackProtocol = isLoopbackHost(rawHost.split(":", 1)[0]) ? "http" : new URL(options.publicUrl).protocol.replace(":", "");
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : fallbackProtocol;

  let external: URL;
  try {
    external = new URL(`${protocol}://${rawHost}`);
  } catch {
    throw new UntrustedProxyOriginError();
  }
  const publicOrigin = new URL(options.publicUrl).origin;
  const localAllowed = isLoopbackAddress(options.peerAddress) && isLoopbackHost(external.hostname);
  const quickTunnelAllowed = options.allowQuickTunnelOrigin === true
    && external.protocol === "https:"
    && external.hostname.endsWith(".trycloudflare.com");
  if (external.origin !== publicOrigin && !localAllowed && !quickTunnelAllowed) {
    throw new UntrustedProxyOriginError();
  }
  if (firstHeaderValue(options.headers["sec-fetch-site"])?.toLowerCase() === "cross-site") {
    throw new UntrustedProxyOriginError();
  }

  const rawOrigin = firstHeaderValue(options.headers.origin);
  if (rawOrigin) {
    try {
      if (new URL(rawOrigin).origin !== external.origin) throw new UntrustedProxyOriginError();
    } catch (error) {
      if (error instanceof UntrustedProxyOriginError) throw error;
      throw new UntrustedProxyOriginError();
    }
  }
  return external.origin;
}

export function buildTrustedProxyHeaders(options: {
  headers: IncomingHttpHeaders;
  peerAddress?: string;
  secret: string;
  publicUrl: string;
  upstreamOrigin: string;
  allowQuickTunnelOrigin?: boolean;
  now?: Date;
}) {
  const headers = stripProxyHeaders(options.headers);
  const sourceId = deriveTrustedSourceId(options.headers, options.peerAddress);
  const timestamp = Math.floor((options.now ?? new Date()).getTime() / 1_000).toString();
  const externalOrigin = new URL(resolveExternalRequestOrigin(options));
  const upstreamOrigin = new URL(options.upstreamOrigin);

  headers["x-tonggan-source-id"] = sourceId;
  headers["x-tonggan-source-timestamp"] = timestamp;
  headers["x-tonggan-source-signature"] = signTrustedSource(
    sourceId,
    timestamp,
    options.secret,
  );
  headers["x-forwarded-proto"] = externalOrigin.protocol.replace(":", "");
  headers["x-forwarded-host"] = externalOrigin.host;
  headers.host = upstreamOrigin.host;
  if (firstHeaderValue(options.headers.origin)) {
    headers.origin = `${externalOrigin.protocol}//${upstreamOrigin.host}`;
  }
  return headers;
}
