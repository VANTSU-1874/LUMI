import { describe, expect, it } from "vitest";

import { approvedPublicSourceUrl, projectApprovedPublicSource, reviewedPublicHostname } from "@/lib/domain/inspiration-public-source";

describe("approved public inspiration sources", () => {
  it("keeps only an HTTPS, credential-free public source URL", () => {
    expect(approvedPublicSourceUrl("https://Example.org/design/case", ["example.org"])).toBe("https://example.org/design/case");
    expect(projectApprovedPublicSource({
      publicLabel: "已记录来源",
      publicUrl: "https://example.org/design/case",
      allowedPublicHosts: ["example.org"],
    })).toEqual({ label: "已记录来源", url: "https://example.org/design/case" });
  });

  it("requires an exact reviewed host instead of inferring public access from a suffix", () => {
    expect(approvedPublicSourceUrl("https://example.org/design/case", [])).toBeNull();
    expect(approvedPublicSourceUrl("https://sub.example.org/design/case", ["example.org"])).toBeNull();
    expect(approvedPublicSourceUrl("https://example.org/design/case", ["sub.example.org"])).toBeNull();
    expect(reviewedPublicHostname("bad_host.example.org")).toBeNull();
    expect(reviewedPublicHostname("127.0.0.1")).toBeNull();
    expect(reviewedPublicHostname("[::1]")).toBeNull();
  });

  it("rejects private locators, localhost or internal hosts, credentials, and every unprovable query URL", () => {
    for (const locator of [
      "private-candidate://intake/secret.webp",
      "http://example.org/not-https",
      "https://localhost/preview",
      "https://127.0.0.1/preview",
      "https://10.0.0.5/preview",
      "https://[::1]/preview",
      "https://source.internal/preview",
      "https://author:secret@example.org/private",
      "https://example.org/source?X-Amz-Signature=secret",
      "https://example.org/source?token=secret",
    ]) expect(approvedPublicSourceUrl(locator, ["example.org"])).toBeNull();
  });

  it("does not replace a rejected source with a made-up destination", () => {
    expect(projectApprovedPublicSource({
      publicLabel: "待核查来源",
      publicUrl: "https://example.org/source?token=secret",
      allowedPublicHosts: ["example.org"],
    })).toEqual({ label: "待核查来源", url: null });
  });

  it("does not reflect a locator that was incorrectly supplied as a display label", () => {
    expect(projectApprovedPublicSource({
      publicLabel: "采集记录：https://author:secret@localhost/private?token=secret",
      publicUrl: null,
      allowedPublicHosts: ["example.org"],
    })).toEqual({ label: "来源未知", url: null });
  });
});
