import { expect, test, type Page } from "./fixtures";

async function loginStudent(page: Page) {
  await page.goto("/");
  await page.getByLabel("班级邀请码").fill("E2E2026");
  await page.getByLabel("匿名编号").fill("CD8L-N3R5-TQ9W");
  await page.getByRole("button", { name: "学生进入" }).click();
  await expect(page).toHaveURL(/\/student$/, { timeout: 30_000 });
  await expect(page.getByRole("region", { name: "与 Lumi 对话" })).toBeVisible({ timeout: 30_000 });
}

test("demo query still requires an authenticated Lumi identity", async ({ page }) => {
  await page.goto("/student?demo=1");
  await expect(page.getByRole("heading", { name: "先登录，再继续对话" })).toBeVisible();
  await expect(page.getByRole("link", { name: "前往登录" })).toHaveAttribute(
    "href",
    /returnTo=%2Fstudent/,
  );
});

test("teacher keeps demo data opt-in when real classes exist", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "教师" }).click();
  await page.getByLabel("教师访问码").fill("e2e-teacher-code");
  await page.getByRole("button", { name: "教师进入" }).click();
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByRole("heading", { name: "教师学习分析工作台" })).toBeVisible();
  await expect(page.getByText("加载完成", { exact: true })).toBeVisible();

  const includeDemo = page.getByRole("checkbox", { name: "显示演示数据" });
  const demoOption = page.getByRole("option", { name: /数字交互文创设计·竞赛演示班/ });
  await expect(includeDemo).not.toBeChecked();
  await expect(demoOption).toHaveCount(0);
  const includeDemoResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/teacher/dashboard"
      && url.searchParams.get("includeDemo") === "true"
      && !url.searchParams.has("classId");
  });
  await includeDemo.click();
  await expect(includeDemo).toBeChecked();
  expect((await includeDemoResponse).status()).toBe(200);
  await expect(demoOption).toHaveCount(1, { timeout: 15_000 });

  const demoAnalyticsResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/teacher/dashboard"
      && url.searchParams.get("classId") === "demo-class-digi2026"
      && url.searchParams.get("includeDemo") === "true";
  });
  await page.getByLabel("选择班级").selectOption("demo-class-digi2026");
  expect((await demoAnalyticsResponse).status()).toBe(200);
  await expect(page.getByText("真实 0 人 · 演示 5 人")).toBeVisible();
  await expect(page.getByRole("heading", { name: "真实教学指标" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "演示指标" })).toBeVisible();
  await expect(page.getByText("演示学习者A", { exact: true })).toBeVisible();
  await expect(page.getByText("演示数据").first()).toBeVisible();
});

test("current workspace selects a course-reference capability and answers without a live model", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    class DemoSpeechRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult = null;
      onerror = null;
      onend = null;
      start() {}
      stop() {}
      abort() {}
    }
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: DemoSpeechRecognition,
    });
  });

  await loginStudent(page);
  await expect(page.getByRole("button", { name: "语音输入" })).toBeVisible();

  await page.getByRole("button", { name: /新对话/ }).click();
  await expect(page.getByRole("heading", { name: "你今天想一起把什么设计清楚？" })).toBeVisible();
  await page.getByRole("button", { name: "打开扩展能力面板" }).click();
  await page.getByRole("menuitem", { name: /课程资料检索/ }).click();
  await expect(page.getByRole("button", { name: "移除课程资料检索" })).toBeVisible();
  const question = "我想先理清这本导览册的阅读目标";
  await page.getByRole("textbox", { name: "给 Lumi 发送消息" }).fill(question);
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText(question, { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Lumi 最终回答" })).toBeVisible({ timeout: 30_000 });
});
