import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { z } from "zod";

import { createDb } from "../lib/db/client";
import { runMigrations } from "../lib/db/migrate";
import {
  StrictReviewPackSchema,
  type StrictReviewPack,
} from "../lib/domain/inspiration-wiki/review-pack-contracts";
import {
  calculateReviewPackMaterialHash,
  persistStrictReviewPack,
  type ReviewPackStoredAsset,
} from "../lib/services/inspiration-wiki-review-packs";

const AssetInputSchema = z.object({
  mediaId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,95}$/),
  file: z.string().regex(/^assets\/[a-z0-9][a-z0-9.-]{2,120}$/),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
}).strict();
const PackageSchema = z.object({
  schemaVersion: z.literal("lumi-inspiration-review-pack-import/v1"),
  batchId: z.string().regex(/^[a-z0-9][a-z0-9-]{7,95}$/),
  items: z.array(z.object({
    pack: z.record(z.string(), z.unknown()),
    assets: z.array(AssetInputSchema).min(1).max(20),
  }).strict()).min(1).max(30),
}).strict();

const argumentsList = process.argv.slice(2).filter((value) => value !== "--");

function argument(name: string) {
  const index = argumentsList.indexOf(name);
  return index === -1 ? undefined : argumentsList[index + 1];
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function prepareAssets(
  packageDirectory: string,
  databasePath: string,
  pack: StrictReviewPack,
  inputs: z.infer<typeof AssetInputSchema>[],
) {
  const packSlug = pack.reviewPackId.replace(/^review-pack:/, "");
  const dataRoot = path.dirname(databasePath);
  const destinationDirectory = path.join(dataRoot, "inspiration-wiki", "review-packs", "assets", packSlug);
  await mkdir(destinationDirectory, { recursive: true });
  const assets: ReviewPackStoredAsset[] = [];

  for (const input of inputs) {
    const media = pack.mediaGroup.find((item) => item.mediaId === input.mediaId);
    if (!media) throw new Error(`REVIEW_PACK_MEDIA_NOT_DECLARED:${input.mediaId}`);
    const sourcePath = path.resolve(packageDirectory, input.file);
    if (!sourcePath.startsWith(`${packageDirectory}${path.sep}`)) throw new Error("REVIEW_PACK_SOURCE_PATH_INVALID");
    const bytes = await readFile(sourcePath);
    const digest = sha256(bytes);
    if (digest !== media.sha256) throw new Error(`REVIEW_PACK_MEDIA_HASH_MISMATCH:${input.mediaId}`);
    const metadata = await sharp(bytes).metadata();
    if (metadata.width !== media.width || metadata.height !== media.height) {
      throw new Error(`REVIEW_PACK_MEDIA_DIMENSION_MISMATCH:${input.mediaId}`);
    }

    const extension = input.mimeType === "image/jpeg" ? "jpg" : input.mimeType.split("/")[1];
    const destinationPath = path.join(destinationDirectory, `${input.mediaId}.${extension}`);
    try {
      const existing = await readFile(destinationPath);
      if (sha256(existing) !== digest) throw new Error(`REVIEW_PACK_MEDIA_DESTINATION_CONFLICT:${input.mediaId}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await copyFile(sourcePath, destinationPath);
    }
    assets.push({
      mediaId: input.mediaId,
      storagePath: path.posix.join("inspiration-wiki", "review-packs", "assets", packSlug, `${input.mediaId}.${extension}`),
      mimeType: input.mimeType,
      bytes: bytes.byteLength,
      sha256: digest,
    });
  }
  return assets;
}

async function main() {
  const packageArgument = argumentsList.find((value) => !value.startsWith("--") && value !== argument("--database"));
  if (!packageArgument || packageArgument.startsWith("--")) {
    throw new Error("Usage: pnpm inspiration:review-packs:import -- <package-directory> [--database <sqlite-path>]");
  }
  const packageDirectory = path.resolve(packageArgument);
  const databasePath = path.resolve(argument("--database") ?? process.env.DATABASE_PATH ?? "./data/tonggan.sqlite");
  const input = PackageSchema.parse(JSON.parse(await readFile(path.join(packageDirectory, "review-packs.json"), "utf8")));

  runMigrations(databasePath);
  const connection = createDb(databasePath);
  try {
    const results = [];
    for (const item of input.items) {
      const material = item.pack as unknown as Omit<StrictReviewPack, "materialHash">;
      const pack = StrictReviewPackSchema.parse({
        ...material,
        materialHash: calculateReviewPackMaterialHash(material),
      });
      const assets = await prepareAssets(packageDirectory, databasePath, pack, item.assets);
      results.push(persistStrictReviewPack(connection, pack, assets));
    }
    const boundary = connection.sqlite.prepare(
      `SELECT count(*) AS total,
        sum(CASE WHEN teacher_private = 1 AND student_visible = 0
          AND current_page = 'DISABLED' AND r2 = 'DISABLED'
          AND embedding = 'DISABLED' AND lumi_retrieval = 'DISABLED'
          THEN 1 ELSE 0 END) AS private_count
       FROM inspiration_wiki_review_packs`,
    ).get() as { total: number; private_count: number };
    if (boundary.total !== boundary.private_count) throw new Error("REVIEW_PACK_PRIVATE_BOUNDARY_VIOLATED");
    process.stdout.write(`${JSON.stringify({
      ok: true,
      batchId: input.batchId,
      results,
      totalReviewPacks: boundary.total,
      studentVisible: false,
      disabledCapabilities: ["CURRENT_PAGE", "R2", "EMBEDDING", "LUMI_RETRIEVAL"],
    }, null, 2)}\n`);
  } finally {
    connection.sqlite.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "REVIEW_PACK_IMPORT_FAILED" })}\n`);
  process.exitCode = 1;
});
