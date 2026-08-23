import type { Metadata } from "next";

import { SplitLoginEntry } from "@/components/entry/SplitLoginEntry";

export const metadata: Metadata = {
  title: "登录｜Lumi 鹿鸣",
  description: "使用 Lumi 邮箱账号登录；学生可自主注册，教师账号由课程管理员预置。",
};

type LoginPageProps = {
  searchParams: Promise<{
    mode?: string | string[];
    role?: string | string[];
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const role = Array.isArray(params.role) ? params.role[0] : params.role;
  return (
    <SplitLoginEntry
      initialMode={mode === "register" ? "SIGN_UP" : "SIGN_IN"}
      initialRole={mode !== "register" && role === "teacher" ? "TEACHER" : "STUDENT"}
    />
  );
}
