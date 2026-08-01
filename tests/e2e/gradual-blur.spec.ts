import { expect, test } from "./fixtures";

test.describe("Lumi immersive homepage", () => {
  test("keeps the current entry path reachable on desktop", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await expect(page.locator("header#top")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "首页导航" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "我们今天做什么" })).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath("desktop-top.png") });
    await page.locator("#start").scrollIntoViewIfNeeded();
    await expect(page.getByRole("tablist", { name: "进入身份" })).toBeVisible();
    await expect(page.getByRole("link", { name: /进入工作台/ })).toHaveAttribute("href", "/student?demo=1");
    await page.screenshot({ path: testInfo.outputPath("desktop-entry.png") });
  });

  test("keeps the current entry path readable on mobile", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.locator("#start").scrollIntoViewIfNeeded();

    const pageWidths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));

    expect(pageWidths.scroll).toBeLessThanOrEqual(pageWidths.client);
    await expect(page.getByRole("tablist", { name: "进入身份" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "学生" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "教师" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("mobile-entry.png") });
  });
});
