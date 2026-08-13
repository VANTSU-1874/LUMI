import type { Metadata } from "next";

import { PrivateDomainReviewEditor } from "@/components/teacher/PrivateDomainReviewEditor";

export const metadata: Metadata = { title: "教学域单项复核｜Lumi 教师端", robots: { index: false, follow: false } };
type Props = { params: Promise<{ reviewCaseId: string }> };

export default async function PrivateDomainReviewPage({ params }: Props) {
  return <PrivateDomainReviewEditor reviewCaseId={decodeURIComponent((await params).reviewCaseId)} />;
}
