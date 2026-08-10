import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TransferChallenge } from "@/components/student/TransferChallenge";
import { TransferPublicStateSchema } from "@/lib/domain/transfer";

afterEach(cleanup);

const challenge = TransferPublicStateSchema.parse({
  challenge: {
    projectId: "project-1", challengeRevision: 1, changedDimension: "input",
    prompt: "保留文化意图和输出，只改变输入。",
    mustRetain: {
      culturalIntent: "安岳石刻共同记忆", structure: "参与行为通过输入映射到输出",
      input: "距离输入", mapping: "距离映射亮度", output: "石刻纹样投影",
    },
    change: { candidateId: "sound-db", dimension: "input", from: "距离输入", to: "声音强度输入" },
    unitPolicy: {
      sourceKind: "SOUND", sourceUnit: "dB", sourceRanges: [{ unit: "dB", minInclusive: 20, maxInclusive: 130 }],
      targetMin: 0, targetMax: 1, targetUnit: "normalized", allowedRelationships: ["LINEAR", "DIRECT"],
    },
    culturalPolicy: {
      intentAnchor: { id: "intent_1111111111111111", label: "安岳石刻共同记忆" },
      allowedAudienceTypes: ["GENERAL_VISITORS", "COMMUNITY_MEMBERS"],
      allowedTransitions: [{ before: "PASSIVE_VIEWING", after: "ACTIVE_EXPLORATION" }],
      allowedMechanisms: ["PARTICIPATORY_TRIGGER", "COLLECTIVE_RESPONSE"],
    },
    path: "COLLABORATIVE",
  },
  status: "OPEN", attemptsUsed: 0, attemptsRemaining: 2, locked: false, latestRubric: null,
});

const failed = TransferPublicStateSchema.parse({
  ...challenge, attemptsUsed: 1, attemptsRemaining: 1,
  latestRubric: {
    criteria: {
      retainedStructure: { passed: false, reasonCode: "RETAINED_MISMATCH" },
      changedParts: { passed: true, reasonCode: "CHANGE_TARGETED" },
      normalization: { passed: false, reasonCode: "NORMALIZATION_INVALID_RANGE" },
      culturalImpact: { passed: true, reasonCode: "CULTURAL_CONCRETE" },
    },
    score: 2, passed: false, outcome: "RETRY",
    feedback: { retained: true, changed: false, normalization: true, cultural: false, teacherReview: false, aiCode: null },
  },
});

