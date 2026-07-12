export interface EmbeddingOptions {
  model?: string;
  project?: string;
  location?: string;
}

export async function embedText(text: string, options: EmbeddingOptions = {}): Promise<number[]> {
  const ai = await createGenAiClient(options);
  const model = options.model ?? process.env.SECURITY_APP_EMBEDDING_MODEL ?? "gemini-embedding-2";
  const response = await ai.models.embedContent({
    model,
    contents: [text],
    config: {
      outputDimensionality: 768,
      taskType: "RETRIEVAL_DOCUMENT",
    },
  });

  const embedding = response.embeddings?.[0]?.values;
  const hasEmbedding = Array.isArray(embedding);
  if (!hasEmbedding) {
    throw new Error("Embedding response did not include values");
  }

  return embedding;
}

async function createGenAiClient(options: EmbeddingOptions): Promise<GenAiClient> {
  const project = options.project ?? process.env.GOOGLE_CLOUD_PROJECT;
  const location = options.location ?? process.env.GOOGLE_CLOUD_LOCATION ?? "global";
  const hasProject = typeof project === "string" && project.length > 0;
  if (!hasProject) {
    throw new Error("Missing GOOGLE_CLOUD_PROJECT for Vertex AI embedding");
  }

  const module = (await import("@google/genai")) as {
    GoogleGenAI: new (config?: unknown) => GenAiClient;
  };
  return new module.GoogleGenAI({ location, project, vertexai: true });
}

interface GenAiClient {
  models: {
    embedContent(args: unknown): Promise<{ embeddings?: Array<{ values?: number[] }> }>;
  };
}
