import { createHash } from "node:crypto";
import readline from "node:readline";

const identity = JSON.parse(Buffer.from(process.argv[2], "base64url").toString("utf8"));
const assetId = process.argv[3];

process.stdout.write(`${JSON.stringify({
  v: 1,
  type: "ready",
  capabilities: [
    "TEXT_TO_IMAGE",
    "IMAGE_TO_IMAGE",
    "IMAGE_TEXT_TO_IMAGE",
    "NORMALIZED_REGIONS",
  ],
  identity,
})}\n`);

const lines = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.query.text === "hang") return;
  if (request.query.mode !== "TEXT_TO_IMAGE") {
    const image = Buffer.from(request.queryImage?.pngBase64 ?? "", "base64");
    if (
      request.queryImage?.assetId !== request.query.queryAssetId
      || createHash("sha256").update(image).digest("hex") !== request.queryImage?.sha256
    ) {
      process.exitCode = 2;
      process.stdin.destroy();
      return;
    }
  }
  process.stdout.write(`${JSON.stringify({
    v: 1,
    type: "result",
    id: request.id,
    status: "SUCCESS",
    reason: null,
    hits: [{
      assetId,
      rank: 1,
      score: 0.8,
      region: {
        coordinateSpace: "NORMALIZED",
        x: 0.038674,
        y: 0.203125,
        width: 0.453039,
        height: 0.390625,
        origin: "INDEXED_REGION",
      },
      representationId: "fixture-asset-one",
    }],
    index: identity,
    timing: {
      queueMs: 0,
      inferenceMs: 1,
      totalMs: 1,
    },
    diagnosticTiming: {
      encodeMs: 0.5,
      scoreMs: 0.5,
    },
  })}\n`);
});
