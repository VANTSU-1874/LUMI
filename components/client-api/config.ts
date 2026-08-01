import { mockEndpointGroups, type MockEndpointGroup } from "./contracts";

const endpointMatchers: Array<[MockEndpointGroup, RegExp]> = [
  ["auth-student", /^\/api\/auth\/student(?:$|\?)/],
  ["auth-teacher", /^\/api\/auth\/teacher(?:$|\?)/],
  ["artwork", /^\/api\/agent\/artworks(?:\/|$)/],
  ["critique", /^\/api\/agent\/turns\/[^/]+\/critique(?:$|\?)/],
  ["agent-events", /^\/api\/agent\/runs\/[^/]+\/events(?:\/stream)?(?:$|\?)/],
  ["agent-runs", /^\/api\/agent\/runs(?:\/|$|\?)/],
  ["agent-tasks", /^\/api\/agent\/tasks(?:\/|$|\?)/],
  ["agent-conversation", /^\/api\/agent\/conversation(?:$|\?)/],
  ["courses", /^\/api\/courses(?:\/|$|\?)/],
  ["student-dashboard", /^\/api\/student\/dashboard(?:$|\?)/],
  ["teacher-config", /^\/api\/teacher\/config(?:\/|$|\?)/],
  ["teacher-insights", /^\/api\/teacher\/(?:insights|dashboard|learners|agent-reviews|decisions|evidence|pilot-report)(?:\/|$|\?)/],
];

const agentAliasGroups = [
  "agent-tasks",
  "agent-conversation",
  "agent-runs",
  "agent-events",
] as const satisfies readonly MockEndpointGroup[];

export type MockSelection = {
  all: boolean;
  groups: ReadonlySet<MockEndpointGroup>;
  unknown: readonly string[];
};

export function parseMockSelection(raw = process.env.NEXT_PUBLIC_USE_MOCK): MockSelection {
  const normalized = raw?.trim().toLowerCase() ?? "";
  if (["1", "true", "all"].includes(normalized)) {
    return { all: true, groups: new Set(mockEndpointGroups), unknown: [] };
  }
  if (!normalized || ["0", "false", "none"].includes(normalized)) {
    return { all: false, groups: new Set(), unknown: [] };
  }

  const allowed = new Set<string>(mockEndpointGroups);
  const requested = normalized.split(",").map((value) => value.trim()).filter(Boolean);
  const groups = new Set(requested.filter((value): value is MockEndpointGroup => allowed.has(value)));
  if (requested.includes("agent")) {
    for (const group of agentAliasGroups) groups.add(group);
  }
  const unknown = requested.filter((value) => value !== "agent" && !allowed.has(value));
  return { all: false, groups, unknown };
}

export function endpointGroup(input: RequestInfo | URL): MockEndpointGroup | null {
  const raw = input instanceof Request ? input.url : String(input);
  const path = raw.startsWith("http://") || raw.startsWith("https://")
    ? new URL(raw).pathname + new URL(raw).search
    : raw;
  return endpointMatchers.find(([, matcher]) => matcher.test(path))?.[0] ?? null;
}

export function shouldUseMockEndpoint(
  input: RequestInfo | URL,
  raw = process.env.NEXT_PUBLIC_USE_MOCK,
  options: { demoMode?: boolean; nodeEnv?: string } = {},
) {
  const group = endpointGroup(input);
  if (!group) return false;
  if (options.demoMode ?? browserDemoMode()) return true;
  if ((options.nodeEnv ?? process.env.NODE_ENV) === "production") return false;
  const selection = parseMockSelection(raw);
  return selection.all || selection.groups.has(group);
}

export function browserDemoMode(search?: string) {
  const value = search ?? (typeof window === "undefined" ? "" : window.location.search);
  return new URLSearchParams(value).get("demo") === "1";
}

export function mockSelectionLabel(raw = process.env.NEXT_PUBLIC_USE_MOCK) {
  const selection = parseMockSelection(raw);
  if (selection.all) return "all";
  if (selection.groups.size === 0) return "none";
  return [...selection.groups].join(",");
}
