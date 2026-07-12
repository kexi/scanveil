import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import {
  isSupportedLockfile,
  parseSecurityAppConfig,
  parseUnifiedDiff,
  productMetadata,
  toScanPolicyPromptEntries,
  type DiffFile,
  type InstallationScanPolicy,
  type SecurityAppConfig,
  type PullRequestScanRequest,
  type RepositoryScanRequest,
  type ScanRequest,
  type SecurityFinding,
  writeStructuredLog,
} from "@scanveil/core";
import {
  createCheckRunPayload,
  createInstallationToken,
  findingsToCheckResult,
  GitHubClient,
} from "@scanveil/github";
import {
  embedText,
  InMemoryFindingStore,
  suppressSimilarFindings,
  type FindingStore,
} from "@scanveil/rag";
import {
  type LlmUsage,
  type LlmStreamChunk,
  runOsvScanner,
  type LlmReviewerOptions,
  type LlmReviewScope,
  type OsvScannerOptions,
} from "@scanveil/scanners";
import { reviewDiffWithAgyRunner } from "./agy-runner-client.js";
import { writeScanFindings } from "./scan-findings.js";
import { listEnabledScanPolicies } from "./scan-policies.js";
import type { ScanRunUsageSummary } from "./scan-runs.js";
import {
  createLlmStreamWriter,
  markScanRunSucceededWithStream,
  type LlmStreamWriter,
} from "./scan-stream.js";
import { FirestoreFindingStore } from "./firestore-finding-store.js";

export interface ScanRunnerGithubClient {
  createCheckRun(owner: string, repo: string, payload: unknown): Promise<void>;
  getPullRequestDiff(
    request: Pick<PullRequestScanRequest, "owner" | "repo" | "pullNumber">,
  ): Promise<string>;
  getRepositoryFile(
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string | undefined>;
  listRepositoryFiles(owner: string, repo: string, ref: string): Promise<string[]>;
}

export interface ScanRunnerDependencies {
  createGithubClient?(request: ScanRequest): Promise<ScanRunnerGithubClient>;
  embed?(text: string): Promise<number[]>;
  findingStore?: FindingStore;
  createLlmStreamWriter?(request: ScanRequest): Promise<LlmStreamWriter> | LlmStreamWriter;
  markScanSucceeded?(
    request: ScanRequest,
    findingCount: number,
    usage: ScanRunUsageSummary,
  ): Promise<void>;
  reviewDiffWithAgy?(
    files: DiffFile[],
    options: LlmReviewerOptions & { config: SecurityAppConfig; repositoryDir?: string },
  ): Promise<SecurityFinding[]>;
  reviewDiff?(files: DiffFile[], options: LlmReviewerOptions): Promise<SecurityFinding[]>;
  listScanPolicies?(installationId: number): Promise<InstallationScanPolicy[]>;
  runOsv?(lockfilePaths: string[], options?: OsvScannerOptions): Promise<SecurityFinding[]>;
  writeFindings?(request: ScanRequest, findings: SecurityFinding[]): Promise<void>;
}

const defaultRepositoryLlmFileLimit = 20;
const defaultRepositoryLlmFileMaxBytes = 20_000;
const repositoryLlmExtensions = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".tf",
  ".ts",
  ".tsx",
  ".vue",
  ".yaml",
  ".yml",
]);
const repositoryLlmExactNames = new Set(["Dockerfile", "Containerfile"]);

