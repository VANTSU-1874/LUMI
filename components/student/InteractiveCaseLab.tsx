"use client";

import { type MutableRefObject, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

import { touchDesignerOperatorChinese, touchDesignerParameterChinese } from "@/lib/touchdesigner/localization";
import type {
  TouchDesignerCase,
  TouchDesignerCaseLibrary,
  TouchDesignerModule,
  TouchDesignerNodeSnapshot,
  TouchDesignerStructure,
} from "@/lib/touchdesigner/types";

type EffectKind = "GRADIENT" | "AUDIO" | "PIXEL" | "DISTORT" | "BUBBLE" | "GLASS" | "FEEDBACK" | "STRETCH" | "HEATMAP" | "TEXT" | "MATRIX" | "MATERIAL" | "MODEL" | "PARTICLE" | "POINT_CLOUD";
type LabValues = { primary: number; secondary: number; detail: number };
type ControlBlueprint = { key: keyof LabValues; label: string; hint: string; initial: number; preferredParameters: string[] };
type ExperimentProfile = { kind: EffectKind; eyebrow: string; instruction: string; interaction: string; controls: ControlBlueprint[] };
type ControlSource = { node: string; family: string; parameter: string; originalValue: string; localizedParameter: string } | null;

const defaultValues: LabValues = { primary: 58, secondary: 42, detail: 64 };

export function InteractiveCaseLab({ fetchImpl = fetch, onOpenParticleStudio }: { fetchImpl?: typeof fetch; onOpenParticleStudio?: () => void }) {
  const [manifest, setManifest] = useState<TouchDesignerCaseLibrary | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [structure, setStructure] = useState<TouchDesignerStructure | null>(null);
  const [values, setValues] = useState<LabValues>(defaultValues);
  const [running, setRunning] = useState(true);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [structureLoading, setStructureLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetchImpl("/api/touchdesigner-cases", { headers: { accept: "application/json" }, signal: controller.signal });
        const raw: unknown = await response.json();
        if (!response.ok || !isCaseLibrary(raw)) throw new Error(readError(raw, "案例实验目录加载失败"));
        if (controller.signal.aborted) return;
        setManifest(raw);
        const firstCase = raw.modules.flatMap((module) => module.cases)[0];
        if (firstCase) {
          const firstProfile = experimentProfile(firstCase.title);
          setSelectedCaseId(firstCase.id);
          setValues(initialValues(firstProfile.controls));
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "案例实验目录加载失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [fetchImpl]);

  const selected = useMemo(() => findCase(manifest, selectedCaseId), [manifest, selectedCaseId]);
  const activeVersion = selected?.item.versions.find(({ id }) => id === selected.item.activeVersionId) ?? null;
  const profile = useMemo(() => experimentProfile(selected?.item.title ?? ""), [selected?.item.title]);

  useEffect(() => {
    const structureId = activeVersion?.structureId;
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setStructure(null);
      if (!structureId) { setStructureLoading(false); return; }
      setStructureLoading(true);
      try {
        const response = await fetchImpl(`/api/touchdesigner-cases/${encodeURIComponent(structureId)}`, { headers: { accept: "application/json" }, signal: controller.signal });
        const raw: unknown = await response.json();
        if (!response.ok || !isStructure(raw)) throw new Error(readError(raw, "主工程结构加载失败"));
        if (!controller.signal.aborted && sequence === requestSequence.current) setStructure(raw);
      } catch (reason) {
        if (!controller.signal.aborted && sequence === requestSequence.current) setError(reason instanceof Error ? reason.message : "主工程结构加载失败");
      } finally {
        if (!controller.signal.aborted && sequence === requestSequence.current) setStructureLoading(false);
      }
    })();
    return () => controller.abort();
  }, [activeVersion?.structureId, fetchImpl]);

  const sources = useMemo(() => findControlSources(structure, profile.controls), [profile.controls, structure]);
  const signalChain = useMemo(() => deriveSignalChain(structure, profile.kind), [profile.kind, structure]);
  const filteredModules = useMemo(() => filterModules(manifest?.modules ?? [], query), [manifest?.modules, query]);

  function chooseCase(item: TouchDesignerCase) {
    const nextProfile = experimentProfile(item.title);
    setSelectedCaseId(item.id);
    setValues(initialValues(nextProfile.controls));
    setRunning(true);
    setError("");
  }

  if (loading) return <section className="grid min-h-[calc(100vh-2rem)] place-items-center bg-[#09100e] text-white" aria-busy="true"><p aria-live="polite">正在启动 23 个实时实验…</p></section>;
  if (!manifest || !selected || !activeVersion) return <section className="grid min-h-[calc(100vh-2rem)] place-items-center bg-[#09100e] p-8 text-white"><div className="text-center"><h1 className="text-xl font-black">实时实验台暂时不可用</h1><p className="mt-2 text-sm text-white/55" role="alert">{error || "没有找到可运行的主工程"}</p></div></section>;

  const isParticleCase = profile.kind === "PARTICLE";

  return <section className="min-h-[calc(100vh-2rem)] bg-[#09100e] pb-28 text-white" aria-labelledby="experiment-title">
    <header className="border-b border-[#73d7ba]/15 bg-[#0c1512] px-5 py-5 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div><p className="text-[10px] font-black tracking-[0.23em] text-[#73d7ba]">TOUCHDESIGNER / LIVE LEARNING LAB</p><h1 className="mt-1 text-2xl font-black sm:text-3xl" id="experiment-title">实时节点实验台</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-white/58">这里不是案例档案。每个实验依据主工程的节点、连线和参数做浏览器实时教学重建；拖动画面、改变参数，立即观察输入如何穿过网络并改变输出。</p></div>
        <div className="flex items-center gap-2 rounded-2xl border border-[#73d7ba]/20 bg-[#73d7ba]/[.07] px-4 py-3"><span className="relative flex size-3"><span className={`absolute inline-flex size-full rounded-full bg-[#73d7ba] ${running ? "animate-ping" : ""}`} /><span className="relative inline-flex size-3 rounded-full bg-[#73d7ba]" /></span><div><strong className="block text-xs">{running ? "实时运算中" : "实验已暂停"}</strong><span className="text-[9px] text-white/40">{manifest.totals.cases} 个案例全部可操作</span></div></div>
      </div>
    </header>

    <div className="grid min-h-[calc(100vh-10rem)] xl:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="border-b border-white/10 bg-[#0f1815] p-4 xl:border-b-0 xl:border-r" aria-label="实时实验目录">
        <label className="block text-[10px] font-black tracking-[0.16em] text-white/40" htmlFor="experiment-search">寻找实验</label>
        <input className="mt-2 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-sm outline-none placeholder:text-white/25 focus:border-[#73d7ba]/50" id="experiment-search" onChange={(event) => setQuery(event.target.value)} placeholder="声音、扭曲、文字…" value={query} />
        <nav className="mt-4 max-h-[calc(100vh-14rem)] space-y-4 overflow-y-auto pr-1" aria-label="全部可交互案例">
          {filteredModules.map((module) => <div key={module.id}><h2 className="mb-1.5 text-[10px] font-black text-[#78938b]">{module.title}</h2><ul className="space-y-1">{module.cases.map((item) => <li key={item.id}><button aria-current={selected.item.id === item.id ? "page" : undefined} className={`group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition ${selected.item.id === item.id ? "bg-[#245244] text-[#c6f3e5]" : "text-white/58 hover:bg-white/[.05] hover:text-white"}`} onClick={() => chooseCase(item)} type="button"><span className={`grid size-7 shrink-0 place-items-center rounded-lg border text-[10px] ${selected.item.id === item.id ? "border-[#75d5b9]/40 bg-[#75d5b9]/10" : "border-white/10 bg-white/[.025]"}`}>{effectGlyph(experimentProfile(item.title).kind)}</span><span className="min-w-0"><strong className="block truncate text-[11px]">{item.title}</strong><span className="mt-0.5 block text-[8px] opacity-45">实时实验 · 主工程</span></span></button></li>)}</ul></div>)}
        </nav>
      </aside>

      <main className="min-w-0 p-4 sm:p-6">
        <div className="mx-auto max-w-[96rem] space-y-4">
          <section className="overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#111a17]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 px-5 py-5 sm:px-6">
              <div><p className="text-[9px] font-black tracking-[0.18em] text-[#73d7ba]">{selected.module.title} / {profile.eyebrow}</p><h2 className="mt-1 text-2xl font-black" id="selected-experiment-title">{selected.item.title}</h2><p className="mt-2 max-w-3xl text-xs leading-5 text-white/48">{profile.instruction}</p></div>
              <div className="flex flex-wrap gap-2"><button aria-pressed={!running} className="rounded-xl border border-white/10 bg-white/[.045] px-4 py-2 text-xs font-black hover:bg-white/[.08]" onClick={() => setRunning((current) => !current)} type="button">{running ? "暂停画面" : "继续运行"}</button><button className="rounded-xl border border-[#73d7ba]/25 bg-[#173a31] px-4 py-2 text-xs font-black text-[#aee8d6] hover:bg-[#1d493d]" onClick={() => setValues(initialValues(profile.controls))} type="button">复位参数</button>{isParticleCase && onOpenParticleStudio ? <button className="rounded-xl border-b-4 border-[#a86b00] bg-[#ffbf47] px-4 py-2 text-xs font-black text-[#4d3400]" onClick={onOpenParticleStudio} type="button">进入节点级深度实验 →</button> : null}</div>
            </div>

            <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="min-w-0 border-b border-white/10 p-4 sm:p-5 xl:border-b-0 xl:border-r">
                <EffectCanvas kind={profile.kind} running={running} title={selected.item.title} values={values} />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-white/38"><span>交互方式：{profile.interaction}</span><span className="rounded-full border border-[#73d7ba]/15 bg-[#73d7ba]/[.06] px-2.5 py-1 text-[#8fd8c4]">依据 {activeVersion.fileLabel}.toe 主工程结构</span></div>
              </div>

              <aside className="space-y-4 p-4 sm:p-5" aria-label="实时参数控制">
                <div><p className="text-[9px] font-black tracking-[0.18em] text-white/35">LIVE PARAMETERS</p><h3 className="mt-1 font-black">改变参数，观察因果</h3><p className="mt-1 text-[10px] leading-4 text-white/38">滑杆控制浏览器重建；下方同时标出该控制所依据的真实节点参数与原值。</p></div>
                {profile.controls.map((control, index) => <ParameterControl control={control} key={control.key} onChange={(value) => setValues((current) => ({ ...current, [control.key]: value }))} source={sources[index] ?? null} value={values[control.key]} />)}
                {structureLoading ? <p className="rounded-xl border border-white/10 bg-white/[.035] p-3 text-[10px] text-white/45">正在匹配主工程参数…</p> : null}
                {error ? <p className="rounded-xl border border-[#ff806d]/25 bg-[#49251f] p-3 text-[10px] text-[#ffc1b6]" role="alert">{error}</p> : null}
              </aside>
            </div>
          </section>

          <section className="rounded-[1.4rem] border border-white/10 bg-[#101815] p-4 sm:p-5" aria-labelledby="signal-chain-title">
            <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-[9px] font-black tracking-[0.18em] text-white/35">REAL PROJECT BASIS</p><h3 className="mt-1 font-black" id="signal-chain-title">主工程中的关键作用链</h3></div><p className="text-[9px] text-white/35">完整节点、版本和备份请到“案例库”查看</p></div>
            <ol className="mt-4 grid gap-2 md:grid-cols-4">{signalChain.map((node, index) => <li className="relative rounded-xl border border-white/10 bg-white/[.035] p-3" key={node.id}><span className="text-[8px] font-black text-[#73d7ba]">0{index + 1} · {node.family}</span><strong className="mt-1 block text-xs">{node.name}</strong><span className="mt-1 block text-[9px] text-white/42">{touchDesignerOperatorChinese(node.operatorType, node.family).label}</span>{index < signalChain.length - 1 ? <span aria-hidden="true" className="absolute -right-2.5 top-1/2 z-10 hidden text-[#73d7ba] md:block">→</span> : null}</li>)}</ol>
            {!structureLoading && signalChain.length === 0 ? <p className="mt-4 text-xs text-white/38">这个主工程暂未提取到可解释的作用链。</p> : null}
          </section>
        </div>
      </main>
    </div>
  </section>;
}

function ParameterControl({ control, source, value, onChange }: { control: ControlBlueprint; source: ControlSource; value: number; onChange: (value: number) => void }) {
  return <label className="block rounded-xl border border-white/10 bg-white/[.035] p-3"><span className="flex items-center justify-between gap-3"><strong className="text-xs">{control.label}</strong><output className="font-mono text-xs font-black text-[#ffca5c]">{value}</output></span><input aria-label={control.label} className="mt-2 w-full accent-[#73d7ba]" max="100" min="0" onChange={(event) => onChange(Number(event.target.value))} type="range" value={value} /><span className="mt-1 block text-[9px] leading-4 text-white/38">{control.hint}</span>{source ? <span className="mt-2 block rounded-lg bg-black/20 px-2 py-1.5 text-[8px] leading-3 text-[#8fcbbb]">真实依据：{source.family} {source.node} / {source.localizedParameter} <span className="text-white/30">({source.parameter}，原值 {source.originalValue})</span></span> : <span className="mt-2 block text-[8px] text-white/25">该工程暂未找到可安全映射的数值参数</span>}</label>;
}

function EffectCanvas({ kind, values, running, title }: { kind: EffectKind; values: LabValues; running: boolean; title: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointer = useRef({ x: 0.5, y: 0.5, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let context: CanvasRenderingContext2D | null = null;
    try { context = canvas.getContext("2d"); } catch { context = null; }
    if (!context) return;
    const ctx = context;
    let frame = 0;
    const startedAt = performance.now();
    const seed = titleSeed(title);

    const draw = (time: number) => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(300, rect.width || 760);
      const height = Math.max(320, rect.height || 520);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.floor(width * ratio);
      const pixelHeight = Math.floor(height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const seconds = (time - startedAt) / 1000;
      drawEffect(ctx, width, height, kind, values, running ? seconds : 0.7, seed, pointer.current);
      if (running) frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [kind, running, title, values]);

  return <div className="relative aspect-[16/10] min-h-[20rem] overflow-hidden rounded-2xl border border-[#73d7ba]/15 bg-[#050a09] shadow-[inset_0_0_80px_rgba(80,210,175,.06)]"><canvas aria-label={`${title}实时交互效果`} className="size-full touch-none" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); pointer.current.active = true; updatePointer(event, pointer); }} onPointerLeave={() => { pointer.current.active = false; }} onPointerMove={(event) => updatePointer(event, pointer)} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); pointer.current.active = false; }} ref={canvasRef} /><div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full border border-white/10 bg-black/55 px-3 py-1.5 text-[9px] font-black backdrop-blur"><span className={`size-1.5 rounded-full ${running ? "bg-[#73d7ba]" : "bg-[#ffca5c]"}`} />{running ? "实时输出" : "输出冻结"}</div><p className="pointer-events-none absolute inset-x-3 bottom-3 rounded-xl bg-black/55 px-3 py-2 text-[9px] text-white/55 backdrop-blur">在画面中移动或按住拖动，给当前网络注入位置与力度。</p></div>;
}

function updatePointer(event: ReactPointerEvent<HTMLCanvasElement>, pointer: MutableRefObject<{ x: number; y: number; active: boolean }>) {
  const rect = event.currentTarget.getBoundingClientRect();
  pointer.current.x = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
  pointer.current.y = clamp((event.clientY - rect.top) / Math.max(rect.height, 1), 0, 1);
}

function drawEffect(ctx: CanvasRenderingContext2D, width: number, height: number, kind: EffectKind, values: LabValues, time: number, seed: number, pointer: { x: number; y: number; active: boolean }) {
  const primary = values.primary / 100;
  const secondary = values.secondary / 100;
  const detail = values.detail / 100;
  const px = pointer.x * width;
  const py = pointer.y * height;
  const hue = seed % 360;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = `hsl(${(hue + 170) % 360} 28% 5%)`;
  ctx.fillRect(0, 0, width, height);

  if (kind === "GRADIENT") {
    for (let index = 0; index < 6; index += 1) {
      const x = (0.18 + index * 0.15 + Math.sin(time * (0.25 + secondary) + index) * 0.08) * width;
      const y = (0.5 + Math.cos(time * 0.35 + index * 1.4) * 0.3) * height;
      const radius = width * (0.18 + primary * 0.18);
      const gradient = ctx.createRadialGradient(pointer.active ? (x + px) / 2 : x, pointer.active ? (y + py) / 2 : y, 0, x, y, radius);
      gradient.addColorStop(0, `hsla(${(hue + index * 47) % 360} 90% 63% / .86)`);
      gradient.addColorStop(1, `hsla(${(hue + index * 47) % 360} 90% 30% / 0)`);
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
    }
    return;
  }

  if (kind === "AUDIO") {
    const bars = Math.floor(24 + detail * 42);
    for (let index = 0; index < bars; index += 1) {
      const x = index / bars * width;
      const wave = Math.sin(index * 0.58 + time * (2 + secondary * 7)) * 0.5 + 0.5;
      const level = (0.08 + wave * primary * 0.72) * height * (pointer.active ? 1.18 : 1);
      ctx.fillStyle = `hsla(${(hue + index * 3) % 360} 85% 62% / .82)`;
      ctx.fillRect(x + 2, (height - level) / 2, Math.max(2, width / bars - 5), level);
    }
    ctx.strokeStyle = "rgba(255,255,255,.82)"; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = 0; x <= width; x += 6) { const y = height / 2 + Math.sin(x * 0.035 + time * 8) * height * primary * 0.14; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke(); return;
  }

  if (kind === "PIXEL") {
    const size = Math.max(5, Math.floor(28 - detail * 21));
    for (let y = 0; y < height; y += size) for (let x = 0; x < width; x += size) {
      const noise = Math.sin((x + seed) * 12.9898 + (y + time * 80 * secondary) * 78.233) * 43758.5453;
      const value = noise - Math.floor(noise);
      if (value > 1 - primary * 0.72) { ctx.fillStyle = `hsla(${(hue + value * 130) % 360} 85% ${48 + value * 30}% / .9)`; ctx.fillRect(x, y, size - 1, size - 1); }
    }
    return;
  }

  if (kind === "DISTORT" || kind === "STRETCH") {
    ctx.lineWidth = 1 + detail * 2;
    const lines = Math.floor(22 + detail * 40);
    for (let row = 0; row < lines; row += 1) {
      const baseY = row / Math.max(lines - 1, 1) * height;
      ctx.beginPath(); ctx.strokeStyle = `hsla(${(hue + row * 4) % 360} 75% 62% / .68)`;
      for (let x = 0; x <= width; x += 8) {
        const pointerForce = pointer.active ? Math.exp(-Math.hypot(x - px, baseY - py) / 150) : 0;
        const offset = Math.sin(x * 0.018 + row * 0.31 + time * (1.5 + secondary * 5)) * (10 + primary * 70) + pointerForce * (kind === "STRETCH" ? (px - width / 2) * 0.55 : 90);
        const y = baseY + offset * (kind === "STRETCH" ? Math.sin(row * 0.22) : 0.38);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    return;
  }

  if (kind === "BUBBLE") {
    const count = Math.floor(18 + detail * 42);
    for (let index = 0; index < count; index += 1) {
      const phase = seed * 0.01 + index * 2.41;
      const x = ((Math.sin(phase * 1.3) + 1) / 2 * width + Math.sin(time * secondary + phase) * 25 + (pointer.active ? (px - width / 2) * 0.08 : 0)) % width;
      const y = height - ((time * (22 + primary * 90) + index * height / count) % (height + 80));
      const radius = 7 + ((index * 17) % 38) * (0.45 + primary);
      const gradient = ctx.createRadialGradient(x - radius * .3, y - radius * .35, 1, x, y, radius);
      gradient.addColorStop(0, "rgba(255,255,255,.72)"); gradient.addColorStop(.2, `hsla(${hue} 85% 70% / .22)`); gradient.addColorStop(1, `hsla(${(hue + 90) % 360} 80% 45% / .04)`);
      ctx.fillStyle = gradient; ctx.strokeStyle = `hsla(${(hue + index * 3) % 360} 80% 75% / .45)`; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    return;
  }

  if (kind === "GLASS") {
    const columns = Math.floor(6 + detail * 10); const cell = width / columns;
    for (let column = 0; column < columns; column += 1) for (let row = 0; row < Math.ceil(height / cell); row += 1) {
      const cx = column * cell + cell / 2; const cy = row * cell + cell / 2;
      const wobble = Math.sin(time * (1 + secondary * 3) + column * .8 + row * .7) * primary * cell * .32;
      const dx = pointer.active ? (px - cx) * .08 : 0; const dy = pointer.active ? (py - cy) * .08 : 0;
      ctx.fillStyle = `hsla(${(hue + column * 11 + row * 17) % 360} 70% ${25 + (row % 3) * 9}% / .45)`;
      ctx.strokeStyle = "rgba(255,255,255,.14)"; ctx.beginPath(); ctx.roundRect(cx - cell * .45 + wobble + dx, cy - cell * .45 - wobble * .35 + dy, cell * .9, cell * .9, cell * .18); ctx.fill(); ctx.stroke();
    }
    return;
  }

  if (kind === "FEEDBACK") {
    const rings = Math.floor(18 + detail * 40); ctx.translate(pointer.active ? px : width / 2, pointer.active ? py : height / 2);
    for (let index = rings; index > 0; index -= 1) { const scale = index / rings; ctx.save(); ctx.rotate(time * secondary * .18 + index * primary * .035); ctx.strokeStyle = `hsla(${(hue + index * 8) % 360} 85% 62% / ${0.08 + scale * .62})`; ctx.lineWidth = 1 + scale * 3; const w = width * scale * .62; const h = height * scale * .62; ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.restore(); }
    return;
  }

  if (kind === "HEATMAP") {
    const centerX = pointer.active ? px : width * (.5 + Math.sin(time * .7) * .14); const centerY = pointer.active ? py : height * (.5 + Math.cos(time * .55) * .12);
    const steps = Math.floor(8 + detail * 22);
    for (let index = steps; index > 0; index -= 1) { const ratio = index / steps; ctx.fillStyle = `hsl(${(hue + ratio * 170 + time * secondary * 20) % 360} 88% ${43 + ratio * 16}%)`; ctx.beginPath(); const wobble = Math.sin(index * 1.7 + time * 2) * primary * 12; ctx.ellipse(centerX + wobble, centerY - wobble * .4, width * ratio * .42, height * ratio * .38, Math.sin(time * .3) * .2, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "#08100d"; ctx.beginPath(); ctx.arc(centerX, centerY, 6 + primary * 18, 0, Math.PI * 2); ctx.fill(); return;
  }

  if (kind === "TEXT" || kind === "MATRIX") {
    const glyphs = "触映交互设计TOUCH0123456789"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const columns = Math.floor(8 + detail * 16); const rows = Math.floor(6 + detail * 11);
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const phase = column * .65 + row * .44 + time * (1 + secondary * 4); const radius = kind === "MATRIX" ? Math.min(width, height) * (.08 + row / rows * .47) : 0;
      const x = kind === "MATRIX" ? width / 2 + Math.cos(phase + column / columns * Math.PI * 2) * radius : (column + .5) / columns * width + Math.sin(phase) * primary * 18;
      const y = kind === "MATRIX" ? height / 2 + Math.sin(phase + column / columns * Math.PI * 2) * radius : (row + .5) / rows * height + Math.cos(phase) * primary * 12;
      const proximity = pointer.active ? Math.max(0, 1 - Math.hypot(x - px, y - py) / 170) : 0;
      ctx.font = `800 ${9 + detail * 13 + proximity * 16}px sans-serif`; ctx.fillStyle = `hsla(${(hue + column * 7 + row * 10) % 360} 80% ${58 + proximity * 20}% / ${.35 + primary * .6})`; ctx.fillText(glyphs[(column + row * columns + seed) % glyphs.length], x, y);
    }
    return;
  }

  if (kind === "MATERIAL" || kind === "MODEL") {
    const sides = Math.floor(3 + detail * 9); const count = Math.floor(5 + primary * 16);
    for (let index = 0; index < count; index += 1) { const orbit = (index + 1) / count; const cx = width / 2 + Math.cos(time * secondary + index * 2.4) * width * orbit * .42; const cy = height / 2 + Math.sin(time * secondary * 1.3 + index * 1.7) * height * orbit * .36; const radius = 16 + (1 - orbit) * 54; ctx.beginPath(); for (let side = 0; side < sides; side += 1) { const angle = side / sides * Math.PI * 2 + time * (.2 + secondary); const x = cx + Math.cos(angle) * radius; const y = cy + Math.sin(angle) * radius; if (side === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); const gradient = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius); gradient.addColorStop(0, `hsl(${(hue + index * 18) % 360} 85% 72%)`); gradient.addColorStop(1, `hsl(${(hue + 110 + index * 8) % 360} 65% 22%)`); ctx.fillStyle = gradient; ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.fill(); ctx.stroke(); }
    return;
  }

  const points = Math.floor(180 + detail * 900);
  for (let index = 0; index < points; index += 1) {
    const angle = index * 2.399 + time * (.1 + secondary * .55); const radius = Math.sqrt(index / points) * Math.min(width, height) * .44; const depth = Math.sin(index * .17 + time * (1 + secondary * 3)) * primary;
    const x = (pointer.active ? px : width / 2) + Math.cos(angle) * radius * (kind === "POINT_CLOUD" ? 1 + depth * .35 : 1); const y = (pointer.active ? py : height / 2) + Math.sin(angle) * radius * .66 + depth * height * .16;
    const size = (kind === "POINT_CLOUD" ? 1.2 : 1.8) + (depth + 1) * 1.8; ctx.fillStyle = `hsla(${(hue + index * .22 + depth * 45) % 360} 86% ${55 + depth * 18}% / .82)`; ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
  }
}

function experimentProfile(title: string): ExperimentProfile {
  const normalized = title.toLowerCase();
  let kind: EffectKind = "MODEL";
  if (normalized.includes("point cloud")) kind = "POINT_CLOUD";
  else if (title.includes("图片粒子")) kind = "PARTICLE";
  else if (title.includes("渐变")) kind = "GRADIENT";
  else if (title.includes("声音驱动")) kind = "AUDIO";
  else if (title.includes("随机像素") || title.includes("随机构成")) kind = "PIXEL";
  else if (title.includes("水流气泡")) kind = "BUBBLE";
  else if (title.includes("玻璃")) kind = "GLASS";
  else if (title.includes("反馈")) kind = "FEEDBACK";
  else if (title.includes("热力")) kind = "HEATMAP";
  else if (title.includes("拉伸")) kind = "STRETCH";
  else if (title.includes("扭曲")) kind = "DISTORT";
  else if (title.includes("螺旋") || title.includes("矩阵")) kind = "MATRIX";
  else if (title.includes("文字")) kind = "TEXT";
  else if (title.includes("材质")) kind = "MATERIAL";
  else if (title.includes("模型")) kind = "MODEL";
  const blueprints = controlBlueprints(kind, title);
  return { kind, eyebrow: effectName(kind), instruction: effectInstruction(kind), interaction: effectInteraction(kind), controls: blueprints };
}

function controlBlueprints(kind: EffectKind, title: string): ControlBlueprint[] {
  const speed = { key: "secondary" as const, label: title.includes("声音") ? "输入声压" : "变化速度", hint: title.includes("声音") ? "模拟 Audio Device In 进入网络的瞬时幅度。" : "改变时间信号进入动画参数的速度。", initial: title.includes("声音") ? 66 : 42, preferredParameters: ["speed", "rate", "phase", "period", "tz", "timescale", "value"] };
  const detail = { key: "detail" as const, label: kind === "PIXEL" ? "像素颗粒" : kind === "MATRIX" ? "矩阵密度" : kind === "PARTICLE" || kind === "POINT_CLOUD" ? "点云密度" : "结构细节", hint: "控制当前网络被采样、复制或分层的数量。", initial: 64, preferredParameters: ["rows", "cols", "resolutionw", "resolutionh", "size", "samples", "period", "width", "height"] };
  const primaryLabels: Record<EffectKind, [string, string, number]> = {
    GRADIENT: ["颜色叠加强度", "观察不同色层合成后如何改变画面。", 62], AUDIO: ["响应幅度", "决定声压变化被放大到视觉参数的程度。", 58], PIXEL: ["随机阈值", "决定多少随机采样点被保留。", 54], DISTORT: ["扭曲强度", "控制位移信号推动原图像素的距离。", 57], BUBBLE: ["气泡尺度", "控制折射区域的半径与浮动幅度。", 55], GLASS: ["折射力度", "控制玻璃块对原画面的位移量。", 64], FEEDBACK: ["反馈保留", "控制上一帧回流到下一帧的残留程度。", 72], STRETCH: ["拉伸距离", "控制位置输入把画面延展的范围。", 63], HEATMAP: ["等高阈值", "控制数值场被分割成色阶的范围。", 56], TEXT: ["文字变形", "控制字形位置、缩放或旋转的偏移量。", 58], MATRIX: ["阵列半径", "控制文字或图形从中心展开的距离。", 62], MATERIAL: ["材质反差", "控制明暗、粗糙与高光之间的对比。", 57], MODEL: ["模型尺度", "控制生成几何的展开幅度。", 61], PARTICLE: ["粒子起伏", "控制颜色数据转成 Z 轴位移后的强度。", 58], POINT_CLOUD: ["空间深度", "控制点云沿 Z 轴展开的距离。", 66],
  };
  const [label, hint, initial] = primaryLabels[kind];
  const primary: ControlBlueprint = { key: "primary", label, hint, initial, preferredParameters: ["amp", "amplitude", "strength", "gain", "scale", "displaceweight", "opacity", "brightness", "contrast", "level", "value"] };
  return [primary, speed, detail];
}

function findControlSources(structure: TouchDesignerStructure | null, controls: ControlBlueprint[]): ControlSource[] {
  if (!structure) return controls.map(() => null);
  const candidates = structure.nodes.flatMap((node) => node.parameters.map((parameter) => ({ node, parameter, depth: node.path.split("/").length }))).filter(({ parameter }) => /^[-+]?\d*\.?\d+(?:e[-+]?\d+)?(?:\s|$)/i.test(parameter.value.trim())).sort((a, b) => a.depth - b.depth || a.node.path.localeCompare(b.node.path));
  const used = new Set<string>();
  return controls.map((control) => {
    const match = candidates.find(({ node, parameter }) => !used.has(`${node.id}:${parameter.name}`) && control.preferredParameters.some((candidate) => parameter.name.toLowerCase().includes(candidate))) ?? candidates.find(({ node, parameter }) => !used.has(`${node.id}:${parameter.name}`));
    if (!match) return null;
    used.add(`${match.node.id}:${match.parameter.name}`);
    return { node: match.node.name, family: match.node.family, parameter: match.parameter.name, originalValue: match.parameter.value.split(/\s+/)[0], localizedParameter: touchDesignerParameterChinese(match.parameter.name) };
  });
}

function deriveSignalChain(structure: TouchDesignerStructure | null, kind: EffectKind): TouchDesignerNodeSnapshot[] {
  if (!structure) return [];
  const preferences: Record<EffectKind, string[]> = {
    GRADIENT: ["moviefilein", "ramp", "level", "add", "comp", "out"], AUDIO: ["audiodevin", "analyze", "filter", "math", "level", "out"], PIXEL: ["noise", "resolution", "threshold", "composite", "out"], DISTORT: ["audiodevin", "noise", "displace", "math", "comp", "out"], BUBBLE: ["noise", "blur", "displace", "level", "out"], GLASS: ["noise", "refract", "displace", "feedback", "out"], FEEDBACK: ["feedback", "transform", "level", "composite", "out"], STRETCH: ["mousein", "audiodevin", "trail", "transform", "feedback", "out"], HEATMAP: ["noise", "math", "lookup", "level", "out"], TEXT: ["text", "transform", "composite", "render", "out"], MATRIX: ["text", "grid", "copy", "transform", "render", "out"], MATERIAL: ["noise", "normal", "phong", "render", "out"], MODEL: ["box", "sphere", "copy", "geo", "render", "out"], PARTICLE: ["moviefilein", "grid", "topto", "merge", "geo", "render"], POINT_CLOUD: ["pointfilein", "topto", "merge", "geo", "render", "out"],
  };
  const shallowNodes = structure.nodes.filter((node) => !node.annotation && node.operatorType !== "annotate" && node.path.split("/").length <= 3);
  const selected: TouchDesignerNodeSnapshot[] = [];
  for (const preferred of preferences[kind]) {
    const match = shallowNodes.find((node) => !selected.includes(node) && (node.operatorType.toLowerCase().includes(preferred) || node.name.toLowerCase().includes(preferred)));
    if (match) selected.push(match);
    if (selected.length === 4) break;
  }
  if (selected.length < 4) for (const node of shallowNodes) { if (!selected.includes(node) && !selected.some((item) => item.operatorType === node.operatorType)) selected.push(node); if (selected.length === 4) break; }
  return selected;
}

function effectName(kind: EffectKind) { return ({ GRADIENT: "颜色合成", AUDIO: "声音驱动", PIXEL: "随机采样", DISTORT: "位移扭曲", BUBBLE: "流体折射", GLASS: "玻璃折射", FEEDBACK: "帧反馈", STRETCH: "位置拉伸", HEATMAP: "数值等高", TEXT: "文字变形", MATRIX: "矩阵生成", MATERIAL: "程序材质", MODEL: "几何生成", PARTICLE: "图像粒子", POINT_CLOUD: "三维点云" } satisfies Record<EffectKind, string>)[kind]; }
function effectInstruction(kind: EffectKind) { return ({ GRADIENT: "多路颜色信号持续叠加；改变强度可观察合成关系。", AUDIO: "模拟声音幅度经过分析、平滑与映射后驱动画面。", PIXEL: "随机信号经过阈值筛选后形成可控的像素构成。", DISTORT: "动态数值作为位移场，推动原画面产生错位与扭曲。", BUBBLE: "流动噪声与折射区域共同形成水流和气泡质感。", GLASS: "分块位移与动态折射共同制造玻璃扭曲。", FEEDBACK: "上一帧重新进入当前网络，累积为不断延伸的视觉轨迹。", STRETCH: "位置或声音输入被放大为连续的画面拉伸。", HEATMAP: "连续数值场被切分为色阶，形成等高热力结构。", TEXT: "文字 TOP 经过位置、缩放与合成节点形成动态字形。", MATRIX: "字形或图形被复制到矩阵，再由时间信号控制排列。", MATERIAL: "程序纹理与光照参数共同决定表面质感。", MODEL: "基础几何经过复制、变形和渲染形成生成模型。", PARTICLE: "图像颜色与网格位置被拆为数据，驱动 Instancing 粒子。", POINT_CLOUD: "点数据映射到三维坐标，经相机与材质渲染为空间点云。" } satisfies Record<EffectKind, string>)[kind]; }
function effectInteraction(kind: EffectKind) { return kind === "AUDIO" ? "拖动位置改变声场中心，调节“输入声压”观察响应" : kind === "STRETCH" || kind === "DISTORT" ? "在画面中按住拖动，直接注入位置位移" : "在画面中移动或按住拖动，改变作用中心"; }
function effectGlyph(kind: EffectKind) { return ({ GRADIENT: "◐", AUDIO: "⌁", PIXEL: "▦", DISTORT: "≋", BUBBLE: "○", GLASS: "◇", FEEDBACK: "∞", STRETCH: "↔", HEATMAP: "◎", TEXT: "Aa", MATRIX: "⌗", MATERIAL: "◈", MODEL: "⬡", PARTICLE: "⁙", POINT_CLOUD: "∴" } satisfies Record<EffectKind, string>)[kind]; }
function titleSeed(title: string) { return [...title].reduce((sum, character, index) => (sum + character.charCodeAt(0) * (index + 7)) % 9973, 0); }
function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }
function initialValues(controls: ControlBlueprint[]) { return controls.reduce<LabValues>((result, control) => ({ ...result, [control.key]: control.initial }), defaultValues); }

function filterModules(courseModules: TouchDesignerModule[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return courseModules;
  return courseModules.map((courseModule) => ({ ...courseModule, cases: courseModule.cases.filter((item) => `${courseModule.title} ${item.title}`.toLowerCase().includes(needle)) })).filter((courseModule) => courseModule.cases.length > 0);
}
function findCase(manifest: TouchDesignerCaseLibrary | null, caseId: string) { for (const courseModule of manifest?.modules ?? []) { const item = courseModule.cases.find(({ id }) => id === caseId); if (item) return { module: courseModule, item }; } return null; }
function isCaseLibrary(value: unknown): value is TouchDesignerCaseLibrary { if (!value || typeof value !== "object") return false; const candidate = value as Partial<TouchDesignerCaseLibrary>; return candidate.schemaVersion === 1 && Array.isArray(candidate.modules) && Boolean(candidate.totals); }
function isStructure(value: unknown): value is TouchDesignerStructure { if (!value || typeof value !== "object") return false; const candidate = value as Partial<TouchDesignerStructure>; return typeof candidate.id === "string" && Array.isArray(candidate.nodes) && Array.isArray(candidate.edges) && Array.isArray(candidate.networks); }
function readError(value: unknown, fallback: string) { return typeof value === "object" && value && "error" in value && typeof value.error === "string" ? value.error : fallback; }
