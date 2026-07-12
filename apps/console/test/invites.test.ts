import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { database, resetDatabase } = vi.hoisted(() => {
  type DocumentData = Record<string, unknown>;

  class FakeDocumentSnapshot {
    constructor(
      readonly exists: boolean,
      readonly value: DocumentData | undefined,
    ) {}

    data() {
      return this.value;
    }
  }

  class FakeDocumentReference {
    constructor(
      readonly store: Map<string, DocumentData>,
      readonly path: string,
    ) {}

    async get() {
      const value = this.store.get(this.path);
      return new FakeDocumentSnapshot(value !== undefined, value);
    }

    async set(value: DocumentData, options?: { merge?: boolean }) {
      writeDocument(this.store, this.path, value, options);
    }
  }

  class FakeCollectionReference {
    constructor(
      readonly store: Map<string, DocumentData>,
      readonly collectionId: string,
    ) {}

    doc(documentId: string) {
      return new FakeDocumentReference(this.store, `${this.collectionId}/${documentId}`);
    }
  }

  class FakeTransaction {
    constructor(readonly store: Map<string, DocumentData>) {}

    async get(ref: FakeDocumentReference) {
      return ref.get();
    }

    set(ref: FakeDocumentReference, value: DocumentData, options?: { merge?: boolean }) {
      writeDocument(this.store, ref.path, value, options);
    }

    update(ref: FakeDocumentReference, value: DocumentData) {
      writeDocument(this.store, ref.path, value, { merge: true });
    }
  }

  class FakeFirestore {
    readonly store = new Map<string, DocumentData>();

    collection(collectionId: string) {
      return new FakeCollectionReference(this.store, collectionId);
    }

    async runTransaction<T>(callback: (transaction: FakeTransaction) => Promise<T>) {
      return callback(new FakeTransaction(this.store));
    }
  }

  const fakeDatabase = new FakeFirestore();
  function writeDocument(
    store: Map<string, DocumentData>,
    path: string,
    value: DocumentData,
    options?: { merge?: boolean },
  ): void {
    const shouldMerge = options?.merge === true;
    const current = shouldMerge ? (store.get(path) ?? {}) : {};
    const next = { ...current };
    for (const [key, fieldValue] of Object.entries(value)) {
      const increment = readIncrementValue(fieldValue);
      const isIncrement = increment !== undefined;
      if (isIncrement) {
        const currentValue = typeof next[key] === "number" ? next[key] : 0;
        next[key] = currentValue + increment;
      } else {
        next[key] = fieldValue;
      }
    }
    store.set(path, next);
  }

  function readIncrementValue(value: unknown): number | undefined {
    const hasIncrementShape =
      typeof value === "object" &&
      value !== null &&
      "__increment" in value &&
      typeof value.__increment === "number";
    if (!hasIncrementShape) {
      return undefined;
    }

    return (value as { __increment: number }).__increment;
  }

  return {
    database: fakeDatabase,
    resetDatabase: () => fakeDatabase.store.clear(),
  };
});

vi.mock("firebase-admin/app", () => ({
  getApps: () => [{}],
  initializeApp: vi.fn(),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    increment: (value: number) => ({ __increment: value }),
  },
  getFirestore: () => database,
}));

