"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { StudentDashboardSchema, StudentHintPublicResponseSchema, type StudentDashboard } from "@/lib/domain/student-dashboard";
import type { AgentView } from "@/lib/agent/contracts";

import { BookLayoutLab } from "./BookLayoutLab";
import { CurrentProject } from "./CurrentProject";
import { DiagnosticFlow } from "./DiagnosticFlow";
import { EvidencePanel } from "./EvidencePanel";
import { GenerativeLab } from "./GenerativeLab";
import { LogicCardForm } from "./LogicCardForm";
import { KnowledgeMap } from "./KnowledgeMap";
import { LayoutGridLab } from "./LayoutGridLab";
import { MentorChat, MentorDock } from "./MentorChat";
import { NodeLearningStudio } from "./NodeLearningStudio";
import { ProfileCard } from "./ProfileCard";
import { StageRail } from "./StageRail";
import { SignalLab } from "./SignalLab";
import { StudentStudioNav, type StudentStudioView } from "./StudentStudioNav";
import { TouchDesignerCaseLibrary } from "./TouchDesignerCaseLibrary";
import { ToolPathPlan, ToolPathSummary } from "./ToolPathPlan";
import { TransferChallenge } from "./TransferChallenge";
import { TroubleshootingFlow } from "./TroubleshootingFlow";
import { useDesignTasks } from "./use-design-tasks";
import { EvidenceHistory } from "@/components/common/EvidenceHistory";

type StudentHint = ReturnType<typeof StudentHintPublicResponseSchema.parse>;
export function HintPanel({ projectId, layer, initialHint, initialHintSequence, onSaved, fetchImpl }: {
  projectId: string;
  layer: string;
  initialHint: StudentHint | null;
  initialHintSequence: number;
  onSaved: () => void;
  fetchImpl: typeof fetch;
}) {
  return <HintPanelInstance key={projectId} projectId={projectId} layer={layer} initialHint={initialHint} initialHintSequence={initialHintSequence} onSaved={onSaved} fetchImpl={fetchImpl} />;
}

