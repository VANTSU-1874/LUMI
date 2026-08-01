"use client";

import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type NodeProps,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import type { DragEventHandler } from "react";

import {
  STUDIO_FAMILIES,
  familyPurpose,
  type NodeCatalogEntry,
  type NodeCatalogResponse,
  type StudioFamily,
} from "@/lib/touchdesigner/node-catalog-shared";
import { touchDesignerFamilyChinese } from "@/lib/touchdesigner/localization";

import {
  browserParameters,
  disconnectEffect,
  FAMILY_COLORS,
  nodeIo,
  nodeLearningAction,
  type PreviewSettings,
  type StudioFlowEdge,
  type StudioFlowNode,
  type StudioNodeData,
} from "./node-learning-studio-model";

const NODE_TYPES = { studio: StudioNodeCard };

export function NodeCatalogPanel({
  catalog,
  error,
  family,
  query,
  entries,
  onFamilyChange,
  onQueryChange,
  onAdd,
}: {
  catalog: NodeCatalogResponse | null;
  error: string;
  family: StudioFamily;
  query: string;
  entries: NodeCatalogEntry[];
  onFamilyChange: (family: StudioFamily) => void;
  onQueryChange: (query: string) => void;
  onAdd: (entry: NodeCatalogEntry) => void;
}) {
  return <aside className="border-r border-white/[.08] bg-[#111b18] p-3" aria-label="TouchDesigner 节点库">
    <div className="flex items-end justify-between gap-2">
      <div><p className="text-[9px] font-black tracking-[.18em] text-white/35">OP CREATE DIALOG</p><h2 className="mt-1 font-black">七类节点库</h2></div>
      <span className="rounded-lg bg-white/[.05] px-2 py-1 text-[9px] text-white/45">{catalog?.totals.courseEntries ?? "—"} 种课程节点</span>
    </div>
    <label className="mt-3 block text-[10px] font-bold text-white/48" htmlFor="node-search">搜索英文名、中文名或作用</label>
    <input className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-xs outline-none placeholder:text-white/25 focus:border-[#73d7ba]" id="node-search" onChange={(event) => onQueryChange(event.target.value)} placeholder="例如 Audio、声音、位移…" value={query} />
    <div className="mt-3 grid grid-cols-4 gap-1.5" role="tablist" aria-label="节点家族">
      {STUDIO_FAMILIES.map((item) => {
        const count = catalog?.entries.filter((entry) => entry.family === item).length ?? 0;
        const tone = FAMILY_COLORS[item];
        return <button aria-selected={family === item} className="rounded-lg border px-1.5 py-2 text-center transition" key={item} onClick={() => onFamilyChange(item)} role="tab" style={{ borderColor: family === item ? tone.color : "rgba(255,255,255,.08)", background: family === item ? tone.surface : "rgba(255,255,255,.025)", color: family === item ? tone.color : "rgba(255,255,255,.55)" }} type="button"><strong className="block text-[10px]">{item}</strong><span className="text-[8px] opacity-60">{count}</span></button>;
      })}
    </div>
    <div className="mt-3 rounded-xl border border-white/[.07] bg-black/15 px-3 py-2.5">
      <p className="text-[10px] font-black" style={{ color: FAMILY_COLORS[family].color }}>{touchDesignerFamilyChinese[family]} · {family}</p>
      <p className="mt-1 text-[10px] leading-4 text-white/42">{familyPurpose(family)}。同色节点可直接连线。</p>
    </div>
    {error ? <p className="mt-4 rounded-xl bg-red-950/35 p-3 text-xs text-red-200" role="alert">{error}</p> : null}
    <div className="mt-3 max-h-[510px] space-y-1.5 overflow-y-auto pr-1" role="tabpanel">
      {entries.map((entry) => <button className="group flex w-full items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.025] p-2.5 text-left transition hover:border-white/20 hover:bg-white/[.06]" draggable key={entry.id} onClick={() => onAdd(entry)} onDragStart={(event) => { event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData("application/touchdesigner-node", entry.id); }} type="button">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg text-[9px] font-black" style={{ background: FAMILY_COLORS[entry.family].surface, color: FAMILY_COLORS[entry.family].color }}>{entry.family}</span>
        <span className="min-w-0 flex-1"><strong className="block truncate text-[11px] text-white/85">{entry.englishName}</strong><span className="mt-0.5 block truncate text-[9px] text-white/40">{entry.chineseName} · {entry.useCount ? `${entry.useCount} 次课程使用` : "新节点"}</span></span>
        <span className="text-[9px] font-black text-white/22 group-hover:text-[#73d7ba]">加入</span>
      </button>)}
    </div>
    <p className="mt-2 text-[9px] leading-4 text-white/30">拖到中间可自由放置；点击“加入”会直接添加。POP 为新家族，当前课程案例尚未使用。</p>
  </aside>;
}

export function NodeCanvasPanel({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelect,
  onDrop,
}: {
  nodes: StudioFlowNode[];
  edges: StudioFlowEdge[];
  onNodesChange: OnNodesChange<StudioFlowNode>;
  onEdgesChange: OnEdgesChange<StudioFlowEdge>;
  onConnect: OnConnect;
  onSelect: (node: StudioFlowNode) => void;
  onDrop: DragEventHandler<HTMLDivElement>;
}) {
  return <div className="h-[470px] overflow-hidden rounded-2xl border border-white/10 bg-[#101815] shadow-[inset_0_0_0_1px_rgba(255,255,255,.02)]" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDrop={onDrop}>
    <ReactFlow<StudioFlowNode, StudioFlowEdge>
      colorMode="dark"
      deleteKeyCode={["Backspace", "Delete"]}
      edges={edges}
      fitView
      maxZoom={1.8}
      minZoom={0.25}
      nodeTypes={NODE_TYPES}
      nodes={nodes}
      onConnect={onConnect}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => onSelect(node)}
      onNodesChange={onNodesChange}
      panOnDrag={[1, 2]}
      selectionOnDrag
    >
      <Background color="#294039" gap={22} size={1} />
      <Controls position="bottom-left" showInteractive={false} />
      <MiniMap className="!border !border-white/10 !bg-[#101815]" maskColor="rgba(5,10,8,.68)" nodeColor={(node) => FAMILY_COLORS[(node.data as StudioNodeData).entry.family].color} pannable zoomable />
    </ReactFlow>
  </div>;
}

