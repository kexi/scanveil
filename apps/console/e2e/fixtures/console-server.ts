import type {
  FixPrRunRecord,
  FixPrStreamChunkRecord,
  InstallationPolicy,
  InstallationScanPolicy,
  ScanFindingRecord,
  ScanRunRecord,
  ScanStreamChunkRecord,
} from "@scanveil/core";

import {
  InviteRedeemError,
  InviteRequiredError,
  UserDisabledError,
  type ConsoleUserSession,
  type InviteAccess,
} from "../../src/invites.js";
import { createConsoleServer, type ConsoleServerDependencies } from "../../src/server.js";

const e2eSessionSecret = "scanveil-console-e2e-secret";
const port = Number(process.env.PORT ?? "4174");

const repository = {
  account: "kexi (User)",
  defaultBranch: "main",
  defaultBranchHeadSha: "abc123",
  fullName: "kexi/example",
  htmlUrl: "https://github.com/kexi/example",
  installationId: 123,
  openPullRequests: [
    {
      author: "octocat",
      headSha: "def456",
      htmlUrl: "https://github.com/kexi/example/pull/7",
      isDraft: false,
      number: 7,
      title: "Harden console scan flow",
      updatedAt: "2026/06/21 09:00",
    },
  ],
  owner: "kexi",
  repo: "example",
  repositoryId: 10001,
  updatedAt: "2026/06/21 10:00",
  visibility: "Public",
};

const installationPolicy: InstallationPolicy = {
  accountLogin: "kexi",
  accountType: "User",
  enabled: true,
  installationId: 123,
  inviteCode: "E2ECODE",
  inviteName: "E2E",
  repositoryCount: 1,
  repositorySelection: "selected",
  updatedAt: "2026-06-21T00:00:00.000Z",
  updatedBy: "octocat",
};

const scanPolicy: InstallationScanPolicy = {
  createdAt: "2026-07-01T00:00:00.000Z",
  enabled: true,
  id: "e2e-policy-1",
  installationId: 123,
  name: "pnpm minimumReleaseAge",
  rule: "pnpm workspaces must set minimumReleaseAge to 1440 or higher.",
  updatedAt: "2026-07-01T00:00:00.000Z",
  updatedBy: "octocat",
};

const scanRun: ScanRunRecord = {
  defaultBranch: "main",
  deliveryId: "manual-e2e-dashboard",
  executionName: "projects/scanveil/locations/us-central1/jobs/worker/executions/e2e",
  findingCount: 1,
  headSha: "abc123",
  installationId: 123,
  llmEnabled: true,
  llmEstimatedCostUsd: 0.00004,
  llmInputTokens: 40,
  llmLocation: "global",
  llmModel: "gemini-test",
  llmOutputObjectPath: "gs://scanveil-e2e/manual-e2e-dashboard/llm-output.txt",
  llmOutputTokens: 20,
  llmProvider: "vertex_ai",
  llmTotalTokens: 60,
  osvEnabled: true,
  owner: "kexi",
  queuedAt: "2026-06-21T00:00:00.000Z",
  reason: "manual",
  repo: "example",
  repositoryId: 10001,
  runnerRegion: "us-central1",
  status: "succeeded",
  streamChunkCount: 2,
  target: "repository",
  updatedAt: "2026-06-21T00:01:00.000Z",
};

const finding: ScanFindingRecord = {
  aliases: ["CVE-2026-0001"],
  category: "xss",
  confidence: 0.95,
  deliveryId: scanRun.deliveryId,
  endLine: 12,
  evidence: "innerHTML uses user input",
  file: "src/app.ts",
  findingId: "AIVULN-e2e-1",
  recommendation: "Use textContent.",
  repoFullName: "kexi/example",
  repositoryId: 10001,
  severity: "high",
  source: "llm",
  startLine: 12,
  sveId: "SVE-202606-EXAMPLE-0001",
  title: "DOM XSS",
  writtenAt: "2026-06-21T00:00:00.000Z",
};

