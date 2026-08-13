import type { Metadata } from "next";

import { TeacherInspirationWikiWorkspace } from "@/components/teacher/TeacherInspirationWikiWorkspace";

export const metadata: Metadata = {
  title: "灵感 Wiki 私有工作区｜Lumi 教师端",
  robots: { index: false, follow: false },
};

export default function TeacherInspirationWikiPage() {
  return <TeacherInspirationWikiWorkspace />;
}
