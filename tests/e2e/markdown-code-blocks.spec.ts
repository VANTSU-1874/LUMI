import type { Locator } from "@playwright/test";

import { expect, test, type Page } from "./fixtures";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const TURN_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const TASK_TITLE = "Markdown 容器回归";
const LONG_CJK = "这是一段用于验证中文软换行的连续说明文字".repeat(14);
const LONG_UNTYPED_CODE = `const value = "${"untyped-code-value-".repeat(20)}";`;
const LONG_INDENTED_CODE = `indented-code-value-${"segment-".repeat(28)}`;
const LONG_NATIVE_CODE = `native-code-value-${"segment-".repeat(28)}`;

const MARKDOWN_RESPONSE = [
  "# Markdown 容器回归",
  "",
  "```   prose",
  "普通文本第一行",
  LONG_CJK,
  "普通文本第三行",
  "```",
  "",
  "## 围栏之后的标题仍在",
  "",
  "- 围栏之后的列表仍在",
  "- 无序容器",
  "  ``` text",
  "  无序容器第一行",
  "  无序容器第二行",
  "  ```",
  "",
  "1. 有序容器",
  "   ```prose",
  "   有序容器第一行",
  "   有序容器第二行",
  "   ```",
  "2. 有序容器之后",
  "",
  "> 引用容器",
  ">",
  "> ```text",
  "> 引用容器第一行",
  "> 引用容器第二行",
  "> ```",
  "",
  "- 外层容器",
  "  1. 内层容器",
  "     ``` text",
  "     嵌套容器第一行",
  "     嵌套容器第二行",
  "     ```",
  "",
  "```",
  "无语言代码第一行",
  LONG_UNTYPED_CODE,
  "```",
  "",
  "### 无语言围栏后的标题",
  "",
  "- 无语言围栏后的列表",
  "",
  "### 缩进代码输入",
  "",
  "    缩进代码第一行",
  `    ${LONG_INDENTED_CODE}`,
  "",
  "### 缩进代码后的标题",
  "",
  "- 缩进代码后的列表",
  "",
  '<pre><code class="language-text">原生 PRE CODE 第一行',
  LONG_NATIVE_CODE,
  "</code></pre>",
  "",
  "### 原生 pre/code 后的标题",
  "",
  "- 原生 pre/code 后的列表",
  "",
  "```powershell",
  `Get-ChildItem -LiteralPath '${"C:/very-long-path/".repeat(12)}'`,
  "```",
  "",
  "```bash",
  `printf '%s\\n' '${"long-shell-value-".repeat(18)}'`,
  "```",
  "",
  "```json",
  JSON.stringify({ kind: "code", value: "long-json-value-".repeat(18) }),
  "```",
  "",
  "### 所有代码块之后的标题",
  "",
  "- 所有代码块之后的列表",
].join("\n");

const mockTask = {
  id: TASK_ID,
  title: TASK_TITLE,
  status: "ACTIVE",
  mode: "conversation",
  pinned: false,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:01:00.000Z",
};

const mockMessages = {
  taskId: TASK_ID,
  pendingRun: null,
  messages: [
    {
      id: "markdown-user",
      taskId: TASK_ID,
      role: "user",
      content: "请展示 Markdown 容器。",
      structure: { version: 1, kind: "user" },
      attachment: null,
      toolCalls: [],
      turnId: TURN_ID,
      runId: RUN_ID,
      createdAt: "2026-08-10T00:00:00.000Z",
    },
    {
      id: "markdown-assistant",
      taskId: TASK_ID,
      role: "assistant",
      content: MARKDOWN_RESPONSE,
      structure: {
        version: 1,
        kind: "assistant",
        reply: {
          eyebrow: "Markdown",
          title: TASK_TITLE,
          message: MARKDOWN_RESPONSE,
          whyThisStep: "验证回答展示层。",
          uncertainty: "无",
          graph: { nodes: [], links: [] },
          basis: [],
          sources: [],
          actions: [],
        },
        episode: "UNDERSTAND",
        decisionCode: "GENERAL_DESIGN_GUIDANCE",
        aiMode: "DETERMINISTIC_FALLBACK",
        executionSteps: [],
      },
      attachment: null,
      toolCalls: [],
      turnId: TURN_ID,
      runId: RUN_ID,
      createdAt: "2026-08-10T00:01:00.000Z",
    },
  ],
};

