import type { Metadata } from "next";

import { AssistantLabAccessGate } from "@/components/assistant-lab/AssistantLabAccessGate";
import { AssistantUiLab } from "@/components/assistant-lab/AssistantUiLab";
import { OnboardingGate } from "@/components/assistant-lab/OnboardingGate";

export const metadata: Metadata = {
  title: "学生设计工作台｜Lumi 鹿鸣",
  description: "和 Lumi 一起围绕作品、课程与项目形成可继续推进的设计判断。",
};

export default function StudentPage() {
  return (
    <AssistantLabAccessGate returnTo="/student">
      <OnboardingGate>
        <AssistantUiLab />
      </OnboardingGate>
    </AssistantLabAccessGate>
  );
}
