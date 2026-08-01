import { notFound } from "next/navigation";

import { MockContractPreview } from "@/components/client-api/MockContractPreview";

export default function MockContractPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MockContractPreview />;
}
