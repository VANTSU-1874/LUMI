"use client";

export const LUMI_SESSION_INVALIDATED_EVENT = "lumi:session-invalidated";
export const LUMI_SESSION_INVALIDATED_STORAGE_KEY =
  "lumi.session.invalidated-at";

export function notifySessionInvalidated() {
  window.dispatchEvent(new Event(LUMI_SESSION_INVALIDATED_EVENT));
  try {
    window.localStorage.setItem(
      LUMI_SESSION_INVALIDATED_STORAGE_KEY,
      `${Date.now()}:${crypto.randomUUID()}`,
    );
  } catch {
    // The same-tab event above remains effective when storage is unavailable.
  }
}