function HintPanelInstance({ projectId, layer, initialHint, initialHintSequence, onSaved, fetchImpl }: {
  projectId: string;
  layer: string;
  initialHint: StudentHint | null;
  initialHintSequence: number;
  onSaved: () => void;
  fetchImpl: typeof fetch;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [localHint, setLocalHint] = useState({ sequence: initialHintSequence, value: initialHint });
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const projectRef = useRef(projectId);
  const snapshotHintSequenceRef = useRef(initialHintSequence);

  useEffect(() => {
    projectRef.current = projectId;
    return () => {
      sequence.current += 1;
      controller.current?.abort();
      controller.current = null;
      inFlight.current = false;
    };
  }, [projectId]);
  useEffect(() => {
    snapshotHintSequenceRef.current = initialHintSequence;
  }, [initialHintSequence]);

  const hint = initialHintSequence > localHint.sequence ? initialHint : localHint.value;

  async function requestHint() {
    if (inFlight.current) return;
    inFlight.current = true;
    const requestSequence = ++sequence.current;
    const currentProject = projectId;
    const startingHintSequence = initialHintSequence;
    const abort = new AbortController(); controller.current = abort; setPending(true); setError("");
    try {
      const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}/hints`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: abort.signal,
        body: JSON.stringify({ question: `请提示我如何验证当前${layer}信号层` }),
      });
      const raw: unknown = await response.json();
      if (abort.signal.aborted || requestSequence !== sequence.current || currentProject !== projectRef.current || startingHintSequence !== snapshotHintSequenceRef.current) return;
      if (!response.ok) throw new Error(typeof raw === "object" && raw && "error" in raw && typeof raw.error === "string" ? raw.error : "提示请求失败");
      const parsed = StudentHintPublicResponseSchema.safeParse(raw);
      if (!parsed.success) throw new Error("提示响应无效");
      if (abort.signal.aborted || requestSequence !== sequence.current || currentProject !== projectRef.current) return;
      setLocalHint({ sequence: initialHintSequence + 1, value: parsed.data });
      onSaved();
    } catch (reason) {
      if (!abort.signal.aborted && requestSequence === sequence.current && currentProject === projectRef.current) {
        setError(reason instanceof Error ? reason.message : "提示请求失败");
      }
    } finally {
      if (requestSequence === sequence.current && currentProject === projectRef.current) {
        controller.current = null; inFlight.current = false; setPending(false);
      }
    }
  }
  return <section aria-labelledby="hint-title" className="rounded-2xl border border-slate-200 bg-white p-5">
    <h2 id="hint-title" className="text-xl font-bold">分层学习提示</h2>
    <p className="mt-2 text-sm text-slate-600">只围绕当前 {layer} 信号层给出一个学习动作。</p>
    <button className="mt-3 rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50" disabled={pending} onClick={() => void requestHint()} type="button">{pending ? "生成中…" : "获取当前层提示"}</button>
    {error && <p className="mt-2 text-red-700" role="alert">{error}</p>}
    {hint && <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4" aria-live="polite">
      <p className="font-semibold">第 {hint.hintLevel} 级提示</p>
      {hint.confirmedFacts.length > 0 && <div><h3 className="font-semibold">已确认</h3><ul className="list-disc pl-5">{hint.confirmedFacts.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {hint.hypotheses.length > 0 && <div><h3 className="font-semibold">待验证</h3><ul className="list-disc pl-5">{hint.hypotheses.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {hint.questions.length > 0 && <div><h3 className="font-semibold">先回答</h3><ul className="list-disc pl-5">{hint.questions.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {hint.guidance.length > 0 && <div><h3 className="font-semibold">操作提示</h3><ul className="list-disc pl-5">{hint.guidance.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {hint.nextSteps.length > 0 && <div><h3 className="font-semibold">下一步</h3><ul className="list-disc pl-5">{hint.nextSteps.map((step) => <li key={step}>{step}</li>)}</ul></div>}
      {hint.localExample && <p>本地示例：{hint.localExample}</p>}
      {hint.sources.length > 0 && <p className="text-sm text-slate-500">来源：{hint.sources.map(({ title }) => title).join("、")}</p>}
      <p className="text-sm text-slate-500">{hint.uncertainty}</p>
    </div>}
  </section>;
}

function Workflow({ dashboard, refresh, fetchImpl }: { dashboard: StudentDashboard; refresh: () => void; fetchImpl: typeof fetch }) {
  const project = dashboard.project;
  if (!project) return <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><h2 className="text-xl font-bold">尚无当前项目</h2><p className="mt-2 text-slate-600">课程任务发布后，工作台会在这里显示当前步骤。</p></section>;
  if (project.stage === "DIAGNOSTIC") return <DiagnosticFlow onComplete={refresh} />;
  if (project.stage === "LOGIC_CARD") return <LogicCardForm projectId={project.id} initialState={dashboard.logicCard} onSaved={refresh} />;
  const logicReview = dashboard.logicCard ? <LogicCardForm projectId={project.id} initialState={dashboard.logicCard} readOnly /> : null;
  const toolPathReview = dashboard.toolPath ? <ToolPathSummary plan={dashboard.toolPath} /> : null;
  if (project.stage === "TOOL_PATH") return <div className="space-y-5">{logicReview}<ToolPathPlan projectId={project.id} stage={project.stage} onPlanned={refresh} /></div>;
  if (project.stage === "BUILD" || project.stage === "TROUBLESHOOT") {
    const evidenceOptions = dashboard.evidence.recent.map((item) => ({ id: item.id, label: `${item.layer} · ${item.kind}` }));
    const layer = dashboard.troubleshooting?.state.currentLayer ?? "INPUT";
    return <div className="space-y-5">
      {logicReview}
      {toolPathReview}
      <EvidencePanel projectId={project.id} toolPath={dashboard.toolPath ? { path: dashboard.toolPath.path, requirements: dashboard.toolPath.requirements } : null} fetchImpl={fetchImpl} onSaved={refresh} />
      <TroubleshootingFlow key={`${project.id}:${dashboard.troubleshooting?.revision ?? 0}`} projectId={project.id} initialState={dashboard.troubleshooting} evidence={evidenceOptions} fetchImpl={fetchImpl} onAdvanced={refresh} />
      <HintPanel projectId={project.id} layer={layer} initialHint={dashboard.latestHint} initialHintSequence={dashboard.hints.count} fetchImpl={fetchImpl} onSaved={refresh} />
    </div>;
  }
  if (project.stage === "TRANSFER") return <div className="space-y-5">{logicReview}{toolPathReview}<TransferChallenge projectId={project.id} stage={project.stage} initialState={dashboard.transfer} fetchImpl={fetchImpl} onChanged={refresh} /></div>;
  return <div className="space-y-5">{logicReview}{toolPathReview}<section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8"><h2 className="text-2xl font-bold text-emerald-900">项目闭环完成</h2><p className="mt-2 text-emerald-800">你已完成逻辑、制作、证据排障与迁移挑战。</p></section></div>;
}

export function StudentShell({ fetchImpl = fetch }: { fetchImpl?: typeof fetch }) {
  const [dashboard, setDashboard] = useState<StudentDashboard | null>(null);
  const [view, setView] = useState<StudentStudioView>("CHAT");
  const [navOpen, setNavOpen] = useState(false);
  const [chatFocusRequest, setChatFocusRequest] = useState(0);
  const [chatContext, setChatContext] = useState<AgentView>("AGENT");
  const [toolFocus, setToolFocus] = useState<string | null>(null);
  const [agentFocus, setAgentFocus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const currentSnapshotVersion = useRef("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const designTasks = useDesignTasks(fetchImpl);

  const refresh = useCallback(async () => {
    const requestSequence = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setLoading((current) => dashboard === null ? true : current); setError("");
    try {
      const response = await fetchImpl("/api/student/dashboard", { method: "GET", cache: "no-store", signal: abort.signal, headers: { accept: "application/json" } });
      const raw: unknown = await response.json();
      if (requestSequence !== sequence.current || abort.signal.aborted) return;
      if (!response.ok) throw new Error(typeof raw === "object" && raw && "error" in raw && typeof raw.error === "string" ? raw.error : "工作台加载失败");
      const parsed = StudentDashboardSchema.safeParse(raw);
      if (!parsed.success) throw new Error("工作台响应无效");
      if (parsed.data.snapshotVersion === currentSnapshotVersion.current) return;
      currentSnapshotVersion.current = parsed.data.snapshotVersion;
      setDashboard(parsed.data);
    } catch (reason) {
      if (requestSequence !== sequence.current || abort.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "工作台加载失败");
    } finally { if (requestSequence === sequence.current) { controller.current = null; setLoading(false); } }
  }, [dashboard, fetchImpl]);

  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => {
    void refreshRef.current();
    return () => { sequence.current += 1; controller.current?.abort(); };
  }, []);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    function focusComposer(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (view !== "CHAT") setChatContext(agentContextForView(view));
      setView("CHAT");
      setNavOpen(false);
      setChatFocusRequest((current) => current + 1);
    }
    window.addEventListener("keydown", focusComposer);
    return () => window.removeEventListener("keydown", focusComposer);
  }, [view]);
  if (loading && !dashboard) return <main className="grid min-h-screen place-items-center" aria-busy="true"><p aria-live="polite">正在恢复你的项目与对话…</p></main>;
  if (error && !dashboard) return <main className="grid min-h-screen place-items-center p-6"><div className="text-center"><p ref={errorRef} tabIndex={-1} role="alert">{error}</p><button className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-white" onClick={() => void refresh()} type="button">重试</button></div></main>;
  if (!dashboard) return null;
  function openView(next: StudentStudioView, focus: string | null = null) {
    if (next === "CHAT" && view !== "CHAT") setChatContext(agentContextForView(view));
    if (next !== "CHAT") setAgentFocus(focus);
    setToolFocus(focus);
    setView(next);
    setNavOpen(false);
  }

  function startNewQuestion() {
    if (view !== "CHAT") setChatContext(agentContextForView(view));
    void designTasks.createTask().then(() => {
      setView("CHAT");
      setToolFocus(null);
      setAgentFocus(null);
      setNavOpen(false);
      setChatFocusRequest((current) => current + 1);
    });
  }

  return <main className="min-h-screen bg-white md:flex">
    <button aria-expanded={navOpen} aria-label="打开学习导航" className="fixed left-3 top-3 z-[65] grid size-10 place-items-center rounded-xl border border-[#e2e2dd] bg-white/90 text-[#39433f] shadow-sm backdrop-blur md:hidden" onClick={() => setNavOpen(true)} type="button"><span aria-hidden="true">☰</span></button>
    <StudentStudioNav active={view} activeTaskId={designTasks.activeTaskId} alias={dashboard.student.alias} isDemo={dashboard.dataType === "DEMONSTRATION_DATA"} isFallback={dashboard.aiMode === "DETERMINISTIC_FALLBACK"} mobileOpen={navOpen} onArchiveTask={async (taskId) => { await designTasks.updateTask(taskId, { status: "ARCHIVED" }); if (designTasks.tasks.filter(({ id, status }) => id !== taskId && status === "ACTIVE").length === 0) await designTasks.createTask(); }} onChange={(next) => openView(next)} onClose={() => setNavOpen(false)} onNewQuestion={startNewQuestion} onRenameTask={(taskId, title) => designTasks.updateTask(taskId, { title })} onRestoreTask={(taskId) => designTasks.updateTask(taskId, { status: "ACTIVE" })} onSelectTask={(taskId) => designTasks.selectTask(taskId)} tasks={designTasks.tasks} tasksLoading={designTasks.loading} />
    <div className="min-w-0 flex-1">
      {view === "CHAT" && designTasks.activeTaskId ? <MentorChat context={chatContext} fetchImpl={fetchImpl} focus={agentFocus} focusRequest={chatFocusRequest} key={designTasks.activeTaskId} onOpenTool={(tool, focus) => openView(tool, focus)} taskId={designTasks.activeTaskId} /> : null}
      {view === "CHAT" && !designTasks.activeTaskId ? <section className="grid h-dvh place-items-center px-6"><div className="text-center"><p className="text-sm text-[#66716c]" role="status">{designTasks.loading ? "正在恢复设计任务…" : designTasks.error || "正在准备新的设计任务…"}</p>{!designTasks.loading ? <button className="mt-4 rounded-xl bg-[#17332d] px-4 py-2 text-sm font-semibold text-white" onClick={startNewQuestion} type="button">新建设计任务</button> : null}</div></section> : null}
      {view === "WORKSPACE" ? <WorkspaceHub dashboard={dashboard} onOpen={openView} /> : null}
      {view === "RESOURCES" ? <ResourceHub onOpen={openView} /> : null}
      {view === "CASE_LIBRARY" ? <TouchDesignerCaseLibrary fetchImpl={fetchImpl} /> : null}
      {view === "NODE_CANVAS" ? <NodeLearningStudio initialFocus={toolFocus} key={`node:${toolFocus ?? "audio"}`} onAgentFocusChange={setAgentFocus} /> : null}
      {view === "KNOWLEDGE_MAP" ? <KnowledgeMap initialFocus={toolFocus} key={`map:${toolFocus ?? "default"}`} /> : null}
      {view === "BOOK_LAYOUT_LAB" ? <BookLayoutLab fetchImpl={fetchImpl} initialFocus={toolFocus} key={`book:${toolFocus ?? "layout"}`} /> : null}
      {view === "LAYOUT_GRID_LAB" ? <LayoutGridLab fetchImpl={fetchImpl} initialFocus={toolFocus} key={`grid:${toolFocus ?? "grid"}`} /> : null}
      {view === "GENERATIVE_LAB" ? <GenerativeLab fetchImpl={fetchImpl} initialFocus={toolFocus} key={`generative:${toolFocus ?? "create"}`} /> : null}
      {view === "PROJECT" ? <ProjectWorkspace dashboard={dashboard} error={error} errorRef={errorRef} fetchImpl={fetchImpl} refresh={() => void refresh()} /> : null}
    </div>
    {view !== "CHAT" ? <MentorDock context={agentContextForView(view)} fetchImpl={fetchImpl} focus={agentFocus} onOpenChat={() => openView("CHAT", agentFocus)} onOpenTool={(tool, focus) => openView(tool, focus)} taskId={designTasks.activeTaskId} /> : null}
  </main>;
}

function agentContextForView(view: StudentStudioView): AgentView {
  if (view === "CHAT") return "AGENT";
  return view;
}

function WorkspaceHub({ dashboard, onOpen }: { dashboard: StudentDashboard; onOpen: (view: StudentStudioView, focus?: string | null) => void }) {
  return <section className="min-h-screen bg-[#f3f5ef] px-4 pb-32 pt-5 sm:px-6 lg:px-8" aria-labelledby="workspace-title">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="rounded-[2rem] bg-[#17332d] px-6 py-8 text-white sm:px-8"><p className="text-xs font-black tracking-[0.2em] text-[#70d1bb]">WORKSPACE / 可操作学习场</p><h1 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-4xl" id="workspace-title">先动手，再观察结果</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-[#d8ebe5]">你可以自由搭节点、调整参数或重排版面；阶段记录、学习证据与教师复核集中保存在“过程记录”。</p></header>
      <div className="grid gap-5 lg:grid-cols-2">
        <WorkspaceCard accent="DIGITAL INTERACTION" description="从七类节点中选择、连接并调整参数。适合声音驱动画面、粒子、映射与排障。" eyebrow="数字交互文创课程包" onClick={() => onOpen("NODE_CANVAS", "build")} title="自由节点画布" visual={<div className="flex items-center gap-2"><NodeChip label="Audio" color="#285f4f" /><span>→</span><NodeChip label="Math" color="#285f4f" /><span>→</span><NodeChip label="Visual" color="#574377" /></div>} />
        <WorkspaceCard accent="BOOK DESIGN" description="用快速诊断、8页拖拽编排和受众迁移，验证同一智能体内核可以进入另一门设计课程。" eyebrow="书籍设计课程包" onClick={() => onOpen("BOOK_LAYOUT_LAB", "layout")} title="8页导览册编排台" visual={<div className="grid grid-cols-4 gap-1.5">{Array.from({ length: 8 }, (_, index) => <span className={`h-12 rounded-md ${index === 0 ? "bg-[#17332d]" : index > 5 ? "bg-[#e7b343]" : "bg-[#79aa9c]"}`} key={index} />)}</div>} />
        <WorkspaceCard accent="LAYOUT DESIGN" description="先设栏数、行数与四边留白，再放置主标题、正文和说明文字，用四条确定性判据检查结构。" eyebrow="版式设计课程包" onClick={() => onOpen("LAYOUT_GRID_LAB", "grid")} title="排版栅格微实验" visual={<div className="relative grid h-36 grid-cols-6 gap-1 rounded-lg border border-[#b0aaa2] bg-white p-3">{Array.from({ length: 24 }, (_, index) => <span className="rounded-sm bg-[#dfe8e3]" key={index} />)}<span className="absolute left-5 right-16 top-6 h-8 rounded bg-[#17332d]" /><span className="absolute bottom-7 left-5 top-16 w-2/5 rounded bg-[#79aa9c]" /><span className="absolute bottom-5 right-5 h-5 w-1/4 rounded bg-[#c8c3bc]" /></div>} />
        <WorkspaceCard accent="GENERATIVE LAB" description="让导师把一种形式语言现场变成可调参数的单文件生成器；服务端先做零外链校验，再放进隔离沙箱。" eyebrow="现场生成器 Skill" onClick={() => onOpen("GENERATIVE_LAB", "create")} title="视觉生成器实验台" visual={<div className="grid h-36 place-items-center overflow-hidden rounded-lg bg-[#1a1816]"><div className="relative size-28">{Array.from({ length: 25 }, (_, index) => { const row = Math.floor(index / 5); const column = index % 5; const size = 3 + ((row + column) % 3) * 2; return <span className="absolute rounded-full bg-[#f0eeeb]" key={index} style={{ height: size, left: `${column * 23 + 6}%`, top: `${row * 23 + 6}%`, width: size }} />; })}</div></div>} />
      </div>
      <button className="flex w-full flex-wrap items-center justify-between gap-4 rounded-[1.75rem] border border-[#d5dfda] bg-[#fffef9] px-6 py-5 text-left" onClick={() => onOpen("PROJECT")} type="button"><span><b className="block text-lg text-[#17332d]">查看当前项目过程</b><span className="mt-1 block text-sm text-[#61756f]">{dashboard.assignment?.title ?? "当前暂无项目"} · 阶段 {dashboard.project?.stage ?? "未开始"}</span></span><span className="rounded-xl bg-[#ffbf47] px-4 py-2 text-sm font-black text-[#513600]">进入过程记录 →</span></button>
    </div>
  </section>;
}

function WorkspaceCard({ accent, eyebrow, title, description, visual, onClick }: { accent: string; eyebrow: string; title: string; description: string; visual: React.ReactNode; onClick: () => void }) {
  return <article className="flex min-h-80 flex-col overflow-hidden rounded-[2rem] border border-[#d6e0db] bg-[#fffef9] p-6 sm:p-7"><p className="text-[10px] font-black tracking-[0.18em] text-[#178b73]">{eyebrow}</p><h2 className="mt-2 text-2xl font-black text-[#17332d]">{title}</h2><p className="mt-3 text-sm leading-7 text-[#5c716b]">{description}</p><div className="my-7 flex-1 rounded-2xl bg-[#eef3ef] p-5">{visual}</div><button className="flex items-center justify-between rounded-xl bg-[#17332d] px-4 py-3 text-sm font-black text-white" onClick={onClick} type="button"><span>{accent}</span><span className="text-[#ffbf47]">打开 →</span></button></article>;
}

function NodeChip({ label, color }: { label: string; color: string }) { return <span className="rounded-xl px-3 py-4 text-xs font-black text-white shadow" style={{ background: color }}>{label}</span>; }

function ResourceHub({ onOpen }: { onOpen: (view: StudentStudioView, focus?: string | null) => void }) {
  return <section className="min-h-screen bg-[#f3f5ef] px-4 pb-32 pt-5 sm:px-6 lg:px-8" aria-labelledby="resources-title"><div className="mx-auto max-w-7xl space-y-5"><header className="rounded-[2rem] border border-[#d5dfda] bg-[#fffef9] px-6 py-7 sm:px-8"><p className="text-xs font-black tracking-[0.2em] text-[#178b73]">COURSE RESOURCES / 课程包资料</p><h1 className="mt-3 text-3xl font-black tracking-[-0.04em] text-[#17332d]" id="resources-title">案例是参照，概念是坐标</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-[#5c716b]">这里用于查看真实工程与概念关系，不承担自由搭建。想修改节点或版面，请进入“工作空间”。</p></header><div className="grid gap-5 lg:grid-cols-2"><ResourceCard button="查看真实版本" caption="按课程目录比较主工程与备份，检查真实节点、参数、注释与版本差异。" label="真实工程案例" onClick={() => onOpen("CASE_LIBRARY")} symbol="▤" title="TouchDesigner 案例库" /><ResourceCard button="定位概念关系" caption="从输入、映射、传输、处理到输出，观察知识点在整体结构中的位置。" label="跨案例概念" onClick={() => onOpen("KNOWLEDGE_MAP")} symbol="⌘" title="知识地图" /></div></div></section>;
}

function ResourceCard({ symbol, label, title, caption, button, onClick }: { symbol: string; label: string; title: string; caption: string; button: string; onClick: () => void }) { return <article className="rounded-[2rem] border border-[#d5dfda] bg-[#fffef9] p-7"><span className="grid size-12 place-items-center rounded-2xl bg-[#e2f3ec] text-2xl text-[#0d6858]">{symbol}</span><p className="mt-6 text-[10px] font-black tracking-[0.16em] text-[#178b73]">{label}</p><h2 className="mt-2 text-2xl font-black text-[#17332d]">{title}</h2><p className="mt-3 min-h-14 text-sm leading-7 text-[#5c716b]">{caption}</p><button className="mt-6 rounded-xl bg-[#ffbf47] px-4 py-3 text-sm font-black text-[#513600]" onClick={onClick} type="button">{button} →</button></article>; }

function ProjectWorkspace({ dashboard, error, errorRef, fetchImpl, refresh }: {
  dashboard: StudentDashboard;
  error: string;
  errorRef: React.RefObject<HTMLParagraphElement | null>;
  fetchImpl: typeof fetch;
  refresh: () => void;
}) {
  const stageTitle = {
    DIAGNOSTIC: "先了解你的交互思维",
    LOGIC_CARD: "把创意翻译成可验证的逻辑",
    TOOL_PATH: "选择适合本项目的工具路径",
    BUILD: "制作第一个可运行原型",
    TROUBLESHOOT: "逐层定位信号问题",
    TRANSFER: "把结构迁移到新情境",
    COMPLETE: "复盘项目并巩固能力",
  }[dashboard.project?.stage ?? "DIAGNOSTIC"];

  return <section className="px-4 pb-32 pt-5 sm:px-6 lg:px-8" aria-labelledby="project-workspace-title">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 rounded-[1.75rem] bg-[#178b73] px-6 py-7 text-white shadow-[0_14px_36px_rgba(13,104,88,0.18)] sm:px-8">
        <div><p className="text-xs font-black tracking-[0.2em] text-[#b9efdf]">项目工作台 · 当前正式进度</p><h1 className="mt-2 text-2xl font-black sm:text-3xl" id="project-workspace-title">{stageTitle}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#e3f5ef]">这里保存真实任务、学习证据和教师可见的阶段结果；自由问答与节点实验不会强迫你按这条路径浏览。</p></div>
        <a className="rounded-2xl border-b-4 border-[#bd7a00] bg-[#ffbf47] px-5 py-3 text-sm font-black text-[#513600] transition hover:-translate-y-0.5 hover:bg-[#ffca62]" href="#current-learning-step">查看当前任务 ↓</a>
      </header>
      <StageRail currentStage={dashboard.project?.stage ?? "DIAGNOSTIC"} />
      {error && <div className="flex items-center justify-between rounded-xl bg-red-50 p-3"><p ref={errorRef} tabIndex={-1} role="alert">{error}</p><button onClick={refresh} type="button">重试刷新</button></div>}
      <details className="group overflow-hidden rounded-[1.75rem] border border-[#cfe0d8] bg-[#fffef9]" open={dashboard.project?.stage === "DIAGNOSTIC"}>
        <summary className="cursor-pointer list-none px-5 py-4 font-black text-[#17332d] sm:px-7">学习前小实验 · 让距离变成光 <span className="float-right text-[#178b73] group-open:rotate-180">⌄</span></summary>
        <SignalLab />
      </details>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="space-y-5"><section aria-label="当前学习步骤" id="current-learning-step" key={`${dashboard.project?.id ?? "empty"}:${dashboard.project?.stage ?? "empty"}`}><Workflow dashboard={dashboard} fetchImpl={fetchImpl} refresh={refresh} /></section><EvidenceHistory fetcher={fetchImpl} onDeleted={refresh} refreshToken={dashboard.snapshotVersion} /></div>
        <aside className="space-y-5 lg:sticky lg:top-5" aria-label="学习概览"><CurrentProject dashboard={dashboard} /><ProfileCard displayName={dashboard.student.alias} profile={dashboard.profile} /></aside>
      </div>
    </div>
  </section>;
}
