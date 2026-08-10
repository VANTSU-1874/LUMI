import { seedDemoDatabase } from "@/scripts/seed-demo";

const [databasePath, identityCodePepper, artworkRoot] = process.argv.slice(2);
if (!databasePath || !identityCodePepper || !artworkRoot) throw new Error("worker arguments missing");

seedDemoDatabase({ databasePath, artworkRoot, identityCodePepper, allowDemoSeed: true, nodeEnv: "test" })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? `${error.name}:${error.message}` : error);
    process.exitCode = 1;
  });
