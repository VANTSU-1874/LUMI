import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiagnosticFlow } from "@/components/student/DiagnosticFlow";
import {
  CURRENT_QUESTION_SET_VERSION,
  QUESTION_SETS,
} from "@/data/diagnostic/questions";

const QUESTIONS = QUESTION_SETS.v1;

const publicQuestions = QUESTIONS.map(({ id, scenario, options }) => ({
  id,
  scenario,
  options: options.map(({ id: optionId, label }) => ({ id: optionId, label })),
}));

const profile = {
  decomposition: 4,
  signalUnderstanding: 4,
  mappingDesign: 4,
  troubleshooting: 4,
  transfer: 4,
  average: 4,
  level: "L4" as const,
  updatedAt: "2026-07-12T04:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function questionResponse(version: string = CURRENT_QUESTION_SET_VERSION) {
  return jsonResponse({
    questionSetVersion: version,
    questions: publicQuestions,
  });
}

async function answerEveryQuestion(optionIndex = 0) {
  for (let index = 0; index < publicQuestions.length; index += 1) {
    const question = publicQuestions[index];
    fireEvent.click(await screen.findByRole("radio", { name: question.options[optionIndex].label }));
    fireEvent.click(
      screen.getByRole("button", {
        name: index === publicQuestions.length - 1 ? "提交诊断" : "下一题",
      }),
    );
  }
}

