import { describe, expect, it } from "vitest";

import type { FixPrRequest, ScanRequest } from "@scanveil/core";
import { GitHubRequestError, type GitHubAppRepository } from "@scanveil/github";

import { runWorkerEntrypoint } from "../src/worker-entry.js";

describe("runWorkerEntrypoint", () => {
  it("creates scheduled repository scans when SCAN_REQUEST_JSON is absent", async () => {
    const queued: ScanRequest[] = [];
    const running: ScanRequest[] = [];
    const scanned: ScanRequest[] = [];

    await runWorkerEntrypoint({
      env: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private-key",
      },
      listRepositories: async () => [
        repository("kexi/example", "main", "abc123", 101),
        repository("kexi/another", "trunk", "def456", 102),
      ],
      filterRepositories: async (repositories) => repositories,
      markQueued: async (request) => {
        queued.push(request);
      },
      markRunning: async (request) => {
        running.push(request);
      },
      randomUuid: createUuidSequence("one", "two"),
      runScan: async (request) => {
        scanned.push(request);
      },
      writeLog: () => {},
    });

    expect(queued).toEqual(scanned);
    expect(running).toEqual(scanned);
    expect(scanned).toEqual([
      {
        defaultBranch: "main",
        deliveryId: "scheduled-one",
        headSha: "abc123",
        installationId: 101,
        llmEnabled: true,
        osvEnabled: true,
        owner: "kexi",
        reason: "scheduled",
        repo: "example",
        repositoryId: 10001,
        target: "repository",
      },
      {
        defaultBranch: "trunk",
        deliveryId: "scheduled-two",
        headSha: "def456",
        installationId: 102,
        llmEnabled: true,
        osvEnabled: true,
        owner: "kexi",
        reason: "scheduled",
        repo: "another",
        repositoryId: 10002,
        target: "repository",
      },
    ]);
  });

  it("skips scheduled scans for repositories with an empty default branch head sha", async () => {
    const scanned: ScanRequest[] = [];
    const logs: unknown[] = [];

    await runWorkerEntrypoint({
      env: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private-key",
      },
      listRepositories: async () => [
        repository("kexi/empty", "main", "", 101),
        repository("kexi/populated", "main", "def456", 102),
      ],
      filterRepositories: async (repositories) => repositories,
      markQueued: async () => {},
      markRunning: async () => {},
      randomUuid: createUuidSequence("one"),
      runScan: async (request) => {
        scanned.push(request);
      },
      writeLog: (record) => {
        logs.push(record);
      },
    });

    expect(scanned.map((request) => request.repo)).toEqual(["populated"]);
    expect(logs).toContainEqual(
      expect.objectContaining({
        message: "scheduled_scan_repository_skipped_empty_head",
        owner: "kexi",
        repo: "empty",
      }),
    );
  });

  it("passes a Cloud Run execution name to scheduled scan queued records", async () => {
    const queued: Array<{ executionName: string | undefined; request: ScanRequest }> = [];

    await runWorkerEntrypoint({
      env: {
        CLOUD_RUN_EXECUTION: "scanveil-worker-abcde",
        CLOUD_RUN_JOB: "scanveil-worker",
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        GOOGLE_CLOUD_PROJECT: "scanveil-project",
        GOOGLE_CLOUD_REGION: "us-central1",
      },
      listRepositories: async () => [repository("kexi/example", "main", "abc123", 101)],
      filterRepositories: async (repositories) => repositories,
      markQueued: async (request, executionName) => {
        queued.push({ executionName, request });
      },
      markRunning: async () => {},
      randomUuid: createUuidSequence("one"),
      runScan: async () => {},
      writeLog: () => {},
    });

    expect(queued).toHaveLength(1);
    expect(queued[0]?.executionName).toBe(
      "projects/scanveil-project/locations/us-central1/jobs/scanveil-worker/executions/scanveil-worker-abcde",
    );
  });

  it("continues scheduled repository scans after one repository fails", async () => {
    const scanned: ScanRequest[] = [];
    const failed: Array<{ error: unknown; request: ScanRequest }> = [];
    const logs: unknown[] = [];

    await runWorkerEntrypoint({
      env: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private-key",
      },
      listRepositories: async () => [
        repository("kexi/first", "main", "abc123", 101),
        repository("kexi/second", "main", "def456", 102),
      ],
      filterRepositories: async (repositories) => repositories,
      markFailed: async (request, error) => {
        failed.push({ error, request });
      },
      markQueued: async () => {},
      markRunning: async () => {},
      randomUuid: createUuidSequence("one", "two"),
      runScan: async (request) => {
        scanned.push(request);
        const isFirstRepo = request.repo === "first";
        if (isFirstRepo) {
          throw new Error("scan failed");
        }
      },
      writeLog: (record) => {
        logs.push(record);
      },
    });

    expect(scanned.map((request) => request.repo)).toEqual(["first", "second"]);
    expect(failed).toHaveLength(1);
    expect(logs).toContainEqual(
      expect.objectContaining({
        failedCount: 1,
        message: "scheduled_scan_finished",
        repositoryCount: 2,
      }),
    );
  });

  it("skips repositories disabled by installation policy", async () => {
    const scanned: ScanRequest[] = [];

    await runWorkerEntrypoint({
      env: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private-key",
      },
      filterRepositories: async (repositories) =>
        repositories.filter((repository) => repository.installationId === 102),
      listRepositories: async () => [
        repository("kexi/blocked", "main", "abc123", 101),
        repository("kexi/allowed", "main", "def456", 102),
      ],
      markQueued: async () => {},
      markRunning: async () => {},
      randomUuid: createUuidSequence("one"),
      runScan: async (request) => {
        scanned.push(request);
      },
      writeLog: () => {},
    });

    expect(scanned.map((request) => request.repo)).toEqual(["allowed"]);
  });

  it("runs direct scan requests that match the installation repository", async () => {
    const scanned: ScanRequest[] = [];
    const request: ScanRequest = {
      defaultBranch: "main",
      deliveryId: "manual-valid",
      headSha: "abc123",
      installationId: 101,
      llmEnabled: true,
      osvEnabled: true,
      owner: "kexi",
      reason: "manual",
      repo: "example",
      repositoryId: 10001,
      target: "repository",
    };

    await runWorkerEntrypoint({
      env: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        SCAN_REQUEST_JSON: JSON.stringify(request),
      },
      getRepository: async (_config, input) => repositoryFor(input),
      markRunning: async () => {},
      runScan: async (scanRequest) => {
        scanned.push(scanRequest);
      },
      writeLog: () => {},
    });

    expect(scanned).toEqual([request]);
  });

  it("rejects direct scan requests whose repository identity does not match the installation", async () => {
    const scanned: ScanRequest[] = [];
    const request: ScanRequest = {
      defaultBranch: "main",
      deliveryId: "manual-tampered",
      headSha: "sha-other",
      installationId: 456,
      llmEnabled: true,
      osvEnabled: true,
      owner: "other-org",
      reason: "manual",
      repo: "private-repo",
      repositoryId: 10001,
      target: "repository",
    };

    await expect(
      runWorkerEntrypoint({
        env: {
          GITHUB_APP_ID: "123",
          GITHUB_APP_PRIVATE_KEY: "private-key",
          SCAN_REQUEST_JSON: JSON.stringify(request),
        },
        getRepository: async (_config, input) => repositoryFor(input, 99999),
        markRunning: async () => {
          throw new Error("markRunning should not be called for unauthorized requests");
        },
        runScan: async (scanRequest) => {
          scanned.push(scanRequest);
        },
        writeLog: () => {},
      }),
    ).rejects.toThrow("SCAN_REQUEST_JSON repository does not match");
    expect(scanned).toEqual([]);
  });

  it("rejects a scan request for a repository outside the installation as a mismatch", async () => {
    const scanned: ScanRequest[] = [];
    const request: ScanRequest = {
      defaultBranch: "main",
      deliveryId: "manual-outside",
      headSha: "abc123",
      installationId: 101,
      llmEnabled: true,
      osvEnabled: true,
      owner: "kexi",
      reason: "manual",
      repo: "example",
      repositoryId: 10001,
      target: "repository",
    };

    await expect(
      runWorkerEntrypoint({
        env: {
          GITHUB_APP_ID: "123",
          GITHUB_APP_PRIVATE_KEY: "private-key",
          SCAN_REQUEST_JSON: JSON.stringify(request),
        },
        getRepository: async () => {
          throw new GitHubRequestError(404, '{"message":"Not Found"}');
        },
        markRunning: async () => {
          throw new Error("markRunning should not be called for unauthorized requests");
        },
        runScan: async (scanRequest) => {
          scanned.push(scanRequest);
        },
        writeLog: () => {},
      }),
    ).rejects.toThrow("SCAN_REQUEST_JSON repository does not match");
    expect(scanned).toEqual([]);
  });

  it("validates the request repository without enumerating other installations", async () => {
    const scanned: ScanRequest[] = [];
    const request: ScanRequest = {
      defaultBranch: "main",
      deliveryId: "manual-valid",
      headSha: "abc123",
      installationId: 101,
      llmEnabled: true,
      osvEnabled: true,
      owner: "kexi",
      reason: "manual",
      repo: "example",
      repositoryId: 10001,
      target: "repository",
    };

    await runWorkerEntrypoint({
      env: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        SCAN_REQUEST_JSON: JSON.stringify(request),
      },
      getRepository: async (_config, input) => {
        const isRequestInstallation = input.installationId === 101;
        if (!isRequestInstallation) {
          throw new Error("must not touch other installations");
        }
        return repositoryFor(input);
      },
      listRepositories: async () => {
        throw new Error("suspended installation should not be enumerated");
      },
      markRunning: async () => {},
      runScan: async (scanRequest) => {
        scanned.push(scanRequest);
      },
      writeLog: () => {},
    });

    expect(scanned).toEqual([request]);
  });

  it("marks direct scan requests failed when repository validation fails", async () => {
    const failed: Array<{ error: unknown; request: ScanRequest }> = [];
    const request: ScanRequest = {
      defaultBranch: "main",
      deliveryId: "manual-tampered",
      headSha: "sha-other",
      installationId: 456,
      llmEnabled: true,
      osvEnabled: true,
      owner: "other-org",
      reason: "manual",
      repo: "private-repo",
      repositoryId: 10001,
      target: "repository",
    };

    await expect(
      runWorkerEntrypoint({
        env: {
          GITHUB_APP_ID: "123",
          GITHUB_APP_PRIVATE_KEY: "private-key",
          SCAN_REQUEST_JSON: JSON.stringify(request),
        },
        getRepository: async (_config, input) => repositoryFor(input, 99999),
        markFailed: async (scanRequest, error) => {
          failed.push({ error, request: scanRequest });
        },
        markRunning: async () => {
          throw new Error("markRunning should not be called for unauthorized requests");
        },
        runScan: async () => {
          throw new Error("runScan should not be called for unauthorized requests");
        },
        writeLog: () => {},
      }),
    ).rejects.toThrow("SCAN_REQUEST_JSON repository does not match");

    expect(failed).toEqual([
      {
        error: expect.any(Error),
        request,
      },
    ]);
  });

  it("runs fix PR requests when FIX_PR_REQUEST_JSON is present", async () => {
    const fixed: FixPrRequest[] = [];
    const request = fixPrRequest();

    await runWorkerEntrypoint({
      env: {
        FIX_PR_REQUEST_JSON: JSON.stringify(request),
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private-key",
      },
      getRepository: async (_config, input) => repositoryFor(input, request.repositoryId),
      runFixPr: async (fixRequest) => {
        fixed.push(fixRequest);
      },
      runScan: async () => {
        throw new Error("runScan should not be called for fix PR requests");
      },
    });

    expect(fixed).toEqual([request]);
  });

  it("marks fix PR requests failed when repository validation fails", async () => {
    const failed: Array<{ error: unknown; fixId: string }> = [];
    const request = {
      ...fixPrRequest(),
      owner: "other-org",
      repo: "private-repo",
    };

    await expect(
      runWorkerEntrypoint({
        env: {
          FIX_PR_REQUEST_JSON: JSON.stringify(request),
          GITHUB_APP_ID: "123",
          GITHUB_APP_PRIVATE_KEY: "private-key",
        },
        getRepository: async (_config, input) => repositoryFor(input, 99999),
        markFixPrFailed: async (fixId, error) => {
          failed.push({ error, fixId });
        },
        runFixPr: async () => {
          throw new Error("runFixPr should not be called for unauthorized requests");
        },
      }),
    ).rejects.toThrow("FIX_PR_REQUEST_JSON repository does not match");

    expect(failed).toEqual([
      {
        error: expect.any(Error),
        fixId: request.fixId,
      },
    ]);
  });
});

