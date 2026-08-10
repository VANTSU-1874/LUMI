import { expect, test, type Page } from "./fixtures";

const E2E_PASSWORD = "E2e-local-only-password-2026";
const fakeModelPort = Number(process.env.PLAYWRIGHT_FAKE_MODEL_PORT);
const fakeEvidenceUrl = `http://127.0.0.1:${fakeModelPort}/__evidence`;

type PublicRun = {
  id: string;
  taskId: string;
  status: "QUEUED" | "RUNNING" | "WAITING_APPROVAL" | "COMPLETED" | "FAILED" | "CANCELLED";
  result: null | {
    aiMode: "MODEL_ASSISTED" | "DETERMINISTIC_FALLBACK";
    routingReceipt?: {
      schema: "specialty-route-receipt/v1";
      coursePackId: "general-design" | "digital-interaction" | "book-design";
      coursePackVersion: "1";
      reason: "GENERAL_DEFAULT" | "MESSAGE_MATCH" | "INTERFACE_CONTEXT" | "STUDENT_DECLARED";
    };
  };
};

type FakeProviderEvidence = {
  provider: "G0B_FAKE_ONLY";
  listenHost: "127.0.0.1";
  externalRequests: 0;
  requests: Array<{
    kind: "TUTOR" | "TITLE";
    scenario: "ROUTING" | "H7" | "H8" | "OTHER";
    stream: boolean;
    attempt: number | null;
    path: "/v1/chat/completions" | "/v1/responses";
    remoteAddress: "loopback";
    externalToolOffered: boolean;
    aborted: boolean;
  }>;
};

async function registerBookDesignStudent(page: Page) {
  for (const path of ["/api/account/session", "/api/agent/onboarding"]) {
    await page.goto(path);
  }
  await page.goto("/login?mode=register&returnTo=%2Fstudent");
  await expect(page.getByRole("heading", { name: "创建 Lumi 账号" })).toBeVisible();
  await page.getByLabel("姓名或常用称呼").fill("H4-H8 隔离学生");
  await page.getByLabel("邮箱").fill(`student-g0b-h4-h8-${Date.now()}@e2e.invalid`);
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

  const retrySession = page
    .getByRole("region", { name: "暂时无法确认登录状态" })
    .getByRole("button", { name: "重新检查" });
  const firstSkip = page.getByRole("button", { name: "这步先跳过" });
  await expect(firstSkip.or(retrySession)).toBeVisible({ timeout: 30_000 });
  if (await retrySession.isVisible()) await retrySession.click();
  await expect(firstSkip).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "这步先跳过" }).click();
  await page.getByRole("radio", { name: /书籍设计/ }).click();
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByRole("button", { name: "这步先跳过" }).click();
  await page.getByRole("button", { name: "跳过并进入 Lumi" }).click();
  await expect(page.getByLabel("给 Lumi 发送消息")).toBeVisible({ timeout: 30_000 });
}

async function createTurn(page: Page, message: string) {
  const composer = page.getByLabel("给 Lumi 发送消息");
  const send = page.getByRole("button", { name: "发送消息" });
  await expect(composer).toBeEnabled({ timeout: 30_000 });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await composer.fill(message);
    await page.waitForTimeout(200);
    if (await composer.inputValue() === message && await send.isEnabled()) break;
  }
  await expect(composer).toHaveValue(message);
  await expect(send).toBeEnabled();
  const runResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/agent/runs"
    && response.request().method() === "POST", { timeout: 30_000 });
  await send.click();
  const response = await runResponsePromise;
  expect(response.status()).toBe(202);
  return (await response.json() as { run: PublicRun }).run;
}

async function readRun(page: Page, runId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/agent/runs/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`run read failed: ${response.status}`);
    return (await response.json() as { run: PublicRun }).run;
  }, runId);
}

async function waitForRunStatus(page: Page, runId: string, status: PublicRun["status"]) {
  await expect.poll(async () => (await readRun(page, runId)).status, {
    timeout: 45_000,
  }).toBe(status);
  return readRun(page, runId);
}

async function expectLatestReceipt(
  page: Page,
  coursePackId: "general-design" | "digital-interaction" | "book-design",
  reason: NonNullable<NonNullable<PublicRun["result"]>["routingReceipt"]>["reason"],
) {
  const receipt = page.locator('output[aria-label="Lumi 路由回执"]').last();
  await expect(receipt).toBeVisible({ timeout: 45_000 });
  await expect(receipt).toContainText(`${coursePackId}@1`);
  await expect(receipt).toContainText(reason);
}

