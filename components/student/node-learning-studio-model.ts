import type { Edge, Node } from "@xyflow/react";

import type { NodeCatalogEntry, NodeCatalogResponse, StudioFamily } from "@/lib/touchdesigner/node-catalog-shared";

export type StudioNodeData = {
  entry: NodeCatalogEntry;
  state: "placed" | "suggested";
  step?: number;
};

export type StudioFlowNode = Node<StudioNodeData, "studio">;
export type StudioFlowEdge = Edge<{ relation: "wire" | "parameter" }>;
export type PreviewSettings = {
  gain: number;
  sensitivity: number;
  smoothing: number;
  brightness: number;
  displacement: number;
};

export const FAMILY_COLORS: Record<StudioFamily, { color: string; surface: string }> = {
  TOP: { color: "#b79af7", surface: "#2d2250" },
  CHOP: { color: "#78d695", surface: "#173d28" },
  POP: { color: "#f08cb8", surface: "#4d2037" },
  SOP: { color: "#76b7e8", surface: "#183a51" },
  DAT: { color: "#ef8787", surface: "#4a2328" },
  MAT: { color: "#e6c85b", surface: "#453b16" },
  COMP: { color: "#aeb8bd", surface: "#30383b" },
};

export const AUDIO_PLAN = [
  { family: "CHOP", operatorType: "audiodevin", x: 60, y: 150 },
  { family: "CHOP", operatorType: "analyze", x: 270, y: 150 },
  { family: "CHOP", operatorType: "math", x: 480, y: 150 },
  { family: "CHOP", operatorType: "filter", x: 690, y: 150 },
  { family: "TOP", operatorType: "level", x: 900, y: 150 },
] as const;

export const AUDIO_EDGE_PLAN = [
  ["audiodevin", "analyze", "wire"],
  ["analyze", "math", "wire"],
  ["math", "filter", "wire"],
  ["filter", "level", "parameter"],
] as const;

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  gain: 1,
  sensitivity: 1.4,
  smoothing: 0.72,
  brightness: 1.15,
  displacement: 0.65,
};

export const NODE_STUDIO_STORAGE_KEY = "tonggan-node-learning-studio:v1";

export function buildNodeAgentFocus(
  selectedNode: StudioFlowNode | null,
  nodes: StudioFlowNode[],
  edges: StudioFlowEdge[],
  initialFocus?: string | null,
) {
  const placed = nodes.filter((node) => node.data.state === "placed").length;
  const suggested = nodes.length - placed;
  const selected = selectedNode
    ? `选中${selectedNode.data.entry.operatorType}1（${selectedNode.data.entry.family}·${selectedNode.data.entry.chineseName}）`
    : "尚未选中节点";
  const entry = initialFocus ? `入口任务${initialFocus}` : "自由搭建";
  return `节点画布；${entry}；${selected}；已加入${placed}个、建议${suggested}个、连线${edges.length}条`.slice(0, 160);
}

export function makeStudioEdge(
  source: StudioFlowNode,
  target: StudioFlowNode,
  relation: "wire" | "parameter",
  index: number,
): StudioFlowEdge {
  const parameter = relation === "parameter";
  return {
    id: `edge-${source.id}-${target.id}-${index}`,
    source: source.id,
    target: target.id,
    type: "smoothstep",
    animated: parameter,
    label: parameter ? "Export → brightness" : undefined,
    labelStyle: { fill: "#9be2cc", fontSize: 9, fontWeight: 700 },
    labelBgStyle: { fill: "#10231e", fillOpacity: 0.92 },
    style: {
      stroke: parameter ? "#73d7ba" : FAMILY_COLORS[source.data.entry.family].color,
      strokeWidth: 2,
      strokeDasharray: parameter ? "7 5" : undefined,
    },
    data: { relation },
  };
}

export function browserParameters(entry: NodeCatalogEntry, settings: PreviewSettings) {
  const map: Record<string, Array<{ key: keyof PreviewSettings; label: string; english: string; min: number; max: number; step: number }>> = {
    audiodevin: [{ key: "gain", label: "输入增益", english: "Gain", min: 0.1, max: 2.5, step: 0.05 }],
    analyze: [{ key: "sensitivity", label: "分析灵敏度", english: "Function / RMS sensitivity", min: 0.4, max: 3, step: 0.05 }],
    math: [{ key: "brightness", label: "输出范围上限", english: "To Range 2", min: 0.3, max: 2, step: 0.05 }],
    filter: [{ key: "smoothing", label: "平滑强度", english: "Filter Width", min: 0.02, max: 0.96, step: 0.01 }],
    level: [
      { key: "brightness", label: "亮度", english: "Brightness", min: 0.3, max: 2, step: 0.05 },
      { key: "displacement", label: "画面位移强度", english: "Displacement", min: 0, max: 1, step: 0.02 },
    ],
  };
  return (map[entry.operatorType] ?? []).map((parameter) => ({ ...parameter, value: settings[parameter.key] }));
}