export async function runScan(
  request: ScanRequest,
  dependencies: ScanRunnerDependencies = {},
): Promise<void> {
  writeStructuredLog({
    deliveryId: request.deliveryId,
    message: "scan_started",
    owner: request.owner,
    repo: request.repo,
    severity: "INFO",
    target: request.target,
  });

  const github = await createGithubClient(request, dependencies);
  const repoFullName = `${request.owner}/${request.repo}`;
  const configSource = await readRepositoryConfig(github, request);
  const parsedConfig = parseSecurityAppConfig(configSource.source);
  const config = parsedConfig.config;
  applyScanRequestOverrides(config, request);
  const isDisabledScheduledScan = request.reason === "scheduled" && !config.schedule.enabled;
  if (isDisabledScheduledScan) {
    const usageSummary = toScanRunUsageSummary([]);
    const markScanSucceeded = dependencies.markScanSucceeded;
    if (markScanSucceeded !== undefined) {
      await markScanSucceeded(request, 0, usageSummary);
      return;
    }

    const streamWriter = await createScanStreamWriter(request, dependencies);
    await markScanRunSucceededWithStream(request, 0, usageSummary, streamWriter);
    return;
  }

  const warnings = [...parsedConfig.warnings, ...configSource.warnings];
  const diffFiles = await readPullRequestDiffFiles(github, request);
  const llmFiles = await readLlmReviewFiles(
    github,
    request,
    diffFiles,
    config.scan.llm.excludePaths,
  );

  const llmUsages: LlmUsage[] = [];
  const streamWriter = await createScanStreamWriter(request, dependencies);
  const llmFindings = await maybeRunLlmReview(
    github,
    request,
    llmFiles,
    config.scan.llm.enabled,
    config.scan.llm.excludePaths,
    config,
    repoFullName,
    request.llmModel,
    request.target,
    dependencies,
    (usage) => {
      llmUsages.push(usage);
    },
    async (chunk) => {
      await streamWriter.writeText(chunk.text);
    },
  );
  const osvFindings = await maybeRunOsvScanner(
    github,
    request,
    diffFiles,
    config.scan.osv.enabled,
    config.scan.osv.lockfileGlobs,
    dependencies,
  );
  const rawFindings = [...llmFindings, ...osvFindings];
  const store = dependencies.findingStore ?? createFindingStore();
  const suppressionConfig = readSuppressionConfig(config, dependencies);
  const findings = await suppressSimilarFindings(rawFindings, {
    config: suppressionConfig,
    embed: dependencies.embed ?? embedText,
    repoFullName,
    store,
  });

  const result = findingsToCheckResult(config, findings, warnings, readCheckDetailsUrl(request));
  const payload = createCheckRunPayload(request.headSha, result);
  await maybeCreateCheckRun(github, request, payload);

  const writeFindings = dependencies.writeFindings ?? writeScanFindings;
  await writeFindings(request, findings);

  const usageSummary = toScanRunUsageSummary(llmUsages);
  const markScanSucceeded = dependencies.markScanSucceeded;
  if (markScanSucceeded !== undefined) {
    await markScanSucceeded(request, findings.length, await streamWriter.finish(usageSummary));
  } else {
    await markScanRunSucceededWithStream(request, findings.length, usageSummary, streamWriter);
  }

  writeStructuredLog({
    deliveryId: request.deliveryId,
    findingCount: findings.length,
    message: "scan_finished",
    owner: request.owner,
    repo: request.repo,
    severity: "INFO",
    target: request.target,
  });
}

function applyScanRequestOverrides(config: SecurityAppConfig, request: ScanRequest): void {
  config.scan.llm.enabled = request.llmEnabled;
  config.scan.osv.enabled = request.osvEnabled;
}

function readSuppressionConfig(
  config: SecurityAppConfig,
  dependencies: ScanRunnerDependencies,
): SecurityAppConfig {
  const hasInjectedEmbedder = dependencies.embed !== undefined;
  if (hasInjectedEmbedder) {
    return config;
  }

  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const canUseDefaultEmbedder = typeof project === "string" && project.length > 0;
  if (canUseDefaultEmbedder) {
    return config;
  }

  const isSuppressionEnabled = config.suppression.enabled;
  if (!isSuppressionEnabled) {
    return config;
  }

  writeStructuredLog({
    message: "suppression_disabled_missing_embedding_project",
    reason: "GOOGLE_CLOUD_PROJECT is required for the default Vertex AI embedding provider",
    severity: "WARNING",
  });
  return {
    ...config,
    suppression: {
      ...config.suppression,
      enabled: false,
    },
  };
}

async function createScanStreamWriter(
  request: ScanRequest,
  dependencies: ScanRunnerDependencies,
): Promise<LlmStreamWriter> {
  const createWriter = dependencies.createLlmStreamWriter;
  const hasCreateWriter = createWriter !== undefined;
  if (hasCreateWriter) {
    return createWriter(request);
  }

  return createLlmStreamWriter(request);
}

