import type { StudentDashboard } from "@/lib/domain/student-dashboard";

const pathLabels = { DIGISHOW: "DigiShow", TOUCHDESIGNER: "TouchDesigner", COLLABORATIVE: "DigiShow + TouchDesigner 协同" } as const;
const nextActions = {
  DIAGNOSTIC: "完成学习诊断", LOGIC_CARD: "完成六元交互逻辑卡", TOOL_PATH: "确认项目需求并生成工具路径",
  BUILD: "制作原型并记录可验证证据", TROUBLESHOOT: "按信号层逐项排障", TRANSFER: "完成一次结构迁移", COMPLETE: "回看项目证据与迁移结果",
} as const;

export function CurrentProject({ dashboard }: { dashboard: StudentDashboard }) {
  return <section aria-labelledby="project-title" className="rounded-[1.5rem] border border-[#dce4df] bg-[#fffef9] p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[10px] font-black tracking-[0.18em] text-[#178b73]">COURSE MISSION</p><h2 id="project-title" className="mt-1 text-xl font-black text-[#17332d]">当前项目</h2><p className="mt-1 text-sm text-[#71847f]">{dashboard.course.totalHours} 课时 · {dashboard.course.modules.length} 个模块</p></div>
      {dashboard.project && <span className="rounded-full bg-[#fff1ce] px-3 py-1 text-xs font-black text-[#704d00]">证据 {dashboard.evidence.total} 条 · 已验证 {dashboard.evidence.verified} 条</span>}
    </div>
    {!dashboard.assignment ? <p className="mt-4 text-slate-600">教师尚未发布课程任务。</p> : <div className="mt-4 space-y-3">
      <div><h3 className="font-bold">{dashboard.assignment.title}</h3><p className="text-slate-600">{dashboard.assignment.brief}</p></div>
      <ol className="space-y-2">{dashboard.course.modules.map((module) => <li className="rounded-xl bg-[#f1f5f2] p-3 text-sm" key={module.id}><strong className="text-[#3f5f56]">{module.sequence}. {module.title} · {module.hours}h</strong><span className="mt-1 block text-xs leading-5 text-[#71847f]">{module.focus}</span></li>)}</ol>
      <dl className="grid gap-3 text-sm">
        <div><dt className="text-slate-500">工具路径</dt><dd className="font-semibold">{dashboard.toolPath ? pathLabels[dashboard.toolPath.path] : "待生成"}</dd></div>
        <div><dt className="text-slate-500">提示使用</dt><dd className="font-semibold">{dashboard.hints.count} 次</dd></div>
        <div><dt className="text-slate-500">下一步</dt><dd className="font-semibold">{dashboard.project ? nextActions[dashboard.project.stage] : "等待项目建立"}</dd></div>
      </dl>
    </div>}
  </section>;
}
