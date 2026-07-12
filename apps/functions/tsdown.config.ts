import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  deps: {
    alwaysBundle: [/^@scanveil\//],
    neverBundle: ["firebase-functions", "firebase-functions/v2/https"],
  },
  dts: false,
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
});
