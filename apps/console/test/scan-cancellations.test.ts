import { afterEach, describe, expect, it, vi } from "vitest";

import { cancelScanRun } from "../src/scan-cancellations.js";

describe("cancelScanRun", () => {
  const originalProject = process.env.GOOGLE_CLOUD_PROJECT;
  const originalToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;

  afterEach(() => {
    restoreEnv("GOOGLE_CLOUD_PROJECT", originalProject);
    restoreEnv("GOOGLE_OAUTH_ACCESS_TOKEN", originalToken);
    vi.unstubAllGlobals();
  });

  it("cancels the Cloud Run execution before marking the scan cancelled", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ fields: firestoreScanRunFields() }))
      .mockResolvedValueOnce(Response.json({ name: "operations/cancel-1" }))
      .mockResolvedValueOnce(Response.json({ name: "scanRuns/delivery-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const run = await cancelScanRun("delivery-1");

    expect(run.status).toBe("cancelled");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://run.googleapis.com/v2/projects/scanveil-project/locations/us-central1/jobs/scanveil-worker/executions/execution-1:cancel",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({ authorization: "Bearer token-1" }),
      method: "POST",
    });
    const patchBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(patchBody.fields).toMatchObject({
      errorMessage: { stringValue: "Cancelled by user" },
      status: { stringValue: "cancelled" },
    });
  });

  it("refuses to mark a scan cancelled when Cloud Run cancel fails", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ fields: firestoreScanRunFields() }))
      .mockResolvedValueOnce(new Response("permission denied", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelScanRun("delivery-1")).rejects.toThrow("Cloud Run execution cancel failed");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses to mark scans cancelled when only the Cloud Run operation is recorded", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "scanveil-project";
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN = "token-1";
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        fields: firestoreScanRunFields({
          executionName:
            "projects/scanveil-project/locations/us-central1/operations/070e1c05-514c-48b4-9e54-bd0896c07756",
          status: "queued",
        }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelScanRun("delivery-1")).rejects.toThrow(
      "Cloud Run execution is not recorded for this scan",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  const hasValue = value !== undefined;
  if (hasValue) {
    process.env[name] = value;
    return;
  }

  delete process.env[name];
}

function firestoreScanRunFields(overrides: { executionName?: string; status?: string } = {}) {
  const executionName =
    overrides.executionName ??
    "projects/scanveil-project/locations/us-central1/jobs/scanveil-worker/executions/execution-1";
  const status = overrides.status ?? "running";
  return {
    deliveryId: { stringValue: "delivery-1" },
    executionName: {
      stringValue: executionName,
    },
    headSha: { stringValue: "abc123" },
    installationId: { integerValue: "123" },
    owner: { stringValue: "kexi" },
    queuedAt: { timestampValue: "2026-06-21T00:00:00.000Z" },
    reason: { stringValue: "manual" },
    repo: { stringValue: "example" },
    status: { stringValue: status },
    target: { stringValue: "repository" },
    updatedAt: { timestampValue: "2026-06-21T00:01:00.000Z" },
  };
}
