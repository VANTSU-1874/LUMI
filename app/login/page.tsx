import type { Metadata } from "next";

import { SplitLoginEntry } from "@/components/entry/SplitLoginEntry";

export const metadata: Metadata = {
  title: "登录｜Lumi 鹿鸣",
  description: "使用 Lumi 邮箱账号登录，或通过班级邀请码创建学生账号。",
};

type LoginPageProps = {
  searchParams: Promise<{ mode?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const mode = (await searchParams).mode;
  return (
    <SplitLoginEntry
      initialMode={mode === "register" ? "SIGN_UP" : "SIGN_IN"}
    />
  );
}
