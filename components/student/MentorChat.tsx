"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";

import type { AgentView } from "@/lib/agent/contracts";
import { createVisualMentorReply, type MentorContext, type MentorVisualReply } from "@/lib/domain/visual-mentor";
import type { ToolAdapterTarget } from "@/lib/tool-adapters/contract";

import { AgentMentorAnswer } from "./AgentMentorAnswer";
import { AgentRunProgress } from "./AgentRunProgress";
import { ProjectBriefSummary } from "./ProjectBriefSummary";
import { useAgentConversation } from "./use-agent-conversation";
import { VoiceButton } from "./VoiceButton";

type OpenTool = (tool: ToolAdapterTarget, focus?: string | null) => void;

const starterQuestions = [
  "我想做一张酷一点的海报",
  "我想做一个IP形象，但不知道从哪里开始",
  "我想做一个声音驱动画面的作品",
  "声音已经有数值，画面为什么不动？",
  "书籍导览册的信息层级怎么安排？",
];

export function MentorChat({
  onOpenTool,
  context = "AGENT",
  focus = null,
  focusRequest = 0,
  taskId,
  fetchImpl = fetch,
}: {
  onOpenTool: OpenTool;
  context?: AgentView;
  focus?: string | null;
  focusRequest?: number;
  taskId?: string;
  fetchImpl?: typeof fetch;
}) {
  const [question, setQuestion] = useState("");
  const [artwork, setArtwork] = useState<File | null>(null);
  const [artworkPreview, setArtworkPreview] = useState("");
  const [artworkError, setArtworkError] = useState("");
  const [allowExternalSearch, setAllowExternalSearch] = useState(false);
  const agent = useAgentConversation(fetchImpl, context, taskId);
  const conversationRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const artworkInputRef = useRef<HTMLInputElement>(null);
  const artworkPreviewRef = useRef("");
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    return () => {
      if (artworkPreviewRef.current) URL.revokeObjectURL(artworkPreviewRef.current);
    };
  }, []);

  useEffect(() => {
    if (agent.turns.length === 0 && !agent.pending) return;
    if (!stickToBottomRef.current) return;
    const frame = requestAnimationFrame(() => {
      const conversation = conversationRef.current;
      if (!conversation) return;
      const reduceMotion = typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (typeof conversation.scrollTo === "function") conversation.scrollTo({ top: conversation.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
      else conversation.scrollTop = conversation.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [agent.pending, agent.runEvents.length, agent.turns.length]);
  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus();
  }, [focusRequest]);

  if (agent.legacyMode) return <LegacyMentorChat onOpenTool={onOpenTool} />;

  function clearArtwork() {
    if (artworkPreviewRef.current) URL.revokeObjectURL(artworkPreviewRef.current);
    artworkPreviewRef.current = "";
    setArtwork(null);
    setArtworkPreview("");
  }

  async function ask(value: string, externalSearch = false) {
    if (!value.trim()) return;
    stickToBottomRef.current = true;
    const turn = await agent.ask(value, focus, artwork, agent.externalSearchAvailable && externalSearch);
    if (turn) {
      setQuestion("");
      if (inputRef.current) inputRef.current.style.height = "";
      setAllowExternalSearch(false);
      clearArtwork();
      setArtworkError("");
    }
  }

  function selectArtwork(file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setArtworkError("仅支持 PNG、JPEG 或 WebP 图片");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setArtworkError("作品图片不能超过 5MiB");
      return;
    }
    if (artworkPreviewRef.current) URL.revokeObjectURL(artworkPreviewRef.current);
    const previewUrl = URL.createObjectURL(file);
    artworkPreviewRef.current = previewUrl;
    setArtwork(file);
    setArtworkPreview(previewUrl);
    setArtworkError("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(question, allowExternalSearch);
  }

  const latest = agent.turns.at(-1);
  const completedRunTurnId = agent.activeRun?.status === "COMPLETED"
    ? agent.activeRun.result?.turnId
    : undefined;
  const completedResultInTurns = Boolean(
    completedRunTurnId && agent.turns.some((turn) => turn.turnId === completedRunTurnId),
  );
  const packLabel = latest?.specialty?.label ?? (context === "BOOK_LAYOUT_LAB" ? "书籍设计专业增强" : "通用设计");
  const connectionLabel = agent.loading
    ? "正在恢复会话"
    : agent.activeRun?.status === "WAITING_APPROVAL"
      ? "等待你的确认"
      : agent.activeRun?.status === "QUEUED" || agent.activeRun?.status === "RUNNING"
        ? "运行可恢复"
        : agent.activeRun?.status === "FAILED" || agent.activeRun?.status === "CANCELLED"
          ? "本轮可重试"
    : latest?.aiMode === "DETERMINISTIC_FALLBACK"
      ? "确定性降级"
      : latest?.aiMode === "MODEL_ASSISTED"
        ? "模型协作中"
        : "通用设计对话已就绪";

  return <section aria-busy={agent.loading || agent.pending} className="flex h-dvh min-h-0 flex-col overflow-hidden bg-white" aria-labelledby="mentor-chat-title">
    <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-black/[.055] bg-white/90 pl-16 pr-4 backdrop-blur md:px-5">
      <div className="flex min-w-0 items-center gap-2"><h1 className="truncate text-sm font-semibold text-[#232b28]" id="mentor-chat-title">触映 Agent</h1><span className="hidden rounded-lg bg-[#f0f2ef] px-2 py-1 text-[10px] font-medium text-[#68716d] sm:inline">{packLabel}</span></div>
      <div className="flex items-center gap-2 text-[10px] text-[#6f7774]"><span className={`size-1.5 rounded-full ${agent.loading ? "animate-pulse bg-[#7b8581]" : latest?.aiMode === "DETERMINISTIC_FALLBACK" ? "bg-[#d29b2e]" : "bg-[#35a383]"}`} /><span>{connectionLabel}</span></div>
    </header>

    {focus ? <div className="flex shrink-0 items-center gap-2 border-b border-black/[.045] bg-[#f7f8f5] px-4 py-2 text-[11px] text-[#65706b] sm:px-6" aria-label="Agent 当前焦点"><strong className="shrink-0 text-[#315c50]">正在结合当前操作</strong><span className="truncate" title={focus}>{focus}</span></div> : null}
    <ProjectBriefSummary brief={agent.projectBrief} />

    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" onScroll={(event) => {
      const element = event.currentTarget;
      stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
    }} ref={conversationRef}>
      <div className="mx-auto flex min-h-full w-full max-w-[48rem] flex-col px-5 py-8 sm:px-8">
        {agent.turns.length === 0 && !agent.activeRun ? <div className="my-auto py-10">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto grid size-11 place-items-center rounded-full bg-[#17332d] text-lg text-[#ffbf47]" aria-hidden="true">✦</div>
            <h2 className="mt-6 text-3xl font-semibold tracking-[-0.035em] text-[#202825] sm:text-4xl">你现在想弄懂什么？</h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[#707975]">可以问任何艺术设计专业问题，也可以从一句模糊想法、一个卡住的地方或当前作品开始。下列只是示例，不是能力范围。</p>
            {agent.loading ? <p className="mt-4 text-xs text-[#7a837f]" role="status">正在恢复上次对话…</p> : null}
            {agent.error ? <div className="mt-4 rounded-xl bg-[#fff1ed] px-4 py-3 text-sm text-[#a44332]" role="alert"><p>{agent.error}</p><button className="mt-2 font-semibold underline" onClick={agent.reload} type="button">重试恢复会话</button></div> : null}
          </div>
          <div className="mx-auto mt-8 grid max-w-xl gap-2 sm:grid-cols-2">
            {starterQuestions.map((item) => <button className="rounded-xl border border-[#e2e3df] bg-white px-4 py-3 text-left text-sm leading-5 text-[#3f4945] transition hover:bg-[#f7f8f5] disabled:opacity-50" disabled={agent.pending || agent.loading} key={item} onClick={() => void ask(item)} type="button">{item}<span className="float-right text-[#8c9490]" aria-hidden="true">↗</span></button>)}
          </div>
        </div> : <div className="space-y-9 pb-5">
          {agent.turns.map((turn) => <div className="scroll-mt-20 space-y-5" id={`turn-${turn.turnId}`} key={turn.turnId}>
            <div className="ml-auto w-fit max-w-[88%] overflow-hidden rounded-[1.25rem] bg-[#f0f1ed] text-sm leading-6 text-[#26302c]">{turn.artworkAttachment ? <Image alt="本轮上传的作品" className="max-h-72 w-full object-contain" height={turn.artworkAttachment.height} src={turn.artworkAttachment.previewUrl} unoptimized width={turn.artworkAttachment.width} /> : null}<p className="whitespace-pre-wrap px-4 py-2.5 [overflow-wrap:anywhere]">{turn.studentMessage}</p></div>
            {turn.turnId === completedRunTurnId && agent.activeRun ? <AgentRunProgress busy={agent.runBusy} canReject={agent.canReject(turn)} events={agent.runEvents} execute={agent.execute} onCancel={() => void agent.cancel()} onOpenTool={onOpenTool} onRetry={() => void agent.retry()} run={agent.activeRun} submittedMessage={agent.submittedMessage} /> : <AgentMentorAnswer canReject={agent.canReject(turn)} execute={agent.execute} onOpenTool={onOpenTool} turn={turn} />}
          </div>)}
          {agent.activeRun && !completedResultInTurns ? <AgentRunProgress busy={agent.runBusy} canReject={agent.activeRun.result ? agent.canReject(agent.activeRun.result) : false} events={agent.runEvents} execute={agent.execute} onCancel={() => void agent.cancel()} onOpenTool={onOpenTool} onRetry={() => void agent.retry()} run={agent.activeRun} submittedMessage={agent.submittedMessage} /> : null}
          {agent.error ? <div className="rounded-xl bg-[#fff1ed] px-4 py-3 text-sm text-[#a44332]" role="alert"><p>{agent.error}</p><p className="mt-1 text-xs">你的输入仍保留在下方，可以修改后再次发送。</p></div> : null}
        </div>}
      </div>
    </div>

    <div className="relative z-20 shrink-0 bg-gradient-to-t from-white via-white to-white/0 px-3 pb-3 pt-3 sm:px-6 sm:pb-5">
      <form className="mx-auto max-w-[48rem] rounded-[1.65rem] border border-[#dedfdb] bg-white p-2 shadow-[0_8px_30px_rgba(23,32,28,.10)]" onSubmit={submit}>
        {artworkPreview ? <div className="mx-2 mt-1 flex items-center gap-3 rounded-2xl bg-[#f3f5f1] p-2"><Image alt="待发送作品预览" className="size-16 rounded-xl object-cover" height={64} src={artworkPreview} unoptimized width={64} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-[#34403b]">已添加作品图片</p><p className="mt-1 text-[10px] text-[#77817c]">{artwork?.type.replace("image/", "").toUpperCase()} · {artwork ? Math.ceil(artwork.size / 1024) : 0} KB</p></div><button aria-label="移除作品图片" className="grid size-8 place-items-center rounded-full text-[#65706b] hover:bg-white" onClick={clearArtwork} type="button">×</button></div> : null}
        {artworkError ? <p className="px-4 pt-2 text-xs text-[#a44332]" role="alert">{artworkError}</p> : null}
        <label className="sr-only" htmlFor="mentor-question">向学习智能体提问</label>
        <textarea className="max-h-36 min-h-14 w-full resize-none overflow-y-auto bg-transparent px-4 pb-2 pt-3 text-[15px] leading-6 text-[#202825] outline-none placeholder:text-[#8d9491]" id="mentor-question" onChange={(event) => { setQuestion(event.target.value); setAllowExternalSearch(false); event.currentTarget.style.height = "0px"; event.currentTarget.style.height = `${Math.min(144, event.currentTarget.scrollHeight)}px`; }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(question, allowExternalSearch); } }} placeholder="向触映提问" ref={inputRef} rows={1} value={question} />
        {agent.externalSearchAvailable ? <div className="mx-3 mb-2 rounded-xl bg-[#f5f7f4] px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#3f4a46]" htmlFor="mentor-external-search">
            <input checked={allowExternalSearch} className="size-3.5 accent-[#315c50]" disabled={!question.trim() || agent.pending || agent.loading} id="mentor-external-search" onChange={(event) => setAllowExternalSearch(event.target.checked)} type="checkbox" />
            允许本次联网检索
          </label>
          <p className="mt-1 pl-[1.375rem] text-[10px] leading-4 text-[#76807b]">会将本条消息经脱敏生成检索词，发送给外部检索服务；未勾选时仍会照常回答。</p>
        </div> : null}
        <div className="flex items-center gap-2 px-1 pb-1">
          <input accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { selectArtwork(event.target.files?.[0]); event.currentTarget.value = ""; }} ref={artworkInputRef} type="file" />
          <details className="relative"><summary aria-label="打开 Plugin 和 Skill 菜单" className="grid size-9 cursor-pointer list-none place-items-center rounded-full border border-[#dedfdb] text-xl font-light text-[#3e4844] hover:bg-[#f2f3ef]">＋</summary><div className="absolute bottom-12 left-0 z-50 w-64 rounded-2xl border border-[#dfdfdb] bg-white p-2 text-sm shadow-xl"><p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[#7a837f]">Plugin / Skill</p><button className="block w-full rounded-xl px-3 py-2 text-left hover:bg-[#f2f3ef]" onClick={() => artworkInputRef.current?.click()} type="button"><b className="block text-xs">理解作品图片</b><span className="text-[10px] text-[#727b77]">添加一张作品、草图或过程图</span></button><button className="block w-full rounded-xl px-3 py-2 text-left hover:bg-[#f2f3ef]" onClick={() => onOpenTool("NODE_CANVAS", "build")} type="button"><b className="block text-xs">TouchDesigner 插件</b><span className="text-[10px] text-[#727b77]">节点、案例与实时视觉能力</span></button><button className="block w-full rounded-xl px-3 py-2 text-left hover:bg-[#f2f3ef]" onClick={() => onOpenTool("BOOK_LAYOUT_LAB", "layout")} type="button"><b className="block text-xs">书籍设计 Skill</b><span className="text-[10px] text-[#727b77]">信息编排与版面验证</span></button><button className="block w-full rounded-xl px-3 py-2 text-left hover:bg-[#f2f3ef]" onClick={() => onOpenTool("KNOWLEDGE_MAP", "concept")} type="button"><b className="block text-xs">课程参考 Skill</b><span className="text-[10px] text-[#727b77]">课程知识与概念关系</span></button></div></details>
          <span className="hidden text-xs text-[#818986] sm:inline">项目理解会随对话自动保存</span>
          <span className="ml-auto" />
          <VoiceButton compact disabled={agent.loading || agent.pending} onTranscript={(value) => void ask(value)} />
          <button aria-label="发送问题" className="grid size-9 place-items-center rounded-full bg-[#17332d] text-base font-bold text-white transition hover:bg-[#285f50] disabled:bg-[#d8dcd9]" disabled={!question.trim() || agent.pending || agent.loading} type="submit">↑</button>
        </div>
      </form>
      <p className="mx-auto mt-2 max-w-[48rem] text-center text-[10px] text-[#8b928f]">触映可能出错。修改文件、软件网络和提交评价前都会先征求你的确认。</p>
    </div>
  </section>;
}

export function MentorDock({
  context,
  focus = null,
  taskId,
  onOpenChat,
  onOpenTool,
  fetchImpl = fetch,
}: {
  context: AgentView;
  focus?: string | null;
  taskId?: string;
  onOpenChat: () => void;
  onOpenTool: OpenTool;
  fetchImpl?: typeof fetch;
}) {
  const [question, setQuestion] = useState("");
  const [open, setOpen] = useState(false);
  const agent = useAgentConversation(fetchImpl, context, taskId);
  const latest = agent.turns.at(-1) ?? null;
  const completedRunTurnId = agent.activeRun?.status === "COMPLETED"
    ? agent.activeRun.result?.turnId
    : undefined;
  const visibleLatest = latest?.turnId === completedRunTurnId ? null : latest;

  if (agent.legacyMode) return <LegacyMentorDock context={context} onOpenChat={onOpenChat} onOpenTool={onOpenTool} />;

  async function ask(value: string) {
    if (!value.trim()) return;
    const turn = await agent.ask(value, focus);
    if (turn) { setQuestion(""); setOpen(true); }
  }

  return <aside className="fixed bottom-3 left-3 right-3 z-50 md:left-[15rem] lg:left-auto lg:w-[36rem]" aria-label="随时提问">
    {open && (visibleLatest || agent.activeRun) ? <div className="mb-2 max-h-[66vh] overflow-auto rounded-2xl border border-[#cbdad3] bg-[#fffef9] p-4 shadow-[0_18px_60px_rgba(23,51,45,.22)]">
      <div className="mb-3 flex items-center justify-between"><p className="text-xs font-black tracking-[0.16em] text-[#178b73]">触映正在理解当前界面与项目上下文</p><button aria-label="收起导师回答" className="text-[#58706a]" onClick={() => setOpen(false)} type="button">×</button></div>
      {visibleLatest ? <AgentMentorAnswer canReject={agent.canReject(visibleLatest)} execute={agent.execute} onOpenTool={onOpenTool} turn={visibleLatest} /> : null}
      {agent.activeRun ? <div className={visibleLatest ? "mt-4" : ""}><AgentRunProgress busy={agent.runBusy} canReject={agent.activeRun.result ? agent.canReject(agent.activeRun.result) : false} events={agent.runEvents} execute={agent.execute} onCancel={() => void agent.cancel()} onOpenTool={onOpenTool} onRetry={() => void agent.retry()} run={agent.activeRun} submittedMessage={agent.submittedMessage} /></div> : null}
      <button className="mt-4 text-xs font-black text-[#0d6858] underline" onClick={onOpenChat} type="button">转到完整问答并保留本次会话</button>
    </div> : null}
    {focus ? <div className="mb-2 flex items-center gap-2 rounded-xl border border-[#cad9d2] bg-[#f6faf7]/95 px-3 py-2 text-[10px] text-[#5a6f68] shadow-sm" aria-label="悬浮 Agent 当前焦点"><strong className="shrink-0 text-[#0d6858]">当前焦点</strong><span className="truncate" title={focus}>{focus}</span></div> : null}
    <form className="flex items-center gap-2 rounded-2xl border border-[#cad9d2] bg-white/95 p-2 shadow-[0_14px_40px_rgba(23,51,45,.2)] backdrop-blur" onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
      <button aria-label="打开完整问答" className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#17332d] text-[#ffbf47]" onClick={onOpenChat} type="button">✦</button>
      <label className="sr-only" htmlFor="mentor-dock-question">结合当前界面向导师提问</label>
      <input className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-[#83958f]" id="mentor-dock-question" onChange={(event) => setQuestion(event.target.value)} placeholder="结合当前界面问我…" value={question} />
      <VoiceButton compact disabled={agent.loading || agent.pending} onTranscript={(value) => void ask(value)} />
      <button aria-label="发送当前界面问题" className="grid size-10 place-items-center rounded-full bg-[#178b73] font-black text-white disabled:opacity-40" disabled={!question.trim() || agent.pending || agent.loading} type="submit">↑</button>
    </form>
    {agent.error && !open ? <p className="mt-2 rounded-xl bg-[#fff1ed] px-3 py-2 text-xs text-[#a44332]" role="alert">{agent.error}</p> : null}
  </aside>;
}

function legacyContext(context: AgentView): MentorContext {
  if (context === "NODE_CANVAS" || context === "KNOWLEDGE_MAP" || context === "PROJECT") return context;
  return "CHAT";
}

function LegacyReply({ reply, onOpenTool }: { reply: MentorVisualReply; onOpenTool: OpenTool }) {
  return <article className="rounded-2xl border border-[#dce4df] bg-white p-5">
    <p className="text-[10px] font-black tracking-[0.16em] text-[#92701c]">临时回退 · {reply.eyebrow}</p>
    <h2 className="mt-2 text-xl font-black text-[#17332d]">{reply.title}</h2>
    <p className="mt-3 text-sm leading-7 text-[#4f6760]">{reply.insight}</p>
    <div className="mt-4 flex flex-wrap gap-2">{reply.nodes.map((node) => <span className="rounded-full bg-[#edf5f0] px-3 py-2 text-xs font-bold text-[#31574d]" key={node.id}>{node.family} · {node.label}</span>)}</div>
    {reply.focusTool ? <button className="mt-4 rounded-xl bg-[#ffbf47] px-4 py-2.5 text-sm font-black text-[#513600]" onClick={() => onOpenTool(reply.focusTool!, reply.focusNode)} type="button">{reply.focusTool === "NODE_CANVAS" ? "进入节点画布" : "打开知识地图"} →</button> : null}
  </article>;
}

function LegacyMentorChat({ onOpenTool }: { onOpenTool: OpenTool }) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Array<{ question: string; reply: MentorVisualReply }>>([]);
  const ask = (value: string) => {
    const cleaned = value.trim();
    if (!cleaned) return;
    setTurns((current) => [...current, { question: cleaned, reply: createVisualMentorReply(cleaned, "CHAT") }]);
    setQuestion("");
  };
  return <section className="min-h-screen bg-[#fbfcf8] px-5 pb-32 pt-12" aria-labelledby="legacy-mentor-title">
    <div className="mx-auto max-w-3xl"><p className="text-xs font-black tracking-[0.18em] text-[#92701c]">AGENT V2 暂停 · 旧问答回退</p><h1 className="mt-3 text-3xl font-black text-[#17332d]" id="legacy-mentor-title">临时视觉导师</h1><p className="mt-3 text-sm text-[#58706a]">该模式只用于新版发布回退，不读取画像、项目与证据，也不会改变评价结果。</p>
      <div className="mt-8 space-y-5">{turns.map((turn, index) => <div className="space-y-3" key={`${turn.question}-${index}`}><p className="ml-auto w-fit rounded-2xl bg-[#17332d] px-4 py-3 text-sm text-white">{turn.question}</p><LegacyReply onOpenTool={onOpenTool} reply={turn.reply} /></div>)}</div>
    </div>
    <form className="fixed bottom-4 left-3 right-3 z-40 mx-auto flex max-w-3xl gap-2 rounded-2xl border border-[#cad9d2] bg-white p-2 shadow-xl md:left-[15rem]" onSubmit={(event) => { event.preventDefault(); ask(question); }}><label className="sr-only" htmlFor="legacy-mentor-question">向临时视觉导师提问</label><input className="min-w-0 flex-1 px-3 outline-none" id="legacy-mentor-question" onChange={(event) => setQuestion(event.target.value)} placeholder="描述现象或目标…" value={question} /><button className="rounded-xl bg-[#178b73] px-5 font-black text-white" type="submit">发送</button></form>
  </section>;
}

function LegacyMentorDock({ context, onOpenChat, onOpenTool }: { context: AgentView; onOpenChat: () => void; onOpenTool: OpenTool }) {
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<MentorVisualReply | null>(null);
  return <aside className="fixed bottom-3 left-3 right-3 z-50 md:left-[15rem] lg:left-auto lg:w-[36rem]" aria-label="临时回退问答">
    {reply ? <div className="mb-2 max-h-[60vh] overflow-auto rounded-2xl bg-[#fffef9] p-4 shadow-xl"><LegacyReply onOpenTool={onOpenTool} reply={reply} /><button className="mt-3 text-xs font-black text-[#0d6858] underline" onClick={onOpenChat} type="button">打开临时完整问答</button></div> : null}
    <form className="flex gap-2 rounded-2xl border border-[#cad9d2] bg-white p-2 shadow-xl" onSubmit={(event) => { event.preventDefault(); if (question.trim()) { setReply(createVisualMentorReply(question, legacyContext(context))); setQuestion(""); } }}><label className="sr-only" htmlFor="legacy-dock-question">向临时视觉导师提问</label><input className="min-w-0 flex-1 px-2 outline-none" id="legacy-dock-question" onChange={(event) => setQuestion(event.target.value)} placeholder="回退模式：描述当前现象…" value={question} /><button className="rounded-xl bg-[#178b73] px-4 font-black text-white" type="submit">发送</button></form>
  </aside>;
}
