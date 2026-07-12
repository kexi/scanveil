import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RepositoryScanRequest, SecurityFinding } from "@scanveil/core";

import { writeScanFindings } from "../src/scan-findings.js";

const firestoreMocks = vi.hoisted(() => ({
  update: vi.fn(),
}));

vi.mock("@google-cloud/firestore", () => ({
  FieldValue: {
    vector: (value: number[]) => ({ value }),
  },
  Firestore: vi.fn(function Firestore() {
    return {
      collection: () => ({
        doc: () => ({
          update: firestoreMocks.update,
        }),
      }),
    };
  }),
}));

describe("writeScanFindings", () => {
  const originalProject = process.env.GOOGLE_CLOUD_PROJECT;
  const originalToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;

  beforeEach(() => {
    firestoreMocks.update.mockReset();
  });

  afterEach(() => {
    restoreEnv("GOOGLE_CLOUD_PROJECT", originalProject);
    restoreEnv("GOOGLE_OAUTH_ACCESS_TOKEN", originalToken);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not call Firestore when there are no findings", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await writeScanFindings(repositoryRequest(), []);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("writes findings to the scanFindings collection", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await writeScanFindings(repositoryRequest(), [securityFinding()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toContain(
      "/projects/scanveil-project/databases/(default)/documents/scanFindings/delivery-1-AIVULN-202606-EXAMPLE-0001",
    );
    expect(init).toMatchObject({
      headers: {
        authorization: "Bearer token-1",
        "content-type": "application/json",
      },
      method: "PATCH",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      fields: {
        aliases: { arrayValue: { values: [{ stringValue: "CVE-2026-0001" }] } },
        category: { stringValue: "xss" },
        confidence: { doubleValue: 0.95 },
        deliveryId: { stringValue: "delivery-1" },
        endLine: { integerValue: "12" },
        evidence: { stringValue: "innerHTML uses user input" },
        file: { stringValue: "src/app.ts" },
        findingId: { stringValue: "AIVULN-202606-EXAMPLE-0001" },
        sveId: { stringValue: "SVE-202606-EXAMPLE-0001" },
        recommendation: { stringValue: "Use textContent." },
        repoFullName: { stringValue: "kexi/example" },
        repositoryId: { integerValue: "10001" },
        severity: { stringValue: "high" },
        source: { stringValue: "llm" },
        startLine: { integerValue: "12" },
        title: { stringValue: "DOM XSS" },
        writtenAt: { timestampValue: expect.any(String) },
      },
    });
  });

  it("keeps the REST finding write when the vector update fails", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const logMock = vi.spyOn(console, "log").mockImplementation(() => {});
    firestoreMocks.update.mockRejectedValueOnce(new Error("vector update failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      writeScanFindings(repositoryRequest(), [
        {
          ...securityFinding(),
          embedding: [1, 0, 0],
        },
      ]),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.update).toHaveBeenCalledWith({
      embeddingVector: { value: [1, 0, 0] },
    });
    expect(logMock).toHaveBeenCalledWith(
      expect.stringContaining("scan_finding_vector_write_failed"),
    );
  });
});

function repositoryRequest(): RepositoryScanRequest {
  return {
    defaultBranch: "main",
    deliveryId: "delivery-1",
    headSha: "abc123",
    installationId: 123,
    llmEnabled: true,
    osvEnabled: true,
    owner: "kexi",
    reason: "manual",
    repo: "example",
    repositoryId: 10001,
    target: "repository",
  };
}

function securityFinding(): SecurityFinding {
  return {
    aliases: ["CVE-2026-0001"],
    category: "xss",
    confidence: 0.95,
    endLine: 12,
    evidence: "innerHTML uses user input",
    file: "src/app.ts",
    id: "AIVULN-202606-EXAMPLE-0001",
    sveId: "SVE-202606-EXAMPLE-0001",
    recommendation: "Use textContent.",
    severity: "high",
    source: "llm",
    startLine: 12,
    title: "DOM XSS",
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
