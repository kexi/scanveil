import type { GitHubAppRepository } from "@scanveil/github";

import type { ConsoleUserSession } from "./invites.js";

export function canAccessRepositoryFullName(
  session: ConsoleUserSession,
  repositoryFullName: string,
): boolean {
  const normalizedRepositoryFullName = normalizeGitHubRepositoryFullName(repositoryFullName);
  const hasAccessibleRepositoryFullNames = Array.isArray(session.accessibleRepositoryFullNames);
  if (hasAccessibleRepositoryFullNames) {
    return (session.accessibleRepositoryFullNames ?? [])
      .map(normalizeGitHubRepositoryFullName)
      .includes(normalizedRepositoryFullName);
  }

  const [owner] = repositoryFullName.split("/");
  const hasOwner = owner !== undefined && owner.length > 0;
  if (!hasOwner) {
    return false;
  }

  const normalizedOwner = normalizeGitHubLogin(owner);
  const normalizedUserLogin = normalizeGitHubLogin(session.githubLogin);
  return normalizedOwner === normalizedUserLogin;
}

export function canAccessGitHubAppRepository(
  session: ConsoleUserSession,
  repository: Pick<GitHubAppRepository, "fullName" | "repositoryId">,
): boolean {
  const hasAccessibleRepositoryIds = Array.isArray(session.accessibleRepositoryIds);
  if (hasAccessibleRepositoryIds) {
    return (session.accessibleRepositoryIds ?? []).includes(repository.repositoryId);
  }

  return canAccessRepositoryFullName(session, repository.fullName);
}

export function filterRepositoriesByUserAccess<
  T extends Pick<GitHubAppRepository, "fullName" | "repositoryId">,
>(repositories: T[], session: ConsoleUserSession): T[] {
  return repositories.filter((repository) => canAccessGitHubAppRepository(session, repository));
}

export function assertRepositoryAccess(
  session: ConsoleUserSession,
  owner: string,
  repo: string,
  repositoryId?: number,
): void {
  const repoFullName = `${owner}/${repo}`;
  const canAccess =
    repositoryId === undefined
      ? canAccessRepositoryFullName(session, repoFullName)
      : canAccessGitHubAppRepository(session, { fullName: repoFullName, repositoryId });
  if (!canAccess) {
    throw new RepositoryAccessDeniedError(repoFullName);
  }
}

export class RepositoryAccessDeniedError extends Error {
  readonly repoFullName: string;

  constructor(repoFullName: string) {
    super("repository_access_denied");
    this.repoFullName = repoFullName;
  }
}

function normalizeGitHubLogin(login: string): string {
  return login.trim().toLowerCase();
}

function normalizeGitHubRepositoryFullName(repositoryFullName: string): string {
  return repositoryFullName.trim().toLowerCase();
}
