import { generateKeyPairSync } from "node:crypto";

import type { ScanFindingRecord, ScanRunRecord } from "@scanveil/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listFixPrStreamChunks, readFixPrRunRecord, startFixPrRun } from "../src/fix-prs.js";

describe("startFixPrRun", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("enqueues a worker job with FIX_PR_REQUEST_JSON and stores a queued record", async () => {
    const requests: Array<{ body?: unknown; method: string; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
        requests.push({ body, method: init?.method ?? "GET", url: String(input) });
        const url = String(input);
        if (url.includes("run.googleapis.com")) {
          return jsonResponse({
            metadata: {
              target:
                "projects/scanveil-project/locations/us-central1/jobs/scanveil-worker/executions/fix-1",
            },
            name: "projects/scanveil-project/locations/us-central1/operations/fix-operation-1",
          });
        }
        if (url.includes("firestore.googleapis.com")) {
          return jsonResponse({});
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const result = await startFixPrRun(
      { finding: scanFinding(), run: scanRun() },
      {
        GOOGLE_CLOUD_PROJECT: "scanveil-project",
        GOOGLE_CLOUD_REGION: "us-central1",
        GOOGLE_OAUTH_ACCESS_TOKEN: "token",
        SCAN_WORKER_JOB_NAME: "scanveil-worker",
      },
    );

    expect(result.executionName).toBe(
      "projects/scanveil-project/locations/us-central1/jobs/scanveil-worker/executions/fix-1",
    );
    expect(requests[0]?.url).toContain("/documents/fixPrRuns/");
    const runJobBody = requests[1]?.body as {
      overrides: { containerOverrides: Array<{ env: Array<{ name: string; value: string }> }> };
    };
    expect(runJobBody.overrides.containerOverrides[0]?.env[0]?.name).toBe("FIX_PR_REQUEST_JSON");
    const request = JSON.parse(runJobBody.overrides.containerOverrides[0]?.env[0]?.value ?? "{}");
    expect(request).toMatchObject({
      defaultBranch: "main",
      deliveryId: "delivery-1",
      file: "src/app.ts",
      findingId: "AIVULN-1",
      owner: "kexi",
      repo: "example",
      sveId: "SVE-1",
    });
    expect(request.fixId).toMatch(/^fix-/);
    expect(requests[2]?.url).toContain("/documents/fixPrRuns/");
  });

  it("marks the fix PR run failed when worker enqueue fails", async () => {
    const requests: Array<{ body?: unknown; method: string; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
        requests.push({ body, method: init?.method ?? "GET", url: String(input) });
        const url = String(input);
        const isInitialFirestoreWrite =
          url.includes("firestore.googleapis.com") && requests.length === 1;
        if (isInitialFirestoreWrite) {
          return jsonResponse({});
        }

        if (url.includes("run.googleapis.com")) {
          return new Response("quota exceeded", { status: 503 });
        }

        if (url.includes("firestore.googleapis.com")) {
          return jsonResponse({});
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    await expect(
      startFixPrRun(
        { finding: scanFinding(), run: scanRun() },
        {
          GOOGLE_CLOUD_PROJECT: "scanveil-project",
          GOOGLE_CLOUD_REGION: "us-central1",
          GOOGLE_OAUTH_ACCESS_TOKEN: "token",
          SCAN_WORKER_JOB_NAME: "scanveil-worker",
        },
      ),
    ).rejects.toThrow("Cloud Run job execution failed: 503 quota exceeded");

    expect(requests).toHaveLength(3);
    const failedPatchBody = requests[2]?.body as {
      fields: Record<string, { stringValue?: string; timestampValue?: string }>;
    };
    expect(failedPatchBody.fields).toMatchObject({
      errorMessage: {
        stringValue: "Cloud Run job execution failed: 503 quota exceeded",
      },
      status: { stringValue: "failed" },
    });
    expect(failedPatchBody.fields.finishedAt?.timestampValue).toBeDefined();
  });

  it("rejects before writing when GitHub installation does not grant fix PR permissions", async () => {
    const requests: Array<{ body?: unknown; method: string; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
        requests.push({ body, method: init?.method ?? "GET", url: String(input) });
        return jsonResponse({ message: "Permissions requested are not granted" }, 422);
      }),
    );

    await expect(
      startFixPrRun(
        { finding: scanFinding(), run: scanRun() },
        {
          GITHUB_APP_ID: "123",
          GITHUB_APP_PRIVATE_KEY: createTestPrivateKey(),
          GOOGLE_CLOUD_PROJECT: "scanveil-project",
          GOOGLE_CLOUD_REGION: "us-central1",
          GOOGLE_OAUTH_ACCESS_TOKEN: "token",
          SCAN_WORKER_JOB_NAME: "scanveil-worker",
        },
      ),
    ).rejects.toThrow("GitHub App requires Contents: Read and write");

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      body: {
        permissions: {
          contents: "write",
          pull_requests: "write",
        },
      },
      method: "POST",
    });
    expect(requests[0]?.url).toContain("/app/installations/123/access_tokens");
  });

  it("normalizes active fix PR runs with terminal error fields", async () => {
    const requests: Array<{ body?: unknown; method: string; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
        requests.push({ body, method: init?.method ?? "GET", url: String(input) });
        const method = init?.method ?? "GET";
        const isRead = method === "GET" && String(input).includes("/documents/fixPrRuns/fix-1");
        if (isRead) {
          return jsonResponse({ fields: fixPrRunFields({ status: "running" }) });
        }

        const isPatch = method === "PATCH" && String(input).includes("/documents/fixPrRuns/fix-1");
        if (isPatch) {
          return jsonResponse({});
        }

        throw new Error(`Unexpected request: ${String(input)}`);
      }),
    );

    const record = await readFixPrRunRecord("fix-1", {
      GOOGLE_CLOUD_PROJECT: "scanveil-project",
      GOOGLE_OAUTH_ACCESS_TOKEN: "token",
    });

    expect(record?.status).toBe("failed");
    expect(record?.errorMessage).toBe("GitHub request failed: 403");
    expect(requests).toHaveLength(2);
    const patchBody = requests[1]?.body as {
      fields: Record<string, { stringValue?: string; timestampValue?: string }>;
    };
    expect(patchBody.fields).toMatchObject({
      status: { stringValue: "failed" },
      updatedAt: { timestampValue: "2026-06-21T00:03:00.000Z" },
    });
  });

  it("normalizes stored GitHub permission errors for existing fix PR runs", async () => {
    const requests: Array<{ body?: unknown; method: string; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
        requests.push({ body, method: init?.method ?? "GET", url: String(input) });
        const method = init?.method ?? "GET";
        const isRead = method === "GET" && String(input).includes("/documents/fixPrRuns/fix-1");
        if (isRead) {
          return jsonResponse({
            fields: fixPrRunFields({
              errorMessage:
                'GitHub request failed: 403 {"message":"Resource not accessible by integration"}',
              status: "failed",
            }),
          });
        }

        const isPatch = method === "PATCH" && String(input).includes("/documents/fixPrRuns/fix-1");
        if (isPatch) {
          return jsonResponse({});
        }

        throw new Error(`Unexpected request: ${String(input)}`);
      }),
    );

    const record = await readFixPrRunRecord("fix-1", {
      GOOGLE_CLOUD_PROJECT: "scanveil-project",
      GOOGLE_OAUTH_ACCESS_TOKEN: "token",
    });

    expect(record?.status).toBe("failed");
    expect(record?.errorMessage).toContain("GitHub App requires Contents: Read and write");
    expect(requests).toHaveLength(2);
    const patchBody = requests[1]?.body as {
      fields: Record<string, { stringValue?: string; timestampValue?: string }>;
    };
    expect(patchBody.fields.errorMessage?.stringValue).toContain(
      "GitHub App requires Contents: Read and write",
    );
  });
});