type LayoutSnapshot = {
  backgroundColor: string;
  clientWidth: number;
  connected: boolean;
  height: number;
  overflowX: string;
  scrollWidth: number;
  whiteSpace: string;
  width: number;
};

async function layoutSnapshot(locator: Locator): Promise<LayoutSnapshot | null> {
  return locator.evaluate((node) => {
    if (!(node instanceof HTMLElement) || !node.isConnected) return null;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      clientWidth: node.clientWidth,
      connected: node.isConnected,
      height: Math.round(rect.height * 10) / 10,
      overflowX: style.overflowX,
      scrollWidth: node.scrollWidth,
      whiteSpace: style.whiteSpace,
      width: Math.round(rect.width * 10) / 10,
    };
  }).catch(() => null);
}

async function expectStableLayout(
  locator: Locator,
  expected: Partial<LayoutSnapshot>,
) {
  await expect(locator).toBeAttached();
  let previous: LayoutSnapshot | null = null;
  await expect.poll(async () => {
    // Re-resolve the Locator every time: Shiki may replace the Suspense body.
    const current = await layoutSnapshot(locator);
    const stable = current !== null
      && previous !== null
      && JSON.stringify(current) === JSON.stringify(previous);
    previous = current;
    return stable ? current : null;
  }, {
    intervals: [50, 100, 250],
    timeout: 15_000,
  }).toMatchObject({ connected: true, ...expected });
}

async function installMarkdownHistory(page: Page) {
  await page.route("**/api/agent/tasks**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }
    const pathname = new URL(request.url()).pathname;
    let payload: unknown;
    if (pathname === "/api/agent/tasks") payload = { tasks: [mockTask] };
    else if (pathname === `/api/agent/tasks/${TASK_ID}`) payload = mockTask;
    else if (pathname === `/api/agent/tasks/${TASK_ID}/messages`) payload = mockMessages;
    else {
      await route.fallback();
      return;
    }
    await route.fulfill({
      body: JSON.stringify(payload),
      contentType: "application/json",
      status: 200,
    });
  });
}

async function loginAndOpenMarkdownThread(
  page: Page,
  routePath: "/student" | "/assistant-lab",
  identityCode: string,
) {
  await installMarkdownHistory(page);
  await page.goto("/");
  const loginStatus = await page.evaluate(async ({ code }) => {
    const response = await fetch("/api/auth/student", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ classCode: "E2E2026", alias: code }),
    });
    return response.status;
  }, { code: identityCode });
  expect(loginStatus).toBe(200);

  const setup = await page.evaluate(async () => {
    const onboardingResponse = await fetch("/api/agent/onboarding", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nickname: null,
        major: null,
        selfAssessedLevel: null,
        interests: null,
        markCompleted: true,
      }),
    });
    const onboarding = await onboardingResponse.json() as { completed?: unknown };
    const sessionResponse = await fetch("/api/account/session", {
      cache: "no-store",
      credentials: "same-origin",
    });
    return {
      onboardingCompleted: onboarding.completed,
      onboardingStatus: onboardingResponse.status,
      sessionStatus: sessionResponse.status,
    };
  });
  expect(setup).toEqual({
    onboardingCompleted: true,
    onboardingStatus: 200,
    sessionStatus: 200,
  });

  // Exercise the real access and onboarding gates. The setup requests also
  // warm their five-second endpoints so dev compilation cannot masquerade as
  // an unavailable session while this test stays focused on Markdown.
  await page.goto(routePath);
  await expect(page).toHaveURL(new RegExp(`${routePath}$`));
  await expect(page.getByLabel("给 Lumi 发送消息")).toBeVisible({ timeout: 30_000 });

  const history = page.getByRole("complementary", { name: "历史对话" });
  const thread = history.getByRole("button", { name: TASK_TITLE, exact: true });
  await expect(thread).toBeVisible();
  await thread.click();
  const answer = page.getByRole("region", { name: "Lumi 最终回答" });
  await expect(answer.getByRole("heading", { name: "围栏之后的标题仍在" })).toBeVisible();
  return answer;
}

