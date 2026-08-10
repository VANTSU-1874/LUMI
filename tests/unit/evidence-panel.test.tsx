import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvidencePanel } from "@/components/student/EvidencePanel";

afterEach(cleanup);

const savedTransportEvidence = {
  id: "00000000-0000-4000-8000-000000000002",
  kind: "PROBE",
  signalLayer: "TRANSPORT",
  label: "传输验证",
  verificationStatus: "RULE_VERIFIED",
  createdAt: "2026-07-12T09:00:00.000Z",
};

const pathPlan = (path: "DIGISHOW" | "TOUCHDESIGNER" | "COLLABORATIVE") => ({
  path,
  requirements: {
    needsRealtimeVisuals: path !== "DIGISHOW",
    needsPhysicalControl: path !== "TOUCHDESIGNER",
    hasOsc: path === "COLLABORATIVE",
  },
});

describe("EvidencePanel", () => {
  it("supports value/text/link/file choices and blocks oversized images", () => {
    render(<EvidencePanel projectId="project-1" fetchImpl={vi.fn()} />);
    expect(screen.getByLabelText("证据类型")).toBeInTheDocument();
    expect(screen.getByLabelText("标签")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("证据类型"), { target: { value: "IMAGE" } });
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("图片文件"), { target: { files: [file] } });
    expect(screen.getByRole("alert")).toHaveTextContent("5MiB");
    expect(screen.getByRole("alert")).toHaveFocus();
  });

  it("accepts clipboard image paste without rendering untrusted HTML", () => {
    render(<EvidencePanel projectId="project-1" fetchImpl={vi.fn()} />);
    const file = new File([new Uint8Array([1, 2, 3])], "paste.png", { type: "image/png" });
    fireEvent.paste(screen.getByTestId("evidence-panel"), {
      clipboardData: { files: [file], getData: () => "<img src=x onerror=alert(1)>" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("已粘贴：paste.png");
    expect(document.querySelector("img")).toBeNull();
  });

  it("prevents double submit and ignores stale responses after project changes", async () => {
    let resolve!: (value: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    const onSaved = vi.fn();
    const view = render(<EvidencePanel projectId="project-1" fetchImpl={fetchImpl} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "距离" } });
    fireEvent.change(screen.getByLabelText("数值"), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "保存证据" }));
    fireEvent.click(screen.getByRole("button", { name: "正在上传" }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    view.rerender(<EvidencePanel projectId="project-2" fetchImpl={fetchImpl} onSaved={onSaved} />);
    await waitFor(() => {
      expect(screen.getByLabelText("证据类型")).toHaveValue("VALUE");
      expect(screen.getByLabelText("标签")).toHaveValue("");
      expect(screen.getByLabelText("数值")).toHaveValue(null);
    });
    resolve(new Response(JSON.stringify({ id: "old" }), { status: 201 }));
    await waitFor(() => expect(onSaved).not.toHaveBeenCalled());
  });

  it("rejects a blank numeric value without fetching and exposes input semantics", () => {
    const fetchImpl = vi.fn();
    render(<EvidencePanel projectId="project-1" fetchImpl={fetchImpl} />);
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "距离" } });
    const input = screen.getByLabelText("数值");
    expect(input).toHaveAttribute("required");
    expect(input).toHaveAttribute("inputmode", "decimal");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "保存证据" }));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("有限数值");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("aborts and suppresses callbacks when unmounted during upload", async () => {
    let resolve!: (value: Response) => void;
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((done) => { resolve = done; });
    });
    const onSaved = vi.fn();
    const view = render(<EvidencePanel projectId="project-1" fetchImpl={fetchImpl} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "距离" } });
    fireEvent.change(screen.getByLabelText("数值"), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "保存证据" }));
    view.unmount();
    expect(signal?.aborted).toBe(true);
    resolve(new Response(JSON.stringify({ id: "late" }), { status: 201 }));
    await Promise.resolve();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("submits current-layer structured probe fields and shows verified status", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      id: "00000000-0000-4000-8000-000000000001",
      kind: "PROBE",
      signalLayer: "INPUT",
      label: "距离对照",
      verificationStatus: "RULE_VERIFIED",
      createdAt: "2026-07-12T09:00:00.000Z",
    }), { status: 201 }));
    const onSaved = vi.fn();
    render(<EvidencePanel projectId="project-1" fetchImpl={fetchImpl} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("证据类型"), { target: { value: "PROBE" } });
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "距离对照" } });
    fireEvent.change(screen.getByLabelText("条件一"), { target: { value: "手靠近" } });
    fireEvent.change(screen.getByLabelText("条件一数值"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("条件二"), { target: { value: "手远离" } });
    fireEvent.change(screen.getByLabelText("条件二数值"), { target: { value: "24" } });
    fireEvent.change(screen.getByLabelText("单位"), { target: { value: "cm" } });
    fireEvent.click(screen.getByRole("button", { name: "保存证据" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const request = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(request).toEqual({
      kind: "PROBE", label: "距离对照", signalLayer: "INPUT",
      probe: {
        type: "INPUT_MEASUREMENT", firstCondition: "手靠近", firstValue: 12,
        secondCondition: "手远离", secondValue: 24, unit: "cm",
      },
    });
    expect(screen.getByRole("status")).toHaveTextContent("已验证");
  });

  it.each([
    ["DIGISHOW", "DigiShow单工具路径"],
    ["TOUCHDESIGNER", "TouchDesigner单工具路径"],
  ] as const)("uses a local-channel receipt for the %s path", async (path, pathLabel) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(savedTransportEvidence), { status: 201 }));
    render(<EvidencePanel projectId="project-1" toolPath={pathPlan(path)} fetchImpl={fetchImpl} />);
    fireEvent.change(screen.getByLabelText("证据类型"), { target: { value: "PROBE" } });
    fireEvent.change(screen.getByLabelText("信号层"), { target: { value: "TRANSPORT" } });

    expect(screen.getByText(`当前路径：${pathLabel}`)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "本地通道传递验证" })).toBeInTheDocument();
    expect(screen.queryByLabelText("OSC主机")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "传输验证" } });
    fireEvent.change(screen.getByLabelText("源通道"), { target: { value: "input/channel1" } });
    fireEvent.change(screen.getByLabelText("目标通道"), { target: { value: "mapping/channel1" } });
    fireEvent.change(screen.getByLabelText("本地接收值"), { target: { value: "0.75" } });
    fireEvent.click(screen.getByRole("button", { name: "保存证据" }));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string).probe).toEqual({
      type: "LOCAL_CHANNEL_RECEIPT",
      sourceChannel: "input/channel1",
      targetChannel: "mapping/channel1",
      receivedValue: 0.75,
    });
  });

  it("uses an OSC receipt only for the collaborative path", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(savedTransportEvidence), { status: 201 }));
    render(<EvidencePanel projectId="project-1" toolPath={pathPlan("COLLABORATIVE")} fetchImpl={fetchImpl} />);
    fireEvent.change(screen.getByLabelText("证据类型"), { target: { value: "PROBE" } });
    fireEvent.change(screen.getByLabelText("信号层"), { target: { value: "TRANSPORT" } });

    expect(screen.getByText("当前路径：DigiShow + TouchDesigner协同路径")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "OSC跨软件接收验证" })).toBeInTheDocument();
    expect(screen.queryByLabelText("源通道")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "传输验证" } });
    fireEvent.change(screen.getByLabelText("OSC主机"), { target: { value: "127.0.0.1" } });
    fireEvent.change(screen.getByLabelText("OSC端口"), { target: { value: "9000" } });
    fireEvent.change(screen.getByLabelText("OSC接收值"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "保存证据" }));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body as string).probe).toEqual({
      type: "TRANSPORT_RECEIPT",
      protocol: "OSC",
      host: "127.0.0.1",
      port: 9000,
      receivedValue: 0.5,
    });
  });

  it("blocks a transport probe until the trusted tool path is available", () => {
    const fetchImpl = vi.fn();
    render(<EvidencePanel projectId="project-1" toolPath={null} fetchImpl={fetchImpl} />);
    fireEvent.change(screen.getByLabelText("证据类型"), { target: { value: "PROBE" } });
    fireEvent.change(screen.getByLabelText("信号层"), { target: { value: "TRANSPORT" } });
    expect(screen.getByRole("alert")).toHaveTextContent("先完成工具路径");
    expect(screen.getByRole("button", { name: "保存证据" })).toBeDisabled();
  });

  it("clears stale transport fields when the persisted tool path changes", async () => {
    const fetchImpl = vi.fn();
    const view = render(<EvidencePanel projectId="project-1" toolPath={pathPlan("DIGISHOW")} fetchImpl={fetchImpl} />);
    fireEvent.change(screen.getByLabelText("证据类型"), { target: { value: "PROBE" } });
    fireEvent.change(screen.getByLabelText("信号层"), { target: { value: "TRANSPORT" } });
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "旧路径草稿" } });
    fireEvent.change(screen.getByLabelText("源通道"), { target: { value: "input/channel1" } });

    view.rerender(<EvidencePanel projectId="project-1" toolPath={pathPlan("COLLABORATIVE")} fetchImpl={fetchImpl} />);

    await waitFor(() => expect(screen.getByLabelText("证据类型")).toHaveValue("VALUE"));
    expect(screen.getByLabelText("标签")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("证据类型"), { target: { value: "PROBE" } });
    fireEvent.change(screen.getByLabelText("信号层"), { target: { value: "TRANSPORT" } });
    expect(screen.getByRole("group", { name: "OSC跨软件接收验证" })).toBeInTheDocument();
    expect(screen.getByLabelText("OSC主机")).toHaveValue("127.0.0.1");
    expect(screen.queryByLabelText("源通道")).not.toBeInTheDocument();
  });

  it("rejects a successful but malformed server response", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "not-a-record" }), { status: 201 }));
    const onSaved = vi.fn();
    render(<EvidencePanel projectId="project-1" fetchImpl={fetchImpl} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "距离" } });
    fireEvent.change(screen.getByLabelText("数值"), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "保存证据" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("无效"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("focuses and announces a server-rejected image upload", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "图片格式无效" }), { status: 415 }));
    render(<EvidencePanel projectId="project-1" fetchImpl={fetchImpl} />);
    fireEvent.change(screen.getByLabelText("证据类型"), { target: { value: "IMAGE" } });
    fireEvent.change(screen.getByLabelText("标签"), { target: { value: "伪装图片" } });
    fireEvent.change(screen.getByLabelText("图片文件"), { target: { files: [new File(["not png"], "fake.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "保存证据" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("图片格式无效");
    await waitFor(() => expect(alert).toHaveFocus());
  });
});
