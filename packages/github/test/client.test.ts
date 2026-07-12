import { describe, expect, it, vi } from "vitest";

import { GitHubClient } from "../src/client.js";

describe("GitHubClient fix PR helpers", () => {
  it("reads a single repository branch directly", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ commit: { sha: "abc123" }, name: "release/v1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const github = new GitHubClient({ apiBaseUrl: "https://github.test", token: "token" });
    const branch = await github.getRepositoryBranch("kexi", "example", "release/v1");

    expect(branch).toEqual({ name: "release/v1", sha: "abc123" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.test/repos/kexi/example/branches/release%2Fv1",
      expect.anything(),
    );
  });

  it("creates a tree, commit, branch, and draft pull request", async () => {
    const requests: Array<{ body?: unknown; method: string; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
          method: init?.method ?? "GET",
          url: String(input),
        });

        const url = String(input);
        if (url.endsWith("/git/commits/base-sha")) {
          return jsonResponse({ tree: { sha: "tree-sha" } });
        }
        if (url.endsWith("/git/trees")) {
          return jsonResponse({ sha: "new-tree-sha" });
        }
        if (url.endsWith("/git/commits")) {
          return jsonResponse({ sha: "new-commit-sha" });
        }
        if (url.endsWith("/git/refs")) {
          return jsonResponse({}, 201);
        }
        if (url.endsWith("/pulls")) {
          return jsonResponse({ html_url: "https://github.test/kexi/example/pull/7", number: 7 });
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    const github = new GitHubClient({ apiBaseUrl: "https://github.test", token: "token" });
    const baseTree = await github.getCommitTreeSha("kexi", "example", "base-sha");
    const tree = await github.createTree("kexi", "example", {
      baseTree,
      files: [{ content: "fixed", path: "src/app.ts" }],
    });
    const commit = await github.createCommit("kexi", "example", {
      message: "fix: address Scanveil finding",
      parentSha: "base-sha",
      treeSha: tree,
    });
    await github.createBranch("kexi", "example", "scanveil/fix/sve-1", commit);
    const pullRequest = await github.createPullRequest("kexi", "example", {
      base: "main",
      body: "Fixes SVE-1",
      draft: true,
      head: "scanveil/fix/sve-1",
      title: "Fix SVE-1",
    });

    expect(pullRequest).toEqual({
      htmlUrl: "https://github.test/kexi/example/pull/7",
      number: 7,
    });
    expect(requests).toEqual([
      expect.objectContaining({
        method: "GET",
        url: "https://github.test/repos/kexi/example/git/commits/base-sha",
      }),
      expect.objectContaining({
        body: {
          base_tree: "tree-sha",
          tree: [{ content: "fixed", mode: "100644", path: "src/app.ts", type: "blob" }],
        },
        method: "POST",
      }),
      expect.objectContaining({
        body: {
          message: "fix: address Scanveil finding",
          parents: ["base-sha"],
          tree: "new-tree-sha",
        },
        method: "POST",
      }),
      expect.objectContaining({
        body: { ref: "refs/heads/scanveil/fix/sve-1", sha: "new-commit-sha" },
        method: "POST",
      }),
      expect.objectContaining({
        body: {
          base: "main",
          body: "Fixes SVE-1",
          draft: true,
          head: "scanveil/fix/sve-1",
          title: "Fix SVE-1",
        },
        method: "POST",
      }),
    ]);
  });
});

describe("GitHubClient transient failure retry", () => {
  it("retries a GET that transiently fails with 502 and returns the recovered response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unicorn!", { status: 502 }))
      .mockResolvedValueOnce(new Response("file content", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const github = new GitHubClient({
      apiBaseUrl: "https://github.test",
      retryDelaysMs: [0, 0],
      token: "token",
    });
    const file = await github.getRepositoryFile("kexi", "example", "src/app.ts", "main");

    expect(file).toBe("file content");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a GET whose fetch rejects with a network error", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("file content", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const github = new GitHubClient({
      apiBaseUrl: "https://github.test",
      retryDelaysMs: [0, 0],
      token: "token",
    });
    const file = await github.getRepositoryFile("kexi", "example", "src/app.ts", "main");

    expect(file).toBe("file content");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails after exhausting retries when the transient failure persists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Unicorn!", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const github = new GitHubClient({
      apiBaseUrl: "https://github.test",
      retryDelaysMs: [0, 0],
      token: "token",
    });

    await expect(github.getRepositoryFile("kexi", "example", "src/app.ts", "main")).rejects.toThrow(
      "GitHub file request failed: 502",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a POST so non-idempotent requests are never duplicated", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Unicorn!", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const github = new GitHubClient({
      apiBaseUrl: "https://github.test",
      retryDelaysMs: [0, 0],
      token: "token",
    });

    await expect(github.createCheckRun("kexi", "example", {})).rejects.toThrow(
      "GitHub request failed: 502",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 404 because missing files are an expected outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const github = new GitHubClient({
      apiBaseUrl: "https://github.test",
      retryDelaysMs: [0, 0],
      token: "token",
    });
    const file = await github.getRepositoryFile("kexi", "example", "missing.ts", "main");

    expect(file).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
