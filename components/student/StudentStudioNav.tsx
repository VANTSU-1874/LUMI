"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { DemoBadge } from "@/components/common/DemoBadge";
import type { DesignTask } from "@/lib/agent/design-project-task-contract";

export type StudentStudioView = "CHAT" | "WORKSPACE" | "PROJECT" | "RESOURCES" | "CASE_LIBRARY" | "NODE_CANVAS" | "KNOWLEDGE_MAP" | "BOOK_LAYOUT_LAB" | "LAYOUT_GRID_LAB" | "GENERATIVE_LAB";

const items: Array<{ id: StudentStudioView; label: string; caption: string; icon: React.ReactNode }> = [
  { id: "CHAT", label: "创作对话", caption: "理解想法并推进项目", icon: <ChatIcon /> },
  { id: "WORKSPACE", label: "工作空间", caption: "节点、版面与实验", icon: <CanvasIcon /> },
  { id: "PROJECT", label: "过程记录", caption: "阶段、证据与教师复核", icon: <ProjectIcon /> },
  { id: "RESOURCES", label: "课程资源", caption: "案例、概念与来源", icon: <LibraryIcon /> },
];

const learningSpaces: Array<{ id: StudentStudioView; label: string; caption: string; icon: React.ReactNode }> = [
  { id: "NODE_CANVAS", label: "节点画布", caption: "自主搭建与观察网络", icon: <CanvasIcon /> },
  { id: "KNOWLEDGE_MAP", label: "知识地图", caption: "自主浏览概念与关系", icon: <LibraryIcon /> },
];

function activeSection(active: StudentStudioView): StudentStudioView {
  if (active === "NODE_CANVAS" || active === "BOOK_LAYOUT_LAB" || active === "LAYOUT_GRID_LAB" || active === "GENERATIVE_LAB") return "WORKSPACE";
  if (active === "CASE_LIBRARY" || active === "KNOWLEDGE_MAP") return "RESOURCES";
  return active;
}

