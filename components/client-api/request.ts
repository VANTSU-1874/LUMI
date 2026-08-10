import { shouldUseMockEndpoint } from "./config";
import { mockApiFetch } from "./mock/router";

export type LumiFetchOptions = {
  forceMock?: boolean;
  demoMode?: boolean;
  mockSelection?: string;
  nodeEnv?: string;
  realFetch?: typeof fetch;
};

export function createLumiFetch(options: LumiFetchOptions = {}): typeof fetch {
  return async (input, init) => {
    const useMock = options.forceMock
      || shouldUseMockEndpoint(input, options.mockSelection, {
        demoMode: options.demoMode,
        nodeEnv: options.nodeEnv,
      });
    if (useMock) return mockApiFetch(input, init);

    const realFetch = options.realFetch ?? globalThis.fetch;
    if (typeof realFetch !== "function") {
      throw new Error("当前环境没有可用的 fetch 实现");
    }
    return realFetch(input, init);
  };
}

export const lumiFetch: typeof fetch = (input, init) => createLumiFetch()(input, init);

const identityForbiddenCodes = new Set([
  "AUTH_REQUIRED",
  "IDENTITY_REQUIRED",
  "SESSION_REQUIRED",
  "STUDENT_SESSION_REQUIRED",
  "STUDENT_ROLE_FORBIDDEN",
  "STUDENT_SESSION_ROLE_FORBIDDEN",
]);

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfter?: number;
  readonly details?: unknown;

  constructor(input: {
    message: string;
    status: number;
    code?: string;
    retryAfter?: number;
    details?: unknown;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.status = input.status;
    this.code = input.code;
    this.retryAfter = input.retryAfter;
    this.details = input.details;
  }

  get requiresIdentityGate() {
    return this.status === 401
      || (this.status === 403 && Boolean(this.code && identityForbiddenCodes.has(this.code)));
  }
}

function retryAfterSeconds(response: Response) {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

export async function jsonOrThrow<T>(response: Response): Promise<T> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) {
      throw new ApiError({
        message: `请求失败（HTTP ${response.status}）`,
        status: response.status,
        retryAfter: retryAfterSeconds(response),
      });
    }
    throw new Error("服务返回了无法读取的数据");
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      && typeof payload.error === "string"
      ? payload.error
      : `请求失败（HTTP ${response.status}）`;
    const code = payload && typeof payload === "object" && "code" in payload
      && typeof payload.code === "string" ? payload.code : undefined;
    const details = payload && typeof payload === "object" && "details" in payload
      ? payload.details : undefined;
    throw new ApiError({
      message,
      status: response.status,
      code,
      retryAfter: retryAfterSeconds(response),
      details,
    });
  }
  return payload as T;
}
