import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  deps: {
    neverBundle: ["vite"],
  },
  dts: false,
  entry: ["src/server.ts"],
  format: ["esm"],
  outDir: "dist/server",
  platform: "node",
});
