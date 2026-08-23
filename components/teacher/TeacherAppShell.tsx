"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { BookOpenCheck, ChevronLeft, GraduationCap, LayoutDashboard, LibraryBig, Scale, ShieldCheck, UsersRound } from "lucide-react";
import type { ReactNode } from "react";

export type TeacherSection = "overview" | "students" | "reviews" | "wiki" | "evidence";

const destinations: Array<{ id: TeacherSection; label: string; href: string; icon: LucideIcon }> = [
  { id: "overview", label: "课堂总览", href: "/teacher", icon: LayoutDashboard },
  { id: "students", label: "学生与班级", href: "/teacher?section=students", icon: UsersRound },
  { id: "reviews", label: "判断复核", href: "/teacher?section=reviews", icon: Scale },
  { id: "wiki", label: "灵感 Wiki", href: "/teacher/inspiration-wiki", icon: LibraryBig },
  { id: "evidence", label: "证据与隐私", href: "/teacher?section=evidence", icon: ShieldCheck },
];

export function TeacherAppShell({
  active,
  title,
  eyebrow,
  description,
  tools,
  children,
  onNavigate,
  backHref,
  backLabel,
}: {
  active: TeacherSection;
  title: string;
  eyebrow: string;
  description?: string;
  tools?: ReactNode;
  children: ReactNode;
  onNavigate?: (section: TeacherSection) => void;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="teacherApp teacherShell" data-state={active} data-ui="teacher-shell">
      <aside className="teacherRail">
        <Link className="teacherBrand" href="/teacher" aria-label="返回 Lumi 教师工作台">
          <span className="teacherBrandMark" aria-hidden="true"><GraduationCap size={22} strokeWidth={1.8} /></span>
          <span><strong>LUMI</strong><small>教师端</small></span>
        </Link>
        <nav aria-label="教师工作台导航" className="teacherNav">
          {destinations.map(({ id, label, href, icon: Icon }) => (
            <Link
              aria-current={active === id ? "page" : undefined}
              className="teacherNavItem"
              href={href}
              key={id}
              onClick={(event) => {
                if (!onNavigate || id === "wiki") return;
                event.preventDefault();
                onNavigate(id);
              }}
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="teacherRailBoundary">
          <BookOpenCheck aria-hidden="true" size={18} />
          <p><strong>教师私有工作区</strong><span>学生不可见 · 发布通道关闭</span></p>
        </div>
      </aside>
      <main className="teacherCanvas">
        <header className="teacherTopbar">
          <div className="teacherTopbarCopy">
            {backHref ? <Link className="teacherBackLink" href={backHref}><ChevronLeft size={16} />{backLabel ?? "返回"}</Link> : null}
            <p className="teacherEyebrow">{eyebrow}</p>
            <h1 aria-label="教师学习分析工作台">{title}</h1>
            {description ? <p className="teacherDescription">{description}</p> : null}
          </div>
          {tools ? <div className="teacherTools">{tools}</div> : null}
        </header>
        <div className="teacherContent">{children}</div>
      </main>
    </div>
  );
}
