import { randomUUID } from "node:crypto";

import {
  defaultLockfileGlobs,
  parseSecurityAppConfig,
  productMetadata,
  type RepositoryScanRequest,
  type ScanRequest,
} from "@scanveil/core";
import {
  createInstallationToken,
  getGitHubAppPullRequest,
  GitHubClient,
  listGitHubAppRepositories,
  type GitHubAppRepository,
} from "@scanveil/github";

import { type CloudRunRunOperation, readCloudRunJobRunName } from "./cloud-run.js";
import { readGitHubAppConfig } from "./github-installations.js";
import {
  filterRepositoriesByInstallationPolicy,
  requireEnabledInstallationPolicy,
} from "./installation-policies.js";
import type { ConsoleUserSession } from "./invites.js";
import {
  assertRepositoryAccess,
  filterRepositoriesByUserAccess,
  RepositoryAccessDeniedError,
} from "./repository-access.js";
import { getGoogleAccessToken, listScanRunRecords, writeScanRunRecord } from "./scan-history.js";

export interface ManualScanResult {
  executionName: string;
  scanRequest: ScanRequest;
}

export interface ManualScanBatchResult {
  executionNames: string[];
  scanRequests: ScanRequest[];
}

interface ManualScanInput {
  installationId: number;
  owner: string;
  pullNumber: number;
  repo: string;
}

interface AccessibleRepositoryInput {
  installationId: number;
  owner: string;
  repo: string;
  repositoryId?: number;
}

export interface RepositoryConfigReadInput {
  defaultBranchHeadSha: string;
  installationId: number;
  owner: string;
  repo: string;
  repositoryId: number;
}

export interface RepositoryConfigReadResult {
  path: string;
  source: string;
  status: "default" | "legacy" | "repository";
  warnings: string[];
}

export interface RepositoryBranch {
  name: string;
  sha: string;
}

export interface RepositoryManualScanInput extends RepositoryConfigReadInput {
  configSource?: string;
  defaultBranch: string;
  llmEnabled: boolean;
  llmModel?: string;
  osvEnabled: boolean;
  repositoryId: number;
}

export interface SveRepositoryScanTarget {
  repoFullName: string;
  sveId: string;
}

export interface BatchRepositoryManualScanInput {
  llmEnabled: boolean;
  llmModel?: string;
  osvEnabled: boolean;
}

const defaultLockfileGlobsYaml = defaultLockfileGlobs.map((glob) => `      - "${glob}"`).join("\n");

const defaultScanveilConfigSource = `# yaml-language-server: $schema=https://www.scanveil.kexi.dev/schema/scanveil.config.schema.json
version: 1
checks:
  conclusionMode: advisory
  failThreshold:
    osv: critical
    llm: critical
scan:
  llm:
    enabled: true
    scope: pr_diff
    excludePaths:
      - "dist/**"
      - "vendor/**"
    agent:
      timeoutSeconds: 900
      skills:
        enabled: true
      plugins:
        enabled: false
      mcp:
        enabled: false
  osv:
    enabled: true
    scope: changed_lockfiles
    lockfileGlobs:
${defaultLockfileGlobsYaml}
suppression:
  enabled: true
  similarityThreshold: 0.70
  maxNearestNeighbors: 10
schedule:
  enabled: true
`;

