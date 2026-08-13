import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "灵感 Wiki｜Lumi 鹿鸣",
  description: "Lumi 应用内的设计灵感浏览功能。",
};

export const dynamic = "force-dynamic";

type InspirationPageProps = {
  searchParams: Promise<{
    case?: string | string[];
    entry?: string | string[];
    thread?: string | string[];
  }>;
};

export default async function InspirationPage({ searchParams }: InspirationPageProps) {
  const params = await searchParams;
  const entry = Array.isArray(params.entry) ? params.entry[0] : params.entry;
  const caseId = Array.isArray(params.case) ? params.case[0] : params.case;
  const thread = Array.isArray(params.thread) ? params.thread[0] : params.thread;
  const target = new URLSearchParams({ inspiration: "1" });
  if (entry) target.set("entry", entry);
  else if (caseId) target.set("inspirationCase", caseId);
  if (thread) target.set("thread", thread);
  // Compatibility-only deep link: the student always lands inside the
  // existing Lumi application shell, where the server student gate runs
  // before any case metadata is serialized.
  redirect(`/student?${target.toString()}`);
}
