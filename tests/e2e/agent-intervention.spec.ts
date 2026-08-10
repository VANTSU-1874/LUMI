import { expect, test, type Page } from "./fixtures";

const INTERVENTION_STUDENT_CODE = "ST6W-U4Y8-A7KD";

async function loginInterventionStudent(page: Page) {
  await page.goto("/");
  await page.getByLabel("班级邀请码").fill("E2E2026");
  await page.getByLabel("匿名编号").fill(INTERVENTION_STUDENT_CODE);
  await page.getByRole("button", { name: "学生进入" }).click();
  await expect(page).toHaveURL(/\/student$/, { timeout: 30_000 });
  const workspace = page.getByRole("region", { name: "与 Lumi 对话" });
  const retrySession = page.getByRole("button", { name: "重新检查" });
  await expect(workspace.or(retrySession)).toBeVisible({ timeout: 30_000 });
  if (await retrySession.isVisible()) await retrySession.click();
  await expect(workspace).toBeVisible({ timeout: 30_000 });
}

test("running Web agent accepts durable follow-up and steering on desktop and 375px", async ({
  page,
}) => {
  test.setTimeout(210_000);
  await page.route(
    "**/api/agent/runs/*/events/stream*",
    (route) => route.abort(),
  );
  await loginInterventionStudent(page);
  const runningTaskButton = page.getByRole("button", {
    name: "运行中的海报方案",
    exact: true,
  });
  await runningTaskButton.click();
  const followUpButton = page.getByRole("button", { name: "追加到下一轮" });
  await expect(followUpButton).toBeVisible({ timeout: 30_000 });

  const composer = page.getByRole("textbox", { name: "给 Lumi 发送消息" });
  await expect(composer).toBeEnabled();
  await composer.focus();
  await expect(composer).toBeFocused();
  await composer.fill("第一行");
  await page.keyboard.press("Shift+Enter");
  await expect(composer).toHaveValue("第一行\n");
  await composer.fill("");

  const artworkButton = page.getByRole("button", {
    name: "打开扩展能力面板",
  });
  await expect(artworkButton).toBeDisabled();
  await expect(artworkButton).toHaveAttribute(
    "title",
    "本轮结束后可添加作品",
  );
  const speechButton = page.getByRole("button", { name: "语音输入" });
  await expect(speechButton).toBeDisabled();

  await composer.fill("完成后再给三个版式方案");
  await followUpButton.click();
  const queue = page.getByRole("region", { name: "后续消息队列" });
  await expect(queue.getByText("完成后再给三个版式方案"))
    .toBeVisible({ timeout: 15_000 });
  await expect(queue.getByText("已排队")).toBeVisible({ timeout: 15_000 });

  await composer.fill("先不要谈颜色，改看信息层级");
  await page.getByRole("button", { name: "改变当前方向" }).click();
  await expect(queue.getByText("先不要谈颜色，改看信息层级"))
    .toBeVisible({ timeout: 15_000 });
  await expect(queue.getByText("正在切换方向"))
    .toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: /新对话/ }).click();
  await expect(page.getByRole("heading", {
    name: "你今天想一起把什么设计清楚？",
  }))
    .toBeVisible();
  await runningTaskButton.click();
  await expect(queue.getByText("已排队")).toBeVisible({ timeout: 15_000 });
  await expect(queue.getByText("正在切换方向"))
    .toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(runningTaskButton).toBeVisible({ timeout: 30_000 });
  await runningTaskButton.click();
  await expect(followUpButton).toBeVisible({ timeout: 30_000 });
  await expect(composer).toBeEnabled();
  await expect(queue.getByText("完成后再给三个版式方案"))
    .toBeVisible({ timeout: 30_000 });
  await expect(queue.getByText("先不要谈颜色，改看信息层级"))
    .toBeVisible({ timeout: 30_000 });

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(composer).toBeVisible();
  await expect(followUpButton).toBeVisible();
  await expect(page.getByRole("button", { name: "改变当前方向" }))
    .toBeVisible();
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});