describe("invite access", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("rejects scan access before a GitHub account redeems an invite code", async () => {
    const { InviteRequiredError, requireInviteAccess } = await import("../src/invites.js");

    await expect(
      requireInviteAccess({ githubLogin: "octocat", githubUserId: "1001" }),
    ).rejects.toBeInstanceOf(InviteRequiredError);
  });

  it("rejects scan access for a disabled invited GitHub account", async () => {
    const { UserDisabledError, requireInviteAccess } = await import("../src/invites.js");
    database.store.set("inviteRedemptions/1001", {
      code: "HACKATHON",
      codeName: "Hackathon",
      githubLogin: "octocat",
      githubUserId: "1001",
      redeemedAt: "2026-06-21T00:00:00.000Z",
    });
    database.store.set("inviteUsers/1001", { disabled: true });

    await expect(
      requireInviteAccess({ githubLogin: "octocat", githubUserId: "1001" }),
    ).rejects.toBeInstanceOf(UserDisabledError);
  });

  it("rejects scan access unless the GitHub account has an enabled user record", async () => {
    const { UserDisabledError, requireInviteAccess } = await import("../src/invites.js");
    const { generateInviteCode } = await import("@scanveil/core");
    const code = generateInviteCode();
    database.store.set(`inviteCodes/${code}`, {
      enabled: true,
      maxRedemptions: 2,
      name: "Hackathon",
      redeemedCount: 1,
    });
    database.store.set("inviteRedemptions/1001", {
      code,
      codeName: "Hackathon",
      githubLogin: "octocat",
      githubUserId: "1001",
      redeemedAt: "2026-06-21T00:00:00.000Z",
    });

    await expect(
      requireInviteAccess({ githubLogin: "octocat", githubUserId: "1001" }),
    ).rejects.toBeInstanceOf(UserDisabledError);
  });

  it("rejects scan access when the redeemed invite code is disabled", async () => {
    const { InviteAccessRevokedError, requireInviteAccess } = await import("../src/invites.js");
    const { generateInviteCode } = await import("@scanveil/core");
    const code = generateInviteCode();
    database.store.set(`inviteCodes/${code}`, {
      enabled: false,
      maxRedemptions: 2,
      name: "Hackathon",
      redeemedCount: 1,
    });
    database.store.set("inviteRedemptions/1001", {
      code,
      codeName: "Hackathon",
      githubLogin: "octocat",
      githubUserId: "1001",
      redeemedAt: "2026-06-21T00:00:00.000Z",
    });
    database.store.set("inviteUsers/1001", { disabled: false });

    await expect(
      requireInviteAccess({ githubLogin: "octocat", githubUserId: "1001" }),
    ).rejects.toMatchObject({ reason: "invite_disabled" } satisfies Partial<
      InstanceType<typeof InviteAccessRevokedError>
    >);
  });

  it("grants scan access only after redeeming an enabled invite code with capacity", async () => {
    const { redeemInviteCode, requireInviteAccess } = await import("../src/invites.js");
    const { generateInviteCode } = await import("@scanveil/core");
    const code = generateInviteCode();
    database.store.set(`inviteCodes/${code}`, {
      enabled: true,
      maxRedemptions: 2,
      name: "Hackathon",
      redeemedCount: 0,
    });

    const access = await redeemInviteCode(
      { githubLogin: "octocat", githubUserId: "1001" },
      ` ${code.toLowerCase()} `,
    );
    const confirmedAccess = await requireInviteAccess({
      githubLogin: "octocat",
      githubUserId: "1001",
    });

    expect(access).toMatchObject({
      code,
      codeName: "Hackathon",
      githubLogin: "octocat",
      githubUserId: "1001",
    });
    expect(confirmedAccess).toMatchObject(access);
    expect(database.store.get(`inviteCodes/${code}`)).toMatchObject({ redeemedCount: 1 });
    expect(database.store.get("inviteUsers/1001")).toMatchObject({
      disabled: false,
      inviteCode: code,
      inviteName: "Hackathon",
    });
  });

  it("rejects redemption when an invite code is disabled or full", async () => {
    const { InviteRedeemError, redeemInviteCode } = await import("../src/invites.js");
    const { generateInviteCode } = await import("@scanveil/core");
    const pausedCode = generateInviteCode();
    const fullCode = generateInviteCode();
    database.store.set(`inviteCodes/${pausedCode}`, {
      enabled: false,
      maxRedemptions: 2,
      redeemedCount: 0,
    });
    database.store.set(`inviteCodes/${fullCode}`, {
      enabled: true,
      maxRedemptions: 1,
      redeemedCount: 1,
    });

    await expect(
      redeemInviteCode({ githubLogin: "octocat", githubUserId: "1001" }, pausedCode),
    ).rejects.toMatchObject({ reason: "invite_disabled" } satisfies Partial<
      InstanceType<typeof InviteRedeemError>
    >);
    await expect(
      redeemInviteCode({ githubLogin: "octocat", githubUserId: "1001" }, fullCode),
    ).rejects.toMatchObject({ reason: "invite_full" } satisfies Partial<
      InstanceType<typeof InviteRedeemError>
    >);
  });

  it("rejects malformed invite codes before querying Firestore", async () => {
    const { redeemInviteCode } = await import("../src/invites.js");
    const runTransaction = vi.spyOn(database, "runTransaction");

    await expect(
      redeemInviteCode({ githubLogin: "octocat", githubUserId: "1001" }, "SV-2222-2222-BAD"),
    ).rejects.toMatchObject({ reason: "invalid_code" });
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("records login and manual scan stats per GitHub account", async () => {
    const { recordUserLogin, recordUserManualScan } = await import("../src/invites.js");
    const session = { githubLogin: "octocat", githubUserId: "1001" };

    await recordUserLogin(session);
    await recordUserLogin(session);
    await recordUserManualScan(session, 3);
    await recordUserManualScan(session, 2);

    expect(database.store.get("inviteUsers/1001")).toMatchObject({
      githubLogin: "octocat",
      githubUserId: "1001",
      loginCount: 2,
      manualScanRequestCount: 5,
      manualScanRunCount: 2,
      repositoryAccessRefreshedAt: expect.any(String),
    });
  });

  it("loads repository access only from a fresh login snapshot", async () => {
    const { loadConsoleUserSessionAccess } = await import("../src/invites.js");
    database.store.set("inviteUsers/1001", {
      accessibleRepositoryFullNames: ["kexi/example"],
      accessibleRepositoryIds: [10001],
      organizationLogins: ["kexi"],
      repositoryAccessRefreshedAt: "2026-06-25T00:00:00.000Z",
    });

    const fresh = await loadConsoleUserSessionAccess(
      { githubLogin: "octocat", githubUserId: "1001" },
      {
        SECURITY_APP_REPOSITORY_ACCESS_TTL_SECONDS: String(60 * 60 * 24 * 365),
      } as NodeJS.ProcessEnv,
    );

    expect(fresh.accessibleRepositoryIds).toEqual([10001]);
    expect(fresh.accessibleRepositoryFullNames).toEqual(["kexi/example"]);
  });

  it("requires a fresh login instead of silently emptying access when the snapshot expires", async () => {
    const { RepositoryAccessExpiredError, loadConsoleUserSessionAccess } =
      await import("../src/invites.js");
    database.store.set("inviteUsers/1001", {
      accessibleRepositoryFullNames: ["kexi/example"],
      accessibleRepositoryIds: [10001],
      organizationLogins: ["kexi"],
      repositoryAccessRefreshedAt: "2026-06-25T00:00:00.000Z",
    });

    await expect(
      loadConsoleUserSessionAccess({ githubLogin: "octocat", githubUserId: "1001" }, {
        SECURITY_APP_REPOSITORY_ACCESS_TTL_SECONDS: "1",
      } as NodeJS.ProcessEnv),
    ).rejects.toBeInstanceOf(RepositoryAccessExpiredError);
  });

  it("refreshes an expired snapshot with the session OAuth token instead of forcing re-login", async () => {
    const { loadConsoleUserSessionAccess } = await import("../src/invites.js");
    database.store.set("inviteUsers/1001", {
      accessibleRepositoryFullNames: ["kexi/stale"],
      accessibleRepositoryIds: [1],
      organizationLogins: [],
      repositoryAccessRefreshedAt: "2026-06-25T00:00:00.000Z",
    });

    const refreshed = await loadConsoleUserSessionAccess(
      { githubLogin: "octocat", githubOAuthToken: "gho_token", githubUserId: "1001" },
      { SECURITY_APP_REPOSITORY_ACCESS_TTL_SECONDS: "1" } as NodeJS.ProcessEnv,
      {
        fetchOrganizations: async () => [{ login: "kexi" }],
        fetchRepositories: async () => [
          { full_name: "kexi/example", id: 10001, private: true },
          { full_name: "kexi/other", id: 10002, private: false },
        ],
      },
    );

    expect(refreshed.accessibleRepositoryIds).toEqual([10001, 10002]);
    expect(refreshed.accessibleRepositoryFullNames).toEqual(["kexi/example", "kexi/other"]);
    expect(refreshed.organizationLogins).toEqual(["kexi"]);
    expect(database.store.get("inviteUsers/1001")).toMatchObject({
      accessibleRepositoryFullNames: ["kexi/example", "kexi/other"],
      accessibleRepositoryIds: [10001, 10002],
      organizationLogins: ["kexi"],
      repositoryAccessRefreshedAt: expect.not.stringMatching(/^2026-06-25/),
    });
  });

  it("requires re-login when the snapshot refresh fails with a revoked OAuth token", async () => {
    const { RepositoryAccessExpiredError, loadConsoleUserSessionAccess } =
      await import("../src/invites.js");
    database.store.set("inviteUsers/1001", {
      accessibleRepositoryFullNames: ["kexi/example"],
      accessibleRepositoryIds: [10001],
      organizationLogins: ["kexi"],
      repositoryAccessRefreshedAt: "2026-06-25T00:00:00.000Z",
    });

    await expect(
      loadConsoleUserSessionAccess(
        { githubLogin: "octocat", githubOAuthToken: "gho_revoked", githubUserId: "1001" },
        { SECURITY_APP_REPOSITORY_ACCESS_TTL_SECONDS: "1" } as NodeJS.ProcessEnv,
        {
          fetchOrganizations: async () => {
            throw new Error("GitHub organizations request failed: 401");
          },
          fetchRepositories: async () => {
            throw new Error("GitHub repositories request failed: 401");
          },
        },
      ),
    ).rejects.toBeInstanceOf(RepositoryAccessExpiredError);
  });

  it("round-trips the OAuth token through the session cookie payload", async () => {
    const { createConsoleUserSessionPayload, parseConsoleUserSession } =
      await import("../src/invites.js");

    const payload = createConsoleUserSessionPayload({
      githubLogin: "octocat",
      githubOAuthToken: "gho_token",
      githubUserId: "1001",
    });
    const parsed = parseConsoleUserSession(payload);

    expect(parsed).toMatchObject({
      githubLogin: "octocat",
      githubOAuthToken: "gho_token",
      githubUserId: "1001",
    });
  });

  it("rejects manual scan stats for a disabled GitHub account", async () => {
    const { UserDisabledError, recordUserManualScan } = await import("../src/invites.js");
    database.store.set("inviteUsers/1001", {
      disabled: true,
      githubLogin: "octocat",
      githubUserId: "1001",
    });

    await expect(
      recordUserManualScan({ githubLogin: "octocat", githubUserId: "1001" }, 1),
    ).rejects.toBeInstanceOf(UserDisabledError);
  });
});
