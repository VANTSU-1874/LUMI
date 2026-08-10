import { createDb } from "@/lib/db/client";
import { storeStudentMemory } from "@/lib/agent/student-memory";

import { expect, test, type Page } from "./fixtures";

const E2E_PASSWORD = "E2e-local-only-password-2026";
const E2E_DATABASE_PATH = process.env.DATABASE_PATH
  ?? `.runtime/e2e-demo-student-flow-${process.env.PLAYWRIGHT_PORT ?? "3000"}.sqlite`;
const TIER_TWO_MEMORY_CONTENT = "隔离验收用的 Tier 2 学习信号。";

type StudentAccount = {
  email: string;
  name: string;
};

type SeededStudentMemory = {
  classId: string;
  id: string;
  memoryId: string;
};

async function completeStudentOnboarding(page: Page) {
  const firstSkip = page.getByRole("button", { name: "这步先跳过" });
  const retrySession = page
    .getByRole("region", { name: "暂时无法确认登录状态" })
    .getByRole("button", { name: "重新检查" });

  await expect(firstSkip.or(retrySession)).toBeVisible({ timeout: 30_000 });
  if (await retrySession.isVisible()) {
    await retrySession.click();
  }
  await expect(firstSkip).toBeVisible({ timeout: 30_000 });
  await firstSkip.click();
  await page.getByRole("radio", { name: /书籍设计/ }).click();
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByRole("button", { name: "这步先跳过" }).click();
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

async function registerTeacher(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login?mode=register&returnTo=%2Fteacher");
  await expect(page.getByRole("heading", { name: "创建 Lumi 账号" })).toBeVisible();
  await page.getByRole("tab", { name: "教师账号" }).click();
  await page.getByLabel("姓名或常用称呼").fill("H1-H3 隔离教师");
  await page.getByLabel("邮箱").fill("teacher-g0b-memory@e2e.invalid");
  await page.locator('input[name="password"]').fill(E2E_PASSWORD);
  await page.locator('input[name="passwordConfirmation"]').fill(E2E_PASSWORD);
  await page.getByLabel("教师访问码").fill("e2e-teacher-code");
  const [registration] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/account/register")
      && response.request().method() === "POST"),
    page.getByRole("button", { name: "创建账号并进入" }).click(),
  ]);
  expect(registration.status()).toBe(200);
  await expect(page).toHaveURL(/\/teacher$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "教师学习分析工作台" })).toBeVisible();
}

function seedTierTwoMemory(email: string): SeededStudentMemory {
  const connection = createDb(E2E_DATABASE_PATH);
  try {
    const student = connection.sqlite.prepare(`
      SELECT course.id, course.class_id AS classId
      FROM auth_user auth
      INNER JOIN users course ON course.id = auth.id
      WHERE auth.email = ? AND course.role = 'STUDENT'
    `).get(email) as { id: string; classId: string } | undefined;
    if (!student) throw new Error(`E2E student identity was not created for ${email}`);
    const memory = storeStudentMemory(connection.db, {
      studentId: student.id,
      classId: student.classId,
      kind: "RECURRING_STRUGGLE",
      content: TIER_TWO_MEMORY_CONTENT,
      salience: 9,
    }, { environment: {} });
    return { classId: student.classId, id: student.id, memoryId: memory.id };
  } finally {
    connection.sqlite.close();
  }
}

async function openStudentMemorySettings(page: Page) {
  await page.getByRole("button", { name: "打开账户菜单" }).click();
  await page.getByRole("menuitem", { name: "设置" }).click();
  await page.getByRole("button", { name: "数据管理" }).click();
  await expect(page.getByText("我的长期记忆")).toBeVisible();
  await expect(page.getByText("Tier 2 · 学习信号")).toBeVisible();
}

test("G0-B H1–H3 use current student, teacher, and cross-student browser sessions", async ({ page }) => {
  test.setTimeout(180_000);

  const studentA = { email: "student-a-g0b-memory@e2e.invalid", name: "隔离学生 A" };
  await registerStudent(page, studentA);
  const seededA = seedTierTwoMemory(studentA.email);

  await openStudentMemorySettings(page);
  await expect(page.getByRole("button", { name: "删除" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "提出异议" })).toBeVisible();

  const tierTwoDelete = await page.evaluate(async ({ memoryId }) => {
    const response = await fetch(`/api/agent/memories/${encodeURIComponent(memoryId)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "RECURRING_STRUGGLE" }),
    });
    return { status: response.status, payload: await response.json() };
  }, { memoryId: seededA.memoryId });
  expect(tierTwoDelete).toMatchObject({
    status: 403,
    payload: { code: "STUDENT_MEMORY_TIER_2_DELETE_FORBIDDEN" },
  });
  await expect(page.getByText(TIER_TWO_MEMORY_CONTENT)).toBeVisible();

  await page.getByRole("button", { name: "提出异议" }).click();
  await page.getByText("异议说明（可选，最多 500 字）").locator("..").getByRole("textbox").fill("隔离验收异议。");
  await page.getByRole("button", { name: "提交异议" }).click();
  await expect(page.getByRole("button", { name: "更新异议" })).toBeVisible({ timeout: 30_000 });

  await registerTeacher(page);
  await page.getByLabel("选择班级").selectOption(seededA.classId);
  const studentRow = page.getByRole("button", { name: new RegExp("^查看隔离学生 A") });
  await expect(studentRow).toBeVisible({ timeout: 30_000 });
  await studentRow.click();
  await expect(page.getByRole("heading", { name: /隔离学生 A/ })).toBeVisible();
  await expect(page.getByText(TIER_TWO_MEMORY_CONTENT)).toBeVisible();
  await expect(page.getByLabel("学生异议")).toBeVisible();
  await expect(page.getByLabel("学生异议")).toContainText("原始记录保留不变");

  await page.context().clearCookies();
  const studentB = { email: "student-b-g0b-memory@e2e.invalid", name: "隔离学生 B" };
  await registerStudent(page, studentB);
  const crossStudent = await page.evaluate(async ({ memoryId, studentId }) => {
    const read = await fetch(`/api/agent/memories?studentId=${encodeURIComponent(studentId)}`);
    const remove = await fetch(`/api/agent/memories/${encodeURIComponent(memoryId)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "RECURRING_STRUGGLE" }),
    });
    const dispute = await fetch(`/api/agent/memories/${encodeURIComponent(memoryId)}/dispute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "RECURRING_STRUGGLE", note: "越权请求" }),
    });
    return { read: read.status, remove: remove.status, dispute: dispute.status };
  }, { memoryId: seededA.memoryId, studentId: seededA.id });
  expect(crossStudent).toEqual({ read: 403, remove: 404, dispute: 404 });
  expect(seededA.classId).toBe("e2e-class");
});
