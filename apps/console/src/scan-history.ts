import {
  toStructuredLogError,
  writeStructuredLog,
  type ScanFindingRecord,
  type ScanRunRecord,
  type ScanStreamChunkRecord,
} from "@scanveil/core";
import { readCloudRunTerminalFailure } from "./cloud-run.js";

type FirestoreValue =
  | { arrayValue: { values?: FirestoreValue[] } }
  | { booleanValue: boolean }
  | { doubleValue: number | string }
  | { integerValue: string }
  | { stringValue: string }
  | { timestampValue: string };

interface FirestoreDocument {
  fields?: Record<string, FirestoreValue>;
}

interface FirestoreRunQueryResult {
  document?: FirestoreDocument;
}

export async function writeScanRunRecord(
  record: ScanRunRecord,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const document = encodeURIComponent(record.deliveryId);
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

export async function patchScanRunRecord(
  deliveryId: string,
  record: Partial<ScanRunRecord>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const document = encodeURIComponent(deliveryId);
  const fields = toPartialFirestoreFields(record);
  const hasFields = Object.keys(fields).length > 0;
  if (!hasFields) {
    return;
  }

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
    throw new Error(`Firestore scan run patch failed: ${response.status} ${await response.text()}`);
  }
}

function toUpdateMask(fields: Record<string, FirestoreValue>): string {
  const params = new URLSearchParams();
  for (const fieldPath of Object.keys(fields)) {
    params.append("updateMask.fieldPaths", fieldPath);
  }

  return `?${params.toString()}`;
}

export async function readScanRunRecord(
  deliveryId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ScanRunRecord | undefined> {
  const hasDeliveryId = deliveryId.length > 0;
  if (!hasDeliveryId) {
    return undefined;
  }

  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const document = encodeURIComponent(deliveryId);
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents/scanRuns/${document}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
      method: "GET",
    },
  );
  const isNotFound = response.status === 404;
  if (isNotFound) {
    return undefined;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Firestore scan run read failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as FirestoreDocument;
  const fields = body.fields;
  const hasFields = fields !== undefined;
  if (!hasFields) {
    return undefined;
  }

  return fromFirestoreFields(fields);
}

