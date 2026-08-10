import { expect, test } from "./fixtures";

import { setFreshTrustedSourceHeaders } from "./trusted-source";

test.describe("teacher analytics flow", () => {
  test("an unauthenticated teacher workspace receives a 401 dashboard response", async ({ page }) => {
    const dashboard = page.waitForResponse((response) => response.url().endsWith("/api/teacher/dashboard"));
    await page.goto("/teacher");
    expect((await dashboard).status()).toBe(401);
    await expect(page.getByText("请先以教师身份进入", { exact: true })).toBeVisible();
    expect((await page.request.get("/api/teacher/dashboard")).status()).toBe(401);
  });

  test("teacher reviews an anonymous learner without replacing the original result", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "教师" }).click();
    await page.getByLabel("教师访问码").fill("e2e-teacher-code");
    await page.getByRole("button", { name: "教师进入" }).click();
    await expect(page).toHaveURL(/\/teacher$/);
    await expect(page.getByRole("heading", { name: "教师学习分析工作台" })).toBeVisible();
    await expect(page.getByText("需要支持 1 人")).toBeVisible();
    await page.getByRole("button", { name: "查看匿名-教师01" }).click();
    await expect(page.getByText("原系统结果：NEEDS_REVISION")).toBeVisible();
    await page.getByRole("button", { name: /暂待复核/ }).click();
    await page.getByLabel("教师备注").fill("课后当面复核映射关系");
    await setFreshTrustedSourceHeaders(page, "e2e-teacher-decision");
    const decisionResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/teacher/decisions") && response.request().method() === "POST");
    await page.getByRole("button", { name: "保存教师决定" }).click();
    const savedDecision = await decisionResponse;
    const savedDecisionBody = await savedDecision.json();
    expect(savedDecision.status(), JSON.stringify(savedDecisionBody)).toBe(201);
    await expect(page.getByText("教师决定：NEEDS_REVIEW")).toBeVisible();
    await expect(page.getByText("原系统结果：NEEDS_REVISION")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "查看匿名-教师01" }).click();
    await expect(page.getByText("课后当面复核映射关系").first()).toBeVisible();

    await page.getByLabel("复核对象").selectOption("EVIDENCE:33333333-3333-4333-8333-333333333333");
    await expect(page.getByRole("heading", { name: "证据内容" })).toBeVisible();
    await expect(page.getByText("输入值有变化", { exact: true })).toBeVisible();
    await setFreshTrustedSourceHeaders(page, "e2e-teacher-decision");
    await page.getByRole("button", { name: "保存教师决定" }).click();
    await expect(page.getByText("原系统结果：TEACHER_VERIFIED")).toBeVisible();

    await expect(page.getByLabel("证据总数")).toHaveText("1");
    const history = page.getByRole("heading", { name: "全部历史证据" }).locator("..").locator("..");
    await history.getByRole("button", { name: /删除证据.*教师同步证据/ }).click();
    await setFreshTrustedSourceHeaders(page, "e2e-teacher-evidence");
    const deletion = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().includes("33333333-3333-4333-8333-333333333333"));
    await page.getByRole("button", { name: /确认删除.*教师同步证据/ }).click();
    expect((await deletion).status()).toBe(204);
    await expect(page.getByLabel("证据总数")).toHaveText("0");
    const deletionStatus = page.getByRole("status", { name: "删除状态" }).last();
    await expect(deletionStatus).toHaveText("证据已删除");
    await expect(deletionStatus).toBeFocused();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
    const evidenceMetrics = page.getByRole("heading", { name: "证据来源与验证" }).locator("..");
    await expect(evidenceMetrics.getByText("暂无证据")).toBeVisible();

    const [studentDashboardStatus, crossClassStatus] = await page.evaluate(async () =>
      Promise.all([
        fetch("/api/student/dashboard").then((response) => response.status),
        fetch("/api/teacher/learners/e2e-student-1?classId=e2e-teacher-class")
          .then((response) => response.status),
      ]));
    expect(studentDashboardStatus).toBe(403);
    expect(crossClassStatus).toBe(404);
  });

  test("teacher evidence workspace has no page-level horizontal overflow at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.getByRole("tab", { name: "教师" }).click();
    await page.getByLabel("教师访问码").fill("e2e-teacher-code");
    await page.getByRole("button", { name: "教师进入" }).click();
    await page.getByRole("button", { name: "查看匿名-教师01" }).click();
    await expect(page.getByRole("heading", { name: "匿名-教师01" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test("teacher audits an agent policy, real tool trace and correction in the browser", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "教师" }).click();
    await page.getByLabel("教师访问码").fill("e2e-teacher-code");
    await page.getByRole("button", { name: "教师进入" }).click();
    await page.getByRole("button", { name: "查看匿名-教师01" }).click();
    await expect(page.getByRole("heading", { name: "智能体决策与工具审查" })).toBeVisible();
    await expect(page.getByText("competition-core@1").first()).toBeVisible();
    await expect(page.getByText("project-evidence.read-state@1")).toBeVisible();
    await expect(page.getByText("可审查执行轨迹")).toBeVisible();
    await expect(page.getByText("不包含模型内部思维")).toBeVisible();
    await page.getByLabel("智能体教师判断").selectOption("CORRECTED");
    await page.getByLabel("智能体复核说明").fill("应先检查输出节点是否激活。");
    const reviewResponse = page.waitForResponse((response) => response.url().endsWith("/api/teacher/agent-reviews") && response.request().method() === "POST");
    await page.getByRole("button", { name: "记录教师复核" }).click();
    expect((await reviewResponse).status()).toBe(201);
    await expect(page.getByText("教师：纠正")).toBeVisible();
    await expect(page.getByRole("button", { name: "更新教师复核" })).toBeVisible();
  });

  test("a student cannot access teacher analytics", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("班级邀请码").fill("E2E2026");
    await page.getByLabel("匿名编号").fill("AB7K-C9M2-Q4RP");
    await page.getByRole("button", { name: "学生进入" }).click();
    await expect(page).toHaveURL(/\/student$/);
    const responseStatus = await page.evaluate(async () =>
      (await fetch("/api/teacher/dashboard?classId=e2e-teacher-class")).status);
    expect(responseStatus).toBe(403);
  });
});
