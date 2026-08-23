import type { Metadata } from "next";

import { EvaluatorPreview } from "@/components/preview/EvaluatorPreview";

export const metadata: Metadata = {
  title: "评委预览演示｜Lumi 鹿鸣",
  description: "无需登录，点击固定场景即可观看 Lumi 鹿鸣现场模型回复。",
};

export default function PreviewPage() {
  return <EvaluatorPreview />;
}
