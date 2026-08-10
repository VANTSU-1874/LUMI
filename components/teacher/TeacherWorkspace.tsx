"use client";

import { useEffect, useRef, useState } from "react";

import { AgentDecisionReviewPublicSchema, ClassAnalyticsSchema, LearnerDetailSchema, TeacherDecisionPublicSchema, type AgentDecisionReviewInput, type ClassAnalytics, type LearnerDetail as LearnerDetailValue } from "@/lib/domain/teacher";
import { ClassOverview } from "./ClassOverview";
import { LearnerDetail } from "./LearnerDetail";
import { MisconceptionPanel } from "./MisconceptionPanel";
import { FallbackModeBadge } from "@/components/common/FallbackModeBadge";
import { EvidenceHistory } from "@/components/common/EvidenceHistory";
import Link from "next/link";
import { ClassListSchema, jsonOrError, type TeacherClassList, type TeacherWorkspaceFetcher } from "./teacher-workspace-api";
import type { StudentMemoryPublic } from "@/lib/domain/student-memory";

export function TeacherWorkspace({ fetcher = fetch }: { fetcher?: TeacherWorkspaceFetcher }) {
  const [classes, setClasses] = useState<TeacherClassList["classes"]>([]);
  const [classesMeta, setClassesMeta] = useState<TeacherClassList["classesMeta"]>({ total: 0, returned: 0, truncated: false });
  const [classId, setClassId] = useState("");
  const [analytics, setAnalytics] = useState<ClassAnalytics | null>(null);
  const [detail, setDetail] = useState<LearnerDetailValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisionPending, setDecisionPending] = useState(false);
  const [agentReviewPending, setAgentReviewPending] = useState(false);
  const [includeDemo, setIncludeDemo] = useState(false);
  const [autoDemoFallback, setAutoDemoFallback] = useState(false);
  const [evidenceHistoryRevision, setEvidenceHistoryRevision] = useState(0);
  const [aiMode, setAiMode] = useState<"MODEL_ASSISTED" | "DETERMINISTIC_FALLBACK">("DETERMINISTIC_FALLBACK");
  const errorRef = useRef<HTMLDivElement>(null);
  const classListSequence = useRef(0);
  const classSequence = useRef(0);
  const detailSequence = useRef(0);
  const decisionSequence = useRef(0);
  const decisionInFlight = useRef(false);
  const detailController = useRef<AbortController | null>(null);
  const decisionController = useRef<AbortController | null>(null);
  const analyticsController = useRef<AbortController | null>(null);
  const activeClass = useRef("");
  const activeStudent = useRef("");
  const demoPreferenceTouched = useRef(false);
  const autoDemoAttempted = useRef(false);

  useEffect(() => {
    const sequence = ++classListSequence.current;
    const controller = new AbortController();
    void (async () => {
      try {
        const payload = ClassListSchema.parse(await jsonOrError(await fetcher(includeDemo ? "/api/teacher/dashboard?includeDemo=true" : "/api/teacher/dashboard", { signal: controller.signal, cache: "no-store" })));
        if (controller.signal.aborted || sequence !== classListSequence.current) return;
        setClasses(payload.classes);
        setClassesMeta(payload.classesMeta);
        setAiMode(payload.aiMode);
        if (!includeDemo && payload.classes.length === 0 && !demoPreferenceTouched.current && !autoDemoAttempted.current) {
          autoDemoAttempted.current = true;
          setAutoDemoFallback(true);
          setIncludeDemo(true);
          return;
        }
        setClassId((current) => {
          const next = payload.classes.some((item) => item.id === current) ? current : payload.classes[0]?.id || "";
          activeClass.current = next;
          return next;
        });
        if (payload.classes.length === 0) {
          activeClass.current = ""; activeStudent.current = "";
          setAnalytics(null); setDetail(null); setLoading(false);
        }
      } catch (caught) {
        if (!controller.signal.aborted && sequence === classListSequence.current) setError(caught instanceof Error ? caught.message : "班级列表加载失败");
      } finally {
        if (!controller.signal.aborted && sequence === classListSequence.current) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [fetcher, includeDemo]);

  useEffect(() => {
    if (!classId) {
      analyticsController.current?.abort();
      detailController.current?.abort();
      decisionController.current?.abort();
      return;
    }
    const sequence = ++classSequence.current;
    const controller = new AbortController();
    analyticsController.current?.abort();
    analyticsController.current = controller;
    activeClass.current = classId;
    detailController.current?.abort();
    detailSequence.current += 1;
    decisionController.current?.abort();
    decisionSequence.current += 1;
    void (async () => {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      decisionInFlight.current = false; setDecisionPending(false);
      setDetail(null); setLoading(true); setError(null);
      try {
        const payload = ClassAnalyticsSchema.parse(await jsonOrError(await fetcher(`/api/teacher/dashboard?classId=${encodeURIComponent(classId)}${includeDemo ? "&includeDemo=true" : ""}`, { signal: controller.signal, cache: "no-store" })));
        setAiMode(payload.aiMode);
        if (sequence === classSequence.current && !controller.signal.aborted) setAnalytics(payload);
      } catch (caught) {
        if (sequence === classSequence.current && !controller.signal.aborted) setError(caught instanceof Error ? caught.message : "班级数据加载失败");
      } finally { if (sequence === classSequence.current) setLoading(false); }
    })();
    return () => controller.abort();
  }, [classId, fetcher, includeDemo]);

  useEffect(() => () => {
    classListSequence.current += 1;
    analyticsController.current?.abort();
    detailController.current?.abort();
    decisionController.current?.abort();
    detailSequence.current += 1;
    decisionSequence.current += 1;
  }, []);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function openLearner(studentId: string) {
    const selectedClass = classId;
    activeStudent.current = studentId;
    const sequence = ++detailSequence.current;
    detailController.current?.abort();
    decisionController.current?.abort();
    decisionSequence.current += 1;
    decisionInFlight.current = false;
    setDecisionPending(false); setAgentReviewPending(false);
    setDetail(null);
    const controller = new AbortController();
    detailController.current = controller;
    setError(null);
    try {
      const payload = LearnerDetailSchema.parse(await jsonOrError(await fetcher(`/api/teacher/learners/${encodeURIComponent(studentId)}?classId=${encodeURIComponent(selectedClass)}${includeDemo ? "&includeDemo=true" : ""}`, { signal: controller.signal, cache: "no-store" })));
      if (sequence === detailSequence.current && selectedClass === activeClass.current && studentId === activeStudent.current && !controller.signal.aborted) setDetail(payload);
    } catch (caught) {
      if (!controller.signal.aborted && sequence === detailSequence.current && selectedClass === activeClass.current && studentId === activeStudent.current) setError(caught instanceof Error ? caught.message : "学习者数据加载失败");
    }
  }

  async function saveDecision(draft: { targetType: "LOGIC_REVIEW" | "EVIDENCE" | "TRANSFER" | "BOOK_LAYOUT_EVIDENCE"; targetId: string; originalRevision: number; decision: "CONFIRMED" | "CORRECTED" | "NEEDS_REVIEW"; reasonCode: string; notes: string }) {
    const standaloneBookEvidence = draft.targetType === "BOOK_LAYOUT_EVIDENCE";
    if (decisionInFlight.current || !detail || (!detail.project && !standaloneBookEvidence) || activeClass.current !== classId || activeStudent.current !== detail.student.id) return;
    decisionInFlight.current = true; setDecisionPending(true); setError(null);
    const sequence = ++decisionSequence.current;
    decisionController.current?.abort();
    const controller = new AbortController();
    decisionController.current = controller;
    const snapshot = detail;
    const projectId = standaloneBookEvidence ? null : detail.project?.id ?? null;
    try {
      const payload = TeacherDecisionPublicSchema.parse(await jsonOrError(await fetcher("/api/teacher/decisions", {
        method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({ ...draft, classId, studentId: snapshot.student.id, projectId, idempotencyKey: crypto.randomUUID() }),
      })));
      if (sequence === decisionSequence.current && activeClass.current === classId && activeStudent.current === snapshot.student.id && !controller.signal.aborted) {
        setDetail((current) => current && current.student.id === snapshot.student.id ? { ...current, decisions: [payload, ...current.decisions.filter((item) => item.id !== payload.id)], latestDecisionByTarget: { ...current.latestDecisionByTarget, [`${payload.targetType}:${payload.targetId}`]: payload } } : current);
        if (draft.targetType === "EVIDENCE") await refreshEvidenceState(undefined, true);
      }
    } catch (caught) { if (!controller.signal.aborted && sequence === decisionSequence.current) setError(caught instanceof Error ? caught.message : "教师决定保存失败"); }
    finally { if (sequence === decisionSequence.current) { decisionInFlight.current = false; setDecisionPending(false); } }
  }

  async function saveAgentReview(review: AgentDecisionReviewInput) {
    if (agentReviewPending || !detail || activeStudent.current !== detail.student.id) return;
    const studentId = detail.student.id;
    setAgentReviewPending(true);
    setError(null);
    try {
      const payload = AgentDecisionReviewPublicSchema.parse(await jsonOrError(await fetcher("/api/teacher/agent-reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(review),
      })));
      if (activeStudent.current === studentId) setDetail((current) => current && current.student.id === studentId ? {
        ...current,
        agentTimeline: (current.agentTimeline ?? []).map((item) => item.turnId === payload.turnId ? { ...item, review: payload } : item),
      } : current);
    } catch (caught) {
      if (activeStudent.current === studentId) setError(caught instanceof Error ? caught.message : "智能体判断复核失败");
    } finally {
      if (activeStudent.current === studentId) setAgentReviewPending(false);
    }
  }

  function changeClass(nextClassId: string) {
    if (nextClassId === activeClass.current) return;
    activeClass.current = nextClassId;
    activeStudent.current = "";
    classSequence.current += 1; detailSequence.current += 1; decisionSequence.current += 1;
    analyticsController.current?.abort(); detailController.current?.abort(); decisionController.current?.abort();
    decisionInFlight.current = false;
    setAnalytics(null); setDetail(null); setError(null); setDecisionPending(false); setAgentReviewPending(false); setLoading(true);
    setClassId(nextClassId);
  }

  function changeDemoVisibility(nextIncludeDemo: boolean) {
    demoPreferenceTouched.current = true;
    setAutoDemoFallback(false);
    classListSequence.current += 1; classSequence.current += 1; detailSequence.current += 1; decisionSequence.current += 1;
    analyticsController.current?.abort(); detailController.current?.abort(); decisionController.current?.abort();
    activeClass.current = ""; activeStudent.current = ""; decisionInFlight.current = false;
    setClasses([]); setClassId(""); setAnalytics(null); setDetail(null); setError(null); setDecisionPending(false); setAgentReviewPending(false); setLoading(true);
    setIncludeDemo(nextIncludeDemo);
  }

  async function refreshEvidenceState(deletedId?: string, preserveDecisionLock = false) {
    setEvidenceHistoryRevision((current) => current + 1);
    if (deletedId) setDetail((current) => current ? {
      ...current,
      evidence: { ...current.evidence, total: Math.max(0, current.evidence.total - 1) },
      reviewTargets: current.reviewTargets.filter((item) => !(item.snapshot.targetType === "EVIDENCE" && item.targetId === deletedId)),
    } : current);
    const selectedClass = activeClass.current;
    const selectedStudent = activeStudent.current;
    if (!selectedClass) return;
    setError(null);
    if (!preserveDecisionLock) {
      decisionController.current?.abort();
      decisionSequence.current += 1;
      decisionInFlight.current = false;
      setDecisionPending(false);
    }

    const analyticsSequence = ++classSequence.current;
    analyticsController.current?.abort();
    const nextAnalyticsController = new AbortController();
    analyticsController.current = nextAnalyticsController;
    const analyticsRefresh = (async () => {
      try {
        const payload = ClassAnalyticsSchema.parse(await jsonOrError(await fetcher(`/api/teacher/dashboard?classId=${encodeURIComponent(selectedClass)}${includeDemo ? "&includeDemo=true" : ""}`, { signal: nextAnalyticsController.signal, cache: "no-store" })));
        if (analyticsSequence === classSequence.current && selectedClass === activeClass.current && !nextAnalyticsController.signal.aborted) {
          setAnalytics(payload);
          setAiMode(payload.aiMode);
        }
      } catch (caught) {
        if (analyticsSequence === classSequence.current && selectedClass === activeClass.current && !nextAnalyticsController.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "班级数据刷新失败");
        }
      }
    })();

    let detailRefresh: Promise<void> = Promise.resolve();
    if (selectedStudent) {
      const learnerSequence = ++detailSequence.current;
      detailController.current?.abort();
      const nextDetailController = new AbortController();
      detailController.current = nextDetailController;
      detailRefresh = (async () => {
        try {
          const payload = LearnerDetailSchema.parse(await jsonOrError(await fetcher(`/api/teacher/learners/${encodeURIComponent(selectedStudent)}?classId=${encodeURIComponent(selectedClass)}${includeDemo ? "&includeDemo=true" : ""}`, { signal: nextDetailController.signal, cache: "no-store" })));
          if (learnerSequence === detailSequence.current && selectedClass === activeClass.current && selectedStudent === activeStudent.current && !nextDetailController.signal.aborted) {
            setDetail(payload);
          }
        } catch (caught) {
          if (learnerSequence === detailSequence.current && selectedClass === activeClass.current && selectedStudent === activeStudent.current && !nextDetailController.signal.aborted) {
            setError(caught instanceof Error ? caught.message : "学习者数据刷新失败");
          }
        }
      })();
    }
    await Promise.all([analyticsRefresh, detailRefresh]);
  }

  async function evidenceDeleted(id: string) { await refreshEvidenceState(id); }

  function memoryDeleted(id: string) {
    setDetail((current) => {
      if (!current) return current;
      const items = current.memories.items.filter((memory) => memory.id !== id);
      const total = Math.max(0, current.memories.meta.total - (items.length < current.memories.items.length ? 1 : 0));
      return {
        ...current,
        memories: {
          items,
          meta: { total, returned: items.length, truncated: total > items.length },
        },
      };
    });
  }

  function memoriesLoaded(items: StudentMemoryPublic[], total: number) {
    setDetail((current) => {
      if (!current) return current;
      const byId = new Map(current.memories.items.map((memory) => [memory.id, memory]));
      for (const memory of items) byId.set(memory.id, memory);
      const merged = [...byId.values()];
      return {
        ...current,
        memories: {
          items: merged,
          meta: { total, returned: merged.length, truncated: total > merged.length },
        },
      };
    });
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl space-y-6 px-4 py-5 sm:px-6 lg:px-8">
      <header className="rounded-[1.75rem] border border-[#dce4df] bg-[#fffef9] px-5 py-5 shadow-[0_8px_28px_rgba(23,51,45,0.06)] sm:px-7">
        <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><div className="grid size-12 place-items-center rounded-2xl bg-[#17332d] text-xl text-[#ffbf47]" aria-hidden="true">L</div><div><p className="text-xs font-black tracking-[0.18em] text-[#178b73]">Lumi 鹿鸣 · 教师工作台</p><h1 aria-label="教师学习分析工作台" className="mt-1 text-2xl font-black text-[#17332d] sm:text-3xl">课堂学习工作台</h1></div></div><Link aria-label="隐私与证据删除" className="text-sm font-bold text-[#58706a] underline" href="/privacy">隐私与证据管理</Link></div>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[#e6ebe7] pt-4"><label className="flex items-center gap-2 rounded-full bg-[#edf5f0] px-4 py-2 text-sm font-black text-[#0d6858]"><input checked={includeDemo} className="size-4 accent-[#178b73]" onChange={(event) => changeDemoVisibility(event.target.checked)} type="checkbox" />显示演示数据</label>{classes.length ? <label className="text-sm font-black text-[#3f5f56]">选择班级<select className="ml-2 rounded-xl border border-[#cbd8d2] bg-white px-3 py-2 text-[#17332d]" onChange={(event) => changeClass(event.target.value)} value={classId}>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.students}人）</option>)}</select></label> : null}{classId ? <div className="ml-auto flex flex-col items-start gap-1 sm:items-end"><a className="rounded-xl border-2 border-[#178b73] bg-white px-4 py-2 text-sm font-black text-[#0d6858] transition hover:bg-[#e7f5ef]" download href={`/api/teacher/pilot-report?classId=${encodeURIComponent(classId)}`}>导出真实试用报告</a><span className="text-xs text-[#71847f]">仅汇总真实数据；现场观察项仍需教师补填</span></div> : null}</div>
      </header>
      {autoDemoFallback ? <div className="flex gap-3 rounded-2xl border border-[#f2cf7a] bg-[#fff7df] p-4 text-sm leading-6 text-[#704d00]" role="status"><span aria-hidden="true" className="text-xl">ⓘ</span><p><strong className="block">当前还没有真实课堂记录，已自动打开演示班。</strong>下方数据用于体验教师分析功能，均为演示数据，不代表真实学生成效。关闭“显示演示数据”即可隐藏。</p></div> : null}
      {aiMode === "DETERMINISTIC_FALLBACK" ? <FallbackModeBadge /> : null}
      {classesMeta.truncated ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">班级列表仅显示 {classesMeta.returned}/{classesMeta.total}个，请联系管理员分配班级范围。</p> : null}
      <div aria-live="polite" className="sr-only">{loading ? "正在加载" : "加载完成"}</div>
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800" ref={errorRef} role="alert" tabIndex={-1}>{error}</div> : null}
      {loading ? <p className="rounded-2xl border border-[#dce4df] bg-[#fffef9] p-6 font-bold text-[#58706a]">正在整理课堂数据…</p> : null}
      {analytics ? <><ClassOverview analytics={analytics} onOpenLearner={openLearner} /><MisconceptionPanel analytics={analytics} /></> : null}
      <EvidenceHistory fetcher={fetcher as typeof fetch} onDeleted={evidenceDeleted} refreshToken={evidenceHistoryRevision} />
      {detail ? <LearnerDetail agentReviewPending={agentReviewPending} classId={classId} detail={detail} fetcher={fetcher as typeof fetch} includeDemo={includeDemo} onAgentReview={saveAgentReview} onDecision={saveDecision} onEvidenceDeleted={evidenceDeleted} onMemoryDeleted={memoryDeleted} onMemoryLoaded={memoriesLoaded} onTargetChange={() => setError(null)} pending={decisionPending} /> : null}
    </main>
  );
}
