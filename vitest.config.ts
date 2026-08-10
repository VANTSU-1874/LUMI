import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(repositoryRoot),
    },
  },
  test: {
    environment: "jsdom",
    maxWorkers: 4,
    setupFiles: ["./tests/setup.ts"],
    exclude: ["tests/e2e/**", "**/node_modules/**", "**/.git/**", "**/.runtime/**"],
  },
});
