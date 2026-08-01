"use client";

import { addEdge, useEdgesState, useNodesState, useReactFlow, type Connection } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import type { NodeCatalogEntry, NodeCatalogResponse, StudioFamily } from "@/lib/touchdesigner/node-catalog-shared";

import {
  AUDIO_EDGE_PLAN,
  AUDIO_PLAN,
  buildNodeAgentFocus,
  DEFAULT_PREVIEW_SETTINGS,
  isNodeCatalog,
  makeStudioEdge,
  NODE_STUDIO_STORAGE_KEY,
  nodeLearningAction,
  readCatalogError,
  type PreviewSettings,
  type StudioFlowEdge,
  type StudioFlowNode,
} from "./node-learning-studio-model";

export function useNodeLearningStudio({
  initialFocus,
  onAgentFocusChange,
}: {
  initialFocus?: string | null;
  onAgentFocusChange?: (focus: string | null) => void;
}) {
  const [catalog, setCatalog] = useState<NodeCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [family, setFamily] = useState<StudioFamily>("CHOP");
  const [query, setQuery] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<StudioFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<StudioFlowEdge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("声音驱动画面的最小节点练习已准备。请先观察建议，再决定是否加入。");
  const [settings, setSettings] = useState<PreviewSettings>(DEFAULT_PREVIEW_SETTINGS);
  const bootstrapped = useRef(false);
  const nodeSequence = useRef(0);
  const { screenToFlowPosition, fitView } = useReactFlow<StudioFlowNode, StudioFlowEdge>();

  useEffect(() => {
    const controller = new AbortController();
    async function loadCatalog() {
      try {
        const response = await fetch("/api/touchdesigner-node-catalog", {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        const raw: unknown = await response.json();
        if (!response.ok || !isNodeCatalog(raw)) throw new Error(readCatalogError(raw));
        setCatalog(raw);
      } catch (reason) {
        if (!controller.signal.aborted) setCatalogError(reason instanceof Error ? reason.message : "节点目录加载失败");
      }
    }
    void loadCatalog();
    return () => controller.abort();
  }, []);

  const findEntry = useCallback((targetFamily: StudioFamily, operatorType: string) =>
    catalog?.entries.find((entry) => entry.family === targetFamily && entry.operatorType === operatorType), [catalog]);

  const prepareAudioPlan = useCallback(() => {
    if (!catalog) return;
    const planned = AUDIO_PLAN.flatMap((item, index) => {
      const entry = findEntry(item.family, item.operatorType);
      return entry ? [{
        id: `plan-${item.operatorType}`,
        type: "studio" as const,
        position: { x: item.x, y: item.y },
        data: { entry, state: "suggested" as const, step: index + 1 },
      }] : [];
    });
    setNodes(planned);
    setEdges([]);
    setSelectedId(planned[0]?.id ?? null);
    setNotice("5 个半透明节点是练习建议，不是已完成作品。请逐个加入并连接。");
    requestAnimationFrame(() => void fitView({ padding: 0.18, duration: 500 }));
  }, [catalog, findEntry, fitView, setEdges, setNodes]);

  useEffect(() => {
    if (!catalog || bootstrapped.current) return;
    bootstrapped.current = true;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const saved = window.localStorage.getItem(NODE_STUDIO_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as { nodes: StudioFlowNode[]; edges: StudioFlowEdge[]; settings?: PreviewSettings };
          if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
            setNodes(parsed.nodes);
            setEdges(parsed.edges);
            if (parsed.settings) setSettings(parsed.settings);
            setSelectedId(parsed.nodes[0]?.id ?? null);
            setNotice("已恢复你上次保存的节点工程。");
            return;
          }
        } catch {
          window.localStorage.removeItem(NODE_STUDIO_STORAGE_KEY);
        }
      }
      prepareAudioPlan();
    });
    return () => { active = false; };
  }, [catalog, prepareAudioPlan, setEdges, setNodes]);

  const visibleEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (catalog?.entries ?? []).filter((entry) => entry.family === family && (!needle || `${entry.englishName} ${entry.chineseName} ${entry.description}`.toLowerCase().includes(needle)));
  }, [catalog, family, query]);

  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const placedCount = nodes.filter((node) => node.data.state === "placed").length;
  const suggestedCount = nodes.length - placedCount;
  const completedAudioEdges = AUDIO_EDGE_PLAN.filter(([sourceType, targetType]) => {
    const source = nodes.find((node) => node.data.entry.operatorType === sourceType && node.data.state === "placed");
    const target = nodes.find((node) => node.data.entry.operatorType === targetType && node.data.state === "placed");
    return source && target && edges.some((edge) => edge.source === source.id && edge.target === target.id);
  }).length;
  const agentFocus = useMemo(
    () => buildNodeAgentFocus(selectedNode, nodes, edges, initialFocus),
    [edges, initialFocus, nodes, selectedNode],
  );

  useEffect(() => {
    onAgentFocusChange?.(agentFocus);
  }, [agentFocus, onAgentFocusChange]);

  function addCatalogNode(entry: NodeCatalogEntry, position?: { x: number; y: number }) {
    const id = `${entry.family}-${entry.operatorType}-added-${++nodeSequence.current}`;
    const node: StudioFlowNode = {
      id,
      type: "studio",
      position: position ?? { x: 180 + nodes.length * 24, y: 260 + nodes.length * 18 },
      data: { entry, state: "placed" },
    };
    setNodes((current) => [...current, node]);
    setSelectedId(id);
    setNotice(`${entry.englishName} 已加入画布。先阅读右侧解释，再决定连接位置。`);
  }

  function acceptNextSuggestion() {
    const next = nodes.find((node) => node.data.state === "suggested");
    if (!next) {
      setNotice("建议节点已经全部加入。现在请根据数据关系连接它们。");
      return;
    }
    setNodes((current) => current.map((node) => node.id === next.id ? { ...node, data: { ...node.data, state: "placed" } } : node));
    setSelectedId(next.id);
    setNotice(`${next.data.entry.englishName} 已加入。${nodeLearningAction(next.data.entry)}`);
  }

  function acceptSelectedSuggestion() {
    if (!selectedNode || selectedNode.data.state !== "suggested") return;
    setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, state: "placed" } } : node));
    setNotice(`${selectedNode.data.entry.englishName} 已加入画布。现在可以建立连接。`);
  }

  function loadCompletedAudioDemo() {
    if (!catalog) return;
    const demoNodes = AUDIO_PLAN.flatMap((item, index) => {
      const entry = findEntry(item.family, item.operatorType);
      return entry ? [{ id: `demo-${item.operatorType}`, type: "studio" as const, position: { x: item.x, y: item.y }, data: { entry, state: "placed" as const, step: index + 1 } }] : [];
    });
    const demoEdges: StudioFlowEdge[] = AUDIO_EDGE_PLAN.flatMap(([sourceType, targetType, relation], index) => {
      const source = demoNodes.find((node) => node.data.entry.operatorType === sourceType);
      const target = demoNodes.find((node) => node.data.entry.operatorType === targetType);
      return source && target ? [makeStudioEdge(source, target, relation, index)] : [];
    });
    setNodes(demoNodes);
    setEdges(demoEdges);
    setSelectedId(demoNodes[1]?.id ?? null);
    setNotice("声音驱动画面的示范网络已载入。最后一条虚线是 CHOP 对 TOP 参数的 Export，不是普通连线。");
    requestAnimationFrame(() => void fitView({ padding: 0.16, duration: 500 }));
  }

  function handleConnect(connection: Connection) {
    const source = nodes.find((node) => node.id === connection.source);
    const target = nodes.find((node) => node.id === connection.target);
    if (!source || !target || source.data.state === "suggested" || target.data.state === "suggested") {
      setNotice("先把半透明建议节点加入画布，才能建立连接。");
      return;
    }
    if (source.id === target.id) {
      setNotice("节点不能连接到自己。先明确数据要流向哪个下一步节点。");
      return;
    }
    if (edges.some((edge) => edge.source === source.id && edge.target === target.id)) {
      setNotice("这两个节点已经建立关系，不需要重复连接。");
      return;
    }
    if (source.data.entry.family === target.data.entry.family) {
      setEdges((current) => addEdge(makeStudioEdge(source, target, "wire", edges.length), current));
      setNotice(`${source.data.entry.family} 同家族连线成立：${source.data.entry.englishName} → ${target.data.entry.englishName}`);
      return;
    }
    if (source.data.entry.family === "CHOP") {
      setEdges((current) => addEdge(makeStudioEdge(source, target, "parameter", edges.length), current));
      setNotice(`已建立参数引用：${source.data.entry.englishName} 的数值 Export 到 ${target.data.entry.englishName}。`);
      return;
    }
    setNotice(`${source.data.entry.family} 与 ${target.data.entry.family} 不能直接用普通线连接。请使用转换节点或参数引用。`);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const id = event.dataTransfer.getData("application/touchdesigner-node");
    const entry = catalog?.entries.find((item) => item.id === id);
    if (entry) addCatalogNode(entry, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }

  function saveProject() {
    window.localStorage.setItem(NODE_STUDIO_STORAGE_KEY, JSON.stringify({ nodes, edges, settings }));
    setNotice("节点、连线和预览参数已保存在这台电脑中。");
  }

  function resetProject() {
    window.localStorage.removeItem(NODE_STUDIO_STORAGE_KEY);
    setSettings(DEFAULT_PREVIEW_SETTINGS);
    prepareAudioPlan();
  }

  function changeSetting(key: keyof PreviewSettings, value: number) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  return {
    catalog, catalogError, family, query, visibleEntries, nodes, edges, selectedNode, notice, settings,
    placedCount, suggestedCount, completedAudioEdges, agentFocus, onNodesChange, onEdgesChange,
    setFamily, setQuery, setSelectedId, addCatalogNode, acceptNextSuggestion, acceptSelectedSuggestion,
    loadCompletedAudioDemo, prepareAudioPlan, handleConnect, handleDrop, saveProject, resetProject, changeSetting,
  };
}
