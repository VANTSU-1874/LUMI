"use client";

import { ReactFlowProvider } from "@xyflow/react";

import { AudioReactivePreview } from "./audio-reactive-preview";
import {
  NodeCanvasPanel,
  NodeCatalogPanel,
  NodeInspector,
  SharedAgentFocus,
} from "./node-learning-studio-panels";
import { useNodeLearningStudio } from "./use-node-learning-studio";

export function NodeLearningStudio({
  initialFocus = null,
  onAgentFocusChange,
}: {
  initialFocus?: string | null;
  onAgentFocusChange?: (focus: string | null) => void;
}) {
  return <ReactFlowProvider>
    <NodeLearningStudioInner initialFocus={initialFocus} onAgentFocusChange={onAgentFocusChange} />
  </ReactFlowProvider>;
}

function NodeLearningStudioInner({
  initialFocus,
  onAgentFocusChange,
}: {
  initialFocus: string | null;
  onAgentFocusChange?: (focus: string | null) => void;
}) {
  const studio = useNodeLearningStudio({ initialFocus, onAgentFocusChange });

  return <section className="min-h-screen bg-[#0d1412] pb-28 text-white" aria-labelledby="node-learning-title">
    <header className="border-b border-white/[.08] bg-[#0f1815] px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-black tracking-[0.22em] text-[#74d4b8]">节点画布 / 从想法到可运行网络</p>
          <h1 className="mt-1 text-2xl font-black" id="node-learning-title">声音驱动画面 · 节点实验工作台</h1>
          <p className="mt-1 text-xs leading-5 text-white/48">节点库负责自由搭建，案例库负责真实工程参照；底部问答与主对话使用同一个服务端 Agent。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-xl border border-[#73d7ba]/25 bg-[#73d7ba]/10 px-3 py-2 font-black text-[#a6ead6]">浏览器原生实时运行</span>
          <button className="rounded-xl border border-white/12 bg-white/[.04] px-3 py-2 font-black hover:bg-white/[.08]" onClick={studio.saveProject} type="button">保存工程</button>
          <button className="rounded-xl border border-white/12 bg-white/[.04] px-3 py-2 font-black hover:bg-white/[.08]" onClick={studio.resetProject} type="button">重新开始</button>
          <button className="rounded-xl border-b-4 border-[#a86f00] bg-[#ffbf47] px-4 py-2 font-black text-[#4a3200] hover:bg-[#ffca62]" onClick={studio.loadCompletedAudioDemo} type="button">载入完整示范</button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-white/45" aria-live="polite">
        <strong className="rounded-lg bg-white/[.06] px-2.5 py-1.5 text-white/80">{studio.notice}</strong>
        <span>{studio.placedCount} 个已加入</span><span>·</span><span>{studio.suggestedCount} 个待确认</span><span>·</span><span>{studio.completedAudioEdges}/4 条教学关系完成</span>
      </div>
    </header>

    <div className="grid min-h-[760px] xl:grid-cols-[17rem_minmax(34rem,1fr)_22rem]">
      <NodeCatalogPanel
        catalog={studio.catalog}
        entries={studio.visibleEntries}
        error={studio.catalogError}
        family={studio.family}
        onAdd={studio.addCatalogNode}
        onFamilyChange={studio.setFamily}
        onQueryChange={studio.setQuery}
        query={studio.query}
      />

      <main className="min-w-0 bg-[#0b1210] p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div><p className="text-[9px] font-black tracking-[.18em] text-white/32">EDITABLE NETWORK</p><h2 className="mt-0.5 text-sm font-black">学生创作画布</h2></div>
          <div className="flex items-center gap-2">
            <button className="rounded-lg border border-[#73d7ba]/25 bg-[#73d7ba]/10 px-3 py-2 text-[10px] font-black text-[#9be2cc] hover:bg-[#73d7ba]/15" onClick={studio.acceptNextSuggestion} type="button">加入下一节点</button>
            <button className="rounded-lg border border-white/10 bg-white/[.04] px-3 py-2 text-[10px] font-black text-white/60 hover:bg-white/[.08]" onClick={studio.prepareAudioPlan} type="button">重置练习建议</button>
          </div>
        </div>
        <NodeCanvasPanel
          edges={studio.edges}
          nodes={studio.nodes}
          onConnect={studio.handleConnect}
          onDrop={studio.handleDrop}
          onEdgesChange={studio.onEdgesChange}
          onNodesChange={studio.onNodesChange}
          onSelect={(node) => studio.setSelectedId(node.id)}
        />
        <AudioReactivePreview edgesComplete={studio.completedAudioEdges} settings={studio.settings} />
      </main>

      <aside className="border-l border-white/[.08] bg-[#111a17] p-3">
        <SharedAgentFocus focus={studio.agentFocus} />
        <NodeInspector
          node={studio.selectedNode}
          onAccept={studio.acceptSelectedSuggestion}
          onSettingChange={studio.changeSetting}
          settings={studio.settings}
        />
      </aside>
    </div>
  </section>;
}
