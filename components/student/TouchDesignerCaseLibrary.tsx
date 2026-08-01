"use client";

import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState, type WheelEvent as ReactWheelEvent } from "react";

import {
  touchDesignerFamilyChinese,
  touchDesignerOperatorChinese,
  touchDesignerParameterChinese,
} from "@/lib/touchdesigner/localization";
import type {
  TouchDesignerCase,
  TouchDesignerCaseLibrary,
  TouchDesignerCaseVersion,
  TouchDesignerFamily,
  TouchDesignerModule,
  TouchDesignerNetworkSnapshot,
  TouchDesignerNodeSnapshot,
  TouchDesignerStructure,
} from "@/lib/touchdesigner/types";

const familyClass: Record<TouchDesignerFamily, string> = {
  TOP: "border-[#9d7bdc] bg-[#2b2044] text-[#d5c3f5]",
  CHOP: "border-[#69b663] bg-[#193b20] text-[#b4e6ae]",
  SOP: "border-[#5e9fd8] bg-[#142f48] text-[#b3daf6]",
  COMP: "border-[#969da3] bg-[#2b2f32] text-[#e1e5e8]",
  MAT: "border-[#d1b845] bg-[#463f16] text-[#f2df7c]",
  DAT: "border-[#d46d68] bg-[#48201f] text-[#f3b0aa]",
  POP: "border-[#4eb9a7] bg-[#153d37] text-[#a7e8dd]",
  OTHER: "border-[#75817d] bg-[#26302d] text-[#d0d8d5]",
};

const familyStroke: Record<TouchDesignerFamily, string> = {
  TOP: "#a987e3",
  CHOP: "#78c970",
  SOP: "#69ace5",
  COMP: "#a5aaae",
  MAT: "#dfc750",
  DAT: "#df7771",
  POP: "#5ac9b6",
  OTHER: "#899590",
};

const caseEntryNetworkPaths: Record<string, readonly string[]> = {
  "1.1.2声音驱动画面": ["project2", "project3"],
  "1.1.3随机像素生成": ["project4"],
  "1.2.2线条错位扭曲": ["project2"],
  "1.2.3水流气泡质感": ["container1"],
  "1.2.4动态玻璃扭曲": ["project4"],
  "1.3 4无限反馈生成": ["project4"],
  "1.3.2 等高热力图": ["project2"],
  "1.3.3 鼠标跟随拉伸": ["project3"],
};

const minimumNodeCanvasWidth = 1480;
const minimumNodeCanvasHeight = 720;
const nodeWidth = 128;
const nodeHeight = 66;
const nodeColumnGap = 212;
const nodeRowGap = 104;
const nodeCanvasPadding = 116;
const minimumCanvasZoom = 0.45;
const maximumCanvasZoom = 2.2;

type NodePosition = { x: number; y: number };
type AnnotationSource = "ORIGINAL" | "GENERATED";
type TeachingRole = "INPUT" | "CONTROL" | "PROCESS" | "SCENE" | "OUTPUT";
type AnnotationFrame = { id: string; title: string; body: string; x: number; y: number; width: number; height: number; tone: number; source: AnnotationSource; memberNodeIds: string[]; role?: TeachingRole };
type CanvasLayout = { positions: Map<string, NodePosition>; width: number; height: number; annotationFrames: AnnotationFrame[] };
type NodeDrag = { nodeId: string; pointerId: number; startX: number; startY: number; originX: number; originY: number };
type CanvasPan = { pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number; moved: boolean };

const annotationFrameClass = [
  "border-[#6bc58a]/30 bg-[#285844]/[.07] text-[#9bd9bd]",
  "border-[#d37a9f]/30 bg-[#7a2f51]/[.07] text-[#e7a2bf]",
  "border-[#5ca9d6]/30 bg-[#245979]/[.07] text-[#9ed2ed]",
  "border-[#d6a95c]/30 bg-[#795522]/[.07] text-[#e9c788]",
  "border-[#8f83d8]/30 bg-[#4c4380]/[.07] text-[#bbb3ee]",
];

const teachingRoleCopy: Record<TeachingRole, { title: string; body: string }> = {
  INPUT: { title: "输入与素材", body: "这些节点产生或读取图像、声音、数值与几何，是当前网络的数据起点。" },
  CONTROL: { title: "交互与控制", body: "这里把声音、鼠标、键盘或连续数值整理成可用于驱动参数的控制信号。" },
  PROCESS: { title: "核心处理", body: "这些节点承担当前效果的主要变换、合成、映射与视觉计算。" },
  SCENE: { title: "三维场景与渲染", body: "这里把几何、材质、摄像机和灯光组织成可被渲染的场景。" },
  OUTPUT: { title: "结果与输出", body: "这里汇总前面的处理结果，并送往显示、上一级网络或文件输出。" },
};

const teachingRoleTone: Record<TeachingRole, number> = { INPUT: 2, CONTROL: 0, PROCESS: 4, SCENE: 3, OUTPUT: 1 };

type CaseLibraryProps = { fetchImpl?: typeof fetch };

