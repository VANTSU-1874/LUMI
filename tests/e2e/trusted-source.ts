import { createHmac } from "node:crypto";

import type { Page } from "@playwright/test";

const E2E_AUTH_PROXY_SECRET = "e2e-auth-proxy-secret-at-least-32-characters-long";

export async function setFreshTrustedSourceHeaders(
  page: Page,
  sourceId = "e2e-browser",
) {
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const signature = createHmac("sha256", E2E_AUTH_PROXY_SECRET)
    .update(`${sourceId}\0${timestamp}`, "utf8")
    .digest("hex");

  await page.setExtraHTTPHeaders({
    "x-tonggan-source-id": sourceId,
    "x-tonggan-source-timestamp": timestamp,
    "x-tonggan-source-signature": signature,
  });
}
