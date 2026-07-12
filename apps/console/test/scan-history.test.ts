import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listScanFindingRecords,
  listScanFindingRecordsBySveId,
  listScanRunRecords,
  listScanStreamChunks,
  readScanRunRecord,
} from "../src/scan-history.js";

describe("listScanFindingRecords", () => {
  const originalProject = process.env.GOOGLE_CLOUD_PROJECT;
  const originalToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;

  afterEach(() => {
    restoreEnv("GOOGLE_CLOUD_PROJECT", originalProject);
    restoreEnv("GOOGLE_OAUTH_ACCESS_TOKEN", originalToken);
    vi.unstubAllGlobals();
  });

  it("returns no findings without delivery ids", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const findings = await listScanFindingRecords([]);

    expect(findings).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads scan findings by delivery id", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json([
        {
          document: {
            fields: firestoreFindingFields("delivery-1", "AIVULN-1"),
          },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const findings = await listScanFindingRecords(["delivery-1"]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      aliases: ["CVE-2026-0001"],
      category: "xss",
      confidence: 0.95,
      deliveryId: "delivery-1",
      endLine: 12,
      evidence: "innerHTML uses user input",
      file: "src/app.ts",
      findingId: "AIVULN-1",
      sveId: "SVE-202606-EXAMPLE-0001",
      recommendation: "Use textContent.",
      repoFullName: "kexi/example",
      severity: "high",
      source: "llm",
      startLine: 12,
      title: "DOM XSS",
      writtenAt: "2026-06-21T00:00:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/projects/scanveil-project/databases/(default)/documents:runQuery"),
      expect.objectContaining({
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: "scanFindings" }],
            limit: 500,
            where: {
              fieldFilter: {
                field: { fieldPath: "deliveryId" },
                op: "IN",
                value: {
                  arrayValue: {
                    values: [{ stringValue: "delivery-1" }],
                  },
                },
              },
            },
          },
        }),
        headers: expect.objectContaining({
          authorization: "Bearer token-1",
        }),
        method: "POST",
      }),
    );
  });

  it("reads SVE finding history by SVE-ID", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json([
        {
          document: {
            fields: firestoreFindingFields("delivery-1", "AIVULN-1"),
          },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const findings = await listScanFindingRecordsBySveId("SVE-202606-EXAMPLE-0001");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.sveId).toBe("SVE-202606-EXAMPLE-0001");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.structuredQuery.where.fieldFilter).toMatchObject({
      field: { fieldPath: "sveId" },
      op: "EQUAL",
      value: { stringValue: "SVE-202606-EXAMPLE-0001" },
    });
  });

  it("chunks Firestore IN queries for many delivery ids", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    const deliveryIds = Array.from({ length: 31 }, (_, index) => `delivery-${index}`);
    await listScanFindingRecords(deliveryIds);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody.structuredQuery.where.fieldFilter.value.arrayValue.values).toHaveLength(30);
    expect(secondBody.structuredQuery.where.fieldFilter.value.arrayValue.values).toHaveLength(1);
  });

  it("reads scan run cost and region metadata", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json([
        {
          document: {
            fields: firestoreScanRunFields(),
          },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const runs = await listScanRunRecords();

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      deliveryId: "delivery-1",
      llmEstimatedCostUsd: 0.00004,
      llmInputTokens: 40,
      llmLocation: "global",
      llmModel: "gemini-test",
      llmOutputObjectPath: "gs://scanveil-artifacts/scan-runs/delivery-1/llm-output.txt",
      llmOutputTokens: 20,
      llmProvider: "vertex_ai",
      llmTotalTokens: 60,
      runnerRegion: "us-central1",
      streamChunkCount: 2,
    });
  });

  it("reads one scan run by delivery id", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({
        fields: firestoreScanRunFields(),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const run = await readScanRunRecord("delivery-1");

    expect(run).toMatchObject({
      deliveryId: "delivery-1",
      repositoryId: 10001,
      status: "succeeded",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/projects/scanveil-project/databases/(default)/documents/scanRuns/delivery-1",
      ),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer token-1",
        }),
        method: "GET",
      }),
    );
  });

  it("returns undefined when a scan run document is missing", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) => new Response("not found", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const run = await readScanRunRecord("missing-delivery");

    expect(run).toBeUndefined();
  });

  it("reads scan stream chunks after a sequence", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json([
        {
          document: {
            fields: {
              deliveryId: { stringValue: "delivery-1" },
              kind: { stringValue: "llm_chunk" },
              repoFullName: { stringValue: "kexi/example" },
              repositoryId: { integerValue: "10001" },
              sequence: { integerValue: "2" },
              text: { stringValue: "chunk text" },
              timestamp: { timestampValue: "2026-06-21T00:00:03.000Z" },
            },
          },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const chunks = await listScanStreamChunks("delivery-1", 1);

    expect(chunks).toEqual([
      {
        deliveryId: "delivery-1",
        kind: "llm_chunk",
        repoFullName: "kexi/example",
        repositoryId: 10001,
        sequence: 2,
        text: "chunk text",
        timestamp: "2026-06-21T00:00:03.000Z",
      },
    ]);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.structuredQuery.where.compositeFilter.filters).toHaveLength(2);
  });
});

function firestoreScanRunFields() {
  return {
    deliveryId: { stringValue: "delivery-1" },
    headSha: { stringValue: "abc123" },
    installationId: { integerValue: "123" },
    llmEstimatedCostUsd: { doubleValue: 0.00004 },
    llmInputTokens: { integerValue: "40" },
    llmLocation: { stringValue: "global" },
    llmModel: { stringValue: "gemini-test" },
    llmOutputObjectPath: {
      stringValue: "gs://scanveil-artifacts/scan-runs/delivery-1/llm-output.txt",
    },
    llmOutputTokens: { integerValue: "20" },
    llmProvider: { stringValue: "vertex_ai" },
    llmTotalTokens: { integerValue: "60" },
    owner: { stringValue: "kexi" },
    queuedAt: { timestampValue: "2026-06-21T00:00:00.000Z" },
    reason: { stringValue: "manual" },
    repo: { stringValue: "example" },
    repositoryId: { integerValue: "10001" },
    runnerRegion: { stringValue: "us-central1" },
    status: { stringValue: "succeeded" },
    streamChunkCount: { integerValue: "2" },
    target: { stringValue: "repository" },
    updatedAt: { timestampValue: "2026-06-21T00:01:00.000Z" },
  };
}

function firestoreFindingFields(deliveryId: string, findingId: string) {
  return {
    aliases: { arrayValue: { values: [{ stringValue: "CVE-2026-0001" }] } },
    category: { stringValue: "xss" },
    confidence: { doubleValue: 0.95 },
    deliveryId: { stringValue: deliveryId },
    endLine: { integerValue: "12" },
    evidence: { stringValue: "innerHTML uses user input" },
    file: { stringValue: "src/app.ts" },
    findingId: { stringValue: findingId },
    sveId: { stringValue: "SVE-202606-EXAMPLE-0001" },
    recommendation: { stringValue: "Use textContent." },
    repoFullName: { stringValue: "kexi/example" },
    repositoryId: { integerValue: "10001" },
    severity: { stringValue: "high" },
    source: { stringValue: "llm" },
    startLine: { integerValue: "12" },
    title: { stringValue: "DOM XSS" },
    writtenAt: { timestampValue: "2026-06-21T00:00:00.000Z" },
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
