import { expect, type Page } from "./fixtures";

const E2E_TEACHER_EMAIL = "teacher.e2e@example.com";
const E2E_TEACHER_PASSWORD = "LumiTeacher2026!";

export async function enterLegacyStudent(
  page: Page,
  identityCode: string,
  options: { waitForWorkspace?: boolean } = {},
) {
  await page.goto("/");
  const result = await page.evaluate(async ({ alias }) => {
    const response = await fetch("/api/auth/student", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ classCode: "E2E2026", alias }),
    });
    return { status: response.status, body: await response.text() };
  }, { alias: identityCode });
  expect(result.status, result.body).toBe(200);
  await page.goto("/student");
  await expect(page).toHaveURL(/\/student$/, { timeout: 30_000 });
  if (options.waitForWorkspace !== false) {
    await expect(page.getByRole("region", { name: "与 Lumi 对话" })).toBeVisible({
      timeout: 30_000,
    });
  }
}

export async function signInCurrentTeacher(page: Page) {
  await page.goto("/login?role=teacher&returnTo=%2Fteacher");
  await expect(page.getByRole("heading", { name: "教师端登录" })).toBeVisible();
  await page.getByLabel("邮箱").fill(E2E_TEACHER_EMAIL);
  await page.locator('input[name="password"]').fill(E2E_TEACHER_PASSWORD);
  await page.getByRole("button", { name: "登录教师端" }).click();
  await expect(page).toHaveURL(/\/teacher$/, { timeout: 30_000 });
}
