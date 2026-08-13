import type { Metadata } from "next";

import { PrivateInternalCatalogWorkspace } from "@/components/teacher/PrivateInternalCatalogWorkspace";

export const metadata: Metadata = { title: "私有内部目录｜Lumi 教师端", robots: { index: false, follow: false } };

export default function PrivateInternalCatalogPage() { return <PrivateInternalCatalogWorkspace />; }
