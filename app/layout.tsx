import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumi 鹿鸣｜懂课程，也懂你的设计导师",
  description: "面向视觉传达设计专业学生的课程化设计导师，支持对话、作品会诊与成长档案。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
