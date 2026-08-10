/**
 * assistant-ui's local runtime appends model updates. Lumi emits complete
 * snapshots for each update so progress, tools, and text stay coherent; the
 * answer surface must therefore render the newest text snapshot only.
 */
export function latestTextSnapshot<TPart extends { type: string }>(
  parts: readonly TPart[],
): Extract<TPart, { type: "text" }> | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.type === "text") return part as Extract<TPart, { type: "text" }>;
  }
  return undefined;
}
