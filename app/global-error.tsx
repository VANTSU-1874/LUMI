"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

export function GlobalErrorContent({ reset }: { reset: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <main className="grid min-h-screen place-items-center bg-slate-50 p-6"><section className="max-w-md rounded-2xl bg-white p-6 text-center shadow" aria-labelledby="global-error-title"><h1 id="global-error-title" className="text-2xl font-bold" ref={heading} tabIndex={-1}>页面暂时遇到问题</h1><p className="mt-3" role="alert">已成功提交的数据仍保存在服务器；尚未确认提交成功的本地输入可能需要重新填写。可以重试当前页面；模型不可用时，确定性课程检查仍会继续，语义结果保持待处理。</p><button className="mt-5 rounded-xl bg-indigo-600 px-5 py-3 font-semibold text-white" onClick={reset} type="button">重试</button><Link className="ml-4 font-semibold text-indigo-700 underline" href="/">返回入口</Link></section></main>;
}

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="zh-CN"><body><GlobalErrorContent reset={reset} /></body></html>;
}
