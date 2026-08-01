import { ModelServiceError } from "@/lib/ai/client";

export type TutorQualityServiceFailureCode = "PROVIDER_STATUS" | "TIMEOUT" | "TRANSPORT";
export type TutorQualityServiceFailure = {
  code: TutorQualityServiceFailureCode;
  resumable: boolean;
};

const RESUMABLE_PROVIDER_STATUSES = new Set([408, 425, 500, 502, 503, 504]);

export function tutorQualityServiceFailure(
  error: unknown,
): TutorQualityServiceFailure | null {
  if (!(error instanceof ModelServiceError)) return null;
  if (error.code === "TIMEOUT" || error.code === "TRANSPORT") {
    return { code: error.code, resumable: true };
  }
  if (error.code !== "PROVIDER_STATUS") return null;
  return {
    code: "PROVIDER_STATUS",
    resumable: error.httpStatus !== null && RESUMABLE_PROVIDER_STATUSES.has(error.httpStatus),
  };
}

export function tutorQualityPrivacyServiceFailureError(
  failure: TutorQualityServiceFailure,
) {
  const disposition = failure.resumable ? "RESUMABLE" : "TERMINAL";
  return `PRIVACY_PROBE_MODEL_SERVICE_${disposition}_${failure.code}` as const;
}

export function parseTutorQualityPrivacyServiceFailure(
  error: string | null,
): TutorQualityServiceFailure | null {
  const match = error?.match(
    /^PRIVACY_PROBE_MODEL_SERVICE_(RESUMABLE|TERMINAL)_(PROVIDER_STATUS|TIMEOUT|TRANSPORT)$/,
  );
  if (!match) return null;
  return {
    resumable: match[1] === "RESUMABLE",
    code: match[2] as TutorQualityServiceFailureCode,
  };
}
