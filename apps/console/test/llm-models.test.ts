import { describe, expect, it } from "vitest";

import { listAvailableLlmModels } from "../src/llm-models.js";

describe("listAvailableLlmModels", () => {
  it("returns the built-in configured model allowlist", async () => {
    const models = await listAvailableLlmModels({});

    expect(models.map((model) => model.id)).toContain("gemini-3.5-flash");
    expect(models.map((model) => model.id)).toContain("google/gemma-4-31b-it");
    expect(models.map((model) => model.id)).toContain("gemini-3.1-flash-lite-preview");
    expect(models.map((model) => model.id)).toContain("claude-opus-4-6@default");
    expect(models.map((model) => model.id)).toContain("claude-sonnet-4-6@default");
    expect(models.map((model) => model.id)).toContain("claude-haiku-4-5@20251001");
    expect(models.map((model) => model.id)).not.toContain("gemini-2.5-flash-image");
    expect(models.map((model) => model.id)).not.toContain("gemini-2.5-flash-preview-tts");
    expect(models.every((model) => model.source === "configured")).toBe(true);
  });

  it("reads configured model ids and labels from SECURITY_APP_LLM_MODELS", async () => {
    const models = await listAvailableLlmModels({
      SECURITY_APP_LLM_MODELS: "gemini-a|Gemini A,gemini-b,gemini-a|Duplicate",
    });

    expect(models).toEqual([
      {
        displayName: "Gemini A",
        estimatedCostRank: Number.MAX_SAFE_INTEGER,
        id: "gemini-a",
        source: "configured",
      },
      {
        displayName: "gemini-b",
        estimatedCostRank: Number.MAX_SAFE_INTEGER,
        id: "gemini-b",
        source: "configured",
      },
    ]);
  });
});
