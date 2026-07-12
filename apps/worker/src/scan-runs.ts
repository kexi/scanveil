import type { ScanRunRecord, ScanRequest } from "@scanveil/core";

export interface ScanRunUsageSummary {
  llmCostCurrency?: string;
  llmCostStatus?: "estimated" | "unavailable";
  llmEstimatedCostUsd?: number;
  llmInputTokens?: number;
  llmInputUsdPerMillionTokens?: number;
  llmLocation?: string;
  llmModel?: string;
  llmOutputObjectPath?: string;
  llmOutputTokens?: number;
  llmOutputUsdPerMillionTokens?: number;
  llmProvider?: string;
  llmTotalTokens?: number;
  runnerRegion?: string;
  streamChunkCount?: number;
}

type FirestoreValue =
  | { booleanValue: boolean }
  | { doubleValue: number }
  | { integerValue: string }
  | { stringValue: string }
  | { timestampValue: string };

export async function markScanRunRunning(request: ScanRequest): Promise<void> {
  const now = new Date().toISOString();
  await patchScanRunRecord(request.deliveryId, {
    startedAt: now,
    status: "running",
    updatedAt: now,
  });
}

export async function markScanRunQueued(
  request: ScanRequest,
  executionName?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await patchScanRunRecord(request.deliveryId, {
    ...request,
    executionName,
    queuedAt: now,
    status: "queued",
    updatedAt: now,
  });
}

export async function markScanRunSucceeded(
  request: ScanRequest,
  findingCount: number,
  usage: ScanRunUsageSummary = {},
): Promise<void> {
  const now = new Date().toISOString();
  await patchScanRunRecord(request.deliveryId, {
    findingCount,
    finishedAt: now,
    ...usage,
    status: "succeeded",
    updatedAt: now,
  });
}

export async function markScanRunFailed(request: ScanRequest, error: unknown): Promise<void> {
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : String(error);
  await patchScanRunRecord(request.deliveryId, {
    errorMessage: message,
    finishedAt: now,
    status: "failed",
    updatedAt: now,
  });
}

async function patchScanRunRecord(
  deliveryId: string,
  record: Partial<ScanRunRecord>,
): Promise<void> {
  const projectId = readRequiredEnv("GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken();
  const database = encodeURIComponent("(default)");
  const document = encodeURIComponent(deliveryId);
  const fields = toFirestoreFields(record);
  const updateMask = toUpdateMask(fields);
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents/scanRuns/${document}${updateMask}`,
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
    throw new Error(`Firestore scan run write failed: ${response.status} ${await response.text()}`);
  }
}

function toUpdateMask(fields: Record<string, FirestoreValue>): string {
  const params = new URLSearchParams();
  for (const fieldPath of Object.keys(fields)) {
    params.append("updateMask.fieldPaths", fieldPath);
  }

  return `?${params.toString()}`;
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

function toFirestoreFields(record: Partial<ScanRunRecord>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};

  setOptionalString(fields, "deliveryId", record.deliveryId);
  setOptionalString(fields, "defaultBranch", record.defaultBranch);
  setOptionalString(fields, "errorMessage", record.errorMessage);
  setOptionalString(fields, "executionName", record.executionName);
  setOptionalString(fields, "finishedAt", record.finishedAt, true);
  setOptionalString(fields, "headSha", record.headSha);
  setOptionalString(fields, "llmCostCurrency", record.llmCostCurrency);
  setOptionalString(fields, "llmCostStatus", record.llmCostStatus);
  setOptionalBoolean(fields, "llmEnabled", record.llmEnabled);
  setOptionalString(fields, "llmLocation", record.llmLocation);
  setOptionalString(fields, "llmModel", record.llmModel);
  setOptionalString(fields, "llmOutputObjectPath", record.llmOutputObjectPath);
  setOptionalString(fields, "llmProvider", record.llmProvider);
  setOptionalBoolean(fields, "osvEnabled", record.osvEnabled);
  setOptionalString(fields, "owner", record.owner);
  setOptionalString(fields, "queuedAt", record.queuedAt, true);
  setOptionalString(fields, "reason", record.reason);
  setOptionalString(fields, "repo", record.repo);
  setOptionalInteger(fields, "repositoryId", record.repositoryId);
  setOptionalString(fields, "runnerRegion", record.runnerRegion);
  setOptionalString(fields, "startedAt", record.startedAt, true);
  setOptionalString(fields, "status", record.status);
  setOptionalString(fields, "target", record.target);
  setOptionalString(fields, "updatedAt", record.updatedAt, true);

  const hasFindingCount = record.findingCount !== undefined;
  if (hasFindingCount) {
    fields.findingCount = { integerValue: String(record.findingCount) };
  }

  setOptionalInteger(fields, "llmInputTokens", record.llmInputTokens);
  setOptionalDouble(fields, "llmInputUsdPerMillionTokens", record.llmInputUsdPerMillionTokens);
  setOptionalInteger(fields, "llmOutputTokens", record.llmOutputTokens);
  setOptionalDouble(fields, "llmOutputUsdPerMillionTokens", record.llmOutputUsdPerMillionTokens);
  setOptionalInteger(fields, "llmTotalTokens", record.llmTotalTokens);
  setOptionalInteger(fields, "streamChunkCount", record.streamChunkCount);
  setOptionalDouble(fields, "llmEstimatedCostUsd", record.llmEstimatedCostUsd);

  const hasPullNumber = record.pullNumber !== undefined;
  if (hasPullNumber) {
    fields.pullNumber = { integerValue: String(record.pullNumber) };
  }

  const hasInstallationId = record.installationId !== undefined;
  if (hasInstallationId) {
    fields.installationId = { integerValue: String(record.installationId) };
  }

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

function setOptionalDouble(
  fields: Record<string, FirestoreValue>,
  key: string,
  value: number | undefined,
): void {
  const hasValue = value !== undefined;
  if (!hasValue) {
    return;
  }

  fields[key] = { doubleValue: value };
}

function setOptionalBoolean(
  fields: Record<string, FirestoreValue>,
  key: string,
  value: boolean | undefined,
): void {
  const hasValue = value !== undefined;
  if (!hasValue) {
    return;
  }

  fields[key] = { booleanValue: value };
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
