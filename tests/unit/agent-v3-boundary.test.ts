// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("V3 tutor architecture boundary", () => {
  it("does not import legacy answer gates or learner-text rewriters", async () => {
    const directory = path.join(process.cwd(), "lib", "agent", "v3");
    const files = (await readdir(directory)).filter((file) => file.endsWith(".ts"));
    const source = (await Promise.all(
      files.map((file) => readFile(path.join(directory, file), "utf8")),
    )).join("\n");

    for (const legacyModule of [
      "model-decision",
      "model-tool-loop",
      "model-technical-vocabulary",
      "answer-grounding",
      "learner-output-normalizer",
    ]) {
      expect(source, `V3 must not depend on legacy ${legacyModule}`).not.toContain(legacyModule);
    }
  });
});
