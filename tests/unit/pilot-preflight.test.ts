// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assessPilotPreflight,
  readPilotMaterialSnapshot,
  type PilotClassPreflightSnapshot,
  type PilotHealthProbe,
  type PilotMaterialSnapshot,
} from "@/lib/services/pilot-preflight";

const CLASS: PilotClassPreflightSnapshot = {
  classId: "pilot-1",
  className: "第一轮真实试用",
  moduleCount: 4,
  totalHours: 64,
  assignmentCount: 1,
  issuedIdentityCount: 5,
  claimedIdentityCount: 0,
  studentCount: 0,
  projectCount: 0,
};
const MATERIALS: PilotMaterialSnapshot = {
  accessFilePath: "C:\\private\\pilot-access.txt",
  observationFilePath: "C:\\private\\pilot-observation.md",
  accessIdentityCount: 5,
  observationSheetCount: 5,
  observationPrivateCodeCount: 0,
  observationClassCodeCount: 0,
};
const HEALTHY_LOCAL: PilotHealthProbe = { configured: true, https: false, reachable: true, competitionReady: true };
const HEALTHY_PUBLIC: PilotHealthProbe = { configured: true, https: true, reachable: true, competitionReady: true };

describe("pilot preflight", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("returns READY_TO_START only when every deterministic check passes", () => {
    const result = assessPilotPreflight({
      classSnapshot: CLASS,
      materials: MATERIALS,
      localHealth: HEALTHY_LOCAL,
      publicHealth: HEALTHY_PUBLIC,
      expectedParticipantCount: 5,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("READY_TO_START");
    expect(result.checks).toHaveLength(8);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it("blocks launch when the observation packet leaks a code or public HTTPS is absent", () => {
    const result = assessPilotPreflight({
      classSnapshot: CLASS,
      materials: { ...MATERIALS, observationPrivateCodeCount: 1 },
      localHealth: HEALTHY_LOCAL,
      publicHealth: { configured: false, https: false, reachable: false, competitionReady: false },
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("NOT_READY");
    expect(result.checks.find((check) => check.code === "ANONYMOUS_OBSERVATION_PACKET")?.passed).toBe(false);
    expect(result.checks.find((check) => check.code === "PUBLIC_HTTPS")?.passed).toBe(false);
  });

  it("finds the newest matching private materials and returns counts without code values", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tonggan-pilot-materials-"));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, "pilot-access-2026-01-01.txt"), [
      "试用班：别的班级", "01：AAAA-BBBB-CCCC",
    ].join("\n"));
    await writeFile(path.join(directory, "pilot-access-2026-01-02.txt"), [
      "试用班：第一轮真实试用", "01：AAAA-BBBB-CCCC", "02：DDDD-EEEE-FFFF",
    ].join("\n"));
    await writeFile(path.join(directory, "pilot-observation-2026-01-02.md"), [
      "- 试用班：第一轮真实试用",
      "# “触映”真实试用匿名观察表（试用序号 01）",
      "# “触映”真实试用匿名观察表（试用序号 02）",
    ].join("\n"));

    const result = await readPilotMaterialSnapshot(directory, "第一轮真实试用");
    expect(result.accessFilePath).toBe(path.join(directory, "pilot-access-2026-01-02.txt"));
    expect(result.observationFilePath).toBe(path.join(directory, "pilot-observation-2026-01-02.md"));
    expect(result.accessIdentityCount).toBe(2);
    expect(result.observationSheetCount).toBe(2);
    expect(result.observationPrivateCodeCount).toBe(0);
  });
});
