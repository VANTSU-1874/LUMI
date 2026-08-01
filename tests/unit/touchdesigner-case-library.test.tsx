import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TouchDesignerCaseLibrary } from "@/components/student/TouchDesignerCaseLibrary";
import type { TouchDesignerCaseLibrary as CaseLibrary, TouchDesignerStructure } from "@/lib/touchdesigner/types";

afterEach(cleanup);

const firstStructureId = "a".repeat(64);
const mainStructureId = "b".repeat(64);
const manifest: CaseLibrary = {
  schemaVersion: 1,
  generatedAt: "2026-07-13T08:00:00.000Z",
  sourceLabel: "1、posters",
  totals: { modules: 1, cases: 1, versions: 2, parsedVersions: 2, backupVersions: 1, duplicateVersions: 0, structures: 2 },
  modules: [{
    id: "module-1",
    sequence: 1,
    title: "粒子交互",
    cases: [{
      id: "case-1",
      moduleId: "module-1",
      title: "图片粒子效果",
      relativeFolder: "粒子交互/图片粒子效果",
      activeVersionId: "version-main",
      versions: [
        { id: "version-backup", label: "备份 01", fileLabel: "particle.1.toe", kind: "BACKUP", origin: "FILE", relativePath: "Backup/particle.1.toe", modifiedAt: "2026-07-01T08:00:00.000Z", sizeBytes: 100, structureId: firstStructureId, status: "PARSED", issue: null, duplicateOfVersionId: null, diffFromPrevious: null },
        { id: "version-main", label: "主工程", fileLabel: "particle.toe", kind: "PRIMARY", origin: "FILE", relativePath: "particle.toe", modifiedAt: "2026-07-02T08:00:00.000Z", sizeBytes: 200, structureId: mainStructureId, status: "PARSED", issue: null, duplicateOfVersionId: null, diffFromPrevious: { added: 1, removed: 0, changed: 1, addedNodes: ["project1/level1"], removedNodes: [], changedNodes: ["project1/noise1"] } },
      ],
    }],
  }],
  issues: [],
};

function structure(id: string, includeLevel: boolean): TouchDesignerStructure {
  const nodes: TouchDesignerStructure["nodes"] = [{ id: "project1/noise1", path: "project1/noise1", name: "noise1", family: "TOP", operatorType: "noise", networkPath: "project1", x: 20, y: 20, width: 120, height: 80, inputs: [], parameters: [{ name: "amp", value: "2.5" }], parameterCount: 1, annotation: null }];
  if (includeLevel) nodes.push({ id: "project1/level1", path: "project1/level1", name: "level1", family: "TOP", operatorType: "level", networkPath: "project1", x: 220, y: 20, width: 120, height: 80, inputs: ["noise1"], parameters: [{ name: "brightness", value: "1.2" }], parameterCount: 1, annotation: null });
  nodes.push({ id: "project1/bloom/level2", path: "project1/bloom/level2", name: "level2", family: "TOP", operatorType: "level", networkPath: "project1/bloom", x: 20, y: 20, width: 120, height: 80, inputs: [], parameters: [], parameterCount: 0, annotation: null });
  const edges = includeLevel ? [{ id: "project1/noise1->project1/level1:0", source: "project1/noise1", target: "project1/level1", inputIndex: 0, networkPath: "project1" }] : [];
  return { id, nodeCount: nodes.length, edgeCount: edges.length, familyCounts: { TOP: nodes.length }, nodes, edges, networks: [
    { path: "project1/bloom", label: "project1/bloom", nodeIds: ["project1/bloom/level2"], edgeIds: [], annotationCount: 0 },
    { path: "project1", label: "project1", nodeIds: nodes.filter(({ networkPath }) => networkPath === "project1").map((node) => node.id), edgeIds: edges.map((edge) => edge.id), annotationCount: 0 },
  ] };
}