const routeCases = [
  { path: "/student" as const, identityCode: "AB7K-C9M2-Q4RP" },
  { path: "/assistant-lab" as const, identityCode: "CD8L-N3R5-TQ9W" },
];

for (const routeCase of routeCases) {
  test(`${routeCase.path} keeps Markdown containers, code semantics and copy access stable`, async ({ page }) => {
    test.setTimeout(90_000);
    const answer = await loginAndOpenMarkdownThread(
      page,
      routeCase.path,
      routeCase.identityCode,
    );

    await expect(answer.getByText("围栏之后的列表仍在", { exact: true })).toBeVisible();
    await expect(answer.getByRole("heading", { name: "无语言围栏后的标题" })).toBeVisible();
    await expect(answer.getByText("无语言围栏后的列表", { exact: true })).toBeVisible();
    await expect(answer.getByRole("heading", { name: "缩进代码后的标题" })).toBeVisible();
    await expect(answer.getByText("缩进代码后的列表", { exact: true })).toBeVisible();
    await expect(answer.getByRole("heading", { name: "原生 pre/code 后的标题" })).toBeVisible();
    await expect(answer.getByText("原生 pre/code 后的列表", { exact: true })).toBeVisible();
    await expect(answer.getByRole("heading", { name: "所有代码块之后的标题" })).toBeVisible();
    await expect(answer.getByText("所有代码块之后的列表", { exact: true })).toBeVisible();
    await expect(answer.locator('blockquote [data-streamdown="code-block"]')).toHaveCount(1);
    await expect(answer.locator('ol [data-streamdown="code-block"]')).toHaveCount(2);
    await expect(answer.locator('[data-streamdown="code-block"]')).toHaveCount(11);

    const textBlocks = answer.locator(
      '[data-streamdown="code-block"]:has([data-streamdown="code-block-body"].lumi-text-fence)',
    );
    await expect(textBlocks).toHaveCount(5);
    const rootTextBlock = textBlocks.first();
    await expect(rootTextBlock).toHaveCSS("background-color", "rgb(244, 244, 245)");
    await expectStableLayout(rootTextBlock, {
      backgroundColor: "rgb(244, 244, 245)",
    });
    const rootTextLines = rootTextBlock.locator(
      '[data-streamdown="code-block-body"].lumi-text-fence pre > code > span',
    );
    await expect(rootTextLines).toHaveCount(3);
    await expect(rootTextLines).toHaveText([
      "普通文本第一行",
      LONG_CJK,
      "普通文本第三行",
    ]);
    await expect.poll(async () => rootTextLines.evaluateAll((lines) => {
      if (lines.some((line) => !(line instanceof HTMLElement) || !line.isConnected)) {
        return false;
      }
      const elements = lines as HTMLElement[];
      const tops = elements.map((line) => line.getBoundingClientRect().top);
      return elements.every((line) => getComputedStyle(line).display === "block")
        && tops.every((top, index) => index === 0 || top > tops[index - 1]!);
    }).catch(() => false), {
      intervals: [50, 100, 250],
      timeout: 15_000,
    }).toBe(true);

    const defaultCodeCases = [
      { visibleText: "无语言代码第一行", copiedText: "无语言代码第一行" },
      { visibleText: "缩进代码第一行", copiedText: "缩进代码第一行" },
      { visibleText: "原生 PRE CODE 第一行", copiedText: "原生 PRE CODE 第一行" },
    ] as const;
    const defaultCodeBlocks: Locator[] = [];
    for (const { visibleText } of defaultCodeCases) {
      const codeBlock = answer.locator('[data-streamdown="code-block"]')
        .filter({ hasText: visibleText });
      defaultCodeBlocks.push(codeBlock);
      await expect(codeBlock).toHaveCount(1);
      await expect(codeBlock.locator(
        '[data-streamdown="code-block-body"].lumi-text-fence',
      )).toHaveCount(0);
      await expect(codeBlock).toHaveCSS("background-color", "rgb(13, 13, 13)");
      await expectStableLayout(codeBlock, {
        backgroundColor: "rgb(13, 13, 13)",
      });
    }

    for (const language of ["powershell", "bash", "json"] as const) {
      const codeBlock = answer.locator(
        `[data-streamdown="code-block"][data-language="${language}"]`,
      );
      await expect(codeBlock).toHaveCount(1);
      await expect(codeBlock).toHaveCSS("background-color", "rgb(13, 13, 13)");
      await expectStableLayout(codeBlock, {
        backgroundColor: "rgb(13, 13, 13)",
      });
    }

    await page.context().grantPermissions(
      ["clipboard-read", "clipboard-write"],
      { origin: new URL(page.url()).origin },
    );
    const pointerCopy = rootTextBlock.getByRole("button", { name: "复制" });
    await expect(pointerCopy).toHaveAccessibleName("复制");
    await expect(pointerCopy).toHaveAttribute("title", "复制");
    await pointerCopy.scrollIntoViewIfNeeded();
    await expect.poll(async () => pointerCopy.evaluate((button) => {
      if (!(button instanceof HTMLElement) || !button.isConnected) return false;
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return hit === button || (hit instanceof Node && button.contains(hit));
    }).catch(() => false), {
      intervals: [50, 100, 250],
      timeout: 15_000,
    }).toBe(true);
    await pointerCopy.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("普通文本第一行");

    for (const [index, { copiedText }] of defaultCodeCases.entries()) {
      const defaultCopy = defaultCodeBlocks[index]!.getByRole("button", { name: "复制" });
      await expect(defaultCopy).toHaveAccessibleName("复制");
      await defaultCopy.scrollIntoViewIfNeeded();
      await defaultCopy.click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toContain(copiedText);
    }

    const keyboardCopy = textBlocks.nth(1).getByRole("button", { name: "复制" });
    await keyboardCopy.focus();
    await expect(keyboardCopy).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(keyboardCopy).toBeFocused();
    await expect(keyboardCopy).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain("无序容器第一行");

    await page.setViewportSize({ width: 320, height: 720 });
    const textBody = rootTextBlock.locator(
      '[data-streamdown="code-block-body"].lumi-text-fence',
    );
    await expect(textBody).toHaveCSS("overflow-x", "hidden");
    await expectStableLayout(textBody, { overflowX: "hidden" });
    await expect.poll(async () => {
      const metrics = await textBody.evaluate((node) => {
        if (!(node instanceof HTMLElement) || !node.isConnected) return null;
        const wrappedLine = [...node.querySelectorAll("pre > code > span")]
          .find((line) => line.textContent?.includes("这是一段用于验证中文软换行"));
        if (!(wrappedLine instanceof HTMLElement)) return null;
        return {
          fits: node.scrollWidth <= node.clientWidth + 1,
          lineHeight: wrappedLine.getBoundingClientRect().height,
          fontSize: Number.parseFloat(getComputedStyle(wrappedLine).fontSize),
        };
      }).catch(() => null);
      return Boolean(metrics?.fits && metrics.lineHeight > metrics.fontSize * 2.5);
    }, { intervals: [50, 100, 250], timeout: 15_000 }).toBe(true);

    const horizontallyScrollableBodies = [
      answer.locator(
        '[data-streamdown="code-block"][data-language="bash"] [data-streamdown="code-block-body"]',
      ),
      ...defaultCodeBlocks.map((block) => block.locator(
        '[data-streamdown="code-block-body"]',
      )),
    ];
    for (const codeBody of horizontallyScrollableBodies) {
      await expect(codeBody).toHaveCSS("overflow-x", "auto");
      await expectStableLayout(codeBody, { overflowX: "auto" });
      await expect.poll(async () => {
        const metrics = await layoutSnapshot(codeBody);
        return Boolean(
          metrics?.connected
          && metrics.scrollWidth > metrics.clientWidth + 20,
        );
      }, { intervals: [50, 100, 250], timeout: 15_000 }).toBe(true);
    }

    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth
    ))).toBe(true);
  });
}
