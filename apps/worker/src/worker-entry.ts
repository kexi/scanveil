import { randomUUID } from "node:crypto";

import {
  parseFixPrRequestJson,
  parseScanRequestJson,
  toStructuredLogError,
  writeStructuredLog,
  type FixPrRequest,
  type RepositoryScanRequest,
  type ScanRequest,
  type StructuredLogEntry,
} from "@scanveil/core";
import {
  getGitHubAppRepositoryIdentity,
  GitHubRequestError,
  listGitHubAppRepositories,
  type GitHubAppAuthConfig,
  type GitHubAppRepository,
  type GitHubAppRepositoryIdentity,
  type GitHubAppRepositoryInput,
} from "@scanveil/github";
import { filterRepositoriesByInstallationPolicy } from "./installation-policies.js";
import { runFixPr } from "./fix-pr-runner.js";
import { markFixPrRunFailed } from "./fix-pr-runs.js";
import { runScan } from "./scan-runner.js";
import { markScanRunFailed, markScanRunQueued, markScanRunRunning } from "./scan-runs.js";

export interface WorkerEntryDependencies {
  env?: NodeJS.ProcessEnv;
  filterRepositories?(repositories: GitHubAppRepository[]): Promise<GitHubAppRepository[]>;
  getRepository?(
    config: GitHubAppAuthConfig,
    input: GitHubAppRepositoryInput,
  ): Promise<GitHubAppRepositoryIdentity>;
  listRepositories?(config: GitHubAppAuthConfig): Promise<GitHubAppRepository[]>;
  markFailed?(request: ScanRequest, error: unknown): Promise<void>;
  markFixPrFailed?(fixId: string, error: unknown): Promise<void>;
  markQueued?(request: ScanRequest, executionName?: string): Promise<void>;
  markRunning?(request: ScanRequest): Promise<void>;
  runFixPr?(request: FixPrRequest): Promise<void>;
  randomUuid?(): string;
  runScan?(request: ScanRequest): Promise<void>;
  writeLog?(record: StructuredLogEntry): void;
}

export async function runWorkerEntrypoint(
  dependencies: WorkerEntryDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const fixPrSource = env.FIX_PR_REQUEST_JSON;
  const hasFixPrSource = typeof fixPrSource === "string" && fixPrSource.length > 0;
  if (hasFixPrSource) {
    const request = parseFixPrRequestJson(fixPrSource);
    try {
      await assertFixPrRequestRepository(request, dependencies);
    } catch (error) {
      const markFailed = dependencies.markFixPrFailed ?? markFixPrRunFailed;
      // Why not let markFailed throw: a failing status write must not mask the original
      // validation error that the caller (Cloud Run Job) needs to see and log.
      await markFailed(request.fixId, error).catch(() => {});
      throw error;
    }
    const executeFixPr = dependencies.runFixPr ?? runFixPr;
    await executeFixPr(request);
    return;
  }

  const source = env.SCAN_REQUEST_JSON;
  const hasSource = typeof source === "string" && source.length > 0;
  if (!hasSource) {
    await runScheduledRepositoryScans(dependencies);
    return;
  }

  const request = parseScanRequestJson(source);
  try {
    await assertScanRequestRepository(request, dependencies);
  } catch (error) {
    const markFailed = dependencies.markFailed ?? markScanRunFailed;
    // Why not let markFailed throw: a failing status write must not mask the original
    // validation error that the caller (Cloud Run Job) needs to see and log.
    await markFailed(request, error).catch(() => {});
    throw error;
  }
  await runSingleScan(request, dependencies);
}

async function runScheduledRepositoryScans(dependencies: WorkerEntryDependencies): Promise<void> {
  const env = dependencies.env ?? process.env;
  const config = readGitHubAppConfig(env);
  const listRepositories = dependencies.listRepositories ?? listGitHubAppRepositories;
  const filterRepositories =
    dependencies.filterRepositories ?? filterRepositoriesByInstallationPolicy;
  const repositories = await filterRepositories(await listRepositories(config));
  const createUuid = dependencies.randomUuid ?? randomUUID;
  const writeLog = dependencies.writeLog ?? writeStructuredLog;
  const executionName = readScheduledExecutionName(env);
  const scanRequests: RepositoryScanRequest[] = [];
  for (const repository of repositories) {
    const hasHeadSha = repository.defaultBranchHeadSha.trim().length > 0;
    if (!hasHeadSha) {
      writeLog({
        message: "scheduled_scan_repository_skipped_empty_head",
        owner: repository.fullName.split("/")[0] ?? "unknown",
        repo: repository.fullName.split("/")[1] ?? "unknown",
        severity: "INFO",
      });
      continue;
    }

    scanRequests.push(toScheduledRepositoryScanRequest(repository, createUuid()));
  }

  writeLog({
    message: "scheduled_scan_started",
    repositoryCount: scanRequests.length,
    severity: "INFO",
  });

  let failedCount = 0;
  for (const request of scanRequests) {
    try {
      const markQueued = dependencies.markQueued ?? markScanRunQueued;
      await markQueued(request, executionName);
      await runSingleScan(request, dependencies);
    } catch (error) {
      failedCount += 1;
      writeLog({
        deliveryId: request.deliveryId,
        error: toStructuredLogError(error),
        message: "scheduled_scan_repository_failed",
        owner: request.owner,
        repo: request.repo,
        severity: "ERROR",
      });
    }
  }

  writeLog({
    failedCount,
    message: "scheduled_scan_finished",
    repositoryCount: scanRequests.length,
    severity: "INFO",
  });
}