function toScanRunUsageSummary(usages: LlmUsage[]): ScanRunUsageSummary {
  const latestUsage = usages.at(-1);
  const summary: ScanRunUsageSummary = {};
  setOptionalUsageString(summary, "llmCostCurrency", latestUsage?.costCurrency);
  const hasCostStatus = latestUsage?.costStatus !== undefined;
  if (hasCostStatus) {
    summary.llmCostStatus = latestUsage.costStatus;
  }
  setOptionalUsageString(summary, "llmLocation", latestUsage?.location);
  setOptionalUsageString(summary, "llmModel", latestUsage?.model);
  setOptionalUsageString(summary, "llmProvider", latestUsage?.provider);
  setOptionalUsageString(summary, "runnerRegion", readRunnerRegion());

  setOptionalUsageNumber(
    summary,
    "llmEstimatedCostUsd",
    sumOptionalNumbers(usages.map((usage) => usage.estimatedCostUsd)),
  );
  setOptionalUsageNumber(
    summary,
    "llmInputTokens",
    sumOptionalNumbers(usages.map((usage) => usage.inputTokens)),
  );
  setOptionalUsageNumber(
    summary,
    "llmInputUsdPerMillionTokens",
    latestUsage?.inputUsdPerMillionTokens,
  );
  setOptionalUsageNumber(
    summary,
    "llmOutputTokens",
    sumOptionalNumbers(usages.map((usage) => usage.outputTokens)),
  );
  setOptionalUsageNumber(
    summary,
    "llmOutputUsdPerMillionTokens",
    latestUsage?.outputUsdPerMillionTokens,
  );
  setOptionalUsageNumber(
    summary,
    "llmTotalTokens",
    sumOptionalNumbers(usages.map((usage) => usage.totalTokens)),
  );
  return summary;
}

function setOptionalUsageString(
  summary: ScanRunUsageSummary,
  key: "llmCostCurrency" | "llmLocation" | "llmModel" | "llmProvider" | "runnerRegion",
  value: string | undefined,
): void {
  const hasValue = value !== undefined;
  if (!hasValue) {
    return;
  }

  summary[key] = value;
}

function readRunnerRegion(): string | undefined {
  const region = process.env.GOOGLE_CLOUD_REGION;
  const hasRegion = typeof region === "string" && region.length > 0;
  if (hasRegion) {
    return region;
  }

  return undefined;
}

function setOptionalUsageNumber(
  summary: ScanRunUsageSummary,
  key:
    | "llmEstimatedCostUsd"
    | "llmInputTokens"
    | "llmInputUsdPerMillionTokens"
    | "llmOutputTokens"
    | "llmOutputUsdPerMillionTokens"
    | "llmTotalTokens",
  value: number | undefined,
): void {
  const hasValue = value !== undefined;
  if (!hasValue) {
    return;
  }

  summary[key] = value;
}

function sumOptionalNumbers(values: Array<number | undefined>): number | undefined {
  const presentValues = values.filter((value): value is number => value !== undefined);
  const hasValues = presentValues.length > 0;
  if (!hasValues) {
    return undefined;
  }

  return presentValues.reduce((total, value) => total + value, 0);
}

function createFindingStore(): FindingStore {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const hasProject = typeof project === "string" && project.length > 0;
  if (!hasProject) {
    return new InMemoryFindingStore();
  }

  return new FirestoreFindingStore();
}

function readCheckDetailsUrl(request: ScanRequest): string | undefined {
  const base = process.env.SECURITY_APP_WEB_BASE_URL;
  const hasBase = typeof base === "string" && base.length > 0;
  if (!hasBase) {
    return undefined;
  }

  return `${base.replace(/\/$/, "")}/scans/${encodeURIComponent(request.deliveryId)}`;
}

async function maybeCreateCheckRun(
  github: ScanRunnerGithubClient,
  request: ScanRequest,
  payload: unknown,
): Promise<void> {
  try {
    await github.createCheckRun(request.owner, request.repo, payload);
  } catch (error) {
    const isPermissionError = isGitHubCheckPermissionError(error);
    if (!isPermissionError) {
      throw error;
    }

    writeStructuredLog({
      deliveryId: request.deliveryId,
      message: "github_check_skipped",
      owner: request.owner,
      reason: "github_checks_permission_denied",
      repo: request.repo,
      severity: "WARNING",
    });
  }
}

