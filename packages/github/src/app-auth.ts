import { createSign } from "node:crypto";

export interface GitHubAppAuthConfig {
  appId: string;
  privateKey: string;
  apiBaseUrl?: string;
}

export interface GitHubInstallationTokenOptions {
  permissions?: Record<string, "read" | "write">;
}

export function createGitHubAppJwt(
  config: GitHubAppAuthConfig,
  now = Math.floor(Date.now() / 1000),
): string {
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iat: now - 60,
    exp: now + 540,
    iss: config.appId,
  });

  const unsignedToken = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(formatPrivateKey(config.privateKey), "base64url");
  return `${unsignedToken}.${signature}`;
}

export async function createInstallationToken(
  config: GitHubAppAuthConfig,
  installationId: number,
  options: GitHubInstallationTokenOptions = {},
): Promise<string> {
  const apiBaseUrl = config.apiBaseUrl ?? "https://api.github.com";
  const jwt = createGitHubAppJwt(config);
  const hasPermissions = options.permissions !== undefined;
  const response = await fetch(`${apiBaseUrl}/app/installations/${installationId}/access_tokens`, {
    ...(hasPermissions ? { body: JSON.stringify({ permissions: options.permissions }) } : {}),
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${jwt}`,
      ...(hasPermissions ? { "content-type": "application/json" } : {}),
      "x-github-api-version": "2022-11-28",
    },
  });

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Failed to create installation token: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { token?: string };
  const token = body.token;
  const hasToken = typeof token === "string";
  if (!hasToken) {
    throw new Error("GitHub installation token response did not include token");
  }

  return token;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function formatPrivateKey(privateKey: string): string {
  const hasEscapedNewlines = privateKey.includes("\\n");
  if (!hasEscapedNewlines) {
    return privateKey;
  }

  return privateKey.replaceAll("\\n", "\n");
}
