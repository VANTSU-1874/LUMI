import { expect, test, type Page } from "./fixtures";
import { enterLegacyStudent, signInCurrentTeacher } from "./auth-helpers";

import { validPng } from "../helpers/image-fixtures";

async function studentLogin(page: Page, identityCode: string) {
  for (const path of ["/api/account/session", "/api/agent/onboarding"]) {
    await page.goto(path);
  }
  await enterLegacyStudent(page, identityCode, { waitForWorkspace: false });
  const workspace = page.getByRole("region", { name: "与 Lumi 对话" });
  const retrySession = page
    .getByRole("region", { name: "暂时无法确认登录状态" })
    .getByRole("button", { name: "重新检查" });
  await expect(workspace.or(retrySession)).toBeVisible({ timeout: 30_000 });
  if (await retrySession.isVisible()) await retrySession.click();
  await expect(workspace).toBeVisible({ timeout: 30_000 });
}

test("entry and current Lumi workspace expose landmarks, keyboard focus and errors", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("tablist", { name: "进入身份" })).toBeVisible();

  const studentTab = page.getByRole("tab", { name: "学生" });
  await studentTab.focus();
  await expect(studentTab).toBeFocused();
  expect(await studentTab.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "教师" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Tab");
  const createStudent = page.getByRole("button", { name: "创建学生账号" });
  await expect(createStudent).toBeFocused();

  await page.goto("/login");
  const loginStudentTab = page.getByRole("tab", { name: "学生登录" });
  await loginStudentTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "教师登录" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("邮箱")).toBeFocused();

  await page.route("**/api/auth/sign-in/email", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid credentials" }),
      contentType: "application/json",
      status: 401,
    });
  });
  await page.getByLabel("邮箱").fill("missing@e2e.invalid");
  await page.locator('input[name="password"]').fill("wrong-password");
  await page.getByRole("button", { name: "登录学生端" }).press("Enter");
  const entryError = page.getByText("邮箱或密码不正确", { exact: true });
  await expect(entryError).toBeFocused();
  await expect(entryError).toHaveAttribute("role", "alert");
  await page.unroute("**/api/auth/sign-in/email");

  await studentLogin(page, "JK4P-R6V8-YZ5B");
  await expect(page.getByRole("complementary", { name: "历史对话" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Lumi 工具" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "给 Lumi 发送消息" })).toBeVisible();
});

test("current composer exposes named attachment and capability controls", async ({ page }) => {
  test.setTimeout(90_000);
  await studentLogin(page, "GH2N-Q5T7-WX3Z");

  const extensionToggle = page.getByRole("button", { name: "打开扩展能力面板" });
  await extensionToggle.focus();
  await expect(extensionToggle).toBeFocused();
  await extensionToggle.click();
  const panel = page.getByRole("menu", { name: "扩展能力面板" });
  await expect(panel).toBeVisible();
  const addAttachment = panel.getByRole("menuitem", { name: /添加作品、照片或文件/ });
  await expect(addAttachment).toBeEnabled();
  await expect(panel.getByRole("menuitem", { name: /五维一收/ })).toBeEnabled();

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    addAttachment.click(),
  ]);
  await fileChooser.setFiles({ name: "input.png", mimeType: "image/png", buffer: validPng });
  await expect(page.getByText("input.png", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "移除附件 input.png" })).toBeVisible();

  await extensionToggle.click();
  await panel.getByRole("menuitem", { name: /五维一收/ }).click();
  await expect(page.getByRole("button", { name: "移除五维一收" })).toBeVisible();
});

test("teacher analytics has named tables and keyboard-visible actions", async ({ page }) => {
  test.setTimeout(60_000);
  await signInCurrentTeacher(page);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { name: "教师学习分析工作台" })).toBeVisible();
  await expect(page.getByText("加载完成", { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "学生与班级" }).click();
  const table = page.getByRole("table", { name: "班级学习者阶段与支持需求" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "学生" })).toBeVisible();
  const review = page.getByRole("button", { name: /查看匿名-教师01/ });
  await review.focus();
  await expect(review).toBeFocused();
  expect(await review.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "匿名-教师01" })).toBeVisible();
  await page.getByRole("link", { name: "证据与隐私" }).click();
  await expect(page.getByRole("link", { name: "打开隐私与证据删除中心" })).toHaveAttribute("href", "/privacy");
});
