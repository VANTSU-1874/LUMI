import { expect, test, type Page } from "./fixtures";

const IDENTITY_CODES = ["AB7K-C9M2-Q4RP", "CD8L-N3R5-TQ9W", "EF9M-P4S6-VR2X"] as const;

async function loginStudent(page: Page, identityCode: string = IDENTITY_CODES[0]) {
  await page.goto("/");
  await page.getByRole("tab", { name: "学生" }).click();
  await page.getByLabel("班级邀请码").fill("E2E2026");
  await page.getByLabel("匿名编号").fill(identityCode);
  await page.getByRole("button", { name: "学生进入" }).click();
  await expect(page).toHaveURL(/\/student$/, { timeout: 30_000 });
  await expect(page.getByLabel("给 Lumi 发送消息")).toBeVisible({ timeout: 30_000 });
}

test("student lands in the assistant-ui conversation workspace", async ({ page }) => {
  test.setTimeout(60_000);
  await loginStudent(page);
  await expect(page.getByRole("heading", { name: "你今天想一起把什么设计清楚？" })).toBeVisible();
  const history = page.getByRole("complementary", { name: "历史对话" });
  await expect(history).toBeVisible();
  await expect(history.getByRole("button", { name: "打开账户菜单" })).toBeVisible();

  await page.getByRole("button", { name: /新对话/ }).click();
  await expect(page.getByLabel("给 Lumi 发送消息")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("给 Lumi 发送消息")).toBeVisible();
});

test("dashboard enforces student role", async ({ browser, request, page }) => {
  test.setTimeout(60_000);
  const anonymous = await request.get("/api/student/dashboard");
  expect(anonymous.status()).toBe(401);

  await page.goto("/");
  await page.getByRole("tab", { name: "教师" }).click();
  await page.getByLabel("教师访问码").fill("e2e-teacher-code");
  const [teacherLogin] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/auth/teacher")),
    page.getByRole("button", { name: "教师进入" }).click(),
  ]);
  expect(teacherLogin.status()).toBe(200);
  await expect(page).toHaveURL(/\/teacher$/, { timeout: 30_000 });
  const deniedStatus = await page.evaluate(async () =>
    (await fetch("/api/student/dashboard")).status);
  expect(deniedStatus).toBe(403);

  const fresh = await browser.newContext();
  expect((await fresh.request.get("/api/student/dashboard")).status()).toBe(401);
  await fresh.close();
});

test("mobile assistant-ui can open history without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginStudent(page, IDENTITY_CODES[2]);
  await expect(page.getByRole("main")).toBeVisible();
  const composer = page.getByLabel("给 Lumi 发送消息");
  const menuButton = page.getByRole("button", { name: "打开历史对话" });
  await expect(composer).toBeVisible();
  await menuButton.click();

  const sidebar = page.getByRole("complementary", { name: "历史对话" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "新对话" })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 568 });
  await composer.fill(`https://example.com/${"a".repeat(300)}`);
  const viewport = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(viewport.bodyWidth).toBeLessThanOrEqual(viewport.innerWidth);
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.innerWidth);
});
