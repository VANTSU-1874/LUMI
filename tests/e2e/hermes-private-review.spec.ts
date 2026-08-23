import { expect, test } from "./fixtures";
import { strictReviewPackFixture } from "../fixtures/inspiration-review-pack";
import { signInCurrentTeacher } from "./auth-helpers";

test.describe("D-18 Hermes candidate governance readiness", () => {
  test("teacher sees readiness without a false per-item review task", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signInCurrentTeacher(page);
    await expect(page.getByRole("heading", { name: "教师学习分析工作台" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "最近学生动态" })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "docs/reports/assets/teacher-dashboard-desktop.png" });
    const readinessResponse = page.waitForResponse((response) =>
      response.request().method() === "GET" && response.url().endsWith("/api/teacher/inspiration-wiki/review-packs"));
    const queueResponse = page.waitForResponse((response) =>
      response.request().method() === "GET" && response.url().includes("/api/teacher/inspiration-wiki/candidates?"));
    await page.getByRole("link", { name: "灵感 Wiki", exact: true }).click();
    await expect(page).toHaveURL(/\/teacher\/inspiration-wiki$/, { timeout: 30_000 });
    expect((await readinessResponse).status()).toBe(200);
    const loadedQueue = await queueResponse;
    expect(loadedQueue.status(), JSON.stringify(await loadedQueue.json())).toBe(200);

    await expect(page.getByText("0/1")).toBeVisible();
    await expect(page.getByText("只读元数据索引，不是教师审核任务")).toBeVisible();
    await page.screenshot({ path: "docs/reports/assets/teacher-inspiration-wiki-desktop.png" });
    const queue = page.getByRole("region", { name: "Hermes 候选治理准备区" });
    await expect(queue.getByText("当前无需教师逐条操作")).toBeVisible();
    await expect(queue.getByText("教师可审")).toBeVisible();
    await expect(queue.getByText(/0 \/ 1 条具备完整图文/)).toBeVisible();
    await queue.getByText("查看只读原始候选索引（1 条）").click();
    await expect(queue.getByRole("heading", { name: "印刷与海报与字体与排版候选" })).toBeVisible();
    await expect(queue.getByText("仅记录到远程媒体；当前不构成可审核图像证据")).toBeVisible();
    await expect(queue.getByLabel("审核备注")).toHaveCount(0);
    await expect(queue.getByRole("button", { name: "待规范化" })).toHaveCount(0);
    await expect(queue.getByRole("button", { name: "权利暂缓" })).toHaveCount(0);
    await expect(queue.getByRole("button", { name: "拒绝候选" })).toHaveCount(0);
    await expect(queue.getByText("通过并正式发布给学生")).toHaveCount(0);
    await expect(queue.getByText("通过并留在内部目录")).toHaveCount(0);
    await expect(queue.locator("img")).toHaveCount(0);
  });

  test("governance readiness has no horizontal overflow across the required widths", async ({ page }) => {
    await signInCurrentTeacher(page);
    const readinessResponse = page.waitForResponse((response) =>
      response.request().method() === "GET" && response.url().endsWith("/api/teacher/inspiration-wiki/review-packs"));
    const queueResponse = page.waitForResponse((response) =>
      response.request().method() === "GET" && response.url().includes("/api/teacher/inspiration-wiki/candidates?"));
    await page.getByRole("link", { name: "灵感 Wiki", exact: true }).click();
    expect((await readinessResponse).status()).toBe(200);
    const loadedQueue = await queueResponse;
    expect(loadedQueue.status(), JSON.stringify(await loadedQueue.json())).toBe(200);
    await page.getByText("查看只读原始候选索引（1 条）").click();
    await expect(page.getByRole("heading", { name: "印刷与海报与字体与排版候选" })).toBeVisible();

    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px overflow`).toBe(true);
    }
  });

  test("strict fixture exercises the full private ReviewPack workspace without entering the real queue", async ({ page }) => {
    await signInCurrentTeacher(page);
    await page.route("**/api/teacher/inspiration-wiki/review-packs/**", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...strictReviewPackFixture,
            editContext: {
              currentStage: "READY_FOR_TEACHER_REVIEW",
              currentReviewRevision: strictReviewPackFixture.revision,
              latestDecision: null,
            },
          }),
        });
        return;
      }
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ stage: "PRIVATE_WIKIDRAFT", capabilityBoundary: strictReviewPackFixture.capabilityBoundary }) });
    });

    await page.goto(`/teacher/inspiration-wiki/review/${encodeURIComponent(strictReviewPackFixture.reviewPackId)}`);
    await expect(page.getByRole("heading", { name: strictReviewPackFixture.work.title })).toBeVisible();
    await expect(page.getByRole("tab", { name: "作品与来源" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "策展与教学" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "权利与安全" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "重复关系" })).toBeVisible();
    await expect(page.getByRole("button", { name: "进入私有草稿", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "退回 Codex 补证" })).toBeVisible();
    await expect(page.getByRole("button", { name: "拒绝候选" })).toBeVisible();
    await expect(page.getByRole("button", { name: /正式发布|学生可见|Current Page|R2|Embedding|Lumi 引用/ })).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "docs/reports/assets/teacher-review-pack-fixture-desktop.png" });

    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}px ReviewPack overflow`).toBe(true);
    }
  });
});
