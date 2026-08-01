import { z } from "zod";

const LOOPBACK_AUTHORITY = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

export const ModelBaseUrlSchema = z
  .string()
  .trim()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);
    const authority = /^https?:\/\/([^/?#]*)/i.exec(value)?.[1] ?? "";
    if (!["http:", "https:"].includes(url.protocol)) {
      context.addIssue({ code: "custom", message: "model base URL must use HTTP or HTTPS" });
    }
    if (url.username || url.password) {
      context.addIssue({ code: "custom", message: "model base URL must not contain credentials" });
    }
    if (url.hostname.endsWith(".")) {
      context.addIssue({ code: "custom", message: "model base URL must not use a trailing-dot host" });
    }
    if (value.includes("?") || value.includes("#")) {
      context.addIssue({ code: "custom", message: "model base URL must not contain query or fragment" });
    }
    if (url.protocol === "http:" && !LOOPBACK_AUTHORITY.test(authority)) {
      context.addIssue({
        code: "custom",
        message: "model base URL may use HTTP only for an exact loopback host",
      });
    }
  })
  .transform((value) => {
    const url = new URL(value);
    const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname}`;
  });

export function parseModelBaseUrl(value: string) {
  return ModelBaseUrlSchema.parse(value);
}
