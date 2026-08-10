import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { diffTouchDesignerStructures, parseExpandedTouchDesignerProject } from "../lib/touchdesigner/parser";
import type {
  TouchDesignerCase,
  TouchDesignerCaseLibrary,
  TouchDesignerCaseVersion,
  TouchDesignerModule,
  TouchDesignerStructure,
} from "../lib/touchdesigner/types";

type SourceProject = {
  absolutePath: string;
  relativePath: string;
  modifiedAt: string;
  sizeBytes: number;
  origin: "FILE" | "ARCHIVE";
  archiveEntry: string | null;
};

type VersionDraft = SourceProject & {
  id: string;
  fileLabel: string;
  structure: TouchDesignerStructure | null;
  issue: string | null;
  fileHash: string;
};

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function stableId(prefix: string, value: string) {
  return `${prefix}-${createHash("sha1").update(value).digest("hex").slice(0, 12)}`;
}

function normalizeRelative(value: string) {
  return value.split(path.sep).join("/");
}

async function walk(root: string): Promise<string[]> {
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

function tarEntries(archive: string) {
  const result = spawnSync("tar", ["-tf", archive], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => /\.toe$/i.test(entry));
}

async function discoverProjects(sourceRoot: string): Promise<SourceProject[]> {
  const files = await walk(sourceRoot);
  const projects: SourceProject[] = [];
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (extension === ".toe") {
      const info = await stat(file);
      projects.push({ absolutePath: file, relativePath: normalizeRelative(path.relative(sourceRoot, file)), modifiedAt: info.mtime.toISOString(), sizeBytes: info.size, origin: "FILE", archiveEntry: null });
    }
    if (extension === ".zip") {
      const archiveInfo = await stat(file);
      for (const entry of tarEntries(file)) {
        projects.push({
          absolutePath: file,
          relativePath: `${normalizeRelative(path.relative(sourceRoot, file))}::${entry.replace(/\\/g, "/")}`,
          modifiedAt: archiveInfo.mtime.toISOString(),
          sizeBytes: archiveInfo.size,
          origin: "ARCHIVE",
          archiveEntry: entry,
        });
      }
    }
  }
  return projects.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));
}

function resolveToeExpand(explicit: string | undefined) {
  const candidates = [explicit, process.env.TOUCHDESIGNER_TOEEXPAND, "F:\\TouchDesigner\\bin\\toeexpand.exe"].filter(Boolean) as string[];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("未找到 toeexpand.exe，请通过 --toeexpand 指定 TouchDesigner 安装目录中的工具");
  return found;
}

