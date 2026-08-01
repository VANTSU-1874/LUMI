"use client";

import Link from "next/link";

import { LumiButton, LumiTag } from "@/components/design-system/LumiUI";

import styles from "./student-app.module.css";
import type { LumiStudentSession } from "./use-lumi-student-session";

export function StudentSidebar({
  session,
  mobileOpen,
  onClose,
  onOpenGrowth,
}: {
  session: LumiStudentSession;
  mobileOpen: boolean;
  onClose: () => void;
  onOpenGrowth: () => void;
}) {
  const currentCourseLabel = session.courses.find((course) => course.id === session.currentCourseId)?.label
    ?? session.latestTurn?.coursePack.label
    ?? session.currentCourseLabel;

  return <>
    {mobileOpen ? <button aria-label="关闭侧栏" className={styles.sidebarScrim} onClick={onClose} type="button" /> : null}
    <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ""}`} aria-label="课程与历史对话">
      <div className={styles.sidebarBrand}>
        <Link href="/">Lumi <small>鹿鸣</small></Link>
        {session.demo ? <LumiTag accent>预置演示数据</LumiTag> : null}
      </div>

      <div className={styles.coursePicker}>
        <label htmlFor="lumi-course-select">当前课程</label>
        {session.demo && session.courses.length > 1 ? <select id="lumi-course-select" onChange={(event) => void session.switchCourse(event.target.value)} value={session.currentCourseId}>
          {session.courses.map((course) => <option disabled={course.status !== "READY"} key={course.id} value={course.id}>{course.label}</option>)}
        </select> : <div className={styles.courseFallback}>{currentCourseLabel}</div>}
      </div>

      <LumiButton className={styles.newTaskButton} onClick={() => void session.createTask()} size="small" variant="secondary">＋ 新对话</LumiButton>

      <nav className={styles.historyNav} aria-label="历史设计对话">
        <p>本课程对话</p>
        <div>
          {session.tasks.filter((task) => task.status === "ACTIVE").map((task) => <button aria-current={task.id === session.activeTaskId ? "page" : undefined} className={task.id === session.activeTaskId ? styles.historyActive : ""} key={task.id} onClick={() => { void session.selectTask(task.id); onClose(); }} type="button">
            <span>{task.title}</span>
            <time dateTime={task.updatedAt}>{new Date(task.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</time>
          </button>)}
        </div>
      </nav>

      <div className={styles.sidebarBottom}>
        <button onClick={() => { onOpenGrowth(); onClose(); }} type="button"><span aria-hidden="true">↗</span><span><b>成长档案</b><small>只对你本人可见</small></span></button>
        <Link href="/privacy"><span aria-hidden="true">○</span><span><b>隐私说明</b><small>学习证据如何保存</small></span></Link>
      </div>
    </aside>
  </>;
}
