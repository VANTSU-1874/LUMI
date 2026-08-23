import type { Metadata } from "next";
import { SessionFreshnessBoundary } from "@/components/auth/SessionFreshnessBoundary";
import { LUMI_PROJECT_DESCRIPTION, LUMI_PROJECT_NAME } from "@/lib/product-identity";
import "./globals.css";

export const metadata: Metadata = {
  title: LUMI_PROJECT_NAME,
  description: LUMI_PROJECT_DESCRIPTION,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <SessionFreshnessBoundary>{children}</SessionFreshnessBoundary>
      </body>
    </html>
  );
}
