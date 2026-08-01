"use client";

import { useState } from "react";

type MapNode = {
  id: string;
  label: string;
  kicker: string;
  x: number;
  y: number;
  tone: "mint" | "sun" | "coral" | "blue";
  question: string;
  transfer: string;
};

const mapNodes: MapNode[] = [
  { id: "interaction", label: "交互逻辑", kicker: "核心", x: 50, y: 49, tone: "sun", question: "输入发生什么，系统如何判断，观众看到什么？", transfer: "所有案例都从这条因果链开始。" },
  { id: "input", label: "输入感知", kicker: "INPUT", x: 18, y: 18, tone: "blue", question: "距离、声音、手势如何变成数值？", transfer: "把摄像头替换成麦克风，结构仍然成立。" },
  { id: "sampling", label: "图像采样", kicker: "SAMPLE", x: 49, y: 12, tone: "mint", question: "像素颜色如何分配到每一个点？", transfer: "采样对象也可以是视频、深度图或反馈纹理。" },
  { id: "mapping", label: "范围映射", kicker: "MAPPING", x: 78, y: 21, tone: "coral", question: "原始数值怎样变成可用的大小与方向？", transfer: "Math 的本质是把一个区间翻译到另一个区间。" },
  { id: "generative", label: "动态生成", kicker: "GENERATE", x: 84, y: 54, tone: "mint", question: "如何制造连续但不机械的变化？", transfer: "Noise 可驱动位置，也能驱动颜色、尺度和声音。" },
  { id: "binding", label: "属性绑定", kicker: "BIND", x: 72, y: 82, tone: "blue", question: "计算结果最终写到哪个属性？", transfer: "Z、颜色、透明度、实例缩放都可以成为出口。" },
  { id: "rendering", label: "空间输出", kicker: "OUTPUT", x: 40, y: 88, tone: "coral", question: "点为什么在网络里存在，却没有出现在画面？", transfer: "输出可以是屏幕、投影、灯光或实体装置。" },
  { id: "debugging", label: "信号排障", kicker: "DEBUG", x: 12, y: 67, tone: "sun", question: "信号在哪一层停止变化？", transfer: "用探针逐层验证，比重搭网络更快。" },
  { id: "transfer", label: "迁移创造", kicker: "TRANSFER", x: 8, y: 42, tone: "mint", question: "保留结构时，可以替换哪个输入或输出？", transfer: "从图片粒子化迁移到声音地形或社区互动地图。" },
];

const edges: Array<[string, string]> = [
  ["interaction", "input"], ["interaction", "sampling"], ["interaction", "mapping"], ["interaction", "generative"],
  ["interaction", "binding"], ["interaction", "rendering"], ["interaction", "debugging"], ["interaction", "transfer"],
  ["input", "mapping"], ["sampling", "binding"], ["mapping", "generative"], ["generative", "binding"],
  ["binding", "rendering"], ["rendering", "debugging"], ["debugging", "input"], ["transfer", "mapping"],
];

const toneStyle = {
  mint: "border-[#75bea9] bg-[#e0f3ec] text-[#0d6858]",
  sun: "border-[#e2ad3b] bg-[#fff0c9] text-[#6b4800]",
  coral: "border-[#e98e7e] bg-[#ffebe6] text-[#8a3427]",
  blue: "border-[#87a6cf] bg-[#e9f0fb] text-[#294e7e]",
};

