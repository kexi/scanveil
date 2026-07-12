import { productMetadata } from "@scanveil/core";
import {
  createGitHubAppJwt,
  createInstallationToken,
  type GitHubAppAuthConfig,
} from "./app-auth.js";

export interface GitHubAppRepository {
  accountLogin: string;
  accountType: string;
  defaultBranch: string;
  defaultBranchHeadSha: string;
  fullName: string;
  htmlUrl: string;
  installationId: number;
  isPrivate: boolean;
  openPullRequests: GitHubAppPullRequest[];
  openPullRequestsError?: string;
  repositoryId: number;
  updatedAt: string;
}

export interface GitHubAppPullRequest {
  authorLogin: string;
  headSha: string;
  htmlUrl: string;
  isDraft: boolean;
  number: number;
  title: string;
  updatedAt: string;
}

export interface GitHubAppPullRequestInput {
  installationId: number;
  owner: string;
  pullNumber: number;
  repo: string;
}

export interface GitHubAppRepositoryInput {
  installationId: number;
  owner: string;
  repo: string;
}

export interface GitHubAppRepositoryIdentity {
  fullName: string;
  repositoryId: number;
}

export interface GitHubAppInstallation {
  accountLogin: string;
  accountType: string;
  installationId: number;
  repositoryCount: number;
  repositorySelection: string;
}

interface GitHubInstallationResponse {
  account?: {
    login?: string;
    type?: string;
  } | null;
  id: number;
  repository_selection?: string;
  repositories_url?: string;
}

interface GitHubRepositoryResponse {
  default_branch?: string;
  full_name?: string;
  html_url?: string;
  id?: number;
  private?: boolean;
  updated_at?: string;
}

interface GitHubPullRequestResponse {
  draft?: boolean;
  head?: {
    sha?: string;
  };
  html_url?: string;
  number?: number;
  title?: string;
  updated_at?: string;
  user?: {
    login?: string;
  } | null;
}

interface GitHubBranchResponse {
  commit?: {
    sha?: string;
  };
}

interface GitHubInstallationRepositoriesResponse {
  repositories?: GitHubRepositoryResponse[];
}

export async function listGitHubAppRepositories(
  config: GitHubAppAuthConfig,
): Promise<GitHubAppRepository[]> {
  const apiBaseUrl = config.apiBaseUrl ?? "https://api.github.com";
  const jwt = createGitHubAppJwt(config);
  const installations = await requestPaginatedJson<GitHubInstallationResponse>(
    apiBaseUrl,
    "/app/installations",
    jwt,
  );

  const repositoryGroups = await Promise.all(
    installations.map(async (installation) => {
      const token = await createInstallationToken(config, installation.id);
      const repositories = await requestInstallationRepositories(apiBaseUrl, token);
      return Promise.all(
        repositories.map(async (repository) => {
          const [pullRequests, defaultBranchHeadSha] = await Promise.all([
            requestRepositoryPullRequests(apiBaseUrl, token, repository),
            requestRepositoryDefaultBranchHeadSha(apiBaseUrl, token, repository),
          ]);
          return toGitHubAppRepository(
            installation,
            repository,
            pullRequests,
            defaultBranchHeadSha,
          );
        }),
      );
    }),
  );

  return repositoryGroups.flat().sort((left, right) => left.fullName.localeCompare(right.fullName));
}

export async function listGitHubAppInstallations(
  config: GitHubAppAuthConfig,
): Promise<GitHubAppInstallation[]> {
  const apiBaseUrl = config.apiBaseUrl ?? "https://api.github.com";
  const jwt = createGitHubAppJwt(config);
  const installations = await requestPaginatedJson<GitHubInstallationResponse>(
    apiBaseUrl,
    "/app/installations",
    jwt,
  );
  const installationRows = await Promise.all(
    installations.map(async (installation) => {
      const token = await createInstallationToken(config, installation.id);
      const repositories = await requestInstallationRepositories(apiBaseUrl, token);
      return toGitHubAppInstallation(installation, repositories.length);
    }),
  );

  return installationRows.sort((left, right) =>
    left.accountLogin.localeCompare(right.accountLogin),
  );
}

