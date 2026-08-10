// @vitest-environment node

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { diffTouchDesignerStructures, parseExpandedTouchDesignerProject } from "@/lib/touchdesigner/parser";

describe("TouchDesigner project parser", () => {
  let temporaryDirectory = "";

  afterEach(async () => {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("extracts nested nodes, connections, annotations and important parameters", async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "tonggan-td-parser-"));
    const project = path.join(temporaryDirectory, "project1");
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, "source1.n"), "TOP:moviefilein\ntile 10 20 120 80\n", "utf8");
    await writeFile(path.join(project, "source1.parm"), "file 0 \"X:/fixtures/course/lesson-image.jpg\"\n", "utf8");
    await writeFile(path.join(project, "noise1.n"), "TOP:noise\ntile 220 20 120 80\ninputs\n{\n0 source1\n}\n", "utf8");
    await writeFile(path.join(project, "noise1.parm"), "amp 0 2.5\ntranslate 0 op('control1')[0]\n", "utf8");
    await writeFile(path.join(project, "note1.n"), "COMP:annotate\ntile 20 180 160 90\n", "utf8");
    await writeFile(path.join(project, "note1.parm"), "titletext 0 \"素材动态化的关键\"\nbodytext 0 \"把颜色信号转为位置变化\"\n", "utf8");

    const structure = await parseExpandedTouchDesignerProject(temporaryDirectory);

    expect(structure.nodeCount).toBe(3);
    expect(structure.edgeCount).toBe(1);
    expect(structure.familyCounts).toEqual({ TOP: 2, COMP: 1 });
    expect(structure.edges[0]).toMatchObject({ source: "project1/source1", target: "project1/noise1", inputIndex: 0 });
    expect(structure.nodes.find(({ path: nodePath }) => nodePath === "project1/source1")?.parameters).toContainEqual({ name: "file", value: "\"[本地文件]/lesson-image.jpg\"" });
    expect(structure.nodes.find(({ path: nodePath }) => nodePath === "project1/noise1")?.parameters).toEqual(expect.arrayContaining([
      { name: "translate", value: "op('control1')[0]" },
      { name: "amp", value: "2.5" },
    ]));
    expect(structure.nodes.find(({ path: nodePath }) => nodePath === "project1/note1")?.annotation).toEqual({
      title: "素材动态化的关键",
      body: "把颜色信号转为位置变化",
    });
  });

  it("reports structural additions, removals and parameter changes between backups", async () => {
    const node = { id: "project1/source1", path: "project1/source1", name: "source1", family: "TOP" as const, operatorType: "moviefilein", networkPath: "project1", x: 0, y: 0, width: 120, height: 80, inputs: [], parameters: [], parameterCount: 0, annotation: null };
    const base = { id: "a", nodeCount: 2, edgeCount: 0, familyCounts: { TOP: 2 }, nodes: [{ ...node, signature: "old" }, { ...node, id: "project1/removed", path: "project1/removed", name: "removed", signature: "same" }], edges: [], networks: [] };
    const current = { id: "b", nodeCount: 2, edgeCount: 0, familyCounts: { TOP: 2 }, nodes: [{ ...node, signature: "new" }, { ...node, id: "project1/added", path: "project1/added", name: "added", signature: "same" }], edges: [], networks: [] };

    expect(diffTouchDesignerStructures(base, current)).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
      addedNodes: ["project1/added"],
      removedNodes: ["project1/removed"],
      changedNodes: ["project1/source1"],
    });
  });
});
