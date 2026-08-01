"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

type NodeFamily = "TOP" | "SOP" | "CHOP" | "COMP" | "MAT";
type FlowId = "sourceFlow" | "positionFlow" | "colorFlow" | "depthFlow" | "instanceData" | "objectFlow" | "materialFlow" | "renderFlow";
type PreviewMode = "REAL" | "INTERACTIVE";
type PreviewStage = "source" | "position" | "color" | "depth" | "merge" | "object" | "scene" | "final";

type StudioNode = {
  id: string;
  title: string;
  family: NodeFamily;
  caption: string;
  x: number;
  y: number;
};

type Connection = {
  id: string;
  effect: FlowId;
  label: string;
  from: [number, number];
  to: [number, number];
  reference?: boolean;
  interactive?: boolean;
  bend?: [number, number];
};

type TeachingCanvasPan = { pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number; moved: boolean };

const teachingCanvasWidth = 1810;
const teachingCanvasHeight = 560;
const minimumTeachingCanvasZoom = .55;
const maximumTeachingCanvasZoom = 1.6;

const nodes: StudioNode[] = [
  { id: "constant", title: "constant1", family: "CHOP", caption: "500 × 500", x: 270, y: 24 },
  { id: "source", title: "moviefilein", family: "TOP", caption: "图片素材", x: 25, y: 216 },
  { id: "switch", title: "switch1", family: "TOP", caption: "切换素材", x: 145, y: 216 },
  { id: "resolution", title: "res1", family: "TOP", caption: "统一分辨率", x: 265, y: 216 },
  { id: "level", title: "level1", family: "TOP", caption: "调色", x: 395, y: 158 },

  { id: "grid", title: "grid1", family: "SOP", caption: "实例位置矩阵", x: 520, y: 52 },
  { id: "gridNull", title: "null1", family: "SOP", caption: "冻结点阵", x: 640, y: 52 },
  { id: "sopTo", title: "sopto1", family: "CHOP", caption: "点转通道", x: 760, y: 52 },
  { id: "positionSelect", title: "select3", family: "CHOP", caption: "保留 tx / ty", x: 880, y: 52 },
  { id: "positionOut", title: "null6", family: "CHOP", caption: "位置出口", x: 1000, y: 52 },

  { id: "colorNull", title: "null1_color", family: "TOP", caption: "调色结果", x: 520, y: 196 },
  { id: "topToColor", title: "topto1", family: "CHOP", caption: "像素转 RGB", x: 640, y: 196 },
  { id: "colorShuffle", title: "shuffle1", family: "CHOP", caption: "整理通道", x: 760, y: 196 },
  { id: "colorSelect", title: "select1", family: "CHOP", caption: "选择 r / g / b", x: 880, y: 196 },
  { id: "colorOut", title: "null5", family: "CHOP", caption: "颜色出口", x: 1000, y: 196 },

  { id: "noise", title: "noise1", family: "TOP", caption: "生成动态纹理", x: 520, y: 354 },
  { id: "topToDepth", title: "topto2", family: "CHOP", caption: "纹理转数值", x: 640, y: 354 },
  { id: "depthShuffle", title: "shuffle2", family: "CHOP", caption: "整理通道", x: 760, y: 354 },
  { id: "depthSelect", title: "select2", family: "CHOP", caption: "选择 tz 信号", x: 880, y: 354 },
  { id: "math", title: "math1", family: "CHOP", caption: "缩放 Z 幅度", x: 1000, y: 354 },
  { id: "depthOut", title: "null4", family: "CHOP", caption: "深度出口", x: 1120, y: 354 },

  { id: "merge", title: "merge1", family: "CHOP", caption: "tx/ty + RGB + tz", x: 1260, y: 196 },
  { id: "box", title: "box1", family: "SOP", caption: "单个粒子实体", x: 1260, y: 52 },
  { id: "boxNull", title: "null1", family: "SOP", caption: "实体出口", x: 1380, y: 52 },
  { id: "light", title: "light1", family: "COMP", caption: "场景灯光", x: 1510, y: 52 },
  { id: "camera", title: "cam1", family: "COMP", caption: "观察视角", x: 1510, y: 140 },
  { id: "geo", title: "geo1", family: "COMP", caption: "实例化矩阵", x: 1510, y: 246 },
  { id: "phong", title: "phong1", family: "MAT", caption: "粒子材质", x: 1510, y: 354 },
  { id: "render", title: "render1", family: "TOP", caption: "最终渲染", x: 1680, y: 196 },
];

const connections: Connection[] = [
  { id: "constant-resolution", effect: "sourceFlow", label: "Constant 控制 Resolution", from: [320, 88], to: [315, 216], reference: true },
  { id: "constant-grid", effect: "positionFlow", label: "Constant 同步 Grid 行列", from: [370, 56], to: [520, 78], reference: true },
  { id: "source-switch", effect: "sourceFlow", label: "素材进入 Switch", from: [125, 248], to: [145, 248] },
  { id: "switch-resolution", effect: "sourceFlow", label: "Switch 进入 Resolution", from: [245, 248], to: [265, 248], interactive: true },
  { id: "resolution-level", effect: "sourceFlow", label: "Resolution 进入 Level", from: [365, 248], to: [395, 190], bend: [382, 248] },

  { id: "grid-null", effect: "positionFlow", label: "Grid 进入 Null", from: [620, 84], to: [640, 84] },
  { id: "null-sopto", effect: "positionFlow", label: "点阵进入 SOP to CHOP", from: [740, 84], to: [760, 84] },
  { id: "sopto-position-select", effect: "positionFlow", label: "选择 tx 和 ty", from: [860, 84], to: [880, 84] },
  { id: "position-select-out", effect: "positionFlow", label: "tx/ty 写入位置出口", from: [980, 84], to: [1000, 84] },
  { id: "position-merge", effect: "positionFlow", label: "tx/ty 进入 Merge", from: [1100, 84], to: [1260, 218], bend: [1178, 84], interactive: true },

  { id: "level-color", effect: "colorFlow", label: "调色结果进入颜色支路", from: [495, 190], to: [520, 228] },
  { id: "color-topto", effect: "colorFlow", label: "图像像素转 RGB 通道", from: [620, 228], to: [640, 228] },
  { id: "color-shuffle", effect: "colorFlow", label: "整理 RGB 通道", from: [740, 228], to: [760, 228] },
  { id: "color-select", effect: "colorFlow", label: "选择 r/g/b", from: [860, 228], to: [880, 228] },
  { id: "color-out", effect: "colorFlow", label: "RGB 写入颜色出口", from: [980, 228], to: [1000, 228] },
  { id: "color-merge", effect: "colorFlow", label: "RGB 进入 Merge", from: [1100, 228], to: [1260, 228], interactive: true },

  { id: "resolution-noise", effect: "depthFlow", label: "素材进入 Noise TOP", from: [365, 260], to: [520, 386], bend: [430, 386] },
  { id: "noise-topto", effect: "depthFlow", label: "Noise TOP 转为 CHOP", from: [620, 386], to: [640, 386] },
  { id: "depth-shuffle", effect: "depthFlow", label: "整理深度通道", from: [740, 386], to: [760, 386] },
  { id: "depth-select", effect: "depthFlow", label: "选择 tz 信号", from: [860, 386], to: [880, 386] },
  { id: "depth-math", effect: "depthFlow", label: "Math 缩放 tz", from: [980, 386], to: [1000, 386] },
  { id: "depth-out", effect: "depthFlow", label: "tz 写入深度出口", from: [1100, 386], to: [1120, 386] },
  { id: "depth-merge", effect: "depthFlow", label: "tz 进入 Merge", from: [1220, 386], to: [1260, 248], bend: [1240, 386], interactive: true },

  { id: "box-null", effect: "objectFlow", label: "Box 作为粒子实体", from: [1360, 84], to: [1380, 84] },
  { id: "box-geo", effect: "objectFlow", label: "粒子实体进入 Geo", from: [1480, 84], to: [1510, 278], bend: [1492, 84], interactive: true },
  { id: "merge-geo", effect: "instanceData", label: "Merge 驱动 Geo Instancing", from: [1360, 228], to: [1510, 278], reference: true, interactive: true },
  { id: "phong-geo", effect: "materialFlow", label: "Phong 赋予 Geo 材质", from: [1560, 354], to: [1560, 310], reference: true, interactive: true },
  { id: "light-render", effect: "renderFlow", label: "Light 进入 Render", from: [1610, 84], to: [1680, 218], reference: true },
  { id: "camera-render", effect: "renderFlow", label: "Camera 进入 Render", from: [1610, 172], to: [1680, 228], reference: true },
  { id: "geo-render", effect: "renderFlow", label: "Geo 进入 Render", from: [1610, 278], to: [1680, 248], reference: true, interactive: true },
];

