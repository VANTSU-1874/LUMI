import { createHmac, timingSafeEqual } from "node:crypto";

import { ForbiddenRequestError } from "@/lib/auth/errors";

const SOURCE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_TIMESTAMP_SKEW_SECONDS = 60;

export type TrustedSource = {
  id: string;
  kind: "proxy-signed" | "development-fallback";
};

export function signTrustedSource(
  sourceId: string,
  timestamp: string,
  secret: string,
) {
  return createHmac("sha256", secret.trim())
    .update(`${sourceId}\0${timestamp}`, "utf8")
    .digest("hex");
}

export function resolveTrustedSource(
  headers: Headers,
  options: { nodeEnv?: string; secret: string; now?: Date },
): TrustedSource {
  const sourceId = headers.get("x-tonggan-source-id");
  const timestamp = headers.get("x-tonggan-source-timestamp");
  const signature = headers.get("x-tonggan-source-signature");
  const hasAnyHeader = Boolean(sourceId || timestamp || signature);

  if (!hasAnyHeader && options.nodeEnv !== "production") {
    return { id: "local-development", kind: "development-fallback" };
  }

  if (
    !sourceId ||
    !timestamp ||
    !signature ||
    !SOURCE_ID_PATTERN.test(sourceId) ||
    !/^\d{10}$/.test(timestamp) ||
    !/^[a-f0-9]{64}$/i.test(signature)
  ) {
    throw new ForbiddenRequestError();
  }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_TIMESTAMP_SKEW_SECONDS) {
    throw new ForbiddenRequestError();
  }

  const expected = Buffer.from(
    signTrustedSource(sourceId, timestamp, options.secret),
    "hex",
  );
  const submitted = Buffer.from(signature, "hex");
  if (!timingSafeEqual(expected, submitted)) {
    throw new ForbiddenRequestError();
  }

  return { id: sourceId, kind: "proxy-signed" };
}