async function providerEvidence(request: { get(url: string): Promise<{ ok(): boolean; json(): Promise<unknown> }> }) {
  const response = await request.get(fakeEvidenceUrl);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<FakeProviderEvidence>;
}

test("G0-B H4/H5 receipts, H7 fake stream, and H8 OFF reopen stay local and fail closed", async ({ page, request }) => {
  test.setTimeout(360_000);
  expect(process.env.PLAYWRIGHT_HARNESS_MODE).toBe("OFF");
  expect(process.env.PLAYWRIGHT_G0B_RECEIPT).toBe("1");
  expect(Number.isInteger(fakeModelPort)).toBe(true);
  await registerBookDesignStudent(page);

  const coldStart = await createTurn(page, "我想先聊聊这个设计想法");
  const coldStartTerminal = await waitForRunStatus(page, coldStart.id, "COMPLETED");
  expect(coldStartTerminal.result?.routingReceipt).toEqual({
    schema: "specialty-route-receipt/v1",
    coursePackId: "book-design",
    coursePackVersion: "1",
    reason: "STUDENT_DECLARED",
  });
  await expectLatestReceipt(page, "book-design", "STUDENT_DECLARED");

  const keyword = await createTurn(page, "TouchDesigner 的声音数值有了但画面不动");
  const keywordTerminal = await waitForRunStatus(page, keyword.id, "COMPLETED");
  expect(keywordTerminal.result?.routingReceipt).toMatchObject({
    coursePackId: "digital-interaction",
    reason: "MESSAGE_MATCH",
  });
  await expectLatestReceipt(page, "digital-interaction", "MESSAGE_MATCH");

  const previousTurn = await createTurn(page, "那接下来怎么判断？");
  const previousTurnTerminal = await waitForRunStatus(page, previousTurn.id, "COMPLETED");
  expect(previousTurnTerminal.result?.routingReceipt).toMatchObject({
    coursePackId: "digital-interaction",
    reason: "INTERFACE_CONTEXT",
  });
  await expectLatestReceipt(page, "digital-interaction", "INTERFACE_CONTEXT");

  await page.getByRole("button", { name: "新对话", exact: true }).first().click();
  await page.getByRole("button", { name: "打开扩展能力面板" }).click();
  await page.getByRole("menuitem", { name: /书籍设计 Skill/ }).click();
  const view = await createTurn(page, "请从当前工作区判断");
  const viewTerminal = await waitForRunStatus(page, view.id, "COMPLETED");
  expect(viewTerminal.result?.routingReceipt).toMatchObject({
    coursePackId: "book-design",
    reason: "INTERFACE_CONTEXT",
  });
  await expectLatestReceipt(page, "book-design", "INTERFACE_CONTEXT");

  await page.getByRole("button", { name: "新对话", exact: true }).first().click();
  const cancelled = await createTurn(page, "H7 停止重试恢复演练");
  await expect.poll(async () => {
    const evidence = await providerEvidence(request);
    return evidence.requests.filter(({ kind, scenario }) => kind === "TUTOR" && scenario === "H7").length;
  }).toBe(1);
  await expect(page.getByRole("button", { name: "停止生成" })).toBeVisible();
  const cancelResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/agent/runs/${cancelled.id}/cancel`
    && response.request().method() === "POST");
  await page.getByRole("button", { name: "停止生成" }).click();
  const cancelResponse = await cancelResponsePromise;
  expect(cancelResponse.status()).toBe(200);
  expect(await cancelResponse.json()).toMatchObject({
    run: { id: cancelled.id, status: "RUNNING" },
    abortRequested: true,
  });
  await waitForRunStatus(page, cancelled.id, "CANCELLED");

  await page.reload();
  const retryButton = page.getByRole("button", { name: "继续生成" }).last();
  const cancelledThreadButton = page
    .getByRole("button", { name: "未命名设计任务", exact: true })
    .last();
  await expect.poll(async () =>
    await retryButton.isVisible() || await cancelledThreadButton.isVisible(), {
    timeout: 30_000,
  }).toBe(true);
  if (await cancelledThreadButton.isVisible()) await cancelledThreadButton.click();
  await expect(retryButton).toBeVisible({ timeout: 30_000 });
  const retryResponsePromise = page.waitForResponse((response) =>
    [
      `/api/agent/runs/${cancelled.id}/retry`,
      `/api/agent/runs/${cancelled.id}/continue`,
    ].includes(new URL(response.url()).pathname)
    && response.request().method() === "POST", { timeout: 30_000 });
  await retryButton.click();
  const retryResponse = await retryResponsePromise;
  expect(retryResponse.status()).toBe(202);
  const continuationEndpoint = new URL(retryResponse.url()).pathname.endsWith("/continue")
    ? "continue"
    : "retry";
  const retried = (await retryResponse.json() as { run: PublicRun }).run;

  await expect(page.getByText("这是本地 fake-only 流式回答的第一段。", { exact: false }))
    .toBeVisible({ timeout: 30_000 });
  await page.reload();
  const reopenedH7UntitledThread = page
    .getByRole("button", { name: "未命名设计任务", exact: true })
    .last();
  const reopenedH7TitledThread = page
    .getByRole("button", { name: "本地回执演练", exact: true })
    .first();
  await expect.poll(async () =>
    await reopenedH7UntitledThread.isVisible() || await reopenedH7TitledThread.isVisible(), {
    timeout: 30_000,
  }).toBe(true);
  if (await reopenedH7UntitledThread.isVisible()) await reopenedH7UntitledThread.click();
  else await reopenedH7TitledThread.click();
  await expect(page.getByText("最终回答由本地假模型完成，没有外部服务。", { exact: false }))
    .toBeVisible({ timeout: 45_000 });
  const retriedTerminal = await waitForRunStatus(page, retried.id, "COMPLETED");
  expect(retriedTerminal.result?.aiMode).toBe("MODEL_ASSISTED");
  await expectLatestReceipt(page, "book-design", "STUDENT_DECLARED");

  await page.getByRole("button", { name: "新对话", exact: true }).first().click();
  const offRun = await createTurn(page, "H8 OFF 重开观察");
  const offTerminal = await waitForRunStatus(page, offRun.id, "COMPLETED");
  expect(offTerminal.result).toMatchObject({
    aiMode: "MODEL_ASSISTED",
    routingReceipt: {
      schema: "specialty-route-receipt/v1",
      coursePackId: "book-design",
      reason: "STUDENT_DECLARED",
    },
  });
  await expectLatestReceipt(page, "book-design", "STUDENT_DECLARED");
  await page.reload();
  const reopenedH8Thread = page
    .getByRole("button", { name: "本地回执演练", exact: true })
    .first();
  await expect(reopenedH8Thread).toBeVisible({ timeout: 30_000 });
  await reopenedH8Thread.click();
  await expect(page.getByText("路由回执来自运行结果，不从正文猜测。", { exact: false }))
    .toBeVisible({ timeout: 30_000 });
  await expectLatestReceipt(page, "book-design", "STUDENT_DECLARED");

  await expect.poll(async () => {
    const evidence = await providerEvidence(request);
    const h7 = evidence.requests.filter(({ kind, scenario }) => kind === "TUTOR" && scenario === "H7");
    return h7.length === 2 && h7[0]?.attempt === 1 && h7[1]?.attempt === 2
      && h7[1]?.aborted === false;
  }, { timeout: 30_000 }).toBe(true);
  const evidence = await providerEvidence(request);
  expect(evidence).toMatchObject({
    provider: "G0B_FAKE_ONLY",
    listenHost: "127.0.0.1",
    externalRequests: 0,
  });
  expect(evidence.requests.every(({ path, remoteAddress }) =>
    path === "/v1/chat/completions" && remoteAddress === "loopback")).toBe(true);
  expect(evidence.requests.some(({ externalToolOffered }) => externalToolOffered)).toBe(false);

  console.log(`G0B_H4_H8_EVIDENCE ${JSON.stringify({
    harnessMode: "OFF",
    h4: coldStartTerminal.result?.routingReceipt,
    h5: {
      keyword: keywordTerminal.result?.routingReceipt,
      previousTurn: previousTurnTerminal.result?.routingReceipt,
      view: viewTerminal.result?.routingReceipt,
    },
    h6: "AUTHORIZATION_ONLY_NO_EXTERNAL_ACTION",
    h7: {
      cancelledRun: cancelled.id,
      retriedRun: retried.id,
      continuationEndpoint,
      reopenedDuringStream: true,
    },
    h8: { runId: offRun.id, reopened: true, routingReceipt: offTerminal.result?.routingReceipt },
    fakeProvider: {
      externalRequests: evidence.externalRequests,
      tutorRequests: evidence.requests.filter(({ kind }) => kind === "TUTOR").length,
      titleRequests: evidence.requests.filter(({ kind }) => kind === "TITLE").length,
    },
  })}`);
});
