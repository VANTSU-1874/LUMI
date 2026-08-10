"use client";

import Image from "next/image";
import { type DragEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type { AgentRunInterventionMode } from "@/components/client-api";
import { LumiButton, LumiLoading, LumiNotice, LumiProgress, LumiTag } from "@/components/design-system/LumiUI";

import { SpeechInputButton } from "./SpeechInputButton";
import styles from "./student-app.module.css";
import type { LumiStudentSession } from "./use-lumi-student-session";

const starters = [
  "我有一个模糊想法，想先理清目标",
  "我的作品看着很满，但不知道问题在哪",
  "声音有数值，画面为什么不动？",
];
const emptyInterventionMessages: LumiStudentSession["interventionMessages"] = [];

function interventionStatusLabel(
  intervention: LumiStudentSession["interventionMessages"][number],
) {
  if (intervention.status === "SAVING") return "正在保存";
  if (
    intervention.requestedMode === "STEER"
    && intervention.actualMode === "FOLLOW_UP"
  ) {
    return "已转为下一轮";
  }
  if (intervention.status === "QUEUED") {
    return intervention.actualMode === "STEER" ? "正在切换方向" : "已排队";
  }
  if (intervention.status === "ACTIVE") return "正在处理";
  if (intervention.status === "COMPLETED") return "已完成";
  return "未处理";
}

export function ConversationPanel({
  session,
  artwork,
  artworkPreview,
  artworkError,
  onSelectArtwork,
  onClearArtwork,
  onSubmit,
  onOpenArtifact,
}: {
  session: LumiStudentSession;
  artwork: File | null;
  artworkPreview: string;
  artworkError: string;
  onSelectArtwork: (file: File) => void;
  onClearArtwork: () => void;
  onSubmit: (
    message: string,
    mode?: AgentRunInterventionMode,
  ) => Promise<boolean>;
  onOpenArtifact: () => void;
}) {
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const [speechListening, setSpeechListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canIntervene = session.busy && session.interventionsEnabled;
  const composerLocked = session.busy && !canIntervene;
  const interventionMessages = session.interventionMessages
    ?? emptyInterventionMessages;
  const standaloneInterventions = interventionMessages.filter(
    (intervention) => intervention.turnId === null,
  );
  const interventionsByTurn = useMemo(() => {
    const grouped = new Map<
      string,
      LumiStudentSession["interventionMessages"]
    >();
    for (const intervention of interventionMessages) {
      if (!intervention.turnId) continue;
      grouped.set(intervention.turnId, [
        ...(grouped.get(intervention.turnId) ?? []),
        intervention,
      ]);
    }
    return grouped;
  }, [interventionMessages]);
  const tokenText = useMemo(() => session.runEvents
    .filter((event) => event.kind === "TOKEN")
    .map((event) => event.payload.text ?? "")
    .join(""), [session.runEvents]);
  const latestStep = [...session.runEvents]
    .reverse()
    .find((event) => event.kind !== "TOKEN" && event.kind !== "RUN_CREATED");

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = message ? `${Math.min(150, textarea.scrollHeight)}px` : "";
  }, [message]);

  async function send(
    value = message,
    mode?: AgentRunInterventionMode,
  ) {
    if (speechListening) return;
    const effectiveMode = mode ?? (canIntervene ? "FOLLOW_UP" : undefined);
    const sent = effectiveMode
      ? await onSubmit(value, effectiveMode)
      : await onSubmit(value);
    if (sent) {
      setMessage("");
      if (textareaRef.current) textareaRef.current.style.height = "";
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (speechListening) return;
    void send();
  }

  function acceptDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (session.busy) return;
    const file = event.dataTransfer.files[0];
    if (file) onSelectArtwork(file);
  }

  return <section className={styles.conversation} aria-busy={session.loading || session.busy} aria-label="与 Lumi 对话">
    <div className={styles.conversationTop}>
      {session.demo ? <div className={styles.demoBanner} role="status"><b>预置演示</b><span>不是真实学生记录</span></div> : null}
      <header className={styles.conversationHeader}>
        <div>
          <p>{session.latestTurn?.coursePack.label ?? session.currentCourseLabel}</p>
          <span><i className={session.busy ? styles.statusBusy : ""} />{session.busy ? "本轮正在后台运行" : "可以开始新的问题"}</span>
        </div>
        <button className={styles.mobileArtifactButton} onClick={onOpenArtifact} type="button">作品与会诊</button>
      </header>
    </div>

    <div className={styles.messages}>
      <div className={styles.messageInner}>
        {session.turns.length === 0 && !session.pendingMessage ? <div className={styles.conversationWelcome}>
          <p className={styles.kicker}>从你的问题开始</p>
          <h1 className="lumi-cn-heading">你现在想弄懂什么？</h1>
          <p>可以从一句模糊想法、一个卡住的地方，或一张正在修改的作品开始。Lumi 会先回应你，再说明判断依据。</p>
          <div className={styles.starters}>
            {starters.map((starter) => <button disabled={session.busy} key={starter} onClick={() => void send(starter)} type="button">{starter}<span aria-hidden="true">↗</span></button>)}
          </div>
        </div> : null}

        {session.turns.map((turn) => <article className={styles.turn} key={turn.turnId}>
          <div className={styles.studentMessage}>
            {turn.artworkAttachment ? <Image alt="本轮学生作品" height={turn.artworkAttachment.height} src={turn.artworkAttachment.previewUrl} unoptimized width={turn.artworkAttachment.width} /> : null}
            <p>{turn.studentMessage}</p>
            {interventionsByTurn.get(turn.turnId)?.map((intervention) => <span className={styles.interventionStatus} key={intervention.id}>{interventionStatusLabel(intervention)}</span>)}
          </div>
          <div className={styles.mentorMessage}>
            <div className={styles.mentorIdentity}><span aria-hidden="true">L</span><div><b>Lumi</b><small>{turn.aiMode === "DETERMINISTIC_FALLBACK" ? "确定性降级回答" : "课程化设计导师"}</small></div></div>
            <p className={styles.replyEyebrow}>{turn.reply.eyebrow}</p>
            <h2>{turn.reply.title}</h2>
            <p className={styles.replyBody}>{turn.reply.message}</p>
            {turn.reply.sources.length ? <div className={styles.replySources}><span>本轮依据</span>{turn.reply.sources.map((source) => <LumiTag key={source.id}>{source.title}</LumiTag>)}</div> : null}
            {turn.critique ? <button className={styles.critiqueLink} onClick={onOpenArtifact} type="button">查看五维会诊与本轮收束 <span aria-hidden="true">→</span></button> : null}
            {session.activeRun?.status === "WAITING_APPROVAL" && session.activeRun.result?.turnId === turn.turnId
              ? <section className={styles.approvalCard} aria-label="等待确认的受控行动">
                <p><b>回答已经保存。</b>下面的行动尚未执行，只有你明确选择后才会继续。</p>
                {turn.reply.actions.filter((action) => action.status === "PROPOSED").map((action) => <div key={action.id}>
                  <strong>{action.label}</strong>
                  <span>{action.description}</span>
                  <div>
                    <LumiButton busy={session.approvalBusy} onClick={() => void session.resolveApproval(action.id, "APPROVE")} size="small">批准并执行此受控行动</LumiButton>
                    <LumiButton disabled={session.approvalBusy} onClick={() => void session.resolveApproval(action.id, "REJECT")} size="small" variant="secondary">保留回答，不执行</LumiButton>
                  </div>
                </div>)}
              </section>
              : null}
            {turn.executionSteps?.length ? <details className={styles.executionDetails}><summary>查看本轮如何完成</summary><ol>{turn.executionSteps.map((step) => <li key={step.id}><span>{step.label}</span><small>{step.summary}</small></li>)}</ol></details> : null}
            <p className={styles.uncertainty}>{turn.reply.uncertainty}</p>
          </div>
        </article>)}

        {session.pendingMessage ? <article className={styles.turn}>
          <div className={styles.studentMessage}><p>{session.pendingMessage}</p></div>
          <div className={styles.mentorMessage}>
            <div className={styles.mentorIdentity}><span aria-hidden="true">L</span><div><b>Lumi</b><small>本轮可恢复</small></div></div>
            {tokenText ? <p className={styles.replyBody}>{tokenText}</p> : <LumiLoading label={latestStep?.label ?? "正在理解你的问题与作品…"} />}
            {latestStep ? <p className={styles.runSummary}>{latestStep.summary}</p> : null}
            {session.busy ? <LumiButton onClick={() => void session.cancel()} size="small" variant="quiet">停止本轮</LumiButton> : null}
          </div>
        </article> : null}

        {standaloneInterventions.length ? <section className={styles.interventionQueue} aria-label="后续消息队列" aria-live="polite">
          <p>后续消息</p>
          {standaloneInterventions.map((intervention) => <article key={intervention.id}>
            <div>
              <span>{intervention.requestedMode === "STEER" ? "方向调整" : "下一轮"}</span>
              <b>{interventionStatusLabel(intervention)}</b>
            </div>
            <p>{intervention.content}</p>
          </article>)}
        </section> : null}

        {session.transportNotice ? <LumiNotice title="已切换为后台状态恢复"><p>{session.transportNotice}</p></LumiNotice> : null}
        {session.error ? <LumiNotice title="运行提示" tone="error"><p>{session.error}</p>{session.activeRun?.status === "FAILED" ? <LumiButton onClick={() => void session.retry()} size="small" variant="secondary">保留原问题并重试</LumiButton> : null}{!session.entryRequired && !session.activeRun ? <LumiButton onClick={() => void session.reload()} size="small" variant="secondary">重新加载学习空间</LumiButton> : null}</LumiNotice> : null}
      </div>
    </div>

    <div className={styles.composerWrap}>
      <form className={`${styles.composer} ${dragging ? styles.composerDragging : ""}`} onDragEnter={(event) => { event.preventDefault(); if (!session.busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDragOver={(event) => event.preventDefault()} onDrop={acceptDrop} onSubmit={submit}>
        {artworkPreview ? <div className={styles.composerArtwork}>
          <Image alt="待提交作品预览" height={72} src={artworkPreview} unoptimized width={72} />
          <div><b>{artwork?.name ?? "本轮作品"}</b><span>{artwork ? `${Math.ceil(artwork.size / 1024)} KB` : "已选择"}</span></div>
          <button aria-label="移除作品" onClick={onClearArtwork} type="button">×</button>
        </div> : null}
        {session.uploadProgress.phase !== "IDLE" && session.uploadProgress.phase !== "COMPLETE" ? <div className={styles.composerProgress}><LumiProgress detail={session.uploadProgress.message} indeterminate={session.uploadProgress.indeterminate} label={session.uploadProgress.phase === "PROCESSING" ? "作品已上传，正在阅读" : "作品上传"} value={session.uploadProgress.percent} /></div> : null}
        {artworkError ? <p className={styles.composerError} role="alert">{artworkError}</p> : null}
        <label className="sr-only" htmlFor="lumi-message">向 Lumi 提问</label>
        <textarea aria-describedby={speechListening ? "lumi-speech-status" : canIntervene ? "lumi-intervention-hint" : undefined} disabled={composerLocked} id="lumi-message" maxLength={2_000} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (!speechListening && event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder={canIntervene ? "补充到下一轮，或改变当前方向…" : artwork ? "可以补一句你最想解决的问题；也可以直接发送作品" : "说说你的想法、困惑，或把作品拖到这里…"} readOnly={speechListening} ref={textareaRef} rows={1} value={message} />
        {canIntervene ? <p className={styles.interventionHint} id="lumi-intervention-hint">当前运行中：可追加文字；作品与语音将在本轮结束后恢复。</p> : null}
        <div className={styles.composerActions}>
          <div className={styles.composerTools}>
            <input accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={session.busy || speechListening} onChange={(event) => { const file = event.target.files?.[0]; if (file) onSelectArtwork(file); event.currentTarget.value = ""; }} ref={inputRef} type="file" />
            <button className={styles.composerToolButton} disabled={session.busy || speechListening} onClick={() => inputRef.current?.click()} title={session.busy ? "本轮结束后可添加作品" : undefined} type="button"><span aria-hidden="true">＋</span> 添加作品</button>
            <SpeechInputButton disabled={session.busy} onListeningChange={setSpeechListening} onValueChange={setMessage} value={message} />
          </div>
          <span>{canIntervene ? "Enter 追加 · Shift + Enter 换行" : "Enter 发送 · Shift + Enter 换行"}</span>
          {canIntervene ? <div className={styles.interventionActions}>
            <button disabled={session.interventionBusy || speechListening || !message.trim()} onClick={() => void send(message, "STEER")} type="button">改变当前方向</button>
            <button disabled={session.interventionBusy || speechListening || !message.trim()} type="submit">追加到下一轮</button>
          </div> : <button aria-label="发送问题" className={styles.sendButton} disabled={session.busy || speechListening || (!message.trim() && !artwork)} type="submit">↑</button>}
        </div>
      </form>
      <p id="lumi-composer-privacy">Lumi 只依据可见事实、你的明确意图与可核对的学习记录判断；使用语音时浏览器可能调用语音服务，本站不保存录音，文字仍需你手动发送。</p>
    </div>
  </section>;
}
