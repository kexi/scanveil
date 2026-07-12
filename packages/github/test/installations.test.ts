import { generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { listGitHubAppRepositories } from "../src/installations.js";

describe("listGitHubAppRepositories", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps listing repositories when one default branch cannot be read", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const isInstallationsRequest =
        method === "GET" && url === "https://github.test/app/installations?per_page=100";
      if (isInstallationsRequest) {
        return jsonResponse([
          {
            account: { login: "kexi", type: "User" },
            id: 123,
            repository_selection: "selected",
          },
        ]);
      }

      const isTokenRequest =
        method === "POST" && url === "https://github.test/app/installations/123/access_tokens";
      if (isTokenRequest) {
        return jsonResponse({ token: "installation-token" });
      }

      const isRepositoriesRequest =
        method === "GET" && url === "https://github.test/installation/repositories?per_page=100";
      if (isRepositoriesRequest) {
        return jsonResponse({
          repositories: [
            repositoryResponse("kexi/empty", 1001, "main"),
            repositoryResponse("kexi/example", 1002, "main"),
          ],
        });
      }

      const isEmptyBranchRequest =
        method === "GET" && url === "https://github.test/repos/kexi/empty/branches/main";
      if (isEmptyBranchRequest) {
        return textResponse("Not Found", 404);
      }

      const isExampleBranchRequest =
        method === "GET" && url === "https://github.test/repos/kexi/example/branches/main";
      if (isExampleBranchRequest) {
        return jsonResponse({ commit: { sha: "abc123" } });
      }

      const isPullRequestsRequest =
        method === "GET" && url.endsWith("/pulls?state=open&per_page=20");
      if (isPullRequestsRequest) {
        return jsonResponse([]);
      }

      throw new Error(`Unexpected GitHub request: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const repositories = await listGitHubAppRepositories({
      apiBaseUrl: "https://github.test",
      appId: "app-1",
      privateKey: privateKeyPem,
    });

    expect(repositories).toEqual([
      expect.objectContaining({
        defaultBranchHeadSha: "",
        fullName: "kexi/empty",
      }),
      expect.objectContaining({
        defaultBranchHeadSha: "abc123",
        fullName: "kexi/example",
      }),
    ]);
  });
});

function repositoryResponse(fullName: string, id: number, defaultBranch: string): unknown {
  return {
    default_branch: defaultBranch,
    full_name: fullName,
    html_url: `https://github.test/${fullName}`,
    id,
    private: false,
    updated_at: "2026-06-20T00:00:00Z",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}
