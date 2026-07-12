import { afterEach, describe, expect, it, vi } from "vitest";

import type { StoredFinding } from "@scanveil/rag";

import { FirestoreFindingStore } from "../src/firestore-finding-store.js";

describe("FirestoreFindingStore", () => {
  const originalProject = process.env.GOOGLE_CLOUD_PROJECT;
  const originalToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;

  afterEach(() => {
    restoreEnv("GOOGLE_CLOUD_PROJECT", originalProject);
    restoreEnv("GOOGLE_OAUTH_ACCESS_TOKEN", originalToken);
    vi.unstubAllGlobals();
  });

  it("writes a canonical SVE fingerprint index for exact matches", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = new FirestoreFindingStore();

    await store.saveFinding(storedFinding());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toContain(
      "/projects/scanveil-project/databases/(default)/documents/sveFingerprints/FINGERPRINT-1",
    );
    expect(init).toMatchObject({
      headers: {
        authorization: "Bearer token-1",
        "content-type": "application/json",
      },
      method: "PATCH",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      fields: {
        fingerprint: { stringValue: "FINGERPRINT-1" },
        findingId: { stringValue: "AIVULN-1" },
        repoFullName: { stringValue: "kexi/example" },
        sveId: { stringValue: "SVE-1" },
      },
    });
  });

  it("reads a canonical SVE fingerprint index before scanning findings", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            fields: {
              findingId: { stringValue: "AIVULN-1" },
              firstSeenAt: { timestampValue: "2026-06-21T01:48:52.674Z" },
              repoFullName: { stringValue: "kexi/example" },
              sveId: { stringValue: "SVE-1" },
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const store = new FirestoreFindingStore();

    const match = await store.findByFingerprint("kexi/example", "FINGERPRINT-1");

    expect(match).toEqual({ findingId: "AIVULN-1", sveId: "SVE-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toContain("/documents/sveFingerprints/FINGERPRINT-1");
    expect(init).toMatchObject({
      headers: { authorization: "Bearer token-1" },
      method: "GET",
    });
  });
});

function storedFinding(): StoredFinding {
  return {
    codeSpanFingerprint: "src/app.ts:12-12",
    embedding: [1, 0, 0],
    finding: {
      aliases: [],
      category: "xss",
      confidence: 0.95,
      evidence: "innerHTML uses user input",
      file: "src/app.ts",
      id: "AIVULN-1",
      recommendation: "Use textContent.",
      severity: "high",
      source: "llm",
      startLine: 12,
      endLine: 12,
      sveId: "SVE-1",
      title: "DOM XSS",
    },
    normalizedText: "xss src/app.ts dom xss use textcontent.",
    repoFullName: "kexi/example",
    sveFingerprint: "FINGERPRINT-1",
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
