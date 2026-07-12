import { afterEach, describe, expect, it, vi } from "vitest";

import { readCloudRunTerminalFailure } from "../src/cloud-run.js";

const missingImageMessage =
  "Image 'us-central1-docker.pkg.dev/kexi-380010/gcf-artifacts/scanveil-worker:a1ba159' not found.";

describe("readCloudRunTerminalFailure", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an operation error when Cloud Run fails before starting an execution", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          done: true,
          error: {
            code: 404,
            message: missingImageMessage,
          },
        }),
      ),
    );

    const failure = await readCloudRunTerminalFailure(
      "projects/kexi-380010/locations/us-central1/operations/operation-1",
      "token",
    );

    expect(failure).toEqual({
      message: missingImageMessage,
    });
  });

  it("returns an execution failure when the completed condition is false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          conditions: [
            {
              message: "Execution failed because the container exited with code 1.",
              status: "False",
              type: "Completed",
            },
          ],
        }),
      ),
    );

    const failure = await readCloudRunTerminalFailure(
      "projects/kexi-380010/locations/us-central1/jobs/scanveil-worker/executions/run-1",
      "token",
    );

    expect(failure).toEqual({
      message: "Execution failed because the container exited with code 1.",
    });
  });

  it("keeps active operations unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ done: false })),
    );

    const failure = await readCloudRunTerminalFailure(
      "projects/kexi-380010/locations/us-central1/operations/operation-1",
      "token",
    );

    expect(failure).toBeUndefined();
  });
});
