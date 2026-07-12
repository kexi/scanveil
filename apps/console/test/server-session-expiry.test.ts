import { AddressInfo } from "node:net";

import { createSignedSessionCookie } from "@scanveil/auth";
import { afterEach, describe, expect, it } from "vitest";

import {
  RepositoryAccessExpiredError,
  createConsoleUserSessionPayload,
  type ConsoleUserSession,
} from "../src/invites.js";
import { createConsoleServer, type ConsoleServerDependencies } from "../src/server.js";

const sessionSecret = "session-expiry-test-secret";

describe("repository access snapshot expiry", () => {
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

  it("returns 401 from API routes instead of an empty dashboard when access expires", async () => {
    const { cookie, origin } = await startTestServer({
      loadConsoleUserSessionAccess: async () => {
        throw new RepositoryAccessExpiredError();
      },
    });

    const response = await fetch(`${origin}/api/dashboard`, {
      headers: { cookie },
    });

    expect(response.status).toBe(401);
  });

  it("redirects page requests to /login when access expires", async () => {
    const { cookie, origin } = await startTestServer({
      loadConsoleUserSessionAccess: async () => {
        throw new RepositoryAccessExpiredError();
      },
    });

    const response = await fetch(origin, {
      headers: { cookie },
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("keeps serving the dashboard while the access snapshot is fresh", async () => {
    const { cookie, origin } = await startTestServer({});

    const response = await fetch(`${origin}/api/dashboard`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
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
        loadConsoleUserSessionAccess: async () => session,
        loadRepositoryDashboardData: async () => ({
          isConfigured: true,
          repositories: [],
        }),
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
