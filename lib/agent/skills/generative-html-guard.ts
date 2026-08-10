/**
 * 单文件生成器产物的入库前校验。
 *
 * 产物会被放进 sandbox iframe 执行，因此这里的规则不是"代码风格"，而是安全边界：
 * 沙箱只给 allow-scripts（不给 allow-same-origin），配合本校验器要求产物**完全内联、零外部请求**，
 * 使得产物既拿不到同源数据，也无法把任何东西发出去。
 *
 * 原始创作规范允许 Google Fonts 与 cdnjs 的 gif.js；我们收紧为零外链，
 * 代价是导出 GIF 能力和 IBM Plex Mono 需改用系统等宽字体栈。
 */

export const MAX_ARTIFACT_BYTES = 512 * 1_024;

export type GuardViolation = { code: string; detail: string };

type Rule = { code: string; detail: string; pattern: RegExp };

const RULES: readonly Rule[] = [
  { code: "EXTERNAL_SCRIPT", detail: "存在外部脚本引用（<script src=…>）", pattern: /<script[^>]+\bsrc\s*=/i },
  { code: "EXTERNAL_STYLESHEET", detail: "存在外部样式表引用（<link … href=…>）", pattern: /<link[^>]+\bhref\s*=/i },
  { code: "CSS_IMPORT", detail: "存在 CSS @import", pattern: /@import\b/i },
  { code: "NETWORK_FETCH", detail: "存在网络请求调用（fetch / XHR / WebSocket / EventSource / Worker）", pattern: /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|WebTransport|Worker|SharedWorker|importScripts|sendBeacon)\s*\(/i },
  { code: "DYNAMIC_IMPORT", detail: "存在动态 import()", pattern: /\bimport\s*\(/i },
  { code: "NESTED_BROWSING_CONTEXT", detail: "存在 iframe / object / embed 嵌套上下文", pattern: /<\s*(?:iframe|object|embed|portal)\b/i },
  { code: "FORM_SUBMISSION", detail: "存在表单提交入口", pattern: /<\s*form\b/i },
  { code: "ABSOLUTE_URL", detail: "存在绝对或协议相对 URL 引用", pattern: /(?:\bhttps?:)?\/\/[a-z0-9-]+\.[a-z]{2,}/i },
  { code: "PARENT_ACCESS", detail: "尝试访问宿主页面（parent / top / opener）", pattern: /\b(?:window\.)?(?:parent|top|opener)\s*\./i },
  { code: "STORAGE_ACCESS", detail: "尝试访问 cookie 或本地存储", pattern: /\b(?:document\.cookie|localStorage|sessionStorage|indexedDB)\b/i },
  { code: "NAVIGATION", detail: "尝试导航当前沙箱或打开新窗口", pattern: /\b(?:(?:window|document)\s*\.\s*)?location\s*(?:\.\s*(?:href|assign|replace))?\s*(?:=|\()|\bwindow\s*\.\s*open\s*\(/i },
  { code: "META_REFRESH", detail: "存在 meta refresh 导航", pattern: /<meta[^>]+\bhttp-equiv\s*=\s*["']?\s*refresh\b/i },
  { code: "CSP_OVERRIDE", detail: "产物不得自带 Content-Security-Policy，服务端会注入统一策略", pattern: /<meta[^>]+\bhttp-equiv\s*=\s*["']?\s*content-security-policy\b/i },
  { code: "SERVICE_WORKER", detail: "尝试注册 Service Worker", pattern: /\bserviceWorker\s*\.\s*register\s*\(/i },
];

/** 允许 data: URI（图片、字体内联），因此单独放行，不参与 ABSOLUTE_URL 判定。 */
function stripAllowedInlineData(html: string) {
  return html.replace(/data:[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]*;base64,[a-z0-9+/=]+/gi, "data:inline");
}

const URL_ATTRIBUTE_PATTERN = /\b(?:src|srcset|href|xlink:href|action|formaction|poster|ping)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const CSS_URL_PATTERN = /\burl\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi;

function allowedInlineReference(value: string) {
  const normalized = value.trim();
  return /^data:/i.test(normalized) || /^blob:/i.test(normalized) || normalized.startsWith("#");
}

function hasExternalReference(html: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  for (const match of html.matchAll(pattern)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if (!allowedInlineReference(value)) return true;
  }
  return false;
}

export function inspectGenerativeArtifact(html: string): GuardViolation[] {
  const violations: GuardViolation[] = [];
  if (Buffer.byteLength(html, "utf8") > MAX_ARTIFACT_BYTES) {
    violations.push({ code: "TOO_LARGE", detail: `产物超过 ${MAX_ARTIFACT_BYTES / 1_024}KB 上限` });
  }
  if (!/^\s*<!doctype html>/i.test(html)) {
    violations.push({ code: "NOT_HTML_DOCUMENT", detail: "产物不是以 <!doctype html> 开头的完整文档" });
  }
  const scanned = stripAllowedInlineData(html);
  for (const rule of RULES) {
    if (rule.pattern.test(scanned)) violations.push({ code: rule.code, detail: rule.detail });
  }
  if (hasExternalReference(html, URL_ATTRIBUTE_PATTERN)) {
    violations.push({ code: "EXTERNAL_RESOURCE", detail: "存在非 data:/blob:/片段锚点的资源或跳转属性" });
  }
  if (hasExternalReference(html, CSS_URL_PATTERN)) {
    violations.push({ code: "CSS_RESOURCE", detail: "CSS url() 指向非内联资源" });
  }
  return violations;
}

export function assertSafeGenerativeArtifact(html: string): string {
  const violations = inspectGenerativeArtifact(html);
  if (violations.length > 0) {
    throw new GenerativeArtifactRejectedError(violations);
  }
  return html;
}

export const GENERATIVE_ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "child-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "navigate-to 'none'",
].join("; ");

/**
 * 校验通过后把统一 CSP 放在 head 的第一项。
 * iframe sandbox 是浏览器权限边界；CSP 进一步保证即使静态扫描漏掉某种请求写法，也无法联网。
 */
export function hardenGenerativeArtifact(html: string) {
  const safe = assertSafeGenerativeArtifact(html);
  if (!/<head(?:\s[^>]*)?>/i.test(safe)) {
    throw new GenerativeArtifactRejectedError([
      { code: "MISSING_HEAD", detail: "完整 HTML 文档必须包含 <head>" },
    ]);
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${cspAttributeValue()}">`;
  const hardened = safe.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}`);
  if (Buffer.byteLength(hardened, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new GenerativeArtifactRejectedError([
      { code: "TOO_LARGE", detail: `注入安全策略后产物超过 ${MAX_ARTIFACT_BYTES / 1_024}KB 上限` },
    ]);
  }
  return hardened;
}

function cspAttributeValue() {
  return GENERATIVE_ARTIFACT_CSP.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

export class GenerativeArtifactRejectedError extends Error {
  constructor(readonly violations: readonly GuardViolation[]) {
    super(`generative artifact rejected: ${violations.map(({ code }) => code).join(",")}`);
    this.name = "GenerativeArtifactRejectedError";
  }
}
