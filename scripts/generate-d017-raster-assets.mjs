import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const root = process.cwd();
const assets = [
  {
    source: "digital-interaction-proposal-board-preset.svg",
    output: "d017-proposal-before-preset.png",
  },
  {
    source: "digital-interaction-three-states-preset.svg",
    output: "d017-three-states-after-preset.png",
  },
];

const results = [];
for (const asset of assets) {
  const sourcePath = path.join(root, "public", "demo", asset.source);
  const outputPath = path.join(root, "public", "demo", asset.output);
  const metadata = await sharp(sourcePath)
    .png({ compressionLevel: 9, palette: true, colours: 16, dither: 0 })
    .toFile(outputPath);
  const bytes = await readFile(outputPath);
  results.push({
    source: asset.source,
    output: asset.output,
    width: metadata.width,
    height: metadata.height,
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
