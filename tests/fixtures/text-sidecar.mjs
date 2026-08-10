import process from "node:process";
import readline from "node:readline";

const identity = JSON.parse(Buffer.from(process.argv[2], "base64url").toString("utf8"));
const behavior = process.argv[3] ?? "success";

process.stdout.write(`${JSON.stringify({
  v: 1,
  type: "ready",
  capabilities: ["TEXT_TO_TEXT"],
  identity,
  environment: {
    pythonVersion: "3.12.10",
    torchVersion: "2.7.1+cu128",
    transformersVersion: "4.53.1",
    safetensorsVersion: "0.5.3",
    tokenizerClassName: "BertTokenizerFast",
    actualDevice: "cpu",
    cudaRuntime: null,
    deviceName: null,
  },
})}\n`);

const lines = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

for await (const line of lines) {
  const request = JSON.parse(line);
  if (behavior === "exit") process.exit(17);
  if (behavior === "corrupt") {
    process.stdout.write("{not-json\n");
    continue;
  }
  const winner = {
    coursePackId: "layout-design",
    objectCount: 1,
    objectId: "layout-fixture",
    representationId: "text-rep-fixture",
    nodeId: "node-fixture",
    score: 0.91,
  };
  const diagnostics = behavior === "invalid-diagnostics"
    ? { packCompetition: { schemaVersion: 1 } }
    : {
        packCompetition: {
          schemaVersion: 1,
          scoreMetric: "COSINE_SIMILARITY",
          objectDeduplication: "BEST_REPRESENTATION_PER_OBJECT",
          packWinnerSelection: "BEST_OBJECT_PER_PACK",
          globalWinnerSelection: "BEST_PACK_WINNER",
          sourceScope: {
            coursePackId: request.query.coursePackId,
          },
          scoredRepresentationCount: 1,
          deduplicatedObjectCount: 1,
          perPackWinners: [winner],
          globalWinner: winner,
          scopedWinner: request.query.coursePackId === "layout-design" ? winner : null,
          globalToScopedMargin: request.query.coursePackId === "layout-design" ? 0 : null,
        },
      };
  process.stdout.write(`${JSON.stringify({
    v: 1,
    type: "result",
    id: request.id,
    status: "SUCCESS",
    reason: null,
    hits: [{
      representationId: "text-rep-fixture",
      nodeId: "node-fixture",
      objectId: "layout-fixture",
      coursePackId: request.query.coursePackId ?? "layout-design",
      rank: 1,
      score: 0.91,
      sourceKind: "NODE",
      nodeKind: "TEXT",
      role: "ACTION",
      contentHash: "c".repeat(64),
    }],
    index: identity,
    timing: {
      inferenceMs: 1,
      totalMs: 1,
    },
    diagnostics,
  })}\n`);
}
