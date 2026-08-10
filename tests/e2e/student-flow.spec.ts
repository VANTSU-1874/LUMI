import { expect, test, type Page } from "./fixtures";

const E2E_PASSWORD = "E2e-local-only-password-2026";

type StudentAccount = {
  email: string;
  name: string;
};

async function completeStudentOnboarding(page: Page) {
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "这步先跳过" }).click();
  }
  await page.getByRole("button", { name: "跳过并进入 Lumi" }).click();
  await expect(page.getByLabel("给 Lumi 发送消息")).toBeVisible({ timeout: 30_000 });
}

async function registerStudent(page: Page, account: StudentAccount) {
  await page.goto("/login?mode=register&returnTo=%2Fstudent");
  await expect(page.getByRole("heading", { name: "创建 Lumi 账号" })).toBeVisible();
  await page.getByLabel("姓名或常用称呼").fill(account.name);
  await page.getByLabel("邮箱").fill(account.email);
  await page.locator('input[name="password"]').fill(E2E_PASSWORD);
  await page.locator('input[name="passwordConfirmation"]').fill(E2E_PASSWORD);
  await page.getByLabel("班级邀请码").fill("E2E2026");
  const [registration] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/account/register")
      && response.request().method() === "POST"),
    page.getByRole("button", { name: "创建账号并进入" }).click(),
  ]);
  expect(registration.status()).toBe(200);
  await expect(page).toHaveURL(/\/student$/, { timeout: 30_000 });
  await completeStudentOnboarding(page);
}

async function loginStudent(page: Page, account: StudentAccount) {
  await page.context().clearCookies();
  await page.goto("/login?returnTo=%2Fstudent");
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await page.getByLabel("邮箱").fill(account.email);
  await page.locator('input[name="password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "登录 Lumi" }).click();
  await expect(page).toHaveURL(/\/student$/, { timeout: 30_000 });
  await expect(page.getByLabel("给 Lumi 发送消息")).toBeVisible({ timeout: 30_000 });
}

test("student lands in the assistant-ui conversation workspace", async ({ page }) => {
  test.setTimeout(60_000);
  const account = { email: "student-desktop@e2e.invalid", name: "桌面端学生" };
  await registerStudent(page, account);
  await loginStudent(page, account);
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

  await page.goto("/login?mode=register&returnTo=%2Fteacher");
  await expect(page.getByRole("heading", { name: "创建 Lumi 账号" })).toBeVisible();
  await page.getByRole("tab", { name: "教师账号" }).click();
  await page.getByLabel("姓名或常用称呼").fill("本地测试教师");
  await page.getByLabel("邮箱").fill("teacher-dashboard@e2e.invalid");
  await page.locator('input[name="password"]').fill(E2E_PASSWORD);
  await page.locator('input[name="passwordConfirmation"]').fill(E2E_PASSWORD);
  await page.getByLabel("教师访问码").fill("e2e-teacher-code");
  const [teacherRegistration] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/account/register")
      && response.request().method() === "POST"),
    page.getByRole("button", { name: "创建账号并进入" }).click(),
  ]);
  expect(teacherRegistration.status()).toBe(200);
  await expect(page).toHaveURL(/\/teacher$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "教师学习分析工作台" })).toBeVisible();
  const deniedStatus = await page.evaluate(async () =>
    (await fetch("/api/student/dashboard")).status);
  expect(deniedStatus).toBe(403);

  const fresh = await browser.newContext();
  expect((await fresh.request.get("/api/student/dashboard")).status()).toBe(401);
  await fresh.close();
});

test("mobile assistant-ui can open history without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const account = { email: "student-mobile@e2e.invalid", name: "移动端学生" };
  await registerStudent(page, account);
  await loginStudent(page, account);
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