async function createGithubClient(
  request: ScanRequest,
  dependencies: ScanRunnerDependencies,
): Promise<ScanRunnerGithubClient> {
  const createClient = dependencies.createGithubClient;
  const hasCreateClient = createClient !== undefined;
  if (hasCreateClient) {
    return createClient(request);
  }

  const appId = readRequiredEnv("GITHUB_APP_ID");
  const privateKey = readRequiredEnv("GITHUB_APP_PRIVATE_KEY");
  const token = await createInstallationToken({ appId, privateKey }, request.installationId);
  return new GitHubClient({ token });
}

async function readPullRequestDiffFiles(
  github: ScanRunnerGithubClient,
  request: ScanRequest,
): Promise<DiffFile[]> {
  const isPullRequestScan = isPullRequestScanRequest(request);
  if (!isPullRequestScan) {
    return [];
  }

  const diff = await github.getPullRequestDiff(request);
  return parseUnifiedDiff(diff);
}

async function readLlmReviewFiles(
  github: ScanRunnerGithubClient,
  request: ScanRequest,
  pullRequestDiffFiles: DiffFile[],
  excludePaths: string[],
): Promise<DiffFile[]> {
  const isPullRequestScan = isPullRequestScanRequest(request);
  if (isPullRequestScan) {
    return pullRequestDiffFiles;
  }

  return readRepositorySnapshotFiles(github, request, excludePaths);
}

async function readRepositorySnapshotFiles(
  github: ScanRunnerGithubClient,
  request: RepositoryScanRequest,
  excludePaths: string[],
): Promise<DiffFile[]> {
  const paths = await github.listRepositoryFiles(request.owner, request.repo, request.headSha);
  // Why not tree order: git tree は辞書順なので .github/** だけで file limit を
  // 使い切り、pnpm-workspace.yaml など policy 検査対象の root manifest が LLM に
  // 渡らない。浅い path を優先して root 直下の設定ファイルを必ず含める。
  const candidatePaths = prioritizeShallowPaths(
    paths
      .filter(isRepositoryLlmCandidatePath)
      .filter((path) => !matchesAnyPathPattern(path, excludePaths)),
  ).slice(0, readRepositoryLlmFileLimit());
  const files: DiffFile[] = [];
  for (const path of candidatePaths) {
    const content = await github.getRepositoryFile(
      request.owner,
      request.repo,
      path,
      request.headSha,
    );
    const hasContent = typeof content === "string" && content.length > 0;
    if (!hasContent) {
      continue;
    }

    files.push(toRepositorySnapshotDiffFile(path, content, readRepositoryLlmFileMaxBytes()));
  }

  writeStructuredLog({
    candidateFileCount: candidatePaths.length,
    message: "repository_llm_snapshot_prepared",
    repoFullName: `${request.owner}/${request.repo}`,
    reviewedFileCount: files.length,
    severity: "INFO",
  });

  return files;
}

async function maybeRunLlmReview(
  github: ScanRunnerGithubClient,
  request: ScanRequest,
  files: DiffFile[],
  isEnabled: boolean,
  excludePaths: string[],
  config: SecurityAppConfig,
  repoFullName: string,
  llmModel: string | undefined,
  target: ScanRequest["target"],
  dependencies: ScanRunnerDependencies,
  onUsage: (usage: LlmUsage) => void,
  onStreamChunk: (chunk: LlmStreamChunk) => Promise<void>,
): Promise<SecurityFinding[]> {
  if (!isEnabled) {
    return [];
  }

  const reviewScope: LlmReviewScope = target === "repository" ? "repository" : "pull_request";
  const listScanPolicies = dependencies.listScanPolicies ?? listEnabledScanPolicies;
  const scanPolicies = toScanPolicyPromptEntries(await listScanPolicies(request.installationId));
  const options = {
    excludePaths,
    ...(llmModel === undefined ? {} : { model: llmModel }),
    onStreamChunk,
    onUsage,
    repoFullName,
    reviewScope,
    ...(scanPolicies.length === 0 ? {} : { scanPolicies }),
  };
  const repositoryDir = await prepareAgyRepositoryDirectory(github, request, config);
  try {
    const agyOptions = {
      ...options,
      config,
      ...(repositoryDir === undefined ? {} : { repositoryDir }),
    };
    const injectedAgyReviewer = dependencies.reviewDiffWithAgy;
    const hasInjectedAgyReviewer = injectedAgyReviewer !== undefined;
    if (hasInjectedAgyReviewer) {
      return injectedAgyReviewer(files, agyOptions);
    }

    const injectedReviewer = dependencies.reviewDiff;
    const hasInjectedReviewer = injectedReviewer !== undefined;
    if (hasInjectedReviewer) {
      return injectedReviewer(files, options);
    }

    return reviewDiffWithAgyRunner(files, agyOptions);
  } finally {
    await removeAgyRepositoryDirectory(repositoryDir);
  }
}

