import { createHash } from "node:crypto";

import { z } from "zod";

export const CANDIDATE_RELEASE_SOURCE_BASELINE_COMMIT =
  "e9b91785151a600aa6f47e3b435907a10fe9a8d4" as const;
export const PRODUCTION_SURFACE_BASELINE_RELEASE_ID =
  "b5bec8274f351556f042f52a1dab0220725d4373" as const;
export const PRODUCTION_SURFACE_BASELINE_RECEIPT_PATH =
  "docs/release/baselines/lumi-production-surface-b5bec827-v1.json" as const;

export const PRODUCTION_SURFACE_BASELINE_FILES = Object.freeze([
  "app/layout.tsx",
  "app/globals.css",
  "app/page.tsx",
  "app/student/page.tsx",
  "app/api/agent/tasks/route.ts",
  "app/api/auth/student/route.ts",
  "app/api/student/dashboard/route.ts",
  "components/design-system/LumiUI.tsx",
  "components/home/LumiLandingPage.tsx",
  "components/student-v2/ArtifactPanel.tsx",
  "components/student-v2/ConversationPanel.tsx",
  "components/student-v2/LumiStudentApp.tsx",
  "components/student-v2/student-app.module.css",
  "components/student-v2/StudentEntryGate.tsx",
  "components/student-v2/StudentSidebar.tsx",
  "components/student-v2/use-lumi-student-session.ts",
  "components/client-api/index.ts",
  "components/client-api/client.ts",
  "components/client-api/config.ts",
  "components/client-api/contracts.ts",
  "components/client-api/request.ts",
  "components/client-api/transport.ts",
  "components/client-api/upload.ts",
  "lib/auth/errors.ts",
  "lib/auth/identity-code.ts",
  "lib/auth/project-session.ts",
  "lib/auth/rate-limit.ts",
  "lib/auth/route-handler.ts",
  "lib/auth/session.ts",
  "lib/auth/trusted-source.ts",
  "lib/services/access.ts",
  "lib/services/student-dashboard.ts",
] as const);

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const RelativePathSchema = z.string().regex(
  /^(?!.*(?:^|\/)\.\.(?:\/|$))(?!\/)(?![A-Za-z]:)(?!.*\\).+$/,
);

const ProductionSurfaceBaselineProjectionSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("LUMI_PRODUCTION_SURFACE_BASELINE"),
  releaseId: z.literal(PRODUCTION_SURFACE_BASELINE_RELEASE_ID),
  currentReleaseVerified: z.literal(true),
  service: z.literal("active"),
  health: z.literal("ok"),
  releaseMarker: z.object({
    bytes: z.number().int().positive(),
    sha256: HashSchema,
  }).strict(),
  files: z.array(z.object({
    path: RelativePathSchema,
    bytes: z.number().int().positive(),
    sha256: HashSchema,
  }).strict()).length(PRODUCTION_SURFACE_BASELINE_FILES.length),
  capturedAt: z.string().min(1),
}).strict();

export const ProductionSurfaceBaselineReceiptSchema =
  ProductionSurfaceBaselineProjectionSchema.extend({
    receiptSha256: HashSchema,
  }).strict();

export type ProductionSurfaceBaselineReceipt = z.infer<
  typeof ProductionSurfaceBaselineReceiptSchema
>;

export type ProductionSurfaceFileFingerprint =
  ProductionSurfaceBaselineReceipt["files"][number];

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function fingerprintProductionSurfaceFile(
  filePath: string,
  value: Uint8Array,
): ProductionSurfaceFileFingerprint {
  return {
    path: filePath,
    bytes: value.byteLength,
    sha256: createHash("sha256").update(value).digest("hex"),
  };
}

export function verifyProductionSurfaceBaselineReceipt(value: unknown) {
  const receipt = ProductionSurfaceBaselineReceiptSchema.parse(value);
  const { receiptSha256, ...projection } = receipt;
  if (receiptSha256 !== sha256(JSON.stringify(projection))) {
    throw new Error("PRODUCTION_SURFACE_BASELINE_RECEIPT_HASH_MISMATCH");
  }
  const paths = receipt.files.map(({ path }) => path);
  if (
    new Set(paths).size !== paths.length
    || paths.join("\n") !== PRODUCTION_SURFACE_BASELINE_FILES.join("\n")
  ) {
    throw new Error("PRODUCTION_SURFACE_BASELINE_FILE_SET_INVALID");
  }
  return receipt;
}
