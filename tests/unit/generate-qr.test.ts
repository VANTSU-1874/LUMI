// @vitest-environment node

import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parsePublicAppUrl,
  writeCompetitionQr,
} from "@/scripts/generate-qr";

const temporaryDirectories: string[] = [];
const PUBLIC_DNS = async () => [{ address: "203.0.114.8", family: 4 }];
const SAFE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 21 21" shape-rendering="crispEdges"><path fill="#ffffff" d="M0 0h21v21H0z"/><path stroke="#000000" d="M4 4.5h7"/></svg>';

async function temporaryWorkspace() {
  const directory = await mkdtemp(path.join(tmpdir(), "tonggan-qr-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("public competition URL", () => {
  it.each([
    [" https://EXAMPLE.edu.cn/entry/// ", "https://example.edu.cn/entry"],
    ["https://xn--fiqs8s.cn/", "https://xn--fiqs8s.cn"],
    ["https://example.edu.cn:443", "https://example.edu.cn"],
    ["https://example.edu.cn:8443/course", "https://example.edu.cn:8443/course"],
  ])("normalizes a public HTTPS URL: %s", (input, expected) => {
    expect(parsePublicAppUrl(input)).toBe(expected);
  });

  it.each([
    "http://example.edu.cn",
    "javascript:alert(1)",
    "data:text/plain,hello",
    "https://user:password@example.edu.cn",
    "https://example.edu.cn/#student-token",
    "https://example.edu.cn/?token=secret",
    "https://localhost",
    "https://course.local",
    "https://course.localhost",
    "https://127.0.0.1",
    "https://127.1",
    "https://10.0.0.1",
    "https://172.16.10.2",
    "https://192.168.1.2",
    "https://169.254.1.2",
    "https://100.64.0.1",
    "https://[::1]",
    "https://[fc00::1]",
    "https://[fe80::1]",
    "https://example.edu.cn:0",
    "https://example.edu.cn:65536",
    "https://example.edu.cn.",
    "https://singlelabel",
    "https://course.test",
    "https://course.example",
    "https://course.invalid",
    "https://course.onion",
    "https://course.alt",
    "https://course.internal",
    "https://course.lan",
    "https://192.0.2.1",
    "https://198.18.0.1",
    "https://224.0.0.1",
    "https://255.255.255.255",
    "https://[2001:db8::1]",
    "https://[::ffff:10.0.0.1]",
    "https://[64:ff9b::1]",
    "https://[64:ff9b:1::1]",
    "https://[100::1]",
    "https://[100:0:0:1::1]",
    "https://[2001::1]",
    "https://[2002::1]",
    "https://[2620:4f:8000::1]",
    "https://[3fff::1]",
    "https://[5f00::1]",
    "https://[ff00::1]",
  ])("rejects a non-public or unsafe URL: %s", (input) => {
    expect(() => parsePublicAppUrl(input)).toThrow();
  });

  it.each([
    "https://[2000::1]",
    "https://[2001:200::1]",
    "https://[2001:4860::1]",
    "https://[2003::1]",
    "https://[2620:4f:8001::1]",
    "https://[3fff:1000::1]",
    "https://[5eff:ffff::1]",
    "https://[64:ff9b:0:1::1]",
    "https://[64:ff9b:2::1]",
    "https://[100:0:0:2::1]",
  ])("does not overblock an adjacent or ordinary global IPv6 address: %s", (input) => {
    expect(parsePublicAppUrl(input)).toBe(input);
  });
});

describe("competition QR SVG", () => {
  it("writes a deterministic self-contained SVG and returns its SHA-256", async () => {
    const workspaceRoot = await temporaryWorkspace();

    const first = await writeCompetitionQr("https://example.edu.cn/course", { workspaceRoot, resolveHostname: PUBLIC_DNS });
    const firstBytes = await readFile(first.outputPath);
    const second = await writeCompetitionQr("https://example.edu.cn/course", { workspaceRoot, resolveHostname: PUBLIC_DNS });
    const secondBytes = await readFile(second.outputPath);
    const source = secondBytes.toString("utf8");

    expect(first.url).toBe("https://example.edu.cn/course");
    expect(first.outputPath).toBe(path.join(workspaceRoot, "public", "competition-qr.svg"));
    expect(first.sha256).toBe(createHash("sha256").update(firstBytes).digest("hex"));
    expect(second.sha256).toBe(first.sha256);
    expect(secondBytes).toEqual(firstBytes);
    expect(source).toMatch(/^<svg\b/);
    expect(source).not.toMatch(/<script|<metadata|<!doctype|<!--|\b(?:href|xlink:href|on\w+)\s*=/i);
  });

  it("does not overwrite an existing QR when rendering produces unsafe SVG", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const publicDirectory = path.join(workspaceRoot, "public");
    const target = path.join(publicDirectory, "competition-qr.svg");
    await mkdir(publicDirectory);
    await writeFile(target, "trusted-old-svg", "utf8");

    await expect(writeCompetitionQr("https://example.edu.cn", {
      workspaceRoot,
      resolveHostname: PUBLIC_DNS,
      renderSvg: async () => '<svg><script>alert(1)</script></svg>',
    })).rejects.toThrow(/SVG/i);
    await expect(readFile(target, "utf8")).resolves.toBe("trusted-old-svg");
  });

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject /></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><iframe srcdoc="x"></iframe></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" style="display:block"><path d="M0 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:red" d="M0 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path srcdoc="x" d="M0 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path data-value="x" d="M0 0"/></svg>',
  ])("rejects every tag and attribute outside the fixed qrcode SVG allowlist", async (rendered) => {
    const workspaceRoot = await temporaryWorkspace();
    await expect(writeCompetitionQr("https://example.edu.cn", {
      workspaceRoot,
      resolveHostname: PUBLIC_DNS,
      renderSvg: async () => rendered,
    })).rejects.toThrow(/SVG/i);
  });

  it("refuses a public directory that escapes through a junction or symlink", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const outside = await temporaryWorkspace();
    await symlink(outside, path.join(workspaceRoot, "public"), "junction");

    await expect(writeCompetitionQr("https://example.edu.cn", { workspaceRoot, resolveHostname: PUBLIC_DNS }))
      .rejects.toThrow(/contain|link|路径/i);
    await expect(access(path.join(outside, "competition-qr.svg"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires DNS to return only global A or AAAA addresses", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const renderSvg = async () => SAFE_SVG;

    await expect(writeCompetitionQr("https://course.example.edu.cn", {
      workspaceRoot,
      renderSvg,
      resolveHostname: async () => [],
    })).rejects.toThrow(/DNS/i);
    await expect(writeCompetitionQr("https://course.example.edu.cn", {
      workspaceRoot,
      renderSvg,
      resolveHostname: async () => [
        { address: "203.0.114.8", family: 4 },
        { address: "10.0.0.8", family: 4 },
      ],
    })).rejects.toThrow(/DNS|public|global/i);
    await expect(writeCompetitionQr("https://course.example.edu.cn", {
      workspaceRoot,
      renderSvg,
      resolveHostname: async () => [{ address: "203.0.114.8", family: 4 }],
    })).resolves.toMatchObject({ url: "https://course.example.edu.cn" });

    const ipv6Workspace = await temporaryWorkspace();
    await expect(writeCompetitionQr("https://ipv6-course.example.edu.cn", {
      workspaceRoot: ipv6Workspace,
      renderSvg,
      resolveHostname: async () => [{ address: "2001:4860::1", family: 6 }],
    })).resolves.toMatchObject({ url: "https://ipv6-course.example.edu.cn" });
  });

  it("fails closed when DNS resolution exceeds the configured timeout", async () => {
    const workspaceRoot = await temporaryWorkspace();
    await expect(writeCompetitionQr("https://course.example.edu.cn", {
      workspaceRoot,
      renderSvg: async () => SAFE_SVG,
      dnsTimeoutMs: 5,
      resolveHostname: async () => new Promise(() => undefined),
    })).rejects.toThrow(/DNS.*timeout/i);
  });

  it("refuses to overwrite a different reviewed QR asset", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const publicDirectory = path.join(workspaceRoot, "public");
    const target = path.join(publicDirectory, "competition-qr.svg");
    await mkdir(publicDirectory);
    await writeFile(target, "<svg>reviewed-old-content</svg>", "utf8");

    await expect(writeCompetitionQr("https://course.example.edu.cn", {
      workspaceRoot,
      renderSvg: async () => SAFE_SVG,
      resolveHostname: async () => [{ address: "203.0.114.8", family: 4 }],
    })).rejects.toThrow("QR_OUTPUT_CONFLICT");
    await expect(readFile(target, "utf8")).resolves.toBe("<svg>reviewed-old-content</svg>");
  });
});
