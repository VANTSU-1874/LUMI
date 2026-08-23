import { performance } from "node:perf_hooks";

import { expect, test } from "./fixtures";
import { enterLegacyStudent } from "./auth-helpers";

import { validPng } from "../helpers/image-fixtures";

async function loginStudent(page: import("./fixtures").Page, identityCode: string) {
  await enterLegacyStudent(page, identityCode);
}

test("machine-assisted local rehearsal exposes the formal layered Lumi workspace", async ({ page }) => {
  const started = performance.now();
  await loginStudent(page, "LM3T-R7V9-X2QA");

  await expect(page.getByRole("complementary", { name: "历史对话" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Lumi 工具" })).toBeVisible();
  await page.getByRole("button", { name: "打开扩展能力面板" }).click();
  const extensions = page.getByRole("menu", { name: "扩展能力面板" });
  await expect(extensions).toContainText("作品与素材");
  await expect(extensions).toContainText("处理方式");
  await expect(extensions).toContainText("Lumi 专业 Skill");
  await expect(extensions).toContainText("需要账户授权");
  await expect(extensions.getByRole("menuitem", { name: /Figma/ })).toBeDisabled();

  console.log(`RELEASE_REHEARSAL_TIMINGS ${JSON.stringify({
    environment: "Playwright Desktop Chrome; authenticated formal workspace; no model call",
    kind: "machine-assisted local rehearsal",
    totalMs: Math.round(performance.now() - started),
  })}`);
});

test("formal workspace prepares artwork for a layered five-dimension answer", async ({ page }) => {
  test.setTimeout(60_000);
  await loginStudent(page, "NP4U-S8W2-Y3RB");
  await page.getByRole("button", { name: /新对话/ }).click();
  await expect(page.getByRole("heading", { name: "你今天想一起把什么设计清楚？" })).toBeVisible();

  await page.getByRole("button", { name: "打开扩展能力面板" }).click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("menuitem", { name: /添加作品、照片或文件/ }).click(),
  ]);
  await fileChooser.setFiles({ name: "layout.png", mimeType: "image/png", buffer: validPng });
  await expect(page.getByText("layout.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "打开扩展能力面板" }).click();
  await page.getByRole("menuitem", { name: /五维一收/ }).click();
  await expect(page.getByRole("button", { name: "移除五维一收" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "给 Lumi 发送消息" })).toBeEditable();
});
