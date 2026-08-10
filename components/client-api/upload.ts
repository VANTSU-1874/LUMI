import type { AgentRunCreateResponse, AgentTurnRequest, UploadProgress } from "./contracts";
import { shouldUseMockEndpoint } from "./config";
import { ApiError, createLumiFetch, jsonOrThrow } from "./request";

export type ArtworkRunUploadInput = {
  request: AgentTurnRequest;
  artwork: File;
  idempotencyKey: string;
  signal?: AbortSignal;
  forceMock?: boolean;
  mockSelection?: string;
  xhrFactory?: () => XMLHttpRequest;
  onProgress?: (progress: UploadProgress) => void;
};

function report(
  callback: ArtworkRunUploadInput["onProgress"],
  phase: UploadProgress["phase"],
  percent: number,
  message: string,
  indeterminate = false,
) {
  callback?.({
    phase,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    indeterminate,
    message,
  });
}

function formData(input: ArtworkRunUploadInput) {
  const form = new FormData();
  form.set("payload", JSON.stringify(input.request));
  form.set("artwork", input.artwork);
  return form;
}

async function mockUpload(input: ArtworkRunUploadInput) {
  report(input.onProgress, "READING", 4, "正在检查作品文件…");
  for (const percent of [18, 36, 58, 78, 96]) {
    if (input.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    await new Promise((resolve) => window.setTimeout(resolve, 90));
    report(input.onProgress, "UPLOADING", percent, "正在上传演示作品…");
  }
  const response = await createLumiFetch({ forceMock: true })("/api/agent/runs", {
    method: "POST",
    headers: { "idempotency-key": input.idempotencyKey },
    body: formData(input),
    signal: input.signal,
  });
  report(input.onProgress, "PROCESSING", 0, "上传完成，Lumi 正在阅读作品…", true);
  return jsonOrThrow<AgentRunCreateResponse>(response);
}

function realUpload(input: ArtworkRunUploadInput) {
  return new Promise<AgentRunCreateResponse>((resolve, reject) => {
    const request = input.xhrFactory?.() ?? new XMLHttpRequest();
    const abort = () => request.abort();
    const cleanup = () => input.signal?.removeEventListener("abort", abort);
    request.open("POST", "/api/agent/runs");
    request.responseType = "json";
    request.withCredentials = true;
    request.setRequestHeader("accept", "application/json");
    request.setRequestHeader("idempotency-key", input.idempotencyKey);
    request.upload.onloadstart = () => report(input.onProgress, "UPLOADING", 0, "正在上传作品…", true);
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        report(input.onProgress, "UPLOADING", 0, "正在上传作品，暂时无法计算剩余比例…", true);
        return;
      }
      report(input.onProgress, "UPLOADING", (event.loaded / event.total) * 100, "正在上传作品，请不要关闭页面…");
    };
    request.upload.onload = () => report(input.onProgress, "PROCESSING", 0, "上传完成，Lumi 正在阅读作品…", true);
    request.onerror = () => {
      cleanup();
      reject(new Error("作品上传中断，请保留页面后重试"));
    };
    request.onabort = () => {
      cleanup();
      reject(new DOMException("The operation was aborted", "AbortError"));
    };
    request.onload = () => {
      cleanup();
      const payload = request.response as AgentRunCreateResponse | { error?: string } | null;
      if (request.status < 200 || request.status >= 300) {
        reject(new ApiError({
          message: payload && "error" in payload && payload.error
            ? payload.error
            : `作品提交失败（HTTP ${request.status}）`,
          status: request.status,
        }));
        return;
      }
      if (!isRunCreateResponse(payload)) {
        reject(new Error("作品已上传，但服务返回的运行信息为空或格式无效；请用原提交标识查询状态。"));
        return;
      }
      report(input.onProgress, "COMPLETE", 100, "作品已交给 Lumi");
      resolve(payload as AgentRunCreateResponse);
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    request.send(formData(input));
  });
}

function isRunCreateResponse(payload: unknown): payload is AgentRunCreateResponse {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  if (typeof record.created !== "boolean" || !Number.isInteger(record.nextEventSequence)) return false;
  if (!record.run || typeof record.run !== "object") return false;
  const run = record.run as Record<string, unknown>;
  return typeof run.id === "string"
    && typeof run.taskId === "string"
    && typeof run.status === "string";
}

export function uploadArtworkRun(input: ArtworkRunUploadInput) {
  const useMock = input.forceMock
    || shouldUseMockEndpoint("/api/agent/runs", input.mockSelection);
  return useMock ? mockUpload(input) : realUpload(input);
}
