"use client";

import { PROJECT_STAGES, type ProjectStage } from "@/lib/domain/stages";

const labels: Record<ProjectStage, string> = {
  DIAGNOSTIC: "学习诊断", LOGIC_CARD: "六元交互逻辑", TOOL_PATH: "工具路径",
  BUILD: "原型制作", TROUBLESHOOT: "信号排障", TRANSFER: "迁移挑战", COMPLETE: "项目完成",
};

export function StageRail({ currentStage }: { currentStage: ProjectStage }) {
  const currentIndex = PROJECT_STAGES.indexOf(currentStage);
  return (
    <nav aria-label="项目学习阶段" className="overflow-x-auto rounded-[1.75rem] border border-[#dce4df] bg-[#fffef9] px-4 py-5 shadow-[0_8px_30px_rgba(23,51,45,0.05)] sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div><p className="text-xs font-black tracking-[0.18em] text-[#178b73]">LEARNING PATH</p><p className="mt-1 font-black text-[#17332d]">你的项目学习路径</p></div>
        <p className="rounded-full bg-[#edf5f0] px-3 py-1 text-xs font-black text-[#0d6858]">{currentIndex + 1} / {PROJECT_STAGES.length}</p>
      </div>
      <ol className="flex min-w-[48rem] items-start justify-between lg:min-w-0">
        {PROJECT_STAGES.map((stage, index) => {
          const future = index > currentIndex;
          const current = index === currentIndex;
          const completed = index < currentIndex;
          const nodeClass = `grid size-11 place-items-center rounded-full border-[3px] text-sm font-black transition ${current ? "border-[#0d6858] bg-[#178b73] text-white shadow-[0_0_0_6px_rgba(23,139,115,0.14)]" : completed ? "border-[#178b73] bg-[#e0f4ec] text-[#0d6858]" : "border-[#d5ddd8] bg-[#f2f4f1] text-[#94a29d]"}`;
          return <li aria-current={current ? "step" : undefined} className="relative flex w-[6.4rem] flex-col items-center text-center" key={stage}>
            {index < PROJECT_STAGES.length - 1 ? <span aria-hidden="true" className={`absolute left-[4.7rem] top-5 h-1 w-[3.5rem] ${index < currentIndex ? "bg-[#69b9a5]" : "bg-[#dce4df]"}`} /> : null}
            {future
              ? <button aria-describedby={`stage-lock-${stage}`} aria-disabled="true" aria-label={labels[stage]} className={nodeClass} disabled type="button"><span>{index + 1}</span><span className="sr-only" id={`stage-lock-${stage}`}>完成当前学习步骤后开放</span></button>
              : <div className={nodeClass}>{completed ? <span aria-hidden="true">✓</span> : index + 1}</div>}
            <span className={`mt-2 text-xs font-bold ${current ? "text-[#0d6858]" : future ? "text-[#8c9b96]" : "text-[#3f5f56]"}`}>{labels[stage]}</span>
          </li>;
        })}
      </ol>
    </nav>
  );
}
