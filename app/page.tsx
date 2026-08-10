import type { Metadata } from "next";

import { LumiLandingPage } from "@/components/home/LumiLandingPage";

export const metadata: Metadata = {
  title: "Lumi 鹿鸣｜视觉传达设计专业 AI 成长导师",
  description:
    "陪视觉传达设计专业学生看作品、讲依据、收束下一步，也让教师把自己的课程资料带进每一次反馈。",
};

export default function Home() {
  return <LumiLandingPage />;
}
