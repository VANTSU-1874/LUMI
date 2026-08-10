import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InteractiveCaseLab } from "@/components/student/InteractiveCaseLab";
import type { TouchDesignerCaseLibrary, TouchDesignerStructure } from "@/lib/touchdesigner/types";

const gradientStructureId = "d".repeat(64);
const soundStructureId = "e".repeat(64);

const manifest: TouchDesignerCaseLibrary = {
  schemaVersion: 1,
  generatedAt: "2026-07-14T00:00:00.000Z",
  sourceLabel: "1、posters",
  totals: { modules: 1, cases: 2, versions: 2, parsedVersions: 2, backupVersions: 0, duplicateVersions: 0, structures: 2 },
  modules: [{
    id: "module-1",
    sequence: 1,
    title: "1.1 平面几何",
    cases: [
      {
        id: "gradient",
        moduleId: "module-1",
        title: "1.1.1渐变颜色叠加示范",
        relativeFolder: "gradient",
        activeVersionId: "gradient-main",
        versions: [{ id: "gradient-main", label: "主工程", fileLabel: "gradient", kind: "PRIMARY", origin: "FILE", relativePath: "gradient.toe", modifiedAt: "2026-07-14T00:00:00.000Z", sizeBytes: 100, structureId: gradientStructureId, status: "PARSED", issue: null, duplicateOfVersionId: null, diffFromPrevious: null }],
      },
      {
        id: "sound",
        moduleId: "module-1",
        title: "1.1.2声音驱动画面",
        relativeFolder: "sound",
        activeVersionId: "sound-main",
        versions: [{ id: "sound-main", label: "主工程", fileLabel: "sound", kind: "PRIMARY", origin: "FILE", relativePath: "sound.toe", modifiedAt: "2026-07-14T00:00:00.000Z", sizeBytes: 100, structureId: soundStructureId, status: "PARSED", issue: null, duplicateOfVersionId: null, diffFromPrevious: null }],
      },
    ],
  }],
  issues: [],
};

function structure(id: string, audio: boolean): TouchDesignerStructure {
  const nodes: TouchDesignerStructure["nodes"] = audio ? [
    { id: "project2/audiodevin1", path: "project2/audiodevin1", name: "audiodevin1", family: "CHOP", operatorType: "audiodevin", networkPath: "project2", x: 0, y: 0, width: 120, height: 80, inputs: [], parameters: [{ name: "volume", value: "0.8" }], parameterCount: 1, annotation: null },
    { id: "project2/analyze1", path: "project2/analyze1", name: "analyze1", family: "CHOP", operatorType: "analyze", networkPath: "project2", x: 140, y: 0, width: 120, height: 80, inputs: ["audiodevin1"], parameters: [{ name: "period", value: "1.5" }], parameterCount: 1, annotation: null },
  ] : [
    { id: "project1/ramp1", path: "project1/ramp1", name: "ramp1", family: "TOP", operatorType: "ramp", networkPath: "project1", x: 0, y: 0, width: 120, height: 80, inputs: [], parameters: [{ name: "phase", value: "0.2" }, { name: "resolutionw", value: "512" }], parameterCount: 2, annotation: null },
    { id: "project1/level1", path: "project1/level1", name: "level1", family: "TOP", operatorType: "level", networkPath: "project1", x: 140, y: 0, width: 120, height: 80, inputs: ["ramp1"], parameters: [{ name: "brightness", value: "1.2" }], parameterCount: 1, annotation: null },
  ];
  return { id, nodeCount: nodes.length, edgeCount: 0, familyCounts: audio ? { CHOP: nodes.length } : { TOP: nodes.length }, nodes, edges: [], networks: [{ path: audio ? "project2" : "project1", label: audio ? "project2" : "project1", nodeIds: nodes.map(({ id: nodeId }) => nodeId), edgeIds: [], annotationCount: 0 }] };
}

describe("InteractiveCaseLab", () => {
  beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("keeps the node canvas distinct from the archive and makes every selected case interactive", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === "/api/touchdesigner-cases") return new Response(JSON.stringify(manifest), { status: 200 });
      if (target.endsWith(gradientStructureId)) return new Response(JSON.stringify(structure(gradientStructureId, false)), { status: 200 });
      if (target.endsWith(soundStructureId)) return new Response(JSON.stringify(structure(soundStructureId, true)), { status: 200 });
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });

    render(<InteractiveCaseLab fetchImpl={fetchImpl as typeof fetch} />);

    expect(await screen.findByRole("heading", { name: "实时节点实验台" })).toBeInTheDocument();
    expect(screen.queryByText("版本演进")).not.toBeInTheDocument();
    const directory = screen.getByLabelText("全部可交互案例");
    expect(within(directory).getAllByRole("button")).toHaveLength(2);
    expect(await screen.findByLabelText("1.1.1渐变颜色叠加示范实时交互效果")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/真实依据：TOP level1/)).toBeInTheDocument());
    fireEvent.change(screen.getByRole("slider", { name: "颜色叠加强度" }), { target: { value: "87" } });
    expect(screen.getByText("87")).toBeInTheDocument();

    fireEvent.click(within(directory).getByRole("button", { name: /1\.1\.2声音驱动画面/ }));
    expect(await screen.findByRole("heading", { name: "1.1.2声音驱动画面" })).toBeInTheDocument();
    expect(screen.getByLabelText("1.1.2声音驱动画面实时交互效果")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "输入声压" })).toBeInTheDocument();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith(`/api/touchdesigner-cases/${soundStructureId}`, expect.any(Object)));
  });
});
