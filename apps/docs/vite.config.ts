import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const docsRoot = fileURLToPath(new URL(".", import.meta.url));
const shouldUseE2eFirebase = process.env.SCANVEIL_ADMIN_E2E === "1";

export default defineConfig({
  build: {
    manifest: true,
    outDir: "dist",
    rollupOptions: {
      input: {
        admin: resolve(docsRoot, "admin.html"),
        main: resolve(docsRoot, "index.html"),
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@scanveil/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      ...(shouldUseE2eFirebase
        ? {
            "firebase/app": fileURLToPath(
              new URL("src/admin/firebase-e2e-app.ts", import.meta.url),
            ),
            "firebase/auth": fileURLToPath(
              new URL("src/admin/firebase-e2e-auth.ts", import.meta.url),
            ),
          }
        : {}),
    },
  },
});
