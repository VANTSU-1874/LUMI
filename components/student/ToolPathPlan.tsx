"use client";

import { useEffect, useRef, useState } from "react";
import type { z } from "zod";

import type { ProjectStage } from "@/lib/domain/stages";
import {
  ToolPathPlanResponseSchema,
} from "@/lib/domain/tool-path";
import type { ToolPath } from "@/lib/domain/schemas";

type PlanResult = z.infer<typeof ToolPathPlanResponseSchema>["plan"];

const pathNames: Record<ToolPath, string> = {
  DIGISHOW: "DigiShow 路径",
  TOUCHDESIGNER: "TouchDesigner 路径",
  COLLABORATIVE: "DigiShow + TouchDesigner 协同路径",
};

type PersistedPlan = Pick<PlanResult, "path" | "reasons" | "milestones">;

export function ToolPathSummary({ plan }: { plan: PersistedPlan }) {
  return <section aria-labelledby="persisted-tool-path-title" className="space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-6">
    <div>
      <p className="text-sm font-semibold text-indigo-700">已生成计划 · 只读</p>
      <h2 id="persisted-tool-path-title" className="mt-1 text-2xl font-bold text-slate-900">{pathNames[plan.path]}</h2>
    </div>
    <div>
      <h3 className="font-semibold">推荐原因</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5">{plan.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    </div>
    <div>
      <h3 className="font-semibold">实施里程碑</h3>
      <ol className="mt-2 list-decimal space-y-3 pl-5">{plan.milestones.map((milestone) => <li key={milestone.id}>
        <strong>{milestone.title}</strong>
        <p className="text-sm text-slate-600">证据/完成条件：{milestone.requiredEvidenceLabel}</p>
      </li>)}</ol>
    </div>
  </section>;
}

export function ToolPathPlan({
  projectId,
  stage,
  onPlanned,
}: {
  projectId: string;
  stage: ProjectStage;
  onPlanned?: (plan: PlanResult) => void;
}) {
  const [needsRealtimeVisuals, setNeedsRealtimeVisuals] = useState(false);
  const [needsPhysicalControl, setNeedsPhysicalControl] = useState(false);
  const [hasOsc, setHasOsc] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [locallyLocked, setLocallyLocked] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const inFlightRef = useRef(false);
  const stageLocked = stage !== "TOOL_PATH";
  const successLocked = locallyLocked;
  const locked = stageLocked || successLocked;

  useEffect(() => {
    let active = true;
    requestRef.current?.abort();
    requestRef.current = null;
    requestSequenceRef.current += 1;
    inFlightRef.current = false;
    queueMicrotask(() => {
      if (!active) return;
      setNeedsRealtimeVisuals(false);
      setNeedsPhysicalControl(false);
      setHasOsc(false);
      setPending(false);
      setError(null);
      setPlan(null);
      setLocallyLocked(false);
    });
    return () => {
      active = false;
      requestRef.current?.abort();
      requestRef.current = null;
      requestSequenceRef.current += 1;
      inFlightRef.current = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (stage === "TOOL_PATH" || !inFlightRef.current) return;
    requestRef.current?.abort();
    requestRef.current = null;
    requestSequenceRef.current += 1;
    inFlightRef.current = false;
    queueMicrotask(() => setPending(false));
  }, [projectId, stage]);

  async function submit() {
    if (inFlightRef.current || locked) return;
    inFlightRef.current = true;
    const controller = new AbortController();
    requestRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tool-path`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ needsRealtimeVisuals, needsPhysicalControl, hasOsc }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted || sequence !== requestSequenceRef.current) return;
      if (!response.ok) {
        const message = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : "规划失败，请稍后重试";
        throw new Error(message);
      }
      const parsed = ToolPathPlanResponseSchema.safeParse(payload);
      if (!parsed.success || parsed.data.plan.projectId !== projectId) {
        throw new Error("工具路径结果暂不可用");
      }
      setPlan(parsed.data.plan);
      setLocallyLocked(true);
      onPlanned?.(parsed.data.plan);
    } catch (caught) {
      if (controller.signal.aborted || sequence !== requestSequenceRef.current) return;
      setError(caught instanceof Error ? caught.message : "规划失败，请稍后重试");
    } finally {
      if (sequence === requestSequenceRef.current) {
        requestRef.current = null;
        inFlightRef.current = false;
        setPending(false);
      }
    }
  }

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">工具路径规划</h2>
        {successLocked ? (
          <p className="mt-2 text-emerald-700">工具路径计划已生成，当前操作已锁定</p>
        ) : stage === "TOOL_PATH" ? (
          <p className="mt-2 text-slate-600">请勾选项目需求，系统会结合你的学习画像推荐路径。</p>
        ) : ["BUILD", "TROUBLESHOOT", "TRANSFER", "COMPLETE"].includes(stage) ? (
          <p className="mt-2 text-emerald-700">工具路径规划已完成，当前操作已锁定</p>
        ) : (
          <p className="mt-2 text-amber-700">工具路径尚未解锁</p>
        )}
      </div>
      <fieldset
        aria-disabled={locked ? "true" : "false"}
        aria-label="项目需求"
        className="grid gap-3"
        disabled={locked || pending}
      >
        <label><input checked={needsRealtimeVisuals} onChange={(event) => setNeedsRealtimeVisuals(event.target.checked)} type="checkbox" /> 需要实时视觉</label>
        <label><input checked={needsPhysicalControl} onChange={(event) => setNeedsPhysicalControl(event.target.checked)} type="checkbox" /> 需要物理控制</label>
        <label><input checked={hasOsc} onChange={(event) => setHasOsc(event.target.checked)} type="checkbox" /> 已具备 OSC 通信</label>
      </fieldset>
      <button
        className="rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
        disabled={locked || pending}
        onClick={() => void submit()}
        type="button"
      >
        {pending ? "正在规划…" : "生成工具路径"}
      </button>
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      {plan ? (
        <div aria-live="polite" className="space-y-4 rounded-xl bg-slate-50 p-4">
          <h3 className="text-xl font-bold">{pathNames[plan.path]}</h3>
          <div><h4 className="font-semibold">推荐原因</h4><ul>{plan.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
          <div><h4 className="font-semibold">实施里程碑</h4><ol>{plan.milestones.map((milestone) => <li key={milestone.id}><strong>{milestone.title}</strong><p>证据：{milestone.requiredEvidenceLabel}</p></li>)}</ol></div>
        </div>
      ) : null}
    </section>
  );
}
