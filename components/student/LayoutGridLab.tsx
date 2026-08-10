"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  A4_PORTRAIT_DEFAULT,
  LayoutGridDraftResponseSchema,
  LayoutGridEvidenceResponseSchema,
  LayoutGridWorkspaceResponseSchema,
  type LayoutBlock,
  type LayoutGridConfig,
  type LayoutGridEvidenceResponse,
} from "@/lib/domain/layout-grid";

type Role = LayoutBlock["role"];

const ROLE_COPY: Record<Role, { label: string; hint: string; tone: string }> = {
  TITLE: { label: "主标题", hint: "读者三秒内要拿到的那条", tone: "#17332d" },
  SUBTITLE: { label: "副标题", hint: "补充主标题的限定信息", tone: "#3f6b5e" },
  BODY: { label: "正文", hint: "需要阅读而非扫视的内容", tone: "#79aa9c" },
  CAPTION: { label: "说明", hint: "图注、日期、联系方式等支撑信息", tone: "#c8c3bc" },
};

const INITIAL_BLOCKS: LayoutBlock[] = [
  { id: "title", role: "TITLE", colStart: 1, colSpan: 8, rowStart: 2, rowSpan: 3, fontScale: 3.2 },
  { id: "subtitle", role: "SUBTITLE", colStart: 1, colSpan: 6, rowStart: 6, rowSpan: 1, fontScale: 1.6 },
  { id: "body", role: "BODY", colStart: 1, colSpan: 5, rowStart: 9, rowSpan: 6, fontScale: 1 },
  { id: "caption", role: "CAPTION", colStart: 9, colSpan: 4, rowStart: 19, rowSpan: 2, fontScale: 0.8 },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function LayoutGridLab({ fetchImpl = fetch }: { fetchImpl?: typeof fetch; initialFocus?: string | null }) {
  const [config, setConfig] = useState<LayoutGridConfig>(A4_PORTRAIT_DEFAULT);
  const [blocks, setBlocks] = useState<LayoutBlock[]>(INITIAL_BLOCKS);
  const [selectedId, setSelectedId] = useState<string>(INITIAL_BLOCKS[0].id);
  const [evidence, setEvidence] = useState<LayoutGridEvidenceResponse | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetchImpl("/api/layout-grid");
        if (!response.ok) return;
        const workspace = LayoutGridWorkspaceResponseSchema.parse(await response.json());
        if (cancelled) return;
        if (workspace.resume) {
          setConfig(workspace.resume.config);
          if (workspace.resume.blocks.length > 0) {
            setBlocks(workspace.resume.blocks);
            setSelectedId(workspace.resume.blocks[0].id);
          }
        }
        if (workspace.latest) setEvidence(workspace.latest);
      } catch {
        // 恢复失败不阻断动手：保留初始栅格，学生照样能开始。
      }
    })();
    return () => { cancelled = true; };
  }, [fetchImpl]);

  const selected = useMemo(
    () => blocks.find((block) => block.id === selectedId) ?? blocks[0],
    [blocks, selectedId],
  );

  const updateSelected = useCallback((patch: Partial<LayoutBlock>) => {
    setBlocks((current) => current.map((block) => (block.id === selected?.id ? { ...block, ...patch } : block)));
    setEvidence(null);
  }, [selected?.id]);

  async function saveDraft() {
    setBusy(true);
    try {
      const response = await fetchImpl("/api/layout-grid", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, blocks }),
      });
      if (!response.ok) throw new Error("draft failed");
      LayoutGridDraftResponseSchema.parse(await response.json());
      setStatus("草稿已保存，下次进入会自动恢复。");
    } catch {
      setStatus("草稿保存失败，可以继续调整，稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      const response = await fetchImpl("/api/layout-grid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, blocks }),
      });
      if (!response.ok) throw new Error("verify failed");
      const parsed = LayoutGridEvidenceResponseSchema.parse(await response.json());
      setEvidence(parsed);
      setStatus(`网格验证完成：${parsed.score}/4 条判据通过。`);
    } catch {
      setStatus("网格验证暂时不可用，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  const contentRatio = {
    width: (config.pageWidthMm - config.marginLeftMm - config.marginRightMm) / config.pageWidthMm,
    height: (config.pageHeightMm - config.marginTopMm - config.marginBottomMm) / config.pageHeightMm,
  };

  return <section aria-labelledby="layout-grid-title" className="min-h-screen bg-[#f3f5ef] px-4 pb-32 pt-5 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="rounded-[2rem] bg-[#17332d] px-6 py-8 text-white sm:px-8">
        <p className="text-xs font-black tracking-[0.2em] text-[#70d1bb]">LAYOUT GRID / 排版栅格微实验</p>
        <h1 className="mt-3 text-3xl font-black tracking-[-0.04em] sm:text-4xl" id="layout-grid-title">先定栅格，再谈好看</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-[#d8ebe5]">
          调整栏行与四边留白，把文字块放到栏位上，然后运行网格验证。四条判据只判断结构是否成立，不评价美丑。
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-[2rem] border border-[#d5dfda] bg-[#fffef9] p-6">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-lg font-black text-[#17332d]">版面预览</h2>
            <p className="text-xs text-[#66716c]">
              {config.pageWidthMm}×{config.pageHeightMm}mm · {config.columns} 栏 × {config.rows} 行
            </p>
          </div>
          <div
            className="relative mx-auto border border-[#c8c3bc] bg-white"
            style={{ aspectRatio: `${config.pageWidthMm} / ${config.pageHeightMm}`, maxWidth: "min(100%, 460px)" }}
          >
            <div
              className="absolute grid gap-[2px]"
              style={{
                top: `${(config.marginTopMm / config.pageHeightMm) * 100}%`,
                right: `${(config.marginRightMm / config.pageWidthMm) * 100}%`,
                bottom: `${(config.marginBottomMm / config.pageHeightMm) * 100}%`,
                left: `${(config.marginLeftMm / config.pageWidthMm) * 100}%`,
                gridTemplateColumns: `repeat(${config.columns}, minmax(0,1fr))`,
                gridTemplateRows: `repeat(${config.rows}, minmax(0,1fr))`,
                outline: "1px dashed #b0aaa2",
              }}
            >
              {blocks.map((block) => {
                const overflow = block.colStart + block.colSpan - 1 > config.columns
                  || block.rowStart + block.rowSpan - 1 > config.rows;
                return <button
                  aria-label={`${ROLE_COPY[block.role].label} ${block.id}`}
                  aria-pressed={block.id === selected?.id}
                  className="overflow-hidden rounded-[3px] text-left text-[8px] leading-tight text-white"
                  key={block.id}
                  onClick={() => setSelectedId(block.id)}
                  style={{
                    gridColumn: `${clamp(block.colStart, 1, config.columns)} / span ${block.colSpan}`,
                    gridRow: `${clamp(block.rowStart, 1, config.rows)} / span ${block.rowSpan}`,
                    background: overflow ? "#c0392b" : ROLE_COPY[block.role].tone,
                    outline: block.id === selected?.id ? "2px solid #17332d" : "none",
                    outlineOffset: "1px",
                  }}
                  type="button"
                >
                  <span className="block px-1 py-0.5" style={{ fontSize: `${Math.min(14, 6 * block.fontScale)}px` }}>
                    {ROLE_COPY[block.role].label}
                  </span>
                </button>;
              })}
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-[#66716c]">
            版心占页面 {(contentRatio.width * 100).toFixed(0)}% × {(contentRatio.height * 100).toFixed(0)}%
            {blocks.some((block) => block.colStart + block.colSpan - 1 > config.columns || block.rowStart + block.rowSpan - 1 > config.rows)
              ? " · 红色块已越出栅格"
              : ""}
          </p>
        </div>

        <div className="space-y-4">
          <fieldset className="rounded-[1.5rem] border border-[#d5dfda] bg-[#fffef9] p-5">
            <legend className="px-2 text-xs font-black tracking-[0.16em] text-[#178b73]">GRID / 栅格</legend>
            <NumberRow label="栏数" max={16} min={2} onChange={(columns) => { setConfig({ ...config, columns }); setEvidence(null); }} value={config.columns} />
            <NumberRow label="行数" max={40} min={4} onChange={(rows) => { setConfig({ ...config, rows }); setEvidence(null); }} value={config.rows} />
            <NumberRow label="上边距 mm" max={80} min={0} onChange={(marginTopMm) => { setConfig({ ...config, marginTopMm }); setEvidence(null); }} value={config.marginTopMm} />
            <NumberRow label="下边距 mm" max={80} min={0} onChange={(marginBottomMm) => { setConfig({ ...config, marginBottomMm }); setEvidence(null); }} value={config.marginBottomMm} />
            <NumberRow label="左边距 mm" max={80} min={0} onChange={(marginLeftMm) => { setConfig({ ...config, marginLeftMm }); setEvidence(null); }} value={config.marginLeftMm} />
            <NumberRow label="右边距 mm" max={80} min={0} onChange={(marginRightMm) => { setConfig({ ...config, marginRightMm }); setEvidence(null); }} value={config.marginRightMm} />
          </fieldset>

          {selected ? <fieldset className="rounded-[1.5rem] border border-[#d5dfda] bg-[#fffef9] p-5">
            <legend className="px-2 text-xs font-black tracking-[0.16em] text-[#178b73]">BLOCK / 文字块</legend>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {blocks.map((block) => <button
                className={`rounded-lg px-2.5 py-1 text-xs font-bold ${block.id === selected.id ? "bg-[#17332d] text-white" : "bg-[#eef3ef] text-[#39433f]"}`}
                key={block.id}
                onClick={() => setSelectedId(block.id)}
                type="button"
              >{ROLE_COPY[block.role].label}</button>)}
            </div>
            <p className="mb-3 text-xs leading-5 text-[#66716c]">{ROLE_COPY[selected.role].hint}</p>
            <NumberRow label="起始栏" max={config.columns} min={1} onChange={(colStart) => updateSelected({ colStart })} value={selected.colStart} />
            <NumberRow label="跨栏数" max={config.columns} min={1} onChange={(colSpan) => updateSelected({ colSpan })} value={selected.colSpan} />
            <NumberRow label="起始行" max={config.rows} min={1} onChange={(rowStart) => updateSelected({ rowStart })} value={selected.rowStart} />
            <NumberRow label="跨行数" max={config.rows} min={1} onChange={(rowSpan) => updateSelected({ rowSpan })} value={selected.rowSpan} />
            <NumberRow label="字号倍率" max={8} min={0.5} onChange={(fontScale) => updateSelected({ fontScale })} step={0.1} value={selected.fontScale} />
          </fieldset> : null}

          <div className="flex gap-2">
            <button className="flex-1 rounded-xl bg-[#17332d] px-4 py-3 text-sm font-black text-white disabled:opacity-50" disabled={busy} onClick={() => void verify()} type="button">
              运行网格验证
            </button>
            <button className="rounded-xl border border-[#d5dfda] bg-white px-4 py-3 text-sm font-bold text-[#39433f] disabled:opacity-50" disabled={busy} onClick={() => void saveDraft()} type="button">
              存草稿
            </button>
          </div>
          {status ? <p aria-live="polite" className="text-xs leading-5 text-[#5c716b]">{status}</p> : null}
        </div>
      </div>

      {evidence ? <div className="rounded-[2rem] border border-[#d5dfda] bg-[#fffef9] p-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-black text-[#17332d]">网格验证结果</h2>
          <p className="text-sm font-black text-[#178b73]">{evidence.score}/4</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {evidence.criteria.map((criterion) => <li className="rounded-2xl border border-[#e2e8e4] p-4" key={criterion.id}>
            <p className="flex items-center gap-2 text-sm font-black text-[#17332d]">
              <span aria-hidden="true">{criterion.passed ? "✓" : "!"}</span>
              {criterion.label}
            </p>
            <p className="mt-1.5 text-xs leading-5 text-[#5c716b]">{criterion.note}</p>
          </li>)}
        </ul>
        <p className="mt-4 text-xs leading-5 text-[#66716c]">
          判据只检查结构是否成立。哪一处该改、值不值得改，去问导师——它能看到这份验证结果。
        </p>
      </div> : null}
    </div>
  </section>;
}

function NumberRow({ label, value, min, max, step = 1, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return <label className="mb-2 flex items-center justify-between gap-3 text-xs text-[#39433f]">
    <span className="shrink-0">{label}</span>
    <input
      className="h-1.5 w-full min-w-0 flex-1 accent-[#17332d]"
      max={max}
      min={min}
      onChange={(event) => onChange(Number(event.target.value))}
      step={step}
      type="range"
      value={value}
    />
    <span className="w-10 shrink-0 text-right font-mono tabular-nums">{step < 1 ? value.toFixed(1) : value}</span>
  </label>;
}