function StudioNodeCard({ data, selected }: NodeProps<StudioFlowNode>) {
  const tone = FAMILY_COLORS[data.entry.family];
  return <div className={`w-44 rounded-xl border-2 px-3 py-2.5 shadow-xl transition ${data.state === "suggested" ? "border-dashed opacity-45" : "opacity-100"}`} style={{ borderColor: selected ? "#ffbf47" : tone.color, background: tone.surface, boxShadow: selected ? "0 0 0 3px rgba(255,191,71,.18)" : "0 10px 30px rgba(0,0,0,.28)" }}>
    <Handle className="!size-3 !border-2 !border-[#0d1412]" position={Position.Left} style={{ background: tone.color }} type="target" />
    <div className="flex items-center justify-between gap-2"><span className="text-[9px] font-black tracking-[.14em]" style={{ color: tone.color }}>{data.entry.family}</span>{data.state === "suggested" ? <span className="rounded bg-white/10 px-1.5 py-0.5 text-[8px] text-white/60">建议 {data.step}</span> : <span className="size-1.5 rounded-full" style={{ background: data.entry.browserRunnable ? "#73d7ba" : "rgba(255,255,255,.28)" }} />}</div>
    <strong className="mt-1 block truncate text-sm text-white">{data.entry.operatorType}1</strong>
    <span className="mt-0.5 block truncate text-[10px] text-white/48">{data.entry.chineseName}</span>
    <Handle className="!size-3 !border-2 !border-[#0d1412]" position={Position.Right} style={{ background: tone.color }} type="source" />
  </div>;
}

export function SharedAgentFocus({ focus }: { focus: string }) {
  return <section className="rounded-2xl border border-[#73d7ba]/18 bg-[#0d1613] p-4" aria-label="共享 Agent 当前焦点">
    <p className="text-[9px] font-black tracking-[.18em] text-[#73d7ba]">SHARED AGENT CONTEXT</p>
    <h2 className="mt-1 text-sm font-black">底部问答与主对话共用同一 Agent</h2>
    <p className="mt-3 rounded-xl bg-[#173229] px-3 py-2 text-[10px] leading-4 text-[#c8eee2]">{focus}</p>
    <p className="mt-2 text-[9px] leading-4 text-white/38">在底部提问时，这段焦点会随问题一起送入服务端；页面不再生成本地预设回复。</p>
  </section>;
}

