import { describe, expect, it } from "vitest";

import type { UploadProgress } from "@/components/client-api/contracts";
import { uploadArtworkRun } from "@/components/client-api/upload";

class FakeUploadRequest {
  upload = {} as XMLHttpRequestUpload;
  onerror: ((this: XMLHttpRequest, event: ProgressEvent) => unknown) | null = null;
  onabort: ((this: XMLHttpRequest, event: ProgressEvent) => unknown) | null = null;
  onload: ((this: XMLHttpRequest, event: ProgressEvent) => unknown) | null = null;
  responseType: XMLHttpRequestResponseType = "";
  withCredentials = false;
  status = 202;
  response: unknown = {
    created: true,
    nextEventSequence: 1,
    run: {
      id: "20000000-0000-4000-8000-000000000001",
      taskId: "10000000-0000-4000-8000-000000000001",
      status: "QUEUED",
    },
  };
  readonly headers = new Map<string, string>();
  sentBody: Document | XMLHttpRequestBodyInit | null = null;

  open() {}

  setRequestHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value);
  }

  abort() {
    this.onabort?.call(this as unknown as XMLHttpRequest, new ProgressEvent("abort"));
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.sentBody = body;
    this.upload.onloadstart?.call(this as unknown as XMLHttpRequest, new ProgressEvent("loadstart"));
    this.upload.onprogress?.call(this as unknown as XMLHttpRequest, new ProgressEvent("progress", {
      lengthComputable: false,
      loaded: 128,
      total: 0,
    }));
    this.upload.onload?.call(this as unknown as XMLHttpRequest, new ProgressEvent("load"));
    queueMicrotask(() => this.onload?.call(this as unknown as XMLHttpRequest, new ProgressEvent("load")));
  }
}

const baseInput = {
  request: {
    taskId: "10000000-0000-4000-8000-000000000001",
    message: "请看这份作品",
    context: { view: "AGENT" as const },
  },
  artwork: new File([new Uint8Array([137, 80, 78, 71])], "draft.png", { type: "image/png" }),
  idempotencyKey: "90000000-0000-4000-8000-000000000001",
};

describe("artwork XHR upload", () => {
  it("reports indeterminate progress, preserves idempotency and lets the browser set multipart content type", async () => {
    const request = new FakeUploadRequest();
    const progress: UploadProgress[] = [];
    const result = await uploadArtworkRun({
      ...baseInput,
      xhrFactory: () => request as unknown as XMLHttpRequest,
      onProgress: (update) => progress.push(update),
    });

    expect(result.run.id).toBe("20000000-0000-4000-8000-000000000001");
    expect(request.headers.get("idempotency-key")).toBe(baseInput.idempotencyKey);
    expect(request.headers.has("content-type")).toBe(false);
    expect(request.sentBody).toBeInstanceOf(FormData);
    expect(progress).toContainEqual(expect.objectContaining({
      phase: "UPLOADING",
      percent: 0,
      indeterminate: true,
    }));
    expect(progress).toContainEqual(expect.objectContaining({
      phase: "PROCESSING",
      percent: 0,
      indeterminate: true,
    }));
  });

  it("rejects a successful HTTP response whose JSON body is empty or invalid", async () => {
    const request = new FakeUploadRequest();
    request.status = 200;
    request.response = null;
    await expect(uploadArtworkRun({
      ...baseInput,
      xhrFactory: () => request as unknown as XMLHttpRequest,
    })).rejects.toThrow(/运行信息为空或格式无效/);
  });
});
