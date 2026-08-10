"use client";

import { useEffect, useState } from "react";

import {
  GenerativeArtifactSchema,
  GenerativeResetResponseSchema,
  GenerativeToolKindSchema,
  GenerativeWorkspaceResponseSchema,
  type GenerativeArtifact,
  type GenerativeBuildRequestResponse,
  type GenerativeToolKind,
} from "@/lib/domain/generative-tool";
import {
  GENERATIVE_TOOL_KIND_LABELS,
  GENERATIVE_TOOL_KINDS,
} from "@/lib/agent/skills/generative-tool-spec";

const DEFAULT_KIND: GenerativeToolKind = "DOT_MATRIX";
const DEFAULT_BRIEF = "做一个可调整数量、大小与间距的视觉实验，参数变化要能立即看见。";

function responseMessage(raw: unknown, fallback: string) {
  if (typeof raw !== "object" || raw === null) return fallback;
  const error = "error" in raw && typeof raw.error === "string" ? raw.error : fallback;
  const violations = "violations" in raw && Array.isArray(raw.violations)
    ? raw.violations.filter((item): item is string => typeof item === "string")
    : [];
  return violations.length > 0 ? `${error}（${violations.join("、")}）` : error;
}

export function GenerativeLab({
  fetchImpl = fetch,
}: {
  fetchImpl?: typeof fetch;
  initialFocus?: string | null;
}) {
  const [kind, setKind] = useState<GenerativeToolKind>(DEFAULT_KIND);
  const [brief, setBrief] = useState(DEFAULT_BRIEF);
  const [request, setRequest] = useState<GenerativeBuildRequestResponse | null>(null);
  const [artifact, setArtifact] = useState<GenerativeArtifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("正在恢复生成器工作区…");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetchImpl("/api/generative-tool", {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const raw: unknown = await response.json();
        if (!response.ok) throw new Error(responseMessage(raw, "生成器工作区恢复失败"));
        const workspace = GenerativeWorkspaceResponseSchema.parse(raw);
        if (cancelled) return;
        setRequest(workspace.request);
        setArtifact(workspace.artifact);
        if (workspace.request) {
          setKind(workspace.request.kind);
          setBrief(workspace.request.brief);
        }
        setStatus(workspace.status === "READY"
          ? "已恢复最近一次通过安全校验的生成器。"
          : workspace.status === "REQUESTED"
            ? "已恢复导师记录的生成请求，确认要求后即可构建。"
            : "工作区为空，可以从一种形式语言开始。");
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "生成器工作区恢复失败");
      }
    })();
    return () => { cancelled = true; };
  }, [fetchImpl]);

  async function build() {
    const normalizedBrief = brief.trim();
    if (!normalizedBrief) {
      setStatus("先写清希望调哪些参数、观察什么变化。");
      return;
    }
    setBusy(true);
    setStatus("正在构建并执行零外链安全校验，这一步可能需要一两分钟…");
    try {
      const sameConfirmedRequest = request
        && request.kind === kind
        && request.brief === normalizedBrief;
      const response = await fetchImpl("/api/generative-tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          brief: normalizedBrief,
          ...(sameConfirmedRequest ? { requestId: request.id } : {}),
        }),
      });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error(responseMessage(raw, "生成器构建失败"));
      const nextArtifact = GenerativeArtifactSchema.parse(raw);
      setArtifact(nextArtifact);
      setRequest(sameConfirmedRequest ? request : {
        id: nextArtifact.requestId,
        kind: nextArtifact.kind,
        brief: nextArtifact.brief,
        status: "REQUESTED",
        createdAt: nextArtifact.createdAt,
        dataType: nextArtifact.dataType,
      });
      setBrief(normalizedBrief);
      setStatus("构建完成：产物已通过服务端校验，并在隔离沙箱中运行。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "生成器构建失败");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setStatus("正在重置生成器工作区…");
    try {
      const response = await fetchImpl("/api/generative-tool", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const raw: unknown = await response.json();
      if (!response.ok) throw new Error(responseMessage(raw, "生成器工作区重置失败"));
      GenerativeResetResponseSchema.parse(raw);
      setRequest(null);
      setArtifact(null);
      setKind(DEFAULT_KIND);
      setBrief(DEFAULT_BRIEF);
      setStatus("工作区已重置；历史事件仍保留用于审计。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "生成器工作区重置失败");
    } finally {
      setBusy(false);
    }
  }

  return <section aria-labelledby="generative-lab-title" className="min-h-screen bg-[#f0eeeb] px-4 pb-32 pt-5 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-[1500px] space-y-5">
      <header className="rounded-[2rem] border border-[#c8c3bc] bg-[#1a1816] px-6 py-8 text-[#f0eeeb] sm:px-8">
        <p className="text-xs font-black tracking-[0.2em] text-[#c8c3bc]">GENERATIVE LAB / 现场生成器实验</p>
        <h1 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-4xl" id="generative-lab-title">把形式语言变成可调参数</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-[#dedad4]">
          选择一种视觉结构，说明希望观察的变化。Lumi 只接现有文本模型生成单文件 HTML；没有图像供应商也不影响本实验。
        </p>
      </header>

      <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className="space-y-4 rounded-[1.75rem] border border-[#c8c3bc] bg-[#f8f6f2] p-5">
          <div>
            <label className="text-[10px] font-black uppercase tracking-[0.16em] text-[#6b6560]" htmlFor="generative-kind">Generator / 生成器类型</label>
            <select
              className="mt-2 w-full rounded-xl border border-[#c8c3bc] bg-white px-3 py-3 text-sm font-bold text-[#1a1816]"
              disabled={busy}
              id="generative-kind"
              onChange={(event) => setKind(GenerativeToolKindSchema.parse(event.target.value))}
              value={kind}
            >
              {GENERATIVE_TOOL_KINDS.map((value) => <option key={value} value={value}>{GENERATIVE_TOOL_KIND_LABELS[value]}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-[0.16em] text-[#6b6560]" htmlFor="generative-brief">Brief / 创作要求</label>
            <textarea
              className="mt-2 min-h-44 w-full resize-y rounded-xl border border-[#c8c3bc] bg-white px-3 py-3 text-sm leading-6 text-[#1a1816]"
              disabled={busy}
              id="generative-brief"
              maxLength={600}
              onChange={(event) => setBrief(event.target.value)}
              value={brief}
            />
            <p className="mt-1 text-right font-mono text-[10px] text-[#9b9590]">{brief.length}/600</p>
          </div>

          <button className="w-full rounded-xl bg-[#1a1816] px-4 py-3 text-sm font-black text-[#f0eeeb] disabled:opacity-50" disabled={busy} onClick={() => void build()} type="button">
            {busy ? "处理中…" : "构建并安全校验"}
          </button>
          <button className="w-full rounded-xl border border-[#b0aaa2] bg-transparent px-4 py-3 text-sm font-bold text-[#6b6560] disabled:opacity-50" disabled={busy} onClick={() => void reset()} type="button">
            重置工作区
          </button>
          <p aria-live="polite" className="rounded-xl bg-[#e8e5e0] px-3 py-3 text-xs leading-5 text-[#6b6560]">{status}</p>
          <div className="rounded-xl border border-[#dedad4] bg-white px-3 py-3 text-[10px] leading-5 text-[#6b6560]">
            <b className="block text-[#1a1816]">安全边界</b>
            零外链服务端校验 + CSP；iframe 仅开放脚本执行，不开放同源、表单、导航或宿主访问。
          </div>
        </aside>

        <div className="overflow-hidden rounded-[1.75rem] border border-[#c8c3bc] bg-[#e8e5e0]">
          <div className="flex items-center justify-between border-b border-[#c8c3bc] bg-[#f8f6f2] px-4 py-3">
            <div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#6b6560]">Sandbox preview</p><p className="mt-0.5 text-xs text-[#9b9590]">{artifact ? `${GENERATIVE_TOOL_KIND_LABELS[artifact.kind]} · 已校验` : "等待构建"}</p></div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${artifact ? "bg-[#1a1816] text-[#f0eeeb]" : "bg-[#dedad4] text-[#6b6560]"}`}>{artifact ? "SAFE" : "EMPTY"}</span>
          </div>
          {artifact
            ? <iframe
              className="block h-[680px] w-full bg-white"
              key={artifact.id}
              referrerPolicy="no-referrer"
              sandbox="allow-scripts"
              srcDoc={artifact.html}
              title={`${GENERATIVE_TOOL_KIND_LABELS[artifact.kind]}生成器沙箱预览`}
            />
            : <div className="grid h-[680px] place-items-center p-8 text-center"><div><p className="font-mono text-4xl text-[#b0aaa2]">+ + +</p><p className="mt-4 text-sm font-bold text-[#6b6560]">填写要求后，在这里运行通过校验的单文件生成器</p><p className="mt-2 text-xs text-[#9b9590]">不会加载 CDN、外部字体、远程图片或任何图像生成供应商。</p></div></div>}
        </div>
      </div>
    </div>
  </section>;
}
