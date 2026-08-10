import type { TeacherOriginalSnapshot } from "@/lib/domain/teacher";

type BookSnapshot = Extract<TeacherOriginalSnapshot, { targetType: "BOOK_LAYOUT_EVIDENCE" }>;

const PAGE_LABELS: Record<BookSnapshot["pageOrder"][number], string> = {
  cover: "封面",
  "quick-start": "快速导读",
  "activity-map": "活动地图",
  "featured-activity": "重点活动",
  calendar: "活动日历",
  "community-voices": "社区声音",
  "join-us": "加入行动",
  contact: "联系信息",
};

const DIAGNOSTIC_LABELS: Record<BookSnapshot["diagnosticAnswers"][number], string> = {
  AUDIENCE_FIRST: "先判断受众",
  TASK_FIRST: "先判断阅读任务",
  DECORATION_FIRST: "先做视觉装饰",
};

const TRANSFER_LABELS: Record<BookSnapshot["transferChoices"][number], string> = {
  COMMUNITY_ENTRY_FIRST: "改变社区入口",
  VOLUNTEER_CALL_TO_ACTION: "改变行动召唤",
  RETAIN_ACTIVITY_CORE: "保留活动核心",
};

export function BookLayoutReviewViewer({ snapshot }: { snapshot: BookSnapshot }) {
  return <section aria-labelledby="book-review-title" className="space-y-4 rounded-2xl border border-[#e4d7ad] bg-[#fffaf0] p-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-bold tracking-[0.16em] text-[#8a620c]">书籍设计 · 结构化学习证据</p><h3 className="mt-1 font-semibold" id="book-review-title">8页导览册复核内容</h3></div>
      <span className="rounded-full bg-white px-3 py-1 text-sm font-black text-[#76520a]">{snapshot.score}/4 · {snapshot.passed ? "规则通过" : "待修订"}</span>
    </header>
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div className="rounded-xl bg-white p-3"><dt className="text-slate-500">目标受众</dt><dd className="mt-1 font-semibold">{snapshot.audience === "NEW_STUDENTS" ? "新生" : "社区居民"}</dd></div>
      <div className="rounded-xl bg-white p-3"><dt className="text-slate-500">迁移选择</dt><dd className="mt-1 font-semibold">{snapshot.transferChoices.length ? snapshot.transferChoices.map((choice) => TRANSFER_LABELS[choice]).join("、") : "保持新生版，不做受众迁移"}</dd></div>
    </dl>
    <div><h4 className="text-sm font-semibold">页序</h4><ol className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">{snapshot.pageOrder.map((page, index) => <li className="rounded-xl border border-[#eadfbd] bg-white px-3 py-2" key={page}><span className="mr-2 text-xs font-black text-[#9b741b]">{index + 1}</span>{PAGE_LABELS[page]}</li>)}</ol></div>
    <div><h4 className="text-sm font-semibold">诊断答案</h4><ol className="mt-2 space-y-2 text-sm">{snapshot.diagnosticAnswers.map((answer, index) => <li className="rounded-xl bg-white px-3 py-2" key={`${answer}-${index}`}>判断 {index + 1}：{DIAGNOSTIC_LABELS[answer]}</li>)}</ol></div>
    <div><h4 className="text-sm font-semibold">四项规则结果</h4><ul className="mt-2 grid gap-2 sm:grid-cols-2">{snapshot.criteria.map((criterion) => <li className="rounded-xl bg-white p-3 text-sm" key={criterion.id}><p className="font-semibold"><span aria-label={criterion.passed ? "通过" : "未通过"} className={criterion.passed ? "text-emerald-700" : "text-rose-700"}>{criterion.passed ? "✓" : "×"}</span> {criterion.label}</p><p className="mt-1 text-slate-600">{criterion.note}</p></li>)}</ul></div>
    <p className="text-xs leading-5 text-slate-600">规则结果只记录系统原判断；教师可以在下方确认、纠正或标记待复核，原始页序与规则结果不会被覆盖。</p>
  </section>;
}
