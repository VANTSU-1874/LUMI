const SIDECAR_OPEN = "<!--";
const SIDECAR_NAME = "tutor-meta";

const TUTOR_SIDECAR_PATTERN = /<!--\s*tutor-meta\s+([\s\S]*?)-->/i;
const TUTOR_SIDECAR_START_PATTERN = /<!--\s*tutor-meta\s+/i;

export function matchTutorSidecar(raw: string) {
  return raw.match(TUTOR_SIDECAR_PATTERN);
}

export function findTutorSidecarStart(raw: string) {
  return raw.search(TUTOR_SIDECAR_START_PATTERN);
}

function couldBeTutorSidecarStart(value: string) {
  const normalized = value.toLowerCase();
  let cursor = 0;
  for (const character of SIDECAR_OPEN) {
    if (cursor >= normalized.length) return true;
    if (normalized[cursor] !== character) return false;
    cursor += 1;
  }
  while (cursor < normalized.length && /\s/u.test(normalized[cursor])) cursor += 1;
  if (cursor >= normalized.length) return true;
  for (const character of SIDECAR_NAME) {
    if (cursor >= normalized.length) return true;
    if (normalized[cursor] !== character) return false;
    cursor += 1;
  }
  if (cursor >= normalized.length) return true;
  return /\s/u.test(normalized[cursor]);
}

export function findPossibleTutorSidecarStart(raw: string) {
  let cursor = 0;
  while (cursor < raw.length) {
    const candidate = raw.indexOf("<", cursor);
    if (candidate < 0) return -1;
    if (couldBeTutorSidecarStart(raw.slice(candidate))) return candidate;
    cursor = candidate + 1;
  }
  return -1;
}
