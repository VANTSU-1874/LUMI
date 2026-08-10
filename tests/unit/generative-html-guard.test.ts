// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  assertSafeGenerativeArtifact,
  GenerativeArtifactRejectedError,
  inspectGenerativeArtifact,
  MAX_ARTIFACT_BYTES,
} from "@/lib/agent/skills/generative-html-guard";

function documentWith(content: string) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${content}</body></html>`;
}

function violationCodes(html: string) {
  return inspectGenerativeArtifact(html).map(({ code }) => code);
}

describe("inspectGenerativeArtifact", () => {
  it.each([
    ["external script", '<script src="/assets/tool.js"></script>', "EXTERNAL_SCRIPT"],
    ["external stylesheet", '<link rel="stylesheet" href="/assets/tool.css">', "EXTERNAL_STYLESHEET"],
    ["CSS import", "<style>@import '/assets/tool.css';</style>", "CSS_IMPORT"],
    ["fetch", "<script>fetch('/api/private')</script>", "NETWORK_FETCH"],
    ["XMLHttpRequest", "<script>new XMLHttpRequest()</script>", "NETWORK_FETCH"],
    ["WebSocket", "<script>new WebSocket('wss://evil.example/socket')</script>", "NETWORK_FETCH"],
    ["dynamic import", "<script>import('/assets/tool.js')</script>", "DYNAMIC_IMPORT"],
    ["iframe", '<iframe srcdoc="<p>nested</p>"></iframe>', "NESTED_BROWSING_CONTEXT"],
    ["form", '<form action="/collect"><input name="value"></form>', "FORM_SUBMISSION"],
    ["absolute URL", "<script>const endpoint='https://evil.example/collect'</script>", "ABSOLUTE_URL"],
    ["parent access", "<script>parent.postMessage('x','*')</script>", "PARENT_ACCESS"],
    ["cookie access", "<script>document.cookie</script>", "STORAGE_ACCESS"],
    ["local storage access", "<script>localStorage.setItem('x','1')</script>", "STORAGE_ACCESS"],
  ])("rejects %s", (_label, content, expectedCode) => {
    expect(violationCodes(documentWith(content))).toContain(expectedCode);
  });

  it("rejects an artifact larger than 512KB", () => {
    const html = documentWith("x".repeat(MAX_ARTIFACT_BYTES));
    expect(Buffer.byteLength(html, "utf8")).toBeGreaterThan(MAX_ARTIFACT_BYTES);
    expect(violationCodes(html)).toContain("TOO_LARGE");
  });

  it("rejects a fragment that is not a complete doctype-led document", () => {
    expect(violationCodes("<html><body>fragment</body></html>")).toContain("NOT_HTML_DOCUMENT");
  });

  it.each([
    ["relative image", '<img alt="" src="/api/private-artifact">', "EXTERNAL_RESOURCE"],
    ["relative anchor", '<a href="/api/private-artifact">open</a>', "EXTERNAL_RESOURCE"],
    ["relative CSS url", "<style>.preview{background:url('/api/private-artifact')}</style>", "CSS_RESOURCE"],
    ["location assignment", "<script>location.href='/api/private-artifact'</script>", "NAVIGATION"],
    ["location method", "<script>window.location.assign('/api/private-artifact')</script>", "NAVIGATION"],
    ["new window", "<script>window.open('/api/private-artifact')</script>", "NAVIGATION"],
    ["meta refresh", '<meta http-equiv="refresh" content="0;url=/api/private-artifact">', "META_REFRESH"],
    ["service worker", "<script>navigator.serviceWorker.register('/worker.js')</script>", "SERVICE_WORKER"],
  ])("rejects the zero-network bypass: %s", (_label, content, expectedCode) => {
    expect(violationCodes(documentWith(content))).toContain(expectedCode);
  });

  it("accepts a complete inline single-file generator with data URI images", () => {
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      :root{--bg:#f0eeeb}
      body{background:var(--bg)}
      .preview{background-image:url(data:image/png;base64,iVBORw0KGgo=)}
      #mark{fill:url(#gradient)}
    </style>
  </head>
  <body>
    <a href="#controls">参数</a>
    <img alt="内联预览" src="data:image/png;base64,iVBORw0KGgo=">
    <a download="preview.png" href="data:image/png;base64,iVBORw0KGgo=">保存</a>
    <canvas></canvas>
    <script>
      const S={seed:1};
      function draw(){return S.seed}
      function randomize(){S.seed+=1;draw()}
      function exportPNG(){return document.querySelector('canvas').toDataURL('image/png')}
      draw()
    </script>
  </body>
</html>`;
    expect(inspectGenerativeArtifact(html)).toEqual([]);
    expect(assertSafeGenerativeArtifact(html)).toBe(html);
  });
});

describe("assertSafeGenerativeArtifact", () => {
  it("throws GenerativeArtifactRejectedError with the matching violation codes", () => {
    const html = documentWith("<script>fetch('/api/private'); parent.location='/escape'</script>");
    try {
      assertSafeGenerativeArtifact(html);
      throw new Error("expected artifact rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(GenerativeArtifactRejectedError);
      if (!(error instanceof GenerativeArtifactRejectedError)) return;
      expect(error.violations.map(({ code }) => code)).toEqual(expect.arrayContaining([
        "NETWORK_FETCH",
        "PARENT_ACCESS",
      ]));
      expect(error.message).toContain("NETWORK_FETCH");
    }
  });
});
