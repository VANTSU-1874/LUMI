import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import { gunzipSync } from "node:zlib";
import path from "node:path";

const LEGACY_CORPUS_FIXTURE = path.join(
  "tests",
  "fixtures",
  "knowledge-v2-generations",
  "82db9093",
  "knowledge-corpus.v2.json.gz",
);

export const LEGACY_KNOWLEDGE_V2_GENERATION = Object.freeze({
  bundleHash:
    "82db90934afaffa3d227b6b0d11ab5efdb88009fd8b9274845567de4888079f8",
  nodeCount: 1702,
  relationCount: 1586,
  fixtureBytes: 325_580,
  fixtureSha256:
    "4cd05d38b45b5aba2e13af3e8edceaf25a3b23b731ce44007d7b2866accd66b0",
});

export const CURRENT_KNOWLEDGE_V2_GENERATION = Object.freeze({
  bundleHash:
    "d1d399c1790baba6820c874ab82483d9abae96fd22cd3fb16985a4d373b67cfc",
  nodeCount: 1704,
  relationCount: 1588,
});

export function assertKnowledgeV2EvaluationGeneration(
  corpusBundleHash: string,
  evaluationBundleHash: string,
) {
  if (corpusBundleHash !== evaluationBundleHash) {
    throw new Error(
      "KNOWLEDGE_V2_EVALUATION_GENERATION_MIX_FORBIDDEN:"
      + `${evaluationBundleHash}:${corpusBundleHash}`,
    );
  }
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function fixturePath(workspaceRoot = process.cwd()) {
  return path.join(workspaceRoot, LEGACY_CORPUS_FIXTURE);
}

function verifyFixtureBytes(bytes: Uint8Array) {
  if (
    bytes.byteLength !== LEGACY_KNOWLEDGE_V2_GENERATION.fixtureBytes
    || sha256(bytes)
      !== LEGACY_KNOWLEDGE_V2_GENERATION.fixtureSha256
  ) {
    throw new Error("LEGACY_KNOWLEDGE_V2_FIXTURE_DRIFT");
  }
}

export function legacyKnowledgeCorpusBytes(
  workspaceRoot = process.cwd(),
) {
  const fixture = readFileSync(fixturePath(workspaceRoot));
  verifyFixtureBytes(fixture);
  return gunzipSync(fixture);
}

export function loadLegacyKnowledgeCorpusV2(
  workspaceRoot = process.cwd(),
) {
  const corpus = JSON.parse(
    legacyKnowledgeCorpusBytes(workspaceRoot).toString("utf8"),
  ) as { bundleHash?: unknown; objects?: unknown[] };
  if (
    corpus.bundleHash
      !== LEGACY_KNOWLEDGE_V2_GENERATION.bundleHash
    || !Array.isArray(corpus.objects)
  ) {
    throw new Error("LEGACY_KNOWLEDGE_V2_CORPUS_IDENTITY_INVALID");
  }
  return corpus;
}

export async function materializeLegacyKnowledgeCorpusV2(
  target: string,
  workspaceRoot = process.cwd(),
) {
  const fixture = await readFile(fixturePath(workspaceRoot));
  verifyFixtureBytes(fixture);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, gunzipSync(fixture));
}

export async function createLegacyKnowledgeEvaluationWorkspace(
  workspaceRoot = process.cwd(),
) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "lumi-k10-legacy-evaluation-"),
  );
  const source = path.join(workspaceRoot, "tests", "retrieval-quality");
  const target = path.join(root, "tests", "retrieval-quality");
  await mkdir(target, { recursive: true });
  const names = (await readdir(source, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map(({ name }) => name);
  await Promise.all(names.map((name) =>
    copyFile(path.join(source, name), path.join(target, name))));
  const corpusTarget = path.join(
    root,
    "data",
    "knowledge-v2",
    "knowledge-corpus.v2.json",
  );
  await mkdir(path.dirname(corpusTarget), { recursive: true });
  await materializeLegacyKnowledgeCorpusV2(corpusTarget, workspaceRoot);
  return root;
}
