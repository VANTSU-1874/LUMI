import { ModelServiceError } from "@/lib/ai/client";

import type { PreviewFailureStage } from "./contracts";
import { PreviewModelUnavailableError } from "./preview-runner";

export type PreviewFailureDetails = {
  code: string;
  publicMessage: string;
  stage: PreviewFailureStage;
  retryable: boolean;
  log: {
    errorName: string;
    httpStatus: number | null;
    transportCode: string | null;
    protocolCode: string | null;
  };
};

const previewMessages: Record<PreviewModelUnavailableError["code"], string> = {
  PREVIEW_ROUTING_UNAVAILABLE: "这条预设尚未匹配到课程流程。请联系维护者检查场景配置。",
  PREVIEW_MODEL_NOT_CONFIGURED: "现场模型尚未配置。请联系维护者检查模型设置后重新运行。",
  PREVIEW_VISION_UNAVAILABLE: "当前模型无法读取这组图片。请联系维护者检查视觉模型能力。",
  PREVIEW_DECISION_UNAVAILABLE: "模型没有形成可展示的回答。请重新运行这次提问。",
};

function modelServicePresentation(error: ModelServiceError) {
  switch (error.code) {
    case "RATE_LIMIT":
      return {
        publicMessage: "模型服务当前请求较多。请稍后重新运行。",
        stage: "MODEL_REQUEST" as const,
        retryable: true,
      };
    case "TIMEOUT":
      return {
        publicMessage: "模型响应超时。本次回答没有在现场等待时间内完成，请重新运行。",
        stage: "MODEL_REQUEST" as const,
        retryable: true,
      };
    case "TRANSPORT":
      return {
        publicMessage: "模型连接在回答完成前中断。请检查网络后重新运行。",
        stage: "MODEL_REQUEST" as const,
        retryable: true,
      };
    case "INVALID_RESPONSE":
      return {
        publicMessage: "模型已返回内容，但格式未通过校验。请重新运行。",
        stage: "MODEL_RESPONSE" as const,
        retryable: true,
      };
    case "CANCELLED":
      return {
        publicMessage: "本次模型请求已中止。请重新运行。",
        stage: "MODEL_REQUEST" as const,
        retryable: true,
      };
    case "PROVIDER_STATUS":
      if (error.httpStatus === 401 || error.httpStatus === 403) {
        return {
          publicMessage: "模型服务鉴权失败。请联系维护者检查模型授权。",
          stage: "MODEL_REQUEST" as const,
          retryable: false,
        };
      }
      if (error.httpStatus !== null && [400, 404, 422].includes(error.httpStatus)) {
        return {
          publicMessage: "模型服务拒绝了这次请求。请联系维护者检查模型与多图能力。",
          stage: "MODEL_REQUEST" as const,
          retryable: false,
        };
      }
      return {
        publicMessage: "模型服务当前未能完成请求。请稍后重新运行。",
        stage: "MODEL_REQUEST" as const,
        retryable: true,
      };
  }
}

export function describePreviewFailure(error: unknown): PreviewFailureDetails {
  if (error instanceof PreviewModelUnavailableError) {
    return {
      code: error.code,
      publicMessage: previewMessages[error.code],
      stage: error.stage,
      retryable: error.retryable,
      log: {
        errorName: error.name,
        httpStatus: null,
        transportCode: null,
        protocolCode: null,
      },
    };
  }

  if (error instanceof ModelServiceError) {
    const presentation = modelServicePresentation(error);
    return {
      code: `MODEL_${error.code}`,
      ...presentation,
      log: {
        errorName: error.name,
        httpStatus: error.httpStatus,
        transportCode: error.transportCode,
        protocolCode: error.protocolCode,
      },
    };
  }

  return {
    code: "MODEL_RESPONSE_REJECTED",
    publicMessage: "模型回答未通过展示校验。请重新运行这次提问。",
    stage: "MODEL_RESPONSE",
    retryable: true,
    log: {
      errorName: error instanceof Error ? error.name : "UnknownError",
      httpStatus: null,
      transportCode: null,
      protocolCode: null,
    },
  };
}