function fillAnswer() {
  fireEvent.change(screen.getByLabelText("保留：文化意图"), { target: { value: "安岳石刻共同记忆" } });
  fireEvent.change(screen.getByLabelText("保留：输入"), { target: { value: "距离输入" } });
  fireEvent.change(screen.getByLabelText("保留：映射"), { target: { value: "距离映射亮度" } });
  fireEvent.change(screen.getByLabelText("保留：输出"), { target: { value: "石刻纹样投影" } });
  fireEvent.change(screen.getByLabelText("改变维度"), { target: { value: "input" } });
  fireEvent.change(screen.getByLabelText("改变前"), { target: { value: "距离输入" } });
  fireEvent.change(screen.getByLabelText("改变后"), { target: { value: "声音强度输入" } });
  fireEvent.change(screen.getByLabelText("源最小值"), { target: { value: "40" } });
  fireEvent.change(screen.getByLabelText("源最大值"), { target: { value: "90" } });
  fireEvent.change(screen.getByLabelText("源单位"), { target: { value: "dB" } });
  fireEvent.change(screen.getByLabelText("目标最小值"), { target: { value: "0" } });
  fireEvent.change(screen.getByLabelText("目标最大值"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("目标单位"), { target: { value: "normalized" } });
  fireEvent.change(screen.getByLabelText("关系"), { target: { value: "LINEAR" } });
  fireEvent.change(screen.getByLabelText("受众类型"), { target: { value: "GENERAL_VISITORS" } });
  fireEvent.change(screen.getByLabelText("行为改变前"), { target: { value: "PASSIVE_VIEWING" } });
  fireEvent.change(screen.getByLabelText("行为改变后"), { target: { value: "ACTIVE_EXPLORATION" } });
  fireEvent.change(screen.getByLabelText("文化意图锚点"), { target: { value: "intent_1111111111111111" } });
  fireEvent.change(screen.getByLabelText("作用机制"), { target: { value: "PARTICIPATORY_TRIGGER" } });
}

describe("TransferChallenge", () => {
  it("restores an existing challenge without requiring START", () => {
    const fetchImpl = vi.fn();
    render(<TransferChallenge projectId="project-1" stage="TRANSFER" initialState={failed} fetchImpl={fetchImpl as typeof fetch} />);
    expect(screen.queryByRole("button", { name: "生成迁移挑战" })).not.toBeInTheDocument();
    expect(screen.getByText("剩余作答次数：1")).toBeInTheDocument();
    expect(screen.getByText("保留结构：需要修改")).toBeInTheDocument();
  });

  it("preserves a dirty draft for the same revision but clears it for a new challenge revision", async () => {
    const fetchImpl = vi.fn();
    const view = render(<TransferChallenge projectId="project-1" stage="TRANSFER" initialState={challenge} fetchImpl={fetchImpl as typeof fetch} />);
    fillAnswer();
    view.rerender(<TransferChallenge projectId="project-1" stage="TRANSFER" initialState={{ ...challenge, attemptsUsed: 1, attemptsRemaining: 1, latestRubric: failed.latestRubric }} fetchImpl={fetchImpl as typeof fetch} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByLabelText("保留：文化意图")).toHaveValue("安岳石刻共同记忆");
    const revisionTwo = TransferPublicStateSchema.parse({ ...challenge, challenge: { ...challenge.challenge, challengeRevision: 2 } });
    view.rerender(<TransferChallenge projectId="project-1" stage="TRANSFER" initialState={revisionTwo} fetchImpl={fetchImpl as typeof fetch} />);
    await waitFor(() => expect(screen.getByLabelText("保留：文化意图")).toHaveValue(""));
    fireEvent.submit(screen.getByRole("form", { name: "迁移挑战回答" }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("shows the server challenge separately while every response control starts empty", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(challenge), { status: 200 }));
    render(<TransferChallenge projectId="project-1" stage="TRANSFER" fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByRole("button", { name: "生成迁移挑战" }));
    expect(await screen.findByText(/文化意图：安岳石刻共同记忆/)).toBeInTheDocument();
    expect(screen.getByText(/距离输入 → 声音强度输入/)).toBeInTheDocument();
    for (const label of [
      "保留：文化意图", "保留：输入", "保留：映射", "保留：输出", "改变维度", "改变前", "改变后",
      "源最小值", "源最大值", "源单位", "目标最小值", "目标最大值", "目标单位", "关系",
      "受众类型", "行为改变前", "行为改变后", "文化意图锚点", "作用机制",
    ]) expect((screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("button", { name: "提交迁移回答" })).toBeDisabled();
    expect(screen.getByText("填写全部必填字段后才可提交。")).toBeInTheDocument();
    expect(screen.getByLabelText("保留：文化意图")).not.toHaveValue("安岳石刻共同记忆");
    expect(screen.getByText("剩余作答次数：2")).toBeInTheDocument();
  });

  it("shows a described field error for overlong text and keeps submission disabled", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(challenge), { status: 200 }));
    render(<TransferChallenge projectId="project-1" stage="TRANSFER" fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByRole("button", { name: "生成迁移挑战" }));
    const field = await screen.findByLabelText("保留：文化意图");
    fireEvent.change(field, { target: { value: "文".repeat(501) } });
    expect(screen.getByText("文化意图最多500字。")).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-describedby", "transfer-error-cultural-intent");
    expect(screen.getByRole("button", { name: "提交迁移回答" })).toBeDisabled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed without fetching and focuses the first missing field", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(challenge), { status: 200 }));
    render(<TransferChallenge projectId="project-1" stage="TRANSFER" fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByRole("button", { name: "生成迁移挑战" }));
    await screen.findByLabelText("保留：文化意图");
    fireEvent.click(screen.getByRole("button", { name: "提交迁移回答" }));
    fireEvent.submit(screen.getByRole("form", { name: "迁移挑战回答" }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByLabelText("保留：文化意图")).toHaveFocus());
    expect(screen.getByRole("alert")).toHaveTextContent("请完成所有必填项");
  });

  it("does not send when exactly one required choice is missing", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(challenge), { status: 200 }));
    render(<TransferChallenge projectId="project-1" stage="TRANSFER" fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByRole("button", { name: "生成迁移挑战" }));
    await screen.findByLabelText("保留：文化意图"); fillAnswer();
    fireEvent.change(screen.getByLabelText("作用机制"), { target: { value: "" } });
    fireEvent.submit(screen.getByRole("form", { name: "迁移挑战回答" }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByLabelText("作用机制")).toHaveFocus());
  });

  it("blocks same-tick double submission and renders controlled rubric codes", async () => {
    let resolveSubmit!: (response: Response) => void;
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.action === "START") return Promise.resolve(new Response(JSON.stringify(challenge), { status: 200 }));
      return new Promise<Response>((resolve) => { resolveSubmit = resolve; });
    });
    const onChanged = vi.fn();
    render(<TransferChallenge projectId="project-1" stage="TRANSFER" fetchImpl={fetchImpl} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "生成迁移挑战" }));
    await screen.findByLabelText("保留：文化意图");
    fillAnswer();
    const submit = screen.getByRole("button", { name: "提交迁移回答" });
    fireEvent.click(submit); fireEvent.click(submit);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    resolveSubmit(new Response(JSON.stringify(failed), { status: 200 }));
    expect(await screen.findByText("保留结构：需要修改")).toBeInTheDocument();
    expect(screen.getByText("剩余作答次数：1")).toBeInTheDocument();
    expect(screen.getByLabelText("保留：文化意图")).toHaveValue("安岳石刻共同记忆");
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(onChanged.mock.calls[1]?.[0]).toMatchObject({ attemptsUsed: 1, status: "OPEN" });
  });

  it("clears a student's draft when the server challenge revision changes", async () => {
    const revised = { ...failed, challenge: { ...failed.challenge, challengeRevision: 2 } } as const;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(body.action === "START" ? challenge : revised), { status: 200 });
    });
    render(<TransferChallenge projectId="project-1" stage="TRANSFER" fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByRole("button", { name: "生成迁移挑战" }));
    await screen.findByLabelText("保留：文化意图"); fillAnswer();
    fireEvent.click(screen.getByRole("button", { name: "提交迁移回答" }));
    await screen.findByText("剩余作答次数：1");
    expect(screen.getByLabelText("保留：文化意图")).toHaveValue("");
  });

  it("aborts and ignores stale work on project or stage switch and unmount", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise<Response>(() => undefined);
    });
    const view = render(<TransferChallenge projectId="project-1" stage="TRANSFER" fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByRole("button", { name: "生成迁移挑战" }));
    view.rerender(<TransferChallenge projectId="project-2" stage="BUILD" fetchImpl={fetchImpl} />);
    expect(signals[0]?.aborted).toBe(true);
    expect(screen.queryByLabelText("保留：文化意图")).not.toBeInTheDocument();
    view.unmount();
  });

  it("keeps a passed result visible, announces it and calls onPassed once", async () => {
    const passed = {
      ...failed, status: "PASSED", attemptsUsed: 1, attemptsRemaining: 0,
      latestRubric: {
        ...failed.latestRubric!, score: 4, passed: true,
        criteria: {
          retainedStructure: { passed: true, reasonCode: "RETAINED_MATCH" },
          changedParts: { passed: true, reasonCode: "CHANGE_TARGETED" },
          normalization: { passed: true, reasonCode: "NORMALIZATION_VALID" },
          culturalImpact: { passed: true, reasonCode: "CULTURAL_CONCRETE" },
        }, outcome: "PASSED",
        feedback: { retained: false, changed: false, normalization: false, cultural: false, teacherReview: false, aiCode: null },
      },
    } as const;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(body.action === "START" ? challenge : passed), { status: 200 });
    });
    const onPassed = vi.fn();
    const onChanged = vi.fn();
    render(<TransferChallenge projectId="project-1" stage="TRANSFER" fetchImpl={fetchImpl} onPassed={onPassed} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "生成迁移挑战" }));
    await screen.findByLabelText("保留：文化意图"); fillAnswer();
    fireEvent.click(screen.getByRole("button", { name: "提交迁移回答" }));
    expect(await screen.findByRole("status")).toHaveTextContent("迁移挑战已通过");
    expect(screen.getByText("剩余作答次数：0")).toBeInTheDocument();
    expect(screen.getByText("保留结构：通过")).toBeInTheDocument();
    await waitFor(() => expect(onPassed).toHaveBeenCalledTimes(1));
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("focuses a safe error when the response violates the runtime schema", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ...challenge, attemptsRemaining: 99 }), { status: 200 }));
    render(<TransferChallenge projectId="project-1" stage="TRANSFER" fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByRole("button", { name: "生成迁移挑战" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("迁移挑战响应无效");
    await waitFor(() => expect(alert).toHaveFocus());
  });
});
