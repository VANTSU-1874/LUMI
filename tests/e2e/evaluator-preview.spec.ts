import { expect, test } from "@playwright/test";

const outcome = {
  code: "STAGE_CONCLUSION",
  label: "阶段性结论",
  description: "已明确本轮应先判断的关键对象与边界，可据此继续讨论。",
};

const scenarios = [
  ["S1_DIGITAL_PRODUCT", "TouchDesigner 交互操作"],
  ["S2_COURSE_DESIGN", "品牌设计规范"],
  ["S3_DESIGN_KNOWLEDGE", "封面版式设计分析"],
  ["S4_PORTFOLIO_DIRECTION", "个人作品 / 作品集方向"],
  ["S5_LEARNING_EVIDENCE", "海报风格融合设计"],
].map(([id, title]) => ({
  id,
  title,
  capability: "受控评估流程",
  description: "帮助评委看到一个可达的中间结果。",
  sourceLabel: "评委预览",
  initial: {
    id: `${id}_START`,
    label: "从预设问题开始",
    prompt: `${title}的预设首问`,
    outcome,
    attachments: [],
  },
  suggestions: ["A", "B", "C", "D"].map((suffix, index) => ({
    id: `${id}_${suffix}`,
    label: `后续建议${index + 1}`,
    prompt: `${title}的后续建议${index + 1}`,
    outcome,
    attachments: [],
  })),
}));

const completedResponse = {
  title: "先确认参与对象",
  message: "先确认主要使用者，再检查入口是否可见。",
  whyThisStep: "对象决定后续测试的观察重点。",
  uncertainty: "尚未看到现场试用记录。",
  sources: [],
  branch: {
    directionId: "S1_DIGITAL_PRODUCT",
    directionTitle: "TouchDesigner 交互操作",
    suggestionId: "S1_DIGITAL_PRODUCT_START",
    suggestionLabel: "从预设问题开始",
    outcome,
  },
};

test("preview keeps the evaluator inside the five-theme controlled flow", async ({ page }) => {
  await page.route("**/api/preview/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { expiresAt: "2026-08-23T00:00:00.000Z", scenarios },
      status: 200,
    });
  });
  await page.route("**/api/preview/runs", async (route) => {
    await route.fulfill({
      body: `event: complete\ndata: ${JSON.stringify({ runId: "e2e-run", response: completedResponse })}\n\n`,
      contentType: "text/event-stream",
      status: 200,
    });
  });

  await page.goto("/preview");

  await expect(page.getByRole("button", { name: "TouchDesigner 交互操作" })).toBeVisible();
  await expect(page.getByRole("button", { name: "品牌设计规范" })).toBeVisible();
  await expect(page.getByRole("button", { name: "封面版式设计分析" })).toBeVisible();
  await expect(page.getByRole("button", { name: "个人作品 / 作品集方向" })).toBeVisible();
  await expect(page.getByRole("button", { name: "海报风格融合设计" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "给 Lumi 发送消息" })).toHaveCount(0);
  await expect(page.getByText("记录仅作演示数据并在 24 小时后清理。")).toBeVisible();

  await page.getByRole("button", { name: "从预设问题开始" }).click();

  await expect(page.getByLabel("Lumi 最终回答")).toContainText("先确认主要使用者");
  await expect(page.getByLabel("建议的后续操作").getByRole("button")).toHaveCount(4);
  await expect(page.getByRole("textbox", { name: "给 Lumi 发送消息" })).toBeVisible();
});

for (const width of [320, 376, 768, 1440]) {
  test(`preview has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 500 ? 720 : 900 });
    await page.route("**/api/preview/session", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        json: { expiresAt: "2026-08-23T00:00:00.000Z", scenarios },
        status: 200,
      });
    });
    await page.goto("/preview");
    await expect(page.getByText("从一个预设问题开始。")).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  });
}

test("preview session API creates a private 24-hour demonstration session", async ({ request }) => {
  const response = await request.post("/api/preview/session");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-lumi-data-type"]).toBe("DEMONSTRATION_DATA");
  expect(response.headers()["set-cookie"]).toContain("Max-Age=86400");
  const payload = await response.json();
  expect(payload.scenarios).toHaveLength(5);
});