async function prepareAgyRepositoryDirectory(
  github: ScanRunnerGithubClient,
  request: ScanRequest,
  config: SecurityAppConfig,
): Promise<string | undefined> {
  const shouldLoadAssets = shouldLoadAgyRepositoryAssets(config);
  if (!shouldLoadAssets) {
    return undefined;
  }

  const paths = await github.listRepositoryFiles(request.owner, request.repo, request.headSha);
  const assetPaths = paths.filter((path) => isAgyRepositoryAssetPath(path, config));
  const hasAssetPaths = assetPaths.length > 0;
  if (!hasAssetPaths) {
    return undefined;
  }

  const repositoryDir = await mkdtemp(join(tmpdir(), `${productMetadata.slug}-agy-assets-`));
  let writtenFileCount = 0;
  try {
    for (const path of assetPaths) {
      const content = await github.getRepositoryFile(
        request.owner,
        request.repo,
        path,
        request.headSha,
      );
      const hasContent = typeof content === "string";
      if (!hasContent) {
        continue;
      }

      const targetPath = toSafeRepositoryAssetPath(repositoryDir, path);
      const hasTargetPath = targetPath !== undefined;
      if (!hasTargetPath) {
        continue;
      }

      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, "utf8");
      writtenFileCount += 1;
    }
  } catch (error) {
    await removeAgyRepositoryDirectory(repositoryDir);
    throw error;
  }

  const hasWrittenFiles = writtenFileCount > 0;
  if (!hasWrittenFiles) {
    await removeAgyRepositoryDirectory(repositoryDir);
    return undefined;
  }

  writeStructuredLog({
    deliveryId: request.deliveryId,
    message: "agy_repository_assets_prepared",
    repoFullName: `${request.owner}/${request.repo}`,
    repositoryAssetCount: writtenFileCount,
    severity: "INFO",
  });

  return repositoryDir;
}

function shouldLoadAgyRepositoryAssets(config: SecurityAppConfig): boolean {
  const agent = config.scan.llm.agent;
  return agent.skills.enabled || agent.plugins.enabled || agent.mcp.enabled;
}

function isAgyRepositoryAssetPath(path: string, config: SecurityAppConfig): boolean {
  const agent = config.scan.llm.agent;
  const isSkillPath = agent.skills.enabled && isSkillPathUnder(path, ".scanveil/skills/");
  if (isSkillPath) {
    return true;
  }

  const isPluginPath =
    agent.plugins.enabled && path.startsWith(".scanveil/plugins/") && path.endsWith("/plugin.json");
  if (isPluginPath) {
    return true;
  }

  const isMcpPath =
    agent.mcp.enabled &&
    path.startsWith(".scanveil/mcp/") &&
    path.endsWith(".json") &&
    !path.slice(".scanveil/mcp/".length).includes("/");
  return isMcpPath;
}

function isSkillPathUnder(path: string, directory: string): boolean {
  return path.startsWith(directory) && path.endsWith("/SKILL.md");
}

function toSafeRepositoryAssetPath(repositoryDir: string, path: string): string | undefined {
  const root = resolve(repositoryDir);
  const targetPath = resolve(root, path);
  const isInsideRoot = targetPath.startsWith(`${root}${sep}`);
  if (!isInsideRoot) {
    return undefined;
  }

  return targetPath;
}

