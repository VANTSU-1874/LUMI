import { notFound } from "next/navigation";

import { LumiUiPreview } from "@/components/design-system/LumiUiPreview";

export default function UiPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <LumiUiPreview />;
}
