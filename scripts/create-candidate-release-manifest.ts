import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
} from "node:url";

import {
  buildCandidateReleaseManifest,
  parseCandidateReleaseArguments,
  CANDIDATE_RELEASE_SESSION_COMPATIBILITY_FILES,
  type CandidateSurfaceFile,
} from "@/lib/operations/candidate-release-manifest";
import {
  CANDIDATE_RELEASE_SOURCE_BASELINE_COMMIT,
  fingerprintProductionSurfaceFile,
  PRODUCTION_SURFACE_BASELINE_RECEIPT_PATH,
  verifyProductionSurfaceBaselineReceipt,
} from "@/lib/operations/production-surface-baseline";

const defaultWorkspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

type CommandResult = {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
};

function canonicalJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function runCommand(
  command: string,
  args: readonly string[],
  workspaceRoot: string,
  acceptedExitCodes: readonly number[] = [0],
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: workspaceRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      reject(new Error(
        `CANDIDATE_RELEASE_COMMAND_FAILED:${command}:${error.message}`,
      ));
    });
    child.on("close", (code) => {
      const exitCode = code ?? -1;
      const result = {
        code: exitCode,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      };
      if (!acceptedExitCodes.includes(exitCode)) {
        const detail = result.stderr.toString("utf8").trim() || `exit=${exitCode}`;
        reject(new Error(
          `CANDIDATE_RELEASE_COMMAND_FAILED:${command}:${detail}`,
        ));
        return;
      }
      resolve(result);
    });
  });
}

async function readDeclaredPnpmVersion(workspaceRoot: string) {
  const packageJson = JSON.parse(
    await readFile(path.join(workspaceRoot, "package.json"), "utf8"),
  ) as { packageManager?: unknown };
  const value = typeof packageJson.packageManager === "string"
    ? packageJson.packageManager
    : "";
  const matched = /^pnpm@(\d+\.\d+\.\d+)$/.exec(value);
  if (!matched) throw new Error("CANDIDATE_RELEASE_PNPM_VERSION_UNDECLARED");
  return matched[1];
}

export async function readGitExportedFile(
  commit: string,
  filePath: string,
  workspaceRoot: string,
) {
  // The release is produced by `git archive`, which applies checkout/export
  // filters. A raw blob can therefore differ only by line endings while the
  // exported artifact is byte-identical to production.
  const result = await runCommand(
    "git",
    ["cat-file", "--filters", `${commit}:${filePath}`],
    workspaceRoot,
  );
  return result.stdout;
}

async function readGitSurfaceFiles(
  commit: string,
  workspaceRoot: string,
) {
  return Promise.all(
    CANDIDATE_RELEASE_SESSION_COMPATIBILITY_FILES.map(async (filePath) => {
      const value = await readGitExportedFile(commit, filePath, workspaceRoot);
      const fingerprint: CandidateSurfaceFile =
        fingerprintProductionSurfaceFile(filePath, value);
      return fingerprint;
    }),
  );
}

async function readArchiveSurfaceFiles(
  archivePath: string,
  workspaceRoot: string,
) {
  return Promise.all(
    CANDIDATE_RELEASE_SESSION_COMPATIBILITY_FILES.map(async (filePath) => {
      const result = await runCommand(
        "tar",
        ["-xOf", archivePath, filePath],
        workspaceRoot,
      );
      const fingerprint: CandidateSurfaceFile =
        fingerprintProductionSurfaceFile(filePath, result.stdout);
      return fingerprint;
    }),
  );
}

