import {
  listGitHubAppRepositories,
  type GitHubAppAuthConfig,
  type GitHubAppRepository,
} from "@scanveil/github";

import type { ConsoleUserSession } from "./invites.js";
import { filterRepositoriesByUserAccess } from "./repository-access.js";

export interface RepositoryRow {
  account: string;
  defaultBranch: string;
  defaultBranchHeadSha: string;
  fullName: string;
  htmlUrl: string;
  installationId: number;
  openPullRequests: PullRequestRow[];
  openPullRequestsError?: string;
  owner: string;
  repo: string;
  repositoryId: number;
  updatedAt: string;
  visibility: string;
}

export interface PullRequestRow {
  author: string;
  headSha: string;
  htmlUrl: string;
  isDraft: boolean;
  number: number;
  title: string;
  updatedAt: string;
}

export interface RepositoryDashboardData {
  error?: string;
  isConfigured: boolean;
  repositories: RepositoryRow[];
}

export async function loadRepositoryDashboardData(
  session: ConsoleUserSession,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RepositoryDashboardData> {
  const config = readGitHubAppConfig(env);
  const isConfigured = config !== undefined;
  if (!isConfigured) {
    return {
      isConfigured: false,
      repositories: [],
    };
  }

  try {
    const repositories = filterRepositoriesByUserAccess(
      await listGitHubAppRepositories(config),
      session,
    );
    return {
      isConfigured: true,
      repositories: repositories.map(toRepositoryRow),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: message,
      isConfigured: true,
      repositories: [],
    };
  }
}

export function readGitHubAppConfig(env: NodeJS.ProcessEnv): GitHubAppAuthConfig | undefined {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  const hasAppId = typeof appId === "string" && appId.length > 0;
  const hasPrivateKey = typeof privateKey === "string" && privateKey.length > 0;
  const isMissingConfig = !hasAppId || !hasPrivateKey;
  if (isMissingConfig) {
    return undefined;
  }

  return {
    appId,
    privateKey,
  };
}

function toRepositoryRow(repository: GitHubAppRepository): RepositoryRow {
  const [owner = "unknown", repo = "unknown"] = repository.fullName.split("/");
  const row: RepositoryRow = {
    account: `${repository.accountLogin} (${repository.accountType})`,
    defaultBranch: repository.defaultBranch,
    defaultBranchHeadSha: repository.defaultBranchHeadSha,
    fullName: repository.fullName,
    htmlUrl: repository.htmlUrl,
    installationId: repository.installationId,
    openPullRequests: repository.openPullRequests.map(toPullRequestRow),
    owner,
    repo,
    repositoryId: repository.repositoryId,
    updatedAt: formatDate(repository.updatedAt),
    visibility: repository.isPrivate ? "Private" : "Public",
  };

  const openPullRequestsError = repository.openPullRequestsError;
  const hasPullRequestsError = openPullRequestsError !== undefined;
  if (hasPullRequestsError) {
    row.openPullRequestsError = openPullRequestsError;
  }

  return row;
}

function toPullRequestRow(
  pullRequest: GitHubAppRepository["openPullRequests"][number],
): PullRequestRow {
  return {
    author: pullRequest.authorLogin,
    headSha: pullRequest.headSha,
    htmlUrl: pullRequest.htmlUrl,
    isDraft: pullRequest.isDraft,
    number: pullRequest.number,
    title: pullRequest.title,
    updatedAt: formatDate(pullRequest.updatedAt),
  };
}

function formatDate(value: string): string {
  const hasValue = value.length > 0;
  if (!hasValue) {
    return "unknown";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}