export function nodeIo(entry: NodeCatalogEntry) {
  const familyData = ({
    TOP: "图像像素", CHOP: "连续通道数值", POP: "GPU 点与属性", SOP: "几何点、线和面",
    DAT: "文字、表格或脚本", MAT: "材质属性", COMP: "组件与场景对象",
  } satisfies Record<StudioFamily, string>)[entry.family];
  const generator = ["audiodevin", "audiofilein", "noise", "constant", "grid", "box", "sphere", "table", "text", "pointgenerator", "cam", "light"].includes(entry.operatorType);
  return { input: generator ? "无输入，主动生成数据" : familyData, output: familyData };
}

export function nodeLearningAction(entry: NodeCatalogEntry) {
  return ({
    audiodevin: "它是信号起点，把麦克风空气振动转换成连续的 CHOP 数值。",
    analyze: "它把一段复杂声音压缩成一个可控制画面的音量数值。",
    math: "它把原始音量重新映射到画面能够使用的范围，避免变化过小或过强。",
    filter: "它消除音量的瞬间抖动，让画面响应更顺滑。",
    level: "它接收 CHOP 的参数 Export，用音量改变画面亮度；它与 CHOP 之间不是普通导线。",
  } as Record<string, string>)[entry.operatorType] ?? `它在当前网络中负责${entry.chineseName}；先观察输入数据，再判断输出应交给哪个同家族节点。`;
}

export function disconnectEffect(entry: NodeCatalogEntry) {
  return ({
    audiodevin: "后续网络失去声音来源。",
    analyze: "声音仍存在，但没有稳定的音量控制值。",
    math: "音量范围没有重新映射，画面可能几乎不动或变化过强。",
    filter: "画面仍可响应，但容易抖动和跳变。",
    level: "数值仍在流动，但画面不再被它驱动。",
  } as Record<string, string>)[entry.operatorType] ?? "当前支路会失去这一阶段的处理结果。";
}

export function readAudioLevel(
  source: "SIMULATED" | "MICROPHONE" | "PAUSED",
  analyser: AnalyserNode | null,
  time: number,
  gain: number,
) {
  if (source === "PAUSED") return 0.08;
  if (source === "MICROPHONE" && analyser) {
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const value of data) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 4 * gain);
  }
  const seconds = time / 1000;
  return Math.min(1, (0.18 + Math.abs(Math.sin(seconds * 2.3)) * 0.36 + Math.abs(Math.sin(seconds * 5.7)) * 0.2) * gain);
}

export function drawAudioVisual(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  level: number,
  settings: PreviewSettings,
  edgesComplete: number,
) {
  const seconds = time / 1000;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#07100d");
  gradient.addColorStop(0.55, "#10261f");
  gradient.addColorStop(1, "#171329");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const gap = 26 * dpr;
  const amplitude = (edgesComplete === 4 ? 24 + level * 95 * settings.displacement : 3) * dpr;
  const baseRadius = (1.5 + level * 3.2) * dpr;
  for (let row = 0, y = gap; y < height - gap; row += 1, y += gap) {
    for (let col = 0, x = gap; x < width - gap; col += 1, x += gap) {
      const wave = Math.sin(col * 0.46 + seconds * 3.1) * Math.cos(row * 0.38 + seconds * 2.2);
      ctx.beginPath();
      ctx.arc(x, y + wave * amplitude, baseRadius * (0.7 + Math.abs(wave) * 0.65), 0, Math.PI * 2);
      const lightness = Math.min(74, 43 + level * 28 * settings.brightness);
      ctx.fillStyle = `hsla(${156 + level * 72 + col * 0.8}, 72%, ${lightness}%, ${0.45 + level * 0.5})`;
      ctx.fill();
    }
  }
  const glow = ctx.createRadialGradient(width * 0.52, height * 0.48, 0, width * 0.52, height * 0.48, width * 0.42);
  glow.addColorStop(0, `rgba(68, 224, 170, ${0.05 + level * 0.12})`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

export function isNodeCatalog(value: unknown): value is NodeCatalogResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NodeCatalogResponse>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.entries) && Boolean(candidate.totals);
}

export function readCatalogError(value: unknown) {
  return typeof value === "object" && value && "error" in value && typeof value.error === "string"
    ? value.error
    : "节点目录加载失败";
}