describe("DiagnosticFlow", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows one accessible scenario at a time and requires an option before continuing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => questionResponse()));
    render(<DiagnosticFlow />);

    expect(await screen.findByText(publicQuestions[0].scenario)).toBeInTheDocument();
    expect(screen.getByText("1/10")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: publicQuestions[0].scenario }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "下一题" })).toBeDisabled();

    const firstOption = screen.getByRole("radio", {
      name: publicQuestions[0].options[0].label,
    });
    firstOption.focus();
    fireEvent.click(firstOption);
    expect(firstOption).toBeChecked();
    expect(screen.getByRole("button", { name: "下一题" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "下一题" }));

    expect(screen.getByText("2/10")).toBeInTheDocument();
    expect(screen.getByText(publicQuestions[1].scenario)).toHaveFocus();
    expect(
      screen.getByRole("group", { name: publicQuestions[1].scenario }),
    ).toHaveAttribute(
      "aria-labelledby",
      `diagnostic-question-${publicQuestions[1].id}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "上一题" }));
    expect(screen.getByRole("radio", { name: publicQuestions[0].options[0].label })).toBeChecked();
  });

  it("submits only question and option IDs, disables controls while pending, then shows the personal profile", async () => {
    let resolveSubmission!: (response: Response) => void;
    const submission = new Promise<Response>((resolve) => {
      resolveSubmission = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (!init || init.method === "GET") return Promise.resolve(questionResponse());
      return submission;
    });
    vi.stubGlobal("fetch", fetchMock);
    const onComplete = vi.fn();
    render(<DiagnosticFlow onComplete={onComplete} />);

    await answerEveryQuestion(1);

    expect(screen.getByRole("button", { name: "正在提交…" })).toBeDisabled();
    const [, request] = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(request).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      questionSetVersion: CURRENT_QUESTION_SET_VERSION,
      answers: publicQuestions.map((question) => ({
        questionId: question.id,
        optionId: question.options[1].id,
      })),
    });
    expect(String(request?.body)).not.toMatch(/score|dimension/);

    await act(async () => resolveSubmission(jsonResponse({ profile })));

    expect(onComplete).toHaveBeenCalledWith(profile);
    expect(screen.getByRole("heading", { name: "你的学习画像" })).toBeInTheDocument();
    expect(screen.getByText("L4 · 能够独立迁移" )).toBeInTheDocument();
    expect(screen.getByText("任务拆解")).toBeInTheDocument();
    expect(screen.getByText("迁移应用")).toBeInTheDocument();
    expect(screen.queryByText(/排名|同伴/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("score");
  });

  it("shows an inline alert when questions cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: false, error: "题库暂不可用" }, 500)),
    );
    render(<DiagnosticFlow />);

    expect(await screen.findByRole("alert")).toHaveTextContent("题库暂不可用");
    expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument();
  });

  it("reloads the question set after a loading failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: "题库暂不可用" }, 500))
      .mockResolvedValueOnce(questionResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<DiagnosticFlow />);

    fireEvent.click(await screen.findByRole("button", { name: "重新加载" }));

    expect(await screen.findByText(publicQuestions[0].scenario)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows an inline alert and lets the learner retry after submission fails", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        !init || init.method === "GET"
          ? questionResponse()
          : jsonResponse({ ok: false, error: "诊断答案无效" }, 400),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DiagnosticFlow />);

    await answerEveryQuestion();

    expect(await screen.findByRole("alert")).toHaveTextContent("诊断答案无效");
    expect(screen.getByRole("button", { name: "提交诊断" })).toBeEnabled();
    expect(
      screen.getByRole("radio", {
        name: publicQuestions.at(-1)!.options[0].label,
      }),
    ).toBeChecked();
  });

  it("restarts with a fresh question version after a 409 conflict", async () => {
    let getCount = 0;
    let postCount = 0;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init || init.method === "GET") {
        getCount += 1;
        return Promise.resolve(questionResponse(getCount === 1 ? "v1" : "v2"));
      }
      postCount += 1;
      return Promise.resolve(
        postCount === 1
          ? jsonResponse(
              { ok: false, error: "诊断题库已更新，请重新开始" },
              409,
            )
          : jsonResponse({ profile }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DiagnosticFlow />);

    await answerEveryQuestion(0);

    expect(await screen.findByRole("alert")).toHaveTextContent("题库已更新");
    expect(
      screen.getByRole("button", { name: "重新开始诊断" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交诊断" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "重新开始诊断" }));

    await expect.poll(() => getCount).toBe(2);
    expect(await screen.findByText(publicQuestions[0].scenario)).toBeInTheDocument();
    expect(screen.getByText("1/10")).toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }

    await answerEveryQuestion(2);
    expect(await screen.findByRole("heading", { name: "你的学习画像" })).toBeInTheDocument();

    const submissions = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(submissions).toEqual([
      {
        questionSetVersion: "v1",
        answers: publicQuestions.map((question) => ({
          questionId: question.id,
          optionId: question.options[0].id,
        })),
      },
      {
        questionSetVersion: "v2",
        answers: publicQuestions.map((question) => ({
          questionId: question.id,
          optionId: question.options[2].id,
        })),
      },
    ]);
  });

  it.each([
    ["missing dimension", { profile: { ...profile, transfer: undefined } }],
    ["invalid level", { profile: { ...profile, level: "L5" } }],
    ["non-number dimension", { profile: { ...profile, decomposition: "4" } }],
  ])("shows an alert for a malformed 200 response with %s", async (_case, malformed) => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        !init || init.method === "GET"
          ? questionResponse()
          : jsonResponse(malformed),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<DiagnosticFlow />);

    await answerEveryQuestion();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "诊断结果暂不可用，请稍后重试",
    );
    expect(screen.getByRole("button", { name: "提交诊断" })).toBeEnabled();
  });

  it("aborts an in-flight question request on unmount without showing an error", async () => {
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal as AbortSignal | undefined;
        const signal = requestSignal;
        if (!signal) throw new Error("missing request abort signal");
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }),
    );
    const rendered = render(<DiagnosticFlow />);
    await expect.poll(() => requestSignal).toBeInstanceOf(AbortSignal);

    rendered.unmount();

    expect(requestSignal?.aborted).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("aborts an in-flight submission on unmount", async () => {
    let submissionSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init || init.method === "GET") return Promise.resolve(questionResponse());
      submissionSignal = init.signal as AbortSignal | undefined;
      const signal = submissionSignal;
      if (!signal) throw new Error("missing submission abort signal");
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const rendered = render(<DiagnosticFlow />);
    await answerEveryQuestion();
    await expect.poll(() => submissionSignal).toBeInstanceOf(AbortSignal);

    rendered.unmount();

    expect(submissionSignal?.aborted).toBe(true);
  });
});
