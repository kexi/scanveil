import { expect, test, type Page } from "@playwright/test";

const allowedAdminEmail = "kei.of.nakayama@gmail.com";

test("renders the admin sign-in page for signed-out users", async ({ page }) => {
  await mockFirebaseInit(page);

  await page.goto("/admin.html");

  await expect(page.getByRole("heading", { level: 1, name: "Scanveil Admin" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});

test("shows an error when Firebase auth initialization fails", async ({ page }) => {
  await page.route("**/__/firebase/init.json", async (route) => {
    await route.fulfill({
      body: "missing firebase init",
      status: 404,
    });
  });

  await page.goto("/admin.html");

  await expect(page.getByText("Firebase init failed: 404 missing firebase init")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Admin sign in" })).toBeVisible();
});

test("rejects signed-in users outside the admin allowlist", async ({ page }) => {
  await signInAs(page, "viewer@example.com");
  await mockFirebaseInit(page);

  await page.goto("/admin.html");

  await expect(page.getByText("この Google アカウントは管理画面を利用できません。")).toBeVisible();
  await expect(page.getByRole("button", { name: "別アカウントでログイン" })).toBeVisible();
});

test("renders admin data and sends representative mutations", async ({ page }) => {
  const requests: AdminRequest[] = [];
  await signInAs(page, allowedAdminEmail);
  await mockFirebaseInit(page);
  await mockAdminApi(page, requests);

  await page.goto("/admin.html");

  await expect(page.getByText(allowedAdminEmail)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create invite code" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "GitHub installations" })).toBeVisible();
  await expect(page.getByText("kexi-org")).toBeVisible();
  await expect(page.getByRole("row", { name: /octocat 1001/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /octocat SV-E2E/ })).toBeVisible();

  await page.getByRole("textbox", { name: "Name" }).fill("Hackathon reviewers");
  await page.getByRole("spinbutton", { name: "Limit" }).fill("5");
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByText("Hackathon reviewers")).toBeVisible();
  expect(requests).toContainEqual({
    body: { maxRedemptions: 5, name: "Hackathon reviewers" },
    method: "POST",
    path: "/api/invite-codes",
  });

  const installationRow = page.getByRole("row", { name: /kexi-org/ });
  await installationRow.getByRole("textbox", { name: "Invite code" }).fill("SV-E2E");
  await installationRow.getByRole("button", { name: "Save" }).click();

  await expect(installationRow.getByText("E2E reviewers")).toBeVisible();
  expect(requests).toContainEqual({
    body: { enabled: false, inviteCode: "SV-E2E" },
    method: "PATCH",
    path: "/api/installation-policies/987654",
  });

  const inviteCodeRow = page.getByRole("row", { name: /E2E reviewers SV-E2E-\*\*CRET/ });
  await inviteCodeRow.getByRole("button", { name: "show" }).click();
  await expect(page.getByRole("row", { name: /E2E reviewers SV-E2E-SECRET/ })).toBeVisible();
});

async function signInAs(page: Page, email: string): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("scanveilAdminE2eEmail", value);
  }, email);
}

async function mockFirebaseInit(page: Page): Promise<void> {
  await page.route("**/__/firebase/init.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        apiKey: "scanveil-e2e",
        appId: "scanveil-e2e",
        authDomain: "127.0.0.1",
        projectId: "scanveil-e2e",
      },
    });
  });
}