const allConnected: Record<FlowId, boolean> = {
  sourceFlow: true,
  positionFlow: true,
  colorFlow: true,
  depthFlow: true,
  instanceData: true,
  objectFlow: true,
  materialFlow: true,
  renderFlow: true,
};

const familyStyle: Record<NodeFamily, string> = {
  TOP: "border-[#9b77de] bg-[#281d42] text-[#ccb9f2]",
  SOP: "border-[#5a9bd5] bg-[#132f48] text-[#a9d5f5]",
  CHOP: "border-[#66b55f] bg-[#183c20] text-[#abe4a6]",
  COMP: "border-[#8f949a] bg-[#2a2d31] text-[#d9dde1]",
  MAT: "border-[#d0b63e] bg-[#473f13] text-[#f3df79]",
};

const groupBoxes = [
  { title: "素材 · Resolution", x: 10, y: 176, w: 370, h: 128, color: "border-[#aaa424]/45 bg-[#777316]/10 text-[#dad56a]" },
  { title: "矩阵 · 调用位置信息 tx / ty", x: 505, y: 12, w: 610, h: 120, color: "border-[#64ac45]/45 bg-[#386523]/10 text-[#9fdd7d]" },
  { title: "颜色信号 · RGB", x: 505, y: 156, w: 610, h: 120, color: "border-[#b26737]/45 bg-[#743817]/10 text-[#e9a170]" },
  { title: "素材动态化 · tz", x: 505, y: 314, w: 735, h: 126, color: "border-[#3fa6a1]/45 bg-[#17635f]/10 text-[#79d8d1]" },
  { title: "矩阵实物", x: 1245, y: 12, w: 250, h: 120, color: "border-[#a63775]/45 bg-[#6e1e4c]/10 text-[#df78b5]" },
  { title: "渲染", x: 1495, y: 12, w: 300, h: 430, color: "border-[#5aa13d]/45 bg-[#315f21]/10 text-[#9cdb83]" },
];

const nodePreviewStage: Record<string, PreviewStage> = {
  source: "source", switch: "source", resolution: "source", level: "source",
  constant: "position", grid: "position", gridNull: "position", sopTo: "position", positionSelect: "position", positionOut: "position",
  colorNull: "color", topToColor: "color", colorShuffle: "color", colorSelect: "color", colorOut: "color",
  noise: "depth", topToDepth: "depth", depthShuffle: "depth", depthSelect: "depth", math: "depth", depthOut: "depth",
  merge: "merge", box: "object", boxNull: "object", light: "scene", camera: "scene", phong: "scene", geo: "final", render: "final",
};

const previewStageLabel: Record<PreviewStage, string> = {
  source: "图像进入 TOP",
  position: "位置矩阵 tx / ty",
  color: "像素颜色 RGB",
  depth: "动态深度 tz",
  merge: "三路数据合并",
  object: "Box 粒子实体",
  scene: "材质 / 灯光 / 相机",
  final: "Geo Instancing 最终输出",
};

type PreviewParameters = {
  resolutionRows: number;
  resolutionColumns: number;
  gridRows: number;
  gridColumns: number;
  sourceZoom: number;
  sourceVariant: "original" | "mono" | "invert";
  colorGain: number;
  contrast: number;
  saturation: number;
  gridScaleX: number;
  gridScaleY: number;
  normalizedPosition: boolean;
  positionAxes: "xy" | "x" | "y";
  sampleMode: "rgb" | "luma";
  channelOrder: "rgb" | "bgr";
  colorChannels: "rgb" | "r" | "g" | "b";
  noiseAmount: number;
  speed: number;
  noiseFrequency: number;
  depthSteps: "smooth" | "stepped";
  depthInvert: boolean;
  depthClamp: boolean;
  mathScale: number;
  mathOffset: number;
  pointSize: number;
  pointShape: "square" | "circle";
  lightIntensity: number;
  lightWarmth: number;
  cameraZoom: number;
  cameraTilt: number;
  geoScale: number;
  materialShine: number;
  renderExposure: number;
  backgroundLevel: number;
};

const defaultParameters: PreviewParameters = {
  resolutionRows: 28,
  resolutionColumns: 28,
  gridRows: 28,
  gridColumns: 28,
  sourceZoom: 100,
  sourceVariant: "original",
  colorGain: 100,
  contrast: 100,
  saturation: 100,
  gridScaleX: 100,
  gridScaleY: 100,
  normalizedPosition: true,
  positionAxes: "xy",
  sampleMode: "rgb",
  channelOrder: "rgb",
  colorChannels: "rgb",
  noiseAmount: 42,
  speed: 46,
  noiseFrequency: 62,
  depthSteps: "smooth",
  depthInvert: false,
  depthClamp: false,
  mathScale: 76,
  mathOffset: 0,
  pointSize: 4,
  pointShape: "square",
  lightIntensity: 100,
  lightWarmth: 52,
  cameraZoom: 100,
  cameraTilt: 0,
  geoScale: 100,
  materialShine: 42,
  renderExposure: 100,
  backgroundLevel: 8,
};

