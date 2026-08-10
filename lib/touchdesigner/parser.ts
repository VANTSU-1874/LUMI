import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type {
  TouchDesignerEdgeSnapshot,
  TouchDesignerFamily,
  TouchDesignerNetworkSnapshot,
  TouchDesignerNodeSnapshot,
  TouchDesignerStructure,
  TouchDesignerVersionDiff,
} from "./types";

const SUPPORTED_FAMILIES = new Set(["TOP", "CHOP", "SOP", "COMP", "MAT", "DAT", "POP"]);
const PARAMETER_NOISE = /^(pageindex|w|h|resizecomp|repocomp|border|parentshortcut|clone|ext\d|opviewer|viewer|display|pickable|render|cooktype|nodecolorr|nodecolorg|nodecolorb)/i;
const IMPORTANT_PARAMETER = /(instance|input|output|top$|sop$|chop$|file|resolution|res|rows|cols|tx$|ty$|tz$|r$|g$|b$|amp|period|gain|offset|rotate|scale|translate|feedback|noise|font|text)/i;
const EXPRESSION_MARKER = /(absTime|me\.|op\(|parent\(|chop\(|curTime|python|expr)/i;
const WINDOWS_FILE_PATH = /[a-z]:[\\/][^"\r\n]*?\.(?:png|jpe?g|gif|tiff?|webp|svg|mov|mp4|mkv|avi|wav|mp3|toe|tox|ply|exr|hdr|txt|csv|json)(?=["\s]|$)/gi;

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRelative(value: string) {
  return value.split(path.sep).join("/").replace(/^\.\//, "");
}

async function listFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) output.push(target);
    }
  }
  await visit(root);
  return output;
}

function parsePosition(lines: string[]) {
  const tile = lines.find((line) => line.startsWith("tile "))?.trim().split(/\s+/).slice(1).map(Number);
  if (tile && tile.length >= 4 && tile.every(Number.isFinite)) return { x: tile[0], y: tile[1], width: tile[2], height: tile[3] };
  const view = lines.find((line) => line.startsWith("v "))?.trim().split(/\s+/).slice(1).map(Number);
  if (view && view.length >= 2 && view.slice(0, 2).every(Number.isFinite)) return { x: view[0], y: view[1], width: 120, height: 80 };
  return { x: 0, y: 0, width: 120, height: 80 };
}

function parseInputs(lines: string[]) {
  const start = lines.findIndex((line) => line.trim() === "inputs");
  if (start < 0) return [];
  const inputs: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line === "{") continue;
    if (line === "}" || line === "end") break;
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (match) inputs[Number(match[1])] = match[2].trim().replace(/^"|"$/g, "");
  }
  return inputs;
}

function parseParameterLines(content: string) {
  return content.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "?") return [];
    const match = trimmed.match(/^(\S+)\s+\d+\s+(.*)$/);
    return match ? [{ name: match[1], value: redactLocalFilePaths(match[2].replace(/^\uFEFF/, "")).slice(0, 240) }] : [];
  });
}

function redactLocalFilePaths(value: string) {
  return value.replace(WINDOWS_FILE_PATH, (localPath) => `[本地文件]/${localPath.split(/[\\/]/).at(-1) ?? "素材"}`);
}

function parameterPreview(parameters: Array<{ name: string; value: string }>) {
  return [...parameters]
    .filter(({ name }) => !PARAMETER_NOISE.test(name))
    .sort((left, right) => {
      const leftScore = Number(EXPRESSION_MARKER.test(left.value)) * 4 + Number(IMPORTANT_PARAMETER.test(left.name)) * 2;
      const rightScore = Number(EXPRESSION_MARKER.test(right.value)) * 4 + Number(IMPORTANT_PARAMETER.test(right.name)) * 2;
      return rightScore - leftScore || left.name.localeCompare(right.name, "zh-CN");
    })
    .slice(0, 10);
}

function annotationFrom(parameters: Array<{ name: string; value: string }>) {
  const title = parameters.find(({ name }) => name.toLowerCase() === "titletext")?.value ?? "";
  const body = parameters.find(({ name }) => name.toLowerCase() === "bodytext")?.value ?? "";
  if (!title && !body) return null;
  return {
    title: title.replace(/^\uFEFF/, "").replace(/^"|"$/g, ""),
    body: body.replace(/^\uFEFF/, "").replace(/^"|"$/g, ""),
  };
}

function resolveInputPath(networkPath: string, source: string) {
  const normalized = source.replace(/\\/g, "/");
  if (normalized.startsWith("/")) return normalized.slice(1);
  return path.posix.normalize(path.posix.join(networkPath, normalized));
}

