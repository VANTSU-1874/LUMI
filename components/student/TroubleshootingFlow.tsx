"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { TroubleshootingPublicStateSchema } from "@/lib/services/troubleshooting";

const LAYER_NAMES = { INPUT: "输入", MAPPING: "映射", TRANSPORT: "传输", BINDING: "绑定", OUTPUT: "输出" } as const;

export function TroubleshootingFlow({
  projectId, initialState,
  evidence,
  onAdvanced,
  fetchImpl = fetch,
}: {
  projectId: string;
  initialState?: { id: string; revision: number; state: z.infer<typeof TroubleshootingPublicStateSchema> } | null;
  evidence: Array<{ id: string; label: string }>;
  onAdvanced?: (state: z.infer<typeof TroubleshootingPublicStateSchema>) => void;
  fetchImpl?: typeof fetch;
}) {
  const [evidenceRecordId, setEvidenceRecordId] = useState("");
  const [state, setState] = useState<z.infer<typeof TroubleshootingPublicStateSchema> | null>(initialState?.state ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    sequence.current += 1;
    controller.current?.abort();
    queueMicrotask(() => {
      if (!active) return;
      setPending(false); setState(initialState?.state ?? null); setError(""); setEvidenceRecordId("");
    });
    return () => {
      active = false;
      sequence.current += 1;
      controller.current?.abort();
      controller.current = null;
    };
    // The latest server revision is supplied on remount; ordinary snapshots must preserve the selected evidence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function checkLayer() {
    if (pending) return;
    const currentSequence = ++sequence.current;
    const currentProject = projectId;
    const abort = new AbortController();
    controller.current = abort;
    setPending(true); setError("");
    try {
      const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}/troubleshooting`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(evidenceRecordId ? { evidenceRecordId } : {}),
        signal: abort.signal,
      });
      const payload: unknown = await response.json();
      if (currentSequence !== sequence.current || currentProject !== projectId) return;
      if (!response.ok) throw new Error((payload as { error?: string }).error ?? "排障请求失败");
      const next = TroubleshootingPublicStateSchema.parse(payload);
      setState(next);
      onAdvanced?.(next);
      requestAnimationFrame(() => resultHeading.current?.focus());
    } catch (reason) {
      if (currentSequence !== sequence.current || abort.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "排障请求失败");
    } finally {
      if (currentSequence === sequence.current) { setPending(false); controller.current = null; }
    }
  }

  return (
    <section aria-labelledby="troubleshooting-title">
      <h2 id="troubleshooting-title">信号链排障</h2>
      <label>选择新证据
        <select aria-label="选择新证据" value={evidenceRecordId} onChange={(event) => setEvidenceRecordId(event.target.value)}>
          <option value="">本轮没有新证据</option>
          {evidence.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <button type="button" disabled={pending} onClick={checkLayer}>{pending ? "检查中" : "检查当前层"}</button>
      {pending && <button type="button" onClick={() => controller.current?.abort()}>取消检查</button>}
      {error && <p role="alert">{error}</p>}
      {state && <div>
        <h3 ref={resultHeading} tabIndex={-1}>排障结果</h3>
        <p role="status" aria-live="polite">当前检查层：{LAYER_NAMES[state.currentLayer]}</p>
        <h4>已确认事实</h4><ul>{state.confirmedFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
        <h4>待验证假设</h4><ul>{state.unconfirmedHypotheses.map((item) => <li key={item}>{item}</li>)}</ul>
        <h4>唯一下一步</h4><ul>{state.nextActions.map((item) => <li key={item}>{item}</li>)}</ul>
        {state.status === "ESCALATED" && <p role="alert">已请求教师介入</p>}
      </div>}
    </section>
  );
}
