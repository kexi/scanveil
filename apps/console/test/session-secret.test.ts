import { describe, expect, it } from "vitest";

import { readSessionSecret } from "../src/session-secret.js";

describe("readSessionSecret", () => {
  it("reads the session secret from an injected environment", () => {
    const secret = readSessionSecret({
      SECURITY_APP_SESSION_SECRET: "injected-secret",
    });

    expect(secret).toBe("injected-secret");
  });

  it("falls back to the injected OAuth client secret", () => {
    const secret = readSessionSecret({
      GITHUB_OAUTH_CLIENT_SECRET: "oauth-secret",
    });

    expect(secret).toBe("oauth-secret");
  });
});
