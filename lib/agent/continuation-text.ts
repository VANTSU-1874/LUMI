/**
 * Utilities shared by the durable run worker and the client adapter.
 *
 * A continuation only ever receives learner-visible text.  Keeping the
 * boundary merge here makes the streamed view, persisted answer, and reload
 * view agree on exactly the same text.
 */
export const MAX_AGENT_VISIBLE_TEXT_CHARS = 32_000;
export const MAX_CONTINUATION_CONTEXT_CHARS = 8_000;

function longestBoundaryOverlap(previous: string, next: string) {
  const max = Math.min(previous.length, next.length, 1_600);
  for (let length = max; length > 0; length -= 1) {
    if (previous.slice(-length) === next.slice(0, length)) return length;
  }
  return 0;
}

/**
 * Appends a continuation without repeating the overlap at the interruption
 * boundary.  It deliberately compares raw text rather than normalising
 * markdown whitespace, so it never silently rewrites learner-visible prose.
 */
export function appendContinuationText(previous: string, next: string) {
  if (!previous) return next.slice(0, MAX_AGENT_VISIBLE_TEXT_CHARS);
  if (!next) return previous.slice(0, MAX_AGENT_VISIBLE_TEXT_CHARS);
  const overlap = longestBoundaryOverlap(previous, next);
  return `${previous}${next.slice(overlap)}`.slice(0, MAX_AGENT_VISIBLE_TEXT_CHARS);
}

/** Only the tail is needed to tell the model where a long answer stopped. */
export function continuationContextTail(text: string) {
  return text.slice(-MAX_CONTINUATION_CONTEXT_CHARS);
}
