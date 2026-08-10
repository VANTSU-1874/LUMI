"use client";

import { useMemo, useState } from "react";

import { createClientApi } from "./client";
import { mockEndpointGroups } from "./contracts";
import { resetMockApiState } from "./mock/router";

type Check = {
  id: string;
  label: string;
  state: "idle" | "running" | "passed" | "failed";
  detail: string;
};

const initialChecks: Check[] = [
  { id: "auth", label: "学生登录", state: "idle", detail: "POST /api/auth/student" },
  { id: "courses", label: "课程注册表", state: "idle", detail: "GET /api/courses" },
  { id: "tasks", label: "设计任务", state: "idle", detail: "GET /api/agent/tasks" },
  { id: "run", label: "对话运行", state: "idle", detail: "POST /api/agent/runs" },
  { id: "critique", label: "五维会诊", state: "idle", detail: "GET /api/agent/turns/:id/critique" },
  { id: "resources", label: "教师资料", state: "idle", detail: "GET /api/teacher/config/resources" },
  { id: "insights", label: "教师洞察", state: "idle", detail: "GET /api/teacher/insights" },
  { id: "dashboard", label: "学生看板", state: "idle", detail: "GET /api/student/dashboard" },
];

function key() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "90000000-0000-4000-8000-000000000001";
}

export function MockContractPreview() {
  const api = useMemo(() => createClientApi({ forceMock: true }), []);
  const [checks, setChecks] = useState(initialChecks);
  const [busy, setBusy] = useState(false);
  const [lastPayload, setLastPayload] = useState<unknown>(null);

  function update(id: string, state: Check["state"], detail?: string) {
    setChecks((current) => current.map((check) => check.id === id
      ? { ...check, state, detail: detail ?? check.detail }
      : check));
  }

  async function runAll() {
    if (busy) return;
    setBusy(true);
    setLastPayload(null);
    resetMockApiState();
    setChecks(initialChecks.map((check) => ({ ...check, state: "running" })));
    try {
      const auth = await api.enterStudent({ classCode: "LUMI-DEMO", alias: "07" });
      update("auth", "passed", JSON.stringify(auth));

      const courses = await api.courses();
      update("courses", "passed", `${courses.courses.length} 门课程；当前 ${courses.currentCourseId}`);

      const tasks = await api.listTasks();
      update("tasks", "passed", `${tasks.tasks.length} 个演示任务`);

      const taskId = tasks.tasks[0]?.id;
      if (!taskId) throw new Error("mock 没有返回设计任务");
      const created = await api.createRun({
        taskId,
        message: "请先帮我澄清这个互动作品的目标。",
        context: { view: "AGENT" },
      }, key());
      update("run", "passed", `${created.run.status} · ${created.run.id}`);

      const critique = await api.getCritique("30000000-0000-4000-8000-000000000001");
      update("critique", "passed", `${critique.critique.dimensions.length} 维 + 独立收束`);

      const resources = await api.teacherResources();
      update("resources", "passed", `${resources.resources.length} 份演示资料`);

      const insights = await api.teacherInsights(courses.currentCourseId);
      update("insights", "passed", `${insights.insights.length} 条预置学习记录 · ${insights.dataScope}`);

      const dashboardResponse = await api.fetch("/api/student/dashboard");
      const dashboard = await dashboardResponse.json() as { dataType?: string };
      update("dashboard", "passed", dashboard.dataType ?? "unknown");
      setLastPayload({ run: created, critique, courses });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "未知错误";
      setChecks((current) => current.map((check) => check.state === "running"
        ? { ...check, state: "failed", detail: message }
        : check));
    } finally {
      setBusy(false);
    }
  }

  return <main className="min-h-screen bg-[#EEEAE1] px-5 py-10 text-[#23201C] sm:px-8">
    <div className="mx-auto max-w-5xl">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#B23A2F]">Development only</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Lumi API 契约与 mock 自检</h1>
      <p className="mt-4 max-w-3xl text-sm leading-7 text-[#5f5951]">
        本页只在开发环境出现。所有内容均为预置演示数据，不会请求数据库、模型或外部服务。
      </p>

      <section className="mt-8 border-y border-[#D6D0C4] py-5" aria-labelledby="switch-title">
        <h2 className="text-sm font-semibold" id="switch-title">可独立切换的端点组</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {mockEndpointGroups.map((group) => <code className="rounded-full border border-[#D6D0C4] bg-white/40 px-3 py-1.5 text-xs" key={group}>{group}</code>)}
        </div>
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button className="rounded-full bg-[#B23A2F] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60" disabled={busy} onClick={() => void runAll()} type="button">
          {busy ? "正在逐项验证…" : "运行全部 mock 契约"}
        </button>
        <span className="text-xs text-[#6d665d]">NEXT_PUBLIC_USE_MOCK 支持 all 或逗号分隔的端点组</span>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {checks.map((check) => <article className="border border-[#D6D0C4] bg-white/35 p-4" key={check.id}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{check.label}</h2>
            <span className={`text-xs font-semibold ${check.state === "passed" ? "text-emerald-800" : check.state === "failed" ? "text-[#B23A2F]" : "text-[#766f66]"}`}>
              {{ idle: "待验证", running: "验证中", passed: "通过", failed: "失败" }[check.state]}
            </span>
          </div>
          <p className="mt-2 break-all text-xs leading-5 text-[#6d665d]">{check.detail}</p>
        </article>)}
      </div>

      {lastPayload ? <details className="mt-8 border border-[#D6D0C4] bg-[#23201C] p-4 text-[#EEEAE1]">
        <summary className="cursor-pointer text-sm font-semibold">查看最后一次响应</summary>
        <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-5">{JSON.stringify(lastPayload, null, 2)}</pre>
      </details> : null}
    </div>
  </main>;
}