export async function getGitHubAppPullRequest(
  config: GitHubAppAuthConfig,
  input: GitHubAppPullRequestInput,
): Promise<GitHubAppPullRequest> {
  const apiBaseUrl = config.apiBaseUrl ?? "https://api.github.com";
  const token = await createInstallationToken(config, input.installationId);
  const owner = encodeURIComponent(input.owner);
  const repo = encodeURIComponent(input.repo);
  const pullNumber = encodeURIComponent(String(input.pullNumber));
  const pullRequest = await requestGitHubJson<GitHubPullRequestResponse>(
    apiBaseUrl,
    `/repos/${owner}/${repo}/pulls/${pullNumber}`,
    token,
  );
  return toGitHubAppPullRequest(pullRequest);
}

export async function getGitHubAppRepositoryIdentity(
  config: GitHubAppAuthConfig,
  input: GitHubAppRepositoryInput,
): Promise<GitHubAppRepositoryIdentity> {
  const apiBaseUrl = config.apiBaseUrl ?? "https://api.github.com";
  // Why not list every installation: enumerating all installations rejects the whole
  // validation when any unrelated installation is suspended. The installation token is
  // scoped to that installation's repositories, so GET /repos returns 404 for a repo
  // outside it — that scoping is the membership check, and it does not need the
  // pull-request/default-branch/installation lookups the full repository shape fetches.
  const token = await createInstallationToken(config, input.installationId);
  const owner = encodeURIComponent(input.owner);
  const repo = encodeURIComponent(input.repo);
  const repository = await requestGitHubJson<GitHubRepositoryResponse>(
    apiBaseUrl,
    `/repos/${owner}/${repo}`,
    token,
  );
  const repositoryId = repository.id;
  const hasRepositoryId = typeof repositoryId === "number" && repositoryId > 0;
  if (!hasRepositoryId) {
    throw new Error(
      `GitHub repository response did not include id for ${repository.full_name ?? "unknown"}`,
    );
  }

  return { fullName: repository.full_name ?? "unknown", repositoryId };
}

async function requestInstallationRepositories(
  apiBaseUrl: string,
  token: string,
): Promise<GitHubRepositoryResponse[]> {
  const pages = await requestPaginatedJson<GitHubInstallationRepositoriesResponse>(
    apiBaseUrl,
    "/installation/repositories",
    token,
  );
  return pages.flatMap((page) => page.repositories ?? []);
}

async function requestRepositoryPullRequests(
  apiBaseUrl: string,
  token: string,
  repository: GitHubRepositoryResponse,
): Promise<PullRequestListResult> {
  const fullName = repository.full_name;
  const hasFullName = typeof fullName === "string" && fullName.length > 0;
  if (!hasFullName) {
    return { openPullRequests: [] };
  }

  const path = repositoryApiPath(fullName);
  try {
    const pullRequests = await requestPaginatedJson<GitHubPullRequestResponse>(
      apiBaseUrl,
      `${path}/pulls?state=open&per_page=20`,
      token,
    );
    return {
      openPullRequests: pullRequests.map(toGitHubAppPullRequest),
    };
  } catch (error) {
    const isForbidden = error instanceof GitHubRequestError && error.status === 403;
    if (isForbidden) {
      return {
        openPullRequests: [],
        openPullRequestsError: "GitHub App Pull requests permission is required.",
      };
    }

    throw error;
  }
}

async function requestRepositoryDefaultBranchHeadSha(
  apiBaseUrl: string,
  token: string,
  repository: GitHubRepositoryResponse,
): Promise<string> {
  const fullName = repository.full_name;
  const defaultBranch = repository.default_branch;
  const hasRepositoryRef =
    typeof fullName === "string" &&
    fullName.length > 0 &&
    typeof defaultBranch === "string" &&
    defaultBranch.length > 0;
  if (!hasRepositoryRef) {
    return "";
  }

  const path = repositoryApiPath(fullName);
  const branch = encodeURIComponent(defaultBranch);
  try {
    const branchResponse = await requestGitHubJson<GitHubBranchResponse>(
      apiBaseUrl,
      `${path}/branches/${branch}`,
      token,
    );
    return branchResponse.commit?.sha ?? "";
  } catch (error) {
    const isUnreadableDefaultBranch =
      error instanceof GitHubRequestError && (error.status === 403 || error.status === 404);
    if (isUnreadableDefaultBranch) {
      return "";
    }

    throw error;
  }
}

async function requestPaginatedJson<T>(
  apiBaseUrl: string,
  path: string,
  token: string,
): Promise<T[]> {
  const values: T[] = [];
  let nextPath: string | undefined = path.includes("?") ? path : `${path}?per_page=100`;

  while (nextPath !== undefined) {
    const response = await requestGitHub(apiBaseUrl, nextPath, token);
    const body = (await response.json()) as T[] | T;
    const isArrayBody = Array.isArray(body);
    if (isArrayBody) {
      values.push(...body);
    } else {
      values.push(body);
    }
    nextPath = parseNextPath(response.headers.get("link"));
  }

  return values;
}