describe("listFixPrStreamChunks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads fix PR stream chunks after a sequence", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json([
        {
          document: {
            fields: {
              fixId: { stringValue: "fix-1" },
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

    const chunks = await listFixPrStreamChunks("fix-1", 1, {
      GOOGLE_CLOUD_PROJECT: "scanveil-project",
      GOOGLE_OAUTH_ACCESS_TOKEN: "token-1",
    });

    expect(chunks).toEqual([
      {
        fixId: "fix-1",
        kind: "llm_chunk",
        repoFullName: "kexi/example",
        repositoryId: 10001,
        sequence: 2,
        text: "chunk text",
        timestamp: "2026-06-21T00:00:03.000Z",
      },
    ]);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.structuredQuery.from).toEqual([{ collectionId: "fixPrStreamChunks" }]);
    const filters = body.structuredQuery.where.compositeFilter.filters;
    expect(filters).toEqual([
      {
        fieldFilter: {
          field: { fieldPath: "fixId" },
          op: "EQUAL",
          value: { stringValue: "fix-1" },
        },
      },
      {
        fieldFilter: {
          field: { fieldPath: "sequence" },
          op: "GREATER_THAN",
          value: { integerValue: "1" },
        },
      },
    ]);
  });

  it("returns no chunks without querying when the fix id is empty", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const chunks = await listFixPrStreamChunks("", -1, {
      GOOGLE_CLOUD_PROJECT: "scanveil-project",
      GOOGLE_OAUTH_ACCESS_TOKEN: "token-1",
    });

    expect(chunks).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function scanRun(): ScanRunRecord {
  return {
    defaultBranch: "main",
    deliveryId: "delivery-1",
    headSha: "abc123",
    installationId: 123,
    llmEnabled: true,
    osvEnabled: true,
    owner: "kexi",
    queuedAt: "2026-06-21T00:00:00.000Z",
    reason: "manual",
    repo: "example",
    repositoryId: 10001,
    status: "succeeded",
    target: "repository",
    updatedAt: "2026-06-21T00:01:00.000Z",
  };
}

function scanFinding(): ScanFindingRecord {
  return {
    aliases: [],
    category: "xss",
    confidence: 0.95,
    deliveryId: "delivery-1",
    endLine: 12,
    evidence: "innerHTML receives user input.",
    file: "src/app.ts",
    findingId: "AIVULN-1",
    recommendation: "Use textContent.",
    repoFullName: "kexi/example",
    repositoryId: 10001,
    severity: "high",
    source: "llm",
    startLine: 12,
    sveId: "SVE-1",
    title: "DOM XSS",
    writtenAt: "2026-06-21T00:00:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function fixPrRunFields(overrides: {
  errorMessage?: string;
  status: "failed" | "queued" | "running" | "succeeded";
}) {
  return {
    baseSha: { stringValue: "abc123" },
    defaultBranch: { stringValue: "main" },
    deliveryId: { stringValue: "delivery-1" },
    endLine: { integerValue: "12" },
    errorMessage: { stringValue: overrides.errorMessage ?? "GitHub request failed: 403" },
    evidence: { stringValue: "innerHTML receives user input." },
    executionName: {
      stringValue:
        "projects/scanveil-project/locations/us-central1/jobs/scanveil-worker/executions/fix-1",
    },
    file: { stringValue: "src/app.ts" },
    findingId: { stringValue: "AIVULN-1" },
    finishedAt: { timestampValue: "2026-06-21T00:03:00.000Z" },
    fixId: { stringValue: "fix-1" },
    installationId: { integerValue: "123" },
    owner: { stringValue: "kexi" },
    queuedAt: { timestampValue: "2026-06-21T00:02:00.000Z" },
    recommendation: { stringValue: "Use textContent." },
    repo: { stringValue: "example" },
    repositoryId: { integerValue: "10001" },
    severity: { stringValue: "high" },
    startLine: { integerValue: "12" },
    status: { stringValue: overrides.status },
    sveId: { stringValue: "SVE-1" },
    title: { stringValue: "DOM XSS" },
    updatedAt: { timestampValue: "2026-06-21T00:02:30.000Z" },
  };
}

function createTestPrivateKey(): string {
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return keyPair.privateKey.export({ format: "pem", type: "pkcs1" }).toString();
}
