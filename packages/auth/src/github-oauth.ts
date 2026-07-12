import { productMetadata } from "@scanveil/core";

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  baseUrl?: string;
  apiBaseUrl?: string;
}

export interface GitHubUser {
  id: number;
  login: string;
  name?: string;
}

export interface GitHubOrganization {
  login: string;
}

export interface GitHubUserRepository {
  full_name: string;
  id: number;
}

export function createGitHubOAuthUrl(
  config: Pick<GitHubOAuthConfig, "clientId" | "redirectUri" | "baseUrl">,
  state: string,
): string {
  const baseUrl = config.baseUrl ?? "https://github.com";
  const url = new URL("/login/oauth/authorize", baseUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", "repo read:user read:org");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function fetchGitHubUserOrganizations(
  token: string,
  apiBaseUrl = "https://api.github.com",
): Promise<GitHubOrganization[]> {
  const organizations: GitHubOrganization[] = [];
  let nextUrl: string | undefined = `${apiBaseUrl}/user/orgs?per_page=100`;
  while (nextUrl !== undefined) {
    const response = await fetch(nextUrl, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": productMetadata.slug,
        "x-github-api-version": "2022-11-28",
      },
    });

    const isOk = response.ok;
    if (!isOk) {
      throw new Error(
        `GitHub organizations request failed: ${response.status} ${await response.text()}`,
      );
    }

    organizations.push(...((await response.json()) as GitHubOrganization[]));
    nextUrl = readNextLink(response.headers.get("link"));
  }

  return organizations;
}

export async function fetchGitHubUserRepositories(
  token: string,
  apiBaseUrl = "https://api.github.com",
): Promise<GitHubUserRepository[]> {
  const repositories: GitHubUserRepository[] = [];
  const params = new URLSearchParams({
    affiliation: "owner,collaborator,organization_member",
    per_page: "100",
  });
  let nextUrl: string | undefined = `${apiBaseUrl}/user/repos?${params.toString()}`;
  while (nextUrl !== undefined) {
    const response = await fetch(nextUrl, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": productMetadata.slug,
        "x-github-api-version": "2022-11-28",
      },
    });

    const isOk = response.ok;
    if (!isOk) {
      throw new Error(
        `GitHub repositories request failed: ${response.status} ${await response.text()}`,
      );
    }

    repositories.push(...((await response.json()) as GitHubUserRepository[]));
    nextUrl = readNextLink(response.headers.get("link"));
  }

  return repositories;
}

function readNextLink(linkHeader: string | null): string | undefined {
  const hasLinkHeader = typeof linkHeader === "string" && linkHeader.length > 0;
  if (!hasLinkHeader) {
    return undefined;
  }

  const nextLink = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.endsWith('rel="next"'));
  const hasNextLink = nextLink !== undefined;
  if (!hasNextLink) {
    return undefined;
  }

  const match = /^<([^>]+)>;/.exec(nextLink);
  return match?.[1];
}

export async function exchangeGitHubOAuthCode(
  config: GitHubOAuthConfig,
  code: string,
): Promise<string> {
  const baseUrl = config.baseUrl ?? "https://github.com";
  const response = await fetch(new URL("/login/oauth/access_token", baseUrl), {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
    headers: {
      accept: "application/json",
    },
    method: "POST",
  });

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `GitHub OAuth token exchange failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { access_token?: string };
  const token = body.access_token;
  const hasToken = typeof token === "string";
  if (!hasToken) {
    throw new Error("GitHub OAuth response did not include access_token");
  }

  return token;
}

export async function fetchGitHubUser(
  token: string,
  apiBaseUrl = "https://api.github.com",
): Promise<GitHubUser> {
  const response = await fetch(`${apiBaseUrl}/user`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": productMetadata.slug,
      "x-github-api-version": "2022-11-28",
    },
  });

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`GitHub user request failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as GitHubUser;
  return body;
}
