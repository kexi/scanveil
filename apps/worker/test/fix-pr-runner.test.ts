import { afterEach, describe, expect, it, vi } from "vitest";

import type { FixPrRequest } from "@scanveil/core";
import { runFixPr } from "../src/fix-pr-runner.js";

describe("runFixPr", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("creates a draft pull request from an Agy fix proposal", async () => {
    const actions: string[] = [];
    const succeeded: unknown[] = [];
    const request = fixPrRequest();

    await runFixPr(request, {
      createGithubClient: async () => ({
        createBranch: async (_owner, _repo, branchName, sha) => {
          actions.push(`branch:${branchName}:${sha}`);
        },
        createCommit: async () => {
          actions.push("commit");
          return "commit-sha";
        },
        createPullRequest: async (_owner, _repo, payload) => {
          actions.push(`pr:${payload.draft}:${payload.head}`);
          return { htmlUrl: "https://github.com/kexi/example/pull/1", number: 1 };
        },
        createTree: async (_owner, _repo, payload) => {
          actions.push(`tree:${payload.files[0]?.path}`);
          return "tree-sha";
        },
        getCommitTreeSha: async () => "base-tree-sha",
        getRepositoryBranch: async () => ({ name: "main", sha: "abc123" }),
        getRepositoryFile: async () => "target.innerHTML = userInput;\n",
      }),
      markRunning: async (fixId) => {
        actions.push(`running:${fixId}`);
      },
      markSucceeded: async (_fixId, result) => {
        succeeded.push(result);
      },
      proposeFix: async () => ({
        body: "Replaces unsafe DOM sink.",
        files: [{ content: "target.textContent = userInput;\n", path: "src/app.ts" }],
        title: "Fix DOM XSS",
      }),
    });

    expect(actions).toEqual([
      "running:fix-1234567890",
      "tree:src/app.ts",
      "commit",
      "branch:scanveil/fix/sve-1-12345678:commit-sha",
      "pr:true:scanveil/fix/sve-1-12345678",
    ]);
    expect(succeeded).toEqual([
      {
        branchName: "scanveil/fix/sve-1-12345678",
        pullRequestNumber: 1,
        pullRequestUrl: "https://github.com/kexi/example/pull/1",
      },
    ]);
  });

  it("rebases the fix onto the current default branch head when the file is unchanged", async () => {
    const commitParents: string[] = [];
    const treeBaseShas: string[] = [];
    const request = fixPrRequest();

    await runFixPr(request, {
      createGithubClient: async () => ({
        createBranch: async () => {},
        createCommit: async (_owner, _repo, payload) => {
          commitParents.push(payload.parentSha);
          return "commit-sha";
        },
        createPullRequest: async () => ({
          htmlUrl: "https://github.com/kexi/example/pull/1",
          number: 1,
        }),
        createTree: async () => "tree-sha",
        getCommitTreeSha: async (_owner, _repo, commitSha) => {
          treeBaseShas.push(commitSha);
          return "base-tree-sha";
        },
        getRepositoryBranch: async () => ({ name: "main", sha: "new-sha" }),
        getRepositoryFile: async () => "target.innerHTML = userInput;\n",
      }),
      markRunning: async () => {},
      markSucceeded: async () => {},
      proposeFix: async () => ({
        body: "Replaces unsafe DOM sink.",
        files: [{ content: "target.textContent = userInput;\n", path: "src/app.ts" }],
        title: "Fix DOM XSS",
      }),
    });

    expect(commitParents).toEqual(["new-sha"]);
    expect(treeBaseShas).toEqual(["new-sha"]);
  });

  it("fails before writing when the file changed on the default branch", async () => {
    const failed: string[] = [];
    const request = fixPrRequest();
    const staleFileMessage =
      "Source file changed or was removed on the default branch since the scanned commit. Run a new scan to refresh the finding.";

    await expect(
      runFixPr(request, {
        createGithubClient: async () => ({
          createBranch: async () => {
            throw new Error("branch should not be created");
          },
          createCommit: async () => "commit-sha",
          createPullRequest: async () => ({ htmlUrl: "", number: 1 }),
          createTree: async () => "tree-sha",
          getCommitTreeSha: async () => "base-tree-sha",
          getRepositoryBranch: async () => ({ name: "main", sha: "new-sha" }),
          getRepositoryFile: async (_owner, _repo, _path, ref) =>
            ref === request.headSha
              ? "target.innerHTML = userInput;\n"
              : "target.innerHTML = sanitize(userInput);\n",
        }),
        markFailed: async (_fixId, error) => {
          failed.push(error instanceof Error ? error.message : String(error));
        },
        markRunning: async () => {},
      }),
    ).rejects.toThrow(staleFileMessage);

    expect(failed).toEqual([staleFileMessage]);
  });

  it("requests write-scoped GitHub installation permissions for fix PR creation", async () => {
    let tokenOptions: unknown;
    const requests: Array<{ authorization: string; body?: unknown; method: string; url: string }> =
      [];
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "private-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          authorization: new Headers(init?.headers).get("authorization") ?? "",
          body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
          method: init?.method ?? "GET",
          url: String(input),
        });

        const url = String(input);
        if (url.endsWith("/branches/main")) {
          return jsonResponse({ commit: { sha: "abc123" }, name: "main" });
        }
        if (url.endsWith("/contents/src/app.ts?ref=abc123")) {
          return textResponse("target.innerHTML = userInput;\n");
        }
        if (url.endsWith("/git/commits/abc123")) {
          return jsonResponse({ tree: { sha: "base-tree-sha" } });
        }
        if (url.endsWith("/git/trees")) {
          return jsonResponse({ sha: "tree-sha" });
        }
        if (url.endsWith("/git/commits")) {
          return jsonResponse({ sha: "commit-sha" });
        }
        if (url.endsWith("/git/refs")) {
          return jsonResponse({});
        }
        if (url.endsWith("/pulls")) {
          return jsonResponse({ html_url: "https://github.com/kexi/example/pull/1", number: 1 });
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    await runFixPr(fixPrRequest(), {
      createInstallationToken: async (_config, _installationId, options) => {
        tokenOptions = options;
        return "installation-token";
      },
      markRunning: async () => {},
      markSucceeded: async () => {},
      proposeFix: async () => ({
        body: "Replaces unsafe DOM sink.",
        files: [{ content: "target.textContent = userInput;\n", path: "src/app.ts" }],
        title: "Fix DOM XSS",
      }),
    });

    expect(tokenOptions).toEqual({
      permissions: {
        contents: "write",
        pull_requests: "write",
      },
    });
    expect(requests.every((request) => request.authorization === "Bearer installation-token")).toBe(
      true,
    );
  });

  it("persists streamed agent output before the pull request is created", async () => {
    const events: string[] = [];
    const streamPatches: unknown[] = [];

    await runFixPr(fixPrRequest(), {
      createGithubClient: async () => ({
        createBranch: async () => {},
        createCommit: async () => "commit-sha",
        createPullRequest: async () => {
          events.push("pr");
          return { htmlUrl: "https://github.com/kexi/example/pull/1", number: 1 };
        },
        createTree: async () => "tree-sha",
        getCommitTreeSha: async () => "base-tree-sha",
        getRepositoryBranch: async () => ({ name: "main", sha: "abc123" }),
        getRepositoryFile: async () => "target.innerHTML = userInput;\n",
      }),
      createLlmStreamWriter: () => ({
        finish: async () => {
          events.push("finish");
          return {
            llmOutputObjectPath: "gs://artifacts/fix-pr-runs/fix-1234567890/llm-output.txt",
            streamChunkCount: 2,
          };
        },
        writeText: async (text) => {
          events.push(`write:${text}`);
        },
      }),
      markRunning: async () => {},
      markSucceeded: async () => {},
      proposeFix: async (_request, _source, _config, options) => {
        await options?.onStreamChunk?.({ text: "thinking..." });
        await options?.onStreamChunk?.({ text: "done" });
        return {
          body: "Replaces unsafe DOM sink.",
          files: [{ content: "target.textContent = userInput;\n", path: "src/app.ts" }],
          title: "Fix DOM XSS",
        };
      },
      recordStream: async (_fixId, patch) => {
        streamPatches.push(patch);
      },
    });

    expect(events).toEqual(["write:thinking...", "write:done", "finish", "pr"]);
    expect(streamPatches).toEqual([
      {
        llmOutputObjectPath: "gs://artifacts/fix-pr-runs/fix-1234567890/llm-output.txt",
        streamChunkCount: 2,
      },
      {
        proposalBody: "Replaces unsafe DOM sink.",
        proposalTitle: "Fix DOM XSS",
      },
    ]);
  });

  it("persists the stream and surfaces the proposal explanation when the fix does not change the source file", async () => {
    const failed: string[] = [];
    const events: string[] = [];
    const streamPatches: unknown[] = [];
    const source = "target.innerHTML = userInput;\n";

    await expect(
      runFixPr(fixPrRequest(), {
        createGithubClient: async () => ({
          createBranch: async () => {
            throw new Error("branch should not be created");
          },
          createCommit: async () => "commit-sha",
          createPullRequest: async () => ({ htmlUrl: "", number: 1 }),
          createTree: async () => "tree-sha",
          getCommitTreeSha: async () => "base-tree-sha",
          getRepositoryBranch: async () => ({ name: "main", sha: "abc123" }),
          getRepositoryFile: async () => source,
        }),
        createLlmStreamWriter: () => ({
          finish: async () => {
            events.push("finish");
            return { streamChunkCount: 1 };
          },
          writeText: async (text) => {
            events.push(`write:${text}`);
          },
        }),
        markFailed: async (_fixId, error) => {
          failed.push(error instanceof Error ? error.message : String(error));
        },
        markRunning: async () => {},
        proposeFix: async (_request, _source, _config, options) => {
          await options?.onStreamChunk?.({ text: "no change needed" });
          return {
            body: "The sink is already sanitized upstream, so no code change is required.",
            files: [{ content: source, path: "src/app.ts" }],
            title: "No change required",
          };
        },
        recordStream: async (_fixId, patch) => {
          streamPatches.push(patch);
        },
      }),
    ).rejects.toThrow(
      'Fix proposal did not change the source file. Agent proposal "No change required": ' +
        "The sink is already sanitized upstream, so no code change is required.",
    );

    expect(events).toEqual(["write:no change needed", "finish"]);
    expect(streamPatches).toEqual([
      { streamChunkCount: 1 },
      {
        proposalBody: "The sink is already sanitized upstream, so no code change is required.",
        proposalTitle: "No change required",
      },
    ]);
    expect(failed).toEqual([
      'Fix proposal did not change the source file. Agent proposal "No change required": ' +
        "The sink is already sanitized upstream, so no code change is required.",
    ]);
  });

  it("fails with the agent's explanation when the proposal requires no code change", async () => {
    const failed: string[] = [];
    const streamPatches: unknown[] = [];

    await expect(
      runFixPr(fixPrRequest(), {
        createGithubClient: async () => ({
          createBranch: async () => {
            throw new Error("branch should not be created");
          },
          createCommit: async () => "commit-sha",
          createPullRequest: async () => ({ htmlUrl: "", number: 1 }),
          createTree: async () => "tree-sha",
          getCommitTreeSha: async () => "base-tree-sha",
          getRepositoryBranch: async () => ({ name: "main", sha: "abc123" }),
          getRepositoryFile: async () => "target.innerHTML = userInput;\n",
        }),
        createLlmStreamWriter: () => ({
          finish: async () => ({ streamChunkCount: 0 }),
          writeText: async () => {},
        }),
        markFailed: async (_fixId, error) => {
          failed.push(error instanceof Error ? error.message : String(error));
        },
        markRunning: async () => {},
        proposeFix: async () => ({
          body: "The finding is a scanner false positive.",
          files: [],
          title: "No change required",
        }),
        recordStream: async (_fixId, patch) => {
          streamPatches.push(patch);
        },
      }),
    ).rejects.toThrow(
      'Fix agent determined no code change is required. Agent proposal "No change required": ' +
        "The finding is a scanner false positive.",
    );

    expect(failed).toHaveLength(1);
    expect(streamPatches).toEqual([
      {
        proposalBody: "The finding is a scanner false positive.",
        proposalTitle: "No change required",
      },
    ]);
  });

  it("persists the stream when the proposal itself fails", async () => {
    const events: string[] = [];
    const streamPatches: unknown[] = [];

    await expect(
      runFixPr(fixPrRequest(), {
        createGithubClient: async () => ({
          createBranch: async () => {},
          createCommit: async () => "commit-sha",
          createPullRequest: async () => ({ htmlUrl: "", number: 1 }),
          createTree: async () => "tree-sha",
          getCommitTreeSha: async () => "base-tree-sha",
          getRepositoryBranch: async () => ({ name: "main", sha: "abc123" }),
          getRepositoryFile: async () => "target.innerHTML = userInput;\n",
        }),
        createLlmStreamWriter: () => ({
          finish: async () => {
            events.push("finish");
            return { streamChunkCount: 1 };
          },
          writeText: async (text) => {
            events.push(`write:${text}`);
          },
        }),
        markFailed: async () => {},
        markRunning: async () => {},
        proposeFix: async (_request, _source, _config, options) => {
          await options?.onStreamChunk?.({ text: "partial output" });
          throw new Error("agy-runner failed with code 1");
        },
        recordStream: async (_fixId, patch) => {
          streamPatches.push(patch);
        },
      }),
    ).rejects.toThrow("agy-runner failed with code 1");

    expect(events).toEqual(["write:partial output", "finish"]);
    expect(streamPatches).toEqual([{ streamChunkCount: 1 }]);
  });

  it("does not fail the run when stream persistence fails", async () => {
    const succeeded: unknown[] = [];

    await runFixPr(fixPrRequest(), {
      createGithubClient: async () => ({
        createBranch: async () => {},
        createCommit: async () => "commit-sha",
        createPullRequest: async () => ({
          htmlUrl: "https://github.com/kexi/example/pull/1",
          number: 1,
        }),
        createTree: async () => "tree-sha",
        getCommitTreeSha: async () => "base-tree-sha",
        getRepositoryBranch: async () => ({ name: "main", sha: "abc123" }),
        getRepositoryFile: async () => "target.innerHTML = userInput;\n",
      }),
      createLlmStreamWriter: () => ({
        finish: async () => {
          throw new Error("stream finish failed");
        },
        writeText: async () => {},
      }),
      markRunning: async () => {},
      markSucceeded: async (_fixId, result) => {
        succeeded.push(result);
      },
      proposeFix: async () => ({
        body: "Replaces unsafe DOM sink.",
        files: [{ content: "target.textContent = userInput;\n", path: "src/app.ts" }],
        title: "Fix DOM XSS",
      }),
      recordStream: async () => {
        throw new Error("record stream failed");
      },
    });

    expect(succeeded).toHaveLength(1);
  });

  it("stores an actionable message when GitHub rejects fix PR writes", async () => {
    const failed: string[] = [];

    await expect(
      runFixPr(fixPrRequest(), {
        createGithubClient: async () => ({
          createBranch: async () => {},
          createCommit: async () => "commit-sha",
          createPullRequest: async () => ({ htmlUrl: "", number: 1 }),
          createTree: async () => {
            throw new Error(
              'GitHub request failed: 403 {"message":"Resource not accessible by integration"}',
            );
          },
          getCommitTreeSha: async () => "base-tree-sha",
          getRepositoryBranch: async () => ({ name: "main", sha: "abc123" }),
          getRepositoryFile: async () => "target.innerHTML = userInput;\n",
        }),
        markFailed: async (_fixId, error) => {
          failed.push(error instanceof Error ? error.message : String(error));
        },
        markRunning: async () => {},
        proposeFix: async () => ({
          body: "Replaces unsafe DOM sink.",
          files: [{ content: "target.textContent = userInput;\n", path: "src/app.ts" }],
          title: "Fix DOM XSS",
        }),
      }),
    ).rejects.toThrow("GitHub App requires Contents: Read and write");

    expect(failed).toEqual([
      "GitHub App requires Contents: Read and write and Pull requests: Read and write permissions for Fix PR creation. Update the GitHub App settings and approve the installation permission change.",
    ]);
  });
});

function fixPrRequest(): FixPrRequest {
  return {
    defaultBranch: "main",
    deliveryId: "delivery-1",
    endLine: 12,
    evidence: "innerHTML receives user input.",
    file: "src/app.ts",
    findingId: "AIVULN-1",
    fixId: "fix-1234567890",
    headSha: "abc123",
    installationId: 123,
    owner: "kexi",
    recommendation: "Use textContent.",
    repo: "example",
    repositoryId: 10001,
    severity: "high",
    startLine: 12,
    sveId: "SVE-1",
    title: "DOM XSS",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}
