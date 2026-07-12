import { productMetadata, type PullRequestScanRequest } from "@scanveil/core";

export interface GitHubClientConfig {
  token: string;
  apiBaseUrl?: string;
  retryDelaysMs?: number[];
}

const defaultRetryDelaysMs = [500, 2000];
const transientStatusCodes = new Set([429, 500, 502, 503, 504]);

interface GitTreeResponse {
  tree?: GitTreeEntryResponse[];
}

interface GitHubIssueResponse {
  html_url?: string;
  number?: number;
}

interface GitHubCommitResponse {
  sha?: string;
  tree?: {
    sha?: string;
  };
}

interface GitHubPullRequestResponse {
  html_url?: string;
  number?: number;
}

interface GitHubTreeCreateResponse {
  sha?: string;
}

interface GitHubBranchResponse {
  commit?: {
    sha?: string;
  };
  name?: string;
}

export interface GitHubRepositoryBranch {
  name: string;
  sha: string;
}

interface GitTreeEntryResponse {
  path?: string;
  type?: string;
}

export class GitHubClient {
  readonly #apiBaseUrl: string;
  readonly #retryDelaysMs: number[];
  readonly #token: string;

  constructor(config: GitHubClientConfig) {
    this.#apiBaseUrl = config.apiBaseUrl ?? "https://api.github.com";
    this.#retryDelaysMs = config.retryDelaysMs ?? defaultRetryDelaysMs;
    this.#token = config.token;
  }

  async getPullRequestDiff(
    request: Pick<PullRequestScanRequest, "owner" | "repo" | "pullNumber">,
  ): Promise<string> {
    const path = `/repos/${request.owner}/${request.repo}/pulls/${request.pullNumber}`;
    return this.requestText(path, {
      accept: "application/vnd.github.v3.diff",
    });
  }

