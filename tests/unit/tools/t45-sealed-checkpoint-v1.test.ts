// @vitest-environment node

import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  acquireT45StageReservationV1,
  publishT45SealedCheckpointV1,
  T45StageReservationMetadataV1Schema,
} from "@/tools/mixed-retrieval/t45-sealed-checkpoint-v1";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })),
  );
});

async function tempRoot() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "t45-sealed-"),
  );
  roots.push(root);
  return root;
}

describe("T45 sealed checkpoints", () => {
  it("publishes through a same-directory temporary hard link without clobbering", async () => {
    const root = await tempRoot();
    const target = path.join(
      root,
      "sealed/report.json",
    );
    const first =
      await publishT45SealedCheckpointV1({
        target,
        bytes: "{\"sealed\":true}\n",
        errorPrefix: "T45_REPORT",
      });
    expect(first.bytes.toString("utf8"))
      .toBe("{\"sealed\":true}\n");
    await expect(
      publishT45SealedCheckpointV1({
        target,
        bytes: "{\"sealed\":false}\n",
        errorPrefix: "T45_REPORT",
      }),
    ).rejects.toThrow(
      "T45_REPORT_ALREADY_EXISTS",
    );
    expect(await readFile(target, "utf8"))
      .toBe("{\"sealed\":true}\n");
    expect(
      (await readdir(path.dirname(target)))
        .filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("fails closed on a held or crash-left reservation and never removes it implicitly", async () => {
    const root = await tempRoot();
    const target = path.join(
      root,
      "locks/run.draft.reservation",
    );
    const first =
      await acquireT45StageReservationV1({
        target,
        stage: "run:draft",
        runId: "calibration-v1",
        artifactId: "calibration-v1",
      });
    const metadata =
      T45StageReservationMetadataV1Schema.parse(
        JSON.parse(
          await readFile(target, "utf8"),
        ),
      );
    expect(metadata).toMatchObject({
      stage: "run:draft",
      pid: process.pid,
      runId: "calibration-v1",
      artifactId: "calibration-v1",
    });
    expect(
      Number.isNaN(Date.parse(metadata.createdAt)),
    ).toBe(false);
    await expect(
      acquireT45StageReservationV1({
        target,
        stage: "run:draft",
        runId: "calibration-v1",
        artifactId: "calibration-v1",
      }),
    ).rejects.toThrow(
      "T45_STAGE_RESERVATION_HELD:run:draft",
    );
    expect(await readFile(target, "utf8"))
      .toContain("T45_STAGE_RESERVATION");
    await first.release();

    const replaced =
      await acquireT45StageReservationV1({
        target,
        stage: "run:draft",
        runId: "calibration-v1",
        artifactId: "calibration-v1",
      });
    await writeFile(
      target,
      "replacement-owner\n",
      "utf8",
    );
    await expect(
      replaced.release(),
    ).rejects.toThrow(
      "T45_STAGE_RESERVATION_OWNER_DRIFT:run:draft",
    );
    expect(await readFile(target, "utf8"))
      .toBe("replacement-owner\n");

    await writeFile(target, "crash-left\n", "utf8");
    await expect(
      acquireT45StageReservationV1({
        target,
        stage: "run:draft",
        runId: "calibration-v1",
        artifactId: "calibration-v1",
      }),
    ).rejects.toThrow(
      "T45_STAGE_RESERVATION_HELD:run:draft",
    );
    expect(await readFile(target, "utf8"))
      .toBe("crash-left\n");
  });
});
