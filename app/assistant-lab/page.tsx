import type { Metadata } from "next";

import { AssistantLabAccessGate } from "@/components/assistant-lab/AssistantLabAccessGate";
import { AssistantUiLab } from "@/components/assistant-lab/AssistantUiLab";
import { OnboardingGate } from "@/components/assistant-lab/OnboardingGate";

export const metadata: Metadata = {
  title: "assistant-ui 功能基准 | Lumi",
  description: "Lumi 对话工作台的 assistant-ui 功能基准页。",
};

export default function AssistantLabPage() {
  return (
    <AssistantLabAccessGate returnTo="/assistant-lab">
      <OnboardingGate>
        <AssistantUiLab />
      </OnboardingGate>
    </AssistantLabAccessGate>
  );
}
