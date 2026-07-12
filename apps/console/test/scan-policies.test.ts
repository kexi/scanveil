import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createScanPolicy,
  deleteScanPolicy,
  listScanPolicies,
  updateScanPolicy,
} from "../src/scan-policies.js";

describe("scan policies", () => {
  const originalProject = process.env.GOOGLE_CLOUD_PROJECT;
  const originalToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;

  afterEach(() => {
    restoreEnv("GOOGLE_CLOUD_PROJECT", originalProject);
    restoreEnv("GOOGLE_OAUTH_ACCESS_TOKEN", originalToken);
    vi.unstubAllGlobals();
  });

  it("lists policies for every accessible installation", async () => {
    setFirestoreEnv();
    const queries: unknown[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      queries.push(JSON.parse(String(init.body)));
      return Response.json([
        {
          document: {
            fields: policyFields(123, "pnpm minimumReleaseAge"),
            name: "projects/p/databases/(default)/documents/scanPolicies/policy-1",
          },
        },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const policies = await listScanPolicies([123]);

    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatchObject({
      enabled: true,
      id: "policy-1",
      installationId: 123,
      name: "pnpm minimumReleaseAge",
      rule: "minimumReleaseAge must be 1440 or higher.",
    });
    expect(queries[0]).toMatchObject({
      structuredQuery: {
        from: [{ collectionId: "scanPolicies" }],
      },
    });
  });

  it("deduplicates installation ids before querying", async () => {
    setFirestoreEnv();
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    await listScanPolicies([123, 123, 456]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("creates a policy and returns the stored document", async () => {
    setFirestoreEnv();
    const bodies: unknown[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({
        fields: policyFields(123, "pnpm minimumReleaseAge"),
        name: "projects/p/databases/(default)/documents/scanPolicies/policy-new",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const policy = await createScanPolicy(
      {
        enabled: true,
        installationId: 123,
        name: "pnpm minimumReleaseAge",
        rule: "minimumReleaseAge must be 1440 or higher.",
      },
      "kexi",
    );

    expect(policy.id).toBe("policy-new");
    expect(bodies[0]).toMatchObject({
      fields: {
        installationId: { integerValue: "123" },
        name: { stringValue: "pnpm minimumReleaseAge" },
        updatedBy: { stringValue: "kexi" },
      },
    });
  });

  it("rejects policy names above the length limit", async () => {
    setFirestoreEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createScanPolicy(
        {
          enabled: true,
          installationId: 123,
          name: "x".repeat(121),
          rule: "rule",
        },
        "kexi",
      ),
    ).rejects.toThrow("Policy name must be 1-120 characters");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns undefined when updating a missing policy", async () => {
    setFirestoreEnv();
    const fetchMock = vi.fn(async () => new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const policy = await updateScanPolicy("missing", { enabled: false }, "kexi");

    expect(policy).toBeUndefined();
  });

  it("merges update input over the existing document", async () => {
    setFirestoreEnv();
    const bodies: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const isPatch = init?.method === "PATCH";
      if (isPatch) {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({
          fields: policyFields(123, "pnpm minimumReleaseAge", false),
          name: String(url).split("?")[0] ?? "",
        });
      }

      return Response.json({
        fields: policyFields(123, "pnpm minimumReleaseAge"),
        name: "projects/p/databases/(default)/documents/scanPolicies/policy-1",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await updateScanPolicy("policy-1", { enabled: false }, "kexi");

    expect(bodies[0]).toMatchObject({
      fields: {
        enabled: { booleanValue: false },
        name: { stringValue: "pnpm minimumReleaseAge" },
        rule: { stringValue: "minimumReleaseAge must be 1440 or higher." },
      },
    });
  });

  it("deletes a policy document", async () => {
    setFirestoreEnv();
    const methods: (string | undefined)[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      methods.push(init?.method);
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await deleteScanPolicy("policy-1");

    expect(methods).toEqual(["DELETE"]);
  });
});

function setFirestoreEnv(): void {
  process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
  process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
}

function policyFields(
  installationId: number,
  name: string,
  enabled = true,
): Record<string, unknown> {
  return {
    createdAt: { stringValue: "2026-07-01T00:00:00.000Z" },
    enabled: { booleanValue: enabled },
    installationId: { integerValue: String(installationId) },
    name: { stringValue: name },
    rule: { stringValue: "minimumReleaseAge must be 1440 or higher." },
    updatedAt: { stringValue: "2026-07-01T00:00:00.000Z" },
    updatedBy: { stringValue: "kexi" },
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  const hasValue = value !== undefined;
  if (hasValue) {
    process.env[name] = value;
    return;
  }

  delete process.env[name];
}
