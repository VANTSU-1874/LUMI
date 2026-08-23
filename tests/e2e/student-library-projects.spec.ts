import { expect, test, type Page } from "./fixtures";

import { validPng } from "../helpers/image-fixtures";

const E2E_PASSWORD = "E2e-local-only-password-2026";

async function registerStudent(page: Page) {
  await page.goto("/login?mode=register&returnTo=%2Fstudent");
  await page.getByLabel("姓名或常用称呼").fill("文件库验收学生");
  await page.getByLabel("邮箱").fill(`student-library-${Date.now()}@e2e.invalid`);
  await page.locator('input[name="password"]').fill(E2E_PASSWORD);
  await page.locator('input[name="passwordConfirmation"]').fill(E2E_PASSWORD);
  const [registration] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/account/register")),
    page.getByRole("button", { name: "创建账号并进入" }).click(),
  ]);
  expect(registration.status()).toBe(200);
  await expect(page).toHaveURL(/\/student$/, { timeout: 30_000 });
  const retrySession = page
    .getByRole("region", { name: "暂时无法确认登录状态" })
    .getByRole("button", { name: "重新检查" });
  const firstSkip = page.getByRole("button", { name: "这步先跳过" });
  await expect(firstSkip.or(retrySession)).toBeVisible({ timeout: 30_000 });
  if (await retrySession.isVisible()) await retrySession.click();
  await expect(firstSkip).toBeVisible({ timeout: 30_000 });
  for (let step = 0; step < 3; step += 1) {
    await firstSkip.click();
  }
  await page.getByRole("button", { name: "跳过并进入 Lumi" }).click();
  await expect(page.getByLabel("给 Lumi 发送消息")).toBeVisible({ timeout: 30_000 });
}

test("student projects and file library persist through the authenticated workspace", async ({ page }) => {
  test.setTimeout(120_000);
  await registerStudent(page);

  const sidebar = page.getByRole("complementary", { name: "历史对话" });
  await sidebar.getByRole("button", { name: "项目" }).click();
  await expect(page.getByRole("heading", { name: "项目" })).toBeVisible();
  await page.getByLabel("项目名称").fill("课程海报重构");
  const [created] = await Promise.all([
    page.waitForResponse((response) => (
      response.url().endsWith("/api/agent/projects")
      && response.request().method() === "POST"
    )),
    page.getByRole("button", { name: "新建项目" }).click(),
  ]);
  expect(created.status()).toBe(201);
  await expect(page.getByLabel("给 Lumi 发送消息")).toBeVisible({ timeout: 30_000 });

  await sidebar.getByRole("button", { name: "文件库" }).click();
  await expect(page.getByRole("heading", { name: "文件库" })).toBeVisible();
  const [uploaded] = await Promise.all([
    page.waitForResponse((response) => (
      response.url().endsWith("/api/agent/library")
      && response.request().method() === "POST"
    )),
    page.getByLabel("选择要上传的图片").setInputFiles({
      name: "海报构图.png",
      mimeType: "image/png",
      buffer: validPng,
    }),
  ]);
  expect(uploaded.status()).toBe(201);
  await expect(page.getByText("海报构图.png")).toBeVisible();
  await expect(page.getByTitle("课程海报重构")).toBeVisible();
  const preview = page.getByRole("img", { name: "海报构图.png" });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  const library = await page.evaluate(async () => (
    await (await fetch("/api/agent/library", { cache: "no-store" })).json()
  )) as { assets: Array<{ downloadUrl: string; project: { title: string } | null }> };
  expect(library.assets).toHaveLength(1);
  expect(library.assets[0]?.project?.title).toBe("课程海报重构");
  const contentStatus = await page.evaluate(async (url) => (await fetch(url)).status, library.assets[0]!.downloadUrl);
  expect(contentStatus).toBe(200);

  await page.screenshot({ path: ".runtime/student-library-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "文件库" })).toBeVisible();
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  await page.waitForTimeout(250);
  await page.screenshot({ path: ".runtime/student-library-mobile.png", fullPage: true });

  await page.getByRole("button", { name: "打开历史对话" }).click();
  await sidebar.getByRole("button", { name: "项目" }).click();
  const projectRow = page.locator("article").filter({ hasText: "课程海报重构" });
  const projectTitle = projectRow.getByText("课程海报重构", { exact: true });
  await expect(projectRow).toBeVisible();
  await expect(projectTitle).toBeVisible();
  const projectWidths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(projectWidths.document).toBeLessThanOrEqual(projectWidths.viewport);
  const titleBounds = await projectTitle.boundingBox();
  expect(titleBounds).not.toBeNull();
  expect(titleBounds!.x).toBeGreaterThanOrEqual(0);
  expect(titleBounds!.x + titleBounds!.width).toBeLessThanOrEqual(projectWidths.viewport);
  await page.waitForTimeout(250);
  await page.screenshot({ path: ".runtime/student-projects-mobile.png", fullPage: true });
});
