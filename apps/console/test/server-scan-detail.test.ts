import { AddressInfo } from "node:net";

import { createSignedSessionCookie } from "@scanveil/auth";
import type { ScanFindingRecord, ScanRunRecord, ScanStreamChunkRecord } from "@scanveil/core";
import { afterEach, describe, expect, it } from "vitest";

import { createConsoleUserSessionPayload, type ConsoleUserSession } from "../src/invites.js";
import { createConsoleServer, type ConsoleServerDependencies } from "../src/server.js";

const sessionSecret = "scan-detail-test-secret";

describe("scan detail API", () => {
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

  it("loads a scan detail by delivery id without depending on recent history", async () => {
    const run = scanRun();
    const { cookie, origin } = await startTestServer({
      listScanExecutions: async () => [],
      listScanFindingRecords: async () => [finding(run.deliveryId)],
      listScanStreamChunks: async () => [streamChunk(run.deliveryId)],
      readScanRunRecord: async (deliveryId) => (deliveryId === run.deliveryId ? run : undefined),
    });

    const response = await fetch(`${origin}/api/scans/${encodeURIComponent(run.deliveryId)}`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      chunks: ScanStreamChunkRecord[];
      findings: ScanFindingRecord[];
      run: ScanRunRecord;
    };
    expect(body.run.deliveryId).toBe(run.deliveryId);
    expect(body.findings.map((candidate) => candidate.findingId)).toEqual(["AIVULN-route-1"]);
    expect(body.chunks.map((chunk) => chunk.text)).toEqual(["chunk"]);
  });

  it("returns not found for malformed encoded scan detail paths", async () => {
    const { cookie, origin } = await startTestServer({});

    const response = await fetch(`${origin}/api/scans/%`, {
      headers: { cookie },
    });

    expect(response.status).toBe(404);
  });

  it("loads SVE history from finding delivery ids beyond recent scan history", async () => {
    const run = scanRun();
    const sveFinding = {
      ...finding(run.deliveryId),
      endLine: 12,
      file: "src/app.ts",
      startLine: 12,
      sveId: "SVE-route-1",
    };
    const { cookie, origin } = await startTestServer({
      listFixPrRunsBySveId: async () => [],
      listScanExecutions: async () => [],
      listScanFindingRecords: async (deliveryIds) =>
        deliveryIds.includes(run.deliveryId) ? [sveFinding] : [],
      listScanFindingRecordsBySveId: async (sveId) =>
        sveId === sveFinding.sveId ? [sveFinding] : [],
      readScanRunRecord: async (deliveryId) => (deliveryId === run.deliveryId ? run : undefined),
    });

    const response = await fetch(`${origin}/api/sve/${encodeURIComponent(sveFinding.sveId)}`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      history: ScanRunRecord[];
      source?: {
        commitSha: string;
        githubUrl: string;
      };
    };
    expect(body.history.map((candidate) => candidate.deliveryId)).toEqual([run.deliveryId]);
    expect(body.source).toMatchObject({
      commitSha: run.headSha,
      githubUrl: "https://github.com/kexi/example/blob/abc123/src/app.ts#L12",
    });
  });

  it("returns a permission response when Fix PR preflight rejects GitHub App permissions", async () => {
    const run = scanRun();
    const sveFinding = {
      ...finding(run.deliveryId),
      endLine: 12,
      file: "src/app.ts",
      startLine: 12,
      sveId: "SVE-route-1",
    };
    const { cookie, origin } = await startTestServer({
      listScanExecutions: async () => [],
      listScanFindingRecords: async (deliveryIds) =>
        deliveryIds.includes(run.deliveryId) ? [sveFinding] : [],
      listScanFindingRecordsBySveId: async (sveId) =>
        sveId === sveFinding.sveId ? [sveFinding] : [],
      readScanRunRecord: async (deliveryId) => (deliveryId === run.deliveryId ? run : undefined),
      startFixPrRun: async () => {
        throw new Error(
          "GitHub App requires Contents: Read and write and Pull requests: Read and write permissions for Fix PR creation. Update the GitHub App settings and approve the installation permission change.",
        );
      },
    });

    const response = await fetch(
      `${origin}/api/sve/${encodeURIComponent(sveFinding.sveId)}/fix-prs`,
      {
        body: JSON.stringify({ findingId: sveFinding.findingId }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      },
    );

    expect(response.status).toBe(424);
    const body = (await response.json()) as { code: string; message: string };
    expect(body).toMatchObject({
      code: "github_fix_pr_permission_required",
    });
    expect(body.message).toContain("GitHub App の Contents: Read and write");
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

function scanRun(): ScanRunRecord {
  return {
    defaultBranch: "main",
    deliveryId: "manual-route-test",
    headSha: "abc123",
    installationId: 123,
    llmEnabled: true,
    osvEnabled: true,
    owner: "kexi",
    queuedAt: "2026-06-30T00:00:00.000Z",
    reason: "manual",
    repo: "example",
    repositoryId: 10001,
    status: "succeeded",
    target: "repository",
    updatedAt: "2026-06-30T00:01:00.000Z",
  };
}

function finding(deliveryId: string): ScanFindingRecord {
  return {
    aliases: [],
    category: "xss",
    confidence: 0.9,
    deliveryId,
    evidence: "evidence",
    findingId: "AIVULN-route-1",
    recommendation: "fix",
    repoFullName: "kexi/example",
    repositoryId: 10001,
    severity: "high",
    source: "llm",
    title: "DOM XSS",
    writtenAt: "2026-06-30T00:00:00.000Z",
  };
}

function streamChunk(deliveryId: string): ScanStreamChunkRecord {
  return {
    deliveryId,
    kind: "llm_chunk",
    repoFullName: "kexi/example",
    repositoryId: 10001,
    sequence: 0,
    text: "chunk",
    timestamp: "2026-06-30T00:00:01.000Z",
  };
}
