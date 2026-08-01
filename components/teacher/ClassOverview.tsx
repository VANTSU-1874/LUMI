import type { ClassAnalytics } from "@/lib/domain/teacher";
import { DemoBadge } from "@/components/common/DemoBadge";

const STAGE_LABELS: Record<string, string> = {
  DIAGNOSTIC: "诊断", LOGIC_CARD: "逻辑卡", TOOL_PATH: "工具路径", BUILD: "制作",
  TROUBLESHOOT: "排障", TRANSFER: "迁移", COMPLETE: "完成",
};

export function ClassOverview({ analytics, onOpenLearner }: { analytics: ClassAnalytics; onOpenLearner: (studentId: string) => void }) {
  const dataCounts = analytics.dataCounts ?? { real: analytics.students.length, demonstration: 0, included: analytics.students.length };
  const realMetrics = analytics.metricsByDataType.REAL;
  const demoMetrics = analytics.metricsByDataType.DEMONSTRATION_DATA;
  const showDemoMetrics = dataCounts.included > dataCounts.real;
  const focusMetrics = dataCounts.real > 0 ? realMetrics : demoMetrics;
  const focusLabel = dataCounts.real > 0 ? "真实课堂" : "演示课堂";
  const evidenceTotal = focusMetrics.evidence.byVerification.reduce((sum, item) => sum + item.count, 0);
  const activeStages = focusMetrics.stages.filter((item) => item.count > 0);
  const topStage = [...activeStages].sort((left, right) => right.count - left.count)[0];
  const maxStage = Math.max(1, ...focusMetrics.stages.map((item) => item.count));

  return (
    <section aria-labelledby="class-overview-title" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-black tracking-[0.18em] text-[#178b73]">{focusLabel} · LIVE OVERVIEW</p><h2 className="mt-1 text-2xl font-black text-[#17332d]" id="class-overview-title">{analytics.class.name}</h2><p className="mt-2 text-sm text-[#58706a]">真实 {dataCounts.real} 人 · 演示 {dataCounts.demonstration} 人</p></div>
        <p className={`rounded-full px-4 py-2 text-sm font-black ${focusMetrics.supportNeeded > 0 ? "bg-[#fff0eb] text-[#9a3829]" : "bg-[#e2f4ed] text-[#0d6858]"}`}>需要支持 {focusMetrics.supportNeeded} 人</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="已进入学习" value={`${dataCounts.included} 人`} note={`${focusLabel}当前样本`} tone="green" />
        <MetricCard label="最集中阶段" value={topStage ? STAGE_LABELS[topStage.stage] : "暂无"} note={topStage ? `${topStage.count} 人正在此处` : "等待学生开始"} tone="yellow" />
        <MetricCard label="学习证据" value={`${evidenceTotal} 条`} note="截图、数值与测试记录" tone="blue" />
        <MetricCard label="迁移通过" value={`${focusMetrics.transfer.passed} 人`} note={`${focusMetrics.transfer.active} 人进行中`} tone="coral" />
      </div>
      <p className="rounded-xl bg-[#edf3ef] px-4 py-3 text-sm font-bold text-[#3f5f56]">迁移：进行中 {focusMetrics.transfer.active} · 通过 {focusMetrics.transfer.passed} · 锁定 {focusMetrics.transfer.locked}</p>

      <section className="rounded-[1.75rem] border border-[#dce4df] bg-[#fffef9] p-5 shadow-[0_8px_28px_rgba(23,51,45,0.05)] sm:p-6" aria-labelledby="real-metrics-title">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-black text-[#17332d]" id="real-metrics-title">真实教学指标</h3><p className="mt-1 text-sm text-[#71847f]">演示记录不会进入这里，便于后续用真实课堂数据替换。</p></div><span className="rounded-full bg-[#edf3ef] px-3 py-1 text-xs font-black text-[#58706a]">全班阶段分布</span></div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {analytics.stages.map((item, index) => <article className="relative overflow-hidden rounded-2xl border border-[#e1e7e3] bg-[#f8faf7] p-4" key={item.stage}><div className="absolute bottom-0 left-0 h-1 bg-[#178b73]" style={{ width: `${(item.count / maxStage) * 100}%` }} /><p className="text-xs font-bold text-[#71847f]"><span className="mr-1 font-mono">{index + 1}.</span><span>{STAGE_LABELS[item.stage]}</span></p><p className="mt-2 text-2xl font-black text-[#17332d]">{item.count}</p></article>)}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr_.8fr]">
        <article className="rounded-[1.5rem] border border-[#dce4df] bg-[#fffef9] p-5"><h3 className="font-black text-[#17332d]">五维能力分布</h3><p className="mt-2 text-sm text-[#58706a]">层级：{focusMetrics.profiles.levels.map((item) => `${item.key} ${item.count}人`).join(" · ") || "暂无画像"}</p><ul className="mt-4 space-y-3 text-sm">{focusMetrics.profiles.dimensions.map((item) => <li className="rounded-xl bg-[#f3f7f4] p-3" key={item.dimension}><p className="text-xs font-bold leading-5 text-[#58706a]">{item.dimension}：{item.scores.map((score) => `${score.key}分 ${score.count}人`).join("、")} · 需支持 {item.support}</p></li>)}</ul></article>
        <article className="rounded-[1.5rem] border border-[#dce4df] bg-[#17332d] p-5 text-white"><h3 className="font-black">下一步教学行动</h3><p className="mt-4 text-3xl font-black text-[#ffbf47]">{focusMetrics.supportNeeded > 0 ? `先看 ${focusMetrics.supportNeeded} 人` : "继续观察"}</p><p className="mt-3 text-sm leading-6 text-[#d5e8e2]">{focusMetrics.supportNeeded > 0 ? "优先打开标记为“需要”的学习者，查看卡在哪个信号层，再决定演示或个别指导。" : "当前没有明确风险标记，可观察逻辑卡与迁移任务的质量。"}</p></article>
        <article className="rounded-[1.5rem] border border-[#dce4df] bg-[#fffef9] p-5"><h3 className="font-black text-[#17332d]">证据来源与验证</h3><p className="mt-4 text-sm font-bold text-[#3f5f56]">{focusMetrics.evidence.byVerification.map((item) => `${item.key} ${item.count}`).join(" · ") || "暂无证据"}</p><p className="mt-3 text-xs leading-5 text-[#71847f]">{focusMetrics.evidence.byAuthority.map((item) => `${item.key} ${item.count}`).join(" · ") || "学生尚未提交可审计记录"}</p></article>
      </div>

      {showDemoMetrics ? <section aria-labelledby="demo-metrics-title" className="space-y-4 rounded-[1.75rem] border border-[#f2cf7a] bg-[#fff7df] p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3"><h3 className="text-lg font-black text-[#704d00]" id="demo-metrics-title">演示指标</h3><DemoBadge /><p className="text-sm text-[#7a5b18]">独立展示，不计入真实教学指标</p></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DemoMetric label="画像" value={demoMetrics.profiles.levels.map((item) => `${item.key} ${item.count}人`).join(" · ") || "暂无"} />
          <DemoMetric label="阶段" value={demoMetrics.stages.filter((item) => item.count > 0).map((item) => `${STAGE_LABELS[item.stage]} ${item.count}`).join(" · ") || "暂无"} />
          <DemoMetric label="需支持" value={`${demoMetrics.supportNeeded} 人`} />
          <DemoMetric label="迁移" value={`通过 ${demoMetrics.transfer.passed} · 进行中 ${demoMetrics.transfer.active}`} />
          <DemoMetric label="证据" value={demoMetrics.evidence.byVerification.map((item) => `${item.key} ${item.count}`).join(" · ") || "暂无"} />
          <DemoMetric label="排障升级" value={`${demoMetrics.troubleshooting.escalated} 次`} />
          <DemoMetric label="智能提示" value={`${demoMetrics.hints.total} 次`} />
          <DemoMetric label="逻辑问题" value={`${demoMetrics.logicIssues.reduce((sum, item) => sum + item.count, 0)} 条`} />
        </div>
      </section> : null}

      <div className="overflow-x-auto rounded-[1.75rem] border border-[#dce4df] bg-[#fffef9] shadow-[0_8px_28px_rgba(23,51,45,0.05)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e3e9e5] px-5 py-4"><div><h3 className="font-black text-[#17332d]">学习者动态</h3><p className="mt-1 text-xs text-[#71847f]">点击学习者查看卡点、证据和教师判断</p></div><p className="text-xs text-[#71847f]">更新：{new Date(analytics.updatedAt).toLocaleString("zh-CN", { timeZone: "UTC" })} UTC</p></div>
        {analytics.studentsMeta.truncated ? <p className="m-4 rounded-xl bg-[#fff7df] p-3 text-sm text-[#704d00]">学生列表仅显示 {analytics.studentsMeta.returned}/{analytics.studentsMeta.total}人；班级聚合指标仍覆盖全班。</p> : null}
        <table className="min-w-full text-left text-sm"><caption className="sr-only">班级学习者阶段与支持需求</caption><thead className="bg-[#f3f7f4] text-[#58706a]"><tr><th className="px-5 py-3" scope="col">学习者</th><th className="px-5 py-3" scope="col">当前节点</th><th className="px-5 py-3" scope="col">状态</th><th className="px-5 py-3" scope="col"><span className="sr-only">操作</span></th></tr></thead>
          <tbody>{analytics.students.map((student) => <tr className="border-t border-[#edf1ee] transition hover:bg-[#f8faf7]" key={student.id}><td className="px-5 py-4 font-black text-[#17332d]"><span className="mr-2">{student.alias}</span>{student.dataType === "DEMONSTRATION_DATA" ? <DemoBadge /> : null}</td><td className="px-5 py-4">{student.stage ? STAGE_LABELS[student.stage] : "未开始"}</td><td className="px-5 py-4"><span className={`rounded-full px-3 py-1 text-xs font-black ${student.needsSupport ? "bg-[#fff0eb] text-[#9a3829]" : "bg-[#e2f4ed] text-[#0d6858]"}`}>{student.needsSupport ? "需要支持" : "进展正常"}</span></td><td className="px-5 py-4 text-right"><button className="rounded-xl border-2 border-[#178b73] px-3 py-2 font-black text-[#0d6858] transition hover:bg-[#e7f5ef]" onClick={() => onOpenLearner(student.id)} type="button" aria-label={`查看${student.alias}`}>查看学习记录</button></td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function MetricCard({ label, value, note, tone }: { label: string; value: string; note: string; tone: "green" | "yellow" | "blue" | "coral" }) {
  const colors = { green: "bg-[#e2f4ed] text-[#0d6858]", yellow: "bg-[#fff1ce] text-[#704d00]", blue: "bg-[#e6f1f7] text-[#275b72]", coral: "bg-[#fff0eb] text-[#9a3829]" };
  return <article className={`rounded-[1.5rem] p-5 ${colors[tone]}`}><p className="text-xs font-black tracking-[0.12em] opacity-70">{label}</p><p className="mt-3 text-2xl font-black">{value}</p><p className="mt-2 text-xs font-bold opacity-70">{note}</p></article>;
}

function DemoMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-[#efd896] bg-white/60 p-3"><p className="text-xs font-black text-[#8a6616]">{label}</p><p className="mt-1 text-sm font-bold text-[#5e4816]">{value}</p></div>;
}
