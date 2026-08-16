import type { Metadata } from "next";

import { PrivateDomainReviewWorkspace } from "@/components/teacher/PrivateDomainReviewWorkspace";

export const metadata: Metadata = { title: "教学域批量审核｜Lumi 教师端", robots: { index: false, follow: false } };

export default function PrivateDomainReviewsPage() { return <PrivateDomainReviewWorkspace />; }
