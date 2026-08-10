import { test as baseTest } from "@playwright/test";

import { setFreshTrustedSourceHeaders } from "./trusted-source";

type LumiE2EFixtures = {
  trustedSourceHeaders: void;
};

export const test = baseTest.extend<LumiE2EFixtures>({
  trustedSourceHeaders: [async ({ page }, use, testInfo) => {
    await setFreshTrustedSourceHeaders(
      page,
      `e2e-browser-${testInfo.workerIndex}-${testInfo.retry}`,
    );
    await use();
  }, { auto: true }],
});

export { expect } from "@playwright/test";
export type { Page } from "@playwright/test";