async function removeAgyRepositoryDirectory(repositoryDir: string | undefined): Promise<void> {
  const hasRepositoryDir = repositoryDir !== undefined;
  if (!hasRepositoryDir) {
    return;
  }

  await rm(repositoryDir, { force: true, recursive: true });
}

async function maybeRunOsvScanner(
  github: ScanRunnerGithubClient,
  request: ScanRequest,
  files: DiffFile[],
  isEnabled: boolean,
  lockfileGlobs: string[],
  dependencies: ScanRunnerDependencies,
): Promise<SecurityFinding[]> {
  if (!isEnabled) {
    return [];
  }

  const lockfilePaths = await readLockfilePaths(github, request, files, lockfileGlobs);
  const hasLockfiles = lockfilePaths.length > 0;
  if (!hasLockfiles) {
    return [];
  }

  const workdir = join(tmpdir(), `${productMetadata.slug}-${request.deliveryId}`);
  await mkdir(workdir, { recursive: true });
  try {
    const localPaths: string[] = [];
    for (const lockfilePath of lockfilePaths) {
      const content = await github.getRepositoryFile(
        request.owner,
        request.repo,
        lockfilePath,
        request.headSha,
      );
      const hasContent = content !== undefined;
      if (!hasContent) {
        continue;
      }

      const localPath = join(workdir, lockfilePath);
      await mkdir(dirname(localPath), { recursive: true });
      await writeFile(localPath, content);
      localPaths.push(lockfilePath);
    }

    const runOsv = dependencies.runOsv ?? runOsvScanner;
    return await runOsv(localPaths, { cwd: workdir });
  } catch (error) {
    const isMissingBinary = isMissingOsvScannerBinary(error);
    if (!isMissingBinary) {
      throw error;
    }

    writeStructuredLog({
      message: "osv_scan_skipped",
      reason: "missing_osv_scanner_binary",
      severity: "WARNING",
    });
    return [];
  } finally {
    await rm(workdir, { force: true, recursive: true });
  }
}

async function readLockfilePaths(
  github: ScanRunnerGithubClient,
  request: ScanRequest,
  files: DiffFile[],
  lockfileGlobs: string[],
): Promise<string[]> {
  const isRepositoryScan = isRepositoryScanRequest(request);
  if (isRepositoryScan) {
    const paths = await github.listRepositoryFiles(request.owner, request.repo, request.headSha);
    return paths.filter((path) => isSupportedLockfile(path, lockfileGlobs));
  }

  return files.map((file) => file.path).filter((path) => isSupportedLockfile(path, lockfileGlobs));
}

function isPullRequestScanRequest(request: ScanRequest): request is PullRequestScanRequest {
  const hasPullNumber = "pullNumber" in request;
  return request.target === "pull_request" || hasPullNumber;
}

function isRepositoryScanRequest(request: ScanRequest): request is RepositoryScanRequest {
  return request.target === "repository";
}

function isRepositoryLlmCandidatePath(path: string): boolean {
  const fileName = path.split("/").at(-1) ?? path;
  const isExactName = repositoryLlmExactNames.has(fileName);
  if (isExactName) {
    return true;
  }

  const lowerPath = path.toLowerCase();
  return [...repositoryLlmExtensions].some((extension) => lowerPath.endsWith(extension));
}

function prioritizeShallowPaths(paths: string[]): string[] {
  return [...paths].sort((left, right) => countPathSegments(left) - countPathSegments(right));
}

function countPathSegments(path: string): number {
  return path.split("/").length;
}

function toRepositorySnapshotDiffFile(path: string, content: string, maxBytes: number): DiffFile {
  const snapshot = truncateAtLineBoundary(content, maxBytes);
  const lines = snapshot.text.split(/\r?\n/);
  const addedLines = lines.map((_, index) => index + 1);
  const rawLines = lines.map((line) => `+${line}`);
  const truncationMarker = snapshot.isTruncated
    ? [
        `\\ scanveil: file truncated for review after line ${lines.length}; the original file continues`,
      ]
    : [];
  return {
    addedLines,
    path,
    raw: [
      `diff --git a/${path} b/${path}`,
      "--- /dev/null",
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...rawLines,
      ...truncationMarker,
    ].join("\n"),
  };
}

