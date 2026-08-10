/**
 * A bare continuation command should continue the durable interrupted run,
 * rather than create a second user turn that happens to ask the same thing.
 */
export function isContinuationIntent(text: string) {
  const normalized = text.trim().replace(/[。！？!?.]+$/u, "");
  return /^(?:继续(?:生成|写|回答)?|接着(?:写|生成)?|续写)$/u.test(normalized);
}
