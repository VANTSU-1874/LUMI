import { expect, test } from "./fixtures";

test("generated tool-path details remain available through the authenticated contract after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("班级邀请码").fill("E2E2026");
  await page.getByLabel("匿名编号").fill("LM3T-R7V9-X2QA");
  await page.getByRole("button", { name: "学生进入" }).click();
  await expect(page).toHaveURL(/\/student$/);

  const readDashboard = () => page.evaluate(async () => {
    const response = await fetch("/api/student/dashboard");
    return { status: response.status, body: await response.json() };
  });

  const before = await readDashboard();
  expect(before.status).toBe(200);
  expect(before.body.toolPath).toMatchObject({
    path: "DIGISHOW",
    requirements: {
      needsRealtimeVisuals: false,
      needsPhysicalControl: true,
      hasOsc: false,
    },
    reasons: ["单独使用DigiShow完成交互"],
  });
  expect(before.body.toolPath.milestones).toHaveLength(3);

  await page.reload();
  await expect(page.getByRole("region", { name: "与 Lumi 对话" })).toBeVisible();
  const after = await readDashboard();
  expect(after.status).toBe(200);
  expect(after.body.toolPath).toEqual(before.body.toolPath);
  expect(after.body.dataType).toBe("REAL");
});
