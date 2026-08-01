"use client";

import { type DragEvent, useEffect, useMemo, useState } from "react";

import {
  BookLayoutDraftResponseSchema,
  BookLayoutEvidenceResponseSchema,
  BookLayoutWorkspaceResponseSchema,
  type BookLayoutEvidenceResponse,
} from "@/lib/domain/book-layout";

type Audience = "NEW_STUDENTS" | "COMMUNITY_RESIDENTS";
type PageId = BookLayoutEvidenceResponse["pageOrder"][number];
type DiagnosticAnswer = BookLayoutEvidenceResponse["diagnosticAnswers"][number];
type TransferChoice = BookLayoutEvidenceResponse["transferChoices"][number];

const INITIAL_ORDER: PageId[] = [
  "cover", "quick-start", "activity-map", "featured-activity",
  "calendar", "community-voices", "join-us", "contact",
];

const PAGE_COPY: Record<PageId, { role: string; newStudents: string; residents: string; level: "PRIMARY" | "SECONDARY" | "ACTION" }> = {
  cover: { role: "封面", newStudents: "第一次走进校园社区", residents: "回到身边的校园社区", level: "PRIMARY" },
  "quick-start": { role: "导读", newStudents: "3分钟找到适合你的活动", residents: "从附近、时间与兴趣开始", level: "PRIMARY" },
  "activity-map": { role: "导航", newStudents: "社团与社区活动地图", residents: "校园—社区共建地图", level: "SECONDARY" },
  "featured-activity": { role: "重点", newStudents: "本月新生活动", residents: "本月共创活动", level: "PRIMARY" },
  calendar: { role: "信息", newStudents: "本月时间表", residents: "开放日与共建日历", level: "SECONDARY" },
  "community-voices": { role: "故事", newStudents: "学长学姐怎么开始", residents: "居民与学生如何合作", level: "SECONDARY" },
  "join-us": { role: "行动", newStudents: "加入第一次活动", residents: "成为社区共创伙伴", level: "ACTION" },
  contact: { role: "补充", newStudents: "地点、联系人与二维码", residents: "联系社区联络人", level: "ACTION" },
};

const DIAGNOSTIC = [
  { title: "打开导览册的第一秒", options: [
    ["AUDIENCE_FIRST", "先看是谁在读", "◎"], ["TASK_FIRST", "先看要完成什么", "→"], ["DECORATION_FIRST", "先挑好看的风格", "✦"],
  ] },
  { title: "八页装不下全部素材", options: [
    ["TASK_FIRST", "保留读者必做任务", "▣"], ["AUDIENCE_FIRST", "按受众删减内容", "◉"], ["DECORATION_FIRST", "缩小字号全部塞入", "≋"],
  ] },
  { title: "判断编排是否有效", options: [
    ["TASK_FIRST", "看读者能否快速找到入口", "↗"], ["AUDIENCE_FIRST", "请目标读者走一遍", "◌"], ["DECORATION_FIRST", "只比较画面是否漂亮", "◇"],
  ] },
] as const;

const TRANSFER: Array<{ id: TransferChoice; label: string; detail: string }> = [
  { id: "COMMUNITY_ENTRY_FIRST", label: "改变入口", detail: "从“新生第一次参加”改为“居民从附近活动进入”。" },
  { id: "VOLUNTEER_CALL_TO_ACTION", label: "改变行动召唤", detail: "从报名参加改为共建、志愿与资源协作。" },
  { id: "RETAIN_ACTIVITY_CORE", label: "保留活动核心", detail: "核心活动事实不因换受众而被改写。" },
];

function pageTitle(id: PageId, audience: Audience) {
  const page = PAGE_COPY[id];
  return audience === "NEW_STUDENTS" ? page.newStudents : page.residents;
}