export function KnowledgeMap({ initialFocus }: { initialFocus?: string | null }) {
  const [selectedId, setSelectedId] = useState(initialFocus && mapNodes.some(({ id }) => id === initialFocus) ? initialFocus : "interaction");
  const selected = mapNodes.find(({ id }) => id === selectedId) ?? mapNodes[0];
  const related = new Set(edges.filter(([from, to]) => from === selectedId || to === selectedId).flat());

  return <section className="min-h-[calc(100vh-2rem)] bg-[#f5f6f0] pb-28" aria-labelledby="knowledge-map-title">
    <header className="border-b border-[#dce4df] bg-[#fffef9] px-5 py-5 sm:px-8"><p className="text-[10px] font-black tracking-[0.22em] text-[#178b73]">KNOWLEDGE MAP</p><div className="mt-1 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-black tracking-[-0.03em] text-[#17332d]" id="knowledge-map-title">知识不是一条路，是一张关系网</h1><p className="mt-2 text-sm text-[#58706a]">从任何问题出发，查看它与其他概念的连接；不需要按顺序解锁。</p></div><div className="rounded-full bg-[#e7f3ee] px-4 py-2 text-xs font-black text-[#0d6858]">9 个板块 · 全部可探索</div></div></header>
    <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="min-w-0 overflow-x-auto p-4 sm:p-7">
        <div className="relative mx-auto aspect-[10/7] min-h-[520px] min-w-[720px] max-w-[980px] overflow-hidden rounded-[2rem] border border-[#d3dfd9] bg-[#17332d] shadow-[0_20px_60px_rgba(23,51,45,.14)]">
          <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_center,rgba(255,255,255,.22)_1px,transparent_1px)] [background-size:22px_22px]" />
          <svg aria-hidden="true" className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {edges.map(([from, to]) => {
              const a = mapNodes.find(({ id }) => id === from)!; const b = mapNodes.find(({ id }) => id === to)!;
              const active = related.has(from) && related.has(to);
              return <line key={`${from}-${to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={active ? "#ffbf47" : "#7a9a91"} strokeDasharray={from === "interaction" ? undefined : "1.5 1.5"} strokeWidth={active ? .55 : .22} opacity={active ? .88 : .4} vectorEffect="non-scaling-stroke" />;
            })}
          </svg>
          {mapNodes.map((node) => {
            const active = node.id === selectedId;
            const near = related.has(node.id);
            return <button aria-pressed={active} className={`absolute w-28 -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2 px-3 py-3 text-left shadow-[0_8px_24px_rgba(0,0,0,.22)] transition hover:z-20 hover:-translate-y-[55%] ${toneStyle[node.tone]} ${active ? "z-20 scale-110 ring-4 ring-[#ffbf47]/30" : near ? "z-10 opacity-100" : "opacity-55"}`} key={node.id} onClick={() => setSelectedId(node.id)} style={{ left: `${node.x}%`, top: `${node.y}%` }} type="button"><span className="block text-[9px] font-black tracking-[0.14em] opacity-65">{node.kicker}</span><strong className="mt-1 block text-sm">{node.label}</strong></button>;
          })}
          <div className="absolute bottom-4 left-5 flex gap-4 text-[10px] font-bold text-white/55"><span><i className="mr-1 inline-block h-px w-5 bg-[#ffbf47] align-middle" />当前关系</span><span><i className="mr-1 inline-block w-5 border-t border-dashed border-white/40 align-middle" />可迁移关系</span></div>
        </div>
      </div>
      <aside className="border-l border-[#dce4df] bg-[#fffef9] p-6 lg:min-h-[calc(100vh-8rem)]" aria-label="知识点说明">
        <p className="text-[10px] font-black tracking-[0.18em] text-[#178b73]">{selected.kicker}</p><h2 className="mt-2 text-2xl font-black text-[#17332d]">{selected.label}</h2>
        <div className="mt-7"><p className="text-xs font-black text-[#71847f]">先问一个问题</p><p className="mt-2 text-base font-black leading-7 text-[#17332d]">{selected.question}</p></div>
        <div className="mt-7 border-l-4 border-[#ffbf47] pl-4"><p className="text-xs font-black text-[#71847f]">迁移线索</p><p className="mt-2 text-sm leading-6 text-[#4c655e]">{selected.transfer}</p></div>
        <div className="mt-8"><p className="text-xs font-black text-[#71847f]">与它直接相连</p><div className="mt-3 flex flex-wrap gap-2">{mapNodes.filter((node) => node.id !== selectedId && related.has(node.id)).map((node) => <button className="rounded-full border border-[#cbdad3] bg-white px-3 py-2 text-xs font-black text-[#31574d] hover:border-[#178b73]" key={node.id} onClick={() => setSelectedId(node.id)} type="button">{node.label}</button>)}</div></div>
      </aside>
    </div>
  </section>;
}
