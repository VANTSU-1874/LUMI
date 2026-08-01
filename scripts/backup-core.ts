import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

export type BackupFile = { path: string; size: number; sha256: string };
export type BackupManifest = {
  version: 1;
  createdAt: string;
  directories: string[];
  files: BackupFile[];
};

export const BACKUP_LIMITS = {
  manifestBytes: 16 * 1024 * 1024,
  directories: 10_000,
  files: 10_000,
  singleFileBytes: 8 * 1024 * 1024 * 1024,
  totalFileBytes: 64 * 1024 * 1024 * 1024,
} as const;

type CopyTreeBudget = {
  directories: number;
  files: number;
  singleFileBytes: number;
  totalFileBytes: number;
};

const DEFAULT_COPY_TREE_BUDGET: CopyTreeBudget = {
  directories: BACKUP_LIMITS.directories,
  files: BACKUP_LIMITS.files + 2,
  singleFileBytes: BACKUP_LIMITS.singleFileBytes,
  totalFileBytes: BACKUP_LIMITS.totalFileBytes + BACKUP_LIMITS.manifestBytes + 1_024,
};

export class BackupSafetyError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "BackupSafetyError";
  }
}

export function isUnc(value: string) {
  return /^(?:\\\\|\/\/)/.test(value);
}

export function samePath(left: string, right: string) {
  const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(path.resolve(left)) === normalize(path.resolve(right));
}

export function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function overlaps(left: string, right: string) {
  return samePath(left, right) || isInside(left, right) || isInside(right, left);
}

export async function assertCanonicalDirectory(rawPath: string, code = "BACKUP_BASE_INVALID") {
  if (!rawPath.trim() || isUnc(rawPath)) throw new BackupSafetyError(`${code}:UNC_OR_EMPTY`);
  const resolved = path.resolve(rawPath);
  if (samePath(resolved, path.parse(resolved).root)) throw new BackupSafetyError(`${code}:FILESYSTEM_ROOT`);
  const details = await lstat(resolved).catch(() => null);
  if (!details?.isDirectory() || details.isSymbolicLink()) throw new BackupSafetyError(`${code}:NOT_REAL_DIRECTORY`);
  const canonical = await realpath(resolved);
  if (!samePath(canonical, resolved)) throw new BackupSafetyError(`${code}:NON_CANONICAL`);
  return canonical;
}

async function hashFile(filePath: string) {
  return new Promise<string>((resolve, reject) => {
    const digest = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(digest.digest("hex")));
  });
}

export async function describeFile(filePath: string, relativePath: string): Promise<BackupFile> {
  const details = await lstat(filePath);
  if (!details.isFile() || details.isSymbolicLink() || details.size < 1) {
    throw new BackupSafetyError(`BACKUP_EMPTY_OR_UNSAFE_FILE:${relativePath}`);
  }
  if (details.size > BACKUP_LIMITS.singleFileBytes) {
    throw new BackupSafetyError(`BACKUP_FILE_LIMIT:${relativePath}`);
  }
  return {
    path: relativePath.split(path.sep).join("/"),
    size: details.size,
    sha256: await hashFile(filePath),
  };
}

export async function scanTree(
  root: string,
  prefix: string,
): Promise<{ directories: string[]; files: BackupFile[] }> {
  const directories = [prefix];
  const files: BackupFile[] = [];
  let totalFileBytes = 0;
  async function visit(current: string, relativeDirectory: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = path.posix.join(relativeDirectory, entry.name);
      const details = await lstat(absolute);
      if (details.isSymbolicLink()) throw new BackupSafetyError(`BACKUP_SOURCE_LINK:${relative}`);
      if (details.isDirectory()) {
        directories.push(relative);
        if (directories.length > BACKUP_LIMITS.directories) throw new BackupSafetyError("BACKUP_DIRECTORY_LIMIT");
        await visit(absolute, relative);
      } else if (details.isFile()) {
        const described = await describeFile(absolute, relative);
        files.push(described);
        if (files.length > BACKUP_LIMITS.files) throw new BackupSafetyError("BACKUP_FILE_COUNT_LIMIT");
        totalFileBytes += described.size;
        if (!Number.isSafeInteger(totalFileBytes) || totalFileBytes > BACKUP_LIMITS.totalFileBytes) {
          throw new BackupSafetyError("BACKUP_TOTAL_SIZE_LIMIT");
        }
      } else {
        throw new BackupSafetyError(`BACKUP_SOURCE_SPECIAL_FILE:${relative}`);
      }
    }
  }
  await visit(root, prefix);
  return { directories: directories.sort(), files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}

