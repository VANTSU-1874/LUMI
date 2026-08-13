import type { Metadata } from "next";

import { PrivateWikiDraftEditor } from "@/components/teacher/PrivateWikiDraftEditor";

export const metadata: Metadata = { title: "编辑私有草稿｜Lumi 教师端", robots: { index: false, follow: false } };
type Props = { params: Promise<{ draftId: string }> };

export default async function PrivateWikiDraftPage({ params }: Props) {
  return <PrivateWikiDraftEditor draftId={decodeURIComponent((await params).draftId)} />;
}
