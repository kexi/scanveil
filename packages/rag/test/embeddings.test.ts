import { afterEach, describe, expect, it, vi } from "vitest";

import { embedText } from "../src/embeddings.js";

const genAiMock = vi.hoisted(() => {
  const configs: unknown[] = [];
  const embedContent = vi.fn(async () => ({ embeddings: [{ values: [0.1, 0.2] }] }));
  const GoogleGenAI = vi.fn(function GoogleGenAI(config?: unknown) {
    configs.push(config);
    return {
      models: {
        embedContent,
      },
    };
  });

  return { configs, embedContent, GoogleGenAI };
});

vi.mock("@google/genai", () => ({ GoogleGenAI: genAiMock.GoogleGenAI }));

describe("embedText", () => {
  afterEach(() => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.SECURITY_APP_EMBEDDING_MODEL;
    genAiMock.configs.length = 0;
    genAiMock.embedContent.mockClear();
    genAiMock.GoogleGenAI.mockClear();
  });

  it("requires a Vertex AI project", async () => {
    await expect(embedText("unsafe sql query")).rejects.toThrow(
      "Missing GOOGLE_CLOUD_PROJECT for Vertex AI embedding",
    );

    expect(genAiMock.GoogleGenAI).not.toHaveBeenCalled();
  });

  it("generates embeddings through Vertex AI", async () => {
    const values = await embedText("unsafe sql query", {
      location: "us-central1",
      model: "gemini-embedding-2",
      project: "scanveil-project",
    });

    expect(values).toEqual([0.1, 0.2]);
    expect(genAiMock.configs).toEqual([
      { location: "us-central1", project: "scanveil-project", vertexai: true },
    ]);
    expect(genAiMock.embedContent).toHaveBeenCalledWith({
      model: "gemini-embedding-2",
      contents: ["unsafe sql query"],
      config: {
        outputDimensionality: 768,
        taskType: "RETRIEVAL_DOCUMENT",
      },
    });
  });
});