export async function parseExpandedTouchDesignerProject(expandedRoot: string): Promise<TouchDesignerStructure> {
  const info = await stat(expandedRoot).catch(() => null);
  if (!info?.isDirectory()) throw new Error("展开后的 TouchDesigner 工程目录不存在");
  const files = await listFiles(expandedRoot);
  const nodeFiles = files.filter((file) => file.endsWith(".n"));
  const nodes: TouchDesignerNodeSnapshot[] = [];

  for (const nodeFile of nodeFiles) {
    const relative = normalizeRelative(path.relative(expandedRoot, nodeFile));
    if (relative === "local.n" || relative === "perform.n" || relative.startsWith("local/") || relative.startsWith("perform/")) continue;
    const raw = await readFile(nodeFile, "utf8");
    const lines = raw.split(/\r?\n/);
    const familyMatch = lines[0]?.trim().match(/^([^:]+):(.+)$/);
    if (!familyMatch) continue;
    const family = (SUPPORTED_FAMILIES.has(familyMatch[1]) ? familyMatch[1] : "OTHER") as TouchDesignerFamily;
    const operatorType = familyMatch[2].trim();
    const nodePath = relative.slice(0, -2);
    const networkPath = path.posix.dirname(nodePath) === "." ? "" : path.posix.dirname(nodePath);
    const name = path.posix.basename(nodePath);
    const parmFile = nodeFile.slice(0, -2) + ".parm";
    const parmRaw = await readFile(parmFile, "utf8").catch(() => "");
    const parameters = parseParameterLines(parmRaw);
    const position = parsePosition(lines);
    nodes.push({
      id: nodePath,
      path: nodePath,
      name,
      family,
      operatorType,
      networkPath,
      ...position,
      inputs: parseInputs(lines),
      parameters: parameterPreview(parameters),
      parameterCount: parameters.length,
      signature: digest(`${raw}\n${parmRaw}`),
      annotation: operatorType === "annotate" ? annotationFrom(parameters) : null,
    });
  }

  nodes.sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
  const nodePaths = new Set(nodes.map(({ path: nodePath }) => nodePath));
  const edges: TouchDesignerEdgeSnapshot[] = [];
  for (const node of nodes) {
    node.inputs.forEach((input, inputIndex) => {
      if (!input) return;
      const source = resolveInputPath(node.networkPath, input);
      if (!nodePaths.has(source)) return;
      edges.push({ id: `${source}->${node.path}:${inputIndex}`, source, target: node.path, inputIndex, networkPath: node.networkPath });
    });
  }

  const networks = new Map<string, TouchDesignerNetworkSnapshot>();
  for (const node of nodes) {
    const current = networks.get(node.networkPath) ?? { path: node.networkPath, label: node.networkPath || "工程入口", nodeIds: [], edgeIds: [], annotationCount: 0 };
    current.nodeIds.push(node.id);
    if (node.annotation) current.annotationCount += 1;
    networks.set(node.networkPath, current);
  }
  for (const edge of edges) networks.get(edge.networkPath)?.edgeIds.push(edge.id);
  const familyCounts: TouchDesignerStructure["familyCounts"] = {};
  for (const node of nodes) familyCounts[node.family] = (familyCounts[node.family] ?? 0) + 1;
  const identity = nodes.map((node) => `${node.path}|${node.signature}`).join("\n");
  const id = digest(identity || "empty-touchdesigner-project");
  return {
    id,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    familyCounts,
    nodes,
    edges,
    networks: [...networks.values()].sort((left, right) => right.annotationCount - left.annotationCount || right.nodeIds.length - left.nodeIds.length || left.path.localeCompare(right.path, "zh-CN")),
  };
}

export function diffTouchDesignerStructures(previous: TouchDesignerStructure | null, current: TouchDesignerStructure | null): TouchDesignerVersionDiff | null {
  if (!previous || !current) return null;
  const before = new Map(previous.nodes.map((node) => [node.path, node]));
  const after = new Map(current.nodes.map((node) => [node.path, node]));
  const addedNodes = [...after.keys()].filter((nodePath) => !before.has(nodePath));
  const removedNodes = [...before.keys()].filter((nodePath) => !after.has(nodePath));
  const changedNodes = [...after.entries()].filter(([nodePath, node]) => before.has(nodePath) && before.get(nodePath)?.signature !== node.signature).map(([nodePath]) => nodePath);
  return {
    added: addedNodes.length,
    removed: removedNodes.length,
    changed: changedNodes.length,
    addedNodes: addedNodes.slice(0, 12),
    removedNodes: removedNodes.slice(0, 12),
    changedNodes: changedNodes.slice(0, 12),
  };
}
