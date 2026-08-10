import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnvConfig } from "@next/env";
import QRCode from "qrcode";
import ipaddr from "ipaddr.js";

const OUTPUT_RELATIVE_PATH = path.join("public", "competition-qr.svg");

export class UnsafePublicAppUrlError extends Error {
  constructor(reason: string) {
    super(`PUBLIC_APP_URL_INVALID:${reason}`);
    this.name = "UnsafePublicAppUrlError";
  }
}

export class UnsafeQrOutputError extends Error {
  constructor(reason: string) {
    super(`QR_OUTPUT_UNSAFE:${reason}`);
    this.name = "UnsafeQrOutputError";
  }
}

export class QrOutputConflictError extends Error {
  constructor() {
    super("QR_OUTPUT_CONFLICT");
    this.name = "QrOutputConflictError";
  }
}

const SPECIAL_USE_SUFFIXES = [
  "localhost",
  "test",
  "example",
  "invalid",
  "local",
  "home.arpa",
  "onion",
  "alt",
  "internal",
  "lan",
] as const;

const SPECIAL_USE_IPV6_CIDRS = [
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["2620:4f:8000::", 48],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const;

const SPECIAL_USE_IPV6_RANGES = SPECIAL_USE_IPV6_CIDRS.map(([network, prefix]) => ({
  bytes: ipaddr.parse(network).toByteArray(),
  prefix,
}));

function parseAddress(value: string) {
  try {
    return ipaddr.parse(value.replace(/^\[|\]$/g, ""));
  } catch {
    return null;
  }
}

function matchesPrefix(addressBytes: readonly number[], networkBytes: readonly number[], prefix: number) {
  if (addressBytes.length !== networkBytes.length) return false;
  const wholeBytes = Math.floor(prefix / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (addressBytes[index] !== networkBytes[index]) return false;
  }
  const remainingBits = prefix % 8;
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (addressBytes[wholeBytes] & mask) === (networkBytes[wholeBytes] & mask);
}

function isSpecialUseIpv6(address: NonNullable<ReturnType<typeof parseAddress>>) {
  if (address.kind() !== "ipv6") return false;
  const bytes = address.toByteArray();
  return SPECIAL_USE_IPV6_RANGES.some((range) => matchesPrefix(bytes, range.bytes, range.prefix));
}

function isGlobalAddress(value: string) {
  const address = parseAddress(value);
  if (!address) return false;
  if (address.range() !== "unicast") return false;
  if (address.kind() === "ipv6" && "isIPv4MappedAddress" in address && address.isIPv4MappedAddress()) return false;
  return !isSpecialUseIpv6(address);
}

function assertPublicHostname(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const address = parseAddress(normalized);
  if (address) {
    if (!isGlobalAddress(normalized)) throw new UnsafePublicAppUrlError("non-global-ip");
    return;
  }
  if (!normalized.includes(".") || SPECIAL_USE_SUFFIXES.some((suffix) =>
    normalized === suffix || normalized.endsWith(`.${suffix}`))) {
    throw new UnsafePublicAppUrlError("non-public-host");
  }
}

export function parsePublicAppUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new UnsafePublicAppUrlError("missing");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new UnsafePublicAppUrlError("malformed");
  }
  if (url.protocol !== "https:") throw new UnsafePublicAppUrlError("https-required");
  if (url.username || url.password) throw new UnsafePublicAppUrlError("credentials");
  if (url.search) throw new UnsafePublicAppUrlError("query");
  if (url.hash) throw new UnsafePublicAppUrlError("fragment");
  if (url.hostname.endsWith(".")) throw new UnsafePublicAppUrlError("trailing-dot-host");
  assertPublicHostname(url.hostname);
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new UnsafePublicAppUrlError("port");
  }
  const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function parseAllowedAttributes(raw: string, allowed: ReadonlySet<string>) {
  const attributes = new Map<string, string>();
  let remaining = raw;
  while (remaining.length > 0) {
    if (/^\s+$/.test(remaining)) break;
    const match = remaining.match(/^\s+([A-Za-z][A-Za-z0-9-]*)="([^"<>&]*)"/);
    if (!match || !allowed.has(match[1]) || attributes.has(match[1])) {
      throw new UnsafeQrOutputError("unsafe-SVG-attribute");
    }
    attributes.set(match[1], match[2]);
    remaining = remaining.slice(match[0].length);
  }
  return attributes;
}