const fixPrRun: FixPrRunRecord = {
  baseSha: scanRun.headSha,
  defaultBranch: "main",
  deliveryId: scanRun.deliveryId,
  endLine: 12,
  evidence: finding.evidence,
  executionName: "projects/scanveil/locations/us-central1/jobs/worker/executions/fix-e2e",
  file: "src/app.ts",
  findingId: finding.findingId,
  fixId: "fix-e2e-queued",
  installationId: 123,
  owner: "kexi",
  queuedAt: "2026-06-21T00:02:00.000Z",
  recommendation: finding.recommendation,
  repo: "example",
  repositoryId: 10001,
  severity: "high",
  startLine: 12,
  status: "queued",
  sveId: "SVE-202606-EXAMPLE-0001",
  title: "DOM XSS",
  updatedAt: "2026-06-21T00:02:00.000Z",
};

const fixPrChunks: FixPrStreamChunkRecord[] = [
  {
    fixId: fixPrRun.fixId,
    kind: "llm_chunk",
    repoFullName: "kexi/example",
    repositoryId: 10001,
    sequence: 0,
    text: "Reviewing the DOM sink before proposing a fix.",
    timestamp: "2026-06-21T00:02:05.000Z",
  },
];

const chunks: ScanStreamChunkRecord[] = [
  {
    deliveryId: scanRun.deliveryId,
    kind: "llm_chunk",
    repoFullName: "kexi/example",
    repositoryId: 10001,
    sequence: 0,
    text: "Reviewing src/app.ts\n",
    timestamp: "2026-06-21T00:00:02.000Z",
  },
  {
    deliveryId: scanRun.deliveryId,
    kind: "llm_chunk",
    repoFullName: "kexi/example",
    repositoryId: 10001,
    sequence: 1,
    text: "Found DOM XSS evidence.",
    timestamp: "2026-06-21T00:00:03.000Z",
  },
];

const queuedRepositoryScanRequest = {
  defaultBranch: "main",
  deliveryId: "manual-e2e-queued",
  headSha: "abc123",
  installationId: 123,
  llmEnabled: true,
  osvEnabled: true,
  owner: "kexi",
  reason: "manual" as const,
  repo: "example",
  repositoryId: 10001,
  target: "repository" as const,
};

const access: InviteAccess = {
  code: "E2ECODE",
  codeName: "E2E",
  githubLogin: "octocat",
  githubUserId: "1001",
  redeemedAt: "2026-06-21T00:00:00.000Z",
};

