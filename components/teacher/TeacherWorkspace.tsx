"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileCheck2 } from "lucide-react";

import { AgentDecisionReviewPublicSchema, ClassAnalyticsSchema, LearnerDetailSchema, TeacherDecisionPublicSchema, type AgentDecisionReviewInput, type ClassAnalytics, type LearnerDetail as LearnerDetailValue } from "@/lib/domain/teacher";
import { LearnerDetail } from "./LearnerDetail";
import { FallbackModeBadge } from "@/components/common/FallbackModeBadge";
import { EvidenceHistory } from "@/components/common/EvidenceHistory";
import { ClassListSchema, jsonOrError, type TeacherClassList, type TeacherWorkspaceFetcher } from "./teacher-workspace-api";
import type { StudentMemoryPublic } from "@/lib/domain/student-memory";
import { TeacherReviewPackQueueSchema } from "@/lib/domain/inspiration-wiki/review-pack-contracts";
import { TeacherAppShell, type TeacherSection } from "./TeacherAppShell";
import { TeacherDashboardOverview, TeacherStudentsTable } from "./TeacherDashboardOverview";

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
  const [section, setSection] = useState<TeacherSection>("overview");
  const [reviewPackSummary, setReviewPackSummary] = useState<{ ready: number; governance: number } | null>(null);
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
    const controller = new AbortController();
    void (async () => {
      try {
        const payload = TeacherReviewPackQueueSchema.parse(await jsonOrError(await fetcher("/api/teacher/inspiration-wiki/review-packs", { signal: controller.signal, cache: "no-store" })));
        if (!controller.signal.aborted) setReviewPackSummary({ ready: payload.meta.teacherReviewReady, governance: payload.meta.totalGovernanceMaterials });
      } catch {
        // The classroom workspace remains usable if the separately governed Wiki readiness API is unavailable.
      }
    })();
    return () => controller.abort();
  }, [fetcher]);

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
    setSection("reviews");
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

  const sectionTitle: Record<TeacherSection, string> = {
    overview: "课堂学习工作台",
    students: "学生与班级",
    reviews: "判断复核",
    wiki: "灵感 Wiki",
    evidence: "证据与隐私",
  };

  const tools = <>
    <label className="teacherCheck"><input checked={includeDemo} onChange={(event) => changeDemoVisibility(event.target.checked)} type="checkbox" />显示演示数据</label>
    {classes.length ? <label className="teacherCheck">选择班级<select aria-label="选择班级" className="teacherSelect" onChange={(event) => changeClass(event.target.value)} value={classId}>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.students}人）</option>)}</select></label> : null}
    {classId ? <a aria-label="导出真实试用报告" className="teacherButton" download href={`/api/teacher/pilot-report?classId=${encodeURIComponent(classId)}`}><Download size={15} />导出真实试用报告</a> : null}
  </>;

  return (
    <TeacherAppShell active={section} description={classId ? "仅汇总真实数据；现场观察项仍需教师补填" : "选择班级后查看课堂数据。"} eyebrow="Lumi 鹿鸣 · 教师工作台" onNavigate={setSection} title={sectionTitle[section]} tools={tools}>
      {autoDemoFallback ? <div className="teacherNotice" role="status"><p><strong>当前还没有真实课堂记录，已自动打开演示班。</strong>下方数据用于体验教师分析功能，均为演示数据，不代表真实学生成效。关闭“显示演示数据”即可隐藏。</p></div> : null}
      {aiMode === "DETERMINISTIC_FALLBACK" ? <FallbackModeBadge /> : null}
      {classesMeta.truncated ? <p className="teacherNotice">班级列表仅显示 {classesMeta.returned}/{classesMeta.total} 个，请联系管理员分配班级范围。</p> : null}
      <div aria-live="polite" className="sr-only">{loading ? "正在加载" : "加载完成"}</div>
      {error ? <div className="teacherNotice teacherError" ref={errorRef} role="alert" tabIndex={-1}>{error}</div> : null}
      {loading ? <p className="teacherLoading">正在整理课堂数据…</p> : null}
      {analytics && section === "overview" ? <TeacherDashboardOverview analytics={analytics} governanceMaterials={reviewPackSummary?.governance ?? null} onOpenLearner={openLearner} onShowStudents={() => setSection("students")} reviewReady={reviewPackSummary?.ready ?? null} /> : null}
      {analytics && section === "students" ? <TeacherStudentsTable analytics={analytics} onOpenLearner={openLearner} /> : null}
      {analytics && section === "reviews" ? <div className="teacherWorkspaceGrid">
        <TeacherStudentsTable analytics={analytics} onOpenLearner={openLearner} />
        {!detail ? <p className="teacherEmpty teacherPanel">选择一名学生，查看原系统判断并追加教师复核。</p> : null}
        {detail ? <div className="teacherPanel teacherLearnerFrame"><LearnerDetail agentReviewPending={agentReviewPending} classId={classId} detail={detail} fetcher={fetcher as typeof fetch} includeDemo={includeDemo} onAgentReview={saveAgentReview} onDecision={saveDecision} onEvidenceDeleted={evidenceDeleted} onMemoryDeleted={memoryDeleted} onMemoryLoaded={memoriesLoaded} onTargetChange={() => setError(null)} pending={decisionPending} /></div> : null}
        <article className="teacherPanel" aria-labelledby="evidence-summary-heading"><header className="teacherPanelHeader"><div><h2 id="evidence-summary-heading">证据来源与验证</h2><p>当前班级聚合</p></div><FileCheck2 aria-hidden="true" size={16} /></header>{analytics.evidence.byVerification.length ? <div className="teacherTaskList">{analytics.evidence.byVerification.map((item) => <div className="teacherTask" key={item.key}><span className="teacherTaskIndex">EV</span><div><strong>{item.key}</strong><p>当前验证状态</p></div><span>{item.count}</span></div>)}</div> : <p className="teacherEmpty">暂无证据</p>}</article>
        <div className="teacherEvidenceFrame"><EvidenceHistory fetcher={fetcher as typeof fetch} onDeleted={evidenceDeleted} refreshToken={evidenceHistoryRevision} /></div>
      </div> : null}
      {section === "evidence" ? <div className="teacherWorkspaceGrid"><div className="teacherPanel teacherEvidenceFrame"><EvidenceHistory fetcher={fetcher as typeof fetch} onDeleted={evidenceDeleted} refreshToken={evidenceHistoryRevision} /></div><a className="teacherButton" href="/privacy">打开隐私与证据删除中心</a></div> : null}
    </TeacherAppShell>
  );
}