async function runSingleScan(
  request: ScanRequest,
  dependencies: WorkerEntryDependencies,
): Promise<void> {
  const markRunning = dependencies.markRunning ?? markScanRunRunning;
  await markRunning(request);
  try {
    const executeScan = dependencies.runScan ?? runScan;
    await executeScan(request);
  } catch (error) {
    const markFailed = dependencies.markFailed ?? markScanRunFailed;
    await markFailed(request, error);
    throw error;
  }
}

async function assertScanRequestRepository(
  request: ScanRequest,
  dependencies: WorkerEntryDependencies,
): Promise<void> {
  const isMatch = await matchesRequestedRepository(request, dependencies);
  if (!isMatch) {
    throw new Error("SCAN_REQUEST_JSON repository does not match the GitHub App installation");
  }
}

async function assertFixPrRequestRepository(
  request: FixPrRequest,
  dependencies: WorkerEntryDependencies,
): Promise<void> {
  const isMatch = await matchesRequestedRepository(request, dependencies);
  if (!isMatch) {
    throw new Error("FIX_PR_REQUEST_JSON repository does not match the GitHub App installation");
  }
}

async function matchesRequestedRepository(
  request: ScanRequest | FixPrRequest,
  dependencies: WorkerEntryDependencies,
): Promise<boolean> {
  const env = dependencies.env ?? process.env;
  const config = readGitHubAppConfig(env);
  const getRepository = dependencies.getRepository ?? getGitHubAppRepositoryIdentity;
  const requestRepoFullName = `${request.owner}/${request.repo}`.toLowerCase();

  let repository: GitHubAppRepositoryIdentity;
  try {
    repository = await getRepository(config, {
      installationId: request.installationId,
      owner: request.owner,
      repo: request.repo,
    });
  } catch (error) {
    // Why treat 404 as a non-match: the installation token is scoped to its repositories,
    // so a repo outside the installation returns 404. That is an identity mismatch, not an
    // operational failure, and it must surface as the stable mismatch message rather than a
    // raw GitHub error body that failure classifiers cannot match on.
    const isRepositoryOutsideInstallation =
      error instanceof GitHubRequestError && error.status === 404;
    if (isRepositoryOutsideInstallation) {
      return false;
    }

    throw error;
  }

  const isSameRepositoryId = repository.repositoryId === request.repositoryId;
  const isSameFullName = repository.fullName.trim().toLowerCase() === requestRepoFullName;
  return isSameRepositoryId && isSameFullName;
}

function toScheduledRepositoryScanRequest(
  repository: GitHubAppRepository,
  uuid: string,
): RepositoryScanRequest {
  const [owner = "unknown", repo = "unknown"] = repository.fullName.split("/");
  return {
    defaultBranch: repository.defaultBranch,
    deliveryId: `scheduled-${uuid}`,
    headSha: repository.defaultBranchHeadSha,
    installationId: repository.installationId,
    llmEnabled: true,
    osvEnabled: true,
    owner,
    reason: "scheduled",
    repo,
    repositoryId: repository.repositoryId,
    target: "repository",
  };
}

function readScheduledExecutionName(env: NodeJS.ProcessEnv): string | undefined {
  const project = env.GOOGLE_CLOUD_PROJECT;
  const region = env.GOOGLE_CLOUD_REGION;
  const job = env.CLOUD_RUN_JOB;
  const execution = env.CLOUD_RUN_EXECUTION;
  const hasExecutionParts =
    typeof project === "string" &&
    project.length > 0 &&
    typeof region === "string" &&
    region.length > 0 &&
    typeof job === "string" &&
    job.length > 0 &&
    typeof execution === "string" &&
    execution.length > 0;
  if (!hasExecutionParts) {
    return undefined;
  }

  return `projects/${project}/locations/${region}/jobs/${job}/executions/${execution}`;
}

function readGitHubAppConfig(env: NodeJS.ProcessEnv): GitHubAppAuthConfig {
  const appId = readRequiredEnv(env, "GITHUB_APP_ID");
  const privateKey = readRequiredEnv(env, "GITHUB_APP_PRIVATE_KEY");
  return { appId, privateKey };
}

function readRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