export async function listScanRunRecords(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ScanRunRecord[]> {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents:runQuery`,
    {
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "scanRuns" }],
          limit: 50,
          orderBy: [{ direction: "DESCENDING", field: { fieldPath: "queuedAt" } }],
        },
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Firestore scan run query failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as FirestoreRunQueryResult[];
  const records = body.flatMap((item) => {
    const fields = item.document?.fields;
    const hasFields = fields !== undefined;
    if (!hasFields) {
      return [];
    }

    return [fromFirestoreFields(fields)];
  });
  return reconcileActiveScanRunRecords(records, env);
}

async function reconcileActiveScanRunRecords(
  records: ScanRunRecord[],
  env: NodeJS.ProcessEnv,
): Promise<ScanRunRecord[]> {
  const activeRecords = records.filter((record) => {
    const isQueued = record.status === "queued";
    const isRunning = record.status === "running";
    const hasExecutionName = record.executionName !== undefined && record.executionName.length > 0;
    return (isQueued || isRunning) && hasExecutionName;
  });
  const hasActiveRecords = activeRecords.length > 0;
  if (!hasActiveRecords) {
    return records;
  }

  const token = await getGoogleAccessToken(env);
  const reconciled = await Promise.all(
    records.map((record) => reconcileActiveScanRunRecord(record, token, env)),
  );
  return reconciled.sort((left, right) => right.queuedAt.localeCompare(left.queuedAt));
}

async function reconcileActiveScanRunRecord(
  record: ScanRunRecord,
  token: string,
  env: NodeJS.ProcessEnv,
): Promise<ScanRunRecord> {
  const isQueued = record.status === "queued";
  const isRunning = record.status === "running";
  const isActive = isQueued || isRunning;
  if (!isActive) {
    return record;
  }

  try {
    const failure = await readCloudRunTerminalFailure(record.executionName, token);
    const hasFailure = failure !== undefined;
    if (!hasFailure) {
      return record;
    }

    const failedAt = new Date().toISOString();
    const update = {
      errorMessage: failure.message,
      finishedAt: failedAt,
      status: "failed" as const,
      updatedAt: failedAt,
    };
    await patchScanRunRecord(record.deliveryId, update, env);
    return { ...record, ...update };
  } catch (error) {
    writeStructuredLog({
      deliveryId: record.deliveryId,
      error: toStructuredLogError(error),
      message: "scan_run_reconciliation_failed",
      severity: "WARNING",
    });
    return record;
  }
}

export async function listScanFindingRecords(
  deliveryIds: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<ScanFindingRecord[]> {
  const uniqueDeliveryIds = [...new Set(deliveryIds)];
  const hasDeliveryIds = uniqueDeliveryIds.length > 0;
  if (!hasDeliveryIds) {
    return [];
  }

  const findings: ScanFindingRecord[] = [];
  for (const deliveryIdChunk of chunk(uniqueDeliveryIds, 30)) {
    findings.push(...(await listScanFindingRecordChunk(deliveryIdChunk, env)));
  }

  return findings.sort((left, right) => right.writtenAt.localeCompare(left.writtenAt));
}

export async function listScanFindingRecordsBySveId(
  sveId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ScanFindingRecord[]> {
  const hasSveId = sveId.length > 0;
  if (!hasSveId) {
    return [];
  }

  const findings = await listScanFindingRecordsByField("sveId", sveId, env);
  const hasFindings = findings.length > 0;
  if (hasFindings) {
    return findings;
  }

  return listScanFindingRecordsByField("findingId", sveId, env);
}

export async function listScanStreamChunks(
  deliveryId: string,
  afterSequence = -1,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ScanStreamChunkRecord[]> {
  const hasDeliveryId = deliveryId.length > 0;
  if (!hasDeliveryId) {
    return [];
  }

  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents:runQuery`,
    {
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "scanStreamChunks" }],
          limit: 200,
          orderBy: [{ direction: "ASCENDING", field: { fieldPath: "sequence" } }],
          where: {
            compositeFilter: {
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: "deliveryId" },
                    op: "EQUAL",
                    value: { stringValue: deliveryId },
                  },
                },
                {
                  fieldFilter: {
                    field: { fieldPath: "sequence" },
                    op: "GREATER_THAN",
                    value: { integerValue: String(afterSequence) },
                  },
                },
              ],
              op: "AND",
            },
          },
        },
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Firestore scan stream query failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as FirestoreRunQueryResult[];
  return body
    .flatMap((item) => {
      const fields = item.document?.fields;
      const hasFields = fields !== undefined;
      if (!hasFields) {
        return [];
      }

      return [streamChunkFromFirestoreFields(fields)];
    })
    .sort((left, right) => left.sequence - right.sequence);
}

export async function readLlmOutputObject(
  objectPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const parsed = parseGsObjectPath(objectPath);
  const token = await getGoogleAccessToken(env);
  const response = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(parsed.bucket)}/o/${encodeURIComponent(parsed.name)}?alt=media`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
      method: "GET",
    },
  );
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`GCS LLM output read failed: ${response.status} ${await response.text()}`);
  }

  return response.text();
}

async function listScanFindingRecordsByField(
  fieldPath: "findingId" | "sveId",
  value: string,
  env: NodeJS.ProcessEnv,
): Promise<ScanFindingRecord[]> {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents:runQuery`,
    {
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "scanFindings" }],
          limit: 500,
          where: {
            fieldFilter: {
              field: { fieldPath },
              op: "EQUAL",
              value: { stringValue: value },
            },
          },
        },
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Firestore SVE finding query failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as FirestoreRunQueryResult[];
  return body
    .flatMap((item) => {
      const fields = item.document?.fields;
      const hasFields = fields !== undefined;
      if (!hasFields) {
        return [];
      }

      return [findingFromFirestoreFields(fields)];
    })
    .sort((left, right) => right.writtenAt.localeCompare(left.writtenAt));
}

