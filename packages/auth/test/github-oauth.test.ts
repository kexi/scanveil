import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGitHubOAuthUrl,
  fetchGitHubUserOrganizations,
  fetchGitHubUserRepositories,
} from "../src/github-oauth.js";

describe("createGitHubOAuthUrl", () => {
  it("requests organization membership access for repository authorization", () => {
    const url = new URL(
      createGitHubOAuthUrl(
        {
          clientId: "client-1",
          redirectUri: "https://console.example.test/oauth/callback",
        },
        "state-1",
      ),
    );

    expect(url.searchParams.get("scope")).toBe("repo read:user read:org");
  });
});

describe("fetchGitHubUserRepositories", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads visible repositories for the signed-in GitHub user", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json([{ full_name: "kexi/example", id: 10001 }], {
          headers: {
            link: '<https://api.github.test/user/repos?page=2>; rel="next"',
          },
        }),
      )
      .mockResolvedValueOnce(Response.json([{ full_name: "other-org/private-repo", id: 20001 }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchGitHubUserRepositories("token-1", "https://api.github.test"),
    ).resolves.toEqual([
      { full_name: "kexi/example", id: 10001 },
      { full_name: "other-org/private-repo", id: 20001 },
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.test/user/repos?affiliation=owner%2Ccollaborator%2Corganization_member&per_page=100",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer token-1" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.test/user/repos?page=2",
      expect.any(Object),
    );
  });
});

describe("fetchGitHubUserOrganizations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads all organization pages for the signed-in GitHub user", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json([{ login: "kexi" }], {
          headers: {
            link: '<https://api.github.test/user/orgs?page=2>; rel="next"',
          },
        }),
      )
      .mockResolvedValueOnce(Response.json([{ login: "scanveil" }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchGitHubUserOrganizations("token-1", "https://api.github.test"),
    ).resolves.toEqual([{ login: "kexi" }, { login: "scanveil" }]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.test/user/orgs?per_page=100",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer token-1" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.test/user/orgs?page=2",
      expect.any(Object),
    );
  });
});
