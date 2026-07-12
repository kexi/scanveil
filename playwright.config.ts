import { defineConfig, devices } from "@playwright/test";

const docsPort = 4173;
const consolePort = 4174;

export default defineConfig({
  expect: {
    timeout: 5000,
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  projects: [
    {
      name: "docs-chromium",
      testDir: "apps/docs/e2e",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${docsPort}`,
      },
    },
    {
      name: "console-chromium",
      testDir: "apps/console/e2e",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${consolePort}`,
      },
    },
  ],
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: `pnpm --filter @scanveil/docs exec vite --host 127.0.0.1 --port ${docsPort} --strictPort`,
      env: {
        SCANVEIL_ADMIN_E2E: "1",
      },
      reuseExistingServer: false,
      timeout: 120000,
      url: `http://127.0.0.1:${docsPort}`,
    },
    {
      command: "pnpm --filter @scanveil/console exec tsx e2e/fixtures/console-server.ts",
      env: {
        PORT: String(consolePort),
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
      url: `http://127.0.0.1:${consolePort}`,
    },
  ],
});
