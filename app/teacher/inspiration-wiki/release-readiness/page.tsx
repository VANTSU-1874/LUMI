import type { Metadata } from "next";

import { ReleaseReadinessWorkspace } from "@/components/teacher/ReleaseReadinessWorkspace";

export const metadata: Metadata = { title: "发布准备审计｜Lumi 教师端", robots: { index: false, follow: false } };

export default function ReleaseReadinessPage() { return <ReleaseReadinessWorkspace />; }
