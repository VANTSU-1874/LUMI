"use client";

import type { ProjectBrief } from "@/lib/agent/project-brief-memory";

const labels: Readonly<Record<keyof ProjectBrief["fields"], string>> = {
  designGoal: "设计目标",
  audienceAndContext: "受众与情境",
  coreContent: "核心内容",
  visualExperienceDirection: "视觉与体验",
  mediumConstraints: "媒介与条件",
  processPlan: "制作流程",
  successCriteria: "有效性指标",
  nextStep: "当前下一步",
};

export function ProjectBriefSummary({ brief }: { brief: ProjectBrief | undefined }) {
  if (!brief || brief.revision === 0) return null;
  const entries = Object.entries(brief.fields).flatMap(([key, field]) => field
    ? [{ key: key as keyof ProjectBrief["fields"], field }]
    : []);
  return <details className="shrink-0 border-b border-black/[.045] bg-[#fbfbf8] px-4 py-2 sm:px-6">
    <summary className="cursor-pointer list-none text-[11px] font-medium text-[#4f5d57]">
      项目理解正在后台形成 · 已整理 {entries.length}/8 项
      <span className="float-right text-[#7b8581]">查看</span>
    </summary>
    <dl className="mx-auto mt-3 grid max-w-[48rem] gap-2 pb-2 sm:grid-cols-2">
      {entries.map(({ key, field }) => <div className="rounded-lg bg-white px-3 py-2" key={key}>
        <dt className="text-[9px] font-semibold text-[#75807b]">{labels[key]} · {field.status === "CONFIRMED" ? "已确认" : "暂时理解"}</dt>
        <dd className="mt-1 text-xs leading-5 text-[#35413c]">{field.value}</dd>
      </div>)}
    </dl>
  </details>;
}
