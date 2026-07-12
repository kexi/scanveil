import { describe, expect, it } from "vitest";

import { parseScanRequestJson } from "../src/schemas.js";

describe("parseScanRequestJson", () => {
  it("accepts a repository scan LLM model override", () => {
    const request = parseScanRequestJson(
      JSON.stringify({
        defaultBranch: "main",
        deliveryId: "manual-1",
        headSha: "abc123",
        installationId: 123,
        llmEnabled: true,
        llmModel: "gemini-test-model",
        osvEnabled: false,
        owner: "kexi",
        reason: "manual",
        repo: "example",
        repositoryId: 10001,
        target: "repository",
      }),
    );

    expect(request).toMatchObject({
      llmEnabled: true,
      llmModel: "gemini-test-model",
      osvEnabled: false,
      target: "repository",
    });
  });
});