async function listScanFindingRecordChunk(
  deliveryIds: string[],
  env: NodeJS.ProcessEnv,
): Promise<ScanFindingRecord[]> {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents:runQuery`,
    {
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "scanFindings" }],
          limit: 500,
          where: {
            fieldFilter: {
              field: { fieldPath: "deliveryId" },
              op: "IN",
              value: {
                arrayValue: {
                  values: deliveryIds.map((deliveryId) => ({ stringValue: deliveryId })),
                },
              },
            },
          },
        },
      }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Firestore scan finding query failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as FirestoreRunQueryResult[];
  return body.flatMap((item) => {
    const fields = item.document?.fields;
    const hasFields = fields !== undefined;
    if (!hasFields) {
      return [];
    }

    return [findingFromFirestoreFields(fields)];
  });
}

export async function getGoogleAccessToken(env: NodeJS.ProcessEnv): Promise<string> {
  const environmentToken = env.GOOGLE_OAUTH_ACCESS_TOKEN;
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

function toFirestoreFields(record: ScanRunRecord): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {
    deliveryId: { stringValue: record.deliveryId },
    headSha: { stringValue: record.headSha },
    installationId: { integerValue: String(record.installationId) },
    owner: { stringValue: record.owner },
    queuedAt: { timestampValue: record.queuedAt },
    reason: { stringValue: record.reason },
    repo: { stringValue: record.repo },
    status: { stringValue: record.status },
    target: { stringValue: record.target },
    updatedAt: { timestampValue: record.updatedAt },
  };

  setOptionalString(fields, "defaultBranch", record.defaultBranch);
  setOptionalString(fields, "errorMessage", record.errorMessage);
  setOptionalString(fields, "executionName", record.executionName);
  setOptionalString(fields, "finishedAt", record.finishedAt, true);
  setOptionalString(fields, "llmCostCurrency", record.llmCostCurrency);
  setOptionalString(fields, "llmCostStatus", record.llmCostStatus);
  setOptionalBoolean(fields, "llmEnabled", record.llmEnabled);
  setOptionalString(fields, "llmLocation", record.llmLocation);
  setOptionalString(fields, "llmModel", record.llmModel);
  setOptionalString(fields, "llmOutputObjectPath", record.llmOutputObjectPath);
  setOptionalString(fields, "llmProvider", record.llmProvider);
  setOptionalBoolean(fields, "osvEnabled", record.osvEnabled);
  setOptionalInteger(fields, "repositoryId", record.repositoryId);
  setOptionalString(fields, "runnerRegion", record.runnerRegion);
  setOptionalString(fields, "startedAt", record.startedAt, true);

  const hasFindingCount = record.findingCount !== undefined;
  if (hasFindingCount) {
    fields.findingCount = { integerValue: String(record.findingCount) };
  }

  const hasPullNumber = record.pullNumber !== undefined;
  if (hasPullNumber) {
    fields.pullNumber = { integerValue: String(record.pullNumber) };
  }

  setOptionalInteger(fields, "llmInputTokens", record.llmInputTokens);
  setOptionalDouble(fields, "llmInputUsdPerMillionTokens", record.llmInputUsdPerMillionTokens);
  setOptionalInteger(fields, "llmOutputTokens", record.llmOutputTokens);
  setOptionalDouble(fields, "llmOutputUsdPerMillionTokens", record.llmOutputUsdPerMillionTokens);
  setOptionalInteger(fields, "llmTotalTokens", record.llmTotalTokens);
  setOptionalInteger(fields, "streamChunkCount", record.streamChunkCount);
  setOptionalDouble(fields, "llmEstimatedCostUsd", record.llmEstimatedCostUsd);

  return fields;
}

function toPartialFirestoreFields(record: Partial<ScanRunRecord>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};

  setOptionalString(fields, "defaultBranch", record.defaultBranch);
  setOptionalString(fields, "deliveryId", record.deliveryId);
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

  const hasInstallationId = record.installationId !== undefined;
  if (hasInstallationId) {
    fields.installationId = { integerValue: String(record.installationId) };
  }

  const hasPullNumber = record.pullNumber !== undefined;
  if (hasPullNumber) {
    fields.pullNumber = { integerValue: String(record.pullNumber) };
  }

  setOptionalInteger(fields, "llmInputTokens", record.llmInputTokens);
  setOptionalDouble(fields, "llmInputUsdPerMillionTokens", record.llmInputUsdPerMillionTokens);
  setOptionalInteger(fields, "llmOutputTokens", record.llmOutputTokens);
  setOptionalDouble(fields, "llmOutputUsdPerMillionTokens", record.llmOutputUsdPerMillionTokens);
  setOptionalInteger(fields, "llmTotalTokens", record.llmTotalTokens);
  setOptionalInteger(fields, "streamChunkCount", record.streamChunkCount);
  setOptionalDouble(fields, "llmEstimatedCostUsd", record.llmEstimatedCostUsd);

  return fields;
}

function fromFirestoreFields(fields: Record<string, FirestoreValue>): ScanRunRecord {
  return {
    defaultBranch: readOptionalString(fields.defaultBranch),
    deliveryId: readString(fields.deliveryId),
    errorMessage: readOptionalString(fields.errorMessage),
    executionName: readOptionalString(fields.executionName),
    findingCount: readOptionalInteger(fields.findingCount),
    finishedAt: readOptionalString(fields.finishedAt),
    headSha: readString(fields.headSha),
    installationId: readInteger(fields.installationId),
    llmCostCurrency: readOptionalString(fields.llmCostCurrency),
    llmCostStatus: readOptionalString(fields.llmCostStatus) as ScanRunRecord["llmCostStatus"],
    llmEstimatedCostUsd: readOptionalNumber(fields.llmEstimatedCostUsd),
    llmEnabled: readOptionalBoolean(fields.llmEnabled) ?? true,
    llmInputTokens: readOptionalInteger(fields.llmInputTokens),
    llmInputUsdPerMillionTokens: readOptionalNumber(fields.llmInputUsdPerMillionTokens),
    llmLocation: readOptionalString(fields.llmLocation),
    llmModel: readOptionalString(fields.llmModel),
    llmOutputObjectPath: readOptionalString(fields.llmOutputObjectPath),
    llmOutputTokens: readOptionalInteger(fields.llmOutputTokens),
    llmOutputUsdPerMillionTokens: readOptionalNumber(fields.llmOutputUsdPerMillionTokens),
    llmProvider: readOptionalString(fields.llmProvider),
    llmTotalTokens: readOptionalInteger(fields.llmTotalTokens),
    osvEnabled: readOptionalBoolean(fields.osvEnabled) ?? true,
    owner: readString(fields.owner),
    pullNumber: readOptionalInteger(fields.pullNumber),
    queuedAt: readString(fields.queuedAt),
    reason: readString(fields.reason) as ScanRunRecord["reason"],
    repo: readString(fields.repo),
    repositoryId: readInteger(fields.repositoryId),
    runnerRegion: readOptionalString(fields.runnerRegion),
    startedAt: readOptionalString(fields.startedAt),
    status: readString(fields.status) as ScanRunRecord["status"],
    streamChunkCount: readOptionalInteger(fields.streamChunkCount),
    target: readString(fields.target) as ScanRunRecord["target"],
    updatedAt: readString(fields.updatedAt),
  };
}

function streamChunkFromFirestoreFields(
  fields: Record<string, FirestoreValue>,
): ScanStreamChunkRecord {
  return {
    deliveryId: readString(fields.deliveryId),
    kind: readString(fields.kind) as ScanStreamChunkRecord["kind"],
    repoFullName: readString(fields.repoFullName),
    repositoryId: readInteger(fields.repositoryId),
    sequence: readInteger(fields.sequence),
    text: readString(fields.text),
    timestamp: readString(fields.timestamp),
  };
}

function parseGsObjectPath(objectPath: string): { bucket: string; name: string } {
  const prefix = "gs://";
  const hasPrefix = objectPath.startsWith(prefix);
  if (!hasPrefix) {
    throw new Error("LLM output path must use gs://");
  }

  const withoutPrefix = objectPath.slice(prefix.length);
  const slashIndex = withoutPrefix.indexOf("/");
  const isValidPath = slashIndex > 0 && slashIndex < withoutPrefix.length - 1;
  if (!isValidPath) {
    throw new Error("LLM output path is invalid");
  }

  return {
    bucket: withoutPrefix.slice(0, slashIndex),
    name: withoutPrefix.slice(slashIndex + 1),
  };
}

function findingFromFirestoreFields(fields: Record<string, FirestoreValue>): ScanFindingRecord {
  const findingId = readString(fields.findingId);
  return {
    aliases: readStringArray(fields.aliases),
    category: readString(fields.category),
    codeSpanFingerprint: readOptionalString(fields.codeSpanFingerprint),
    confidence: readNumber(fields.confidence),
    deliveryId: readString(fields.deliveryId),
    embedding: readNumberArray(fields.embedding),
    endLine: readOptionalInteger(fields.endLine),
    evidence: readString(fields.evidence),
    file: readOptionalString(fields.file),
    findingId,
    sveId: readOptionalString(fields.sveId) ?? findingId,
    normalizedText: readOptionalString(fields.normalizedText),
    sveFingerprint: readOptionalString(fields.sveFingerprint),
    recommendation: readString(fields.recommendation),
    repoFullName: readString(fields.repoFullName),
    repositoryId: readInteger(fields.repositoryId),
    severity: readString(fields.severity) as ScanFindingRecord["severity"],
    source: readString(fields.source) as ScanFindingRecord["source"],
    startLine: readOptionalInteger(fields.startLine),
    suppressedById: readOptionalString(fields.suppressedById),
    title: readString(fields.title),
    writtenAt: readString(fields.writtenAt),
  };
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

function readString(value: FirestoreValue | undefined): string {
  const stringValue = readOptionalString(value);
  return stringValue ?? "";
}

function readOptionalString(value: FirestoreValue | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if ("stringValue" in value) {
    return value.stringValue;
  }

  if ("timestampValue" in value) {
    return value.timestampValue;
  }

  return undefined;
}

function readInteger(value: FirestoreValue | undefined): number {
  return readOptionalInteger(value) ?? 0;
}

function readOptionalInteger(value: FirestoreValue | undefined): number | undefined {
  const hasInteger = value !== undefined && "integerValue" in value;
  if (!hasInteger) {
    return undefined;
  }

  return Number(value.integerValue);
}

function readOptionalBoolean(value: FirestoreValue | undefined): boolean | undefined {
  const hasBoolean = value !== undefined && "booleanValue" in value;
  if (!hasBoolean) {
    return undefined;
  }

  return value.booleanValue;
}

function readNumber(value: FirestoreValue | undefined): number {
  if (value === undefined) {
    return 0;
  }

  if ("doubleValue" in value) {
    return Number(value.doubleValue);
  }

  if ("integerValue" in value) {
    return Number(value.integerValue);
  }

  return 0;
}

function readStringArray(value: FirestoreValue | undefined): string[] {
  const hasArray = value !== undefined && "arrayValue" in value;
  if (!hasArray) {
    return [];
  }

  return (value.arrayValue.values ?? []).flatMap((item) => {
    const stringValue = readOptionalString(item);
    const hasStringValue = stringValue !== undefined;
    if (!hasStringValue) {
      return [];
    }

    return [stringValue];
  });
}

function readNumberArray(value: FirestoreValue | undefined): number[] | undefined {
  const hasArray = value !== undefined && "arrayValue" in value;
  if (!hasArray) {
    return undefined;
  }

  const values = (value.arrayValue.values ?? []).flatMap((item) => {
    const numberValue = readOptionalNumber(item);
    const hasNumberValue = numberValue !== undefined;
    if (!hasNumberValue) {
      return [];
    }

    return [numberValue];
  });
  return values.length > 0 ? values : undefined;
}

function readOptionalNumber(value: FirestoreValue | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if ("doubleValue" in value) {
    return Number(value.doubleValue);
  }

  if ("integerValue" in value) {
    return Number(value.integerValue);
  }

  return undefined;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function readRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
