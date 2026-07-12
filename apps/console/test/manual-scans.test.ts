import { defaultLockfileGlobs } from "@scanveil/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readRepositoryScanConfig,
  startAllManualScans,
  startRepositoryManualScan,
  startSveVerificationScans,
} from "../src/manual-scans.js";

const kexiSession = { githubLogin: "kexi", githubUserId: "1001" };
const kexiOrgSession = {
  accessibleRepositoryFullNames: ["kexi/example"],
  accessibleRepositoryIds: [10001],
  githubLogin: "kexi",
  githubUserId: "1001",
  organizationLogins: ["other-org"],
};

const { createInstallationTokenMock, getRepositoryFileMock, listGitHubAppRepositoriesMock } =
  vi.hoisted(() => ({
    createInstallationTokenMock: vi.fn(),
    getRepositoryFileMock: vi.fn(),
    listGitHubAppRepositoriesMock: vi.fn(),
  }));

vi.mock("@scanveil/github", () => ({
  createInstallationToken: createInstallationTokenMock,
  getGitHubAppPullRequest: vi.fn(),
  GitHubClient: class {
    getRepositoryFile = getRepositoryFileMock;
  },
  listGitHubAppRepositories: listGitHubAppRepositoriesMock,
}));

describe("startAllManualScans", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    createInstallationTokenMock.mockReset();
    getRepositoryFileMock.mockReset();
    listGitHubAppRepositoriesMock.mockReset();
  });

  it("queues repository-wide worker jobs and writes scan history records", async () => {
    listGitHubAppRepositoriesMock.mockResolvedValue([
      {
        accountLogin: "kexi",
        accountType: "User",
        defaultBranch: "main",
        defaultBranchHeadSha: "sha-1",
        fullName: "kexi/example",
        htmlUrl: "https://github.com/kexi/example",
        installationId: 123,
        isPrivate: false,
        openPullRequests: [],
        repositoryId: 10001,
        updatedAt: "2026-06-21T00:00:00.000Z",
      },
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(installationPolicyResponse())
      .mockResolvedValueOnce(
        Response.json({
          metadata: {
            target:
              "projects/scanveil-project/locations/us-central1/jobs/scanveil-worker/executions/run-1",
          },
          name: "projects/scanveil-project/locations/us-central1/operations/operation-1",
        }),
      )
      .mockResolvedValueOnce(Response.json({ name: "scanRuns/manual-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await startAllManualScans(
      {
        llmEnabled: true,
        llmModel: "gemini-3.5-flash",
        osvEnabled: true,
      },
      kexiSession,
      {
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        GOOGLE_CLOUD_PROJECT: "scanveil-project",
        GOOGLE_CLOUD_REGION: "us-central1",
        GOOGLE_OAUTH_ACCESS_TOKEN: "token-1",
        SCAN_WORKER_JOB_NAME: "scanveil-worker",
      } as NodeJS.ProcessEnv,
    );

    expect(result.executionNames).toEqual([
      "projects/scanveil-project/locations/us-central1/jobs/scanveil-worker/executions/run-1",
    ]);
    expect(result.scanRequests).toHaveLength(1);
    expect(result.scanRequests[0]).toMatchObject({
      defaultBranch: "main",
      headSha: "sha-1",
      installationId: 123,
      llmEnabled: true,
      llmModel: "gemini-3.5-flash",
      osvEnabled: true,
      owner: "kexi",
      reason: "manual",
      repo: "example",
      repositoryId: 10001,
      target: "repository",
    });

    const runJobBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const scanRequestJson = runJobBody.overrides.containerOverrides[0].env[0].value as string;
    const scanRequest = JSON.parse(scanRequestJson);
    expect(scanRequest).toMatchObject({
      defaultBranch: "main",
      headSha: "sha-1",
      installationId: 123,
      llmEnabled: true,
      llmModel: "gemini-3.5-flash",
      osvEnabled: true,
      owner: "kexi",
      reason: "manual",
      repo: "example",
      repositoryId: 10001,
      target: "repository",
    });

    const firestoreBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(firestoreBody.fields).toMatchObject({
      deliveryId: { stringValue: scanRequest.deliveryId },
      executionName: {
        stringValue:
          "projects/scanveil-project/locations/us-central1/jobs/scanveil-worker/executions/run-1",
      },
      headSha: { stringValue: "sha-1" },
      installationId: { integerValue: "123" },
      llmEnabled: { booleanValue: true },
      llmModel: { stringValue: "gemini-3.5-flash" },
      osvEnabled: { booleanValue: true },
      owner: { stringValue: "kexi" },
      reason: { stringValue: "manual" },
      repo: { stringValue: "example" },
      repositoryId: { integerValue: "10001" },
      runnerRegion: { stringValue: "us-central1" },
      status: { stringValue: "queued" },
      target: { stringValue: "repository" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://run.googleapis.com/v2/projects/scanveil-project/locations/us-central1/jobs/scanveil-worker:run",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer token-1" }),
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/projects/scanveil-project/databases/(default)/documents/scanRuns/"),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer token-1" }),
        method: "PATCH",
      }),
    );
  });

  it("does not queue repositories outside the user's account and organizations", async () => {
    listGitHubAppRepositoriesMock.mockResolvedValue([
      {
        accountLogin: "other-org",
        accountType: "Organization",
        defaultBranch: "main",
        defaultBranchHeadSha: "sha-other",
        fullName: "other-org/private-repo",
        htmlUrl: "https://github.com/other-org/private-repo",
        installationId: 456,
        isPrivate: true,
        openPullRequests: [],
        repositoryId: 20001,
        updatedAt: "2026-06-21T00:00:00.000Z",
      },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(installationPolicyResponse(456)));

    await expect(
      startAllManualScans({ llmEnabled: true, osvEnabled: true }, kexiSession, {
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        GOOGLE_CLOUD_PROJECT: "scanveil-project",
        GOOGLE_CLOUD_REGION: "us-central1",
        GOOGLE_OAUTH_ACCESS_TOKEN: "token-1",
        SCAN_WORKER_JOB_NAME: "scanveil-worker",
      } as NodeJS.ProcessEnv),
    ).rejects.toThrow("GitHub App repositories are not available to scan");
  });

  it("does not queue organization repositories that the signed-in user cannot access", async () => {
    listGitHubAppRepositoriesMock.mockResolvedValue([
      {
        accountLogin: "other-org",
        accountType: "Organization",
        defaultBranch: "main",
        defaultBranchHeadSha: "sha-other",
        fullName: "other-org/private-repo",
        htmlUrl: "https://github.com/other-org/private-repo",
        installationId: 456,
        isPrivate: true,
        openPullRequests: [],
        repositoryId: 20001,
        updatedAt: "2026-06-21T00:00:00.000Z",
      },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(installationPolicyResponse(456)));

    await expect(
      startAllManualScans({ llmEnabled: true, osvEnabled: true }, kexiOrgSession, {
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        GOOGLE_CLOUD_PROJECT: "scanveil-project",
        GOOGLE_CLOUD_REGION: "us-central1",
        GOOGLE_OAUTH_ACCESS_TOKEN: "token-1",
        SCAN_WORKER_JOB_NAME: "scanveil-worker",
      } as NodeJS.ProcessEnv),
    ).rejects.toThrow("GitHub App repositories are not available to scan");
  });

  it("loads repository config from .scanveil/config.yml", async () => {
    createInstallationTokenMock.mockResolvedValue("github-token");
    listGitHubAppRepositoriesMock.mockResolvedValue([
      {
        accountLogin: "kexi",
        accountType: "User",
        defaultBranch: "main",
        defaultBranchHeadSha: "sha-1",
        fullName: "kexi/example",
        htmlUrl: "https://github.com/kexi/example",
        installationId: 123,
        isPrivate: false,
        openPullRequests: [],
        repositoryId: 10001,
        updatedAt: "2026-06-21T00:00:00.000Z",
      },
    ]);
    getRepositoryFileMock.mockResolvedValueOnce("version: 1\nscan:\n  llm:\n    enabled: false\n");

    const result = await readRepositoryScanConfig(
      {
        defaultBranchHeadSha: "sha-1",
        installationId: 123,
        owner: "kexi",
        repo: "example",
        repositoryId: 10001,
      },
      kexiSession,
      {
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "private-key",
      } as NodeJS.ProcessEnv,
    );

    expect(result).toEqual({
      path: ".scanveil/config.yml",
      source: "version: 1\nscan:\n  llm:\n    enabled: false\n",
      status: "repository",
      warnings: [],
    });
    expect(getRepositoryFileMock).toHaveBeenCalledWith(
      "kexi",
      "example",
      ".scanveil/config.yml",
      "sha-1",
    );
  });

  it("falls back to a default config whose lockfileGlobs match core and cover subdirectories", async () => {
    listGitHubAppRepositoriesMock.mockResolvedValue([
      {
        accountLogin: "kexi",
        accountType: "User",
        defaultBranch: "main",
        defaultBranchHeadSha: "sha-1",
        fullName: "kexi/example",
        htmlUrl: "https://github.com/kexi/example",
        installationId: 123,
        isPrivate: false,
        openPullRequests: [],
        repositoryId: 10001,
        updatedAt: "2026-06-21T00:00:00.000Z",
      },
    ]);
    getRepositoryFileMock.mockResolvedValue(undefined);

    const result = await readRepositoryScanConfig(
      {
        defaultBranchHeadSha: "sha-1",
        installationId: 123,
        owner: "kexi",
        repo: "example",
        repositoryId: 10001,
      },
      kexiSession,
      {
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "private-key",
      } as NodeJS.ProcessEnv,
    );

    expect(result.status).toBe("default");
    for (const glob of defaultLockfileGlobs) {
      expect(result.source).toContain(`- "${glob}"`);
    }
    expect(result.source).not.toMatch(/- "package-lock\.json"/);
    expect(result.source).not.toMatch(/- "pnpm-lock\.yaml"/);
  });

  it("rejects repository config reads when repositoryId is paired with another repository", async () => {
    listGitHubAppRepositoriesMock.mockResolvedValue([
      {
        accountLogin: "kexi",
        accountType: "User",
        defaultBranch: "main",
        defaultBranchHeadSha: "sha-1",
        fullName: "kexi/example",
        htmlUrl: "https://github.com/kexi/example",
        installationId: 123,
        isPrivate: false,
        openPullRequests: [],
        repositoryId: 10001,
        updatedAt: "2026-06-21T00:00:00.000Z",
      },
    ]);

    await expect(
      readRepositoryScanConfig(
        {
          defaultBranchHeadSha: "sha-1",
          installationId: 123,
          owner: "other-org",
          repo: "private-repo",
          repositoryId: 10001,
        },
        {
          accessibleRepositoryFullNames: ["kexi/example"],
          accessibleRepositoryIds: [10001],
          githubLogin: "kexi",
          githubUserId: "1001",
        },
        {
          GITHUB_APP_ID: "1",
          GITHUB_APP_PRIVATE_KEY: "private-key",
        } as NodeJS.ProcessEnv,
      ),
    ).rejects.toThrow("repository_access_denied");
    expect(getRepositoryFileMock).not.toHaveBeenCalled();
  });

  it("queues a repository scan with a temporary config override", async () => {
    listGitHubAppRepositoriesMock.mockResolvedValue([
      {
        accountLogin: "kexi",
        accountType: "User",
        defaultBranch: "main",
        defaultBranchHeadSha: "sha-2",
        fullName: "kexi/example",
        htmlUrl: "https://github.com/kexi/example",
        installationId: 123,
        isPrivate: false,
        openPullRequests: [],
        repositoryId: 10001,
        updatedAt: "2026-06-21T00:00:00.000Z",
      },
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(installationPolicyResponse())
      .mockResolvedValueOnce(
        Response.json({
          name: "projects/scanveil-project/locations/us-central1/jobs/scanveil-worker/executions/run-2",
        }),
      )
      .mockResolvedValueOnce(Response.json({ name: "scanRuns/manual-2" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await startRepositoryManualScan(
      {
        configSource: "version: 1\nscan:\n  llm:\n    enabled: false\n",
        defaultBranch: "main",
        defaultBranchHeadSha: "sha-2",
        installationId: 123,
        llmEnabled: true,
        llmModel: "gemini-test-model",
        osvEnabled: false,
        owner: "kexi",
        repo: "example",
        repositoryId: 10001,
      },
      kexiSession,
      {
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        GOOGLE_CLOUD_PROJECT: "scanveil-project",
        GOOGLE_CLOUD_REGION: "us-central1",
        GOOGLE_OAUTH_ACCESS_TOKEN: "token-1",
        SCAN_WORKER_JOB_NAME: "scanveil-worker",
      } as NodeJS.ProcessEnv,
    );

    expect(result.scanRequest).toMatchObject({
      configSourceOverride: "version: 1\nscan:\n  llm:\n    enabled: false\n",
      defaultBranch: "main",
      headSha: "sha-2",
      installationId: 123,
      llmEnabled: true,
      llmModel: "gemini-test-model",
      osvEnabled: false,
      owner: "kexi",
      reason: "manual",
      repo: "example",
      repositoryId: 10001,
      target: "repository",
    });

    const runJobBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const scanRequestJson = runJobBody.overrides.containerOverrides[0].env[0].value as string;
    const scanRequest = JSON.parse(scanRequestJson);
    expect(scanRequest.configSourceOverride).toBe(
      "version: 1\nscan:\n  llm:\n    enabled: false\n",
    );
    expect(scanRequest.llmModel).toBe("gemini-test-model");
    expect(scanRequest.llmEnabled).toBe(true);
    expect(scanRequest.osvEnabled).toBe(false);

    const firestoreBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(firestoreBody.fields.llmEnabled).toEqual({ booleanValue: true });
    expect(firestoreBody.fields.llmModel).toEqual({ stringValue: "gemini-test-model" });
    expect(firestoreBody.fields.osvEnabled).toEqual({ booleanValue: false });
  });

  it("rejects a direct repository scan outside the user's account and organizations", async () => {
    listGitHubAppRepositoriesMock.mockResolvedValue([]);

    await expect(
      startRepositoryManualScan(
        {
          defaultBranch: "main",
          defaultBranchHeadSha: "sha-other",
          installationId: 456,
          llmEnabled: true,
          osvEnabled: true,
          owner: "other-org",
          repo: "private-repo",
          repositoryId: 20001,
        },
        kexiSession,
        {
          GITHUB_APP_ID: "1",
          GITHUB_APP_PRIVATE_KEY: "private-key",
          GOOGLE_CLOUD_PROJECT: "scanveil-project",
          GOOGLE_OAUTH_ACCESS_TOKEN: "token-1",
        } as NodeJS.ProcessEnv,
      ),
    ).rejects.toThrow("repository_access_denied");
  });

  it("rejects a direct repository scan when repositoryId is paired with a different owner and installation", async () => {
    listGitHubAppRepositoriesMock.mockResolvedValue([
      {
        accountLogin: "kexi",
        accountType: "User",
        defaultBranch: "main",
        defaultBranchHeadSha: "sha-1",
        fullName: "kexi/example",
        htmlUrl: "https://github.com/kexi/example",
        installationId: 123,
        isPrivate: false,
        openPullRequests: [],
        repositoryId: 10001,
        updatedAt: "2026-06-21T00:00:00.000Z",
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValueOnce(installationPolicyResponse(123));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startRepositoryManualScan(
        {
          defaultBranch: "main",
          defaultBranchHeadSha: "sha-other",
          installationId: 456,
          llmEnabled: true,
          osvEnabled: true,
          owner: "other-org",
          repo: "private-repo",
          repositoryId: 10001,
        },
        kexiOrgSession,
        {
          GITHUB_APP_ID: "1",
          GITHUB_APP_PRIVATE_KEY: "private-key",
          GOOGLE_CLOUD_PROJECT: "scanveil-project",
          GOOGLE_CLOUD_REGION: "us-central1",
          GOOGLE_OAUTH_ACCESS_TOKEN: "token-1",
          SCAN_WORKER_JOB_NAME: "scanveil-worker",
        } as NodeJS.ProcessEnv,
      ),
    ).rejects.toThrow("repository_access_denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a repository scan when the installation has no invite-backed policy", async () => {
    listGitHubAppRepositoriesMock.mockResolvedValue([
      {
        accountLogin: "kexi",
        accountType: "User",
        defaultBranch: "main",
        defaultBranchHeadSha: "sha-2",
        fullName: "kexi/example",
        htmlUrl: "https://github.com/kexi/example",
        installationId: 123,
        isPrivate: false,
        openPullRequests: [],
        repositoryId: 10001,
        updatedAt: "2026-06-21T00:00:00.000Z",
      },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{}", { status: 404 })));

    await expect(
      startRepositoryManualScan(
        {
          defaultBranch: "main",
          defaultBranchHeadSha: "sha-2",
          installationId: 123,
          llmEnabled: true,
          osvEnabled: true,
          owner: "kexi",
          repo: "example",
          repositoryId: 10001,
        },
        kexiSession,
        {
          GITHUB_APP_ID: "1",
          GITHUB_APP_PRIVATE_KEY: "private-key",
          GOOGLE_CLOUD_PROJECT: "scanveil-project",
          GOOGLE_OAUTH_ACCESS_TOKEN: "token-1",
        } as NodeJS.ProcessEnv,
      ),
    ).rejects.toThrow("GitHub App installation requires an enabled invite-backed policy");
  });

  it("queues one repository scan per SVE repository verification target", async () => {
    listGitHubAppRepositoriesMock.mockResolvedValue([
      {
        accountLogin: "kexi",
        accountType: "User",
        defaultBranch: "main",
        defaultBranchHeadSha: "sha-1",
        fullName: "kexi/example",
        htmlUrl: "https://github.com/kexi/example",
        installationId: 123,
        isPrivate: false,
        openPullRequests: [],
        repositoryId: 10001,
        updatedAt: "2026-06-21T00:00:00.000Z",
      },
    ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(installationPolicyResponse())
      .mockResolvedValueOnce(
        Response.json({
          name: "projects/scanveil-project/locations/us-central1/jobs/scanveil-worker/executions/run-3",
        }),
      )
      .mockResolvedValueOnce(Response.json({ name: "scanRuns/manual-3" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await startSveVerificationScans(
      [
        { repoFullName: "kexi/example", sveId: "SVE-1" },
        { repoFullName: "kexi/example", sveId: "SVE-2" },
      ],
      { llmEnabled: true, llmModel: "gemini-3.5-flash", osvEnabled: true },
      kexiSession,
      {
        GITHUB_APP_ID: "1",
        GITHUB_APP_PRIVATE_KEY: "private-key",
        GOOGLE_CLOUD_PROJECT: "scanveil-project",
        GOOGLE_CLOUD_REGION: "us-central1",
        GOOGLE_OAUTH_ACCESS_TOKEN: "token-1",
        SCAN_WORKER_JOB_NAME: "scanveil-worker",
      } as NodeJS.ProcessEnv,
    );

    expect(result.scanRequests).toHaveLength(1);
    expect(result.scanRequests[0]).toMatchObject({
      defaultBranch: "main",
      headSha: "sha-1",
      installationId: 123,
      llmEnabled: true,
      llmModel: "gemini-3.5-flash",
      osvEnabled: true,
      owner: "kexi",
      repo: "example",
      repositoryId: 10001,
      target: "repository",
    });
  });

  it("does not verify SVE targets outside the user's account and organizations", async () => {
    listGitHubAppRepositoriesMock.mockResolvedValue([
      {
        accountLogin: "other-org",
        accountType: "Organization",
        defaultBranch: "main",
        defaultBranchHeadSha: "sha-other",
        fullName: "other-org/private-repo",
        htmlUrl: "https://github.com/other-org/private-repo",
        installationId: 456,
        isPrivate: true,
        openPullRequests: [],
        repositoryId: 20001,
        updatedAt: "2026-06-21T00:00:00.000Z",
      },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(installationPolicyResponse(456)));

    await expect(
      startSveVerificationScans(
        [{ repoFullName: "other-org/private-repo", sveId: "SVE-other" }],
        { llmEnabled: true, osvEnabled: true },
        kexiSession,
        {
          GITHUB_APP_ID: "1",
          GITHUB_APP_PRIVATE_KEY: "private-key",
          GOOGLE_CLOUD_PROJECT: "scanveil-project",
          GOOGLE_CLOUD_REGION: "us-central1",
          GOOGLE_OAUTH_ACCESS_TOKEN: "token-1",
          SCAN_WORKER_JOB_NAME: "scanveil-worker",
        } as NodeJS.ProcessEnv,
      ),
    ).rejects.toThrow("SVE repositories are not available to scan");
  });
});

function installationPolicyResponse(installationId = 123): Response {
  return Response.json({
    fields: {
      enabled: { booleanValue: true },
      installationId: { integerValue: String(installationId) },
      inviteCode: { stringValue: "SV-INVITE" },
    },
  });
}
