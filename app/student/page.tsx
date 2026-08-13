import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";

import { AssistantLabAccessGate } from "@/components/assistant-lab/AssistantLabAccessGate";
import { AssistantUiLab } from "@/components/assistant-lab/AssistantUiLab";
import { OnboardingGate } from "@/components/assistant-lab/OnboardingGate";
import { inspirationEntries } from "@/components/inspiration/inspiration-wiki-data";
import { readLumiAccountSession } from "@/lib/auth/account-session";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth/session";
import { readEnv } from "@/lib/config/env";
import { createDb } from "@/lib/db/client";
import { InspirationViewerIdentityForbiddenError, readStudentInspirationViewerScope } from "@/lib/services/inspiration-viewer-scope";

export const metadata: Metadata = {
  title: "学生设计工作台｜Lumi 鹿鸣",
  description: "和 Lumi 一起围绕作品、课程与项目形成可继续推进的设计判断。",
};

type StudentPageProps = {
  searchParams: Promise<{
    entry?: string | string[];
    inspiration?: string | string[];
    inspirationFixture?: string | string[];
    inspirationCase?: string | string[];
    thread?: string | string[];
  }>;
};

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function requireStudentWorkspace(returnTo: string) {
  const request = new NextRequest("http://lumi.local/student", { headers: await headers() });
  const accountSession = await readLumiAccountSession(request);
  if (accountSession) {
    if (accountSession.role === "STUDENT") return accountSession;
    redirect("/teacher");
  }

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    try {
      const legacySession = await verifySession(token, readEnv(process.env).sessionSecret);
      if (legacySession.role === "STUDENT") return legacySession;
      redirect("/teacher");
    } catch {
      // An invalid legacy token falls through to the ordinary login flow.
    }
  }
  redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export const dynamic = "force-dynamic";

export default async function StudentPage({ searchParams }: StudentPageProps) {
  const params = await searchParams;
  const inspirationMode = scalar(params.inspiration) === "1";
  const selectedInspirationCase = inspirationMode
    ? scalar(params.entry) ?? scalar(params.inspirationCase)
    : scalar(params.inspirationCase);
  const thread = scalar(params.thread);
  const canonicalSearch = new URLSearchParams();
  if (inspirationMode) canonicalSearch.set("inspiration", "1");
  if (selectedInspirationCase) {
    canonicalSearch.set(inspirationMode ? "entry" : "inspirationCase", selectedInspirationCase);
  }
  if (thread) canonicalSearch.set("thread", thread);
  const returnTo = `/student${canonicalSearch.size ? `?${canonicalSearch}` : ""}`;
  const actor = await requireStudentWorkspace(returnTo);
  if (inspirationMode) {
    const connection = createDb(readEnv(process.env).databasePath);
    try {
      readStudentInspirationViewerScope(connection.db, actor);
    } catch (error) {
      if (error instanceof InspirationViewerIdentityForbiddenError) redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      throw error;
    } finally {
      connection.sqlite.close();
    }
  }
  const useFixtureBrowser = process.env.NODE_ENV === "development" && scalar(params.inspirationFixture) === "1";

  return (
    <AssistantLabAccessGate returnTo={returnTo}>
      <OnboardingGate>
        <AssistantUiLab
          inspirationCase={selectedInspirationCase}
          inspirationEntries={useFixtureBrowser ? inspirationEntries : undefined}
          inspirationMode={inspirationMode}
        />
      </OnboardingGate>
    </AssistantLabAccessGate>
  );
}
