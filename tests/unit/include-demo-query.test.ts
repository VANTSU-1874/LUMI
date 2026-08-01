import { describe, expect, it } from "vitest";

import { InvalidIncludeDemoQueryError, parseIncludeDemoQuery } from "@/lib/domain/include-demo-query";

describe("includeDemo query", () => {
  it.each([[null, false], ["false", false], ["true", true]] as const)("parses %s", (raw, expected) => {
    expect(parseIncludeDemoQuery(raw)).toBe(expected);
  });

  it.each(["1", "TRUE", "yes", "", " true "])("rejects ambiguous value %s", (raw) => {
    expect(() => parseIncludeDemoQuery(raw)).toThrow(InvalidIncludeDemoQueryError);
  });
});