  async getRepositoryFile(
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string | undefined> {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const encodedRef = encodeURIComponent(ref);
    const response = await this.requestRaw(
      `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodedRef}`,
      {
        accept: "application/vnd.github.raw",
      },
    );

    const isMissing = response.status === 404;
    if (isMissing) {
      return undefined;
    }

    const isOk = response.ok;
    if (!isOk) {
      throw new Error(`GitHub file request failed: ${response.status} ${await response.text()}`);
    }

    return response.text();
  }

  async listRepositoryFiles(owner: string, repo: string, ref: string): Promise<string[]> {
    const encodedRef = encodeURIComponent(ref);
    const body = (await this.requestJson(
      `/repos/${owner}/${repo}/git/trees/${encodedRef}?recursive=1`,
      { method: "GET" },
    )) as GitTreeResponse;
    return (body.tree ?? []).flatMap((entry) => {
      const isFileEntry = entry.type === "blob";
      const path = entry.path;
      const hasPath = typeof path === "string" && path.length > 0;
      if (!isFileEntry || !hasPath) {
        return [];
      }

      return [path];
    });
  }

  async listRepositoryBranches(owner: string, repo: string): Promise<GitHubRepositoryBranch[]> {
    const branches = (await this.requestJson(`/repos/${owner}/${repo}/branches?per_page=100`, {
      method: "GET",
    })) as GitHubBranchResponse[];
    return branches.flatMap((branch) => {
      const name = branch.name;
      const sha = branch.commit?.sha;
      const hasBranch =
        typeof name === "string" && name.length > 0 && typeof sha === "string" && sha.length > 0;
      if (!hasBranch) {
        return [];
      }

      return [{ name, sha }];
    });
  }

  async getRepositoryBranch(
    owner: string,
    repo: string,
    branchName: string,
  ): Promise<GitHubRepositoryBranch | undefined> {
    const encodedBranchName = encodeURIComponent(branchName);
    const response = await this.requestRaw(
      `/repos/${owner}/${repo}/branches/${encodedBranchName}`,
      {
        accept: "application/vnd.github+json",
      },
    );

    const isMissing = response.status === 404;
    if (isMissing) {
      return undefined;
    }

    const isOk = response.ok;
    if (!isOk) {
      throw new Error(`GitHub request failed: ${response.status} ${await response.text()}`);
    }

    const branch = (await response.json()) as GitHubBranchResponse;
    const name = branch.name;
    const sha = branch.commit?.sha;
    const hasBranch =
      typeof name === "string" && name.length > 0 && typeof sha === "string" && sha.length > 0;
    if (!hasBranch) {
      return undefined;
    }

    return { name, sha };
  }

  async createCheckRun(owner: string, repo: string, payload: unknown): Promise<void> {
    await this.requestJson(`/repos/${owner}/${repo}/check-runs`, {
      body: JSON.stringify(payload),
      method: "POST",
    });
  }

  async updateCheckRun(
    owner: string,
    repo: string,
    checkRunId: number,
    payload: unknown,
  ): Promise<void> {
    await this.requestJson(`/repos/${owner}/${repo}/check-runs/${checkRunId}`, {
      body: JSON.stringify(payload),
      method: "PATCH",
    });
  }

  async createIssue(
    owner: string,
    repo: string,
    payload: { body: string; labels?: string[]; title: string },
  ): Promise<{ htmlUrl: string; number: number }> {
    const issue = (await this.requestJson(`/repos/${owner}/${repo}/issues`, {
      body: JSON.stringify(payload),
      method: "POST",
    })) as GitHubIssueResponse;
    return {
      htmlUrl: issue.html_url ?? "",
      number: issue.number ?? 0,
    };
  }

  async getCommitTreeSha(owner: string, repo: string, commitSha: string): Promise<string> {
    const commit = (await this.requestJson(`/repos/${owner}/${repo}/git/commits/${commitSha}`, {
      method: "GET",
    })) as GitHubCommitResponse;
    const treeSha = commit.tree?.sha;
    const hasTreeSha = typeof treeSha === "string" && treeSha.length > 0;
    if (!hasTreeSha) {
      throw new Error("GitHub commit response did not include tree SHA");
    }

    return treeSha;
  }

  async createTree(
    owner: string,
    repo: string,
    payload: {
      baseTree: string;
      files: Array<{ content: string; path: string }>;
    },
  ): Promise<string> {
    const tree = (await this.requestJson(`/repos/${owner}/${repo}/git/trees`, {
      body: JSON.stringify({
        base_tree: payload.baseTree,
        tree: payload.files.map((file) => ({
          content: file.content,
          mode: "100644",
          path: file.path,
          type: "blob",
        })),
      }),
      method: "POST",
    })) as GitHubTreeCreateResponse;
    const treeSha = tree.sha;
    const hasTreeSha = typeof treeSha === "string" && treeSha.length > 0;
    if (!hasTreeSha) {
      throw new Error("GitHub tree response did not include SHA");
    }

    return treeSha;
  }

  async createCommit(
    owner: string,
    repo: string,
    payload: { message: string; parentSha: string; treeSha: string },
  ): Promise<string> {
    const commit = (await this.requestJson(`/repos/${owner}/${repo}/git/commits`, {
      body: JSON.stringify({
        message: payload.message,
        parents: [payload.parentSha],
        tree: payload.treeSha,
      }),
      method: "POST",
    })) as GitHubCommitResponse;
    const commitSha = commit.sha;
    const hasCommitSha = typeof commitSha === "string" && commitSha.length > 0;
    if (!hasCommitSha) {
      throw new Error("GitHub commit response did not include SHA");
    }

    return commitSha;
  }

  async createBranch(owner: string, repo: string, branchName: string, sha: string): Promise<void> {
    await this.requestJson(`/repos/${owner}/${repo}/git/refs`, {
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha,
      }),
      method: "POST",
    });
  }

  async createPullRequest(
    owner: string,
    repo: string,
    payload: { base: string; body: string; draft: boolean; head: string; title: string },
  ): Promise<{ htmlUrl: string; number: number }> {
    const pullRequest = (await this.requestJson(`/repos/${owner}/${repo}/pulls`, {
      body: JSON.stringify(payload),
      method: "POST",
    })) as GitHubPullRequestResponse;
    return {
      htmlUrl: pullRequest.html_url ?? "",
      number: pullRequest.number ?? 0,
    };
  }

  private async requestText(path: string, headers: Record<string, string>): Promise<string> {
    const response = await this.requestRaw(path, headers);
    const isOk = response.ok;
    if (!isOk) {
      throw new Error(`GitHub request failed: ${response.status} ${await response.text()}`);
    }

    return response.text();
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.requestRaw(
      path,
      {
        accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
      init,
    );
    const isOk = response.ok;
    if (!isOk) {
      throw new Error(`GitHub request failed: ${response.status} ${await response.text()}`);
    }

    const hasBody = response.status !== 204;
    if (!hasBody) {
      return undefined;
    }

    return response.json();
  }

  private async requestRaw(
    path: string,
    headers: Record<string, string>,
    init: RequestInit = {},
  ): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    // Why not retry non-GET requests: check run / commit / issue creation is not
    // idempotent, so a retried transient failure could create duplicates.
    const isRetryable = method === "GET";
    const maxAttempts = isRetryable ? this.#retryDelaysMs.length + 1 : 1;
    for (let attempt = 1; ; attempt += 1) {
      const hasAttemptsLeft = attempt < maxAttempts;
      let response: Response;
      try {
        response = await fetch(`${this.#apiBaseUrl}${path}`, {
          ...init,
          headers: {
            ...headers,
            authorization: `Bearer ${this.#token}`,
            "user-agent": productMetadata.slug,
            "x-github-api-version": "2022-11-28",
            ...init.headers,
          },
        });
      } catch (error) {
        if (!hasAttemptsLeft) {
          throw error;
        }

        await delay(this.#retryDelaysMs[attempt - 1] ?? 0);
        continue;
      }

      const isTransientFailure = transientStatusCodes.has(response.status);
      if (!isTransientFailure || !hasAttemptsLeft) {
        return response;
      }

      await delay(this.#retryDelaysMs[attempt - 1] ?? 0);
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  const isImmediate = milliseconds <= 0;
  if (isImmediate) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
