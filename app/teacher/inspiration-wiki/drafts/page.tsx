import type { Metadata } from "next";

import { PrivateWikiDraftWorkspace } from "@/components/teacher/PrivateWikiDraftWorkspace";

export const metadata: Metadata = { title: "私有草稿编纂｜Lumi 教师端", robots: { index: false, follow: false } };

export default function PrivateWikiDraftsPage() { return <PrivateWikiDraftWorkspace />; }
