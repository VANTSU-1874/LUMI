import type { ClassAnalytics } from "@/lib/domain/teacher";

export function MisconceptionPanel({ analytics }: { analytics: ClassAnalytics }) {
  return (
    <section aria-labelledby="signals-title" className="grid gap-4 lg:grid-cols-3">
      <h2 className="sr-only" id="signals-title">班级典型信号</h2>
      <article className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">高频逻辑问题</h3><ol className="mt-3 space-y-2">{analytics.logicIssues.slice(0, 5).map((item) => <li className="flex justify-between gap-3" key={item.key}><span>{item.key}</span><strong>{item.count}</strong></li>)}</ol>{analytics.logicIssues.length === 0 ? <p className="mt-3 text-sm text-slate-500">暂无问题</p> : null}</article>
      <article className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">排障层分布</h3><p className="mt-2 text-sm text-rose-700">升级求助 {analytics.troubleshooting.escalated} 人次</p><ul className="mt-3 space-y-2">{analytics.troubleshooting.byLayer.map((item) => <li className="flex justify-between" key={item.layer}><span>{item.layer}</span><strong>{item.count}</strong></li>)}</ul></article>
      <article className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">提示依赖</h3><p className="mt-3">当前 L3：{analytics.hints.latestL3}</p><p className="mt-2">曾到 L3：{analytics.hints.maxL3}</p><p className="mt-2 text-sm text-slate-500">共 {analytics.hints.total} 次提示</p></article>
    </section>
  );
}
