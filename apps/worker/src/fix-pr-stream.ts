import type { FixPrRequest, FixPrStreamChunkRecord } from "@scanveil/core";

import { toStreamChunkExpireAt } from "./scan-stream.js";

type FirestoreValue =
  | { integerValue: string }
  | { stringValue: string }
  | { timestampValue: string };

export interface FixPrStreamSummary {
  llmOutputObjectPath?: string;
  streamChunkCount: number;
}

export interface FixPrLlmStreamWriter {
  finish(): Promise<FixPrStreamSummary>;
  writeText(text: string): Promise<void>;
}

const maxBufferedCharacters = 4096;

export function createFixPrLlmStreamWriter(request: FixPrRequest): FixPrLlmStreamWriter {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const bucket = process.env.SECURITY_APP_SCAN_ARTIFACT_BUCKET;
  const canPersist =
    typeof projectId === "string" &&
    projectId.length > 0 &&
    typeof bucket === "string" &&
    bucket.length > 0;
  if (!canPersist) {
    return new NoopFixPrLlmStreamWriter();
  }

  return new FirestoreGcsFixPrLlmStreamWriter(request, projectId, bucket);
}

class NoopFixPrLlmStreamWriter implements FixPrLlmStreamWriter {
  async finish(): Promise<FixPrStreamSummary> {
    return { streamChunkCount: 0 };
  }

  async writeText(_text: string): Promise<void> {}
}

class FirestoreGcsFixPrLlmStreamWriter implements FixPrLlmStreamWriter {
  readonly #bucket: string;
  #buffer = "";
  #fullText = "";
  readonly #projectId: string;
  readonly #request: FixPrRequest;
  #sequence = 0;

  constructor(request: FixPrRequest, projectId: string, bucket: string) {
    this.#bucket = bucket;
    this.#projectId = projectId;
    this.#request = request;
  }

  async writeText(text: string): Promise<void> {
    const hasText = text.length > 0;
    if (!hasText) {
      return;
    }

    this.#fullText += text;
    this.#buffer += text;
    const shouldFlush = this.#buffer.length >= maxBufferedCharacters;
    if (!shouldFlush) {
      return;
    }

    await this.#flush();
  }

  async finish(): Promise<FixPrStreamSummary> {
    await this.#flush();
    const hasFullText = this.#fullText.length > 0;
    if (!hasFullText) {
      return { streamChunkCount: this.#sequence };
    }

    const objectPath = `fix-pr-runs/${this.#request.fixId}/llm-output.txt`;
    await uploadTextObject(this.#bucket, objectPath, this.#fullText);
    return {
      llmOutputObjectPath: `gs://${this.#bucket}/${objectPath}`,
      streamChunkCount: this.#sequence,
    };
  }

  async #flush(): Promise<void> {
    const text = this.#buffer;
    const hasText = text.length > 0;
    if (!hasText) {
      return;
    }

    this.#buffer = "";
    const record: FixPrStreamChunkRecord = {
      fixId: this.#request.fixId,
      kind: "llm_chunk",
      repoFullName: `${this.#request.owner}/${this.#request.repo}`,
      repositoryId: this.#request.repositoryId,
      sequence: this.#sequence,
      text,
      timestamp: new Date().toISOString(),
    };
    this.#sequence += 1;
    await writeFixPrStreamChunk(this.#projectId, record);
  }
}

async function writeFixPrStreamChunk(
  projectId: string,
  record: FixPrStreamChunkRecord,
): Promise<void> {
  const token = await getGoogleAccessToken();
  const database = encodeURIComponent("(default)");
  const document = encodeURIComponent(`${record.fixId}-${record.sequence}`);
  const fields = toFirestoreFields(record);
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents/fixPrStreamChunks/${document}`,
    {
      body: JSON.stringify({ fields }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "PATCH",
    },
  );
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Firestore fix PR stream write failed: ${response.status} ${await response.text()}`,
    );
  }
}

async function uploadTextObject(bucket: string, objectPath: string, text: string): Promise<void> {
  const token = await getGoogleAccessToken();
  const response = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?${new URLSearchParams(
      {
        name: objectPath,
        uploadType: "media",
      },
    ).toString()}`,
    {
      body: text,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "text/plain; charset=utf-8",
      },
      method: "POST",
    },
  );
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`GCS LLM output upload failed: ${response.status} ${await response.text()}`);
  }
}

function toFirestoreFields(record: FixPrStreamChunkRecord): Record<string, FirestoreValue> {
  return {
    expireAt: { timestampValue: toStreamChunkExpireAt(record.timestamp) },
    fixId: { stringValue: record.fixId },
    kind: { stringValue: record.kind },
    repoFullName: { stringValue: record.repoFullName },
    repositoryId: { integerValue: String(record.repositoryId) },
    sequence: { integerValue: String(record.sequence) },
    text: { stringValue: record.text },
    timestamp: { timestampValue: record.timestamp },
  };
}

async function getGoogleAccessToken(): Promise<string> {
  const environmentToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  const hasEnvironmentToken = typeof environmentToken === "string" && environmentToken.length > 0;
  if (hasEnvironmentToken) {
    return environmentToken;
  }

  const metadataResponse = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "metadata-flavor": "Google" } },
  );
  const isMetadataResponseOk = metadataResponse.ok;
  if (!isMetadataResponseOk) {
    throw new Error(
      `metadata token request failed: ${metadataResponse.status} ${await metadataResponse.text()}`,
    );
  }

  const token = (await metadataResponse.json()) as { access_token?: string };
  const accessToken = token.access_token;
  const hasAccessToken = typeof accessToken === "string" && accessToken.length > 0;
  if (!hasAccessToken) {
    throw new Error("metadata token response did not include access_token");
  }

  return accessToken;
}
