"use client";

import {
  type KeyboardEvent,
  useRef,
  useState,
} from "react";

type EntryRole = "STUDENT" | "TEACHER";

type EntryFormProps = {
  navigate?: (href: string) => void;
};

function defaultNavigation(href: string) {
  window.location.assign(href);
}

export function EntryForm({ navigate = defaultNavigation }: EntryFormProps) {
  const [role, setRole] = useState<EntryRole>("STUDENT");
  const studentTabRef = useRef<HTMLButtonElement>(null);
  const teacherTabRef = useRef<HTMLButtonElement>(null);

  function chooseRole(nextRole: EntryRole) {
    setRole(nextRole);
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

  const studentSelected = role === "STUDENT";
  const roleName = studentSelected ? "学生" : "教师";
  const primaryPath = studentSelected
    ? "/login?mode=register&role=student"
    : "/login?role=teacher";

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

      <div className="space-y-4 p-4 sm:p-5">
        <div
          aria-labelledby={studentSelected
            ? "student-entry-tab"
            : "teacher-entry-tab"}
          className="rounded-2xl border border-[#dce4df] bg-white px-4 py-5 text-left"
          id={studentSelected ? "student-entry-panel" : "teacher-entry-panel"}
          role="tabpanel"
        >
          <strong className="block text-base text-[#17332d]">
            {roleName}账号
          </strong>
          <p className="mt-2 text-sm leading-6 text-[#58706a]">
            {studentSelected
              ? "使用邮箱和密码创建学生账号，注册后直接进入学习工作台。"
              : "教师账号由课程管理员预置，使用已有邮箱和密码登录。"}
          </p>
        </div>
        <button
          className="w-full rounded-xl border-b-4 border-[#0a594c] bg-[#178b73] px-4 py-3 font-black text-white transition hover:-translate-y-0.5 hover:bg-[#117c68] disabled:cursor-wait disabled:opacity-60"
          onClick={() => navigate(primaryPath)}
          type="button"
        >
          {studentSelected ? "创建学生账号" : "教师账号登录"}
        </button>
        <button
          className="w-full rounded-xl border border-[#b8c8c2] bg-white px-4 py-3 font-semibold text-[#17332d] transition hover:-translate-y-0.5 hover:border-[#7f9990]"
          onClick={() => navigate("/login")}
          type="button"
        >
          已有账号，去登录
        </button>
      </div>
    </div>
  );
}
