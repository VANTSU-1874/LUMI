/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */
"use client";

import { Ban, Check, CheckCircle2, FileWarning, RefreshCw, Search, ShieldAlert } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { TeacherReleaseReadinessQueueSchema, type TeacherReleaseReadinessQueue } from "@/lib/domain/inspiration-wiki/release-readiness-contracts";
import { TeacherReleaseQualificationQueueSchema, type TeacherReleaseQualificationQueue } from "@/lib/domain/inspiration-wiki/release-qualification-contracts";
import { TeacherFormalReleaseQueueSchema, type TeacherFormalReleaseQueue } from "@/lib/domain/inspiration-wiki/formal-release-contracts";
import { TeacherAppShell } from "./TeacherAppShell";
import { jsonOrError, type TeacherWorkspaceFetcher } from "./teacher-workspace-api";

export function ReleaseReadinessWorkspace({ fetcher = fetch }: { fetcher?: TeacherWorkspaceFetcher }) {
  const [queue, setQueue] = useState<TeacherReleaseReadinessQueue | null>(null);
  const [qualification, setQualification] = useState<TeacherReleaseQualificationQueue | null>(null);
  const [formalReleases, setFormalReleases] = useState<TeacherFormalReleaseQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [decisionPending, setDecisionPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { evidenceRef: string; note: string }>>({});
  const [withdrawalReasons, setWithdrawalReasons] = useState<Record<string, string>>({});
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await jsonOrError(await fetcher("/api/teacher/inspiration-wiki/release-readiness", { signal, cache: "no-store" }));
      if (!signal?.aborted) setQueue(TeacherReleaseReadinessQueueSchema.parse(payload));
      try {
        const d25Payload = await jsonOrError(await fetcher("/api/teacher/inspiration-wiki/release-readiness?phase=d25", { signal, cache: "no-store" }));
        if (!signal?.aborted) setQualification(TeacherReleaseQualificationQueueSchema.parse(d25Payload));
      } catch {
        if (!signal?.aborted) setQualification(null);
      }
      try {
        const formalPayload = await jsonOrError(await fetcher("/api/teacher/inspiration-wiki/release-readiness?phase=formal", { signal, cache: "no-store" }));
        if (!signal?.aborted) setFormalReleases(TeacherFormalReleaseQueueSchema.parse(formalPayload));
      } catch {
        if (!signal?.aborted) setFormalReleases(null);
      }
    } catch (caught) {
      if (!signal?.aborted) setError(caught instanceof Error ? caught.message : "发布准备审计读取失败");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [fetcher]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return (queue?.items ?? []).filter((item) => !keyword || [item.title, item.primaryCategory, ...item.artisticStyleLabels].some((value) => value.toLocaleLowerCase("zh-CN").includes(keyword)));
  }, [query, queue]);

  async function decide(caseId: string, gate: TeacherReleaseQualificationQueue["items"][number]["gates"][number]["gate"], status: "SATISFIED" | "BLOCKED") {
    const key = `${caseId}:${gate}`;
    const draft = drafts[key] ?? { evidenceRef: "", note: "" };
    if (!draft.note.trim() || (gate === "STUDENT_DISPLAY_RIGHTS" && status === "SATISFIED" && !draft.evidenceRef.trim())) return;
    setDecisionPending(key);
    setError(null);
    try {
      await jsonOrError(await fetcher("/api/teacher/inspiration-wiki/release-readiness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ caseId, gate, status, evidenceRef: draft.evidenceRef.trim() || null, note: draft.note.trim(), idempotencyKey: crypto.randomUUID() }),
      }));
      const payload = await jsonOrError(await fetcher("/api/teacher/inspiration-wiki/release-readiness?phase=d25", { cache: "no-store" }));
      setQualification(TeacherReleaseQualificationQueueSchema.parse(payload));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "D-25 资格决定保存失败");
    } finally { setDecisionPending(null); }
  }

  async function formalAction(body: { action: "PUBLISH"; caseId: string; idempotencyKey: string } | { action: "WITHDRAW"; releaseId: string; reason: string; idempotencyKey: string }) {
    setDecisionPending(body.action === "PUBLISH" ? body.caseId : body.releaseId);
    setError(null);
    try {
      await jsonOrError(await fetcher("/api/teacher/inspiration-wiki/release-readiness", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify(body) }));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "正式发布操作失败");
    } finally { setDecisionPending(null); }
  }

  return <TeacherAppShell
    active="wiki"
    backHref="/teacher/inspiration-wiki/private-catalog"
    backLabel="返回私有内部目录"
    eyebrow="D-25 · 首批正式发布资格补齐"
    title="灵感 Wiki 发布资格工作台"
    description="为少量试点逐项补齐正式展示权、受众、来源披露、撤下准备与发布角色；资格完成仍不等于发布。"
    tools={<button className="teacherButton" disabled={loading} onClick={() => void load()} type="button"><RefreshCw size={15} />{loading ? "核对中…" : "重新核对"}</button>}
  >
    <div className="releaseReadinessWorkspace">
      {error ? <p className="teacherError" role="alert">{error}</p> : null}
      <section className="releaseQualificationLedger" aria-labelledby="release-qualification-heading">
        <div><p className="teacherEyebrow">D-25 · 试点资格补齐</p><h2 id="release-qualification-heading">{qualification?.meta.total ?? "—"} 个试点，{qualification?.meta.qualified ?? "—"} 个完成五道资格门。</h2><p>五项全部满足后才能在本页创建正式 Page、不可变 Release 与学生 Current Page；撤下会立即终止浏览、搜索和预览。</p></div>
        <dl><div><dt>试点</dt><dd>{qualification?.meta.total ?? "—"}</dd></div><div><dt>补齐中</dt><dd>{qualification?.meta.inProgress ?? "—"}</dd></div><div><dt>资格完成</dt><dd>{qualification?.meta.qualified ?? "—"}</dd></div><div><dt>学生暴露</dt><dd>0</dd></div></dl>
      </section>
      <section className="releaseQualificationList" aria-label="D-25 试点资格项目">
        {(qualification?.items ?? []).map((item, index) => <article key={item.releaseCase.caseId}>
          <header>
            {item.releaseCase.primaryPreviewUrl ? <Link className="releaseReadinessCover" href={`/teacher/inspiration-wiki/private-pages/${encodeURIComponent(item.releaseCase.pageId)}`}><Image alt="" fill loading={index < 4 ? "eager" : "lazy"} sizes="7rem" src={item.releaseCase.primaryPreviewUrl} unoptimized /></Link> : null}
            <div><span>{item.state === "QUALIFIED_FOR_CANONICAL_BUILD" ? "资格已完成" : `资格补齐中 · ${item.satisfiedGateCount}/5`}</span><h3>{item.releaseCase.title}</h3><p>{item.releaseCase.primaryCategory} · {item.releaseCase.artisticStyleLabels.join(" / ")}</p></div>
          </header>
          <div className="releaseQualificationGates">
            {item.gates.map((gate) => {
              const key = `${item.releaseCase.caseId}:${gate.gate}`;
              const draft = drafts[key] ?? { evidenceRef: "", note: "" };
              const pending = decisionPending === key;
              return <details key={gate.gate}>
                <summary data-status={gate.status}>{gate.status === "SATISFIED" ? <CheckCircle2 aria-hidden="true" size={15} /> : <FileWarning aria-hidden="true" size={15} />}<strong>{gate.label}</strong><span>{gate.status === "SATISFIED" ? "已满足" : gate.status === "BLOCKED" ? "阻断" : "待补齐"}</span></summary>
                <div>
                  {gate.decision ? <p>当前记录：{gate.decision.note}{gate.decision.evidenceRef ? ` · 依据：${gate.decision.evidenceRef}` : ""}</p> : <p>尚无教师资格决定。</p>}
                  {gate.gate === "STUDENT_DISPLAY_RIGHTS" ? <label>权利依据<input onChange={(event) => setDrafts((current) => ({ ...current, [key]: { ...draft, evidenceRef: event.target.value } }))} placeholder="授权书、合同、许可页面或证据编号" value={draft.evidenceRef} /></label> : null}
                  <label>教师说明<textarea onChange={(event) => setDrafts((current) => ({ ...current, [key]: { ...draft, note: event.target.value } }))} placeholder="说明判断范围与限制" value={draft.note} /></label>
                  <div><button className="teacherButton" disabled={pending || !draft.note.trim() || (gate.gate === "STUDENT_DISPLAY_RIGHTS" && !draft.evidenceRef.trim())} onClick={() => void decide(item.releaseCase.caseId, gate.gate, "SATISFIED")} type="button"><Check size={14} />确认满足</button><button className="teacherButton teacherButtonSecondary" disabled={pending || !draft.note.trim()} onClick={() => void decide(item.releaseCase.caseId, gate.gate, "BLOCKED")} type="button"><Ban size={14} />保持阻断</button></div>
                </div>
              </details>;
            })}
          </div>
          {item.state === "QUALIFIED_FOR_CANONICAL_BUILD" ? <div className="releaseQualificationPublish"><button className="teacherButton" disabled={decisionPending === item.releaseCase.caseId} onClick={() => void formalAction({ action: "PUBLISH", caseId: item.releaseCase.caseId, idempotencyKey: crypto.randomUUID() })} type="button"><CheckCircle2 size={15} />正式发布</button><span>事务内创建 canonical Revision、Release、Current Page 与 P2 Active 快照。</span></div> : null}
        </article>)}
        {!loading && qualification?.items.length === 0 ? <p className="teacherEmpty">D-25 试点尚未准备。</p> : null}
      </section>
      <section className="teacherPanel releaseFormalPanel">
        <header className="teacherPanelHeader"><div><h2>正式发布记录</h2><p>发布记录不可修改；Current Page 通过追加事件激活或撤下</p></div><span>{formalReleases?.meta.active ?? 0} 个生效</span></header>
        <div className="releaseFormalList">
          {(formalReleases?.items ?? []).map((item) => {
            const reason = withdrawalReasons[item.release.releaseId] ?? "";
            return <article key={item.release.releaseId}><div><span>{item.currentState === "ACTIVE" ? "学生端已生效" : "已撤下"}</span><h3>{item.release.publicMaterial.title}</h3><p>{item.release.publicMaterial.source.label} · {item.release.publicMaterial.tags.slice(0, 3).join(" / ")}</p></div>{item.currentState === "ACTIVE" ? <div><input aria-label={`撤下原因：${item.release.publicMaterial.title}`} onChange={(event) => setWithdrawalReasons((current) => ({ ...current, [item.release.releaseId]: event.target.value }))} placeholder="填写撤下原因" value={reason} /><button className="teacherButton teacherButtonSecondary" disabled={!reason.trim() || decisionPending === item.release.releaseId} onClick={() => void formalAction({ action: "WITHDRAW", releaseId: item.release.releaseId, reason: reason.trim(), idempotencyKey: crypto.randomUUID() })} type="button"><Ban size={14} />立即撤下</button></div> : <strong>学生不可见</strong>}</article>;
          })}
          {!formalReleases?.items.length ? <p className="teacherEmpty">尚无正式 Release。</p> : null}
        </div>
      </section>
      <section className="releaseReadinessBoundary"><ShieldAlert aria-hidden="true" size={18} /><div><strong>{formalReleases?.meta.active ? "P2 Active 仅开放正式集合" : "D-24 Shadow 继续生效"}</strong><span>{formalReleases?.meta.active ? "学生只能读取当前 Active 快照与最新 Current Page 事件精确一致的案例；R2、Embedding 与 Lumi Retrieval 仍关闭。" : "未产生合格 Release 前，浏览、搜索与预览继续返回空集合。"}</span></div></section>
      <details className="releaseReadinessPriorAudit"><summary>D-23 原始发布准备审计</summary>
      <section className="releaseReadinessLedger" aria-labelledby="release-readiness-heading">
        <div><p className="teacherEyebrow">激活前检查 · 未授权发布</p><h2 id="release-readiness-heading">{queue?.meta.eligible ?? "—"} 个可激活，{queue?.meta.blocked ?? "—"} 个被正式发布门阻断。</h2><p>当前最先阻断的是权利：已确认未知只覆盖教师私有使用，不能自动变成学生展示许可。</p></div>
        <dl><div><dt>目录项目</dt><dd>{queue?.meta.total ?? "—"}</dd></div><div><dt>可激活</dt><dd>{queue?.meta.eligible ?? "—"}</dd></div><div><dt>权利未知</dt><dd>{queue?.meta.rightsUnknown ?? "—"}</dd></div><div><dt>Current Page</dt><dd>0</dd></div></dl>
      </section>
      <section className="releaseReadinessWarning"><ShieldAlert aria-hidden="true" size={19} /><div><strong>本页没有发布操作</strong><span>取得逐作品正式展示权利，并另行授权 P2 开发和学生通道后，才可进入下一门。</span></div><span>0 / {queue?.meta.total ?? "—"} READY</span></section>
      <section className="releaseGateMap" aria-label="正式发布门">
        {(queue?.items[0]?.gates ?? []).map((gate) => <div data-status={gate.status} key={gate.key}>{gate.status === "PASSED" ? <Check aria-hidden="true" size={16} /> : gate.status === "BLOCKED" ? <Ban aria-hidden="true" size={16} /> : <FileWarning aria-hidden="true" size={16} />}<strong>{gate.label}</strong><span>{gate.explanation}</span></div>)}
      </section>
      <section className="teacherPanel">
        <header className="teacherPanelHeader"><div><h2>逐项阻断清单</h2><p>每项均绑定 D-22 内部目录的精确私有修订</p></div><span>{filtered.length} 项</span></header>
        <div className="releaseReadinessFilters"><label><Search aria-hidden="true" size={15} /><input aria-label="搜索发布准备项目" onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、分类或风格" value={query} /></label></div>
        <div className="releaseReadinessList">
          {filtered.map((item, index) => <article key={item.entryId}><Link className="releaseReadinessCover" href={`/teacher/inspiration-wiki/private-pages/${encodeURIComponent(item.pageId)}`}><Image alt="" fill loading={index < 4 ? "eager" : "lazy"} sizes="(max-width: 640px) 26vw, 7rem" src={item.primaryPreviewUrl} unoptimized /></Link><div><span>正式发布阻断 · {item.passedGateCount}/{item.totalGateCount}</span><h3>{item.title}</h3><p>{item.primaryCategory} · {item.artisticStyleLabels.join(" / ")}</p><small>权利：已确认未知，仅限教师私有使用</small></div><strong><Ban aria-hidden="true" size={15} />不可发布</strong></article>)}
          {!loading && filtered.length === 0 ? <p className="teacherEmpty">没有符合搜索条件的项目。</p> : null}
        </div>
      </section>
      <section className="releaseReadinessBoundary"><ShieldAlert aria-hidden="true" size={18} /><div><strong>学生通道保持关闭</strong><span>正式 Release、Current Page、浏览、搜索、R2、Embedding 与 Lumi 引用均未创建或激活。</span></div></section>
      </details>
    </div>
  </TeacherAppShell>;
}
