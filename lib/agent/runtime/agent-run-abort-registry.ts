type RegisteredAbort = {
  workerId: string;
  controller: AbortController;
};

const controllers = new Map<string, RegisteredAbort>();

export function registerActiveAgentRun(runId: string, workerId: string) {
  const existing = controllers.get(runId);
  if (existing && existing.workerId !== workerId) {
    throw new Error("AGENT_RUN_ALREADY_ACTIVE");
  }
  const controller = existing?.controller ?? new AbortController();
  controllers.set(runId, { workerId, controller });
  return controller;
}

export function abortActiveAgentRun(runId: string) {
  const active = controllers.get(runId);
  if (!active) return false;
  if (!active.controller.signal.aborted) {
    active.controller.abort(new DOMException("Agent run cancelled", "AbortError"));
  }
  return true;
}

export function unregisterActiveAgentRun(runId: string, workerId: string) {
  const active = controllers.get(runId);
  if (active?.workerId === workerId) controllers.delete(runId);
}
