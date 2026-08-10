"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type EntryRole = "STUDENT" | "TEACHER";

type EntryFormProps = {
  navigate?: (href: string) => void;
};

function safeStudentReturnTo(value: string | null | undefined) {
  const candidate = value?.trim();
  if (
    !candidate
    || !candidate.startsWith("/")
    || candidate.startsWith("//")
    || candidate.includes("\\")
    || candidate.includes("\r")
    || candidate.includes("\n")
  ) {
    return undefined;
  }
  return candidate;
}

export function destinationForRole(role: EntryRole, returnTo?: string | null) {
  if (role === "TEACHER") return "/teacher";
  return safeStudentReturnTo(returnTo) ?? "/student";
}

function returnToFromCurrentLocation() {
  return new URLSearchParams(window.location.search).get("returnTo");
}

function defaultNavigation(href: string) {
  window.location.assign(href);
}

async function responseError(response: Response) {
  try {
    const payload: unknown = await response.json();
    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
    ) {
      return payload.error;
    }
  } catch {
    // A non-JSON failure still receives the generic user-facing message below.
  }

  return "暂时无法进入，请稍后重试";
}

export function EntryForm({ navigate = defaultNavigation }: EntryFormProps) {
  const [role, setRole] = useState<EntryRole>("STUDENT");
  const [classCode, setClassCode] = useState("");
  const [alias, setAlias] = useState("");
  const [teacherCode, setTeacherCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const studentTabRef = useRef<HTMLButtonElement>(null);
  const teacherTabRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function chooseRole(nextRole: EntryRole) {
    setRole(nextRole);
    setError(null);
  }

  function selectAndFocus(nextRole: EntryRole) {
    chooseRole(nextRole);
    const target =
      nextRole === "STUDENT" ? studentTabRef.current : teacherTabRef.current;
    target?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextRole: EntryRole | undefined;
    if (event.key === "Home") nextRole = "STUDENT";
    if (event.key === "End") nextRole = "TEACHER";
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      nextRole = role === "STUDENT" ? "TEACHER" : "STUDENT";
    }
    if (nextRole) {
      event.preventDefault();
      selectAndFocus(nextRole);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const isStudent = role === "STUDENT";
      const response = await fetch(
        isStudent ? "/api/auth/student" : "/api/auth/teacher",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            isStudent
              ? { classCode, alias }
              : { code: teacherCode },
          ),
        },
      );

      if (!response.ok) {
        setError(await responseError(response));
        return;
      }

      navigate(destinationForRole(role, returnToFromCurrentLocation()));
    } catch {
      setError("暂时无法进入，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  const studentSelected = role === "STUDENT";

  function fillLearningDemo() {
    setRole("STUDENT");
    setClassCode("DIGI2026");
    setAlias("4P6R-8T2W-Y5BC");
    setError(null);
  }

  return (
    <div className="rounded-[1.75rem] border border-[#dce4df] bg-[#f7f9f5] p-2 sm:p-3">
      <div
        aria-label="进入身份"
        className="grid grid-cols-2 gap-2"
        role="tablist"
      >
        <button
          aria-controls="student-entry-panel"
          aria-selected={studentSelected}
          className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
            studentSelected
              ? "bg-white text-[#0d6858] shadow-sm"
              : "text-[#71847f] hover:text-[#17332d]"
          }`}
          disabled={pending}
          id="student-entry-tab"
          onKeyDown={handleTabKeyDown}
          onClick={() => chooseRole("STUDENT")}
          ref={studentTabRef}
          role="tab"
          tabIndex={studentSelected ? 0 : -1}
          type="button"
        >
          学生
        </button>
        <button
          aria-controls="teacher-entry-panel"
          aria-selected={!studentSelected}
          className={`rounded-xl px-4 py-3 text-sm font-semibold transition ${
            !studentSelected
              ? "bg-white text-[#0d6858] shadow-sm"
              : "text-[#71847f] hover:text-[#17332d]"
          }`}
          disabled={pending}
          id="teacher-entry-tab"
          onKeyDown={handleTabKeyDown}
          onClick={() => chooseRole("TEACHER")}
          ref={teacherTabRef}
          role="tab"
          tabIndex={studentSelected ? -1 : 0}
          type="button"
        >
          教师
        </button>
      </div>

      <form className="space-y-4 p-4 sm:p-5" onSubmit={submit}>
        {studentSelected ? (
          <div
            aria-labelledby="student-entry-tab"
            className="space-y-4"
            id="student-entry-panel"
            role="tabpanel"
          >
            <label className="block text-sm font-medium text-slate-700">
              班级邀请码
              <input
                autoComplete="off"
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                disabled={pending}
                maxLength={64}
                onChange={(event) => setClassCode(event.target.value)}
                required
                value={classCode}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              匿名编号
              <input
                aria-describedby="identity-code-help"
                autoComplete="one-time-code"
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                disabled={pending}
                maxLength={32}
                minLength={12}
                onChange={(event) => setAlias(event.target.value.toUpperCase())}
                pattern={"[A-Za-z0-9\\-]+"}
                placeholder="例如：7K9M-2Q4R-P8TX"
                required
                value={alias}
              />
            </label>
            <p className="text-xs leading-5 text-slate-500" id="identity-code-help">
              使用教师分发的 12–32 位高熵学习身份码，仅含字母、数字和连字符。
            </p>
            <button className="flex w-full items-center justify-between rounded-2xl border-2 border-dashed border-[#8fc6b8] bg-[#ecf7f2] px-4 py-3 text-left transition hover:border-[#178b73] hover:bg-[#e1f3eb]" disabled={pending} onClick={fillLearningDemo} type="button">
              <span><span className="block text-sm font-black text-[#0d6858]">没有账号？填入可学习的演示账号</span><span className="mt-1 block text-xs text-[#58706a]">从诊断开始，可完整操作；数据明确标为演示</span></span><span aria-hidden="true" className="text-xl">→</span>
            </button>
          </div>
        ) : (
          <div
            aria-labelledby="teacher-entry-tab"
            className="space-y-4"
            id="teacher-entry-panel"
            role="tabpanel"
          >
            <label className="block text-sm font-medium text-slate-700">
              教师访问码
              <input
                autoComplete="one-time-code"
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                disabled={pending}
                maxLength={128}
                onChange={(event) => setTeacherCode(event.target.value)}
                required
                type="password"
                value={teacherCode}
              />
            </label>
          </div>
        )}

        {error ? (
          <p className="text-sm font-medium text-red-700" ref={errorRef} role="alert" tabIndex={-1}>
            {error}
          </p>
        ) : null}

        <button
          className="w-full rounded-xl border-b-4 border-[#0a594c] bg-[#178b73] px-4 py-3 font-black text-white transition hover:-translate-y-0.5 hover:bg-[#117c68] disabled:cursor-wait disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending
            ? "正在进入…"
            : studentSelected
              ? "学生进入"
              : "教师进入"}
        </button>
      </form>
    </div>
  );
}
