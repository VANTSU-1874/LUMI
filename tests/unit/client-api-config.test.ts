import { describe, expect, it, vi } from "vitest";

import {
  endpointGroup,
  parseMockSelection,
  shouldUseMockEndpoint,
} from "@/components/client-api/config";
import { ApiError, createLumiFetch, jsonOrThrow } from "@/components/client-api/request";

describe("Lumi client API selection", () => {
  it("routes agent endpoints independently and expands only the legacy agent alias", () => {
    expect(endpointGroup("/api/agent/tasks")).toBe("agent-tasks");
    expect(endpointGroup("/api/agent/conversation?view=AGENT")).toBe("agent-conversation");
    expect(endpointGroup("/api/agent/runs/abc")).toBe("agent-runs");
    expect(endpointGroup("/api/agent/runs/abc/events/stream?after=2")).toBe("agent-events");
    expect(endpointGroup("/api/agent/artworks/abc")).toBe("artwork");

    const selection = parseMockSelection("agent,critique");
    expect([...selection.groups]).toEqual(expect.arrayContaining([
      "agent-tasks",
      "agent-conversation",
      "agent-runs",
      "agent-events",
      "critique",
    ]));
    expect(selection.groups.has("artwork")).toBe(false);
    expect(selection.unknown).toEqual([]);
  });

  it("ignores environment-selected mocks in production but forces explicit demo mode", () => {
    expect(shouldUseMockEndpoint("/api/agent/runs", "agent-runs", {
      nodeEnv: "production",
      demoMode: false,
    })).toBe(false);
    expect(shouldUseMockEndpoint("/api/agent/runs", "none", {
      nodeEnv: "production",
      demoMode: true,
    })).toBe(true);
  });

  it("allows only an explicit forceMock call to override production selection", async () => {
    const realFetch = vi.fn<typeof fetch>();
    const fetcher = createLumiFetch({
      forceMock: true,
      nodeEnv: "production",
      mockSelection: "none",
      realFetch,
    });
    const response = await fetcher("/api/courses");
    expect(response.headers.get("x-lumi-data-type")).toBe("DEMONSTRATION_DATA");
    expect(realFetch).not.toHaveBeenCalled();
  });
});

describe("ApiError", () => {
  it("keeps status, code and Retry-After while limiting identity-gate errors", async () => {
    const identityResponse = new Response(JSON.stringify({
      error: "请重新进入",
      code: "STUDENT_SESSION_REQUIRED",
      details: { expired: true },
    }), {
      status: 403,
      headers: { "content-type": "application/json", "retry-after": "12" },
    });

    const identityError = await jsonOrThrow(identityResponse).catch((error: unknown) => error);
    expect(identityError).toBeInstanceOf(ApiError);
    expect(identityError).toMatchObject({
      status: 403,
      code: "STUDENT_SESSION_REQUIRED",
      retryAfter: 12,
      requiresIdentityGate: true,
    });

    const businessError = await jsonOrThrow(new Response(JSON.stringify({
      error: "没有这份作品的权限",
      code: "ARTWORK_FORBIDDEN",
    }), { status: 403, headers: { "content-type": "application/json" } }))
      .catch((error: unknown) => error);
    expect(businessError).toMatchObject({ status: 403, requiresIdentityGate: false });

    const wrongRole = new ApiError({
      message: "当前身份不是学生",
      status: 403,
      code: "STUDENT_ROLE_FORBIDDEN",
    });
    expect(wrongRole.requiresIdentityGate).toBe(true);

    const unauthenticated = new ApiError({ message: "未登录", status: 401 });
    expect(unauthenticated.requiresIdentityGate).toBe(true);
  });
});
