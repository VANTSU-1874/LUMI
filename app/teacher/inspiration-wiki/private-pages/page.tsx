import type { Metadata } from "next";

import { PrivateWikiPageWorkspace } from "@/components/teacher/PrivateWikiPageWorkspace";

export const metadata: Metadata = { title: "私有编纂页｜Lumi 教师端", robots: { index: false, follow: false } };

export default function PrivateWikiPagesPage() { return <PrivateWikiPageWorkspace />; }
