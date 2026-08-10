/* eslint-disable @next/next/no-img-element -- authenticated evidence images must keep the teacher cookie and cannot use the image optimizer */
"use client";

import { useEffect, useRef, useState } from "react";

import { TeacherEvidenceDetailSchema, type TeacherEvidenceDetail } from "@/lib/domain/teacher-evidence";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function readPayload(response: Response) {
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error("证据内容暂时无法读取");
  return TeacherEvidenceDetailSchema.parse(payload);
}

function relationshipLabel(value: "DIRECT" | "INVERSE" | "THRESHOLD") {
  return value === "DIRECT" ? "直接映射" : value === "INVERSE" ? "反向映射" : "阈值映射";
}

function probeEntries(probe: Extract<TeacherEvidenceDetail, { kind: "PROBE" }>["probe"]) {
  switch (probe.type) {
    case "INPUT_MEASUREMENT": return [
      ["条件一", `${probe.firstCondition} · ${probe.firstValue} ${probe.unit}`],
      ["条件二", `${probe.secondCondition} · ${probe.secondValue} ${probe.unit}`],
    ];
    case "MAPPING_RANGE": return [
      ["输入范围", `${probe.inputMin} → ${probe.inputMax}`],
      ["输出范围", `${probe.outputMin} → ${probe.outputMax}`],
      ["映射关系", relationshipLabel(probe.relationship)],
    ];
    case "TRANSPORT_RECEIPT": return [
      ["传输协议", probe.protocol], ["接收地址", `${probe.host}:${probe.port}`], ["接收值", String(probe.receivedValue)],
    ];
    case "LOCAL_CHANNEL_RECEIPT": return [
      ["源通道", probe.sourceChannel], ["目标通道", probe.targetChannel], ["接收值", String(probe.receivedValue)],
    ];
    case "BINDING_OBSERVATION": return [
      ["来源", probe.source], ["目标参数", probe.target], ["变化", `${probe.observedBefore} → ${probe.observedAfter}`],
    ];
    case "OUTPUT_COMPARISON": return [
      ["输出参数", probe.parameter], ["前后对照", `${probe.before} → ${probe.after}`],
    ];
  }
}

function EvidenceBody({ detail, onImageReadyChange }: { detail: TeacherEvidenceDetail; onImageReadyChange: (ready: boolean) => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageRevision, setImageRevision] = useState(0);

  if (detail.kind === "TEXT") return <p className="whitespace-pre-wrap break-words rounded-2xl bg-white p-4 text-sm leading-6 text-[#263e37]">{detail.text}</p>;
  if (detail.kind === "VALUE") return <output className="block rounded-2xl bg-white p-5 font-mono text-3xl font-black text-[#17332d]">{detail.value}</output>;
  if (detail.kind === "VIDEO_LINK") return <div className="min-w-0 rounded-2xl bg-white p-4"><a className="break-all font-bold text-[#0d6858] underline decoration-[#8fc6b8] underline-offset-4" href={detail.url} rel="noopener noreferrer" target="_blank">打开视频证据</a><p className="mt-2 break-all text-xs text-[#667972]">{detail.url}</p></div>;
  if (detail.kind === "PROBE") return <dl className="grid gap-3 sm:grid-cols-2">{probeEntries(detail.probe).map(([label, value]) => <div className="min-w-0 rounded-2xl bg-white p-4" key={label}><dt className="text-xs font-bold text-[#6a7c76]">{label}</dt><dd className="mt-1 break-words font-semibold text-[#17332d]">{value}</dd></div>)}</dl>;
  return <div className="min-w-0 overflow-hidden rounded-2xl bg-white p-3">
    {!imageLoaded && !imageFailed ? <p className="mb-3 text-sm text-[#58706a]" role="status">正在加载图片预览…</p> : null}
    {imageFailed ? <div className="rounded-xl bg-[#fff0eb] p-4" role="alert"><p className="text-sm font-semibold text-[#9a4634]">图片预览失败，可重试；证据记录仍保留。</p><button className="mt-3 rounded-xl border border-[#d69b8e] px-3 py-2 text-sm font-bold text-[#8b3d2e]" onClick={() => { onImageReadyChange(false); setImageFailed(false); setImageLoaded(false); setImageRevision((value) => value + 1); }} type="button">重新加载图片</button></div> : <img alt={`证据图片：${detail.label}`} className="max-h-[28rem] w-full max-w-full object-contain" key={imageRevision} onError={() => { setImageFailed(true); setImageLoaded(false); onImageReadyChange(false); }} onLoad={() => { setImageLoaded(true); onImageReadyChange(true); }} src={imageRevision === 0 ? detail.previewUrl : `${detail.previewUrl}?preview=${imageRevision}`} />}
  </div>;
}

