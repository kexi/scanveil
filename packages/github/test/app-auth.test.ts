import { generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createInstallationToken } from "../src/app-auth.js";

describe("createInstallationToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("can request scoped installation permissions", async () => {
    const requests: Array<{ body?: unknown; headers: Headers; method: string; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
          headers: new Headers(init?.headers),
          method: init?.method ?? "GET",
          url: String(input),
        });
        return new Response(JSON.stringify({ token: "installation-token" }), {
          headers: { "content-type": "application/json" },
          status: 201,
        });
      }),
    );

    const token = await createInstallationToken(
      {
        apiBaseUrl: "https://github.test",
        appId: "123",
        privateKey: createTestPrivateKey(),
      },
      456,
      {
        permissions: {
          contents: "write",
          pull_requests: "write",
        },
      },
    );

    expect(token).toBe("installation-token");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      body: {
        permissions: {
          contents: "write",
          pull_requests: "write",
        },
      },
      method: "POST",
      url: "https://github.test/app/installations/456/access_tokens",
    });
    expect(requests[0]?.headers.get("content-type")).toBe("application/json");
  });
});

function createTestPrivateKey(): string {
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return keyPair.privateKey.export({ format: "pem", type: "pkcs1" }).toString();
}
