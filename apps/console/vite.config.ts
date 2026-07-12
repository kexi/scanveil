import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@scanveil/auth": fileURLToPath(new URL("../../packages/auth/src/index.ts", import.meta.url)),
      "@scanveil/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@scanveil/github": fileURLToPath(
        new URL("../../packages/github/src/index.ts", import.meta.url),
      ),
    },
  },
});
