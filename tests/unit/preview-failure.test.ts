// @vitest-environment node

import { describe, expect, it } from "vitest";

import { ModelServiceError } from "@/lib/ai/client";
import { describePreviewFailure } from "@/lib/preview/failure";

describe("preview failure classification", () => {
  it.each([
    {
      error: new ModelServiceError("RATE_LIMIT", 30_000, 429),
      expected: {
        code: "MODEL_RATE_LIMIT",
        publicMessage: "模型服务当前请求较多。请稍后重新运行。",
        stage: "MODEL_REQUEST",
        retryable: true,
      },
    },
    {
      error: new ModelServiceError("TIMEOUT"),
      expected: {
        code: "MODEL_TIMEOUT",
        publicMessage: "模型响应超时。本次回答没有在现场等待时间内完成，请重新运行。",
        stage: "MODEL_REQUEST",
        retryable: true,
      },
    },
    {
      error: new ModelServiceError("TRANSPORT", null, null, "ECONNRESET"),
      expected: {
        code: "MODEL_TRANSPORT",
        publicMessage: "模型连接在回答完成前中断。请检查网络后重新运行。",
        stage: "MODEL_REQUEST",
        retryable: true,
      },
    },
    {
      error: new ModelServiceError("INVALID_RESPONSE", null, null, null, "JSON_INVALID"),
      expected: {
        code: "MODEL_INVALID_RESPONSE",
        publicMessage: "模型已返回内容，但格式未通过校验。请重新运行。",
        stage: "MODEL_RESPONSE",
        retryable: true,
      },
    },
    {
      error: new ModelServiceError("PROVIDER_STATUS", null, 401),
      expected: {
        code: "MODEL_PROVIDER_STATUS",
        publicMessage: "模型服务鉴权失败。请联系维护者检查模型授权。",
        stage: "MODEL_REQUEST",
        retryable: false,
      },
    },
    {
      error: new ModelServiceError("PROVIDER_STATUS", null, 503),
      expected: {
        code: "MODEL_PROVIDER_STATUS",
        publicMessage: "模型服务当前未能完成请求。请稍后重新运行。",
        stage: "MODEL_REQUEST",
        retryable: true,
      },
    },
    {
      error: new ModelServiceError("PROVIDER_STATUS", null, 400),
      expected: {
        code: "MODEL_PROVIDER_STATUS",
        publicMessage: "模型服务拒绝了这次请求。请联系维护者检查模型与多图能力。",
        stage: "MODEL_REQUEST",
        retryable: false,
      },
    },
    {
      error: new ModelServiceError("CANCELLED"),
      expected: {
        code: "MODEL_CANCELLED",
        publicMessage: "本次模型请求已中止。请重新运行。",
        stage: "MODEL_REQUEST",
        retryable: true,
      },
    },
  ])("maps $expected.code to a safe actionable instruction", ({ error, expected }) => {
    expect(describePreviewFailure(error)).toMatchObject(expected);
  });

  it("keeps low-level provider diagnostics in the server-only log fields", () => {
    const result = describePreviewFailure(new ModelServiceError(
      "INVALID_RESPONSE",
      null,
      null,
      "UND_ERR_SOCKET",
      "EVENT_SCHEMA_INVALID",
    ));
    expect(result.log).toEqual({
      errorName: "ModelServiceError",
      httpStatus: null,
      transportCode: "UND_ERR_SOCKET",
      protocolCode: "EVENT_SCHEMA_INVALID",
    });
    expect(result.publicMessage).not.toContain("UND_ERR_SOCKET");
    expect(result.publicMessage).not.toContain("EVENT_SCHEMA_INVALID");
  });
});
