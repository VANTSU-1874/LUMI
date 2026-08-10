"use client";

import type { ThreadMessage } from "@assistant-ui/react";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useSyncExternalStore,
} from "react";

import {
  AgentRequestedCapabilitySchema,
  type AgentRequestedCapability,
  type AgentRequestedCapabilityId,
} from "@/lib/agent/requested-capability";

type CapabilitySnapshot = {
  selected: AgentRequestedCapability | null;
  revision: number;
};

export type ComposerCapabilityCoordinator = {
  bindToMessage(messageId: string): AgentRequestedCapability | undefined;
  clear(): void;
  getForMessage(messageId: string): AgentRequestedCapability | undefined;
  getSnapshot(): CapabilitySnapshot;
  select(id: AgentRequestedCapabilityId): void;
  subscribe(listener: () => void): () => void;
};

export function createComposerCapabilityCoordinator(): ComposerCapabilityCoordinator {
  let snapshot: CapabilitySnapshot = { selected: null, revision: 0 };
  const messageCapabilities = new Map<string, AgentRequestedCapability>();
  const listeners = new Set<() => void>();

  const notify = () => {
    snapshot = { ...snapshot, revision: snapshot.revision + 1 };
    listeners.forEach((listener) => listener());
  };

  return {
    bindToMessage(messageId) {
      const capability = snapshot.selected ?? undefined;
      if (!capability) return undefined;
      messageCapabilities.set(messageId, capability);
      snapshot = { selected: null, revision: snapshot.revision };
      notify();
      return capability;
    },
    clear() {
      if (!snapshot.selected) return;
      snapshot = { selected: null, revision: snapshot.revision };
      notify();
    },
    getForMessage(messageId) {
      return messageCapabilities.get(messageId);
    },
    getSnapshot() {
      return snapshot;
    },
    select(id) {
      snapshot = {
        selected: AgentRequestedCapabilitySchema.parse({ id, source: "composer" }),
        revision: snapshot.revision,
      };
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const ComposerCapabilityContext = createContext<ComposerCapabilityCoordinator | null>(null);

export function ComposerCapabilityProvider({
  children,
  coordinator,
}: PropsWithChildren<{ coordinator: ComposerCapabilityCoordinator }>) {
  return (
    <ComposerCapabilityContext.Provider value={coordinator}>
      {children}
    </ComposerCapabilityContext.Provider>
  );
}

export function useComposerCapability() {
  const coordinator = useContext(ComposerCapabilityContext);
  if (!coordinator) {
    throw new Error("useComposerCapability must be used inside ComposerCapabilityProvider");
  }
  const snapshot = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );
  return {
    ...snapshot,
    clear: coordinator.clear,
    coordinator,
    getForMessage: coordinator.getForMessage,
    select: coordinator.select,
  };
}

export function requestedCapabilityFromThreadMessage(
  message: Pick<ThreadMessage, "metadata">,
) {
  const custom = message.metadata?.custom;
  if (!custom || typeof custom !== "object") return undefined;
  const parsed = AgentRequestedCapabilitySchema.safeParse(
    (custom as Record<string, unknown>).capability,
  );
  return parsed.success ? parsed.data : undefined;
}