export function NodeInspector({
  node,
  onAccept,
  settings,
  onSettingChange,
}: {
  node: StudioFlowNode | null;
  onAccept: () => void;
  settings: PreviewSettings;
  onSettingChange: (key: keyof PreviewSettings, value: number) => void;
}) {
  if (!node) return <section className="mt-3 rounded-2xl border border-white/[.08] bg-white/[.025] p-4"><h2 className="text-sm font-black">节点解释</h2><p className="mt-2 text-[11px] leading-5 text-white/42">点击画布中的节点，查看它接收什么、输出什么、为什么放在这里，以及关键参数的中文解释。</p></section>;
  const entry = node.data.entry;
  const io = nodeIo(entry);
  const parameters = browserParameters(entry, settings);
  return <section className="mt-3 max-h-[430px] overflow-y-auto rounded-2xl border border-white/[.08] bg-white/[.025] p-4" aria-labelledby="node-inspector-title">
    <div className="flex items-start justify-between gap-2"><div><p className="text-[9px] font-black tracking-[.16em]" style={{ color: FAMILY_COLORS[entry.family].color }}>{entry.family} · {touchDesignerFamilyChinese[entry.family]}</p><h2 className="mt-1 text-lg font-black" id="node-inspector-title">{entry.englishName}</h2><p className="text-[11px] text-white/48">{entry.chineseName}</p></div><span className={`rounded-lg px-2 py-1 text-[8px] ${entry.browserRunnable ? "bg-[#73d7ba]/12 text-[#92dfca]" : "bg-white/[.06] text-white/42"}`}>{entry.browserRunnable ? "网页可运行" : "结构可学习"}</span></div>
    <p className="mt-3 text-[11px] leading-5 text-white/65">{entry.description}</p>
    <div className="mt-3 grid grid-cols-2 gap-2 text-[9px]"><InfoCell label="接收" value={io.input} /><InfoCell label="输出" value={io.output} /></div>
    <div className="mt-3 rounded-xl bg-black/18 p-3"><h3 className="text-[10px] font-black text-[#ffcc69]">为什么放在当前网络</h3><p className="mt-1 text-[10px] leading-4 text-white/54">{nodeLearningAction(entry)}</p><p className="mt-2 text-[10px] leading-4 text-white/38">断开后：{disconnectEffect(entry)}</p></div>
    {node.data.state === "suggested" ? <button className="mt-3 w-full rounded-xl bg-[#73d7ba] px-3 py-2.5 text-xs font-black text-[#0f392e]" onClick={onAccept} type="button">把这个建议节点加入画布</button> : null}
    <div className="mt-4"><h3 className="text-[10px] font-black text-white/65">关键参数 · 中英对照</h3>
      {parameters.length ? <div className="mt-2 space-y-3">{parameters.map((parameter) => <label className="block" key={parameter.key}><span className="flex items-center justify-between gap-2 text-[9px]"><strong>{parameter.label}</strong><span className="font-mono text-[#ffcc69]">{parameter.value.toFixed(2)}</span></span><span className="mt-0.5 block text-[8px] text-white/34">{parameter.english}</span><input className="mt-1 w-full accent-[#73d7ba]" max={parameter.max} min={parameter.min} onChange={(event) => onSettingChange(parameter.key, Number(event.target.value))} step={parameter.step} type="range" value={parameter.value} /></label>)}</div> : <div className="mt-2 space-y-1.5">{entry.parameters.slice(0, 8).map((parameter) => <div className="rounded-lg bg-black/15 px-2.5 py-2" key={parameter.name}><strong className="block text-[9px] text-white/65">{parameter.chineseName}</strong><span className="text-[8px] text-white/32">{parameter.name}</span></div>)}{!entry.parameters.length ? <p className="text-[9px] leading-4 text-white/35">当前课程快照没有保存可展示参数；回到 TouchDesigner 时仍保留英文类型便于查找。</p> : null}</div>}
    </div>
    {entry.courseCases.length ? <p className="mt-3 text-[9px] leading-4 text-white/35">课程案例出现于：{entry.courseCases.join("、")}</p> : null}
  </section>;
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/[.06] bg-black/15 p-2.5"><span className="block text-[8px] text-white/30">{label}</span><strong className="mt-1 block leading-4 text-white/62">{value}</strong></div>;
}