export function StudentStudioNav({
  active,
  alias,
  isDemo,
  isFallback,
  mobileOpen = false,
  onClose,
  onNewQuestion,
  onChange,
  tasks = [],
  activeTaskId,
  tasksLoading = false,
  onSelectTask,
  onRenameTask,
  onArchiveTask,
  onRestoreTask,
}: {
  active: StudentStudioView;
  alias: string;
  isDemo: boolean;
  isFallback: boolean;
  mobileOpen?: boolean;
  onClose?: () => void;
  onNewQuestion?: () => void;
  onChange: (view: StudentStudioView) => void;
  tasks?: DesignTask[];
  activeTaskId?: string;
  tasksLoading?: boolean;
  onSelectTask?: (taskId: string) => void;
  onRenameTask?: (taskId: string, title: string) => Promise<unknown>;
  onArchiveTask?: (taskId: string) => Promise<unknown>;
  onRestoreTask?: (taskId: string) => Promise<unknown>;
}) {
  const section = activeSection(active);
  const learningSpaceActive = learningSpaces.some(({ id }) => id === active);
  const [editingTaskId, setEditingTaskId] = useState<string>();
  const [editingTitle, setEditingTitle] = useState("");
  const [taskError, setTaskError] = useState("");
  const [isDesktop, setIsDesktop] = useState(() => (
    typeof window !== "undefined" && typeof window.matchMedia !== "function"
  ));
  const navigationRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mobileOpenerRef = useRef<HTMLElement | null>(null);
  const wasMobileDialogOpen = useRef(false);
  const activeTasks = tasks.filter(({ status }) => status === "ACTIVE");
  const archivedTasks = tasks.filter(({ status }) => status === "ARCHIVED");
  const mobileDialogOpen = !isDesktop && mobileOpen;
  const hiddenOnMobile = !isDesktop && !mobileOpen;

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (mobileDialogOpen && !wasMobileDialogOpen.current) {
      mobileOpenerRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      requestAnimationFrame(() => closeButtonRef.current?.focus());
    } else if (!mobileDialogOpen && wasMobileDialogOpen.current) {
      mobileOpenerRef.current?.focus();
      mobileOpenerRef.current = null;
    }
    wasMobileDialogOpen.current = mobileDialogOpen;
  }, [mobileDialogOpen]);

  useEffect(() => {
    if (!mobileDialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mobileDialogOpen]);

  function navigate(next: StudentStudioView) {
    onChange(next);
    onClose?.();
  }

  function trapMobileNavigation(event: KeyboardEvent<HTMLElement>) {
    if (!mobileDialogOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key !== "Tab") return;
    const root = navigationRef.current;
    if (!root) return;
    const focusable = [...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    )].filter((element) => {
      let parent = element.parentElement;
      while (parent && parent !== root) {
        if (parent instanceof HTMLDetailsElement && !parent.open) return false;
        parent = parent.parentElement;
      }
      return true;
    });
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return <>
    {mobileDialogOpen ? <button aria-hidden="true" className="fixed inset-0 z-[70] bg-black/25 backdrop-blur-[1px] md:hidden" onClick={onClose} tabIndex={-1} type="button" /> : null}
    <aside aria-hidden={hiddenOnMobile || undefined} aria-label="学习工具栏" aria-modal={mobileDialogOpen || undefined} className={`fixed inset-y-0 left-0 z-[80] flex w-[17rem] flex-col border-r border-[#e7e7e2] bg-[#f7f7f3] transition-transform duration-200 motion-reduce:transition-none md:sticky md:top-0 md:h-dvh md:translate-x-0 ${mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`} inert={hiddenOnMobile || undefined} onKeyDown={trapMobileNavigation} ref={navigationRef} role={mobileDialogOpen ? "dialog" : undefined}>
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <button aria-label="收起学习导航" className="order-2 grid size-9 place-items-center rounded-lg text-[#58635f] hover:bg-black/[.055] md:hidden" onClick={onClose} ref={closeButtonRef} type="button">×</button>
        <button className="order-1 flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-black/[.045]" onClick={() => navigate("CHAT")} type="button">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#17332d] text-sm text-[#ffbf47]">✦</span>
          <span className="min-w-0"><b className="block truncate text-sm text-[#17332d]">触映</b><span className="block truncate text-[10px] text-[#6d7773]">项目认知与创作推进 Agent</span></span>
        </button>
      </div>

      <div className="px-3">
        <button className="flex w-full items-center gap-3 rounded-xl border border-[#ddddda] bg-white px-3 py-2.5 text-left text-sm font-bold text-[#27322f] shadow-[0_1px_2px_rgba(23,51,45,.04)] transition hover:bg-[#fbfbf8]" onClick={() => { if (onNewQuestion) onNewQuestion(); else navigate("CHAT"); onClose?.(); }} type="button">
          <ComposeIcon /><span>新建设计任务</span>
        </button>
      </div>

      <nav className="mt-4 flex-1 overflow-y-auto px-3" aria-label="学习工具">
        <div aria-label="设计项目任务">
          <div className="flex items-center justify-between px-2 pb-1.5"><p className="text-[10px] font-semibold text-[#8a928f]">设计项目</p>{tasksLoading ? <span className="text-[9px] text-[#8a928f]" role="status">恢复中…</span> : null}</div>
          <ul className="space-y-0.5">
            {activeTasks.map((task) => <li className="group/task flex items-center gap-1" key={task.id}>
              {editingTaskId === task.id ? <form className="flex min-w-0 flex-1 gap-1" onSubmit={(event) => { event.preventDefault(); const title = editingTitle.trim(); if (!title || !onRenameTask) return; setTaskError(""); void onRenameTask(task.id, title).then(() => setEditingTaskId(undefined)).catch((reason: unknown) => setTaskError(reason instanceof Error ? reason.message : "任务重命名失败")); }}><label className="sr-only" htmlFor={`task-title-${task.id}`}>任务标题</label><input autoFocus className="min-w-0 flex-1 rounded-lg border border-[#a9bcb4] bg-white px-2 py-1.5 text-xs outline-none" id={`task-title-${task.id}`} onChange={(event) => setEditingTitle(event.target.value)} value={editingTitle} /><button className="rounded-lg px-2 text-xs text-[#176752]" type="submit">保存</button></form> : <button aria-current={activeTaskId === task.id ? "page" : undefined} className={`min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-xs ${activeTaskId === task.id ? "bg-[#e6ece8] font-semibold text-[#17332d]" : "text-[#4f5955] hover:bg-black/[.045]"}`} onClick={() => { onSelectTask?.(task.id); navigate("CHAT"); }} title={task.title} type="button">{task.title}</button>}
              {editingTaskId !== task.id ? <details className="relative shrink-0"><summary aria-label={`管理任务：${task.title}`} className="grid size-7 cursor-pointer list-none place-items-center rounded-lg text-[#7b8581] hover:bg-black/[.055]">···</summary><div className="absolute right-0 top-8 z-50 w-28 rounded-xl border border-[#dedfdb] bg-white p-1 text-xs shadow-xl"><button className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-[#f2f3ef]" onClick={() => { setEditingTaskId(task.id); setEditingTitle(task.title); }} type="button">重命名</button><button className="block w-full rounded-lg px-2 py-1.5 text-left text-[#8c5f16] hover:bg-[#fff6df]" onClick={() => { setTaskError(""); void onArchiveTask?.(task.id).catch((reason: unknown) => setTaskError(reason instanceof Error ? reason.message : "任务归档失败")); }} type="button">归档</button></div></details> : null}
            </li>)}
          </ul>
          {activeTasks.length === 0 && !tasksLoading ? <p className="px-2 py-2 text-xs text-[#7a837f]">新建一个任务开始设计对话</p> : null}
          {archivedTasks.length > 0 ? <details className="mt-2"><summary className="cursor-pointer px-2 py-1 text-[10px] text-[#7a837f]">已归档 · {archivedTasks.length}</summary><ul className="mt-1 space-y-0.5">{archivedTasks.map((task) => <li className="flex items-center gap-1" key={task.id}><span className="min-w-0 flex-1 truncate px-3 py-1.5 text-xs text-[#7b8581]" title={task.title}>{task.title}</span><button className="rounded-lg px-2 py-1 text-[10px] text-[#176752] hover:bg-[#e6ece8]" onClick={() => { setTaskError(""); void onRestoreTask?.(task.id).catch((reason: unknown) => setTaskError(reason instanceof Error ? reason.message : "任务恢复失败")); }} type="button">恢复</button></li>)}</ul></details> : null}
          {taskError ? <p className="mt-2 rounded-lg bg-[#fff1ed] px-2 py-1.5 text-[10px] text-[#a44332]" role="alert">{taskError}</p> : null}
        </div>

        <p className="mt-5 px-2 pb-1.5 text-[10px] font-semibold text-[#8a928f]">能力与记录</p>
        <ul className="space-y-0.5">
          {items.map((item) => { const selected = section === item.id && !learningSpaceActive; return <li key={item.id}><button aria-current={selected ? "page" : undefined} aria-label={item.id === "PROJECT" ? "过程记录（学习证据）" : undefined} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${selected ? "bg-[#e6ece8] text-[#17332d]" : "text-[#4f5955] hover:bg-black/[.045]"}`} onClick={() => navigate(item.id)} type="button"><span className="grid size-7 shrink-0 place-items-center">{item.icon}</span><span className="min-w-0"><b className="block truncate text-sm font-semibold">{item.label}</b><span className="block truncate text-[10px] opacity-65">{item.caption}</span></span></button></li>; })}
        </ul>

        <p className="mt-5 px-2 pb-1.5 text-[10px] font-semibold text-[#8a928f]">自主学习空间</p>
        <ul className="space-y-0.5">
          {learningSpaces.map((item) => <li key={item.id}><button aria-current={active === item.id ? "page" : undefined} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active === item.id ? "bg-[#e6ece8] text-[#17332d]" : "text-[#4f5955] hover:bg-black/[.045]"}`} onClick={() => navigate(item.id)} type="button"><span className="grid size-7 shrink-0 place-items-center">{item.icon}</span><span className="min-w-0"><b className="block truncate text-sm font-semibold">{item.label}</b><span className="block truncate text-[10px] opacity-65">{item.caption}</span></span></button></li>)}
        </ul>

        <div className="mt-6">
          <p className="px-2 pb-2 text-[10px] font-semibold text-[#8a928f]">对话会结合</p>
          <div className="space-y-1 px-2 text-xs leading-5 text-[#63706b]"><p>逐步形成的项目理解</p><p>通用设计知识</p><p>按目标调用的 Plugin / Skill</p></div>
        </div>
      </nav>

      <div className="border-t border-[#e4e4df] p-3">
        {isDemo || isFallback ? <div className="mb-2 flex flex-wrap items-center gap-2 px-2">
          {isDemo ? <DemoBadge /> : null}
          {isFallback ? <div><span className="rounded-full bg-[#e9eef0] px-2 py-1 text-[9px] font-bold text-[#315f72]">确定性降级模式</span><p className="mt-1.5 text-[9px] leading-4 text-[#64736e]">规则与课程资料继续工作，AI语义增强暂不可用</p></div> : null}
        </div> : null}
        <div className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-black/[.045]">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#dfe9e4] text-xs font-black text-[#285f50]">学</span>
          <span className="min-w-0 flex-1"><b className="block truncate text-xs text-[#27322f]">{alias}</b><Link className="text-[10px] text-[#7b8581] hover:underline" href="/privacy">证据与隐私说明</Link></span>
        </div>
      </div>
    </aside>
  </>;
}

function ChatIcon() { return <svg aria-hidden="true" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M5 5.5h14v10H9l-4 3v-13Z" /><path d="M8 9h8M8 12h5" /></svg>; }
function LibraryIcon() { return <svg aria-hidden="true" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M5 5h12v13H5z" /><path d="M8 2h11v13M8 8h6M8 11h6M8 14h4" /></svg>; }
function CanvasIcon() { return <svg aria-hidden="true" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect height="5" rx="1" width="6" x="2" y="4" /><rect height="5" rx="1" width="6" x="16" y="15" /><path d="M8 6.5h4v11h4M12 12h4" /></svg>; }
function ProjectIcon() { return <svg aria-hidden="true" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M4 6.5h6l1.5 2H20v10H4v-12Z" /><path d="M8 13h8M8 16h5" /></svg>; }
function ComposeIcon() { return <svg aria-hidden="true" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M13.5 5.5 18.5 10.5M4 20l3.5-.8L19 7.7a2.1 2.1 0 0 0-3-3L4.8 16.2 4 20Z" /></svg>; }
