import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@scanveil/auth": resolve(import.meta.dirname, "../../packages/auth/src/index.ts"),
      "@scanveil/core": resolve(import.meta.dirname, "../../packages/core/src/index.ts"),
      "@scanveil/github": resolve(import.meta.dirname, "../../packages/github/src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
