const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const SCHEME_OR_PRIVATE_ID = /\b(?:file|private-candidate|local-synthetic|inspiration-intake|candidate):|\b[a-z][a-z0-9+.-]*:\/\//i;
const WINDOWS_OR_UNC_PATH = /(?:^|[\s("'`])(?:[a-z]:[\\/]|\\\\[^\s\\/]+[\\/])/i;
const UNIX_PATH = /(?:^|[\s("'`])\/(?:[a-z0-9._-]+\/)+[a-z0-9._-]*/i;
const PRIVATE_NETWORK_MARKER = /\b(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|::1|f[cd][0-9a-f]{2}:)|\b[a-z0-9.-]+\.(?:internal|local|lan|corp|home)\b/i;

export function containsPrivateInspirationLocator(value: string) {
  return SCHEME_OR_PRIVATE_ID.test(value)
    || WINDOWS_OR_UNC_PATH.test(value)
    || UNIX_PATH.test(value)
    || PRIVATE_NETWORK_MARKER.test(value);
}

/**
 * Student-facing metadata is an allow-by-proof projection. A field containing
 * any private locator or internal identifier is rejected as a whole rather
 * than partially redacted into a misleading value.
 */
export function safeInspirationStudentText(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(CONTROL_OR_BIDI, " ").replace(/\s+/g, " ").trim();
  if (!normalized || containsPrivateInspirationLocator(normalized)) return null;
  return normalized.slice(0, max).trim() || null;
}

export function safeInspirationStudentList(value: unknown, maxItems: number, maxLength = 80) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => safeInspirationStudentText(item, maxLength))
    .filter((item): item is string => Boolean(item)))]
    .slice(0, maxItems);
}
