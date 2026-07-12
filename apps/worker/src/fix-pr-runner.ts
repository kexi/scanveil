import {
  productMetadata,
  toStructuredLogError,
  type FixPrRequest,
  type SecurityAppConfig,
  writeStructuredLog,
} from "@scanveil/core";
import {
  createInstallationToken as createGitHubInstallationToken,
  GitHubClient,
  type GitHubAppAuthConfig,
  type GitHubInstallationTokenOptions,
} from "@scanveil/github";
import { proposeFixWithAgyRunner, type AgyFixProposal } from "./agy-runner-client.js";
import {
  markFixPrRunFailed,
  markFixPrRunRunning,
  markFixPrRunSucceeded,
  recordFixPrRunStream,
  type FixPrRunStreamPatch,
} from "./fix-pr-runs.js";
import { createFixPrLlmStreamWriter, type FixPrLlmStreamWriter } from "./fix-pr-stream.js";

interface FixPrGithubClient {
  createBranch(owner: string, repo: string, branchName: string, sha: string): Promise<void>;
  createCommit(
    owner: string,
    repo: string,
    payload: { message: string; parentSha: string; treeSha: string },
  ): Promise<string>;
  createPullRequest(
    owner: string,
    repo: string,
    payload: { base: string; body: string; draft: boolean; head: string; title: string },
  ): Promise<{ htmlUrl: string; number: number }>;
  createTree(
    owner: string,
    repo: string,
    payload: { baseTree: string; files: Array<{ content: string; path: string }> },
  ): Promise<string>;
  getCommitTreeSha(owner: string, repo: string, commitSha: string): Promise<string>;
  getRepositoryFile(
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string | undefined>;
  getRepositoryBranch(
    owner: string,
    repo: string,
    branchName: string,
  ): Promise<{ name: string; sha: string } | undefined>;
}

export interface FixPrRunnerDependencies {
  createGithubClient?(request: FixPrRequest): Promise<FixPrGithubClient>;
  createInstallationToken?(
    config: GitHubAppAuthConfig,
    installationId: number,
    options?: GitHubInstallationTokenOptions,
  ): Promise<string>;
  createLlmStreamWriter?(request: FixPrRequest): FixPrLlmStreamWriter;
  markFailed?(fixId: string, error: unknown): Promise<void>;
  markRunning?(fixId: string): Promise<void>;
  markSucceeded?(
    fixId: string,
    result: { branchName: string; pullRequestNumber: number; pullRequestUrl: string },
  ): Promise<void>;
  proposeFix?(
    request: FixPrRequest,
    sourceContent: string,
    config: SecurityAppConfig,
    options?: FixPrProposeOptions,
  ): Promise<AgyFixProposal>;
  recordStream?(fixId: string, patch: FixPrRunStreamPatch): Promise<void>;
}

export interface FixPrProposeOptions {
  onStreamChunk?(chunk: { text: string }): void | Promise<void>;
}

export async function runFixPr(
  request: FixPrRequest,
  dependencies: FixPrRunnerDependencies = {},
): Promise<void> {
  const markRunning = dependencies.markRunning ?? markFixPrRunRunning;
  await markRunning(request.fixId);
  try {
    await createFixPr(request, dependencies);
  } catch (error) {
    const failure = toFixPrRunError(error);
    const markFailed = dependencies.markFailed ?? markFixPrRunFailed;
    await markFailed(request.fixId, failure);
    throw failure;
  }
}

async function createFixPr(
  request: FixPrRequest,
  dependencies: FixPrRunnerDependencies,
): Promise<void> {
  const github =
    dependencies.createGithubClient === undefined
      ? await createGithubClient(request, dependencies)
      : await dependencies.createGithubClient(request);
  const base = await resolveFixBase(github, request);
  const source = base.source;

  const config = createFixPrAgentConfig();
  const proposeFix = dependencies.proposeFix ?? defaultProposeFix;
  const createStreamWriter = dependencies.createLlmStreamWriter ?? createFixPrLlmStreamWriter;
  const streamWriter = createStreamWriter(request);
  const recordStream = dependencies.recordStream ?? recordFixPrRunStream;
  let proposal: AgyFixProposal;
  // Why not finish the writer only on success: failed proposals are exactly when
  // the streamed agent output is needed to explain what happened.
  try {
    proposal = await proposeFix(request, source, config, {
      onStreamChunk: async (chunk) => {
        await streamWriter.writeText(chunk.text);
      },
    });
  } finally {
    await persistFixPrStream(request.fixId, streamWriter, recordStream);
  }

  await persistFixPrProposal(request.fixId, proposal, recordStream);
  const isNoChangeProposal = proposal.files.length === 0;
  if (isNoChangeProposal) {
    throw new Error(createNoChangeProposalMessage(proposal));
  }

  const [file] = proposal.files;
  const hasExpectedFile = file !== undefined && file.path === request.file;
  if (!hasExpectedFile) {
    throw new Error("Fix proposal did not include the requested file");
  }

  const didChangeContent = file.content !== source;
  if (!didChangeContent) {
    throw new Error(createUnchangedProposalMessage(proposal));
  }

  const branchName = createFixBranchName(request);
  const baseTree = await github.getCommitTreeSha(request.owner, request.repo, base.sha);
  const tree = await github.createTree(request.owner, request.repo, {
    baseTree,
    files: [{ content: file.content, path: file.path }],
  });
  const commit = await github.createCommit(request.owner, request.repo, {
    message: createCommitMessage(request),
    parentSha: base.sha,
    treeSha: tree,
  });
  await github.createBranch(request.owner, request.repo, branchName, commit);
  const pullRequest = await github.createPullRequest(request.owner, request.repo, {
    base: request.defaultBranch,
    body: createPullRequestBody(request, proposal),
    draft: true,
    head: branchName,
    title: proposal.title,
  });

  const markSucceeded = dependencies.markSucceeded ?? markFixPrRunSucceeded;
  await markSucceeded(request.fixId, {
    branchName,
    pullRequestNumber: pullRequest.number,
    pullRequestUrl: pullRequest.htmlUrl,
  });
  writeStructuredLog({
    branchName,
    fixId: request.fixId,
    message: "fix_pr_created",
    pullRequestNumber: pullRequest.number,
    severity: "INFO",
  });
}

const maxProposalBodyCharacters = 4000;
const maxUnchangedProposalExcerptCharacters = 500;

// Why not rethrow persistence failures: the stream and proposal records are
// best-effort observability and must never replace the run's real outcome,
// especially when a proposeFix failure is already unwinding.
async function persistFixPrStream(
  fixId: string,
  streamWriter: FixPrLlmStreamWriter,
  recordStream: (fixId: string, patch: FixPrRunStreamPatch) => Promise<void>,
): Promise<void> {
  try {
    const summary = await streamWriter.finish();
    const hasStreamOutput =
      summary.streamChunkCount > 0 || summary.llmOutputObjectPath !== undefined;
    if (!hasStreamOutput) {
      return;
    }

    await recordStream(fixId, summary);
  } catch (error) {
    writeStructuredLog({
      error: toStructuredLogError(error),
      fixId,
      message: "fix_pr_stream_persist_failed",
      severity: "WARNING",
    });
  }
}

async function persistFixPrProposal(
  fixId: string,
  proposal: AgyFixProposal,
  recordStream: (fixId: string, patch: FixPrRunStreamPatch) => Promise<void>,
): Promise<void> {
  try {
    await recordStream(fixId, {
      proposalBody: truncateText(proposal.body, maxProposalBodyCharacters),
      proposalTitle: proposal.title,
    });
  } catch (error) {
    writeStructuredLog({
      error: toStructuredLogError(error),
      fixId,
      message: "fix_pr_stream_persist_failed",
      severity: "WARNING",
    });
  }
}

function createUnchangedProposalMessage(proposal: AgyFixProposal): string {
  const excerpt = truncateText(proposal.body, maxUnchangedProposalExcerptCharacters);
  return `Fix proposal did not change the source file. Agent proposal "${proposal.title}": ${excerpt}`;
}

function createNoChangeProposalMessage(proposal: AgyFixProposal): string {
  const excerpt = truncateText(proposal.body, maxUnchangedProposalExcerptCharacters);
  return `Fix agent determined no code change is required. Agent proposal "${proposal.title}": ${excerpt}`;
}

function truncateText(text: string, maxCharacters: number): string {
  const isWithinLimit = text.length <= maxCharacters;
  if (isWithinLimit) {
    return text;
  }

  return `${text.slice(0, maxCharacters)}…`;
}

interface FixBase {
  sha: string;
  source: string;
}

// Why not require the default branch to stay at the scanned commit: unrelated
// commits routinely land after a scan, and the proposal only depends on the
// target file. Rebase onto the current head and reject only when the file
// itself diverged, because then the proposal would patch stale content.
async function resolveFixBase(github: FixPrGithubClient, request: FixPrRequest): Promise<FixBase> {
  const defaultBranch = await github.getRepositoryBranch(
    request.owner,
    request.repo,
    request.defaultBranch,
  );
  const hasDefaultBranch = defaultBranch !== undefined;
  if (!hasDefaultBranch) {
    throw new Error("Default branch was not found");
  }

  const source = await github.getRepositoryFile(
    request.owner,
    request.repo,
    request.file,
    request.headSha,
  );
  const hasSource = source !== undefined;
  if (!hasSource) {
    throw new Error("Source file was not found at the scanned commit");
  }

  const isSameBase = defaultBranch.sha === request.headSha;
  if (isSameBase) {
    return { sha: request.headSha, source };
  }

  const currentSource = await github.getRepositoryFile(
    request.owner,
    request.repo,
    request.file,
    defaultBranch.sha,
  );
  const isSourceUnchanged = currentSource === source;
  if (!isSourceUnchanged) {
    throw new Error(
      "Source file changed or was removed on the default branch since the scanned commit. Run a new scan to refresh the finding.",
    );
  }

  return { sha: defaultBranch.sha, source };
}

async function defaultProposeFix(
  request: FixPrRequest,
  sourceContent: string,
  config: SecurityAppConfig,
  options?: FixPrProposeOptions,
): Promise<AgyFixProposal> {
  return proposeFixWithAgyRunner(request, sourceContent, {
    config,
    ...(request.llmModel === undefined ? {} : { model: request.llmModel }),
    ...(options?.onStreamChunk === undefined ? {} : { onStreamChunk: options.onStreamChunk }),
    repoFullName: `${request.owner}/${request.repo}`,
  });
}

async function createGithubClient(
  request: FixPrRequest,
  dependencies: FixPrRunnerDependencies,
): Promise<GitHubClient> {
  const appId = readRequiredEnv("GITHUB_APP_ID");
  const privateKey = readRequiredEnv("GITHUB_APP_PRIVATE_KEY");
  const createToken = dependencies.createInstallationToken ?? createGitHubInstallationToken;
  const token = await createToken({ appId, privateKey }, request.installationId, {
    permissions: {
      contents: "write",
      pull_requests: "write",
    },
  });
  return new GitHubClient({ token });
}

function toFixPrRunError(error: unknown): Error {
  const isPermissionError = isGitHubFixPrPermissionError(error);
  if (!isPermissionError) {
    return error instanceof Error ? error : new Error(String(error));
  }

  return new Error(
    "GitHub App requires Contents: Read and write and Pull requests: Read and write permissions for Fix PR creation. Update the GitHub App settings and approve the installation permission change.",
  );
}

function isGitHubFixPrPermissionError(error: unknown): boolean {
  const isError = error instanceof Error;
  if (!isError) {
    return false;
  }

  const hasForbiddenStatus = error.message.includes("GitHub request failed: 403");
  const hasIntegrationPermissionMessage = error.message.includes(
    "Resource not accessible by integration",
  );
  const hasInstallationPermissionMessage =
    error.message.includes("Failed to create installation token: 403") ||
    error.message.includes("Failed to create installation token: 422");
  return (
    (hasForbiddenStatus && hasIntegrationPermissionMessage) || hasInstallationPermissionMessage
  );
}

function createFixBranchName(request: FixPrRequest): string {
  const normalizedSveId = request.sveId
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  const suffix = request.fixId.replace(/^fix-/, "").slice(0, 8);
  return `scanveil/fix/${normalizedSveId}-${suffix}`;
}

function createCommitMessage(request: FixPrRequest): string {
  return `fix: address ${request.sveId}`;
}

function createPullRequestBody(request: FixPrRequest, proposal: AgyFixProposal): string {
  return [
    proposal.body,
    "",
    `SVE-ID: ${request.sveId}`,
    `Finding: ${request.title}`,
    `Severity: ${request.severity}`,
    `Location: ${request.file}:${request.startLine}`,
    "",
    "Evidence:",
    request.evidence,
    "",
    "Recommendation:",
    request.recommendation,
    "",
    `Generated by ${productMetadata.displayName} from scan ${request.deliveryId}.`,
  ].join("\n");
}

function createFixPrAgentConfig(): SecurityAppConfig {
  return {
    checks: {
      conclusionMode: "advisory",
      failThreshold: {
        llm: "critical",
        osv: "critical",
      },
    },
    scan: {
      llm: {
        agent: {
          mcp: { enabled: false },
          plugins: { enabled: false },
          skills: { enabled: true },
          runner: "antigravity_experimental",
          timeoutSeconds: 900,
        },
        enabled: true,
        excludePaths: [],
        scope: "pr_diff",
      },
      osv: {
        enabled: false,
        lockfileGlobs: [],
        scope: "changed_lockfiles",
      },
    },
    schedule: { enabled: false },
    suppression: {
      enabled: false,
      maxNearestNeighbors: 10,
      similarityThreshold: 0.7,
    },
    version: 1,
  };
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