async function mockAdminApi(page: Page, requests: AdminRequest[]): Promise<void> {
  let data = createAdminBootstrapResponse();
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = method === "GET" ? undefined : JSON.parse(request.postData() ?? "{}");
    requests.push({ body, method, path: url.pathname });

    const isBootstrap = method === "GET" && url.pathname === "/api/bootstrap";
    if (isBootstrap) {
      await route.fulfill({ contentType: "application/json", json: data });
      return;
    }

    const isCreateInvite = method === "POST" && url.pathname === "/api/invite-codes";
    if (isCreateInvite) {
      data = {
        ...data,
        inviteCodes: [
          {
            code: "SV-E2E-NEW",
            createdAt: "2026-06-22T00:00:00.000Z",
            enabled: true,
            maxRedemptions: body.maxRedemptions,
            name: body.name,
            redeemedCount: 0,
            updatedAt: "2026-06-22T00:00:00.000Z",
          },
          ...data.inviteCodes,
        ],
      };
      await route.fulfill({ contentType: "application/json", json: data });
      return;
    }

    const isInstallationPolicyUpdate =
      method === "PATCH" && url.pathname === "/api/installation-policies/987654";
    if (isInstallationPolicyUpdate) {
      data = {
        ...data,
        installationPolicies: data.installationPolicies.map((policy) => {
          const isTargetPolicy = policy.installationId === 987654;
          if (!isTargetPolicy) {
            return policy;
          }

          return {
            ...policy,
            enabled: body.enabled,
            inviteCode: body.inviteCode,
            inviteName: "E2E reviewers",
            updatedAt: "2026-06-22T00:01:00.000Z",
            updatedBy: allowedAdminEmail,
          };
        }),
      };
      await route.fulfill({ contentType: "application/json", json: data });
      return;
    }

    await route.fulfill({
      body: "not found",
      status: 404,
    });
  });
}

function createAdminBootstrapResponse(): AdminBootstrapResponse {
  return {
    installationPolicies: [
      {
        accountLogin: "kexi-org",
        accountType: "Organization",
        enabled: false,
        installationId: 987654,
        repositoryCount: 3,
        repositorySelection: "selected",
        updatedAt: "2026-06-21T00:00:00.000Z",
        updatedBy: "seed@example.com",
      },
    ],
    inviteCodes: [
      {
        code: "SV-E2E-SECRET",
        createdAt: "2026-06-21T00:00:00.000Z",
        enabled: true,
        maxRedemptions: 10,
        name: "E2E reviewers",
        redeemedCount: 1,
        updatedAt: "2026-06-21T00:00:00.000Z",
      },
    ],
    redemptions: [
      {
        code: "SV-E2E",
        codeName: "E2E reviewers",
        githubLogin: "octocat",
        githubUserId: "1001",
        id: "redemption-e2e",
        redeemedAt: "2026-06-21T00:00:00.000Z",
      },
    ],
    users: [
      {
        disabled: false,
        githubLogin: "octocat",
        githubUserId: "1001",
        id: "1001",
        inviteName: "E2E reviewers",
        lastLoginAt: "2026-06-21T00:02:00.000Z",
        loginCount: 2,
        manualScanRequestCount: 1,
        manualScanRunCount: 1,
        registeredAt: "2026-06-21T00:00:00.000Z",
        updatedAt: "2026-06-21T00:02:00.000Z",
      },
    ],
  };
}

interface AdminRequest {
  body: unknown;
  method: string;
  path: string;
}

interface AdminBootstrapResponse {
  installationPolicies: Array<{
    accountLogin: string;
    accountType: string;
    enabled: boolean;
    installationId: number;
    inviteCode?: string;
    inviteName?: string;
    repositoryCount: number;
    repositorySelection: string;
    updatedAt: string;
    updatedBy: string;
  }>;
  inviteCodes: Array<{
    code: string;
    createdAt: string;
    enabled: boolean;
    maxRedemptions: number;
    name: string;
    redeemedCount: number;
    updatedAt: string;
  }>;
  redemptions: Array<{
    code: string;
    codeName: string;
    githubLogin: string;
    githubUserId: string;
    id: string;
    redeemedAt: string;
  }>;
  users: Array<{
    disabled: boolean;
    githubLogin: string;
    githubUserId: string;
    id: string;
    inviteName: string;
    lastLoginAt: string;
    loginCount: number;
    manualScanRequestCount: number;
    manualScanRunCount: number;
    registeredAt: string;
    updatedAt: string;
  }>;
}