const dependencies: Partial<ConsoleServerDependencies> = {
  createGitHubIssue: async () => ({
    htmlUrl: "https://github.com/kexi/example/issues/42",
    number: 42,
  }),
  createScanPolicy: async (input) => ({ ...scanPolicy, ...input }),
  deleteScanPolicy: async () => undefined,
  listInstallationPolicies: async () => [installationPolicy],
  listScanPolicies: async () => [scanPolicy],
  readScanPolicy: async (id) => (id === scanPolicy.id ? scanPolicy : undefined),
  updateScanPolicy: async (id, input) =>
    id === scanPolicy.id ? { ...scanPolicy, ...input } : undefined,
  listRepositoryBranches: async () => [
    { name: "main", sha: "abc123" },
    { name: "release", sha: "release123" },
  ],
  listScanExecutions: async () => [scanRun],
  listFixPrRuns: async () => [fixPrRun],
  listFixPrRunsBySveId: async (sveId) => (sveId === fixPrRun.sveId ? [fixPrRun] : []),
  listFixPrStreamChunks: async (fixId, afterSequence = -1) =>
    fixId === fixPrRun.fixId ? fixPrChunks.filter((chunk) => chunk.sequence > afterSequence) : [],
  listScanFindingRecords: async (deliveryIds) =>
    deliveryIds.includes(scanRun.deliveryId) ? [finding] : [],
  listScanFindingRecordsBySveId: async (sveId) => (sveId === finding.sveId ? [finding] : []),
  listScanStreamChunks: async (deliveryId, afterSequence = -1) =>
    deliveryId === scanRun.deliveryId
      ? chunks.filter((chunk) => chunk.sequence > afterSequence)
      : [],
  loadConsoleUserSessionAccess: async (session) => session,
  loadRepositoryDashboardData: async () => ({
    isConfigured: true,
    repositories: [repository],
  }),
  readLlmOutputObject: async () => chunks.map((chunk) => chunk.text).join(""),
  readFixPrRunRecord: async (fixId) => (fixId === fixPrRun.fixId ? fixPrRun : undefined),
  readScanRunRecord: async (deliveryId) =>
    deliveryId === scanRun.deliveryId ? scanRun : undefined,
  readRepositoryScanConfig: async () => ({
    path: ".scanveil/config.yml",
    source: "version: 1\nchecks:\n  conclusionMode: advisory\n",
    status: "repository",
    warnings: [],
  }),
  readScheduledScanSettings: async () => ({
    available: true,
    enabled: true,
    name: "projects/scanveil/locations/us-central1/jobs/scanveil-scheduled-scan",
    schedule: "0 3 * * *",
    state: "ENABLED",
    timeZone: "Asia/Tokyo",
  }),
  readSessionSecret: () => e2eSessionSecret,
  recordUserLogin: async () => undefined,
  recordUserManualScan: async () => undefined,
  redeemInviteCode: async (session, code) => {
    const isValidCode = code.trim().toUpperCase() === "E2ECODE";
    if (!isValidCode) {
      throw new InviteRedeemError("invalid_code");
    }

    return {
      ...access,
      githubLogin: session.githubLogin,
      githubUserId: session.githubUserId,
    };
  },
  requireInviteAccess: async (session: ConsoleUserSession) => {
    const isInvitedUser = session.githubUserId === "1001";
    if (isInvitedUser) {
      return access;
    }

    const isDisabledUser = session.githubUserId === "1003";
    if (isDisabledUser) {
      throw new UserDisabledError();
    }

    throw new InviteRequiredError();
  },
  startAllManualScans: async () => ({
    executionNames: ["projects/scanveil/locations/us-central1/jobs/worker/executions/all-e2e"],
    scanRequests: [queuedRepositoryScanRequest],
  }),
  startFixPrRun: async () => ({
    executionName: "projects/scanveil/locations/us-central1/jobs/worker/executions/fix-e2e",
    fixId: fixPrRun.fixId,
  }),
  startRepositoryManualScan: async () => ({
    executionName: "projects/scanveil/locations/us-central1/jobs/worker/executions/repo-e2e",
    scanRequest: queuedRepositoryScanRequest,
  }),
  startSveVerificationScans: async (targets) => ({
    executionNames: targets.map((target) => `verify-${target.sveId}`),
    scanRequests: targets.map((target) => ({
      defaultBranch: "main",
      deliveryId: `verify-${target.sveId}`,
      headSha: "abc123",
      installationId: 123,
      llmEnabled: true,
      osvEnabled: true,
      owner: target.repoFullName.split("/")[0] ?? "kexi",
      reason: "manual",
      repo: target.repoFullName.split("/")[1] ?? "example",
      repositoryId: 10001,
      target: "repository",
    })),
  }),
  updateInstallationPolicy: async () => [installationPolicy],
};

const server = await createConsoleServer({
  dependencies,
  env: {
    ...process.env,
    NODE_ENV: "development",
    SECURITY_APP_SESSION_SECRET: e2eSessionSecret,
  },
  port,
});

server.listen(port, "127.0.0.1", () => {
  console.log(`console e2e server listening on http://127.0.0.1:${port}`);
});
