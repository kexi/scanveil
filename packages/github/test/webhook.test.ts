import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyGitHubWebhookSignature } from "../src/webhook.js";

describe("verifyGitHubWebhookSignature", () => {
  it("accepts a valid sha256 signature", () => {
    const payload = JSON.stringify({ ok: true });
    const secret = "test-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

    expect(verifyGitHubWebhookSignature(payload, signature, secret)).toBe(true);
  });

  it("rejects a missing signature", () => {
    expect(verifyGitHubWebhookSignature("{}", undefined, "secret")).toBe(false);
  });

  it("rejects a signature with the wrong digest", () => {
    const payload = JSON.stringify({ ok: true });
    const signature = `sha256=${createHmac("sha256", "other-secret").update(payload).digest("hex")}`;

    expect(verifyGitHubWebhookSignature(payload, signature, "secret")).toBe(false);
  });

  it("rejects an unsupported signature algorithm", () => {
    const payload = JSON.stringify({ ok: true });
    const signature = `sha1=${createHmac("sha1", "secret").update(payload).digest("hex")}`;

    expect(verifyGitHubWebhookSignature(payload, signature, "secret")).toBe(false);
  });

  it("rejects a malformed signature without throwing", () => {
    expect(verifyGitHubWebhookSignature("{}", "sha256=abc", "secret")).toBe(false);
  });
});
