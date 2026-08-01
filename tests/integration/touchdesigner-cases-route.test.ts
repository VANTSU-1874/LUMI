// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GET as getManifest } from "@/app/api/touchdesigner-cases/route";
import { GET as getStructure } from "@/app/api/touchdesigner-cases/[structureId]/route";
import type { TouchDesignerCaseLibrary } from "@/lib/touchdesigner/types";

describe("TouchDesigner case routes", () => {
  it("serves the generated posters manifest with truthful totals", async () => {
    const response = await getManifest();
    const body = await response.json() as TouchDesignerCaseLibrary;

    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(body.totals).toMatchObject({ modules: 10, cases: 23, versions: 83, parsedVersions: 83, backupVersions: 52 });
    expect(body.issues).toEqual([]);
  });

  it("serves only a valid generated structure identifier", async () => {
    const raw = await readFile(path.join(process.cwd(), "data", "touchdesigner", "posters-cases.generated.json"), "utf8");
    const manifest = JSON.parse(raw) as TouchDesignerCaseLibrary;
    const structureId = manifest.modules[0].cases[0].versions.find(({ structureId: id }) => id)?.structureId;
    expect(structureId).toBeTruthy();

    const response = await getStructure(new Request("http://localhost/api/touchdesigner-cases/example"), { params: Promise.resolve({ structureId: structureId! }) });
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe(structureId);

    const invalid = await getStructure(new Request("http://localhost/api/touchdesigner-cases/.."), { params: Promise.resolve({ structureId: "../secret" }) });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: "案例结构编号无效" });
  });
});
