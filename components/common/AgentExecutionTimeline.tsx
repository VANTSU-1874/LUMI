import type { AgentExecutionStep } from "@/lib/agent/contracts";

const KIND_LABELS: Record<AgentExecutionStep["kind"], string> = {
  MODEL_DECISION: "模型决策",
  TOOL_CALL: "工具调用",
  TOOL_OBSERVATION: "工具观察",
  FINAL_RESPONSE: "最终回答",
  DEGRADED: "确定性降级",
};

const STATUS_STYLE: Record<AgentExecutionStep["status"], string> = {
  SUCCEEDED: "border-[#9dcbbb] bg-[#eff8f4] text-[#176752]",
  FAILED: "border-[#efb7aa] bg-[#fff2ee] text-[#a44332]",
  EMPTY: "border-[#e8d29e] bg-[#fff8e6] text-[#8a620c]",
  SKIPPED: "border-[#d7dcd8] bg-[#f5f6f4] text-[#68716d]",
};

export function AgentExecutionTimeline({
  steps,
  title = "本回合执行链",
}: {
  steps: AgentExecutionStep[];
  title?: string;
}) {
  if (steps.length === 0) return null;
  return <section aria-label="Agent 执行链">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-[10px] font-semibold text-[#397565]">{title}</h3>
      <span className="text-[9px] text-[#89918d]">不包含模型内部思维</span>
    </div>
    <ol className="mt-2 space-y-2">
      {steps.map((step) => <li className="relative grid grid-cols-[1.25rem_1fr] gap-2" key={step.id}>
        <span className={`relative z-10 mt-0.5 grid size-5 place-items-center rounded-full border text-[8px] font-bold ${STATUS_STYLE[step.status]}`}>{step.sequence}</span>
        <div className="min-w-0 rounded-lg border border-[#e4e7e3] bg-white px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[9px] font-semibold text-[#6e7773]">{KIND_LABELS[step.kind]}</span>
            <b className="text-[11px] font-semibold text-[#35413c]">{step.label}</b>
            <span className="ml-auto text-[9px] text-[#929995]">{step.latencyMs}ms</span>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-[#5d6863]">{step.summary}</p>
        </div>
      </li>)}
    </ol>
  </section>;
}
