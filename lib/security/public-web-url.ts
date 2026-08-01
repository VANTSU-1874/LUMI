import ipaddr from "ipaddr.js";

const BLOCKED_HOST_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".home.arpa",
  ".test",
  ".example",
  ".invalid",
] as const;

function publicHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized === "localhost") return null;
  const addressCandidate = normalized.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(addressCandidate)) {
    const address = ipaddr.parse(addressCandidate);
    return address.range() === "unicast" ? normalized : null;
  }
  if (!normalized.includes(".")) return null;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return null;
  return normalized;
}

export function normalizePublicHttpsUrl(value: string, maxLength = 2_048) {
  const candidate = value.trim();
  if (
    candidate.length === 0
    || candidate.length > maxLength
    || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(candidate)
  ) return null;
  try {
    const url = new URL(candidate);
    const hostname = publicHostname(url.hostname);
    if (url.protocol !== "https:" || url.username || url.password || !hostname) return null;
    url.hostname = hostname;
    const normalized = url.toString();
    return normalized.length <= maxLength ? normalized : null;
  } catch {
    return null;
  }
}

export function publicWebHostname(value: string) {
  const normalized = normalizePublicHttpsUrl(value);
  return normalized ? new URL(normalized).hostname : null;
}