function structureWithNetworks(id: string, networkPaths: string[]): TouchDesignerStructure {
  const nodes = networkPaths.map((networkPath, index) => ({ id: `${networkPath}/node${index + 1}`, path: `${networkPath}/node${index + 1}`, name: `node${index + 1}`, family: "TOP" as const, operatorType: "level", networkPath, x: 20, y: 20, width: 120, height: 80, inputs: [], parameters: [], parameterCount: 0, annotation: null }));
  return { id, nodeCount: nodes.length, edgeCount: 0, familyCounts: { TOP: nodes.length }, nodes, edges: [], networks: nodes.map((node) => ({ path: node.networkPath, label: node.networkPath, nodeIds: [node.id], edgeIds: [], annotationCount: 0 })) };
}

function denseStructure(id: string): TouchDesignerStructure {
  const annotation: TouchDesignerStructure["nodes"][number] = { id: "project1/annotate1", path: "project1/annotate1", name: "annotate1", family: "COMP", operatorType: "annotate", networkPath: "project1", x: 0, y: 0, width: 500, height: 500, inputs: [], parameters: [], parameterCount: 0, annotation: { title: "矩阵位置", body: "调用 tx 与 ty" } };
  const functionalNodes: TouchDesignerStructure["nodes"] = Array.from({ length: 8 }, (_, index) => ({ id: `project1/node${index + 1}`, path: `project1/node${index + 1}`, name: `node${index + 1}`, family: "TOP", operatorType: "level", networkPath: "project1", x: 20, y: 20, width: 120, height: 80, inputs: index ? [`node${index}`] : [], parameters: [], parameterCount: 0, annotation: null }));
  const edges: TouchDesignerStructure["edges"] = functionalNodes.slice(1).map((node, index) => ({ id: `${functionalNodes[index].id}->${node.id}:0`, source: functionalNodes[index].id, target: node.id, inputIndex: 0, networkPath: "project1" }));
  const nodes = [annotation, ...functionalNodes];
  return { id, nodeCount: nodes.length, edgeCount: edges.length, familyCounts: { COMP: 1, TOP: functionalNodes.length }, nodes, edges, networks: [{ path: "project1", label: "project1", nodeIds: nodes.map(({ id: nodeId }) => nodeId), edgeIds: edges.map(({ id: edgeId }) => edgeId), annotationCount: 1 }] };
}

function interleavedTeachingStructure(id: string): TouchDesignerStructure {
  const nodes: TouchDesignerStructure["nodes"] = [
    { id: "project1/constant1", path: "project1/constant1", name: "constant1", family: "TOP", operatorType: "constant", networkPath: "project1", x: 0, y: 0, width: 120, height: 80, inputs: [], parameters: [], parameterCount: 0, annotation: null },
    { id: "project1/comp1", path: "project1/comp1", name: "comp1", family: "TOP", operatorType: "comp", networkPath: "project1", x: 225, y: 0, width: 120, height: 80, inputs: ["constant1"], parameters: [], parameterCount: 0, annotation: null },
    { id: "project1/noise1", path: "project1/noise1", name: "noise1", family: "TOP", operatorType: "noise", networkPath: "project1", x: 450, y: 0, width: 120, height: 80, inputs: [], parameters: [], parameterCount: 0, annotation: null },
    { id: "project1/out1", path: "project1/out1", name: "out1", family: "TOP", operatorType: "out", networkPath: "project1", x: 675, y: 0, width: 120, height: 80, inputs: ["comp1"], parameters: [], parameterCount: 0, annotation: null },
  ];
  const edges: TouchDesignerStructure["edges"] = [
    { id: "constant1->comp1:0", source: "project1/constant1", target: "project1/comp1", inputIndex: 0, networkPath: "project1" },
    { id: "comp1->out1:0", source: "project1/comp1", target: "project1/out1", inputIndex: 0, networkPath: "project1" },
  ];
  return { id, nodeCount: nodes.length, edgeCount: edges.length, familyCounts: { TOP: nodes.length }, nodes, edges, networks: [{ path: "project1", label: "project1", nodeIds: nodes.map(({ id: nodeId }) => nodeId), edgeIds: edges.map(({ id: edgeId }) => edgeId), annotationCount: 0 }] };
}