function swap(items: PageId[], from: number, to: number) {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function BookLayoutLab({ fetchImpl = fetch, initialFocus }: { fetchImpl?: typeof fetch; initialFocus?: string | null }) {
  const defaultAudience = initialFocus === "transfer" ? "COMMUNITY_RESIDENTS" : "NEW_STUDENTS";
  const [audience, setAudience] = useState<Audience>(defaultAudience);
  const [pages, setPages] = useState<PageId[]>(INITIAL_ORDER);
  const [answers, setAnswers] = useState<Array<DiagnosticAnswer | null>>([null, null, null]);
  const [transferChoices, setTransferChoices] = useState<TransferChoice[]>([]);
  const [selectedPage, setSelectedPage] = useState<PageId>("quick-start");
  const [result, setResult] = useState<BookLayoutEvidenceResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [resetArmed, setResetArmed] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    fetchImpl("/api/book-layout", { method: "GET", cache: "no-store", signal: abort.signal, headers: { accept: "application/json" } })
      .then(async (response) => response.ok ? response.json() : null)
      .then((raw) => {
        if (!raw || abort.signal.aborted) return;
        const workspace = BookLayoutWorkspaceResponseSchema.parse(raw);
        if (workspace.resume) {
          const resume = "criteria" in workspace.resume
            ? BookLayoutEvidenceResponseSchema.parse(workspace.resume)
            : BookLayoutDraftResponseSchema.parse(workspace.resume);
          setAudience(resume.audience);
          setPages(resume.pageOrder);
          setAnswers(resume.diagnosticAnswers);
          setTransferChoices(resume.transferChoices);
          setSaveStatus(`已恢复${"criteria" in resume ? "最近提交" : "草稿"} · ${new Date("updatedAt" in resume ? resume.updatedAt : resume.createdAt).toLocaleString("zh-CN")}`);
        }
        setResult(workspace.latest);
      }).catch(() => undefined);
    return () => abort.abort();
  }, [fetchImpl]);

  const diagnosticComplete = answers.every(Boolean);
  const readingPath = useMemo(() => pages.map((id, index) => ({ number: index + 1, id, ...PAGE_COPY[id] })), [pages]);

  function drop(event: DragEvent<HTMLDivElement>, target: number) {
    event.preventDefault();
    const from = Number(event.dataTransfer.getData("text/page-index"));
    if (Number.isInteger(from) && from >= 0 && from < pages.length) setPages((current) => swap(current, from, target));
  }

  function move(index: number, direction: -1 | 1) {
    const target = Math.max(0, Math.min(pages.length - 1, index + direction));
    if (target !== index) setPages((current) => swap(current, index, target));
  }

  function toggleTransfer(choice: TransferChoice) {
    setTransferChoices((current) => current.includes(choice) ? current.filter((item) => item !== choice) : [...current, choice]);
  }

  function draftPayload() {
    return { audience, pageOrder: pages, diagnosticAnswers: answers, transferChoices };
  }

  async function saveDraft() {
    setPending(true);
    setError("");
    setResetArmed(false);
    try {
      const response = await fetchImpl("/api/book-layout", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draftPayload()),
      });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error(typeof raw === "object" && raw && "error" in raw && typeof raw.error === "string" ? raw.error : "草稿保存失败");
      const saved = BookLayoutDraftResponseSchema.parse(raw);
      setSaveStatus(`草稿已保存 · ${new Date(saved.updatedAt).toLocaleString("zh-CN")}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "草稿保存失败");
    } finally {
      setPending(false);
    }
  }

  async function resetDraft() {
    if (!resetArmed) {
      setResetArmed(true);
      setSaveStatus("再次点击“确认重置”，将清空当前编排；已提交证据不会删除。");
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetchImpl("/api/book-layout", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error(typeof raw === "object" && raw && "error" in raw && typeof raw.error === "string" ? raw.error : "重置失败");
      setAudience(defaultAudience);
      setPages(INITIAL_ORDER);
      setAnswers([null, null, null]);
      setTransferChoices([]);
      setSelectedPage("quick-start");
      setSaveStatus("当前编排已重置；历史学习证据仍保留。");
      setResetArmed(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重置失败");
    } finally {
      setPending(false);
    }
  }

  async function submitEvidence() {
    if (!diagnosticComplete) { setError("先完成上方三个快速判断。"); return; }
    setPending(true);
    setError("");
    try {
      const response = await fetchImpl("/api/book-layout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draftPayload()),
      });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error(typeof raw === "object" && raw && "error" in raw && typeof raw.error === "string" ? raw.error : "证据提交失败");
      const submitted = BookLayoutEvidenceResponseSchema.parse(raw);
      setResult(submitted);
      setSaveStatus(`证据已提交 · ${new Date(submitted.createdAt).toLocaleString("zh-CN")}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "证据提交失败");
    } finally {
      setPending(false);
    }
  }

  return <section className="min-h-screen bg-[#f3f5ef] px-4 pb-32 pt-5 text-[#17332d] sm:px-6 lg:px-8" aria-labelledby="book-lab-title">
    <div className="mx-auto max-w-[92rem] space-y-5">
      <header className="overflow-hidden rounded-[2rem] bg-[#17332d] text-white shadow-[0_18px_50px_rgba(23,51,45,.16)]">
        <div className="grid gap-6 px-6 py-7 lg:grid-cols-[minmax(0,1fr)_28rem] lg:px-8">
          <div><p className="text-xs font-black tracking-[0.2em] text-[#70d1bb]">书籍设计课程包 · 微闭环 01</p><h1 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-4xl" id="book-lab-title">把校园社区活动变成8页导览册</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-[#d8ebe5]">不是仿制排版软件。这里训练的是“受众 → 阅读任务 → 信息层级 → 页面顺序 → 阅读证据”的通用关系。</p></div>
          <div className="grid grid-cols-3 gap-2 self-end text-center"><Metric value={`${answers.filter(Boolean).length}/3`} label="诊断" /><Metric value="8页" label="边界" /><Metric value={audience === "NEW_STUDENTS" ? "新生" : "居民"} label="受众" /></div>
        </div>
      </header>

      <section className="rounded-[1.75rem] border border-[#d7e1dc] bg-[#fffef9] p-5 sm:p-7" aria-labelledby="book-diagnostic-title">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] font-black tracking-[0.16em] text-[#178b73]">快速诊断</p><h2 className="mt-1 text-xl font-black" id="book-diagnostic-title">先看你从哪里开始做判断</h2></div><span className="rounded-full bg-[#edf5f0] px-3 py-1.5 text-xs font-bold text-[#315f54]">只选，不填长文本</span></div>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">{DIAGNOSTIC.map((question, questionIndex) => <fieldset className="rounded-2xl border border-[#dce5e0] p-4" key={question.title}><legend className="px-1 text-sm font-black">{questionIndex + 1}. {question.title}</legend><div className="mt-3 grid gap-2">{question.options.map(([value, label, icon]) => <button aria-pressed={answers[questionIndex] === value} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-xs font-bold transition ${answers[questionIndex] === value ? "border-[#178b73] bg-[#e2f3ec] text-[#0d6858]" : "border-[#e0e6e2] bg-white text-[#597069] hover:border-[#96bfb3]"}`} key={value} onClick={() => setAnswers((current) => current.map((item, index) => index === questionIndex ? value : item))} type="button"><span className="grid size-7 place-items-center rounded-lg bg-[#f2f5f2] text-base">{icon}</span>{label}</button>)}</div></fieldset>)}</div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        <aside className="rounded-[1.75rem] border border-[#d7e1dc] bg-[#fffef9] p-5 xl:sticky xl:top-5" aria-labelledby="audience-title">
          <p className="text-[11px] font-black tracking-[0.16em] text-[#178b73]">受众开关</p><h2 className="mt-1 text-lg font-black" id="audience-title">同一内容，换谁来读？</h2>
          <div className="mt-4 grid grid-cols-2 rounded-2xl bg-[#edf1ed] p-1"><button aria-pressed={audience === "NEW_STUDENTS"} className={`rounded-xl px-3 py-2 text-xs font-black ${audience === "NEW_STUDENTS" ? "bg-white text-[#0d6858] shadow" : "text-[#71847f]"}`} onClick={() => setAudience("NEW_STUDENTS")} type="button">新生</button><button aria-pressed={audience === "COMMUNITY_RESIDENTS"} className={`rounded-xl px-3 py-2 text-xs font-black ${audience === "COMMUNITY_RESIDENTS" ? "bg-white text-[#0d6858] shadow" : "text-[#71847f]"}`} onClick={() => setAudience("COMMUNITY_RESIDENTS")} type="button">社区居民</button></div>
          <div className="mt-5 space-y-2"><p className="text-[11px] font-black tracking-[0.12em] text-[#7a8d87]">层级图例</p><Legend color="#17332d" label="一级 · 决定阅读入口" /><Legend color="#3f8f7d" label="二级 · 支撑理解" /><Legend color="#e2a72d" label="行动 · 推动参与" /></div>
          <div className="mt-5 rounded-2xl bg-[#f2f6f3] p-4"><p className="text-xs font-black">当前选中页面</p><p className="mt-2 text-sm font-black text-[#0d6858]">{PAGE_COPY[selectedPage].role} · {pageTitle(selectedPage, audience)}</p><p className="mt-2 text-xs leading-5 text-[#60756f]">观察换受众后，页面功能是否仍然成立，而不是只换标题。</p></div>
        </aside>

        <section className="min-w-0 rounded-[1.75rem] border border-[#d7e1dc] bg-[#fffef9] p-5 sm:p-7" aria-labelledby="page-board-title">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] font-black tracking-[0.16em] text-[#178b73]">拖拽式信息层级</p><h2 className="mt-1 text-xl font-black" id="page-board-title">8页缩略编排台</h2></div><p className="text-xs text-[#71847f]">拖拽页面换位；手机可用左右箭头</p></div>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">{readingPath.map((page, index) => <div aria-label={`第${page.number}页 ${pageTitle(page.id, audience)}`} className={`group relative min-h-48 cursor-grab rounded-[1.35rem] border-2 p-3 transition hover:-translate-y-1 hover:shadow-lg ${selectedPage === page.id ? "border-[#178b73] bg-[#f1faf6]" : "border-[#dde5e1] bg-white"}`} draggable key={page.id} onClick={() => setSelectedPage(page.id)} onDragOver={(event) => event.preventDefault()} onDragStart={(event) => event.dataTransfer.setData("text/page-index", String(index))} onDrop={(event) => drop(event, index)}>
            <div className="flex items-center justify-between"><span className="grid size-8 place-items-center rounded-full bg-[#17332d] text-xs font-black text-white">{page.number}</span><span className="rounded-full bg-[#edf3ef] px-2 py-1 text-[9px] font-black text-[#60756f]">{page.role}</span></div>
            <div className="mt-7"><span className="block h-1.5 w-10 rounded-full" style={{ background: page.level === "PRIMARY" ? "#17332d" : page.level === "ACTION" ? "#e2a72d" : "#3f8f7d" }} /><h3 className="mt-3 text-sm font-black leading-6">{pageTitle(page.id, audience)}</h3><div className="mt-3 space-y-1.5"><span className="block h-1.5 w-full rounded-full bg-[#dce6e1]" /><span className="block h-1.5 w-4/5 rounded-full bg-[#e7ede9]" /><span className="block h-1.5 w-2/3 rounded-full bg-[#e7ede9]" /></div></div>
            <div className="absolute bottom-2 right-2 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"><button aria-label={`第${page.number}页向左移动`} className="grid size-7 place-items-center rounded-lg bg-[#edf3ef] text-xs disabled:opacity-30" disabled={index === 0} onClick={(event) => { event.stopPropagation(); move(index, -1); }} type="button">←</button><button aria-label={`第${page.number}页向右移动`} className="grid size-7 place-items-center rounded-lg bg-[#edf3ef] text-xs disabled:opacity-30" disabled={index === pages.length - 1} onClick={(event) => { event.stopPropagation(); move(index, 1); }} type="button">→</button></div>
          </div>)}</div>
          <div className="mt-5 flex items-center gap-2 overflow-x-auto rounded-2xl bg-[#edf3ef] p-3" aria-label="阅读路径">{readingPath.map((page, index) => <div className="flex shrink-0 items-center gap-2" key={page.id}><span className={`size-3 rounded-full ${page.level === "PRIMARY" ? "bg-[#17332d]" : page.level === "ACTION" ? "bg-[#e2a72d]" : "bg-[#3f8f7d]"}`} title={PAGE_COPY[page.id].role} />{index < 7 ? <span className="h-px w-5 bg-[#a9bbb4]" /> : null}</div>)}</div>
        </section>

        <aside className="space-y-5 xl:sticky xl:top-5">
          <section className="rounded-[1.75rem] border border-[#d7e1dc] bg-[#fffef9] p-5" aria-labelledby="transfer-title"><p className="text-[11px] font-black tracking-[0.16em] text-[#c38611]">迁移挑战</p><h2 className="mt-1 text-lg font-black" id="transfer-title">新生 → 社区居民</h2><p className="mt-2 text-xs leading-5 text-[#60756f]">切换到“社区居民”后，用三个判断说明你保留与改变了什么。</p><div className="mt-4 space-y-2">{TRANSFER.map((choice) => <button aria-pressed={transferChoices.includes(choice.id)} className={`w-full rounded-xl border p-3 text-left transition ${transferChoices.includes(choice.id) ? "border-[#d39a23] bg-[#fff5d9]" : "border-[#e1e6e2] bg-white"}`} key={choice.id} onClick={() => toggleTransfer(choice.id)} type="button"><b className="block text-xs">{choice.label}</b><span className="mt-1 block text-[11px] leading-5 text-[#6c756f]">{choice.detail}</span></button>)}</div></section>
          <section className="rounded-[1.75rem] bg-[#17332d] p-5 text-white"><p className="text-[11px] font-black tracking-[0.16em] text-[#70d1bb]">学习证据</p><h2 className="mt-1 text-lg font-black">保存这次判断</h2><p className="mt-2 text-xs leading-5 text-[#cfe4dd]">草稿用于刷新后继续；正式提交才生成评价证据，教师端可复核。</p><button className="mt-4 w-full rounded-xl bg-[#ffbf47] px-4 py-3 text-sm font-black text-[#513600] disabled:opacity-50" disabled={pending || !diagnosticComplete} onClick={() => void submitEvidence()} type="button">{pending ? "正在记录…" : "提交版面证据"}</button><div className="mt-2 grid grid-cols-2 gap-2"><button className="rounded-xl border border-white/20 px-3 py-2 text-xs font-black text-[#d7ebe5] disabled:opacity-50" disabled={pending} onClick={() => void saveDraft()} type="button">保存草稿</button><button className={`rounded-xl border px-3 py-2 text-xs font-black disabled:opacity-50 ${resetArmed ? "border-[#ffb5a7] bg-[#6b2e27] text-white" : "border-white/20 text-[#d7ebe5]"}`} disabled={pending} onClick={() => void resetDraft()} type="button">{resetArmed ? "确认重置" : "重置编排"}</button></div>{saveStatus ? <p className="mt-3 text-[11px] leading-5 text-[#b9d8ce]" aria-live="polite">{saveStatus}</p> : null}{error ? <p className="mt-3 text-xs text-[#ffb5a7]" role="alert">{error}</p> : null}</section>
          {result ? <section className="rounded-[1.75rem] border border-[#d7e1dc] bg-[#fffef9] p-5" aria-live="polite"><div className="flex items-center justify-between"><h2 className="font-black">本次评价</h2><span className={`rounded-full px-3 py-1 text-xs font-black ${result.passed ? "bg-[#e2f3ec] text-[#0d6858]" : "bg-[#fff2d7] text-[#8a620c]"}`}>{result.score}/4</span></div><div className="mt-4 space-y-3">{result.criteria.map((criterion) => <div className="flex gap-2" key={criterion.id}><span className={criterion.passed ? "text-[#178b73]" : "text-[#d28b14]"}>{criterion.passed ? "●" : "○"}</span><div><b className="block text-xs">{criterion.label}</b><p className="mt-1 text-[11px] leading-5 text-[#667a74]">{criterion.note}</p></div></div>)}</div></section> : null}
        </aside>
      </div>
    </div>
  </section>;
}

function Metric({ value, label }: { value: string; label: string }) { return <div className="rounded-2xl bg-white/8 px-3 py-3"><b className="block text-lg">{value}</b><span className="text-[10px] text-[#bad6cd]">{label}</span></div>; }
function Legend({ color, label }: { color: string; label: string }) { return <p className="flex items-center gap-2 text-xs font-bold text-[#5e746d]"><span className="size-2.5 rounded-full" style={{ background: color }} />{label}</p>; }
