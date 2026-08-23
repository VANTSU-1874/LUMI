import type { Metadata } from "next";

import { LumiLandingPage } from "@/components/home/LumiLandingPage";
import { LUMI_PROJECT_DESCRIPTION, LUMI_PROJECT_NAME } from "@/lib/product-identity";

export const metadata: Metadata = {
  title: LUMI_PROJECT_NAME,
  description: LUMI_PROJECT_DESCRIPTION,
};

export default function Home() {
  return <LumiLandingPage />;
}