function repositoryFor(
  input: { owner: string; repo: string },
  repositoryId = 10001,
): { fullName: string; repositoryId: number } {
  return { fullName: `${input.owner}/${input.repo}`, repositoryId };
}

function repository(
  fullName: string,
  defaultBranch: string,
  defaultBranchHeadSha: string,
  installationId: number,
): GitHubAppRepository {
  const repositoryId = installationId + 9900;
  return {
    accountLogin: "kexi",
    accountType: "User",
    defaultBranch,
    defaultBranchHeadSha,
    fullName,
    htmlUrl: `https://github.com/${fullName}`,
    installationId,
    isPrivate: false,
    openPullRequests: [],
    repositoryId,
    updatedAt: "2026-06-20T00:00:00Z",
  };
}

function createUuidSequence(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? "fallback";
}

function fixPrRequest(): FixPrRequest {
  return {
    defaultBranch: "main",
    deliveryId: "delivery-1",
    endLine: 12,
    evidence: "innerHTML receives user input.",
    file: "src/app.ts",
    findingId: "AIVULN-1",
    fixId: "fix-1",
    headSha: "abc123",
    installationId: 101,
    owner: "kexi",
    recommendation: "Use textContent.",
    repo: "example",
    repositoryId: 10001,
    severity: "high",
    startLine: 12,
    sveId: "SVE-1",
    title: "DOM XSS",
  };
}
