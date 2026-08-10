import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  materializeLegacyKnowledgeCorpusV2,
} from "../../helpers/knowledge-v2-generation-fixtures";

import {
  runT45CapabilitySuiteCli,
} from "../../../scripts/build-t45-capability-suites";

const workspaceRoot = process.cwd();
const temporaryRoots: string[] = [];

const outputNames = [
  "t45-capability-inventory.json",
  "t45-capability-calibration.runtime.json",
  "t45-capability-calibration.qrels.json",
  "t45-capability-validation.runtime.json",
  "t45-capability-validation.qrels.json",
] as const;

async function makeWorkspace() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "lumi-t45-capability-"),
  );
  temporaryRoots.push(root);
  const corpusDirectory = path.join(
    root,
    "data",
    "knowledge-v2",
  );
  const suiteDirectory = path.join(
    root,
    "tests",
    "retrieval-quality",
  );
  await Promise.all([
    mkdir(corpusDirectory, { recursive: true }),
    mkdir(suiteDirectory, { recursive: true }),
  ]);
  await Promise.all([
    materializeLegacyKnowledgeCorpusV2(
      path.join(
        corpusDirectory,
        "knowledge-corpus.v2.json",
      ),
      workspaceRoot,
    ),
    copyFile(
      path.join(
        workspaceRoot,
        "tests",
        "retrieval-quality",
        "t44-support-dev.qrels.json",
      ),
      path.join(
        suiteDirectory,
        "t44-support-dev.qrels.json",
      ),
    ),
  ]);
  return { root, suiteDirectory };
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("build-t45-capability-suites CLI", () => {
  it("writes all five canonical artifacts and exact summary counts", async () => {
    const { root, suiteDirectory } = await makeWorkspace();
    const messages: string[] = [];

    const summary = await runT45CapabilitySuiteCli({
      workspaceRoot: root,
      args: ["--write"],
      log: (message) => messages.push(message),
    });

    expect(
      await Promise.all(
        outputNames.map(async (name) =>
          JSON.parse(
            await readFile(
              path.join(suiteDirectory, name),
              "utf8",
            ),
          )),
      ),
    ).toHaveLength(5);
    expect(summary).toMatchObject({
      mode: "WRITE",
      objects: 116,
      frozenT44Objects: 42,
      calibrationObjects: 11,
      validationObjects: 13,
      visualReserveObjects: 50,
      calibrationFamilies: 10,
      validationFamilies: 10,
      calibrationCases: 20,
      validationCases: 20,
      calibrationGroups: 30,
      validationGroups: 30,
      calibrationMulti: 10,
      validationMulti: 10,
    });
    expect(JSON.parse(messages.at(-1) ?? "{}")).toEqual(
      summary,
    );
  });

  it("checks canonical bytes without writing", async () => {
    const { root, suiteDirectory } = await makeWorkspace();
    await runT45CapabilitySuiteCli({
      workspaceRoot: root,
      args: ["--write"],
      log: () => undefined,
    });
    const before = await Promise.all(
      outputNames.map(async (name) => {
        const filePath = path.join(suiteDirectory, name);
        return {
          text: await readFile(filePath, "utf8"),
          modified: (await stat(filePath)).mtimeMs,
        };
      }),
    );

    const summary = await runT45CapabilitySuiteCli({
      workspaceRoot: root,
      args: ["--check"],
      log: () => undefined,
    });
    const after = await Promise.all(
      outputNames.map(async (name) => {
        const filePath = path.join(suiteDirectory, name);
        return {
          text: await readFile(filePath, "utf8"),
          modified: (await stat(filePath)).mtimeMs,
        };
      }),
    );

    expect(summary.mode).toBe("CHECK");
    expect(after).toEqual(before);
  });

  it("fails closed when one canonical byte drifts", async () => {
    const { root, suiteDirectory } = await makeWorkspace();
    await runT45CapabilitySuiteCli({
      workspaceRoot: root,
      args: ["--write"],
      log: () => undefined,
    });
    const inventoryPath = path.join(
      suiteDirectory,
      outputNames[0],
    );
    const inventoryText = await readFile(
      inventoryPath,
      "utf8",
    );
    await writeFile(
      inventoryPath,
      `${inventoryText}\n`,
      "utf8",
    );

    await expect(
      runT45CapabilitySuiteCli({
        workspaceRoot: root,
        args: ["--check"],
        log: () => undefined,
      }),
    ).rejects.toThrow(
      /T45_CAPABILITY_INVENTORY_GENERATED_FILE_DRIFT/,
    );
  });

  it("freezes the package command surface", async () => {
    const packageJson = JSON.parse(
      await readFile(
        path.join(workspaceRoot, "package.json"),
        "utf8",
      ),
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["premixed:t45:suites"]).toBe(
      "node scripts/check-runtime-tools.mjs --tools tsx",
    );
    expect(packageJson.scripts["mixed:t45:suites"]).toBe(
      "tsx scripts/build-t45-capability-suites.ts --check",
    );
  });
});
