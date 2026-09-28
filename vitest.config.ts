import { defineConfig } from "vitest/config";

// Pure-function unit tests only (spider link-classification heuristics) —
// plain Node environment, no DOM, no DB.
export default defineConfig({
  test: {
    include: ["ingestion/**/*.test.ts"],
    passWithNoTests: true,
  },
});
