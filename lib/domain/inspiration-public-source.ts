import { safeInspirationStudentText } from "./inspiration-student-projection";

type PublicSourceInput = {
  publicLabel: unknown;
  publicUrl: unknown;
  allowedPublicHosts: readonly unknown[];
};

function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, max)
    : null;
}

function isIpv4Literal(value: string) {
  const labels = value.split(".");
  return labels.length === 4
    && labels.every((label) => /^\d{1,3}$/.test(label) && Number(label) <= 255);
}

/** Exact DNS host syntax only: no IP literals, wildcards, ports, or suffix rules. */
export function reviewedPublicHostname(value: unknown) {
  const raw = text(value, 253)?.toLocaleLowerCase("en-US").replace(/\.$/, "");
  if (!raw || raw.length > 253 || raw.includes(":") || isIpv4Literal(raw) || !raw.includes(".")) return null;
  const labels = raw.split(".");
  if (labels.some((label) => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  try {
    const url = new URL(`https://${raw}/`);
    const normalized = url.hostname.toLocaleLowerCase("en-US").replace(/\.$/, "");
    return normalized === raw ? normalized : null;
  } catch {
    return null;
  }
}

export function publicSourceUrlHasSafeShape(value: unknown) {
  const raw = text(value, 2_048);
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (!url.port || url.port === "443")
      && !url.search
      && !url.hash
      && reviewedPublicHostname(url.hostname) !== null;
  } catch {
    return false;
  }
}

function reviewedHostSet(values: readonly unknown[]) {
  return new Set(values.map(reviewedPublicHostname).filter((value): value is string => Boolean(value)));
}

export function reviewedPublicHostsFromSourceConfiguration(value: unknown) {
  if (!value || typeof value !== "object") return [];
  const policy = (value as Record<string, unknown>).studentPublication;
  if (!policy || typeof policy !== "object") return [];
  const raw = policy as Record<string, unknown>;
  if (raw.publicLinkReview !== "REVIEWED" || !Array.isArray(raw.allowedPublicHosts)) return [];
  return [...reviewedHostSet(raw.allowedPublicHosts)];
}

/**
 * A link is returned only when its exact host is present in the source's
 * reviewed allowlist. HTTPS, credentials, query/fragment, port, IP and DNS
 * syntax all fail closed; no blacklist or inferred "public" host is used.
 */
export function approvedPublicSourceUrl(value: unknown, allowedPublicHosts: readonly unknown[] = []) {
  const raw = text(value, 2_048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const hostname = reviewedPublicHostname(url.hostname);
    if (!publicSourceUrlHasSafeShape(raw) || !hostname || !reviewedHostSet(allowedPublicHosts).has(hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The only source shape permitted in student Browser and Bridge payloads. */
export function projectApprovedPublicSource(input: PublicSourceInput) {
  return {
    label: safeInspirationStudentText(input.publicLabel, 240) ?? "来源未知",
    url: approvedPublicSourceUrl(input.publicUrl, input.allowedPublicHosts),
  };
}
