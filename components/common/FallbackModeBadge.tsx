export function FallbackModeBadge() {
  return <aside className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950" aria-label="AI功能状态">
    <p className="font-semibold">确定性降级模式</p>
    <p className="mt-1">规则与课程资料继续工作，AI语义增强暂不可用</p>
  </aside>;
}
