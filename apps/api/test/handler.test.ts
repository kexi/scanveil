import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { routeRequest } from "../src/handler.js";

describe("routeRequest", () => {
  const originalProject = process.env.GOOGLE_CLOUD_PROJECT;
  const originalRegion = process.env.GOOGLE_CLOUD_REGION;
  const originalToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  const originalWorkerJobName = process.env.SCAN_WORKER_JOB_NAME;
  const originalWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

  afterEach(() => {
    restoreEnv("GOOGLE_CLOUD_PROJECT", originalProject);
    restoreEnv("GOOGLE_CLOUD_REGION", originalRegion);
    restoreEnv("GOOGLE_OAUTH_ACCESS_TOKEN", originalToken);
    restoreEnv("SCAN_WORKER_JOB_NAME", originalWorkerJobName);
    restoreEnv("GITHUB_WEBHOOK_SECRET", originalWebhookSecret);
    vi.unstubAllGlobals();
  });

  it("enqueues pull request scans through the Cloud Run worker job", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_CLOUD_REGION = "us-central1";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    process.env.SCAN_WORKER_JOB_NAME = "scanveil-worker";
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            fields: {
              enabled: { booleanValue: true },
              installationId: { integerValue: "123" },
              inviteCode: { stringValue: "SV-INVITE" },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            metadata: {
              target:
                "projects/scanveil-project/locations/us-central1/jobs/scanveil-worker/executions/run-1",
            },
            name: "projects/scanveil-project/locations/us-central1/operations/operation-1",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = createResponse();
    const payload = pullRequestPayload();
    await routeRequest(
      createRequest({
        headers: {
          "x-github-delivery": "delivery-1",
          "x-github-event": "pull_request",
          "x-hub-signature-256": signPayload(payload, "webhook-secret"),
        },
        payload,
      }),
      response,
    );

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toEqual({ accepted: true, queued: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [runUrl, runInit] = fetchMock.mock.calls[1] ?? [];
    expect(runUrl).toBe(
      "https://run.googleapis.com/v2/projects/scanveil-project/locations/us-central1/jobs/scanveil-worker:run",
    );
    expect(runInit).toMatchObject({
      headers: {
        authorization: "Bearer token-1",
        "content-type": "application/json",
      },
      method: "POST",
    });
    expect(JSON.parse(String(runInit?.body))).toMatchObject({
      overrides: {
        containerOverrides: [
          {
            env: [
              {
                name: "SCAN_REQUEST_JSON",
              },
            ],
          },
        ],
      },
    });
    const scanRequestJson = JSON.parse(String(runInit?.body)).overrides.containerOverrides[0].env[0]
      .value;
    expect(JSON.parse(scanRequestJson)).toEqual({
      deliveryId: "delivery-1",
      headSha: "abc123",
      installationId: 123,
      llmEnabled: true,
      osvEnabled: true,
      owner: "kexi",
      pullNumber: 7,
      reason: "pull_request",
      repo: "example",
      repositoryId: 10001,
      target: "pull_request",
    });

    const [firestoreUrl, firestoreInit] = fetchMock.mock.calls[2] ?? [];
    expect(firestoreUrl).toContain(
      "/projects/scanveil-project/databases/(default)/documents/scanRuns/delivery-1",
    );
    expect(firestoreUrl).toContain("updateMask.fieldPaths=status");
    expect(firestoreUrl).toContain("updateMask.fieldPaths=executionName");
    expect(firestoreInit).toMatchObject({
      headers: {
        authorization: "Bearer token-1",
        "content-type": "application/json",
      },
      method: "PATCH",
    });
    expect(JSON.parse(String(firestoreInit?.body))).toMatchObject({
      fields: {
        deliveryId: { stringValue: "delivery-1" },
        executionName: {
          stringValue:
            "projects/scanveil-project/locations/us-central1/jobs/scanveil-worker/executions/run-1",
        },
        headSha: { stringValue: "abc123" },
        installationId: { integerValue: "123" },
        llmEnabled: { booleanValue: true },
        osvEnabled: { booleanValue: true },
        owner: { stringValue: "kexi" },
        pullNumber: { integerValue: "7" },
        reason: { stringValue: "pull_request" },
        repo: { stringValue: "example" },
        repositoryId: { integerValue: "10001" },
        status: { stringValue: "queued" },
        target: { stringValue: "pull_request" },
      },
    });
  });

  it("skips pull request scans when the installation has no invite-backed policy", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_CLOUD_REGION = "us-central1";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    process.env.SCAN_WORKER_JOB_NAME = "scanveil-worker";
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";

    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = createResponse();
    const payload = pullRequestPayload();
    await routeRequest(
      createRequest({
        headers: {
          "x-github-delivery": "delivery-1",
          "x-github-event": "pull_request",
          "x-hub-signature-256": signPayload(payload, "webhook-secret"),
        },
        payload,
      }),
      response,
    );

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toEqual({ accepted: true, queued: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips fork pull request scans instead of queuing an unusable check run", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_CLOUD_REGION = "us-central1";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    process.env.SCAN_WORKER_JOB_NAME = "scanveil-worker";
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = createResponse();
    const payload = pullRequestPayload({
      headRepositoryFullName: "contributor/example",
      repositoryFullName: "kexi/example",
    });
    await routeRequest(
      createRequest({
        headers: {
          "x-github-delivery": "delivery-1",
          "x-github-event": "pull_request",
          "x-hub-signature-256": signPayload(payload, "webhook-secret"),
        },
        payload,
      }),
      response,
    );

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toEqual({ accepted: true, queued: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips pull request scans when the head repository is unavailable", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_CLOUD_REGION = "us-central1";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    process.env.SCAN_WORKER_JOB_NAME = "scanveil-worker";
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = createResponse();
    const payload = pullRequestPayload({ omitHeadRepository: true });
    await routeRequest(
      createRequest({
        headers: {
          "x-github-delivery": "delivery-1",
          "x-github-event": "pull_request",
          "x-hub-signature-256": signPayload(payload, "webhook-secret"),
        },
        payload,
      }),
      response,
    );

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toEqual({ accepted: true, queued: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips pull request scans when the head repository is null", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_CLOUD_REGION = "us-central1";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    process.env.SCAN_WORKER_JOB_NAME = "scanveil-worker";
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = createResponse();
    const payload = pullRequestPayload({ nullHeadRepository: true });
    await routeRequest(
      createRequest({
        headers: {
          "x-github-delivery": "delivery-1",
          "x-github-event": "pull_request",
          "x-hub-signature-256": signPayload(payload, "webhook-secret"),
        },
        payload,
      }),
      response,
    );

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toEqual({ accepted: true, queued: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a Cloud Run worker job before acknowledging enabled scans", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_CLOUD_REGION = "us-central1";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    delete process.env.SCAN_WORKER_JOB_NAME;
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";

    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          fields: {
            enabled: { booleanValue: true },
            installationId: { integerValue: "123" },
            inviteCode: { stringValue: "SV-INVITE" },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = createResponse();
    const payload = pullRequestPayload();
    await expect(
      routeRequest(
        createRequest({
          headers: {
            "x-github-delivery": "delivery-1",
            "x-github-event": "pull_request",
            "x-hub-signature-256": signPayload(payload, "webhook-secret"),
          },
          payload,
        }),
        response,
      ),
    ).rejects.toThrow("Missing required environment variable: SCAN_WORKER_JOB_NAME");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects pull request webhooks with an invalid signature", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";

    const response = createResponse();
    await routeRequest(
      createRequest({
        headers: {
          "x-github-delivery": "delivery-1",
          "x-github-event": "pull_request",
          "x-hub-signature-256": "sha256=bad",
        },
        payload: pullRequestPayload(),
      }),
      response,
    );

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: "invalid_signature" });
  });

  it("rejects signed webhook requests without GitHub event headers", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";

    const response = createResponse();
    const payload = pullRequestPayload();
    await routeRequest(
      createRequest({
        headers: {
          "x-hub-signature-256": signPayload(payload, "webhook-secret"),
        },
        payload,
      }),
      response,
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "missing_github_headers" });
  });

  it("rejects signed webhook requests with invalid JSON", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";

    const response = createResponse();
    const payload = "{";
    await routeRequest(
      createRawRequest({
        headers: {
          "x-github-delivery": "delivery-1",
          "x-github-event": "pull_request",
          "x-hub-signature-256": signRawPayload(payload, "webhook-secret"),
        },
        payload,
      }),
      response,
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "invalid_json" });
  });

  it("rejects signed webhook requests with a non-object JSON payload", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";

    const response = createResponse();
    const payload = "null";
    await routeRequest(
      createRawRequest({
        headers: {
          "x-github-delivery": "delivery-1",
          "x-github-event": "pull_request",
          "x-hub-signature-256": signRawPayload(payload, "webhook-secret"),
        },
        payload,
      }),
      response,
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "invalid_payload" });
  });

  it("skips malformed pull request payloads without throwing", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = createResponse();
    const payload = {
      ...pullRequestPayload(),
      pull_request: {},
    };
    await routeRequest(
      createRequest({
        headers: {
          "x-github-delivery": "delivery-1",
          "x-github-event": "pull_request",
          "x-hub-signature-256": signPayload(payload, "webhook-secret"),
        },
        payload,
      }),
      response,
    );

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toEqual({ accepted: true, queued: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not accept the root path as a webhook endpoint", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret";

    const response = createResponse();
    const payload = pullRequestPayload();
    await routeRequest(
      createRequest({
        headers: {
          "x-github-delivery": "delivery-1",
          "x-github-event": "pull_request",
          "x-hub-signature-256": signPayload(payload, "webhook-secret"),
        },
        payload,
        url: "/",
      }),
      response,
    );

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({ error: "not_found" });
  });

  it("fails closed when the webhook secret is not configured", async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;

    const response = createResponse();
    await routeRequest(
      createRequest({
        headers: {
          "x-github-delivery": "delivery-1",
          "x-github-event": "pull_request",
        },
        payload: pullRequestPayload(),
      }),
      response,
    );

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ error: "missing_webhook_secret" });
  });
});