function assertSafeSvg(svg: string) {
  if (Buffer.byteLength(svg, "utf8") > 5 * 1024 * 1024) {
    throw new UnsafeQrOutputError("unsafe-SVG-size");
  }
  const document = svg.match(/^<svg((?:\s+[A-Za-z][A-Za-z0-9-]*="[^"<>&]*")*)\s*>([\s\S]*)<\/svg>\s*$/);
  if (!document) throw new UnsafeQrOutputError("unsafe-SVG-document");

  const svgAttributes = parseAllowedAttributes(
    document[1],
    new Set(["xmlns", "width", "height", "viewBox", "shape-rendering"]),
  );
  if (svgAttributes.size !== 5 || svgAttributes.get("xmlns") !== "http://www.w3.org/2000/svg" ||
    !/^[1-9]\d{0,4}$/.test(svgAttributes.get("width") ?? "") ||
    !/^[1-9]\d{0,4}$/.test(svgAttributes.get("height") ?? "") ||
    !/^0 0 [1-9]\d{0,4} [1-9]\d{0,4}$/.test(svgAttributes.get("viewBox") ?? "") ||
    svgAttributes.get("shape-rendering") !== "crispEdges") {
    throw new UnsafeQrOutputError("unsafe-SVG-root");
  }

  let content = document[2];
  let pathCount = 0;
  while (content.trim().length > 0) {
    const pathElement = content.match(/^\s*<path((?:\s+[A-Za-z][A-Za-z0-9-]*="[^"<>&]*")*)\s*\/>/);
    if (!pathElement) throw new UnsafeQrOutputError("unsafe-SVG-element");
    const attributes = parseAllowedAttributes(pathElement[1], new Set(["fill", "stroke", "d"]));
    const color = /^(?:#[0-9a-fA-F]{6})$/;
    if (!attributes.has("d") || (!attributes.has("fill") && !attributes.has("stroke")) ||
      (attributes.has("fill") && !color.test(attributes.get("fill")!)) ||
      (attributes.has("stroke") && !color.test(attributes.get("stroke")!)) ||
      !/^[MmLlHhVvZz0-9.\s,-]+$/.test(attributes.get("d") ?? "")) {
      throw new UnsafeQrOutputError("unsafe-SVG-path");
    }
    pathCount += 1;
    content = content.slice(pathElement[0].length);
  }
  if (pathCount < 1 || pathCount > 8) throw new UnsafeQrOutputError("unsafe-SVG-path-count");
}

function resolveSafeOutput(workspaceRoot: string) {
  const root = realpathSync.native(path.resolve(workspaceRoot));
  const publicDirectory = path.join(root, "public");
  if (existsSync(publicDirectory) && lstatSync(publicDirectory).isSymbolicLink()) {
    throw new UnsafeQrOutputError("public-directory-link");
  }
  mkdirSync(publicDirectory, { recursive: true });
  const canonicalPublic = realpathSync.native(publicDirectory);
  if (!isInside(root, canonicalPublic)) throw new UnsafeQrOutputError("public-directory-containment");
  const outputPath = path.join(canonicalPublic, "competition-qr.svg");
  if (!isInside(root, outputPath) || path.relative(root, outputPath) !== OUTPUT_RELATIVE_PATH) {
    throw new UnsafeQrOutputError("target-containment");
  }
  if (existsSync(outputPath)) {
    const stat = lstatSync(outputPath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new UnsafeQrOutputError("target-not-regular-file");
  }
  return { root, publicDirectory: canonicalPublic, outputPath };
}

type QrOptions = {
  workspaceRoot?: string;
  renderSvg?: (url: string) => string | Promise<string>;
  resolveHostname?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  dnsTimeoutMs?: number;
};

async function assertDnsIsPublic(url: string, options: QrOptions) {
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (parseAddress(hostname)) return;
  const resolver = options.resolveHostname ?? ((host: string) => lookup(host, { all: true, verbatim: true }));
  const timeoutMs = options.dnsTimeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new UnsafePublicAppUrlError("dns-timeout-invalid");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await Promise.race([
      resolver(hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new UnsafePublicAppUrlError("dns-timeout")), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof UnsafePublicAppUrlError) throw error;
    throw new UnsafePublicAppUrlError("dns-resolution-failed");
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (answers.length === 0) throw new UnsafePublicAppUrlError("dns-no-address");
  for (const answer of answers) {
    const parsed = parseAddress(answer.address);
    if (!parsed || ![4, 6].includes(answer.family) ||
      (answer.family === 4) !== (parsed.kind() === "ipv4") || !isGlobalAddress(answer.address)) {
      throw new UnsafePublicAppUrlError("dns-non-global-address");
    }
  }
}

export async function writeCompetitionQr(publicAppUrl: string, options: QrOptions = {}) {
  const url = parsePublicAppUrl(publicAppUrl);
  await assertDnsIsPublic(url, options);
  const renderSvg = options.renderSvg ?? ((content: string) => QRCode.toString(content, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 4,
    width: 512,
  }));
  const svg = await renderSvg(url);
  assertSafeSvg(svg);
  const bytes = Buffer.from(svg, "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { publicDirectory, outputPath } = resolveSafeOutput(options.workspaceRoot ?? process.cwd());

  if (existsSync(outputPath)) {
    const current = readFileSync(outputPath);
    if (createHash("sha256").update(current).digest("hex") === sha256) {
      return { url, outputPath, sha256 } as const;
    }
    throw new QrOutputConflictError();
  }

  const temporaryPath = path.join(publicDirectory, `.competition-qr.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, bytes, { encoding: undefined, flag: "wx", mode: 0o600 });
    const refreshedPublic = realpathSync.native(publicDirectory);
    if (refreshedPublic !== publicDirectory || !isInside(realpathSync.native(options.workspaceRoot ?? process.cwd()), temporaryPath)) {
      throw new UnsafeQrOutputError("write-containment-changed");
    }
    try {
      linkSync(temporaryPath, outputPath);
    } catch (error) {
      if (existsSync(outputPath)) {
        const stat = lstatSync(outputPath);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new UnsafeQrOutputError("target-became-unsafe");
        const currentHash = createHash("sha256").update(readFileSync(outputPath)).digest("hex");
        if (currentHash === sha256) return { url, outputPath, sha256 } as const;
        throw new QrOutputConflictError();
      }
      throw error;
    }
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return { url, outputPath, sha256 } as const;
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (invoked) {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  void writeCompetitionQr(process.env.PUBLIC_APP_URL ?? "")
    .then(({ url, outputPath, sha256 }) => {
      console.log(JSON.stringify({ ok: true, url, output: path.relative(process.cwd(), outputPath), sha256 }));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "二维码生成失败");
      process.exitCode = 1;
    });
}
