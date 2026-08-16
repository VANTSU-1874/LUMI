import type { Metadata } from "next";

import { EvidenceGapReviewWorkspace } from "@/components/teacher/InspirationReviewWorkspace";

export const metadata: Metadata = { title: "缺证候选审核｜Lumi 教师端", robots: { index: false, follow: false } };

export default async function EvidenceGapReviewPage({ params }: { params: Promise<{ reviewPackId: string }> }) {
  const { reviewPackId } = await params;
  return <EvidenceGapReviewWorkspace reviewPackId={decodeURIComponent(reviewPackId)} />;
}
