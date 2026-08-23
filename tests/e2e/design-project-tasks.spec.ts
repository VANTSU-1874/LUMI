import { expect, test } from "./fixtures";
import { enterLegacyStudent } from "./auth-helpers";

async function loginStudent(page: import("./fixtures").Page) {
  await enterLegacyStudent(page, "EF9M-P4S6-VR2X", { waitForWorkspace: false });
  await expect(page.getByRole("complementary", { name: "历史对话" })).toBeVisible({ timeout: 30_000 });
}

test("current design conversations can be created, listed and restored", async ({ page }) => {
  test.setTimeout(90_000);
  await loginStudent(page);
  const history = page.getByRole("complementary", { name: "历史对话" });
  const createTask = async (title: string) => {
    return page.evaluate(async (nextTitle) => {
      const createdResponse = await fetch("/api/agent/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "conversation" }),
      });
      if (createdResponse.status !== 201) {
        throw new Error(`Task creation failed: ${createdResponse.status}`);
      }
      const created = await createdResponse.json() as { id: string };
      const renamedResponse = await fetch(`/api/agent/tasks/${created.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });
      if (renamedResponse.status !== 200) {
        throw new Error(`Task rename failed: ${renamedResponse.status}`);
      }
      return created.id;
    }, title);
  };

  await createTask("第一段设计对话");
  await createTask("第二段设计对话");
  const persisted = await page.evaluate(async () => {
    const response = await fetch("/api/agent/tasks");
    if (!response.ok) throw new Error(`Task list failed: ${response.status}`);
    return response.json() as Promise<{
      tasks: Array<{ title: string }>;
    }>;
  }) as {
    tasks: Array<{ title: string }>;
  };
  expect(persisted.tasks.map((task) => task.title)).toEqual(
    expect.arrayContaining(["第一段设计对话", "第二段设计对话"]),
  );

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });

  const first = history.getByRole("button", { name: "第一段设计对话", exact: true });
  const second = history.getByRole("button", { name: "第二段设计对话", exact: true });
  await expect(first).toBeVisible({ timeout: 30_000 });
  await expect(second).toBeVisible();
});