export function TouchDesignerCaseLibrary({ fetchImpl = fetch }: CaseLibraryProps) {
  const [manifest, setManifest] = useState<TouchDesignerCaseLibrary | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [structure, setStructure] = useState<TouchDesignerStructure | null>(null);
  const [networkPath, setNetworkPath] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [structureLoading, setStructureLoading] = useState(false);
  const [error, setError] = useState("");
  const structureCache = useRef(new Map<string, TouchDesignerStructure>());
  const requestSequence = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetchImpl("/api/touchdesigner-cases", { headers: { accept: "application/json" }, signal: controller.signal });
        const raw: unknown = await response.json();
        if (!response.ok || !isCaseLibrary(raw)) throw new Error(readError(raw, "案例库加载失败"));
        if (controller.signal.aborted) return;
        setManifest(raw);
        const cases = raw.modules.flatMap((module) => module.cases);
        const preferred = cases.find((item) => item.title.includes("图片粒子")) ?? cases[0];
        if (preferred) {
          setSelectedCaseId(preferred.id);
          setSelectedVersionId(preferred.activeVersionId);
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "案例库加载失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [fetchImpl]);

  const selected = useMemo(() => findCase(manifest, selectedCaseId), [manifest, selectedCaseId]);
  const selectedVersion = selected?.item.versions.find(({ id }) => id === selectedVersionId) ?? null;

  useEffect(() => {
    const structureId = selectedVersion?.structureId;
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    void (async () => {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      if (!structureId) {
        setStructure(null);
        setStructureLoading(false);
        return;
      }
      const cached = structureCache.current.get(structureId);
      if (cached) {
        setStructure(cached);
        setNetworkPath(caseNetworks(cached, selected?.item.title ?? "")[0]?.path ?? "");
        setSelectedNodeId("");
        setStructureLoading(false);
        return;
      }
      setStructureLoading(true);
      setError("");
      try {
        const response = await fetchImpl(`/api/touchdesigner-cases/${encodeURIComponent(structureId)}`, { headers: { accept: "application/json" }, signal: controller.signal });
        const raw: unknown = await response.json();
        if (!response.ok || !isStructure(raw)) throw new Error(readError(raw, "节点结构加载失败"));
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        structureCache.current.set(structureId, raw);
        setStructure(raw);
        setNetworkPath(caseNetworks(raw, selected?.item.title ?? "")[0]?.path ?? "");
        setSelectedNodeId("");
      } catch (reason) {
        if (!controller.signal.aborted && sequence === requestSequence.current) setError(reason instanceof Error ? reason.message : "节点结构加载失败");
      } finally {
        if (!controller.signal.aborted && sequence === requestSequence.current) setStructureLoading(false);
      }
    })();
    return () => controller.abort();
  }, [fetchImpl, selected?.item.title, selectedVersion?.structureId]);

  if (loading) return <section className="grid min-h-[calc(100vh-2rem)] place-items-center bg-[#101615] text-white" aria-busy="true"><p aria-live="polite">正在整理真实 TouchDesigner 工程…</p></section>;
  if (!manifest || !selected || !selectedVersion) return <section className="grid min-h-[calc(100vh-2rem)] place-items-center bg-[#101615] p-8 text-white"><div className="text-center"><h1 className="text-xl font-black">案例库暂时不可用</h1><p className="mt-2 text-sm text-white/55" role="alert">{error || "没有找到可展示的工程"}</p></div></section>;

  const visibleNetworks = structure ? caseNetworks(structure, selected.item.title) : [];
  const selectedNetwork = visibleNetworks.find(({ path }) => path === networkPath) ?? visibleNetworks[0] ?? null;
  const selectedNode = structure?.nodes.find(({ id }) => id === selectedNodeId) ?? null;
  const filteredModules = filterModules(manifest.modules, query);

  function chooseCase(item: TouchDesignerCase) {
    setSelectedCaseId(item.id);
    setSelectedVersionId(item.activeVersionId);
    setSelectedNodeId("");
  }

  return <section className="min-h-[calc(100vh-2rem)] bg-[#101615] pb-28 text-white" aria-labelledby="case-library-title">
    <header className="border-b border-white/10 px-5 py-5 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-[10px] font-black tracking-[0.22em] text-[#72d2b7]">TOUCHDESIGNER / 真实课程工程</p><h1 className="mt-1 text-2xl font-black" id="case-library-title">版本化案例库</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">主工程与 Backup 不再互相覆盖。选择任意历史版本，观察节点、连接和参数如何一步步长成最终作品。</p></div>
        <div className="grid grid-cols-3 gap-2 text-center"><HeaderMetric label="案例" value={manifest.totals.cases} /><HeaderMetric label="版本" value={manifest.totals.versions} /><HeaderMetric label="备份" value={manifest.totals.backupVersions} /></div>
      </div>
    </header>

    <div className="grid min-h-[calc(100vh-10rem)] lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="border-b border-white/10 bg-[#131a18] p-4 lg:border-b-0 lg:border-r" aria-label="案例目录">
        <label className="block text-[10px] font-black tracking-[0.16em] text-white/45" htmlFor="case-search">搜索案例</label>
        <div className="mt-2 flex items-center rounded-xl border border-white/10 bg-white/[.035] px-3"><span aria-hidden="true" className="text-white/35">⌕</span><input className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none placeholder:text-white/25" id="case-search" onChange={(event) => setQuery(event.target.value)} placeholder="扭曲、文字、粒子…" value={query} /></div>
        <nav className="mt-5 max-h-[calc(100vh-15rem)] space-y-4 overflow-y-auto pr-1" aria-label="TouchDesigner课程板块">
          {filteredModules.map((module) => <div key={module.id}><div className="mb-1.5 flex items-center justify-between"><h2 className="text-[11px] font-black text-[#8faaa2]">{module.title}</h2><span className="rounded-full bg-white/[.05] px-2 py-0.5 text-[9px] text-white/35">{module.cases.length}</span></div><ul className="space-y-1">{module.cases.map((item) => <li key={item.id}><button aria-current={selected.item.id === item.id ? "page" : undefined} className={`w-full rounded-xl px-3 py-2.5 text-left transition ${selected.item.id === item.id ? "bg-[#1f493e] text-[#bcebdc]" : "text-white/62 hover:bg-white/[.045] hover:text-white"}`} onClick={() => chooseCase(item)} type="button"><span className="block truncate text-xs font-black">{item.title}</span><span className="mt-0.5 block text-[9px] opacity-55">{item.versions.length} 个版本</span></button></li>)}</ul></div>)}
        </nav>
      </aside>

      <main className="min-w-0 p-4 sm:p-6 lg:p-7">
        <div className="mx-auto max-w-[96rem] space-y-5">
          <section className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#17201d]" aria-labelledby="selected-case-title">
            <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-6">
              <div><p className="text-[10px] font-black tracking-[0.16em] text-[#72d2b7]">{selected.module.title}</p><h2 className="mt-1 text-2xl font-black" id="selected-case-title">{selected.item.title}</h2><p className="mt-2 text-xs text-white/40">从指定课程目录解析 · {selected.item.versions.length} 个版本 · 当前 {selectedVersion.fileLabel}</p></div>
            </div>
            <VersionTimeline onSelect={setSelectedVersionId} selectedVersionId={selectedVersion.id} versions={selected.item.versions} />
          </section>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
            <section className="min-w-0 overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#121918]" aria-labelledby="network-canvas-title">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 px-5 py-4">
                <div><p className="text-[9px] font-black tracking-[0.18em] text-white/35">ACTUAL NETWORK SNAPSHOT</p><h2 className="mt-1 font-black" id="network-canvas-title">真实节点画布</h2></div>
                {structure ? <div className="flex flex-wrap gap-1.5" aria-label="选择工程网络">{visibleNetworks.map((network) => <button aria-pressed={selectedNetwork?.path === network.path} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-bold ${selectedNetwork?.path === network.path ? "bg-[#e5b84b] text-[#3b2a00]" : "bg-white/[.055] text-white/55 hover:bg-white/10"}`} key={network.path} onClick={() => { setNetworkPath(network.path); setSelectedNodeId(""); }} type="button">{shortNetworkLabel(network)} · {network.nodeIds.length}</button>)}</div> : null}
              </div>
              {structureLoading ? <div className="grid h-[34rem] place-items-center"><p className="text-sm text-white/45">正在读取这个版本的节点结构…</p></div> : null}
              {!structureLoading && selectedNetwork && structure ? <GenericNodeCanvas key={`${selected.item.id}:${selectedVersion.id}:${selectedNetwork.path}`} network={selectedNetwork} nodes={structure.nodes} edges={structure.edges} onSelectNode={setSelectedNodeId} selectedNodeId={selectedNodeId} /> : null}
              {!structureLoading && structure && !selectedNetwork ? <div className="grid h-[34rem] place-items-center px-6 text-center"><p className="text-sm text-white/45">这个版本尚未找到本案例指定的入口网络</p></div> : null}
              {!structureLoading && !structure ? <div className="grid h-[34rem] place-items-center px-6 text-center"><p className="text-sm text-white/45">{selectedVersion.issue ?? "这个版本没有可显示的节点结构"}</p></div> : null}
            </section>

            <aside className="space-y-4" aria-label="版本与节点说明">
              <DiffCard version={selectedVersion} />
              {structure ? <FamilyCard structure={structure} /> : null}
              <NodeInspector node={selectedNode} />
              {error ? <p className="rounded-xl border border-[#ff765f]/30 bg-[#4b241e] p-3 text-xs text-[#ffc0b4]" role="alert">{error}</p> : null}
            </aside>
          </div>
        </div>
      </main>
    </div>
  </section>;
}

function VersionTimeline({ versions, selectedVersionId, onSelect }: { versions: TouchDesignerCaseVersion[]; selectedVersionId: string; onSelect: (versionId: string) => void }) {
  return <div className="border-t border-white/10 bg-[#111816] px-5 py-4 sm:px-6"><div className="mb-3 flex items-center justify-between"><p className="text-[10px] font-black tracking-[0.16em] text-white/45">版本演进</p><p className="text-[10px] text-white/30">从早期备份到主工程 →</p></div><ol className="flex gap-2 overflow-x-auto pb-1">{versions.map((version, index) => <li className="relative shrink-0" key={version.id}><button aria-label={`${version.label}：${version.fileLabel}`} aria-pressed={selectedVersionId === version.id} className={`min-w-[8.5rem] rounded-xl border px-3 py-2.5 text-left transition ${selectedVersionId === version.id ? "border-[#e5b84b] bg-[#3d3419] text-[#ffe39b]" : "border-white/10 bg-white/[.035] text-white/58 hover:bg-white/[.07]"}`} onClick={() => onSelect(version.id)} type="button"><span className="flex items-center gap-2 text-[9px] font-black tracking-[0.12em]"><i className={`size-1.5 rounded-full ${version.kind === "PRIMARY" ? "bg-[#ffbf47]" : "bg-[#72d2b7]"}`} />{version.label}</span><strong className="mt-1 block max-w-36 truncate text-[11px] text-current">{version.fileLabel}</strong><span className="mt-1 block text-[9px] opacity-50">{dateLabel(version.modifiedAt)}{version.origin === "ARCHIVE" ? " · ZIP" : ""}</span>{version.duplicateOfVersionId ? <span className="mt-1 block text-[8px] text-[#8ccfbb]">结构与前序版本相同</span> : null}</button>{index < versions.length - 1 ? <span aria-hidden="true" className="absolute -right-2 top-1/2 h-px w-2 bg-white/15" /> : null}</li>)}</ol></div>;
}

function GenericNodeCanvas({ network, nodes, edges, selectedNodeId, onSelectNode }: { network: TouchDesignerNetworkSnapshot; nodes: TouchDesignerNodeSnapshot[]; edges: TouchDesignerStructure["edges"]; selectedNodeId: string; onSelectNode: (nodeId: string) => void }) {
  const networkNodes = useMemo(() => nodes.filter(({ id }) => network.nodeIds.includes(id)), [network.nodeIds, nodes]);
  const annotations = useMemo(() => networkNodes.filter(({ annotation, operatorType }) => annotation || operatorType === "annotate"), [networkNodes]);
  const visibleNodes = useMemo(() => networkNodes.filter(({ annotation, operatorType }) => !annotation && operatorType !== "annotate"), [networkNodes]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map(({ id }) => id)), [visibleNodes]);
  const visibleEdges = useMemo(() => edges.filter(({ id, source, target }) => network.edgeIds.includes(id) && visibleIds.has(source) && visibleIds.has(target)), [edges, network.edgeIds, visibleIds]);
  const initialLayout = useMemo(() => layoutNodes(visibleNodes, annotations, visibleEdges), [annotations, visibleEdges, visibleNodes]);
  const [positions, setPositions] = useState<Map<string, NodePosition>>(() => new Map(initialLayout.positions));
  const [zoom, setZoom] = useState(1);
  const [showTeachingFrames, setShowTeachingFrames] = useState(true);
  const [draggingNodeId, setDraggingNodeId] = useState("");
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(1);
  const dragRef = useRef<NodeDrag | null>(null);
  const panRef = useRef<CanvasPan | null>(null);
  const suppressContextMenuRef = useRef(false);

  function handleCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const viewport = event.currentTarget;
    const currentZoom = zoomRef.current;
    const nextZoom = clampCanvasZoom(currentZoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
    const bounds = viewport.getBoundingClientRect();
    zoomCanvasAroundPoint(viewport, currentZoom, nextZoom, event.clientX - bounds.left, event.clientY - bounds.top, setZoom, zoomRef);
  }

  function changeZoom(nextZoom: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    zoomCanvasAroundPoint(viewport, zoomRef.current, clampCanvasZoom(nextZoom), viewport.clientWidth / 2, viewport.clientHeight / 2, setZoom, zoomRef);
  }

  function resetCanvas() {
    setPositions(new Map(initialLayout.positions));
    setZoom(1);
    setDraggingNodeId("");
    setIsPanning(false);
    zoomRef.current = 1;
    dragRef.current = null;
    panRef.current = null;
    suppressContextMenuRef.current = false;
    if (viewportRef.current) {
      viewportRef.current.scrollLeft = 0;
      viewportRef.current.scrollTop = 0;
    }
  }

  function arrangeNodes() {
    setPositions(new Map(initialLayout.positions));
    setDraggingNodeId("");
    dragRef.current = null;
  }

  function beginNodeDrag(event: ReactPointerEvent<HTMLButtonElement>, nodeId: string) {
    if (event.button !== 0) return;
    const position = positions.get(nodeId);
    if (!position) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { nodeId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y };
    setDraggingNodeId(nodeId);
    onSelectNode(nodeId);
  }

  function moveNode(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const x = Math.max(0, Math.min(initialLayout.width - nodeWidth, drag.originX + (event.clientX - drag.startX) / zoomRef.current));
    const y = Math.max(0, Math.min(initialLayout.height - nodeHeight, drag.originY + (event.clientY - drag.startY) / zoomRef.current));
    setPositions((current) => new Map(current).set(drag.nodeId, { x, y }));
  }

  function finishNodeDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setDraggingNodeId("");
  }

  function beginCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 2) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    suppressContextMenuRef.current = false;
    panRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, scrollLeft: event.currentTarget.scrollLeft, scrollTop: event.currentTarget.scrollTop, moved: false };
  }

  function moveCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pan.startX;
    const deltaY = event.clientY - pan.startY;
    if (!pan.moved && Math.hypot(deltaX, deltaY) < 4) return;
    pan.moved = true;
    suppressContextMenuRef.current = true;
    setIsPanning(true);
    event.preventDefault();
    event.currentTarget.scrollLeft = pan.scrollLeft - deltaX;
    event.currentTarget.scrollTop = pan.scrollTop - deltaY;
  }

  function finishCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    panRef.current = null;
    setIsPanning(false);
  }

  function preserveContextMenuOnClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressContextMenuRef.current) return;
    event.preventDefault();
    suppressContextMenuRef.current = false;
  }

  return <div className="bg-[#0d1312]">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[.07] bg-[#111816] px-3 py-2" aria-label="节点画布工具">
      <div><p className="text-[9px] font-bold text-white/40" id="node-canvas-instructions">左键拖动节点 · 右键拖动画布（单击保留菜单）· 鼠标滚轮缩放</p><p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[8px] font-bold"><span className="text-[#f0c75e]">实线 · 原工程注释</span><span className="text-[#8ed8c2]">虚线 · 教学分组（系统整理）</span></p></div>
      <div className="flex items-center gap-1.5">
        <button aria-label="显示教学分组" aria-pressed={showTeachingFrames} className={`mr-1 rounded-lg border px-2.5 py-1.5 text-[9px] font-black ${showTeachingFrames ? "border-[#72d2b7]/30 bg-[#163029] text-[#9fe0cc]" : "border-white/10 bg-white/[.035] text-white/45"}`} onClick={() => setShowTeachingFrames((current) => !current)} type="button">教学分组</button>
        <button aria-label="自动整理节点" className="mr-1 rounded-lg border border-[#72d2b7]/20 bg-[#163029] px-2.5 py-1.5 text-[9px] font-black text-[#8ed8c2] hover:bg-[#1b3d33]" onClick={arrangeNodes} type="button">自动整理</button>
        <button aria-label="缩小节点画布" className="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/[.04] text-sm font-black text-white/65 hover:bg-white/10" onClick={() => changeZoom(zoomRef.current - 0.15)} type="button">−</button>
        <output aria-label="画布缩放比例" className="min-w-12 text-center font-mono text-[10px] font-bold text-[#f0c75e]" aria-live="polite">{Math.round(zoom * 100)}%</output>
        <button aria-label="放大节点画布" className="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/[.04] text-sm font-black text-white/65 hover:bg-white/10" onClick={() => changeZoom(zoomRef.current + 0.15)} type="button">+</button>
        <button aria-label="复位节点画布" className="ml-1 rounded-lg border border-[#6bc58a]/25 bg-[#1a3328] px-2.5 py-1.5 text-[9px] font-black text-[#9fd9b4] hover:bg-[#214333]" onClick={resetCanvas} type="button">复位视图</button>
      </div>
    </div>
    <div aria-describedby="node-canvas-instructions" aria-label={`TouchDesigner网络：${network.label}`} className={`h-[560px] overflow-auto overscroll-contain ${isPanning ? "cursor-grabbing select-none" : "cursor-default"}`} onContextMenu={preserveContextMenuOnClick} onPointerCancel={finishCanvasPan} onPointerDown={beginCanvasPan} onPointerMove={moveCanvasPan} onPointerUp={finishCanvasPan} onWheel={handleCanvasWheel} ref={viewportRef}>
      <div className="relative" style={{ height: initialLayout.height * zoom, width: initialLayout.width * zoom }}>
        <div className="absolute left-0 top-0 bg-[linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)] bg-[size:28px_28px]" style={{ height: initialLayout.height, transform: `scale(${zoom})`, transformOrigin: "top left", width: initialLayout.width }}>
          {initialLayout.annotationFrames.filter((frame) => frame.source === "ORIGINAL" || showTeachingFrames).map((frame) => <section aria-label={`${frame.source === "ORIGINAL" ? "原工程注释" : "教学分组"}：${frame.title}`} className={`pointer-events-none absolute z-0 rounded-xl border ${frame.source === "GENERATED" ? "border-dashed" : "border-solid"} ${annotationFrameClass[frame.tone % annotationFrameClass.length]}`} key={frame.id} style={{ height: frame.height, left: frame.x, top: frame.y, width: frame.width }}><div className={`absolute left-3 top-0 max-w-80 -translate-y-1/2 rounded-xl border bg-[#111816]/95 px-2.5 py-1.5 text-[9px] shadow-sm ${frame.source === "GENERATED" ? "border-dashed border-current/35" : "border-current/25"}`} title={frame.body}><span className="block text-[7px] font-black tracking-[0.12em] opacity-60">{frame.source === "ORIGINAL" ? "原工程注释" : "教学分组 · 系统整理"}</span><strong className="mt-0.5 block truncate text-[9px]">{frame.title}</strong>{frame.body ? <span className="mt-0.5 block max-w-72 whitespace-normal text-[8px] font-medium leading-3 opacity-65">{frame.body}</span> : null}</div></section>)}
          <svg aria-hidden="true" className="absolute inset-0 z-[1] size-full" viewBox={`0 0 ${initialLayout.width} ${initialLayout.height}`}>{visibleEdges.map((edge) => { const source = positions.get(edge.source); const target = positions.get(edge.target); if (!source || !target) return null; return <path d={`M ${source.x + nodeWidth} ${source.y + nodeHeight / 2} C ${source.x + nodeWidth + nodeColumnGap / 2} ${source.y + nodeHeight / 2}, ${target.x - nodeColumnGap / 2} ${target.y + nodeHeight / 2}, ${target.x} ${target.y + nodeHeight / 2}`} fill="none" key={edge.id} opacity=".78" stroke="#6bc58a" strokeWidth="1.8" />; })}</svg>
          {visibleNodes.map((node) => { const position = positions.get(node.id) ?? { x: nodeCanvasPadding, y: nodeCanvasPadding }; const isDragging = draggingNodeId === node.id; const glossary = touchDesignerOperatorChinese(node.operatorType, node.family); return <button aria-label={`${node.family} ${node.name} ${node.operatorType}`} aria-pressed={selectedNodeId === node.id} className={`absolute z-10 h-[66px] w-32 touch-none select-none rounded-md border px-2.5 text-left shadow-[0_8px_18px_rgba(0,0,0,.3)] ${isDragging ? "z-30 cursor-grabbing" : "cursor-grab"} ${familyClass[node.family]} ${selectedNodeId === node.id ? "ring-2 ring-[#ffbf47] ring-offset-2 ring-offset-[#0d1312]" : "opacity-92 hover:brightness-110"}`} key={node.id} onClick={() => onSelectNode(node.id)} onPointerCancel={finishNodeDrag} onPointerDown={(event) => beginNodeDrag(event, node.id)} onPointerMove={moveNode} onPointerUp={finishNodeDrag} style={{ left: position.x, top: position.y }} title={glossary.description} type="button"><span className="text-[8px] font-black tracking-[0.1em] opacity-65">{node.family} · {touchDesignerFamilyChinese[node.family]}</span><strong className="mt-0.5 block truncate text-[11px] text-white">{node.name}</strong><span className="block truncate text-[8px] opacity-75">{glossary.label} · {node.operatorType}</span></button>; })}
          {visibleNodes.length === 0 ? <p className="absolute inset-0 grid place-items-center text-sm text-white/35">这个网络中没有可视节点</p> : null}
        </div>
      </div>
    </div>
  </div>;
}

function clampCanvasZoom(value: number) {
  return Math.max(minimumCanvasZoom, Math.min(maximumCanvasZoom, value));
}

function zoomCanvasAroundPoint(viewport: HTMLDivElement, currentZoom: number, nextZoom: number, focusX: number, focusY: number, setZoom: (zoom: number) => void, zoomRef: { current: number }) {
  if (Math.abs(nextZoom - currentZoom) < 0.001) return;
  const contentX = (viewport.scrollLeft + focusX) / currentZoom;
  const contentY = (viewport.scrollTop + focusY) / currentZoom;
  zoomRef.current = nextZoom;
  setZoom(nextZoom);
  window.requestAnimationFrame(() => {
    viewport.scrollLeft = contentX * nextZoom - focusX;
    viewport.scrollTop = contentY * nextZoom - focusY;
  });
}

function NodeInspector({ node }: { node: TouchDesignerNodeSnapshot | null }) {
  if (!node) return <section className="rounded-2xl border border-white/10 bg-[#17201d] p-4"><p className="text-[10px] font-black tracking-[0.16em] text-white/38">节点说明</p><p className="mt-3 text-xs leading-5 text-white/45">点击画布中的节点，查看真实类型、输入和这个版本保存下来的关键参数。</p></section>;
  const glossary = touchDesignerOperatorChinese(node.operatorType, node.family);
  return <section className="rounded-2xl border border-white/10 bg-[#17201d] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-black tracking-[0.12em]" style={{ color: familyStroke[node.family] }}>{node.family} · {touchDesignerFamilyChinese[node.family]}</p><h3 className="mt-1 font-black">{node.name}</h3><p className="mt-0.5 text-[11px] font-bold text-white/75">{glossary.label}</p></div><span className={`max-w-28 truncate rounded-lg border px-2 py-1 text-[9px] ${familyClass[node.family]}`} title={node.operatorType}>{node.operatorType}</span></div><p className="mt-3 rounded-xl border border-[#8ecdb9]/10 bg-[#8ecdb9]/[.06] px-3 py-2 text-[10px] leading-4 text-[#b7dcd0]">{glossary.description}</p><p className="mt-3 break-all font-mono text-[9px] text-white/35">/{node.path}</p><div className="mt-4"><p className="text-[9px] font-black tracking-[0.12em] text-white/35">输入</p><p className="mt-1 text-xs text-white/65">{node.inputs.filter(Boolean).join("、") || "无直接输入"}</p></div><div className="mt-4"><p className="text-[9px] font-black tracking-[0.12em] text-white/35">关键参数 · {node.parameterCount}</p>{node.parameters.length ? <dl className="mt-2 space-y-1.5">{node.parameters.map((parameter) => <div className="rounded-lg bg-black/15 px-2.5 py-2" key={`${node.id}:${parameter.name}`}><dt className="flex flex-wrap items-baseline gap-x-2"><span className="text-[10px] font-black text-[#8ecdb9]">{touchDesignerParameterChinese(parameter.name)}</span><span className="font-mono text-[8px] text-white/35">{parameter.name}</span></dt><dd className="mt-1 break-words font-mono text-[9px] leading-4 text-white/60">{parameter.value}</dd></div>)}</dl> : <p className="mt-1 text-xs text-white/40">当前节点没有保存非默认参数。</p>}</div></section>;
}

function DiffCard({ version }: { version: TouchDesignerCaseVersion }) {
  const diff = version.diffFromPrevious;
  return <section className="rounded-2xl border border-white/10 bg-[#17201d] p-4" aria-label="版本差异"><div className="flex items-center justify-between"><p className="text-[10px] font-black tracking-[0.16em] text-white/38">相对上一版本</p><span className={`rounded-full px-2 py-1 text-[9px] font-black ${version.kind === "PRIMARY" ? "bg-[#ffbf47]/15 text-[#ffcf72]" : "bg-[#72d2b7]/10 text-[#91d9c4]"}`}>{version.label}</span></div>{diff ? <div className="mt-3 grid grid-cols-3 gap-2"><DiffMetric label="新增" value={diff.added} color="text-[#8ed9ac]" /><DiffMetric label="删除" value={diff.removed} color="text-[#ff9e8c]" /><DiffMetric label="修改" value={diff.changed} color="text-[#ffd075]" /></div> : <p className="mt-3 text-xs leading-5 text-white/45">这是当前时间线的起点，用它作为后续版本比较的基线。</p>}{version.duplicateOfVersionId ? <p className="mt-3 rounded-lg bg-[#1d3b33] px-3 py-2 text-[10px] leading-4 text-[#9ad7c5]">文件名不同，但节点结构与已有版本完全一致。</p> : null}</section>;
}

function FamilyCard({ structure }: { structure: TouchDesignerStructure }) {
  const families = Object.entries(structure.familyCounts).sort((left, right) => (right[1] ?? 0) - (left[1] ?? 0)) as Array<[TouchDesignerFamily, number]>;
  const maximum = Math.max(...families.map(([, count]) => count), 1);
  return <section className="rounded-2xl border border-white/10 bg-[#17201d] p-4"><p className="text-[10px] font-black tracking-[0.16em] text-white/38">工程构成</p><div className="mt-3 space-y-2">{families.slice(0, 7).map(([family, count]) => <div key={family}><div className="flex items-center justify-between text-[9px]"><span className="font-black" style={{ color: familyStroke[family] }}>{family}</span><span className="text-white/40">{count}</span></div><div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full" style={{ backgroundColor: familyStroke[family], width: `${Math.max(8, count / maximum * 100)}%` }} /></div></div>)}</div><p className="mt-3 text-[10px] text-white/35">{structure.nodeCount} 个节点 · {structure.edgeCount} 条连接 · {structure.networks.length} 层网络</p></section>;
}

function HeaderMetric({ label, value }: { label: string; value: number }) { return <div className="min-w-16 rounded-xl border border-white/10 bg-white/[.035] px-3 py-2"><strong className="block text-lg font-black text-[#d5eee6]">{value}</strong><span className="text-[9px] text-white/35">{label}</span></div>; }
function DiffMetric({ label, value, color }: { label: string; value: number; color: string }) { return <div className="rounded-xl bg-black/15 px-2 py-2 text-center"><strong className={`block text-lg font-black ${color}`}>{value}</strong><span className="text-[9px] text-white/35">{label}</span></div>; }

function layoutNodes(nodes: TouchDesignerNodeSnapshot[], annotations: TouchDesignerNodeSnapshot[], edges: TouchDesignerStructure["edges"]): CanvasLayout {
  const positions = new Map<string, NodePosition>();
  if (!nodes.length) return { positions, width: minimumNodeCanvasWidth, height: minimumNodeCanvasHeight, annotationFrames: [] };

  const sourceNodes = nodes.map((node, index) => ({ node, sourceX: Number.isFinite(node.x) ? node.x : index * 180, sourceY: Number.isFinite(node.y) ? node.y : -index * 100 }));
  const xClusters = clusterCoordinates(sourceNodes.map(({ sourceX }) => sourceX), 105);
  const yClusters = clusterCoordinates(sourceNodes.map(({ sourceY }) => sourceY), 85).sort((left, right) => right - left);
  const gridCells = new Map<string, typeof sourceNodes>();
  sourceNodes.forEach((item) => {
    const column = closestCoordinateIndex(xClusters, item.sourceX);
    const row = closestCoordinateIndex(yClusters, item.sourceY);
    const key = `${row}:${column}`;
    const cellNodes = gridCells.get(key) ?? [];
    cellNodes.push(item);
    gridCells.set(key, cellNodes);
  });
  const rowStarts: number[] = [];
  let nextRowStart = nodeCanvasPadding;
  yClusters.forEach((_, row) => {
    let maximumCellSize = 1;
    xClusters.forEach((__, column) => { maximumCellSize = Math.max(maximumCellSize, gridCells.get(`${row}:${column}`)?.length ?? 0); });
    rowStarts[row] = nextRowStart;
    nextRowStart += maximumCellSize * nodeHeight + maximumCellSize * nodeRowGap;
  });

  gridCells.forEach((cellNodes, key) => {
    const [row, column] = key.split(":").map(Number);
    cellNodes.sort((left, right) => right.sourceY - left.sourceY || left.node.name.localeCompare(right.node.name)).forEach(({ node }, stackIndex) => {
      positions.set(node.id, {
        x: nodeCanvasPadding + column * (nodeWidth + nodeColumnGap),
        y: rowStarts[row] + stackIndex * (nodeHeight + nodeRowGap),
      });
    });
  });

  let width = Math.max(minimumNodeCanvasWidth, nodeCanvasPadding * 2 + xClusters.length * nodeWidth + Math.max(0, xClusters.length - 1) * nodeColumnGap);
  let height = Math.max(minimumNodeCanvasHeight, nextRowStart - nodeRowGap + nodeCanvasPadding);
  const originalCoveredNodeIds = new Set<string>();
  const originalFrames = annotations.flatMap((annotation, index) => {
    const members = nodes.filter((node) => !originalCoveredNodeIds.has(node.id) && nodeInsideAnnotation(node, annotation));
    members.forEach(({ id }) => originalCoveredNodeIds.add(id));
    const memberPositions = members.map(({ id }) => positions.get(id)).filter((position): position is NodePosition => Boolean(position));
    if (!memberPositions.length || !annotation.annotation) return [];
    return [annotationFrameFromPositions(annotation.id, annotation.annotation.title || "功能分区", annotation.annotation.body, members.map(({ id }) => id), memberPositions, index, "ORIGINAL")];
  });
  const generatedFrames = generatedTeachingFrames(nodes, edges, positions, originalCoveredNodeIds);
  const annotationFrames = resolveAnnotationFrameCollisions([...originalFrames, ...generatedFrames], positions);
  width = Math.max(width, ...annotationFrames.map((frame) => frame.x + frame.width + nodeCanvasPadding));
  height = Math.max(height, ...annotationFrames.map((frame) => frame.y + frame.height + nodeCanvasPadding));
  return { positions, width, height, annotationFrames };
}

function annotationFrameFromPositions(id: string, title: string, body: string, memberNodeIds: string[], memberPositions: NodePosition[], tone: number, source: AnnotationSource, role?: TeachingRole): AnnotationFrame {
  const minX = Math.min(...memberPositions.map(({ x }) => x));
  const minY = Math.min(...memberPositions.map(({ y }) => y));
  const maxX = Math.max(...memberPositions.map(({ x }) => x + nodeWidth));
  const maxY = Math.max(...memberPositions.map(({ y }) => y + nodeHeight));
  return { id, title, body, x: Math.max(12, minX - 24), y: Math.max(12, minY - 64), width: Math.max(340, maxX - minX + 48), height: maxY - minY + 92, tone, source, memberNodeIds, role };
}

function generatedTeachingFrames(nodes: TouchDesignerNodeSnapshot[], edges: TouchDesignerStructure["edges"], positions: Map<string, NodePosition>, originalCoveredNodeIds: Set<string>) {
  const availableNodes = nodes.filter(({ id }) => !originalCoveredNodeIds.has(id));
  if (!availableNodes.length) return [];
  const incomingCounts = new Map<string, number>();
  const outgoingCounts = new Map<string, number>();
  edges.forEach(({ source, target }) => {
    outgoingCounts.set(source, (outgoingCounts.get(source) ?? 0) + 1);
    incomingCounts.set(target, (incomingCounts.get(target) ?? 0) + 1);
  });
  const groups = new Map<TeachingRole, TouchDesignerNodeSnapshot[]>();
  availableNodes.forEach((node) => {
    const role = teachingRoleForNode(node, incomingCounts.get(node.id) ?? 0, outgoingCounts.get(node.id) ?? 0);
    groups.set(role, [...(groups.get(role) ?? []), node]);
  });
  return [...groups.entries()].flatMap(([role, members]) => partitionTeachingMembers(members).flatMap((branch, branchIndex, branches) => {
    const memberPositions = branch.map(({ id }) => positions.get(id)).filter((position): position is NodePosition => Boolean(position));
    if (!memberPositions.length) return [];
    const copy = teachingRoleCopy[role];
    const examples = unique(branch.map(({ family, operatorType }) => `${touchDesignerOperatorChinese(operatorType, family).label}（${operatorType}）`)).slice(0, 3);
    const body = `${copy.body}${examples.length ? ` 代表节点：${examples.join("、")}${branch.length > examples.length ? "等" : ""}。` : ""}`;
    const title = branches.length > 1 ? `${copy.title} · 支路 ${branchIndex + 1}` : copy.title;
    return [annotationFrameFromPositions(`teaching:${role}:${branchIndex}`, title, body, branch.map(({ id }) => id), memberPositions, teachingRoleTone[role] + branchIndex, "GENERATED", role)];
  }));
}

function resolveAnnotationFrameCollisions(frames: AnnotationFrame[], positions: Map<string, NodePosition>) {
  const placed: AnnotationFrame[] = [];
  [...frames].sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id)).forEach((sourceFrame) => {
    const frame = { ...sourceFrame };
    let collision = placed.find((candidate) => annotationFramesOverlap(frame, candidate));
    while (collision) {
      const nextY = Math.max(...placed.filter((candidate) => horizontalFrameOverlap(frame, candidate)).map((candidate) => candidate.y + candidate.height + 24));
      const deltaY = Math.max(0, nextY - frame.y);
      frame.y += deltaY;
      frame.memberNodeIds.forEach((nodeId) => {
        const position = positions.get(nodeId);
        if (position) positions.set(nodeId, { x: position.x, y: position.y + deltaY });
      });
      collision = placed.find((candidate) => annotationFramesOverlap(frame, candidate));
    }
    placed.push(frame);
  });
  return placed;
}

function horizontalFrameOverlap(left: AnnotationFrame, right: AnnotationFrame) {
  return left.x < right.x + right.width && left.x + left.width > right.x;
}

function annotationFramesOverlap(left: AnnotationFrame, right: AnnotationFrame) {
  return horizontalFrameOverlap(left, right) && left.y < right.y + right.height && left.y + left.height > right.y;
}

function partitionTeachingMembers(members: TouchDesignerNodeSnapshot[]) {
  const verticalBands: Array<{ centerY: number; members: TouchDesignerNodeSnapshot[] }> = [];
  [...members].sort((left, right) => left.y - right.y || left.x - right.x).forEach((node) => {
    const closestBand = verticalBands.reduce<{ band: typeof verticalBands[number] | null; distance: number }>((closest, band) => {
      const distance = Math.abs(node.y - band.centerY);
      return distance < closest.distance ? { band, distance } : closest;
    }, { band: null, distance: Number.POSITIVE_INFINITY });
    if (!closestBand.band || closestBand.distance > 180) {
      verticalBands.push({ centerY: node.y, members: [node] });
      return;
    }
    closestBand.band.members.push(node);
    closestBand.band.centerY = closestBand.band.members.reduce((sum, member) => sum + member.y, 0) / closestBand.band.members.length;
  });
  return verticalBands.flatMap(({ members: bandMembers }) => {
    const branches: TouchDesignerNodeSnapshot[][] = [];
    [...bandMembers].sort((left, right) => left.x - right.x || right.y - left.y).forEach((node) => {
      const branch = branches.at(-1);
      const previous = branch?.at(-1);
      if (!branch || !previous || node.x - previous.x > 500) branches.push([node]);
      else branch.push(node);
    });
    return branches;
  });
}

function teachingRoleForNode(node: TouchDesignerNodeSnapshot, incomingCount: number, outgoingCount: number): TeachingRole {
  const operator = node.operatorType.toLowerCase();
  const outputOperators = new Set(["out", "moviefileout", "audiodevout", "render", "window"]);
  const sceneOperators = new Set(["geo", "cam", "light", "render", "phong", "pbr", "environment", "texture"]);
  const inputOperators = new Set(["in", "moviefilein", "audiofilein", "audiodevin", "videodevin", "pointfilein", "filein", "mousein", "keyboardin", "constant", "noise", "ramp", "grid", "box", "sphere", "circle", "text", "pattern"]);
  const controlOperators = new Set(["mousein", "keyboardin", "audiodevin", "audiofilein", "analyze", "filter", "math", "fit", "limit", "lag", "spring", "lfo", "logic", "panel", "widget", "slider", "button", "select", "chopexec", "panelexec", "parexec", "datexec", "opexec"]);
  if (outputOperators.has(operator) || (outgoingCount === 0 && (operator === "null" || incomingCount > 0))) return "OUTPUT";
  if (node.family === "MAT" || node.family === "SOP" || sceneOperators.has(operator)) return "SCENE";
  if (inputOperators.has(operator) && incomingCount === 0) return "INPUT";
  if (node.family === "CHOP" || node.family === "DAT" || controlOperators.has(operator)) return "CONTROL";
  if (incomingCount === 0) return "INPUT";
  return "PROCESS";
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function clusterCoordinates(values: number[], tolerance: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const clusters: Array<{ center: number; count: number }> = [];
  sorted.forEach((value) => {
    const cluster = clusters.at(-1);
    if (!cluster || Math.abs(value - cluster.center) > tolerance) {
      clusters.push({ center: value, count: 1 });
      return;
    }
    cluster.center = (cluster.center * cluster.count + value) / (cluster.count + 1);
    cluster.count += 1;
  });
  return clusters.map(({ center }) => center);
}

function closestCoordinateIndex(clusters: number[], value: number) {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  clusters.forEach((center, index) => {
    const distance = Math.abs(center - value);
    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  });
  return closestIndex;
}

function nodeInsideAnnotation(node: TouchDesignerNodeSnapshot, annotation: TouchDesignerNodeSnapshot) {
  const centerX = node.x + Math.max(node.width, 0) / 2;
  const centerY = node.y + Math.max(node.height, 0) / 2;
  return centerX >= annotation.x && centerX <= annotation.x + Math.max(annotation.width, 0) && centerY >= annotation.y && centerY <= annotation.y + Math.max(annotation.height, 0);
}

function findCase(manifest: TouchDesignerCaseLibrary | null, caseId: string) {
  if (!manifest) return null;
  for (const courseModule of manifest.modules) {
    const item = courseModule.cases.find(({ id }) => id === caseId);
    if (item) return { module: courseModule, item };
  }
  return null;
}

function filterModules(modules: TouchDesignerModule[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return modules;
  return modules.flatMap((module) => {
    const cases = module.cases.filter((item) => `${module.title} ${item.title}`.toLowerCase().includes(normalized));
    return cases.length ? [{ ...module, cases }] : [];
  });
}

function shortNetworkLabel(network: TouchDesignerNetworkSnapshot) {
  const parts = network.label.split("/");
  return parts.at(-1) || "工程入口";
}

function caseNetworks(structure: TouchDesignerStructure, caseTitle: string) {
  const configuredPaths = caseEntryNetworkPaths[caseTitle];
  if (configuredPaths) {
    const networksByPath = new Map(structure.networks.map((network) => [network.path, network]));
    return configuredPaths.flatMap((networkPath) => networksByPath.get(networkPath) ?? []);
  }
  return structure.networks
    .filter(({ path: networkPath }) => /^project\d*$/i.test(networkPath))
    .sort((left, right) => left.path.localeCompare(right.path, "en", { numeric: true }));
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期未知";
  return new Intl.DateTimeFormat("zh-CN", { year: "2-digit", month: "2-digit", day: "2-digit" }).format(date);
}

function isCaseLibrary(value: unknown): value is TouchDesignerCaseLibrary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TouchDesignerCaseLibrary>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.modules) && !!candidate.totals;
}

function isStructure(value: unknown): value is TouchDesignerStructure {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TouchDesignerStructure>;
  return typeof candidate.id === "string" && Array.isArray(candidate.nodes) && Array.isArray(candidate.edges) && Array.isArray(candidate.networks);
}

function readError(value: unknown, fallback: string) {
  return value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : fallback;
}
