import type { FixPrRunRecord } from "@scanveil/core";

type FirestoreValue =
  | { integerValue: string }
  | { stringValue: string }
  | { timestampValue: string };

export async function markFixPrRunRunning(fixId: string): Promise<void> {
  const now = new Date().toISOString();
  await patchFixPrRunRecord(fixId, {
    status: "running",
    updatedAt: now,
  });
}

export async function markFixPrRunSucceeded(
  fixId: string,
  result: {
    branchName: string;
    pullRequestNumber: number;
    pullRequestUrl: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await patchFixPrRunRecord(fixId, {
    ...result,
    finishedAt: now,
    status: "succeeded",
    updatedAt: now,
  });
}

export interface FixPrRunStreamPatch {
  llmOutputObjectPath?: string;
  proposalBody?: string;
  proposalTitle?: string;
  streamChunkCount?: number;
}

export async function recordFixPrRunStream(
  fixId: string,
  patch: FixPrRunStreamPatch,
): Promise<void> {
  await patchFixPrRunRecord(fixId, {
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

export async function markFixPrRunFailed(fixId: string, error: unknown): Promise<void> {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  await patchFixPrRunRecord(fixId, {
    errorMessage: message,
    finishedAt: now,
    status: "failed",
    updatedAt: now,
  });
}

async function patchFixPrRunRecord(fixId: string, record: Partial<FixPrRunRecord>): Promise<void> {
  const projectId = readRequiredEnv("GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken();
  const database = encodeURIComponent("(default)");
  const document = encodeURIComponent(fixId);
  const fields = toFirestoreFields(record);
  const updateMask = toUpdateMask(fields);
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents/fixPrRuns/${document}${updateMask}`,
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
      `Firestore fix PR run write failed: ${response.status} ${await response.text()}`,
    );
  }
}

function toUpdateMask(fields: Record<string, FirestoreValue>): string {
  const params = new URLSearchParams();
  for (const fieldPath of Object.keys(fields)) {
    params.append("updateMask.fieldPaths", fieldPath);
  }

  return `?${params.toString()}`;
}

function toFirestoreFields(record: Partial<FixPrRunRecord>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};

  setOptionalString(fields, "branchName", record.branchName);
  setOptionalString(fields, "errorMessage", record.errorMessage);
  setOptionalString(fields, "finishedAt", record.finishedAt, true);
  setOptionalString(fields, "llmOutputObjectPath", record.llmOutputObjectPath);
  setOptionalString(fields, "proposalBody", record.proposalBody);
  setOptionalString(fields, "proposalTitle", record.proposalTitle);
  setOptionalString(fields, "pullRequestUrl", record.pullRequestUrl);
  setOptionalString(fields, "status", record.status);
  setOptionalString(fields, "updatedAt", record.updatedAt, true);
  setOptionalInteger(fields, "pullRequestNumber", record.pullRequestNumber);
  setOptionalInteger(fields, "streamChunkCount", record.streamChunkCount);

  return fields;
}

function setOptionalString(
  fields: Record<string, FirestoreValue>,
  key: string,
  value: string | undefined,
  isTimestamp = false,
): void {
  const hasValue = value !== undefined && value.length > 0;
  if (!hasValue) {
    return;
  }

  fields[key] = isTimestamp ? { timestampValue: value } : { stringValue: value };
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

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
