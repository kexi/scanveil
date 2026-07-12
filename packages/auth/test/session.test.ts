import { describe, expect, it } from "vitest";

import {
  createSignedSessionCookie,
  createSignedSessionToken,
  createSessionCookie,
  readSessionCookie,
  readSignedSessionCookie,
  verifySignedSessionToken,
} from "../src/session.js";

describe("session cookie", () => {
  it("round-trips a token", () => {
    const cookie = createSessionCookie("token");

    expect(readSessionCookie(cookie)).toBe("token");
  });

  it("round-trips a signed session payload", () => {
    const cookie = createSignedSessionCookie("123:octocat", "secret");

    expect(readSignedSessionCookie(cookie, "secret")).toBe("123:octocat");
  });

  it("rejects a signed session token when the payload was tampered with", () => {
    const token = createSignedSessionToken("123:octocat", "secret");
    const [, signature] = token.split(".");
    const tamperedPayload = {
      expiresAt: Date.now() + 60 * 60 * 8 * 1000,
      value: "456:mallory",
    };
    const tamperedToken = `${Buffer.from(JSON.stringify(tamperedPayload), "utf8").toString("base64url")}.${signature}`;

    expect(verifySignedSessionToken(tamperedToken, "secret")).toBeUndefined();
  });

  it("rejects a signed session token after its server-side expiry", () => {
    const now = Date.now();
    const token = createSignedSessionToken("123:octocat", "secret");

    expect(
      verifySignedSessionToken(token, "secret", now + 60 * 60 * 8 * 1000 + 1000),
    ).toBeUndefined();
  });
});
