import type { Metadata } from "next";

import { InspirationReviewWorkspace } from "@/components/teacher/InspirationReviewWorkspace";

export const metadata: Metadata = {
  title: "ReviewPack 审核｜Lumi 教师端",
  robots: { index: false, follow: false },
};

export default async function InspirationReviewPage({ params }: { params: Promise<{ reviewPackId: string }> }) {
  const { reviewPackId } = await params;
  return <InspirationReviewWorkspace reviewPackId={decodeURIComponent(reviewPackId)} />;
}
