import { AddressInfo } from "node:net";

import { createSignedSessionCookie } from "@scanveil/auth";
import type { FixPrRunRecord, FixPrStreamChunkRecord } from "@scanveil/core";
import { afterEach, describe, expect, it } from "vitest";

import { createConsoleUserSessionPayload, type ConsoleUserSession } from "../src/invites.js";
import { createConsoleServer, type ConsoleServerDependencies } from "../src/server.js";

const sessionSecret = "fix-pr-detail-test-secret";

describe("fix PR detail API", () => {
  const servers: Array<Awaited<ReturnType<typeof createConsoleServer>>> = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }

              resolve();
            });
          }),
      ),
    );
    servers.length = 0;
  });

  it("loads a fix PR run with repository-filtered stream chunks", async () => {
    const run = fixPrRun();
    const foreignChunk: FixPrStreamChunkRecord = {
      ...streamChunk(run.fixId),
      repoFullName: "another/repo",
      repositoryId: 20002,
      sequence: 1,
    };
    const { cookie, origin } = await startTestServer({
      listFixPrStreamChunks: async () => [streamChunk(run.fixId), foreignChunk],
      readFixPrRunRecord: async (fixId) => (fixId === run.fixId ? run : undefined),
    });

    const response = await fetch(`${origin}/api/fix-prs/${encodeURIComponent(run.fixId)}`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      chunks: FixPrStreamChunkRecord[];
      fixPrRun: FixPrRunRecord;
    };
    expect(body.fixPrRun.fixId).toBe(run.fixId);
    expect(body.chunks.map((chunk) => chunk.text)).toEqual(["chunk"]);
  });

  it("returns not found for fix PR runs outside repository access", async () => {
    const run = { ...fixPrRun(), owner: "another", repo: "repo", repositoryId: 20002 };
    const { cookie, origin } = await startTestServer({
      listFixPrStreamChunks: async () => [],
      readFixPrRunRecord: async () => run,
    });

    const response = await fetch(`${origin}/api/fix-prs/${encodeURIComponent(run.fixId)}`, {
      headers: { cookie },
    });

    expect(response.status).toBe(404);
  });

  it("serves the saved agent output through the fix PR llm-output route", async () => {
    const run = {
      ...fixPrRun(),
      llmOutputObjectPath: "gs://artifacts/fix-pr-runs/fix-route-1/llm-output.txt",
    };
    const readPaths: string[] = [];
    const { cookie, origin } = await startTestServer({
      listFixPrStreamChunks: async () => [],
      readFixPrRunRecord: async () => run,
      readLlmOutputObject: async (objectPath) => {
        readPaths.push(objectPath);
        return "agent output";
      },
    });

    const response = await fetch(
      `${origin}/api/fix-prs/${encodeURIComponent(run.fixId)}/llm-output`,
      { headers: { cookie } },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("agent output");
    expect(readPaths).toEqual(["gs://artifacts/fix-pr-runs/fix-route-1/llm-output.txt"]);
  });

  it("returns not found for the llm-output route when no saved output exists", async () => {
    const run = fixPrRun();
    const { cookie, origin } = await startTestServer({
      listFixPrStreamChunks: async () => [],
      readFixPrRunRecord: async () => run,
    });

    const response = await fetch(
      `${origin}/api/fix-prs/${encodeURIComponent(run.fixId)}/llm-output`,
      { headers: { cookie } },
    );

    expect(response.status).toBe(404);
  });

  async function startTestServer(dependencies: Partial<ConsoleServerDependencies>): Promise<{
    cookie: string;
    origin: string;
  }> {
    const session: ConsoleUserSession = {
      accessibleRepositoryFullNames: ["kexi/example"],
      accessibleRepositoryIds: [10001],
      githubLogin: "octocat",
      githubUserId: "1001",
    };
    const server = await createConsoleServer({
      dependencies: {
        listScanExecutions: async () => [],
        listFixPrRunsBySveId: async () => [],
        listScanFindingRecords: async () => [],
        listScanFindingRecordsBySveId: async () => [],
        listScanStreamChunks: async () => [],
        loadConsoleUserSessionAccess: async () => session,
        readScanRunRecord: async () => undefined,
        readSessionSecret: () => sessionSecret,
        requireInviteAccess: async () => ({
          code: "TEST",
          codeName: "Test",
          githubLogin: session.githubLogin,
          githubUserId: session.githubUserId,
          redeemedAt: "2026-06-30T00:00:00.000Z",
        }),
        ...dependencies,
      },
      env: {
        NODE_ENV: "production",
        SECURITY_APP_SESSION_SECRET: sessionSecret,
      },
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    servers.push(server);

    const address = server.address() as AddressInfo;
    const cookie = createSignedSessionCookie(
      createConsoleUserSessionPayload(session),
      sessionSecret,
    );
    return {
      cookie,
      origin: `http://127.0.0.1:${address.port}`,
    };
  }
});

function fixPrRun(): FixPrRunRecord {
  return {
    baseSha: "abc123",
    defaultBranch: "main",
    deliveryId: "delivery-1",
    endLine: 12,
    evidence: "innerHTML receives user input.",
    file: "src/app.ts",
    findingId: "AIVULN-route-1",
    fixId: "fix-route-1",
    installationId: 123,
    owner: "kexi",
    queuedAt: "2026-06-30T00:00:00.000Z",
    recommendation: "Use textContent.",
    repo: "example",
    repositoryId: 10001,
    severity: "high",
    startLine: 12,
    status: "failed",
    sveId: "SVE-route-1",
    title: "DOM XSS",
    updatedAt: "2026-06-30T00:01:00.000Z",
  };
}

function streamChunk(fixId: string): FixPrStreamChunkRecord {
  return {
    fixId,
    kind: "llm_chunk",
    repoFullName: "kexi/example",
    repositoryId: 10001,
    sequence: 0,
    text: "chunk",
    timestamp: "2026-06-30T00:00:01.000Z",
  };
}