async function requestGitHubJson<T>(apiBaseUrl: string, path: string, token: string): Promise<T> {
  const response = await requestGitHub(apiBaseUrl, path, token);
  return response.json() as Promise<T>;
}

async function requestGitHub(apiBaseUrl: string, path: string, token: string): Promise<Response> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": productMetadata.slug,
      "x-github-api-version": "2022-11-28",
    },
  });

  const isOk = response.ok;
  if (!isOk) {
    throw new GitHubRequestError(response.status, await response.text());
  }

  return response;
}

function parseNextPath(linkHeader: string | null): string | undefined {
  const hasLinkHeader = typeof linkHeader === "string" && linkHeader.length > 0;
  if (!hasLinkHeader) {
    return undefined;
  }

  const nextLink = linkHeader
    .split(",")
    .map((link) => link.trim())
    .find((link) => link.endsWith('rel="next"'));
  const hasNextLink = typeof nextLink === "string";
  if (!hasNextLink) {
    return undefined;
  }

  const match = nextLink.match(/^<([^>]+)>/);
  const hasMatch = match !== null;
  if (!hasMatch) {
    return undefined;
  }

  const matchedUrl = match[1];
  const hasMatchedUrl = typeof matchedUrl === "string";
  if (!hasMatchedUrl) {
    return undefined;
  }

  const url = new URL(matchedUrl);
  return `${url.pathname}${url.search}`;
}

function toGitHubAppRepository(
  installation: GitHubInstallationResponse,
  repository: GitHubRepositoryResponse,
  pullRequests: PullRequestListResult,
  defaultBranchHeadSha: string,
): GitHubAppRepository {
  const repositoryId = repository.id;
  const hasRepositoryId = typeof repositoryId === "number" && repositoryId > 0;
  if (!hasRepositoryId) {
    throw new Error(
      `GitHub repository response did not include id for ${repository.full_name ?? "unknown"}`,
    );
  }

  const appRepository: GitHubAppRepository = {
    accountLogin: installation.account?.login ?? "unknown",
    accountType: installation.account?.type ?? "unknown",
    defaultBranch: repository.default_branch ?? "unknown",
    defaultBranchHeadSha,
    fullName: repository.full_name ?? "unknown",
    htmlUrl: repository.html_url ?? "",
    installationId: installation.id,
    isPrivate: repository.private ?? false,
    openPullRequests: pullRequests.openPullRequests,
    repositoryId,
    updatedAt: repository.updated_at ?? "",
  };

  const openPullRequestsError = pullRequests.openPullRequestsError;
  const hasPullRequestsError = typeof openPullRequestsError === "string";
  if (hasPullRequestsError) {
    appRepository.openPullRequestsError = openPullRequestsError;
  }

  return appRepository;
}

function toGitHubAppInstallation(
  installation: GitHubInstallationResponse,
  repositoryCount: number,
): GitHubAppInstallation {
  return {
    accountLogin: installation.account?.login ?? "unknown",
    accountType: installation.account?.type ?? "unknown",
    installationId: installation.id,
    repositoryCount,
    repositorySelection: installation.repository_selection ?? "unknown",
  };
}

function toGitHubAppPullRequest(pullRequest: GitHubPullRequestResponse): GitHubAppPullRequest {
  return {
    authorLogin: pullRequest.user?.login ?? "unknown",
    headSha: pullRequest.head?.sha ?? "",
    htmlUrl: pullRequest.html_url ?? "",
    isDraft: pullRequest.draft ?? false,
    number: pullRequest.number ?? 0,
    title: pullRequest.title ?? "Untitled pull request",
    updatedAt: pullRequest.updated_at ?? "",
  };
}

function repositoryApiPath(fullName: string): string {
  const [owner, repo] = fullName.split("/");
  const hasRepositoryPath = typeof owner === "string" && typeof repo === "string";
  if (!hasRepositoryPath) {
    throw new Error(`Invalid GitHub repository full name: ${fullName}`);
  }

  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

interface PullRequestListResult {
  openPullRequests: GitHubAppPullRequest[];
  openPullRequestsError?: string;
}

export class GitHubRequestError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`GitHub App request failed: ${status} ${body}`);
  }
}
