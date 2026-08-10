// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  createPackCompetitionAlgorithmHashesV2,
} from "@/lib/knowledge/mixed-retrieval-runtime-v2";

type AlgorithmSources = Parameters<
  typeof createPackCompetitionAlgorithmHashesV2
>[0];

function hashes(overrides: Partial<AlgorithmSources> = {}) {
  return createPackCompetitionAlgorithmHashesV2({
    packCompetitionCoreSource: Buffer.from("core-v1"),
    lexicalPackCompetitionSource: Buffer.from("lexical-v1"),
    lexicalScoringSource: Buffer.from("scoring-v1"),
    textPackCompetitionSource: Buffer.from("text-v1"),
    ...overrides,
  });
}

describe("pack competition algorithm identity", () => {
  it("binds the shared core to both channels", () => {
    const baseline = hashes();
    const changed = hashes({
      packCompetitionCoreSource: Buffer.from("core-v2"),
    });

    expect(changed.lexicalPackCompetitionAlgorithmHash)
      .not.toBe(baseline.lexicalPackCompetitionAlgorithmHash);
    expect(changed.textPackCompetitionAlgorithmHash)
      .not.toBe(baseline.textPackCompetitionAlgorithmHash);
  });

  it("binds lexical scoring without changing text identity", () => {
    const baseline = hashes();
    const changed = hashes({
      lexicalScoringSource: Buffer.from("scoring-v2"),
    });

    expect(changed.lexicalPackCompetitionAlgorithmHash)
      .not.toBe(baseline.lexicalPackCompetitionAlgorithmHash);
    expect(changed.textPackCompetitionAlgorithmHash)
      .toBe(baseline.textPackCompetitionAlgorithmHash);
  });

  it("keeps channel-specific source drift isolated", () => {
    const baseline = hashes();
    const lexicalChanged = hashes({
      lexicalPackCompetitionSource: Buffer.from("lexical-v2"),
    });
    const textChanged = hashes({
      textPackCompetitionSource: Buffer.from("text-v2"),
    });

    expect(lexicalChanged.lexicalPackCompetitionAlgorithmHash)
      .not.toBe(baseline.lexicalPackCompetitionAlgorithmHash);
    expect(lexicalChanged.textPackCompetitionAlgorithmHash)
      .toBe(baseline.textPackCompetitionAlgorithmHash);
    expect(textChanged.textPackCompetitionAlgorithmHash)
      .not.toBe(baseline.textPackCompetitionAlgorithmHash);
    expect(textChanged.lexicalPackCompetitionAlgorithmHash)
      .toBe(baseline.lexicalPackCompetitionAlgorithmHash);
  });
});
