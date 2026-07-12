import { expect, test } from "@playwright/test";

test("renders the docs home page with primary navigation and actions", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Scanveil" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Docs navigation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "GitHub App をインストール" })).toHaveAttribute(
    "href",
    "https://github.com/apps/scanveil-app/installations/new",
  );
  await expect(page.getByRole("link", { name: "Management Console を開く" })).toHaveAttribute(
    "href",
    "https://console.scanveil.kexi.dev/login",
  );
});

test("navigates between docs pages from the sidebar", async ({ page }) => {
  await page.goto("/");

  const docsNavigation = page.getByRole("complementary", { name: "Docs navigation" });
  await expect(docsNavigation).toBeVisible();

  const pages = [
    { heading: "Getting Started", label: "Getting Started" },
    { heading: ".scanveil/config.yml", label: "設定" },
    { heading: "PR Checks", label: "PR Checks" },
    { heading: "Security Model", label: "Security Model" },
    { heading: "Notes", label: "Notes" },
  ] as const;

  for (const docsPage of pages) {
    await docsNavigation.getByRole("link", { name: docsPage.label }).click();
    await expect(page.getByRole("heading", { level: 1, name: docsPage.heading })).toBeVisible();
  }
});