export function ParticleNodeStudio({ initialFocus, onBackToCases }: { initialFocus?: string | null; onBackToCases?: () => void }) {
  const [connected, setConnected] = useState<Record<FlowId, boolean>>(allConnected);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("INTERACTIVE");
  const [selectedNode, setSelectedNode] = useState(initialFocus && nodes.some(({ id }) => id === initialFocus) ? initialFocus : "noise");
  const [parameters, setParameters] = useState<PreviewParameters>(defaultParameters);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [isCanvasPanning, setIsCanvasPanning] = useState(false);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const canvasZoomRef = useRef(1);
  const canvasPanRef = useRef<TeachingCanvasPan | null>(null);
  const suppressCanvasMenuRef = useRef(false);
  const selected = nodes.find(({ id }) => id === selectedNode) ?? nodes[15];
  const previewStage = nodePreviewStage[selected.id] ?? "final";
  const brokenCount = Object.values(connected).filter((value) => !value).length;

  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const currentZoom = canvasZoomRef.current;
      const nextZoom = clampTeachingCanvasZoom(currentZoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
      const bounds = viewport.getBoundingClientRect();
      zoomTeachingCanvasAroundPoint(viewport, currentZoom, nextZoom, event.clientX - bounds.left, event.clientY - bounds.top, setCanvasZoom, canvasZoomRef);
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, []);

  function toggleFlow(id: FlowId) {
    setPreviewMode("INTERACTIVE");
    setConnected((current) => ({ ...current, [id]: !current[id] }));
  }

  function setParameter<Key extends keyof PreviewParameters>(key: Key, value: PreviewParameters[Key]) {
    setPreviewMode("INTERACTIVE");
    setParameters((current) => ({ ...current, [key]: value }));
  }

  function setParameterGroup(values: Partial<PreviewParameters>) {
    setPreviewMode("INTERACTIVE");
    setParameters((current) => ({ ...current, ...values }));
  }

  function changeCanvasZoom(nextZoom: number) {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    zoomTeachingCanvasAroundPoint(viewport, canvasZoomRef.current, clampTeachingCanvasZoom(nextZoom), viewport.clientWidth / 2, viewport.clientHeight / 2, setCanvasZoom, canvasZoomRef);
  }

  function resetCanvasView() {
    setCanvasZoom(1);
    setIsCanvasPanning(false);
    canvasZoomRef.current = 1;
    canvasPanRef.current = null;
    suppressCanvasMenuRef.current = false;
    if (canvasViewportRef.current) {
      canvasViewportRef.current.scrollLeft = 0;
      canvasViewportRef.current.scrollTop = 0;
    }
  }

  function beginCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 2) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    suppressCanvasMenuRef.current = false;
    canvasPanRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, scrollLeft: event.currentTarget.scrollLeft, scrollTop: event.currentTarget.scrollTop, moved: false };
  }

  function moveCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    const pan = canvasPanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pan.startX; const deltaY = event.clientY - pan.startY;
    if (!pan.moved && Math.hypot(deltaX, deltaY) < 4) return;
    pan.moved = true;
    suppressCanvasMenuRef.current = true;
    setIsCanvasPanning(true);
    event.preventDefault();
    event.currentTarget.scrollLeft = pan.scrollLeft - deltaX;
    event.currentTarget.scrollTop = pan.scrollTop - deltaY;
  }

  function finishCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (canvasPanRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    canvasPanRef.current = null;
    setIsCanvasPanning(false);
  }

  function preserveCanvasMenuOnClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressCanvasMenuRef.current) return;
    event.preventDefault();
    suppressCanvasMenuRef.current = false;
  }

  return <section className="min-h-[calc(100vh-2rem)] bg-[#0d1312] pb-28 text-white" aria-labelledby="node-studio-title">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-7">
      <div><p className="text-[10px] font-black tracking-[0.22em] text-[#77d1b9]">节点画布 / 真实工程对照 01</p><h1 className="mt-1 text-xl font-black" id="node-studio-title">图片粒子化 · Instancing 网络</h1></div>
      <div className="flex flex-wrap items-center gap-2">{onBackToCases ? <button className="rounded-lg border border-[#79d8bd]/25 bg-[#79d8bd]/[.07] px-3 py-2 text-xs font-black text-[#9ce5d0] hover:bg-[#79d8bd]/15" onClick={onBackToCases} type="button">← 全部案例</button> : null}<span className={`rounded-full px-3 py-1.5 text-xs font-black ${brokenCount ? "bg-[#ff765f]/20 text-[#ff9b89]" : "bg-[#4fcb9b]/15 text-[#8ee4c3]"}`}>{brokenCount ? `${brokenCount} 条功能支路断开` : "三路实例数据已合并"}</span><button className="rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-white/75 hover:bg-white/5" onClick={() => { setConnected(allConnected); setPreviewMode("INTERACTIVE"); }} type="button">恢复完整工程</button></div>
    </header>

    <div className="grid xl:grid-cols-[minmax(25rem,.76fr)_minmax(44rem,1.24fr)]">
      <div className="border-b border-white/10 p-4 sm:p-6 xl:border-b-0 xl:border-r">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><p className="text-[10px] font-black tracking-[0.18em] text-white/45">NODE-DRIVEN OUTPUT</p><h2 className="mt-1 font-black">点右侧节点，左侧显示它的输出</h2></div><div aria-label="选择效果预览模式" className="flex rounded-xl border border-white/10 bg-black/20 p-1"><button aria-pressed={previewMode === "INTERACTIVE"} className={`rounded-lg px-3 py-1.5 text-[10px] font-black transition ${previewMode === "INTERACTIVE" ? "bg-[#79d8bd] text-[#0d3027]" : "text-white/45 hover:text-white/75"}`} onClick={() => setPreviewMode("INTERACTIVE")} type="button">节点输出</button><button aria-pressed={previewMode === "REAL"} className={`rounded-lg px-3 py-1.5 text-[10px] font-black transition ${previewMode === "REAL" ? "bg-[#ffbf47] text-[#3f2a00]" : "text-white/45 hover:text-white/75"}`} onClick={() => setPreviewMode("REAL")} type="button">成片对照</button></div></div>
        {previewMode === "REAL" ? <RealProjectPreview /> : <ParticlePreview connected={connected} focusNode={selected.id} focusNodeTitle={selected.title} parameters={parameters} previewStage={previewStage} />}
        <FormationRail activeStage={previewMode === "REAL" ? "final" : previewStage} />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
          <Metric label="tx / ty" value={connected.positionFlow ? `${parameters.gridRows * parameters.gridColumns} 点` : "无位置"} active={connected.positionFlow} />
          <Metric label="RGB" value={connected.colorFlow ? "来自 topp to1" : "默认白色"} active={connected.colorFlow} />
          <Metric label="tz" value={connected.depthFlow ? `${Math.round(parameters.noiseAmount * parameters.mathScale / 100 + parameters.mathOffset)}` : "0 · 平面"} active={connected.depthFlow} />
          <Metric label="Instancing" value={connected.instanceData ? "Merge 驱动" : "未绑定"} active={connected.instanceData} />
        </div>

        <div className="mt-5 border-t border-white/10 pt-5">
          <div className="flex items-center justify-between"><div><p className="text-[10px] font-black tracking-[0.16em] text-white/40">当前节点</p><h3 className="mt-1 font-black">{selected.title} <span className="ml-1 text-xs text-white/45">{selected.family}</span></h3></div><span className={`size-3 rounded-full border ${familyStyle[selected.family].split(" ")[0]}`} /></div>
          <p className="mt-2 text-sm leading-6 text-white/55">{nodeExplanation[selected.id]}</p>
          <NodeControls connected={connected} parameters={parameters} selectedNode={selected.id} setParameter={setParameter} setParameterGroup={setParameterGroup} toggleFlow={toggleFlow} />
        </div>
      </div>

      <div className="min-w-0 p-4 sm:p-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><p className="text-[10px] font-black tracking-[0.18em] text-white/45">YOUR TOUCHDESIGNER NETWORK</p><h2 className="mt-1 font-black">与真实工程同构的教学画布</h2></div><div className="flex gap-3 text-[10px] font-bold text-white/45"><span><i className="mr-1 inline-block h-px w-5 bg-[#7bdbc0] align-middle" />节点连线</span><span><i className="mr-1 inline-block w-5 border-t border-dashed border-[#7bdbc0] align-middle" />参数引用</span></div></div>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#111716]">
          <div aria-label="节点画布工具" className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[.07] bg-[#111816] px-3 py-2">
            <p className="text-[9px] font-bold text-white/40" id="teaching-node-canvas-instructions">右键按住拖动画布（单击保留菜单）· 鼠标滚轮缩放</p>
            <div className="flex items-center gap-1.5"><button aria-label="缩小教学节点画布" className="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/[.04] text-sm font-black text-white/65 hover:bg-white/10" onClick={() => changeCanvasZoom(canvasZoomRef.current - .15)} type="button">−</button><output aria-label="教学画布缩放比例" aria-live="polite" className="min-w-12 text-center font-mono text-[10px] font-bold text-[#f0c75e]">{Math.round(canvasZoom * 100)}%</output><button aria-label="放大教学节点画布" className="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/[.04] text-sm font-black text-white/65 hover:bg-white/10" onClick={() => changeCanvasZoom(canvasZoomRef.current + .15)} type="button">+</button><button aria-label="复位教学节点画布" className="ml-1 rounded-lg border border-[#6bc58a]/25 bg-[#1a3328] px-2.5 py-1.5 text-[9px] font-black text-[#9fd9b4] hover:bg-[#214333]" onClick={resetCanvasView} type="button">复位视图</button></div>
          </div>
          <div aria-describedby="teaching-node-canvas-instructions" aria-label="TouchDesigner 图片粒子化真实节点网络" className={`h-[470px] overflow-auto overscroll-contain ${isCanvasPanning ? "cursor-grabbing select-none" : "cursor-default"}`} onContextMenu={preserveCanvasMenuOnClick} onPointerCancel={finishCanvasPan} onPointerDown={beginCanvasPan} onPointerMove={moveCanvasPan} onPointerUp={finishCanvasPan} ref={canvasViewportRef}>
            <div className="relative" style={{ height: teachingCanvasHeight * canvasZoom, width: teachingCanvasWidth * canvasZoom }}>
              <div className="absolute left-0 top-0 bg-[linear-gradient(rgba(255,255,255,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.045)_1px,transparent_1px)] bg-[size:32px_32px]" style={{ height: teachingCanvasHeight, transform: `scale(${canvasZoom})`, transformOrigin: "top left", width: teachingCanvasWidth }}>
                {groupBoxes.map((group) => <div aria-hidden="true" className={`absolute rounded-sm border ${group.color}`} key={group.title} style={{ height: group.h, left: group.x, top: group.y, width: group.w }}><p className="px-3 py-2 text-[11px] font-black tracking-[0.08em]">{group.title}</p></div>)}
                <svg aria-hidden="true" className="absolute inset-0 size-full" viewBox={`0 0 ${teachingCanvasWidth} ${teachingCanvasHeight}`}>
                  {connections.map((connection) => <ConnectionPath active={connected[connection.effect]} connection={connection} key={connection.id} />)}
                </svg>
                {connections.filter(({ interactive }) => interactive).map((connection) => {
                  const midpoint = getMidpoint(connection);
                  const active = connected[connection.effect];
                  return <button aria-label={`${active ? "断开" : "连接"}：${connection.label}`} aria-pressed={active} className={`absolute z-20 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 text-[10px] font-black shadow-lg transition ${active ? "border-[#79d8bd] bg-[#173d34] text-[#a8ecd8]" : "border-[#ff765f] bg-[#4a201b] text-[#ffad9e]"}`} key={connection.id} onClick={() => toggleFlow(connection.effect)} style={{ left: midpoint[0], top: midpoint[1] }} title={connection.label} type="button">{active ? "•" : "×"}</button>;
                })}
                {nodes.map((node) => <button aria-pressed={selectedNode === node.id} className={`absolute z-10 h-16 w-[100px] rounded-md border px-2.5 text-left shadow-[0_8px_20px_rgba(0,0,0,.26)] transition hover:-translate-y-0.5 ${familyStyle[node.family]} ${selectedNode === node.id ? "ring-2 ring-[#ffbf47] ring-offset-2 ring-offset-[#101615]" : "opacity-90"}`} key={node.id} onClick={() => { setSelectedNode(node.id); setPreviewMode("INTERACTIVE"); }} style={{ left: node.x, top: node.y }} type="button"><span className="block text-[8px] font-black tracking-[0.16em] opacity-65">{node.family}</span><strong className="mt-0.5 block truncate text-[12px] text-white">{node.title}</strong><span className="mt-0.5 block truncate text-[9px] opacity-70">{node.caption}</span></button>)}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><BranchNote color="#8fd873" label="位置支路" text="Grid → SOP to CHOP → tx / ty" /><BranchNote color="#e39868" label="颜色支路" text="TOP to CHOP → r / g / b" /><BranchNote color="#65cec7" label="动态支路" text="Noise TOP → TOP to CHOP → tz" /></div>
        <p className="mt-3 text-xs leading-5 text-white/45">这张教学画布按你提供的工程截图重新组织：三路 CHOP 数据在 merge1 汇合后，用参数引用驱动 geo1 的 Instancing；Box SOP 是被复制的粒子实体，不是 Grid 本身。</p>
      </div>
    </div>
  </section>;
}

const nodeExplanation: Record<string, string> = {
  constant: "统一控制 Resolution 与 Grid 的行列数，确保像素数量和实例数量能够对应。",
  source: "真实图片素材的入口。多个素材先经过 Switch，再进入统一处理。",
  switch: "在多张图片之间切换，后面的粒子网络不需要重新连接。",
  resolution: "把输入图片统一成固定分辨率；分辨率决定后续采样数和实例数量。",
  level: "在采样前调整亮度、对比度与颜色，让最终粒子的 RGB 更清楚。",
  grid: "生成每一个实例在平面上的位置矩阵；这里负责 tx、ty，不负责粒子实体。",
  gridNull: "把 Grid 的结果作为稳定出口，便于下游引用和排障。",
  sopTo: "把 SOP 中每个点的位置转换成 CHOP 通道。",
  positionSelect: "只保留实例需要的 tx 与 ty 通道。",
  positionOut: "位置支路的最终出口，送入 merge1。",
  colorNull: "保存调色后的图片，作为 RGB 采样来源。",
  topToColor: "把每个像素的 RGB 值转换为 CHOP 通道。",
  colorShuffle: "重新排列像素通道，使每个样本能与对应实例对齐。",
  colorSelect: "选择实例颜色所需的 r、g、b 通道。",
  colorOut: "颜色支路的最终出口，送入 merge1。",
  noise: "截图中的 noise1 是 TOP：它生成随时间变化的纹理，再交给 TOP to CHOP 变成数值。",
  topToDepth: "把 Noise TOP 的像素变化转换成可供实例使用的 CHOP 数据。",
  depthShuffle: "重新排列动态数据，让每个实例获得一条对应的深度数值。",
  depthSelect: "选择并命名用于实例深度的 tz 通道。",
  math: "缩放 tz 的范围，控制粒子沿 Z 轴起伏的幅度。",
  depthOut: "动态深度支路的最终出口，送入 merge1。",
  merge: "合并 tx/ty、RGB 和 tz，形成 geo1 Instancing 所需的一整组通道。",
  box: "真正被大量复制的单个粒子实体；调整 Box 大小就是调整每颗粒子的尺寸。",
  boxNull: "Box SOP 的稳定出口，作为 geo1 的基础几何。",
  light: "为 Phong 材质提供光照。",
  camera: "决定观察粒子矩阵的视角。",
  geo: "读取 merge1 的通道并进行 Instancing，同时承载 Box SOP 与 Phong 材质。",
  phong: "决定粒子表面的受光与质感。",
  render: "把 Camera、Light 与 Geo 合成为最终 TOP 画面。",
};

function ConnectionPath({ connection, active }: { connection: Connection; active: boolean }) {
  const path = connection.bend
    ? `M ${connection.from[0]} ${connection.from[1]} Q ${connection.bend[0]} ${connection.bend[1]} ${connection.to[0]} ${connection.to[1]}`
    : `M ${connection.from[0]} ${connection.from[1]} L ${connection.to[0]} ${connection.to[1]}`;
  return <path d={path} fill="none" stroke={active ? connection.reference ? "#8b9694" : "#77cc87" : "#ff765f"} strokeDasharray={connection.reference || !active ? "6 5" : undefined} strokeLinecap="round" strokeWidth={active ? 2 : 1.5} opacity={active ? .8 : .5} />;
}

function getMidpoint(connection: Connection): [number, number] {
  if (connection.bend) return [connection.bend[0], connection.bend[1]];
  return [(connection.from[0] + connection.to[0]) / 2, (connection.from[1] + connection.to[1]) / 2];
}

function clampTeachingCanvasZoom(value: number) {
  return Math.max(minimumTeachingCanvasZoom, Math.min(maximumTeachingCanvasZoom, value));
}

function zoomTeachingCanvasAroundPoint(viewport: HTMLDivElement, currentZoom: number, nextZoom: number, focusX: number, focusY: number, setZoom: (zoom: number) => void, zoomRef: { current: number }) {
  if (Math.abs(nextZoom - currentZoom) < .001) return;
  const contentX = (viewport.scrollLeft + focusX) / currentZoom;
  const contentY = (viewport.scrollTop + focusY) / currentZoom;
  zoomRef.current = nextZoom;
  setZoom(nextZoom);
  window.requestAnimationFrame(() => {
    viewport.scrollLeft = contentX * nextZoom - focusX;
    viewport.scrollTop = contentY * nextZoom - focusY;
  });
}

function Metric({ label, value, active }: { label: string; value: string; active: boolean }) {
  return <div className="rounded-xl border border-white/10 bg-white/[.035] px-3 py-3"><div className="flex items-center gap-2"><span className={`size-1.5 rounded-full ${active ? "bg-[#71d6b8]" : "bg-[#ff765f]"}`} /><p className="text-[9px] font-black tracking-[0.14em] text-white/40">{label}</p></div><p className="mt-1 text-sm font-black text-white/85">{value}</p></div>;
}

function BranchNote({ color, label, text }: { color: string; label: string; text: string }) {
  return <div className="rounded-lg border border-white/10 bg-white/[.03] px-3 py-2"><p className="text-[9px] font-black tracking-[0.12em]" style={{ color }}>{label}</p><p className="mt-1 font-mono text-[10px] text-white/55">{text}</p></div>;
}

function NodeControls({ connected, parameters, selectedNode, setParameter, setParameterGroup, toggleFlow }: {
  connected: Record<FlowId, boolean>;
  parameters: PreviewParameters;
  selectedNode: string;
  setParameter: <Key extends keyof PreviewParameters>(key: Key, value: PreviewParameters[Key]) => void;
  setParameterGroup: (values: Partial<PreviewParameters>) => void;
  toggleFlow: (id: FlowId) => void;
}) {
  const gridCount = parameters.gridRows * parameters.gridColumns;
  const readOnlyNotes: Record<string, { title: string; value: string }> = {
    gridNull: { title: "稳定 Grid 输出，不改变坐标", value: `${gridCount} 个 SOP 点` },
    positionOut: { title: "位置支路最终出口", value: `${parameters.positionAxes === "xy" ? "tx + ty" : parameters.positionAxes} · ${gridCount} 样本` },
    colorNull: { title: "保存 Level 调色结果", value: `${parameters.resolutionColumns} × ${parameters.resolutionRows} 像素` },
    colorOut: { title: "颜色支路最终出口", value: `${parameters.colorChannels.toUpperCase()} · ${gridCount} 样本` },
    depthOut: { title: "深度支路最终出口", value: `tz · ${gridCount} 样本` },
    boxNull: { title: "稳定 Box SOP 输出", value: `${parameters.pointShape === "square" ? "方形" : "圆形"}粒子 · ${parameters.pointSize}px` },
  };
  if (readOnlyNotes[selectedNode]) return <ReadOnlyNodeState {...readOnlyNotes[selectedNode]} />;

  if (selectedNode === "constant") return <ParameterGrid>
    <Slider chineseLabel="同步列数" label="Constant columns" min={10} max={48} value={parameters.gridColumns} onChange={(value) => setParameterGroup({ gridColumns: value, resolutionColumns: value })} />
    <Slider chineseLabel="同步行数" label="Constant rows" min={10} max={48} value={parameters.gridRows} onChange={(value) => setParameterGroup({ gridRows: value, resolutionRows: value })} />
  </ParameterGrid>;
  if (selectedNode === "source") return <ParameterGrid><Slider chineseLabel="素材缩放" label="Source zoom" min={70} max={130} suffix="%" value={parameters.sourceZoom} onChange={(value) => setParameter("sourceZoom", value)} /></ParameterGrid>;
  if (selectedNode === "switch") return <SegmentedControl label="Switch input" title="切换输入素材" value={parameters.sourceVariant} options={[{ value: "original", label: "原图" }, { value: "mono", label: "灰度" }, { value: "invert", label: "反相" }]} onChange={(value) => setParameter("sourceVariant", value as PreviewParameters["sourceVariant"])} />;
  if (selectedNode === "resolution") return <ParameterGrid>
    <Slider chineseLabel="横向像素（列）" label="Resolution columns" min={10} max={64} value={parameters.resolutionColumns} onChange={(value) => setParameter("resolutionColumns", value)} />
    <Slider chineseLabel="纵向像素（行）" label="Resolution rows" min={10} max={64} value={parameters.resolutionRows} onChange={(value) => setParameter("resolutionRows", value)} />
  </ParameterGrid>;
  if (selectedNode === "level") return <ParameterGrid>
    <Slider chineseLabel="亮度增益" label="Color gain" min={40} max={160} suffix="%" value={parameters.colorGain} onChange={(value) => setParameter("colorGain", value)} />
    <Slider chineseLabel="对比度" label="Contrast" min={40} max={180} suffix="%" value={parameters.contrast} onChange={(value) => setParameter("contrast", value)} />
    <Slider chineseLabel="饱和度" label="Saturation" min={0} max={180} suffix="%" value={parameters.saturation} onChange={(value) => setParameter("saturation", value)} />
  </ParameterGrid>;
  if (selectedNode === "grid") return <ParameterGrid>
    <Slider chineseLabel="实例列数" label="Grid columns" min={10} max={48} value={parameters.gridColumns} onChange={(value) => setParameter("gridColumns", value)} />
    <Slider chineseLabel="实例行数" label="Grid rows" min={10} max={48} value={parameters.gridRows} onChange={(value) => setParameter("gridRows", value)} />
    <Slider chineseLabel="横向范围" label="Grid scale X" min={40} max={130} suffix="%" value={parameters.gridScaleX} onChange={(value) => setParameter("gridScaleX", value)} />
    <Slider chineseLabel="纵向范围" label="Grid scale Y" min={40} max={130} suffix="%" value={parameters.gridScaleY} onChange={(value) => setParameter("gridScaleY", value)} />
  </ParameterGrid>;
  if (selectedNode === "sopTo") return <SegmentedControl label="Position range" title="位置值范围" value={parameters.normalizedPosition ? "normalized" : "raw"} options={[{ value: "normalized", label: "归一化" }, { value: "raw", label: "原始范围" }]} onChange={(value) => setParameter("normalizedPosition", value === "normalized")} />;
  if (selectedNode === "positionSelect") return <SegmentedControl label="Position channels" title="保留位置通道" value={parameters.positionAxes} options={[{ value: "xy", label: "tx + ty" }, { value: "x", label: "仅 tx" }, { value: "y", label: "仅 ty" }]} onChange={(value) => setParameter("positionAxes", value as PreviewParameters["positionAxes"])} />;
  if (selectedNode === "topToColor") return <SegmentedControl label="Pixel sample mode" title="像素采样方式" value={parameters.sampleMode} options={[{ value: "rgb", label: "RGB" }, { value: "luma", label: "亮度" }]} onChange={(value) => setParameter("sampleMode", value as PreviewParameters["sampleMode"])} />;
  if (selectedNode === "colorShuffle") return <SegmentedControl label="Color channel order" title="颜色通道顺序" value={parameters.channelOrder} options={[{ value: "rgb", label: "RGB" }, { value: "bgr", label: "BGR" }]} onChange={(value) => setParameter("channelOrder", value as PreviewParameters["channelOrder"])} />;
  if (selectedNode === "colorSelect") return <SegmentedControl label="Selected color channels" title="保留颜色通道" value={parameters.colorChannels} options={[{ value: "rgb", label: "RGB" }, { value: "r", label: "R" }, { value: "g", label: "G" }, { value: "b", label: "B" }]} onChange={(value) => setParameter("colorChannels", value as PreviewParameters["colorChannels"])} />;
  if (selectedNode === "noise") return <ParameterGrid>
    <Slider chineseLabel="噪声幅度" label="Noise amplitude" min={0} max={80} value={parameters.noiseAmount} onChange={(value) => setParameter("noiseAmount", value)} />
    <Slider chineseLabel="噪声速度" label="Noise speed" min={0} max={100} value={parameters.speed} onChange={(value) => setParameter("speed", value)} />
    <Slider chineseLabel="噪声频率" label="Noise frequency" min={20} max={120} value={parameters.noiseFrequency} onChange={(value) => setParameter("noiseFrequency", value)} />
  </ParameterGrid>;
  if (selectedNode === "topToDepth") return <SegmentedControl label="Depth sampling" title="深度采样" value={parameters.depthSteps} options={[{ value: "smooth", label: "连续" }, { value: "stepped", label: "阶梯" }]} onChange={(value) => setParameter("depthSteps", value as PreviewParameters["depthSteps"])} />;
  if (selectedNode === "depthShuffle") return <SegmentedControl label="Depth direction" title="深度方向" value={parameters.depthInvert ? "invert" : "normal"} options={[{ value: "normal", label: "正向" }, { value: "invert", label: "反向" }]} onChange={(value) => setParameter("depthInvert", value === "invert")} />;
  if (selectedNode === "depthSelect") return <SegmentedControl label="Depth clamp" title="tz 数值范围" value={parameters.depthClamp ? "positive" : "signed"} options={[{ value: "signed", label: "正负起伏" }, { value: "positive", label: "只向前" }]} onChange={(value) => setParameter("depthClamp", value === "positive")} />;
  if (selectedNode === "math") return <ParameterGrid>
    <Slider chineseLabel="Z 轴倍增" label="tz multiply" min={10} max={160} suffix="%" value={parameters.mathScale} onChange={(value) => setParameter("mathScale", value)} />
    <Slider chineseLabel="Z 轴偏移" label="tz offset" min={-40} max={40} value={parameters.mathOffset} onChange={(value) => setParameter("mathOffset", value)} />
  </ParameterGrid>;
  if (selectedNode === "merge") return <div className="mt-4 grid grid-cols-3 gap-2" aria-label="Merge 输入支路">
    <FlowToggle active={connected.positionFlow} label="tx / ty" onClick={() => toggleFlow("positionFlow")} />
    <FlowToggle active={connected.colorFlow} label="RGB" onClick={() => toggleFlow("colorFlow")} />
    <FlowToggle active={connected.depthFlow} label="tz" onClick={() => toggleFlow("depthFlow")} />
  </div>;
  if (selectedNode === "box") return <div><SegmentedControl label="Particle shape" title="粒子形状" value={parameters.pointShape} options={[{ value: "square", label: "方形" }, { value: "circle", label: "圆形" }]} onChange={(value) => setParameter("pointShape", value as PreviewParameters["pointShape"])} /><ParameterGrid><Slider chineseLabel="粒子尺寸" label="Box particle size" min={2} max={10} value={parameters.pointSize} onChange={(value) => setParameter("pointSize", value)} /></ParameterGrid></div>;
  if (selectedNode === "light") return <ParameterGrid>
    <Slider chineseLabel="灯光强度" label="Light intensity" min={20} max={180} suffix="%" value={parameters.lightIntensity} onChange={(value) => setParameter("lightIntensity", value)} />
    <Slider chineseLabel="灯光暖度" label="Light warmth" min={0} max={100} value={parameters.lightWarmth} onChange={(value) => setParameter("lightWarmth", value)} />
  </ParameterGrid>;
  if (selectedNode === "camera") return <ParameterGrid>
    <Slider chineseLabel="镜头距离" label="Camera zoom" min={60} max={145} suffix="%" value={parameters.cameraZoom} onChange={(value) => setParameter("cameraZoom", value)} />
    <Slider chineseLabel="镜头倾角" label="Camera tilt" min={-35} max={35} suffix="°" value={parameters.cameraTilt} onChange={(value) => setParameter("cameraTilt", value)} />
  </ParameterGrid>;
  if (selectedNode === "geo") return <ParameterGrid><Slider chineseLabel="实例整体缩放" label="Instance scale" min={50} max={140} suffix="%" value={parameters.geoScale} onChange={(value) => setParameter("geoScale", value)} /></ParameterGrid>;
  if (selectedNode === "phong") return <ParameterGrid><Slider chineseLabel="高光强度" label="Material shine" min={0} max={100} value={parameters.materialShine} onChange={(value) => setParameter("materialShine", value)} /></ParameterGrid>;
  if (selectedNode === "render") return <ParameterGrid>
    <Slider chineseLabel="画面曝光" label="Render exposure" min={40} max={170} suffix="%" value={parameters.renderExposure} onChange={(value) => setParameter("renderExposure", value)} />
    <Slider chineseLabel="背景亮度" label="Background level" min={0} max={30} value={parameters.backgroundLevel} onChange={(value) => setParameter("backgroundLevel", value)} />
  </ParameterGrid>;
  return <ReadOnlyNodeState title="该节点负责数据传递" value="不直接改变画面参数" />;
}

function ParameterGrid({ children }: { children: ReactNode }) {
  return <div className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2">{children}</div>;
}

function Slider({ chineseLabel, label, value, min, max, onChange, suffix = "" }: { chineseLabel: string; label: string; value: number; min: number; max: number; onChange: (value: number) => void; suffix?: string }) {
  return <label className="mt-4 block rounded-xl border border-white/[.07] bg-white/[.025] px-3 py-2.5 text-[10px] font-black text-white/60"><span>{chineseLabel}</span><span className="ml-1 font-mono text-[8px] font-medium text-white/30">{label}</span><span className="float-right rounded-md bg-[#79d8bd]/10 px-1.5 py-0.5 font-mono text-[#9ce5d0]">{value}{suffix}</span><input aria-label={label} className="mt-3 h-1.5 w-full accent-[#79d8bd]" max={max} min={min} onChange={(event) => onChange(Number(event.target.value))} type="range" value={value} /></label>;
}

function SegmentedControl({ label, title, value, options, onChange }: { label: string; title: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <fieldset aria-label={label} className="mt-4 rounded-xl border border-white/[.07] bg-white/[.025] p-3"><legend className="px-1 text-[10px] font-black text-white/60">{title}<span className="ml-1 font-mono text-[8px] font-medium text-white/30">{label}</span></legend><div className="flex flex-wrap gap-1.5">{options.map((option) => <button aria-pressed={value === option.value} className={`rounded-lg border px-3 py-1.5 text-[10px] font-black transition ${value === option.value ? "border-[#79d8bd]/50 bg-[#79d8bd]/15 text-[#a5ecd8]" : "border-white/10 bg-black/15 text-white/40 hover:text-white/70"}`} key={option.value} onClick={() => onChange(option.value)} type="button">{option.label}</button>)}</div></fieldset>;
}

function FlowToggle({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button aria-pressed={active} className={`rounded-xl border px-2 py-3 text-xs font-black transition ${active ? "border-[#79d8bd]/45 bg-[#79d8bd]/10 text-[#9ce5d0]" : "border-[#ff765f]/40 bg-[#ff765f]/10 text-[#ff9b89]"}`} onClick={onClick} type="button"><span className="block text-[8px] opacity-55">{active ? "已接入" : "已断开"}</span>{label}</button>;
}

function ReadOnlyNodeState({ title, value }: { title: string; value: string }) {
  return <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-dashed border-white/15 bg-black/15 px-4 py-3"><div><p className="text-[10px] font-black text-white/65">{title}</p><p className="mt-1 text-[9px] text-white/35">结构节点保持数据稳定，因此不伪造视觉参数。</p></div><span className="shrink-0 rounded-lg bg-white/5 px-2.5 py-1.5 font-mono text-[9px] text-[#9ce5d0]">{value}</span></div>;
}

function RealProjectPreview() {
  return <div className="group relative aspect-square overflow-hidden rounded-2xl border border-[#ffbf47]/25 bg-black shadow-[0_24px_70px_rgba(0,0,0,.38)]" aria-label="课程工程真实 Render 输出">
    <video aria-label="图片粒子化课程工程真实动态效果" autoPlay className="size-full object-cover" controls controlsList="nodownload" loop muted playsInline poster="/media/touchdesigner-particle-output-poster.jpg" preload="metadata">
      <source src="/media/touchdesigner-particle-output.mp4" type="video/mp4" />
    </video>
    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/75 to-transparent p-3.5"><span className="rounded-full border border-[#ffcc68]/35 bg-black/55 px-2.5 py-1 text-[9px] font-black tracking-[0.12em] text-[#ffd77d]">课程工程录屏</span><span className="rounded-full bg-[#e4472f] px-2.5 py-1 text-[9px] font-black text-white"><i className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-white" />LIVE LOOP</span></div>
    <div className="pointer-events-none absolute inset-x-0 bottom-10 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pb-3 pt-12"><p className="text-[10px] font-black tracking-[0.16em] text-[#ffca61]">RENDER TOP · 最终形成效果</p><p className="mt-1 text-xs text-white/65">真实 `.toe` 工程导出的 14 秒动态结果，不是网页模拟图。</p></div>
  </div>;
}

function FormationRail({ activeStage }: { activeStage: PreviewStage }) {
  const steps = [
    { index: "01", title: "图像像素", note: "TOP 读取颜色" },
    { index: "02", title: "实例数据", note: "tx / ty · RGB · tz" },
    { index: "03", title: "Render 输出", note: "Geo 实例化成像" },
  ];
  const activeStep = activeStage === "source" ? 0 : ["position", "color", "depth", "merge"].includes(activeStage) ? 1 : 2;

  return <div aria-label="图片粒子化形成阶段" className="mt-3 grid grid-cols-3 gap-1.5 rounded-2xl border border-white/10 bg-white/[.025] p-2">
    {steps.map((step, index) => <div aria-current={activeStep === index ? "step" : undefined} className={`relative overflow-hidden rounded-xl border px-2 py-2 text-left transition ${activeStep === index ? "border-[#ffbf47]/55 bg-[#ffbf47]/10" : index < activeStep ? "border-[#79d8bd]/15 bg-[#79d8bd]/[.04]" : "border-transparent bg-black/10"}`} key={step.index}><span className={`text-[8px] font-black ${activeStep === index ? "text-[#ffca61]" : index < activeStep ? "text-[#79d8bd]" : "text-white/25"}`}>{index < activeStep ? "✓" : step.index}</span><strong className="mt-0.5 block text-[10px] text-white/80">{step.title}</strong><span className="mt-0.5 block truncate text-[8px] text-white/35">{step.note}</span>{activeStep === index ? <i aria-hidden="true" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#ffbf47]" /> : null}</div>)}
  </div>;
}

function ParticlePreview({ connected, parameters, focusNode, focusNodeTitle, previewStage }: { connected: Record<FlowId, boolean>; parameters: PreviewParameters; focusNode: string; focusNodeTitle: string; previewStage: PreviewStage }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const pointer = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });
  const [sourceReady, setSourceReady] = useState(false);
  const settings = useMemo(() => ({ connected, parameters, focusNode, previewStage }), [connected, focusNode, parameters, previewStage]);

  useEffect(() => {
    const sourceImage = new window.Image();
    sourceImageRef.current = sourceImage;
    sourceImage.onload = () => setSourceReady(true);
    sourceImage.src = "/media/particle-source-sunflower.jpg";
    return () => { sourceImage.onload = null; };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let context: CanvasRenderingContext2D | null = null;
    try { context = canvas.getContext("2d"); } catch { return; }
    if (!context) return;
    const ctx = context;
    let frame = 0;
    let running = true;
    let sampleKey = "";
    let samplePixels: Uint8ClampedArray | null = null;
    let sourceSampleKey = "";
    let sourceSampleCanvas: HTMLCanvasElement | null = null;
    const sourceImage = sourceImageRef.current;
    const imageReady = sourceReady && Boolean(sourceImage?.complete);

    const imageFilter = () => {
      const variant = settings.parameters.sourceVariant === "mono" ? " grayscale(1)" : settings.parameters.sourceVariant === "invert" ? " invert(1)" : "";
      return `brightness(${settings.parameters.colorGain}%) contrast(${settings.parameters.contrast}%) saturate(${settings.parameters.saturation}%)${variant}`;
    };

    const readPixels = (columns: number, rows: number) => {
      if (!imageReady || !sourceImage) return null;
      const nextKey = `${columns}x${rows}-${imageFilter()}`;
      if (samplePixels && sampleKey === nextKey) return samplePixels;
      const sampler = document.createElement("canvas");
      sampler.width = columns; sampler.height = rows;
      const sampleContext = sampler.getContext("2d", { willReadFrequently: true });
      if (!sampleContext) return null;
      sampleContext.filter = imageFilter();
      sampleContext.drawImage(sourceImage, 0, 0, columns, rows);
      samplePixels = sampleContext.getImageData(0, 0, columns, rows).data;
      sampleKey = nextKey;
      return samplePixels;
    };

    const drawMessage = (width: number, height: number, message: string) => {
      ctx.strokeStyle = "rgba(255,118,95,.45)"; ctx.setLineDash([7, 7]); ctx.strokeRect(28, 28, width - 56, height - 56); ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,.74)"; ctx.font = "700 15px Microsoft YaHei UI"; ctx.textAlign = "center"; ctx.fillText(message, width / 2, height / 2);
    };

    const draw = (time: number) => {
      if (!running) return;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(460, Math.round(rect.width || 760));
      const height = Math.max(330, Math.round(rect.height || 430));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) { canvas.width = width * dpr; canvas.height = height * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const background = settings.parameters.backgroundLevel;
      const gradient = ctx.createRadialGradient(width * .48, height * .45, 10, width * .5, height * .5, width * .66);
      gradient.addColorStop(0, `rgb(${background + 31},${background + 29},${background + 16})`); gradient.addColorStop(.58, `rgb(${background + 12},${background + 18},${background + 13})`); gradient.addColorStop(1, `rgb(${background},${background + 5},${background + 4})`);
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);

      const sourceRequired = ["source", "color", "depth", "merge", "scene", "final"].includes(settings.previewStage);
      const renderRequired = ["scene", "final"].includes(settings.previewStage);
      if (sourceRequired && !settings.connected.sourceFlow) drawMessage(width, height, "素材支路断开：当前节点没有图像输入");
      else if (settings.previewStage === "position" && !settings.connected.positionFlow) drawMessage(width, height, "位置支路断开：tx / ty 没有数据");
      else if (settings.previewStage === "color" && !settings.connected.colorFlow) drawMessage(width, height, "颜色支路断开：RGB 没有数据");
      else if (settings.previewStage === "depth" && !settings.connected.depthFlow) drawMessage(width, height, "动态支路断开：tz 没有数据");
      else if (renderRequired && !settings.connected.renderFlow) drawMessage(width, height, "Render TOP 未接收到 Camera / Light / Geo");
      else if (["object", "scene", "final"].includes(settings.previewStage) && !settings.connected.objectFlow) drawMessage(width, height, "Box SOP 断开：没有可实例化的粒子实体");
      else if (["merge", "scene", "final"].includes(settings.previewStage) && (!settings.connected.positionFlow || !settings.connected.instanceData)) drawMessage(width, height, "tx / ty 未进入 Geo Instancing：粒子没有位置");
      else if (settings.previewStage === "source") {
        if (imageReady && sourceImage) {
          const size = Math.min(width, height) * .82 * settings.parameters.sourceZoom / 100;
          const left = (width - size) / 2; const top = (height - size) / 2;
          ctx.save();
          ctx.filter = imageFilter();
          if (["resolution", "constant"].includes(settings.focusNode)) {
            const columns = settings.parameters.resolutionColumns; const rows = settings.parameters.resolutionRows;
            const nextKey = `${columns}x${rows}-${imageFilter()}`;
            if (!sourceSampleCanvas || sourceSampleKey !== nextKey) {
              sourceSampleCanvas = document.createElement("canvas"); sourceSampleCanvas.width = columns; sourceSampleCanvas.height = rows;
              const sampleContext = sourceSampleCanvas.getContext("2d");
              if (sampleContext) { sampleContext.filter = imageFilter(); sampleContext.drawImage(sourceImage, 0, 0, columns, rows); }
              sourceSampleKey = nextKey;
            }
            ctx.filter = "none";
            ctx.imageSmoothingEnabled = false; ctx.drawImage(sourceSampleCanvas, left, top, size, size); ctx.imageSmoothingEnabled = true;
          } else ctx.drawImage(sourceImage, left, top, size, size);
          ctx.restore();
        } else drawMessage(width, height, "正在载入课程原图…");
      } else if (settings.previewStage === "position") {
        const columns = settings.parameters.gridColumns; const rows = settings.parameters.gridRows; const baseSpan = Math.min(width, height) * (settings.parameters.normalizedPosition ? .74 : .58);
        const spanX = baseSpan * settings.parameters.gridScaleX / 100; const spanY = baseSpan * settings.parameters.gridScaleY / 100;
        const gapX = spanX / Math.max(1, columns - 1); const gapY = spanY / Math.max(1, rows - 1);
        ctx.fillStyle = "rgba(121,216,189,.78)";
        for (let row = 0; row < rows; row += 1) for (let col = 0; col < columns; col += 1) {
          const x = settings.parameters.positionAxes === "y" ? width / 2 : (width - spanX) / 2 + col * gapX;
          const y = settings.parameters.positionAxes === "x" ? height / 2 : (height - spanY) / 2 + row * gapY;
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
        ctx.fillStyle = "rgba(255,255,255,.38)"; ctx.font = "700 11px Microsoft YaHei UI"; ctx.textAlign = "left";
        ctx.fillText(`tx × ${columns}`, Math.max(14, (width - spanX) / 2), Math.min(height - 12, (height + spanY) / 2 + 24)); ctx.fillText(`ty × ${rows}`, Math.min(width - 54, (width + spanX) / 2 - 42), Math.max(18, (height - spanY) / 2 - 12));
      } else if (settings.previewStage === "object") {
        const base = Math.min(width, height) * .12 * settings.parameters.pointSize / 4;
        ctx.fillStyle = "#d5ae42"; ctx.strokeStyle = "rgba(255,220,120,.8)"; ctx.lineWidth = 2;
        if (settings.parameters.pointShape === "circle") { ctx.beginPath(); ctx.arc(width / 2, height / 2, base / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
        else { ctx.fillRect(width / 2 - base / 2, height / 2 - base / 2, base, base); ctx.strokeRect(width / 2 - base / 2, height / 2 - base / 2, base, base); }
        ctx.fillStyle = "rgba(255,255,255,.64)"; ctx.font = "700 13px Microsoft YaHei UI"; ctx.textAlign = "center"; ctx.fillText("Box SOP × 1", width / 2, height / 2 + base / 2 + 28);
      } else {
        const columns = settings.parameters.gridColumns; const rows = settings.parameters.gridRows; const pixels = readPixels(columns, rows); const span = Math.min(width, height) * .76;
        if (pixels) {
          const particles: Array<{ x: number; y: number; z: number; r: number; g: number; b: number }> = [];
          const seconds = time / 1000; const frequency = settings.parameters.noiseFrequency / 10;
          for (let row = 0; row < rows; row += 1) for (let col = 0; col < columns; col += 1) {
            const pixelIndex = (row * columns + col) * 4;
            let nx = col / Math.max(1, columns - 1) * 2 - 1; let ny = row / Math.max(1, rows - 1) * 2 - 1;
            nx *= settings.parameters.gridScaleX / 100; ny *= settings.parameters.gridScaleY / 100;
            if (settings.parameters.positionAxes === "x") ny = 0; if (settings.parameters.positionAxes === "y") nx = 0;
            let noise = (Math.sin(nx * frequency + seconds * settings.parameters.speed / 16) + Math.cos(ny * frequency * .82 - seconds * settings.parameters.speed / 21)) / 2;
            if (settings.parameters.depthSteps === "stepped") noise = Math.round(noise * 4) / 4;
            if (settings.parameters.depthInvert) noise *= -1;
            if (settings.parameters.depthClamp) noise = Math.max(0, noise);
            const allowsDepth = ["depth", "merge", "scene", "final"].includes(settings.previewStage) && settings.connected.depthFlow;
            const z = allowsDepth ? noise * settings.parameters.noiseAmount / 100 * settings.parameters.mathScale / 100 + settings.parameters.mathOffset / 100 : 0;
            let r = pixels[pixelIndex]; let g = pixels[pixelIndex + 1]; let b = pixels[pixelIndex + 2];
            if (settings.parameters.sampleMode === "luma") { const luma = r * .299 + g * .587 + b * .114; r = luma; g = luma; b = luma; }
            if (settings.parameters.channelOrder === "bgr") [r, b] = [b, r];
            if (settings.parameters.colorChannels === "r") { g = 0; b = 0; }
            if (settings.parameters.colorChannels === "g") { r = 0; b = 0; }
            if (settings.parameters.colorChannels === "b") { r = 0; g = 0; }
            particles.push({ x: nx, y: ny, z, r, g, b });
          }
          particles.sort((left, right) => left.z - right.z);
          for (const particle of particles) {
            const angle = settings.parameters.cameraTilt * Math.PI / 180; const cos = Math.cos(angle); const sin = Math.sin(angle);
            const rotatedX = particle.x * cos - particle.y * sin; const rotatedY = particle.x * sin + particle.y * cos;
            const sceneScale = settings.parameters.cameraZoom / 100 * settings.parameters.geoScale / 100;
            let x = width / 2 + rotatedX * span / 2 * sceneScale + particle.z * 28;
            let y = height / 2 + rotatedY * span / 2 * sceneScale - particle.z * 72;
            if (pointer.current.active) {
              const dx = x - pointer.current.x; const dy = y - pointer.current.y; const distance = Math.sqrt(dx * dx + dy * dy);
              if (distance < 86 && distance > 1) { const push = (86 - distance) / 86; x += dx / distance * push * 24; y += dy / distance * push * 24; }
            }
            const hasColor = settings.connected.colorFlow && (["color", "merge"].includes(settings.previewStage) || (["scene", "final"].includes(settings.previewStage) && settings.connected.materialFlow));
            const gain = settings.parameters.renderExposure / 100 * settings.parameters.lightIntensity / 100; const light = .62 + particle.z * (.25 + settings.parameters.materialShine / 110); const warmth = (settings.parameters.lightWarmth - 50) / 100;
            const r = Math.max(0, Math.min(255, particle.r * gain * light * (1 + warmth * .35))); const g = Math.max(0, Math.min(255, particle.g * gain * light)); const b = Math.max(0, Math.min(255, particle.b * gain * light * (1 - warmth * .28)));
            const dot = Math.max(1.4, settings.parameters.pointSize * (.62 + particle.z * .45) * settings.parameters.geoScale / 100);
            ctx.fillStyle = hasColor ? `rgba(${r},${g},${b},.92)` : settings.previewStage === "depth" ? `rgba(${90 + particle.z * 100},${185 + particle.z * 55},${178 + particle.z * 40},.82)` : "rgba(225,229,224,.74)";
            if (settings.parameters.pointShape === "circle") { ctx.beginPath(); ctx.arc(x, y, dot / 2, 0, Math.PI * 2); ctx.fill(); }
            else ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
          }
        }
      }
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => { running = false; window.cancelAnimationFrame(frame); };
  }, [settings, sourceReady]);

  return <div className="relative aspect-square overflow-hidden rounded-2xl border border-[#79d8bd]/20 bg-[#09100e] shadow-inner"><canvas aria-label="图片粒子化 Instancing 实时效果" className="size-full" onPointerLeave={() => { pointer.current.active = false; }} onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); pointer.current = { x: event.clientX - rect.left, y: event.clientY - rect.top, active: true }; }} ref={canvasRef} /><div aria-live="polite" className="pointer-events-none absolute inset-x-3 top-3 flex items-center justify-between gap-2"><span className="rounded-full border border-[#79d8bd]/25 bg-black/65 px-2.5 py-1 text-[9px] font-black text-[#9be3cf]">当前节点输出：{focusNodeTitle}</span><span className="rounded-full border border-white/10 bg-black/65 px-2.5 py-1 text-[9px] font-black text-white/65">{previewStageLabel[previewStage]}</span></div><p className="pointer-events-none absolute inset-x-3 bottom-3 rounded-xl bg-black/65 px-3 py-2 text-[10px] leading-4 text-white/55">点击右侧其他节点，预览会切换到该节点处理完成后的状态。</p></div>;
}
