"use client";

import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  RuntimeAdapterProvider,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  WebSpeechDictationAdapter,
  WebSpeechSynthesisAdapter,
  type DictationAdapter,
  type ThreadHistoryAdapter,
  useAui,
  useLocalRuntime,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { type PropsWithChildren, useMemo } from "react";

import {
  LumiThreadListAdapter,
  createInitializingLumiHistoryAdapter,
} from "./assistant-lab-backend";
import {
  createLumiAgentModelAdapter,
  resumeLumiAgentRun,
} from "./lumi-agent-model-adapter";
import {
  ComposerCapabilityProvider,
  createComposerCapabilityCoordinator,
  useComposerCapability,
} from "./assistant-lab-capability-state";

function LabThreadRuntimeAdapters({ children }: PropsWithChildren) {
  const aui = useAui();
  const { coordinator } = useComposerCapability();
  const history = useMemo<ThreadHistoryAdapter>(
    () => createInitializingLumiHistoryAdapter({
      getRemoteId: () => aui.threadListItem().getState().remoteId,
      initialize: () => aui.threadListItem().initialize(),
    }, coordinator, resumeLumiAgentRun),
    [aui, coordinator],
  );

  return (
    <RuntimeAdapterProvider adapters={{ history }}>
      {children}
    </RuntimeAdapterProvider>
  );
}

class ResilientDictationAdapter implements DictationAdapter {
  disableInputDuringDictation = false;

  listen(): ReturnType<DictationAdapter["listen"]> {
    if (WebSpeechDictationAdapter.isSupported()) {
      return new WebSpeechDictationAdapter({ language: "zh-CN" }).listen();
    }

    const speechStart = new Set<() => void>();
    const speech = new Set<(result: DictationAdapter.Result) => void>();
    const speechEnd = new Set<(result: DictationAdapter.Result) => void>();
    let finished = false;

    const finish = (reason: "stopped" | "cancelled") => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      session.status = { type: "ended", reason };
      if (reason === "stopped") {
        const result = {
          transcript: "请从构图和信息层级开始分析这张作品。",
          isFinal: true,
        };
        speech.forEach((callback) => callback(result));
        speechEnd.forEach((callback) => callback(result));
      }
    };

    const session: ReturnType<DictationAdapter["listen"]> = {
      status: { type: "running" },
      stop: async () => finish("stopped"),
      cancel: () => finish("cancelled"),
      onSpeechStart(callback) {
        speechStart.add(callback);
        queueMicrotask(callback);
        return () => speechStart.delete(callback);
      },
      onSpeech(callback) {
        speech.add(callback);
        return () => speech.delete(callback);
      },
      onSpeechEnd(callback) {
        speechEnd.add(callback);
        return () => speechEnd.delete(callback);
      },
    };

    const timer = setTimeout(() => finish("stopped"), 900);
    return session;
  }
}

const attachmentAdapter = new CompositeAttachmentAdapter([
  new SimpleImageAttachmentAdapter(),
  new SimpleTextAttachmentAdapter(),
]);

const suggestionAdapter = {
  async generate() {
    return [
      { prompt: "把刚才的建议压缩成三步" },
      { prompt: "告诉我下一步只改哪里" },
      { prompt: "说明这次判断用了哪些依据" },
    ];
  },
};

export function AssistantLabRuntimeProvider({ children }: PropsWithChildren) {
  const capabilityCoordinator = useMemo(
    () => createComposerCapabilityCoordinator(),
    [],
  );
  const threadListAdapter = useMemo(() => {
    const adapter = new LumiThreadListAdapter();
    adapter.unstable_Provider = LabThreadRuntimeAdapters;
    return adapter;
  }, []);
  const localAdapters = useMemo(
    () => ({
      attachments: attachmentAdapter,
      suggestion: suggestionAdapter,
      speech: new WebSpeechSynthesisAdapter(),
      dictation: new ResilientDictationAdapter(),
    }),
    [],
  );

  const runtime = useRemoteThreadListRuntime({
    adapter: threadListAdapter,
    runtimeHook: function RuntimeHook() {
      const modelAdapter = useMemo(
        () => createLumiAgentModelAdapter(capabilityCoordinator),
        [],
      );
      return useLocalRuntime(modelAdapter, {
        adapters: localAdapters,
      });
    },
  });

  return (
    <ComposerCapabilityProvider coordinator={capabilityCoordinator}>
      <AssistantRuntimeProvider runtime={runtime}>
        {children}
      </AssistantRuntimeProvider>
    </ComposerCapabilityProvider>
  );
}
