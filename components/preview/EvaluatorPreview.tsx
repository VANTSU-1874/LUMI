"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  ArrowUpIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  LockKeyholeIcon,
  MenuIcon,
  PlayIcon,
  XIcon,
} from "lucide-react";
import Image from "next/image";

import { MessageResponse } from "@/components/ai-elements/message";
import labStyles from "@/components/assistant-lab/assistant-lab.module.css";
import { ThinkingTool } from "@/components/ui/thinking-tool";
import type { PreviewOutcome, PreviewResponse, PreviewScenarioId } from "@/lib/preview/contracts";

import styles from "./evaluator-preview.module.css";

type Suggestion = {
  id: string;
  label: string;
  prompt: string;
  outcome: PreviewOutcome;
  attachments: PreviewAttachment[];
};

type PreviewAttachment = {
  id: string;
  label: string;
  alt: string;
  url: string;
};

type Scenario = {
  id: PreviewScenarioId;
  title: string;
  capability: string;
  description: string;
  sourceLabel: string;
  initial: Suggestion;
  suggestions: Suggestion[];
};

type SessionState = {
  expiresAt: string;
  scenarios: Scenario[];
};

type RunState = {
  status: "idle" | "streaming" | "completed" | "failed";
  message: string;
  response?: PreviewResponse;
  error?: string;
};

type PreviewTurn = {
  id: string;
  label?: string;
  prompt: string;
  suggestionId?: string;
  attachments?: PreviewAttachment[];
  run: RunState;
};

type StreamEvent = {
  event: string;
  data: unknown;
};

function readSseEvents(buffer: string) {
  const events: StreamEvent[] = [];
  let rest = buffer;
  for (;;) {
    const separator = rest.indexOf("\n\n");
    if (separator === -1) return { events, rest };
    const frame = rest.slice(0, separator);
    rest = rest.slice(separator + 2);
    const event = frame.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim() ?? "message";
    const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    try {
      events.push({ event, data: JSON.parse(dataLine.slice(5).trim()) as unknown });
    } catch {
      // The server only emits JSON events. A malformed frame is ignored rather
      // than being presented as a fabricated model response.
    }
  }
}

function payloadMessage(data: unknown) {
  return typeof data === "object" && data !== null && "delta" in data && typeof data.delta === "string"
    ? data.delta
    : "";
}

function payloadResponse(data: unknown) {
  if (typeof data !== "object" || data === null || !("response" in data)) return null;
  const candidate = data.response;
  if (typeof candidate !== "object" || candidate === null) return null;
  const value = candidate as PreviewResponse;
  return typeof value.message === "string" && typeof value.title === "string" && typeof value.branch?.outcome?.label === "string"
    ? value
    : null;
}

function payloadError(data: unknown) {
  return typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
    ? data.error
    : "现场模型暂时不可用，请稍后再试";
}

function markdownResponse(text: string, isStreaming: boolean) {
  return (
    <MessageResponse
      className={labStyles.markdown}
      controls={{
        code: { copy: true, download: false },
        mermaid: { copy: true, download: false, fullscreen: true, panZoom: true },
        table: { copy: true, download: false, fullscreen: true },
      }}
      dir="auto"
      isAnimating={isStreaming}
      lineNumbers={false}
      mode={isStreaming ? "streaming" : "static"}
      translations={{
        copied: "已复制",
        copyCode: "复制",
        copyTable: "复制表格",
        copyTableAsCsv: "复制为 CSV",
        copyTableAsMarkdown: "复制为 Markdown",
        copyTableAsTsv: "复制为 TSV",
        exitFullscreen: "退出全屏",
        viewFullscreen: "全屏查看",
      }}
    >
      {text}
    </MessageResponse>
  );
}

function usePreviewThinkingElapsed(thinking: boolean) {
  const startedAt = useRef<number | undefined>(undefined);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!thinking) return;
    startedAt.current ??= Date.now();
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt.current!) / 1_000)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [thinking]);

  return elapsed;
}

function PreviewThinkingState() {
  const elapsedSeconds = usePreviewThinkingElapsed(true);
  return (
    <ThinkingTool
      className={labStyles.thinkingToolAdapter}
      elapsedSeconds={elapsedSeconds}
      steps={[
        { id: "understand", label: "理解固定建议并确定回答方向", status: "complete" },
        { id: "compose", label: "保持模型连接并整理回答", status: "running" },
      ]}
      streamLabel="处理步骤摘要"
      thinkingLabel="Lumi 正在思考"
      thoughtLabel="已思考"
    />
  );
}