function createRequest({
  headers,
  payload,
  url = "/webhooks/github",
}: {
  headers: Record<string, string>;
  payload: unknown;
  url?: string;
}): IncomingMessage {
  return {
    headers,
    method: "POST",
    rawBody: Buffer.from(JSON.stringify(payload)),
    url,
  } as unknown as IncomingMessage;
}

function createRawRequest({
  headers,
  payload,
  url = "/webhooks/github",
}: {
  headers: Record<string, string>;
  payload: string;
  url?: string;
}): IncomingMessage {
  return {
    headers,
    method: "POST",
    rawBody: Buffer.from(payload),
    url,
  } as unknown as IncomingMessage;
}

function createResponse(): ServerResponse & {
  body: string;
  headers: Record<string, string> | undefined;
  statusCode: number;
} {
  const response = {
    body: "",
    headers: undefined as Record<string, string> | undefined,
    statusCode: 0,
    end(body: string) {
      this.body = body;
    },
    writeHead(statusCode: number, headers: Record<string, string>) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
  };
  return response as unknown as ServerResponse & typeof response;
}

function pullRequestPayload(
  options: {
    headRepositoryFullName?: string;
    nullHeadRepository?: boolean;
    omitHeadRepository?: boolean;
    repositoryFullName?: string;
  } = {},
) {
  const repositoryFullName = options.repositoryFullName ?? "kexi/example";
  const headRepositoryFullName = options.headRepositoryFullName ?? repositoryFullName;
  return {
    action: "opened",
    installation: {
      id: 123,
    },
    pull_request: {
      head: {
        ...(options.nullHeadRepository
          ? { repo: null }
          : options.omitHeadRepository
            ? {}
            : {
                repo: {
                  full_name: headRepositoryFullName,
                },
              }),
        sha: "abc123",
      },
      number: 7,
    },
    repository: {
      full_name: repositoryFullName,
      id: 10001,
      name: "example",
      owner: {
        login: "kexi",
      },
    },
  };
}

function signPayload(payload: unknown, secret: string): string {
  return signRawPayload(JSON.stringify(payload), secret);
}

function signRawPayload(payload: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

function restoreEnv(name: string, value: string | undefined): void {
  const hasValue = value !== undefined;
  if (hasValue) {
    process.env[name] = value;
    return;
  }

  delete process.env[name];
}
