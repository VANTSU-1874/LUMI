import type { Metadata } from "next";

import { PrivateWikiPageDetail } from "@/components/teacher/PrivateWikiPageDetail";

export const metadata: Metadata = { title: "私有编纂页详情｜Lumi 教师端", robots: { index: false, follow: false } };

export default async function PrivateWikiPageDetailPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  return <PrivateWikiPageDetail pageId={decodeURIComponent(pageId)} />;
}