describe("TouchDesignerCaseLibrary", () => {
  it("loads a real version on demand, compares it and exposes node parameters", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === "/api/touchdesigner-cases") return new Response(JSON.stringify(manifest), { status: 200 });
      if (target.endsWith(mainStructureId)) return new Response(JSON.stringify(structure(mainStructureId, true)), { status: 200 });
      if (target.endsWith(firstStructureId)) return new Response(JSON.stringify(structure(firstStructureId, false)), { status: 200 });
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });

    render(<TouchDesignerCaseLibrary fetchImpl={fetchImpl as typeof fetch} />);

    expect(await screen.findByRole("heading", { name: "版本化案例库" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "图片粒子效果" })).toBeInTheDocument();
    const networkSelector = await screen.findByLabelText("选择工程网络");
    expect(within(networkSelector).getAllByRole("button")).toHaveLength(1);
    expect(within(networkSelector).getByRole("button", { name: /^project1/ })).toBeInTheDocument();
    expect(within(networkSelector).queryByRole("button", { name: /bloom/ })).not.toBeInTheDocument();
    const diff = screen.getByLabelText("版本差异");
    expect(within(diff).getByText("新增")).toBeInTheDocument();
    expect(within(diff).getAllByText("1")).toHaveLength(2);
    fireEvent.click(await screen.findByRole("button", { name: "TOP level1 level" }));
    expect(screen.getByRole("heading", { name: "level1" })).toBeInTheDocument();
    expect(screen.getAllByText("级别调整").length).toBeGreaterThan(0);
    expect(screen.getByText("调整亮度、对比度、透明度或颜色范围。")).toBeInTheDocument();
    expect(screen.getByText("亮度")).toBeInTheDocument();
    expect(screen.getByText("brightness")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "备份 01：particle.1.toe" }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith(`/api/touchdesigner-cases/${firstStructureId}`, expect.any(Object)));
    expect(await screen.findByText("这是当前时间线的起点，用它作为后续版本比较的基线。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /交互式粒子实验/ })).not.toBeInTheDocument();
  });

  it("zooms the network with the wheel and lets learners drag nodes with connected edges", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === "/api/touchdesigner-cases") return new Response(JSON.stringify(manifest), { status: 200 });
      return new Response(JSON.stringify(structure(mainStructureId, true)), { status: 200 });
    });

    render(<TouchDesignerCaseLibrary fetchImpl={fetchImpl as typeof fetch} />);

    const canvas = await screen.findByLabelText("TouchDesigner网络：project1");
    const zoomStatus = screen.getByLabelText("画布缩放比例");
    expect(zoomStatus).toHaveTextContent("100%");
    fireEvent.wheel(canvas, { clientX: 180, clientY: 160, deltaY: -100 });
    expect(zoomStatus).toHaveTextContent("112%");

    canvas.scrollLeft = 180;
    canvas.scrollTop = 140;
    fireEvent.pointerDown(canvas, { button: 2, clientX: 260, clientY: 220, pointerId: 9 });
    fireEvent.pointerUp(canvas, { clientX: 260, clientY: 220, pointerId: 9 });
    expect(fireEvent.contextMenu(canvas)).toBe(true);
    fireEvent.pointerDown(canvas, { button: 2, clientX: 260, clientY: 220, pointerId: 8 });
    fireEvent.pointerMove(canvas, { clientX: 190, clientY: 170, pointerId: 8 });
    fireEvent.pointerUp(canvas, { clientX: 190, clientY: 170, pointerId: 8 });
    expect(fireEvent.contextMenu(canvas)).toBe(false);
    expect(canvas.scrollLeft).toBe(250);
    expect(canvas.scrollTop).toBe(190);

    const node = screen.getByRole("button", { name: "TOP noise1 noise" });
    const edge = canvas.querySelector("svg path");
    expect(edge).not.toBeNull();
    const initialLeft = node.style.left;
    const initialEdge = edge?.getAttribute("d");
    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100, pointerId: 7 });
    fireEvent.pointerMove(node, { clientX: 190, clientY: 150, pointerId: 7 });
    fireEvent.pointerUp(node, { clientX: 190, clientY: 150, pointerId: 7 });
    expect(node.style.left).not.toBe(initialLeft);
    expect(edge?.getAttribute("d")).not.toBe(initialEdge);

    fireEvent.click(screen.getByRole("button", { name: "复位节点画布" }));
    expect(zoomStatus).toHaveTextContent("100%");
    expect(node.style.left).toBe(initialLeft);
    expect(canvas.scrollLeft).toBe(0);
    expect(canvas.scrollTop).toBe(0);
  });

  it("automatically separates dense nodes and turns annotations into background regions", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === "/api/touchdesigner-cases") return new Response(JSON.stringify(manifest), { status: 200 });
      return new Response(JSON.stringify(denseStructure(mainStructureId)), { status: 200 });
    });

    render(<TouchDesignerCaseLibrary fetchImpl={fetchImpl as typeof fetch} />);

    const canvas = await screen.findByLabelText("TouchDesigner网络：project1");
    expect(within(canvas).queryByRole("button", { name: "COMP annotate1 annotate" })).not.toBeInTheDocument();
    expect(within(canvas).getByLabelText("原工程注释：矩阵位置")).toBeInTheDocument();
    expect(within(canvas).getByText("原工程注释")).toBeInTheDocument();
    const nodeButtons = within(canvas).getAllByRole("button");
    expect(nodeButtons).toHaveLength(8);
    const rectangles = nodeButtons.map((node) => ({ left: Number.parseFloat(node.style.left), top: Number.parseFloat(node.style.top) }));
    rectangles.forEach((current, currentIndex) => rectangles.slice(currentIndex + 1).forEach((next) => {
      expect(Math.abs(current.left - next.left) >= 128 || Math.abs(current.top - next.top) >= 66).toBe(true);
    }));
    const orderedTops = rectangles.map(({ top }) => top).sort((left, right) => left - right);
    orderedTops.slice(1).forEach((top, index) => expect(top - orderedTops[index]).toBeGreaterThanOrEqual(160));

    const firstNode = nodeButtons[0];
    const initialLeft = firstNode.style.left;
    const initialTop = firstNode.style.top;
    fireEvent.pointerDown(firstNode, { button: 0, clientX: 100, clientY: 100, pointerId: 21 });
    fireEvent.pointerMove(firstNode, { clientX: 180, clientY: 145, pointerId: 21 });
    fireEvent.pointerUp(firstNode, { clientX: 180, clientY: 145, pointerId: 21 });
    expect(firstNode.style.left === initialLeft && firstNode.style.top === initialTop).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "自动整理节点" }));
    expect(firstNode.style.left).toBe(initialLeft);
    expect(firstNode.style.top).toBe(initialTop);
  });

  it("adds clearly sourced teaching groups when the original project has no annotations", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === "/api/touchdesigner-cases") return new Response(JSON.stringify(manifest), { status: 200 });
      return new Response(JSON.stringify(structure(mainStructureId, true)), { status: 200 });
    });

    render(<TouchDesignerCaseLibrary fetchImpl={fetchImpl as typeof fetch} />);

    const canvas = await screen.findByLabelText("TouchDesigner网络：project1");
    expect(within(canvas).getByLabelText("教学分组：输入与素材")).toBeInTheDocument();
    expect(within(canvas).getByLabelText("教学分组：结果与输出")).toBeInTheDocument();
    expect(within(canvas).getAllByText("教学分组 · 系统整理").length).toBeGreaterThan(0);
    expect(within(canvas).getByText(/这些节点产生或读取图像、声音、数值与几何/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "显示教学分组" }));
    expect(within(canvas).queryByLabelText("教学分组：输入与素材")).not.toBeInTheDocument();
    expect(within(canvas).queryByLabelText("教学分组：结果与输出")).not.toBeInTheDocument();
  });

  it("moves interleaved teaching groups apart instead of drawing overlapping annotation frames", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === "/api/touchdesigner-cases") return new Response(JSON.stringify(manifest), { status: 200 });
      return new Response(JSON.stringify(interleavedTeachingStructure(mainStructureId)), { status: 200 });
    });

    render(<TouchDesignerCaseLibrary fetchImpl={fetchImpl as typeof fetch} />);

    const canvas = await screen.findByLabelText("TouchDesigner网络：project1");
    const frames = within(canvas).getAllByLabelText(/^(教学分组|原工程注释)：/).map((frame) => ({
      height: Number.parseFloat(frame.style.height),
      width: Number.parseFloat(frame.style.width),
      x: Number.parseFloat(frame.style.left),
      y: Number.parseFloat(frame.style.top),
    }));
    frames.forEach((current, currentIndex) => frames.slice(currentIndex + 1).forEach((next) => {
      const overlapWidth = Math.max(0, Math.min(current.x + current.width, next.x + next.width) - Math.max(current.x, next.x));
      const overlapHeight = Math.max(0, Math.min(current.y + current.height, next.y + next.height) - Math.max(current.y, next.y));
      expect(overlapWidth * overlapHeight).toBe(0);
    }));
  });

  it("hides project1 inherited from the previous lesson in 1.1.2", async () => {
    const lessonManifest: CaseLibrary = {
      ...manifest,
      modules: [{ ...manifest.modules[0], cases: [{ ...manifest.modules[0].cases[0], title: "1.1.2声音驱动画面" }] }],
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === "/api/touchdesigner-cases") return new Response(JSON.stringify(lessonManifest), { status: 200 });
      return new Response(JSON.stringify(structureWithNetworks(mainStructureId, ["project1", "project2", "project3"])), { status: 200 });
    });

    render(<TouchDesignerCaseLibrary fetchImpl={fetchImpl as typeof fetch} />);

    const selector = await screen.findByLabelText("选择工程网络");
    expect(within(selector).queryByRole("button", { name: /^project1/ })).not.toBeInTheDocument();
    expect(within(selector).getByRole("button", { name: /^project2/ })).toBeInTheDocument();
    expect(within(selector).getByRole("button", { name: /^project3/ })).toBeInTheDocument();
  });

  it("uses container1 as the actual entry network for the water bubble lesson", async () => {
    const lessonManifest: CaseLibrary = {
      ...manifest,
      modules: [{ ...manifest.modules[0], cases: [{ ...manifest.modules[0].cases[0], title: "1.2.3水流气泡质感" }] }],
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === "/api/touchdesigner-cases") return new Response(JSON.stringify(lessonManifest), { status: 200 });
      return new Response(JSON.stringify(structureWithNetworks(mainStructureId, ["container1", "project1", "project2"])), { status: 200 });
    });

    render(<TouchDesignerCaseLibrary fetchImpl={fetchImpl as typeof fetch} />);

    const selector = await screen.findByLabelText("选择工程网络");
    expect(within(selector).getAllByRole("button")).toHaveLength(1);
    expect(within(selector).getByRole("button", { name: /^container1/ })).toBeInTheDocument();
    expect(within(selector).queryByRole("button", { name: /^project/ })).not.toBeInTheDocument();
  });

  it("shows only project4 for the random pixel lesson", async () => {
    const lessonManifest: CaseLibrary = {
      ...manifest,
      modules: [{ ...manifest.modules[0], cases: [{ ...manifest.modules[0].cases[0], title: "1.1.3随机像素生成" }] }],
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === "/api/touchdesigner-cases") return new Response(JSON.stringify(lessonManifest), { status: 200 });
      return new Response(JSON.stringify(structureWithNetworks(mainStructureId, ["project1", "project2", "project3", "project4"])), { status: 200 });
    });

    render(<TouchDesignerCaseLibrary fetchImpl={fetchImpl as typeof fetch} />);

    const selector = await screen.findByLabelText("选择工程网络");
    expect(within(selector).getAllByRole("button")).toHaveLength(1);
    expect(within(selector).getByRole("button", { name: /^project4/ })).toBeInTheDocument();
    expect(within(selector).queryByRole("button", { name: /^project[123]/ })).not.toBeInTheDocument();
  });

  it("shows only project2 for the line displacement lesson", async () => {
    const lessonManifest: CaseLibrary = {
      ...manifest,
      modules: [{ ...manifest.modules[0], cases: [{ ...manifest.modules[0].cases[0], title: "1.2.2线条错位扭曲" }] }],
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === "/api/touchdesigner-cases") return new Response(JSON.stringify(lessonManifest), { status: 200 });
      return new Response(JSON.stringify(structureWithNetworks(mainStructureId, ["project1", "project2"])), { status: 200 });
    });

    render(<TouchDesignerCaseLibrary fetchImpl={fetchImpl as typeof fetch} />);

    const selector = await screen.findByLabelText("选择工程网络");
    expect(within(selector).getAllByRole("button")).toHaveLength(1);
    expect(within(selector).getByRole("button", { name: /^project2/ })).toBeInTheDocument();
    expect(within(selector).queryByRole("button", { name: /^project1/ })).not.toBeInTheDocument();
  });

  it("shows only project4 for the dynamic glass lesson", async () => {
    const lessonManifest: CaseLibrary = {
      ...manifest,
      modules: [{ ...manifest.modules[0], cases: [{ ...manifest.modules[0].cases[0], title: "1.2.4动态玻璃扭曲" }] }],
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === "/api/touchdesigner-cases") return new Response(JSON.stringify(lessonManifest), { status: 200 });
      return new Response(JSON.stringify(structureWithNetworks(mainStructureId, ["project1", "project2", "project3", "project4"])), { status: 200 });
    });

    render(<TouchDesignerCaseLibrary fetchImpl={fetchImpl as typeof fetch} />);

    const selector = await screen.findByLabelText("选择工程网络");
    expect(within(selector).getAllByRole("button")).toHaveLength(1);
    expect(within(selector).getByRole("button", { name: /^project4/ })).toBeInTheDocument();
    expect(within(selector).queryByRole("button", { name: /^project[123]/ })).not.toBeInTheDocument();
  });

  it("shows only project2 for the contour heatmap lesson", async () => {
    const lessonManifest: CaseLibrary = {
      ...manifest,
      modules: [{ ...manifest.modules[0], cases: [{ ...manifest.modules[0].cases[0], title: "1.3.2 等高热力图" }] }],
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === "/api/touchdesigner-cases") return new Response(JSON.stringify(lessonManifest), { status: 200 });
      return new Response(JSON.stringify(structureWithNetworks(mainStructureId, ["project1", "project2"])), { status: 200 });
    });

    render(<TouchDesignerCaseLibrary fetchImpl={fetchImpl as typeof fetch} />);

    const selector = await screen.findByLabelText("选择工程网络");
    expect(within(selector).getAllByRole("button")).toHaveLength(1);
    expect(within(selector).getByRole("button", { name: /^project2/ })).toBeInTheDocument();
    expect(within(selector).queryByRole("button", { name: /^project1/ })).not.toBeInTheDocument();
  });

  it("shows only project4 for the infinite feedback lesson", async () => {
    const lessonManifest: CaseLibrary = {
      ...manifest,
      modules: [{ ...manifest.modules[0], cases: [{ ...manifest.modules[0].cases[0], title: "1.3 4无限反馈生成" }] }],
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === "/api/touchdesigner-cases") return new Response(JSON.stringify(lessonManifest), { status: 200 });
      return new Response(JSON.stringify(structureWithNetworks(mainStructureId, ["project1", "project2", "project3", "project4"])), { status: 200 });
    });

    render(<TouchDesignerCaseLibrary fetchImpl={fetchImpl as typeof fetch} />);

    const selector = await screen.findByLabelText("选择工程网络");
    expect(within(selector).getAllByRole("button")).toHaveLength(1);
    expect(within(selector).getByRole("button", { name: /^project4/ })).toBeInTheDocument();
    expect(within(selector).queryByRole("button", { name: /^project[123]/ })).not.toBeInTheDocument();
  });

  it("shows project3 as the actual entry for the mouse-follow stretch lesson", async () => {
    const lessonManifest: CaseLibrary = {
      ...manifest,
      modules: [{ ...manifest.modules[0], cases: [{ ...manifest.modules[0].cases[0], title: "1.3.3 鼠标跟随拉伸" }] }],
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const target = String(input);
      if (target === "/api/touchdesigner-cases") return new Response(JSON.stringify(lessonManifest), { status: 200 });
      return new Response(JSON.stringify(structureWithNetworks(mainStructureId, ["project1", "project2", "project3"])), { status: 200 });
    });

    render(<TouchDesignerCaseLibrary fetchImpl={fetchImpl as typeof fetch} />);

    const selector = await screen.findByLabelText("选择工程网络");
    expect(within(selector).getAllByRole("button")).toHaveLength(1);
    expect(within(selector).getByRole("button", { name: /^project3/ })).toBeInTheDocument();
    expect(within(selector).queryByRole("button", { name: /^project[12]/ })).not.toBeInTheDocument();
  });
});