export async function sourceSnapshot(databasePath: string, evidenceRoot: string) {
  const database = await describeFile(databasePath, "database.sqlite");
  const evidence = await scanTree(evidenceRoot, "evidence");
  return { directories: evidence.directories, files: [database, ...evidence.files] };
}

export function snapshotsEqual(
  left: { directories: string[]; files: BackupFile[] },
  right: { directories: string[]; files: BackupFile[] },
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function copySnapshot(
  databasePath: string,
  evidenceRoot: string,
  destination: string,
  snapshot: { directories: string[]; files: BackupFile[] },
) {
  for (const relative of snapshot.directories) await mkdir(path.join(destination, ...relative.split("/")), { recursive: true });
  for (const entry of snapshot.files) {
    const source = entry.path === "database.sqlite"
      ? databasePath
      : path.join(evidenceRoot, ...entry.path.slice("evidence/".length).split("/"));
    const target = path.join(destination, ...entry.path.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

export async function restoredSnapshot(root: string) {
  const databasePath = path.join(root, "database.sqlite");
  const evidenceRoot = path.join(root, "evidence");
  return sourceSnapshot(databasePath, evidenceRoot);
}

export async function writeJsonExclusive(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export async function readManifest(filePath: string): Promise<BackupManifest> {
  let parsed: unknown;
  try {
    const details = await lstat(filePath);
    if (!details.isFile() || details.isSymbolicLink() || details.size < 1 ||
      details.size > BACKUP_LIMITS.manifestBytes) {
      throw new BackupSafetyError("BACKUP_MANIFEST_LIMIT");
    }
    const bytes = await readFile(filePath, "utf8");
    if (!bytes.trim()) throw new Error("empty");
    parsed = JSON.parse(bytes);
  } catch (error) {
    if (error instanceof BackupSafetyError) throw error;
    throw new BackupSafetyError("BACKUP_MANIFEST_INVALID");
  }
  if (!parsed || typeof parsed !== "object") throw new BackupSafetyError("BACKUP_MANIFEST_INVALID");
  const manifest = parsed as Partial<BackupManifest>;
  if (manifest.version !== 1 || typeof manifest.createdAt !== "string" ||
    !Array.isArray(manifest.directories) || !Array.isArray(manifest.files) ||
    !manifest.directories.includes("evidence")) {
    throw new BackupSafetyError("BACKUP_MANIFEST_INVALID");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(manifest.createdAt) ||
    Number.isNaN(Date.parse(manifest.createdAt)) || new Date(manifest.createdAt).toISOString() !== manifest.createdAt) {
    throw new BackupSafetyError("BACKUP_MANIFEST_INVALID");
  }
  if (manifest.directories.length > BACKUP_LIMITS.directories || manifest.files.length > BACKUP_LIMITS.files) {
    throw new BackupSafetyError("BACKUP_MANIFEST_LIMIT");
  }
  const validRelative = (value: string) => value.length > 0 && !value.includes("\\") &&
    !/[\u0000-\u001f]/.test(value) && !path.posix.isAbsolute(value) &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  if (manifest.directories.some((entry) => typeof entry !== "string" || !validRelative(entry)) ||
    manifest.files.some((entry) => !entry || typeof entry.path !== "string" || !validRelative(entry.path) ||
      !Number.isSafeInteger(entry.size) || entry.size < 1 || !/^[a-f0-9]{64}$/.test(entry.sha256))) {
    throw new BackupSafetyError("BACKUP_MANIFEST_INVALID");
  }
  const paths = manifest.files.map((entry) => entry.path);
  const directories = manifest.directories as string[];
  const totalSize = manifest.files.reduce((sum, entry) => sum + entry.size, 0);
  if (new Set(paths).size !== paths.length || new Set(directories).size !== directories.length ||
    !paths.includes("database.sqlite")) {
    throw new BackupSafetyError("BACKUP_MANIFEST_INVALID");
  }
  const allPaths = [...directories, ...paths];
  const caseFoldedPaths = allPaths.map((entry) => entry.normalize("NFC").toLocaleLowerCase("en-US"));
  if (new Set(caseFoldedPaths).size !== caseFoldedPaths.length) {
    throw new BackupSafetyError("BACKUP_MANIFEST_CASE_COLLISION");
  }
  if (directories.some((entry) => entry !== "evidence" && !entry.startsWith("evidence/")) ||
    paths.some((entry) => entry !== "database.sqlite" && !entry.startsWith("evidence/"))) {
    throw new BackupSafetyError("BACKUP_MANIFEST_INVALID");
  }
  const directorySet = new Set(directories.map((entry) => entry.normalize("NFC").toLocaleLowerCase("en-US")));
  const hasDeclaredParent = (entry: string) => {
    const parent = path.posix.dirname(entry).normalize("NFC").toLocaleLowerCase("en-US");
    return parent === "." || directorySet.has(parent);
  };
  if (directories.some((entry) => entry !== "evidence" && !hasDeclaredParent(entry)) ||
    paths.some((entry) => entry !== "database.sqlite" && !hasDeclaredParent(entry))) {
    throw new BackupSafetyError("BACKUP_MANIFEST_INVALID");
  }
  if (manifest.files.some((entry) => entry.size > BACKUP_LIMITS.singleFileBytes) ||
    !Number.isSafeInteger(totalSize) || totalSize > BACKUP_LIMITS.totalFileBytes) {
    throw new BackupSafetyError("BACKUP_MANIFEST_LIMIT");
  }
  return manifest as BackupManifest;
}

export async function copyDirectoryContentsWithoutLinks(
  source: string,
  destination: string,
  budget: CopyTreeBudget = DEFAULT_COPY_TREE_BUDGET,
) {
  let directoryCount = 0;
  let fileCount = 0;
  let totalFileBytes = 0;
  async function visit(currentSource: string, currentDestination: string) {
    const entries = await readdir(currentSource, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const sourcePath = path.join(currentSource, entry.name);
      const destinationPath = path.join(currentDestination, entry.name);
      const details = await lstat(sourcePath);
      if (details.isSymbolicLink()) throw new BackupSafetyError(`BACKUP_LINK:${entry.name}`);
      if (details.isDirectory()) {
        directoryCount += 1;
        if (directoryCount > budget.directories) throw new BackupSafetyError("BACKUP_COPY_DIRECTORY_LIMIT");
        await mkdir(destinationPath);
        await visit(sourcePath, destinationPath);
      } else if (details.isFile()) {
        fileCount += 1;
        totalFileBytes += details.size;
        if (fileCount > budget.files) throw new BackupSafetyError("BACKUP_COPY_FILE_COUNT_LIMIT");
        if (details.size < 1 || details.size > budget.singleFileBytes) {
          throw new BackupSafetyError(`BACKUP_COPY_FILE_SIZE_LIMIT:${entry.name}`);
        }
        if (!Number.isSafeInteger(totalFileBytes) || totalFileBytes > budget.totalFileBytes) {
          throw new BackupSafetyError("BACKUP_COPY_TOTAL_SIZE_LIMIT");
        }
        await copyFile(sourcePath, destinationPath, 0);
      } else {
        throw new BackupSafetyError(`BACKUP_SPECIAL_FILE:${entry.name}`);
      }
    }
  }
  await visit(source, destination);
}

export async function copyDirectoryWithoutLinks(source: string, destination: string) {
  await mkdir(destination, { recursive: false });
  await copyDirectoryContentsWithoutLinks(source, destination);
}

export async function assertRegularNonEmptyFile(filePath: string, code: string) {
  const details = await stat(filePath).catch(() => null);
  if (!details?.isFile() || details.size < 1) throw new BackupSafetyError(code);
}
