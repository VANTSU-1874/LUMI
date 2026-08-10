import { describe, expect, it } from "vitest";

import { ModelServiceError } from "@/lib/ai/client";
import {
  parseTutorQualityPrivacyServiceFailure,
  tutorQualityPrivacyServiceFailureError,
  tutorQualityServiceFailure,
} from "@/lib/agent/tutor-quality-service-interruption";

describe("tutor quality service interruption", () => {
  it.each([408, 425, 500, 502, 503, 504])(
    "marks transient provider HTTP %s failures as resumable",
    (status) => {
      const failure = tutorQualityServiceFailure(
        new ModelServiceError("PROVIDER_STATUS", null, status),
      );
      expect(failure).toEqual({ code: "PROVIDER_STATUS", resumable: true });
      expect(parseTutorQualityPrivacyServiceFailure(
        tutorQualityPrivacyServiceFailureError(failure!),
      )).toEqual(failure);
    },
  );

  it("marks transport failures and timeouts as resumable", () => {
    expect(tutorQualityServiceFailure(new ModelServiceError("TIMEOUT")))
      .toEqual({ code: "TIMEOUT", resumable: true });
    expect(tutorQualityServiceFailure(new ModelServiceError("TRANSPORT")))
      .toEqual({ code: "TRANSPORT", resumable: true });
  });

  it.each([400, 401, 403, 404, 409, 422, 501, 505, null])(
    "marks permanent or unknown provider HTTP %s failures as terminal",
    (status) => {
      expect(tutorQualityServiceFailure(
        new ModelServiceError("PROVIDER_STATUS", null, status),
      )).toEqual({ code: "PROVIDER_STATUS", resumable: false });
    },
  );

  it("keeps rate limits, invalid output, and non-model errors on their existing paths", () => {
    expect(tutorQualityServiceFailure(new ModelServiceError("RATE_LIMIT"))).toBeNull();
    expect(tutorQualityServiceFailure(new ModelServiceError("INVALID_RESPONSE"))).toBeNull();
    expect(tutorQualityServiceFailure(new Error("PROVIDER_STATUS"))).toBeNull();
    expect(parseTutorQualityPrivacyServiceFailure("PRIVACY_LEAK_OUTPUT")).toBeNull();
  });
});
