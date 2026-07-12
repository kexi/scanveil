import { createHmac } from "node:crypto";

import { expect, test, type BrowserContext } from "@playwright/test";

const sessionCookieName = "scanveil_session";
const sessionSecret = "scanveil-console-e2e-secret";

test("redirects anonymous console users to the GitHub login page", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Scanveil" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in with GitHub" })).toHaveAttribute(
    "href",
    "/login?start=github",
  );
});

test("redirects signed-in users without invite access to the invite page", async ({
  context,
  page,
}) => {
  await signIn(context, "1002", "not-invited");

  await page.goto("/");

  await expect(page).toHaveURL("/invite");
  await expect(page.getByRole("heading", { level: 1, name: "Invite code" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Invite code" })).toBeVisible();
});

test("renders dashboard data and queues representative console actions", async ({
  context,
  page,
}) => {
  await signIn(context, "1001", "octocat", ["kexi"]);

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Repositories 1" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Active Fix PRs 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active work" })).toBeVisible();

  await page.goto("/sve");
  await expect(page.getByRole("heading", { level: 1, name: "SVE" })).toBeVisible();
  await expect(page.getByRole("link", { name: "SVE-202606-EXAMPLE-0001" }).first()).toBeVisible();
  await expect(page.getByText("DOM XSS", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Verify unresolved" }).click();
  await expect(page.getByText("SVE verification queued: 1 repositories")).toBeVisible();

  await page.goto("/repositories");
  await expect(page.getByRole("heading", { level: 1, name: "Repositories" })).toBeVisible();
  await expect(page.getByRole("link", { name: "kexi/example" })).toBeVisible();

  await page.goto("/scans");
  await expect(page.getByRole("heading", { level: 1, name: "Scan history" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "kexi/example" })).toBeVisible();

  await page.goto("/fix-prs");
  await expect(page.getByRole("heading", { level: 1, name: "Fix PRs" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "fix-e2e-qu" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "queued" })).toBeVisible();

  await page.goto("/repositories");
  await page
    .getByRole("row", { name: /kexi\/example/ })
    .getByRole("button", { name: "Scan" })
    .click();
  await expect(page.getByRole("dialog", { name: /Scan config/ })).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Repository config", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Scan" }).click();
  await expect(page.getByText("Scan queued: manual-e2e-queued")).toBeVisible();
});

test("renders scan detail and SVE detail pages with injected data", async ({ context, page }) => {
  await signIn(context, "1001", "octocat", ["kexi"]);

  await page.goto("/scans/manual-e2e-dashboard");

  await expect(page.getByRole("heading", { level: 1, name: "Scan details" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "LLM stream" })).toBeVisible();
  await expect(page.getByText("Found DOM XSS evidence.")).toBeVisible();
  await expect(page.getByRole("heading", { exact: true, name: "Findings" })).toBeVisible();
  await expect(page.getByText("DOM XSS", { exact: true })).toBeVisible();

  await page.goto("/sve/SVE-202606-EXAMPLE-0001");

  await expect(
    page.getByRole("heading", { level: 1, name: "SVE-202606-EXAMPLE-0001" }),
  ).toBeVisible();
  await expect(page.getByText("Stable vulnerability evidence across scan runs")).toBeVisible();
  await expect(page.getByRole("heading", { name: "DOM XSS" })).toBeVisible();

  await page.getByRole("button", { name: "Create Issue" }).click();
  await expect(page.getByRole("link", { name: "Open Issue" })).toHaveAttribute(
    "href",
    "https://github.com/kexi/example/issues/42",
  );

  await page.getByRole("button", { name: "Create Fix PR" }).click();
  const fixPrDialog = page.getByRole("dialog", { name: "Create fix PR" });
  await expect(fixPrDialog).toBeVisible();
  await fixPrDialog.getByRole("button", { name: "Create fix PR" }).click();
  await expect(page.getByText("Fix PR creation queued: fix-e2e-queued.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Fix PR details" })).toHaveAttribute(
    "href",
    "/fix-prs/fix-e2e-queued",
  );

  await page.getByRole("button", { name: "Verify fix" }).click();
  await expect(page.getByText("SVE verification queued: 1 repository")).toBeVisible();

  await page.getByRole("link", { name: "Open Fix PR details" }).click();
  await expect(page).toHaveURL("/fix-prs/fix-e2e-queued");
  await expect(page.getByRole("heading", { level: 1, name: "fix-e2e-queu" })).toBeVisible();
});

test("navigates console routes as an SPA with browser history", async ({ context, page }) => {
  await signIn(context, "1001", "octocat", ["kexi"]);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await page.evaluate(() => {
    window.sessionStorage.setItem("scanveil-spa-marker", "alive");
  });

  await page.getByRole("link", { exact: true, name: "SVE" }).click();
  await expect(page).toHaveURL("/sve");
  await page.getByRole("link", { name: "SVE-202606-EXAMPLE-0001" }).first().click();
  await expect(page).toHaveURL("/sve/SVE-202606-EXAMPLE-0001");
  await expect(
    page.getByRole("heading", { level: 1, name: "SVE-202606-EXAMPLE-0001" }),
  ).toBeVisible();
  await expect(
    page.evaluate(() => window.sessionStorage.getItem("scanveil-spa-marker")),
  ).resolves.toBe("alive");

  await page.goBack();
  await expect(page).toHaveURL("/sve");
  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scheduled scan" })).toBeVisible();
  await expect(page.getByLabel("Frequency")).toHaveText(/Daily at 03:00/);
  await expect(page.getByLabel("Time zone")).toHaveText(/Japan time \(JST\)/);
  await expect(page.getByRole("heading", { name: "GitHub installations" })).toBeVisible();
  await expect(page.getByText("installation 123").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scan policies" })).toBeVisible();
  await expect(page.getByLabel("Policy name").first()).toHaveValue("pnpm minimumReleaseAge");
  await expect(
    page.evaluate(() => window.sessionStorage.getItem("scanveil-spa-marker")),
  ).resolves.toBe("alive");

  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
});

async function signIn(
  context: BrowserContext,
  githubUserId: string,
  githubLogin: string,
  organizationLogins: string[] = [],
): Promise<void> {
  const payload = `v2:${Buffer.from(
    JSON.stringify({
      accessibleRepositoryFullNames: ["kexi/example"],
      accessibleRepositoryIds: [10001],
      githubLogin,
      githubUserId,
      organizationLogins,
    }),
    "utf8",
  ).toString("base64url")}`;
  const token = createSignedSessionToken(payload);
  await context.addCookies([
    {
      domain: "127.0.0.1",
      httpOnly: true,
      name: sessionCookieName,
      path: "/",
      sameSite: "Lax",
      value: token,
    },
  ]);
}

function createSignedSessionToken(payload: string): string {
  const signedPayload = {
    expiresAt: Date.now() + 60 * 60 * 8 * 1000,
    value: payload,
  };
  const encodedPayload = Buffer.from(JSON.stringify(signedPayload), "utf8").toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}
