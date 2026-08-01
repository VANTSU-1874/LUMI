import { describe, expect, it } from "vitest";

import { parseModelBaseUrl } from "@/lib/config/model-url";

describe("parseModelBaseUrl", () => {
  it.each([
    ["https://api.example.com/v1/", "https://api.example.com/v1"],
    ["http://localhost:11434/v1/", "http://localhost:11434/v1"],
    ["http://127.0.0.1:8000/", "http://127.0.0.1:8000"],
    ["http://[::1]:11434/v1/", "http://[::1]:11434/v1"],
  ])("accepts and normalizes safe model URL %s", (input, expected) => {
    expect(parseModelBaseUrl(input)).toBe(expected);
  });

  it.each([
    "http://api.example.com/v1",
    "http://localhost.evil/v1",
    "http://localhost./v1",
    "https://api.example.com./v1",
    "https://user:pass@api.example.com/v1",
    "https://api.example.com/v1?tenant=other",
    "https://api.example.com/v1#fragment",
    "file:///tmp/model",
  ])("rejects unsafe model URL %s", (input) => {
    expect(() => parseModelBaseUrl(input)).toThrow("model base URL");
  });
});