function previewTurnId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `preview-turn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function PreviewComposer({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (message: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState(false);
  const hasDraft = draft.trim().length > 0;

  const send = () => {
    const message = draft.trim();
    if (!message || disabled) return;
    setDraft("");
    onSubmit(message);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send();
  };

  return (
    <form className={labStyles.composer} onSubmit={submit}>
      <div
        className={labStyles.composerShell}
        data-active={active || hasDraft || undefined}
        data-compact={!active && !hasDraft || undefined}
        data-draft={hasDraft || undefined}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActive(false);
        }}
        onFocus={() => setActive(true)}
      >
        <div className={labStyles.composerInputRow}>
          <div className={labStyles.composerTextField}>
            <textarea
              aria-label="给 Lumi 发送消息"
              disabled={disabled}
              enterKeyHint="send"
              maxLength={2_000}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder=" "
              rows={1}
              value={draft}
            />
            <div aria-hidden="true" className={labStyles.composerPlaceholder}>
              {!hasDraft ? <span className={labStyles.composerPlaceholderText}>继续追问，或补充你的判断</span> : null}
            </div>
          </div>
          <button
            aria-label="发送消息"
            className={labStyles.sendButton}
            disabled={disabled || !hasDraft}
            title="发送消息"
            type="submit"
          >
            <ArrowUpIcon aria-hidden="true" size={19} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </form>
  );
}

export function EvaluatorPreview() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [turnsByScenario, setTurnsByScenario] = useState<Partial<Record<PreviewScenarioId, PreviewTurn[]>>>({});
  const [runningTurnId, setRunningTurnId] = useState<string | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<PreviewScenarioId | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    void fetch("/api/preview/session", { method: "POST", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "预览会话暂时不可用");
        return response.json() as Promise<SessionState>;
      })
      .then((value) => {
        if (!mounted) return;
        setSession(value);
        const firstScenario = value.scenarios[0];
        setSelectedScenarioId((current) => current ?? firstScenario?.id ?? null);
      })
      .catch((error: unknown) => {
        if (mounted) setSessionError(error instanceof Error ? error.message : "预览会话暂时不可用");
      });
    return () => { mounted = false; };
  }, []);

  const selectedScenario = session?.scenarios.find(({ id }) => id === selectedScenarioId) ?? session?.scenarios[0] ?? null;
  const selectedTurns = selectedScenario ? turnsByScenario[selectedScenario.id] ?? [] : [];
  const latestTurn = selectedTurns.at(-1);
  const hasInitialAnswer = Boolean(selectedScenario && selectedTurns.some((turn) => (
    turn.suggestionId === selectedScenario.initial.id && turn.run.status === "completed"
  )));

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !latestTurn) return;
    if (typeof viewport.scrollTo === "function") {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    }
  }, [latestTurn]);

  async function runTurn(
    scenario: Scenario,
    input: { label?: string; prompt: string; suggestionId?: string; attachments?: PreviewAttachment[] },
  ) {
    if (!session || runningTurnId) return;
    setSelectedScenarioId(scenario.id);
    setSidebarOpen(false);
    const turnId = previewTurnId();
    const previousTurns = turnsByScenario[scenario.id] ?? [];
    const turn: PreviewTurn = {
      id: turnId,
      label: input.label,
      prompt: input.prompt,
      suggestionId: input.suggestionId,
      attachments: input.attachments,
      run: { status: "streaming", message: "" },
    };
    setRunningTurnId(turnId);
    setTurnsByScenario((current) => ({
      ...current,
      [scenario.id]: [...(current[scenario.id] ?? []), turn],
    }));
    let visibleText = "";
    try {
      const history = previousTurns
        .filter((previous) => previous.run.status === "completed" && previous.run.response)
        .slice(-6)
        .map((previous) => ({
          userMessage: previous.prompt,
          assistantMessage: previous.run.response!.message,
        }));
      const response = await fetch("/api/preview/runs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: scenario.id,
          ...(input.suggestionId ? { suggestionId: input.suggestionId } : { message: input.prompt }),
          ...(history.length > 0 ? { history } : {}),
        }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "预览运行暂时不可用");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let complete = false;
      while (!complete) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const parsed = readSseEvents(buffer);
        buffer = parsed.rest;
        for (const event of parsed.events) {
          if (event.event === "text") {
            visibleText += payloadMessage(event.data);
            setTurnsByScenario((current) => ({
              ...current,
              [scenario.id]: (current[scenario.id] ?? []).map((candidate) => candidate.id === turnId
                ? { ...candidate, run: { status: "streaming", message: visibleText } }
                : candidate),
            }));
          } else if (event.event === "complete") {
            const result = payloadResponse(event.data);
            if (!result) throw new Error("现场模型返回未通过校验");
            setTurnsByScenario((current) => ({
              ...current,
              [scenario.id]: (current[scenario.id] ?? []).map((candidate) => candidate.id === turnId
                ? { ...candidate, run: { status: "completed", message: result.message, response: result } }
                : candidate),
            }));
            complete = true;
          } else if (event.event === "error") {
            setTurnsByScenario((current) => ({
              ...current,
              [scenario.id]: (current[scenario.id] ?? []).map((candidate) => candidate.id === turnId
                ? { ...candidate, run: { status: "failed", message: "", error: payloadError(event.data) } }
                : candidate),
            }));
            complete = true;
          }
        }
      }
      if (!complete) throw new Error("现场模型连接中断，请稍后再试");
    } catch (error) {
      setTurnsByScenario((current) => ({
        ...current,
        [scenario.id]: (current[scenario.id] ?? []).map((candidate) => candidate.id === turnId
          ? {
              ...candidate,
              run: {
                status: "failed",
                message: "",
                error: error instanceof Error ? error.message : "预览运行暂时不可用",
              },
            }
          : candidate),
      }));
    } finally {
      setRunningTurnId(null);
    }
  }

  const selectScenario = (scenario: Scenario) => {
    setSelectedScenarioId(scenario.id);
    setSidebarOpen(false);
  };

  const isEmpty = !selectedScenario || selectedTurns.length === 0;

  return (
    <main className={`${labStyles.lab} ${styles.previewLab}`}>
      <aside aria-label="评委预览主题" className={`${labStyles.sidebar} ${sidebarOpen ? labStyles.sidebarOpen : ""}`}>
        <div className={labStyles.sidebarBrand}>
          <span className={labStyles.wordmark}>LUMI</span>
          <div className={labStyles.sidebarBrandActions}>
            <button aria-label="关闭评估主题" className={`${labStyles.iconButton} ${labStyles.mobileClose}`} onClick={() => setSidebarOpen(false)} type="button">
              <XIcon aria-hidden="true" size={17} />
            </button>
          </div>
        </div>

          <div className={labStyles.threadList}>
            <div className={styles.sidebarIntro}>
              <strong>评委预览</strong>
            <span>5 个评估主题 · 每主题 1 条首问与 4 条后续建议</span>
          </div>
          <div className={labStyles.threadListLabel}>评估主题</div>
          <nav aria-label="选择评估主题" className={labStyles.threadItems}>
            {session?.scenarios.map((scenario) => (
              <div className={labStyles.threadItem} data-active={selectedScenario?.id === scenario.id || undefined} key={scenario.id}>
                <button onClick={() => selectScenario(scenario)} type="button"><span>{scenario.title}</span></button>
              </div>
            ))}
          </nav>
        </div>

        <div className={`${labStyles.sidebarFooter} ${styles.sidebarFooter}`}>
          <LockKeyholeIcon aria-hidden="true" size={15} />
          <span>匿名演示不会读取真实学生资料</span>
        </div>
      </aside>

      {sidebarOpen ? <button aria-label="关闭评估主题" className={labStyles.scrim} onClick={() => setSidebarOpen(false)} type="button" /> : null}

      <section aria-label="Lumi 评委预览对话" className={labStyles.workspace}>
        <header className={labStyles.topbar}>
          <button aria-label="打开评估主题" className={`${labStyles.iconButton} ${labStyles.mobileMenu}`} onClick={() => setSidebarOpen(true)} type="button">
            <MenuIcon aria-hidden="true" size={18} />
          </button>
          <div className={styles.topbarTitle}>
            <strong>{selectedScenario?.title ?? "评委预览"}</strong>
            <span>{selectedScenario?.sourceLabel ?? "正在准备受控演示会话"}</span>
          </div>
          <span className={styles.topbarMode}>{hasInitialAnswer ? "可继续交流" : "受控首问"}</span>
        </header>

        <div className={labStyles.threadStage}>
          {sessionError ? (
            <div className={styles.centerState} role="alert"><CircleAlertIcon aria-hidden="true" size={18} /><span>{sessionError}</span></div>
          ) : !session ? (
            <div className={styles.centerState} role="status"><LoaderCircleIcon aria-hidden="true" className={labStyles.spin} size={18} /><span>正在准备匿名预览会话…</span></div>
          ) : (
            <section className={labStyles.threadRoot} data-empty={isEmpty || undefined}>
              <div className={labStyles.threadViewport} ref={viewportRef}>
                <div className={labStyles.threadInner}>
                  {isEmpty && selectedScenario ? (
                    <div className={labStyles.welcome}>
                      <p className={styles.eyebrow}>Lumi · 评委预览演示</p>
                      <h1>从一个预设问题开始。</h1>
                      <p className={styles.welcomeCopy}>{selectedScenario.description} 首轮由固定问题开启；回答后会出现可继续走的建议，也可以自由追问。</p>
                    </div>
                  ) : null}

                  {!isEmpty && selectedScenario ? (
                    <div className={labStyles.messageList}>
                      {selectedTurns.map((turn, index) => (
                        <div className={styles.turnPair} key={turn.id}>
                          <article className={labStyles.userMessage}>
                            <div className={labStyles.userBubble}>
                              {turn.label ? <span className={labStyles.userCapability}>评委预设 · {turn.label}</span> : null}
                              <p>{turn.prompt}</p>
                              {turn.attachments?.length ? (
                                <div aria-label="随问题附上的视觉参考" className={styles.referenceAttachments} data-count={turn.attachments.length}>
                                  {turn.attachments.map((attachment) => (
                                    <figure className={styles.referenceAttachment} key={attachment.id}>
                                      <Image alt={attachment.alt} height={88} src={attachment.url} width={72} />
                                      <figcaption>{attachment.label}</figcaption>
                                    </figure>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </article>

                          <article className={labStyles.assistantMessage}>
                            <div className={labStyles.assistantBody}>
                              {turn.run.status === "streaming" ? <PreviewThinkingState /> : null}
                              {turn.run.status === "completed" && turn.run.response ? (
                                <>
                                  <section aria-label="Lumi 最终回答" className={labStyles.answerGroup}>{markdownResponse(turn.run.response.message, false)}</section>
                                  <section aria-label="本分支结果状态" className={styles.branchOutcome}>
                                    <small>本分支结果</small>
                                    <strong>{turn.run.response.branch.outcome.label}</strong>
                                    <p>{turn.run.response.branch.outcome.description}</p>
                                  </section>
                                  {turn.suggestionId === selectedScenario.initial.id && index === 0 ? (
                                    <section aria-label="建议的后续操作" className={`${labStyles.followups} ${styles.branchGrid}`}>
                                      {selectedScenario.suggestions.map((suggestion) => (
                                        <button
                                          disabled={Boolean(runningTurnId)}
                                          key={suggestion.id}
                                          onClick={() => void runTurn(selectedScenario, {
                                            label: suggestion.label,
                                            prompt: suggestion.prompt,
                                            suggestionId: suggestion.id,
                                          })}
                                          type="button"
                                        >
                                          <span>{suggestion.label}</span>
                                          <ExternalLinkIcon aria-hidden="true" size={14} />
                                        </button>
                                      ))}
                                    </section>
                                  ) : null}
                                </>
                              ) : null}
                              {turn.run.status === "streaming" && turn.run.message ? (
                                <section aria-label="Lumi 最终回答" className={labStyles.answerGroup}>{markdownResponse(turn.run.message, true)}</section>
                              ) : null}
                              {turn.run.status === "failed" ? (
                                <>
                                  <div className={labStyles.messageError} role="alert"><CircleAlertIcon aria-hidden="true" size={17} /><div><strong>回答未完成</strong><span>{turn.run.error}</span></div></div>
                                  <section aria-label="本分支结果状态" className={styles.branchOutcome}>
                                    <small>本分支结果</small>
                                    <strong>待重新运行</strong>
                                    <p>这次提问尚未形成可用结果；可直接重试或换一条后续建议。</p>
                                  </section>
                                </>
                              ) : null}
                            </div>
                          </article>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <footer className={labStyles.viewportFooter}>
                    {isEmpty && selectedScenario ? (
                      <div aria-label={`${selectedScenario.title}的预设首问`} className={labStyles.followups}>
                        <button
                          disabled={Boolean(runningTurnId)}
                          onClick={() => void runTurn(selectedScenario, {
                            label: selectedScenario.initial.label,
                            prompt: selectedScenario.initial.prompt,
                            suggestionId: selectedScenario.initial.id,
                            attachments: selectedScenario.initial.attachments,
                          })}
                          type="button"
                        >
                          <PlayIcon aria-hidden="true" size={15} />
                          <span>{selectedScenario.initial.label}</span>
                          <ChevronRightIcon aria-hidden="true" size={15} />
                        </button>
                      </div>
                    ) : null}
                    {!hasInitialAnswer ? (
                      <div aria-disabled="true" aria-label="固定评估建议，不提供自由输入" className={`${labStyles.composerShell} ${styles.lockedComposer}`}>
                        <div className={styles.lockedComposerRow}>
                          <LockKeyholeIcon aria-hidden="true" size={17} />
                          <span>先完成预设首问，随后可选择建议或自由输入。</span>
                        </div>
                      </div>
                    ) : (
                      <PreviewComposer
                        disabled={Boolean(runningTurnId)}
                        onSubmit={(message) => {
                          if (!selectedScenario) return;
                          void runTurn(selectedScenario, { prompt: message });
                        }}
                      />
                    )}
                    <p className={styles.disclosure}>记录仅作演示数据并在 24 小时后清理。</p>
                  </footer>
                </div>
              </div>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}