async function materializeSource(source: SourceProject, cacheFolder: string) {
  const target = path.join(cacheFolder, "source.toe");
  if (existsSync(target)) return target;
  await mkdir(cacheFolder, { recursive: true });
  if (source.origin === "FILE") {
    await copyFile(source.absolutePath, target);
    return target;
  }
  if (!source.archiveEntry) throw new Error("压缩包工程缺少条目名称");
  const extractRoot = path.join(cacheFolder, "archive");
  await mkdir(extractRoot, { recursive: true });
  const extract = spawnSync("tar", ["-xf", source.absolutePath, "-C", extractRoot, source.archiveEntry], { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (extract.status !== 0) throw new Error(`无法从压缩包读取工程：${extract.stderr.trim() || source.archiveEntry}`);
  const extracted = path.join(extractRoot, ...source.archiveEntry.split(/[\\/]/));
  await copyFile(extracted, target);
  return target;
}

async function fileDigest(source: SourceProject) {
  if (source.origin === "FILE") return createHash("sha256").update(await readFile(source.absolutePath)).digest("hex");
  return createHash("sha256").update(`${source.absolutePath}\n${source.archiveEntry}\n${source.modifiedAt}`).digest("hex");
}

async function parseSource(source: SourceProject, toeexpand: string, cacheRoot: string, parsedByHash: Map<string, TouchDesignerStructure>) : Promise<VersionDraft> {
  const fileHash = await fileDigest(source);
  const id = stableId("td-version", source.relativePath);
  const fileLabel = path.basename(source.archiveEntry ?? source.absolutePath, ".toe");
  if (parsedByHash.has(fileHash)) return { ...source, id, fileLabel, fileHash, structure: parsedByHash.get(fileHash)!, issue: null };
  try {
    const cacheFolder = path.join(cacheRoot, fileHash.slice(0, 24));
    const materialized = await materializeSource(source, cacheFolder);
    const expanded = `${materialized}.dir`;
    if (!existsSync(expanded)) {
      const result = spawnSync(toeexpand, [materialized], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
      // TouchDesigner 2023 的 toeexpand 会把成功信息写入 stderr，并可能返回非零状态；
      // 目录是否真实生成才是可靠的成功判据。
      if (!existsSync(expanded)) throw new Error(result.stderr.trim() || result.stdout.trim() || "toeexpand 执行失败");
    }
    const structure = await parseExpandedTouchDesignerProject(expanded);
    parsedByHash.set(fileHash, structure);
    return { ...source, id, fileLabel, fileHash, structure, issue: null };
  } catch (error) {
    return { ...source, id, fileLabel, fileHash, structure: null, issue: error instanceof Error ? error.message : "工程解析失败" };
  }
}

function sourceSegments(relativePath: string) {
  return relativePath.split("::", 1)[0].split("/").filter(Boolean);
}

function isReferenceSource(relativePath: string) {
  const segments = sourceSegments(relativePath).slice(1, -1);
  return segments.some((segment) => /素材|视频|插件/.test(segment));
}

function groupIdentity(source: SourceProject) {
  const segments = sourceSegments(source.relativePath);
  const moduleTitle = segments[0] ?? "未分类";
  const second = segments[1];
  const caseSegment = !second || second.toLowerCase() === "backup" || /\.toe$/i.test(second) ? moduleTitle : second;
  return { moduleTitle, caseTitle: caseSegment, relativeFolder: caseSegment === moduleTitle ? moduleTitle : `${moduleTitle}/${caseSegment}` };
}

function isHistoryVersion(draft: VersionDraft) {
  return /(^|\/)backup(\/|$)/i.test(draft.relativePath.split("::", 1)[0]) || /\.\d+$/.test(draft.fileLabel);
}

function makeVersions(drafts: VersionDraft[], structures: Record<string, TouchDesignerStructure>) {
  const ordered = [...drafts].sort((left, right) => left.modifiedAt.localeCompare(right.modifiedAt) || left.relativePath.localeCompare(right.relativePath, "zh-CN"));
  const primaryDraft = [...ordered].reverse().find((draft) => !isHistoryVersion(draft)) ?? ordered.at(-1)!;
  let backupIndex = 0;
  let stageIndex = 0;
  const seenStructure = new Map<string, string>();
  let previousStructure: TouchDesignerStructure | null = null;
  return ordered.map((draft): TouchDesignerCaseVersion => {
    const history = isHistoryVersion(draft);
    const kind = draft.id === primaryDraft.id ? "PRIMARY" : history ? "BACKUP" : "STAGE";
    if (kind === "BACKUP") backupIndex += 1;
    if (kind === "STAGE") stageIndex += 1;
    const structureId = draft.structure?.id ?? null;
    if (draft.structure) structures[draft.structure.id] = draft.structure;
    const duplicateOfVersionId = structureId ? seenStructure.get(structureId) ?? null : null;
    const diffFromPrevious = diffTouchDesignerStructures(previousStructure, draft.structure);
    if (structureId && !seenStructure.has(structureId)) seenStructure.set(structureId, draft.id);
    if (draft.structure) previousStructure = draft.structure;
    return {
      id: draft.id,
      label: kind === "PRIMARY" ? "主工程" : kind === "BACKUP" ? `备份 ${String(backupIndex).padStart(2, "0")}` : `阶段 ${String(stageIndex).padStart(2, "0")}`,
      fileLabel: draft.fileLabel,
      kind,
      origin: draft.origin,
      relativePath: draft.relativePath,
      modifiedAt: draft.modifiedAt,
      sizeBytes: draft.sizeBytes,
      structureId,
      status: draft.structure ? "PARSED" : "UNREADABLE",
      issue: draft.issue,
      duplicateOfVersionId,
      diffFromPrevious,
    };
  });
}

async function main() {
  const sourceRoot = path.resolve(argument("--source") ?? "");
  if (!sourceRoot || !existsSync(sourceRoot)) throw new Error("请通过 --source 指定存在的 TouchDesigner 案例目录");
  const output = path.resolve(argument("--output") ?? path.join(process.cwd(), "data", "touchdesigner", "posters-cases.generated.json"));
  const toeexpand = resolveToeExpand(argument("--toeexpand"));
  const cacheRoot = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "ChuyingAI", "toe-import-cache");
  await mkdir(cacheRoot, { recursive: true });
  const sources = (await discoverProjects(sourceRoot)).filter((source) => !isReferenceSource(source.relativePath));
  const parsedByHash = new Map<string, TouchDesignerStructure>();
  const drafts: VersionDraft[] = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    process.stdout.write(`\r解析 TouchDesigner 工程 ${index + 1}/${sources.length}：${source.relativePath.slice(-54).padEnd(54)}`);
    drafts.push(await parseSource(source, toeexpand, cacheRoot, parsedByHash));
  }
  process.stdout.write("\n");

  const grouped = new Map<string, { moduleTitle: string; caseTitle: string; relativeFolder: string; drafts: VersionDraft[] }>();
  for (const draft of drafts) {
    const identity = groupIdentity(draft);
    const key = `${identity.moduleTitle}\u0000${identity.caseTitle}`;
    const current = grouped.get(key) ?? { ...identity, drafts: [] };
    current.drafts.push(draft);
    grouped.set(key, current);
  }
  const moduleTitles = [...new Set([...grouped.values()].map(({ moduleTitle }) => moduleTitle))].sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }));
  const structures: Record<string, TouchDesignerStructure> = {};
  const modules: TouchDesignerModule[] = moduleTitles.map((moduleTitle, moduleIndex) => {
    const moduleId = stableId("td-module", moduleTitle);
    const groups = [...grouped.values()].filter((group) => group.moduleTitle === moduleTitle).sort((left, right) => left.caseTitle.localeCompare(right.caseTitle, "zh-CN", { numeric: true }));
    const cases: TouchDesignerCase[] = groups.map((group) => {
      const versions = makeVersions(group.drafts, structures);
      const primary = versions.find(({ kind }) => kind === "PRIMARY") ?? versions.at(-1)!;
      return { id: stableId("td-case", group.relativeFolder), moduleId, title: group.caseTitle.replace(/_/g, " "), relativeFolder: group.relativeFolder, activeVersionId: primary.id, versions };
    });
    return { id: moduleId, sequence: moduleIndex + 1, title: moduleTitle.replace(/_/g, " "), cases };
  });
  const versions = modules.flatMap((module) => module.cases.flatMap((item) => item.versions));
  const issues = versions.filter(({ issue }) => issue).map(({ relativePath, issue }) => ({ relativePath, message: issue! }));
  const library: TouchDesignerCaseLibrary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceLabel: path.basename(sourceRoot),
    totals: {
      modules: modules.length,
      cases: modules.reduce((total, module) => total + module.cases.length, 0),
      versions: versions.length,
      parsedVersions: versions.filter(({ status }) => status === "PARSED").length,
      backupVersions: versions.filter(({ kind }) => kind === "BACKUP").length,
      duplicateVersions: versions.filter(({ duplicateOfVersionId }) => duplicateOfVersionId).length,
      structures: Object.keys(structures).length,
    },
    modules,
    issues,
  };
  await mkdir(path.dirname(output), { recursive: true });
  const structureFolder = path.join(path.dirname(output), "structures");
  await mkdir(structureFolder, { recursive: true });
  for (const structure of Object.values(structures)) {
    const publicStructure = {
      ...structure,
      nodes: structure.nodes.map((node) => {
        const publicNode = { ...node };
        delete publicNode.signature;
        return publicNode;
      }),
    };
    await writeFile(path.join(structureFolder, `${structure.id}.json`), JSON.stringify(publicStructure), "utf8");
  }
  await writeFile(output, `${JSON.stringify(library, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: true, output, structureFolder, totals: library.totals, issues: issues.length }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "TouchDesigner 案例导入失败");
  process.exitCode = 1;
});