function assertSurfaceParity(
  baseline: readonly CandidateSurfaceFile[],
  actual: readonly CandidateSurfaceFile[],
  source: "SOURCE" | "ARCHIVE",
) {
  for (let index = 0; index < baseline.length; index += 1) {
    const expected = baseline[index];
    const candidate = actual[index];
    if (
      !expected
      || !candidate
      || expected.path !== candidate.path
      || expected.bytes !== candidate.bytes
      || expected.sha256 !== candidate.sha256
    ) {
      throw new Error(
        `CANDIDATE_RELEASE_${source}_SURFACE_CHANGED:${expected?.path ?? candidate?.path ?? "UNKNOWN"}`,
      );
    }
  }
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function preserveRejectedAttempt(
  incompleteRoot: string,
  candidateRoot: string,
  input: { attemptId: string; sourceCommit: string },
  error: unknown,
) {
  const rejectedRoot = path.join(candidateRoot, "rejected");
  await mkdir(rejectedRoot, { recursive: true });
  const rejectedPath = path.join(
    rejectedRoot,
    `${input.attemptId}-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  const message = error instanceof Error ? error.message : "UNKNOWN";
  await writeFile(
    path.join(incompleteRoot, "rejection.json"),
    canonicalJson({
      schemaVersion: 1,
      kind: "LUMI_CANDIDATE_RELEASE_REJECTION",
      status: "REJECTED",
      attemptId: input.attemptId,
      sourceCommit: input.sourceCommit,
      error: message,
      rejectedAt: new Date().toISOString(),
    }),
    { flag: "wx" },
  );
  await rename(incompleteRoot, rejectedPath);
  return rejectedPath;
}

export async function createCandidateReleaseManifest(
  input: {
    sourceCommit: string;
    attemptId: string;
  },
  options: { workspaceRoot?: string } = {},
) {
  const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot;
  const candidateRoot = path.join(workspaceRoot, ".runtime", "candidate-release");
  const attemptRoot = path.join(candidateRoot, input.attemptId);

  // Every fail-closed compatibility check before this boundary is read-only.
  await runCommand(
    "git",
    ["rev-parse", "--verify", `${input.sourceCommit}^{commit}`],
    workspaceRoot,
  );
  await runCommand(
    "git",
    [
      "rev-parse",
      "--verify",
      `${CANDIDATE_RELEASE_SOURCE_BASELINE_COMMIT}^{commit}`,
    ],
    workspaceRoot,
  );
  const ancestry = await runCommand(
    "git",
    [
      "merge-base",
      "--is-ancestor",
      CANDIDATE_RELEASE_SOURCE_BASELINE_COMMIT,
      input.sourceCommit,
    ],
    workspaceRoot,
    [0, 1],
  );
  if (ancestry.code !== 0) {
    throw new Error("CANDIDATE_RELEASE_SOURCE_BASELINE_NOT_ANCESTOR");
  }
  if (await pathExists(attemptRoot)) {
    throw new Error("CANDIDATE_RELEASE_ATTEMPT_EXISTS");
  }

  const receipt = verifyProductionSurfaceBaselineReceipt(JSON.parse(
    await readFile(
      path.join(workspaceRoot, PRODUCTION_SURFACE_BASELINE_RECEIPT_PATH),
      "utf8",
    ),
  ));
  const candidateSourceSurfaceFiles = await readGitSurfaceFiles(
    input.sourceCommit,
    workspaceRoot,
  );
  assertSurfaceParity(
    receipt.files,
    candidateSourceSurfaceFiles,
    "SOURCE",
  );
  const pnpmVersion = await readDeclaredPnpmVersion(workspaceRoot);

  await mkdir(candidateRoot, { recursive: true });
  const incompleteRoot = path.join(
    candidateRoot,
    `.incomplete-${input.attemptId}-${randomUUID()}`,
  );
  await mkdir(incompleteRoot);
  const archivePath = path.join(incompleteRoot, "candidate.tar");
  const manifestPath = path.join(incompleteRoot, "release-manifest.json");

  try {
    await runCommand(
      "git",
      [
        "archive",
        "--format=tar",
        `--output=${archivePath}`,
        input.sourceCommit,
      ],
      workspaceRoot,
    );
    const archive = await stat(archivePath);
    const listed = await runCommand("tar", ["-tf", archivePath], workspaceRoot);
    const archiveEntries = listed.stdout.toString("utf8").split(/\r?\n/);
    const candidateArchiveSurfaceFiles = await readArchiveSurfaceFiles(
      archivePath,
      workspaceRoot,
    );
    assertSurfaceParity(
      receipt.files,
      candidateArchiveSurfaceFiles,
      "ARCHIVE",
    );
    const manifest = buildCandidateReleaseManifest({
      attemptId: input.attemptId,
      sourceCommit: input.sourceCommit,
      archiveSha256: await sha256File(archivePath),
      archiveBytes: archive.size,
      archiveEntries,
      nodeVersion: process.version,
      pnpmVersion,
      sourceBaselineRelationship: "ANCESTOR",
      productionSurfaceBaselineReceipt: receipt,
      candidateSourceSurfaceFiles,
      candidateArchiveSurfaceFiles,
    });
    await writeFile(manifestPath, canonicalJson(manifest), { flag: "wx" });
    await rename(incompleteRoot, attemptRoot);
    return {
      attemptRoot,
      archivePath: path.join(attemptRoot, "candidate.tar"),
      manifestPath: path.join(attemptRoot, "release-manifest.json"),
      manifest,
    } as const;
  } catch (error) {
    const rejectedPath = await preserveRejectedAttempt(
      incompleteRoot,
      candidateRoot,
      input,
      error,
    );
    const message = error instanceof Error ? error.message : "UNKNOWN";
    throw new Error(`${message}:REJECTED_PATH=${rejectedPath}`);
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  const parsed = parseCandidateReleaseArguments(process.argv.slice(2));
  createCandidateReleaseManifest(parsed)
    .then(({ archivePath, manifest, manifestPath }) => {
      console.log(JSON.stringify({
        ok: true,
        status: manifest.status,
        attemptId: manifest.attemptId,
        sourceCommit: manifest.sourceCommit,
        sourceBaselineCommit: manifest.sourceBaseline.commit,
        sourceBaselineRelationship: manifest.sourceBaseline.relationship,
        productionBaselineReleaseId:
          manifest.productionSurfaceBaseline.receipt.releaseId,
        productionBaselineReceiptSha256:
          manifest.productionSurfaceBaseline.receipt.receiptSha256,
        studentEntryAuthParity: manifest.studentEntryAuthParity.status,
        archivePath: path.relative(defaultWorkspaceRoot, archivePath).replaceAll("\\", "/"),
        archiveSha256: manifest.archive.sha256,
        manifestPath: path.relative(defaultWorkspaceRoot, manifestPath).replaceAll("\\", "/"),
        bindingSha256: manifest.bindingSha256,
      }));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "CANDIDATE_RELEASE_FAILED");
      process.exitCode = 1;
    });
}