export async function startManualScan(
  formData: FormData,
  session: ConsoleUserSession,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ManualScanResult> {
  const input = readManualScanInput(formData);
  const config = readGitHubAppConfig(env);
  const hasConfig = config !== undefined;
  if (!hasConfig) {
    throw new Error("GitHub App credentials are not configured");
  }
  const repository = await resolveAccessibleGitHubAppRepository(input, session, env);

  await requireEnabledInstallationPolicy(repository.installationId, env);

  const [owner = input.owner, repo = input.repo] = repository.fullName.split("/");
  const pullRequest = await getGitHubAppPullRequest(config, {
    installationId: repository.installationId,
    owner,
    pullNumber: input.pullNumber,
    repo,
  });
  const hasHeadSha = pullRequest.headSha.length > 0;
  if (!hasHeadSha) {
    throw new Error("GitHub pull request response did not include head SHA");
  }

  const scanRequest: ScanRequest = {
    deliveryId: `manual-${randomUUID()}`,
    headSha: pullRequest.headSha,
    installationId: repository.installationId,
    llmEnabled: true,
    osvEnabled: true,
    owner,
    pullNumber: input.pullNumber,
    reason: "manual",
    repo,
    repositoryId: repository.repositoryId,
    target: "pull_request",
  };
  const executionName = await runWorkerJob(scanRequest, env);
  return {
    executionName,
    scanRequest,
  };
}

export async function readRepositoryScanConfig(
  input: RepositoryConfigReadInput,
  session: ConsoleUserSession,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RepositoryConfigReadResult> {
  const repository = await resolveAccessibleGitHubAppRepository(input, session, env);
  const github = await createInstallationGithubClient(repository.installationId, env);
  const [owner = input.owner, repo = input.repo] = repository.fullName.split("/");
  const config = await github.getRepositoryFile(
    owner,
    repo,
    productMetadata.configFileName,
    input.defaultBranchHeadSha,
  );
  const hasConfig = config !== undefined;
  if (hasConfig) {
    return {
      path: productMetadata.configFileName,
      source: config,
      status: "repository",
      warnings: [],
    };
  }

  const legacyConfig = await github.getRepositoryFile(
    owner,
    repo,
    productMetadata.legacyConfigFileName,
    input.defaultBranchHeadSha,
  );
  const hasLegacyConfig = legacyConfig !== undefined;
  if (hasLegacyConfig) {
    return {
      path: productMetadata.legacyConfigFileName,
      source: legacyConfig,
      status: "legacy",
      warnings: [
        ".scanveil.yml is deprecated. Move repository configuration to .scanveil/config.yml.",
      ],
    };
  }

  return {
    path: productMetadata.configFileName,
    source: defaultScanveilConfigSource,
    status: "default",
    warnings: ["Repository config was not found. The editor started from Scanveil defaults."],
  };
}

export async function listRepositoryBranches(
  input: Pick<RepositoryConfigReadInput, "installationId" | "owner" | "repo" | "repositoryId">,
  session: ConsoleUserSession,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RepositoryBranch[]> {
  const repository = await resolveAccessibleGitHubAppRepository(input, session, env);
  const github = await createInstallationGithubClient(repository.installationId, env);
  const [owner = input.owner, repo = input.repo] = repository.fullName.split("/");
  return github.listRepositoryBranches(owner, repo);
}

export async function startRepositoryManualScan(
  input: RepositoryManualScanInput,
  session: ConsoleUserSession,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ManualScanResult> {
  const repository = await resolveAccessibleGitHubAppRepository(input, session, env);
  await requireEnabledInstallationPolicy(repository.installationId, env);

  const configSource = input.configSource;
  validateScannerSelection(input);
  const hasConfigSource = configSource !== undefined;
  if (hasConfigSource) {
    const hasConfigContent = configSource.trim().length > 0;
    if (!hasConfigContent) {
      throw new Error("Configuration YAML is empty");
    }

    parseSecurityAppConfig(configSource);
  }

  const [owner = input.owner, repo = input.repo] = repository.fullName.split("/");
  const scanRequest: RepositoryScanRequest = {
    defaultBranch: input.defaultBranch,
    deliveryId: `manual-${randomUUID()}`,
    headSha: input.defaultBranchHeadSha,
    installationId: repository.installationId,
    llmEnabled: input.llmEnabled,
    ...(input.llmModel === undefined ? {} : { llmModel: input.llmModel }),
    osvEnabled: input.osvEnabled,
    owner,
    reason: "manual",
    repo,
    repositoryId: repository.repositoryId,
    target: "repository",
    ...(hasConfigSource ? { configSourceOverride: configSource } : {}),
  };
  const executionName = await runWorkerJob(scanRequest, env);
  const runnerRegion = readRequiredEnv(env, "GOOGLE_CLOUD_REGION");
  const now = new Date().toISOString();
  await writeScanRunRecord(
    {
      ...scanRequest,
      executionName,
      queuedAt: now,
      runnerRegion,
      status: "queued",
      updatedAt: now,
    },
    env,
  );
  return {
    executionName,
    scanRequest,
  };
}

async function resolveAccessibleGitHubAppRepository(
  input: AccessibleRepositoryInput,
  session: ConsoleUserSession,
  env: NodeJS.ProcessEnv,
): Promise<GitHubAppRepository> {
  const config = readGitHubAppConfig(env);
  const hasConfig = config !== undefined;
  if (!hasConfig) {
    throw new Error("GitHub App credentials are not configured");
  }

  const repositories = filterRepositoriesByUserAccess(
    await listGitHubAppRepositories(config),
    session,
  );
  const normalizedInputFullName = normalizeRepositoryFullName(`${input.owner}/${input.repo}`);
  const repository = repositories.find((candidate) => {
    const isSameInstallation = candidate.installationId === input.installationId;
    const isSameFullName =
      normalizeRepositoryFullName(candidate.fullName) === normalizedInputFullName;
    const isSameRepositoryId =
      input.repositoryId === undefined || candidate.repositoryId === input.repositoryId;
    return isSameInstallation && isSameFullName && isSameRepositoryId;
  });
  const hasRepository = repository !== undefined;
  if (!hasRepository) {
    assertRepositoryAccess(session, input.owner, input.repo, input.repositoryId);
    throw new RepositoryAccessDeniedError(`${input.owner}/${input.repo}`);
  }

  return repository;
}

function normalizeRepositoryFullName(value: string): string {
  return value.trim().toLowerCase();
}

export async function startAllManualScans(
  input: BatchRepositoryManualScanInput,
  session: ConsoleUserSession,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ManualScanBatchResult> {
  validateScannerSelection(input);
  const config = readGitHubAppConfig(env);
  const hasConfig = config !== undefined;
  if (!hasConfig) {
    throw new Error("GitHub App credentials are not configured");
  }

  const repositories = filterRepositoriesByUserAccess(
    await filterRepositoriesByInstallationPolicy(await listGitHubAppRepositories(config), env),
    session,
  );
  const scanRequests = repositories.map((repository) => {
    const [owner = "unknown", repo = "unknown"] = repository.fullName.split("/");
    return {
      defaultBranch: repository.defaultBranch,
      deliveryId: `manual-${randomUUID()}`,
      headSha: repository.defaultBranchHeadSha,
      installationId: repository.installationId,
      llmEnabled: input.llmEnabled,
      ...(input.llmModel === undefined ? {} : { llmModel: input.llmModel }),
      osvEnabled: input.osvEnabled,
      owner,
      reason: "manual" as const,
      repo,
      repositoryId: repository.repositoryId,
      target: "repository" as const,
    };
  });
  const hasScanRequests = scanRequests.length > 0;
  if (!hasScanRequests) {
    throw new Error("GitHub App repositories are not available to scan");
  }

  const executionNames: string[] = [];
  const runnerRegion = readRequiredEnv(env, "GOOGLE_CLOUD_REGION");
  for (const scanRequest of scanRequests) {
    const executionName = await runWorkerJob(scanRequest, env);
    executionNames.push(executionName);
    const now = new Date().toISOString();
    await writeScanRunRecord(
      {
        ...scanRequest,
        executionName,
        queuedAt: now,
        runnerRegion,
        status: "queued",
        updatedAt: now,
      },
      env,
    );
  }

  return {
    executionNames,
    scanRequests,
  };
}

export async function startSveVerificationScans(
  targets: SveRepositoryScanTarget[],
  input: BatchRepositoryManualScanInput,
  session: ConsoleUserSession,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ManualScanBatchResult> {
  validateScannerSelection(input);
  const uniqueRepoFullNames = [...new Set(targets.map((target) => target.repoFullName))];
  const hasTargets = uniqueRepoFullNames.length > 0;
  if (!hasTargets) {
    throw new Error("No SVE repositories are available to verify");
  }

  const config = readGitHubAppConfig(env);
  const hasConfig = config !== undefined;
  if (!hasConfig) {
    throw new Error("GitHub App credentials are not configured");
  }

  const repositories = filterRepositoriesByUserAccess(
    await filterRepositoriesByInstallationPolicy(await listGitHubAppRepositories(config), env),
    session,
  );
  const repositoriesByFullName = new Map(
    repositories.map((repository) => [repository.fullName, repository]),
  );
  const scanRequests = uniqueRepoFullNames.flatMap((repoFullName) => {
    const repository = repositoriesByFullName.get(repoFullName);
    const hasRepository = repository !== undefined;
    if (!hasRepository) {
      return [];
    }

    const [owner = "unknown", repo = "unknown"] = repository.fullName.split("/");
    const scanRequest: RepositoryScanRequest = {
      defaultBranch: repository.defaultBranch,
      deliveryId: `manual-${randomUUID()}`,
      headSha: repository.defaultBranchHeadSha,
      installationId: repository.installationId,
      llmEnabled: input.llmEnabled,
      ...(input.llmModel === undefined ? {} : { llmModel: input.llmModel }),
      osvEnabled: input.osvEnabled,
      owner,
      reason: "manual",
      repo,
      repositoryId: repository.repositoryId,
      target: "repository",
    };
    return [scanRequest];
  });
  const hasScanRequests = scanRequests.length > 0;
  if (!hasScanRequests) {
    throw new Error("SVE repositories are not available to scan");
  }

  const executionNames: string[] = [];
  const runnerRegion = readRequiredEnv(env, "GOOGLE_CLOUD_REGION");
  for (const scanRequest of scanRequests) {
    const executionName = await runWorkerJob(scanRequest, env);
    executionNames.push(executionName);
    const now = new Date().toISOString();
    await writeScanRunRecord(
      {
        ...scanRequest,
        executionName,
        queuedAt: now,
        runnerRegion,
        status: "queued",
        updatedAt: now,
      },
      env,
    );
  }

  return {
    executionNames,
    scanRequests,
  };
}

function validateScannerSelection(
  input: Pick<BatchRepositoryManualScanInput, "llmEnabled" | "osvEnabled">,
): void {
  const hasEnabledScanner = input.llmEnabled || input.osvEnabled;
  if (!hasEnabledScanner) {
    throw new Error("At least one scanner must be enabled");
  }
}

export async function listScanExecutions(env: NodeJS.ProcessEnv = process.env) {
  return listScanRunRecords(env);
}

function readManualScanInput(formData: FormData): ManualScanInput {
  const owner = readFormString(formData, "owner");
  const repo = readFormString(formData, "repo");
  const installationId = readFormInteger(formData, "installationId");
  const pullNumber = readFormInteger(formData, "pullNumber");
  return {
    installationId,
    owner,
    pullNumber,
    repo,
  };
}

async function runWorkerJob(scanRequest: ScanRequest, env: NodeJS.ProcessEnv): Promise<string> {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const region = readRequiredEnv(env, "GOOGLE_CLOUD_REGION");
  const jobName = readRequiredEnv(env, "SCAN_WORKER_JOB_NAME");
  const token = await getGoogleAccessToken(env);
  const path = `projects/${projectId}/locations/${region}/jobs/${jobName}`;
  const response = await fetch(`https://run.googleapis.com/v2/${path}:run`, {
    body: JSON.stringify({
      overrides: {
        containerOverrides: [
          {
            env: [
              {
                name: "SCAN_REQUEST_JSON",
                value: JSON.stringify(scanRequest),
              },
            ],
          },
        ],
      },
    }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Cloud Run job execution failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as CloudRunRunOperation;
  return readCloudRunJobRunName(body, path);
}

function readFormInteger(formData: FormData, name: string): number {
  const value = readFormString(formData, name);
  const parsed = Number(value);
  const isInteger = Number.isInteger(parsed) && parsed > 0;
  if (!isInteger) {
    throw new Error(`Invalid ${name}`);
  }

  return parsed;
}

function readFormString(formData: FormData, name: string): string {
  const value = formData.get(name);
  const isString = typeof value === "string";
  if (!isString) {
    throw new Error(`Missing ${name}`);
  }

  const trimmed = value.trim();
  const hasValue = trimmed.length > 0;
  if (!hasValue) {
    throw new Error(`Missing ${name}`);
  }

  return trimmed;
}

async function createInstallationGithubClient(
  installationId: number,
  env: NodeJS.ProcessEnv,
): Promise<GitHubClient> {
  const config = readGitHubAppConfig(env);
  const hasConfig = config !== undefined;
  if (!hasConfig) {
    throw new Error("GitHub App credentials are not configured");
  }

  const token = await createInstallationToken(config, installationId);
  return new GitHubClient({ token });
}

function readRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
