/**
 * Public agent traces can contain elapsed time for the whole turn, not only a
 * single tool call. Keep this aligned with the maximum configurable turn
 * deadline and the matching SQLite CHECK constraints.
 */
export const MAX_AGENT_TURN_LATENCY_MS = 900_000;

export function clampAgentTurnLatencyMs(value: number) {
  return Math.min(
    MAX_AGENT_TURN_LATENCY_MS,
    Math.max(0, Math.round(value)),
  );
}
