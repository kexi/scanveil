import type { ScanRequest, ScanStreamChunkRecord } from "@scanveil/core";

import { markScanRunSucceeded, type ScanRunUsageSummary } from "./scan-runs.js";

type FirestoreValue =
  | { integerValue: string }
  | { stringValue: string }
  | { timestampValue: string };

export interface LlmStreamWriter {
  finish(usage: ScanRunUsageSummary): Promise<ScanRunUsageSummary>;
  writeText(text: string): Promise<void>;
}

const maxBufferedCharacters = 4096;
const streamChunkTtlDays = 30;

// Why not TTL on the chunk's own timestamp: Firestore deletes documents once
// the TTL field's value is in the past, so expiry needs a dedicated future
// timestamp. Terraform enables the TTL policy on expireAt.
export function toStreamChunkExpireAt(timestamp: string): string {
  return new Date(Date.parse(timestamp) + streamChunkTtlDays * 24 * 60 * 60 * 1000).toISOString();
}

export function createLlmStreamWriter(request: ScanRequest): LlmStreamWriter {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const bucket = process.env.SECURITY_APP_SCAN_ARTIFACT_BUCKET;
  const canPersist =
    typeof projectId === "string" &&
    projectId.length > 0 &&
    typeof bucket === "string" &&
    bucket.length > 0;
  if (!canPersist) {
    return new NoopLlmStreamWriter();
  }

  return new FirestoreGcsLlmStreamWriter(request, projectId, bucket);
}

class NoopLlmStreamWriter implements LlmStreamWriter {
  async finish(usage: ScanRunUsageSummary): Promise<ScanRunUsageSummary> {
    return usage;
  }

  async writeText(_text: string): Promise<void> {}
}

class FirestoreGcsLlmStreamWriter implements LlmStreamWriter {
  readonly #bucket: string;
  #buffer = "";
  #fullText = "";
  readonly #projectId: string;
  readonly #request: ScanRequest;
  #sequence = 0;

  constructor(request: ScanRequest, projectId: string, bucket: string) {
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

  async finish(usage: ScanRunUsageSummary): Promise<ScanRunUsageSummary> {
    await this.#flush();
    const hasFullText = this.#fullText.length > 0;
    if (!hasFullText) {
      return {
        ...usage,
        streamChunkCount: this.#sequence,
      };
    }

    const objectPath = `scan-runs/${this.#request.deliveryId}/llm-output.txt`;
    await uploadTextObject(this.#bucket, objectPath, this.#fullText);
    return {
      ...usage,
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
    const record: ScanStreamChunkRecord = {
      deliveryId: this.#request.deliveryId,
      kind: "llm_chunk",
      repoFullName: `${this.#request.owner}/${this.#request.repo}`,
      repositoryId: this.#request.repositoryId,
      sequence: this.#sequence,
      text,
      timestamp: new Date().toISOString(),
    };
    this.#sequence += 1;
    await writeScanStreamChunk(this.#projectId, record);
  }
}

export async function markScanRunSucceededWithStream(
  request: ScanRequest,
  findingCount: number,
  usage: ScanRunUsageSummary,
  streamWriter: LlmStreamWriter,
): Promise<void> {
  const streamUsage = await streamWriter.finish(usage);
  await markScanRunSucceeded(request, findingCount, streamUsage);
}

async function writeScanStreamChunk(
  projectId: string,
  record: ScanStreamChunkRecord,
): Promise<void> {
  const token = await getGoogleAccessToken();
  const database = encodeURIComponent("(default)");
  const document = encodeURIComponent(`${record.deliveryId}-${record.sequence}`);
  const fields = toFirestoreFields(record);
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents/scanStreamChunks/${document}`,
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
      `Firestore scan stream write failed: ${response.status} ${await response.text()}`,
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

function toFirestoreFields(record: ScanStreamChunkRecord): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {
    deliveryId: { stringValue: record.deliveryId },
    expireAt: { timestampValue: toStreamChunkExpireAt(record.timestamp) },
    kind: { stringValue: record.kind },
    repoFullName: { stringValue: record.repoFullName ?? "" },
    sequence: { integerValue: String(record.sequence) },
    text: { stringValue: record.text },
    timestamp: { timestampValue: record.timestamp },
  };
  setOptionalInteger(fields, "repositoryId", record.repositoryId);
  return fields;
}

function setOptionalInteger(
  fields: Record<string, FirestoreValue>,
  key: string,
  value: number | undefined,
): void {
  const hasValue = value !== undefined;
  if (!hasValue) {
    return;
  }

  fields[key] = { integerValue: String(value) };
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