export function EvidenceReviewViewer({ evidenceId, fetcher = fetch, onReadyChange }: { evidenceId?: string; fetcher?: Fetcher; onReadyChange?: (ready: boolean) => void }) {
  const [revision, setRevision] = useState(0);
  const requestKey = `${evidenceId ?? ""}:${revision}`;
  const [result, setResult] = useState<{ key: string; status: "READY"; detail: TeacherEvidenceDetail } | { key: string; status: "ERROR" } | null>(null);
  const current = result?.key === requestKey ? result : null;
  const detail = current?.status === "READY" ? current.detail : null;
  const error = current?.status === "ERROR";
  const loading = Boolean(evidenceId && !current);
  const readyCallback = useRef(onReadyChange);
  useEffect(() => { readyCallback.current = onReadyChange; }, [onReadyChange]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    readyCallback.current?.(false);
    if (!evidenceId) return () => controller.abort();
    void (async () => {
      try {
        const payload = await readPayload(await fetcher(`/api/teacher/evidence/${encodeURIComponent(evidenceId)}`, { signal: controller.signal, cache: "no-store" }));
        if (!active || controller.signal.aborted) return;
        setResult({ key: requestKey, status: "READY", detail: payload }); readyCallback.current?.(payload.kind !== "IMAGE");
      } catch {
        if (!active || controller.signal.aborted) return;
        setResult({ key: requestKey, status: "ERROR" }); readyCallback.current?.(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [evidenceId, fetcher, requestKey]);

  return <section aria-labelledby="evidence-review-title" className="min-w-0 rounded-[1.75rem] border border-[#d8e2dd] bg-[#f7faf7] p-5">
    <p className="text-[10px] font-black tracking-[0.16em] text-[#178b73]">LEARNING EVIDENCE</p>
    <h3 className="mt-1 text-lg font-black text-[#17332d]" id="evidence-review-title">证据内容</h3>
    {!evidenceId ? <p className="mt-4 rounded-2xl border border-dashed border-[#cad7d1] p-4 text-sm text-[#6a7c76]">该学生当前没有可复核证据。</p> : null}
    {loading ? <p className="mt-4 text-sm text-[#58706a]" role="status">正在读取证据内容…</p> : null}
    {error ? <div className="mt-4 rounded-2xl bg-[#fff0eb] p-4" role="alert"><p className="text-sm font-semibold text-[#9a4634]">证据内容暂时无法读取</p><button className="mt-3 rounded-xl border border-[#d69b8e] px-3 py-2 text-sm font-bold text-[#8b3d2e]" onClick={() => setRevision((value) => value + 1)} type="button">重新加载证据</button></div> : null}
    {detail ? <div className="mt-4 min-w-0"><div className="mb-3 flex min-w-0 flex-wrap gap-2 text-xs"><span className="min-w-0 break-words rounded-full bg-[#e2f3ec] px-3 py-1 font-bold text-[#0d6858]">#{detail.evidenceSequence} · {detail.label}</span><span className="rounded-full bg-[#eef1ef] px-3 py-1 font-bold text-[#5a6c66]">{detail.signalLayer} · {detail.kind} · {detail.verificationStatus}</span></div><EvidenceBody detail={detail} key={detail.id} onImageReadyChange={(ready) => readyCallback.current?.(ready)} /></div> : null}
  </section>;
}
