import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  server: {
    host: "0.0.0.0",
  },
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
  },
});