// Why not cut at maxBytes exactly: a mid-token cut reads as a syntax error, and
// the scan LLM reports the "incomplete code" as a security finding at the cut
// point (SVE-202607-CE8854E5), so keep only complete lines and mark the cut.
function truncateAtLineBoundary(
  content: string,
  maxBytes: number,
): { isTruncated: boolean; text: string } {
  const isTruncated = content.length > maxBytes;
  if (!isTruncated) {
    return { isTruncated, text: content };
  }

  const sliced = content.slice(0, maxBytes);
  const lastNewlineIndex = sliced.lastIndexOf("\n");
  const hasLineBoundary = lastNewlineIndex > 0;
  if (!hasLineBoundary) {
    return { isTruncated, text: sliced };
  }

  return { isTruncated, text: sliced.slice(0, lastNewlineIndex) };
}

function readRepositoryLlmFileLimit(): number {
  return readOptionalPositiveIntegerEnv(
    "SECURITY_APP_REPOSITORY_LLM_FILE_LIMIT",
    defaultRepositoryLlmFileLimit,
  );
}

function readRepositoryLlmFileMaxBytes(): number {
  return readOptionalPositiveIntegerEnv(
    "SECURITY_APP_REPOSITORY_LLM_FILE_MAX_BYTES",
    defaultRepositoryLlmFileMaxBytes,
  );
}

function readOptionalPositiveIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    return fallback;
  }

  const parsed = Number(value);
  const isPositiveInteger = Number.isInteger(parsed) && parsed > 0;
  if (!isPositiveInteger) {
    return fallback;
  }

  return parsed;
}

function matchesAnyPathPattern(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPathPattern(path, pattern));
}

function matchesPathPattern(path: string, pattern: string): boolean {
  const escaped = pattern
    .split("**")
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*"))
    .join(".*");
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(path);
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

interface RepositoryConfigSource {
  source: string | undefined;
  warnings: string[];
}

async function readRepositoryConfig(
  github: ScanRunnerGithubClient,
  request: ScanRequest,
): Promise<RepositoryConfigSource> {
  const configSourceOverride = request.configSourceOverride;
  const hasConfigSourceOverride =
    typeof configSourceOverride === "string" && configSourceOverride.trim().length > 0;
  if (hasConfigSourceOverride) {
    return {
      source: configSourceOverride,
      warnings: ["This scan used a temporary configuration override from the console."],
    };
  }

  const config = await github.getRepositoryFile(
    request.owner,
    request.repo,
    productMetadata.configFileName,
    request.headSha,
  );
  const hasConfig = config !== undefined;
  if (hasConfig) {
    const legacyConfig = await github.getRepositoryFile(
      request.owner,
      request.repo,
      productMetadata.legacyConfigFileName,
      request.headSha,
    );
    const hasLegacyConfig = legacyConfig !== undefined;
    if (hasLegacyConfig) {
      return {
        source: config,
        warnings: [
          ".scanveil/config.yml takes precedence over legacy .scanveil.yml. Remove .scanveil.yml after migration.",
        ],
      };
    }

    return { source: config, warnings: [] };
  }

  const legacyConfig = await github.getRepositoryFile(
    request.owner,
    request.repo,
    productMetadata.legacyConfigFileName,
    request.headSha,
  );
  const hasLegacyConfig = legacyConfig !== undefined;
  if (hasLegacyConfig) {
    return {
      source: legacyConfig,
      warnings: [
        ".scanveil.yml is deprecated. Move repository configuration to .scanveil/config.yml.",
      ],
    };
  }

  return { source: undefined, warnings: [] };
}

function isMissingOsvScannerBinary(error: unknown): boolean {
  const isRecord = typeof error === "object" && error !== null;
  if (!isRecord) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return code === "ENOENT";
}

function isGitHubCheckPermissionError(error: unknown): boolean {
  const isError = error instanceof Error;
  if (!isError) {
    return false;
  }

  return error.message.includes("GitHub request failed: 403");
}
