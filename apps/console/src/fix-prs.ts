import { randomUUID } from "node:crypto";

import {
  toStructuredLogError,
  type FixPrRequest,
  type FixPrRunRecord,
  type FixPrStreamChunkRecord,
  type ScanFindingRecord,
  type ScanRunRecord,
  writeStructuredLog,
} from "@scanveil/core";
import { createInstallationToken } from "@scanveil/github";
import {
  type CloudRunRunOperation,
  readCloudRunJobRunName,
  readCloudRunTerminalFailure,
} from "./cloud-run.js";
import { readGitHubAppConfig } from "./github-installations.js";
import { getGoogleAccessToken } from "./scan-history.js";

type FirestoreValue =
  | { integerValue: string }
  | { stringValue: string }
  | { timestampValue: string };

interface FirestoreDocument {
  fields?: Record<string, FirestoreValue>;
}

interface FirestoreRunQueryResult {
  document?: FirestoreDocument;
}

export interface FixPrStartResult {
  executionName: string;
  fixId: string;
}

const GITHUB_FIX_PR_PERMISSION_REQUIRED_MESSAGE =
  "GitHub App requires Contents: Read and write and Pull requests: Read and write permissions for Fix PR creation. Update the GitHub App settings and approve the installation permission change.";

export async function startFixPrRun(
  input: {
    finding: ScanFindingRecord;
    llmModel?: string;
    run: ScanRunRecord;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<FixPrStartResult> {
  const request = createFixPrRequest(input);
  await assertGitHubFixPrPermissions(request, env);
  const now = new Date().toISOString();
  await writeFixPrRunRecord(
    {
      baseSha: request.headSha,
      defaultBranch: request.defaultBranch,
      deliveryId: request.deliveryId,
      endLine: request.endLine,
      evidence: request.evidence,
      file: request.file,
      findingId: request.findingId,
      fixId: request.fixId,
      installationId: request.installationId,
      ...(request.llmModel === undefined ? {} : { llmModel: request.llmModel }),
      owner: request.owner,
      queuedAt: now,
      recommendation: request.recommendation,
      repo: request.repo,
      repositoryId: request.repositoryId,
      severity: request.severity,
      startLine: request.startLine,
      status: "queued",
      sveId: request.sveId,
      title: request.title,
      updatedAt: now,
    },
    env,
  );
  let executionName: string;
  try {
    executionName = await runWorkerJob(request, env);
  } catch (error) {
    const failedAt = new Date().toISOString();
    await patchFixPrRunRecord(
      request.fixId,
      {
        errorMessage: error instanceof Error ? error.message : String(error),
        finishedAt: failedAt,
        status: "failed",
        updatedAt: failedAt,
      },
      env,
    );
    throw error;
  }
  await patchFixPrRunRecord(request.fixId, { executionName }, env);
  return { executionName, fixId: request.fixId };
}

export async function listFixPrRunsBySveId(
  sveId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FixPrRunRecord[]> {
  const hasSveId = sveId.length > 0;
  if (!hasSveId) {
    return [];
  }

  return queryFixPrRuns(
    {
      limit: 100,
      where: {
        fieldFilter: {
          field: { fieldPath: "sveId" },
          op: "EQUAL",
          value: { stringValue: sveId },
        },
      },
    },
    env,
  );
}

export async function listFixPrRuns(
  env: NodeJS.ProcessEnv = process.env,
): Promise<FixPrRunRecord[]> {
  return queryFixPrRuns({ limit: 100 }, env);
}

export async function readFixPrRunRecord(
  fixId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FixPrRunRecord | undefined> {
  const hasFixId = fixId.length > 0;
  if (!hasFixId) {
    return undefined;
  }

  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const document = encodeURIComponent(fixId);
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents/fixPrRuns/${document}`,
    {
      headers: { authorization: `Bearer ${token}` },
      method: "GET",
    },
  );
  const isMissing = response.status === 404;
  if (isMissing) {
    return undefined;
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Firestore fix PR run read failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as FirestoreDocument;
  const fields = body.fields;
  const hasFields = fields !== undefined;
  if (!hasFields) {
    return undefined;
  }

  const [record] = await reconcileActiveFixPrRunRecords([fromFirestoreFields(fields)], env);
  return record;
}

export async function listFixPrStreamChunks(
  fixId: string,
  afterSequence = -1,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FixPrStreamChunkRecord[]> {
  const hasFixId = fixId.length > 0;
  if (!hasFixId) {
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
          from: [{ collectionId: "fixPrStreamChunks" }],
          limit: 200,
          orderBy: [{ direction: "ASCENDING", field: { fieldPath: "sequence" } }],
          where: {
            compositeFilter: {
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: "fixId" },
                    op: "EQUAL",
                    value: { stringValue: fixId },
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
      `Firestore fix PR stream query failed: ${response.status} ${await response.text()}`,
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

function streamChunkFromFirestoreFields(
  fields: Record<string, FirestoreValue>,
): FixPrStreamChunkRecord {
  return {
    fixId: readString(fields.fixId),
    kind: readString(fields.kind) as FixPrStreamChunkRecord["kind"],
    repoFullName: readString(fields.repoFullName),
    repositoryId: readInteger(fields.repositoryId),
    sequence: readInteger(fields.sequence),
    text: readString(fields.text),
    timestamp: readString(fields.timestamp),
  };
}

function createFixPrRequest(input: {
  finding: ScanFindingRecord;
  llmModel?: string;
  run: ScanRunRecord;
}): FixPrRequest {
  const { finding, run } = input;
  const isRepositoryScan = run.target === "repository";
  if (!isRepositoryScan) {
    throw new Error("Fix PR creation is only supported for repository scans");
  }

  const file = finding.file;
  const startLine = finding.startLine;
  const endLine = finding.endLine;
  const hasLocation = file !== undefined && startLine !== undefined && endLine !== undefined;
  if (!hasLocation) {
    throw new Error("Fix PR creation requires a finding source location");
  }

  const defaultBranch = run.defaultBranch;
  const hasDefaultBranch = defaultBranch !== undefined && defaultBranch.length > 0;
  if (!hasDefaultBranch) {
    throw new Error("Fix PR creation requires a repository default branch");
  }

  return {
    defaultBranch,
    deliveryId: run.deliveryId,
    endLine,
    evidence: finding.evidence,
    file,
    findingId: finding.findingId,
    fixId: `fix-${randomUUID()}`,
    headSha: run.headSha,
    installationId: run.installationId,
    ...(input.llmModel === undefined ? {} : { llmModel: input.llmModel }),
    owner: run.owner,
    recommendation: finding.recommendation,
    repo: run.repo,
    repositoryId: run.repositoryId,
    severity: finding.severity,
    startLine,
    sveId: finding.sveId ?? finding.findingId,
    title: finding.title,
  };
}

async function assertGitHubFixPrPermissions(
  request: FixPrRequest,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const config = readGitHubAppConfig(env);
  const isGitHubAppConfigured = config !== undefined;
  if (!isGitHubAppConfigured) {
    return;
  }

  try {
    await createInstallationToken(config, request.installationId, {
      permissions: {
        contents: "write",
        pull_requests: "write",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isPermissionError = isGitHubFixPrPermissionErrorMessage(message);
    if (!isPermissionError) {
      throw error;
    }

    throw new Error(GITHUB_FIX_PR_PERMISSION_REQUIRED_MESSAGE);
  }
}

async function runWorkerJob(request: FixPrRequest, env: NodeJS.ProcessEnv): Promise<string> {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const region = readRequiredEnv(env, "GOOGLE_CLOUD_REGION");
  const jobName = readRequiredEnv(env, "SCAN_WORKER_JOB_NAME");
  const token = await getGoogleAccessToken(env);
  const path = `projects/${projectId}/locations/${region}/jobs/${jobName}`;
  const response = await fetch(`https://run.googleapis.com/v2/${path}:run`, {
    body: JSON.stringify({
      overrides: {
        containerOverrides: [
          {
            env: [
              {
                name: "FIX_PR_REQUEST_JSON",
                value: JSON.stringify(request),
              },
            ],
          },
        ],
      },
    }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Cloud Run job execution failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as CloudRunRunOperation;
  return readCloudRunJobRunName(body, path);
}

async function writeFixPrRunRecord(record: FixPrRunRecord, env: NodeJS.ProcessEnv): Promise<void> {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const document = encodeURIComponent(record.fixId);
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

async function patchFixPrRunRecord(
  fixId: string,
  record: Partial<FixPrRunRecord>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const document = encodeURIComponent(fixId);
  const fields = toPartialFirestoreFields(record);
  const hasFields = Object.keys(fields).length > 0;
  if (!hasFields) {
    return;
  }

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
      `Firestore fix PR run patch failed: ${response.status} ${await response.text()}`,
    );
  }
}

async function queryFixPrRuns(
  structuredQuery: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Promise<FixPrRunRecord[]> {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken(env);
  const database = encodeURIComponent("(default)");
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${database}/documents:runQuery`,
    {
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "fixPrRuns" }],
          ...structuredQuery,
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
      `Firestore fix PR run query failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as FirestoreRunQueryResult[];
  const records = body
    .flatMap((item) => {
      const fields = item.document?.fields;
      const hasFields = fields !== undefined;
      if (!hasFields) {
        return [];
      }

      return [fromFirestoreFields(fields)];
    })
    .sort((left, right) => right.queuedAt.localeCompare(left.queuedAt));
  return reconcileActiveFixPrRunRecords(records, env);
}

async function reconcileActiveFixPrRunRecords(
  records: FixPrRunRecord[],
  env: NodeJS.ProcessEnv,
): Promise<FixPrRunRecord[]> {
  const normalizedRecords = await Promise.all(
    records.map((record) => normalizeFixPrRunErrorRecord(record, env)),
  );
  const activeRecords = normalizedRecords.filter((record) => {
    const isQueued = record.status === "queued";
    const isRunning = record.status === "running";
    const hasExecutionName = record.executionName !== undefined && record.executionName.length > 0;
    return (isQueued || isRunning) && hasExecutionName;
  });
  const hasActiveRecords = activeRecords.length > 0;
  if (!hasActiveRecords) {
    return normalizedRecords;
  }

  const token = await getGoogleAccessToken(env);
  const reconciled = await Promise.all(
    normalizedRecords.map((record) => reconcileActiveFixPrRunRecord(record, token, env)),
  );
  return reconciled.sort((left, right) => right.queuedAt.localeCompare(left.queuedAt));
}

async function normalizeFixPrRunErrorRecord(
  record: FixPrRunRecord,
  env: NodeJS.ProcessEnv,
): Promise<FixPrRunRecord> {
  const errorMessage = record.errorMessage;
  const hasErrorMessage = errorMessage !== undefined && errorMessage.length > 0;
  if (!hasErrorMessage) {
    return record;
  }

  const normalizedErrorMessage = normalizeFixPrRunErrorMessage(errorMessage);
  const isAlreadyNormalized = normalizedErrorMessage === errorMessage;
  if (isAlreadyNormalized) {
    return record;
  }

  await patchFixPrRunRecord(record.fixId, { errorMessage: normalizedErrorMessage }, env);
  return { ...record, errorMessage: normalizedErrorMessage };
}

async function reconcileActiveFixPrRunRecord(
  record: FixPrRunRecord,
  token: string,
  env: NodeJS.ProcessEnv,
): Promise<FixPrRunRecord> {
  const isQueued = record.status === "queued";
  const isRunning = record.status === "running";
  const isActive = isQueued || isRunning;
  if (!isActive) {
    return record;
  }

  const hasTerminalError =
    record.errorMessage !== undefined &&
    record.errorMessage.length > 0 &&
    record.finishedAt !== undefined &&
    record.finishedAt.length > 0;
  if (hasTerminalError) {
    const finishedAt = record.finishedAt ?? new Date().toISOString();
    const update = {
      status: "failed" as const,
      updatedAt: finishedAt,
    };
    await patchFixPrRunRecord(record.fixId, update, env);
    return { ...record, ...update };
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
    await patchFixPrRunRecord(record.fixId, update, env);
    return { ...record, ...update };
  } catch (error) {
    writeStructuredLog({
      error: toStructuredLogError(error),
      fixId: record.fixId,
      message: "fix_pr_run_reconciliation_failed",
      severity: "WARNING",
    });
    return record;
  }
}

function toUpdateMask(fields: Record<string, FirestoreValue>): string {
  const params = new URLSearchParams();
  for (const fieldPath of Object.keys(fields)) {
    params.append("updateMask.fieldPaths", fieldPath);
  }

  return `?${params.toString()}`;
}

function toFirestoreFields(record: FixPrRunRecord): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {
    baseSha: { stringValue: record.baseSha },
    defaultBranch: { stringValue: record.defaultBranch },
    deliveryId: { stringValue: record.deliveryId },
    endLine: { integerValue: String(record.endLine) },
    evidence: { stringValue: record.evidence },
    file: { stringValue: record.file },
    findingId: { stringValue: record.findingId },
    fixId: { stringValue: record.fixId },
    installationId: { integerValue: String(record.installationId) },
    owner: { stringValue: record.owner },
    queuedAt: { timestampValue: record.queuedAt },
    recommendation: { stringValue: record.recommendation },
    repo: { stringValue: record.repo },
    repositoryId: { integerValue: String(record.repositoryId) },
    severity: { stringValue: record.severity },
    startLine: { integerValue: String(record.startLine) },
    status: { stringValue: record.status },
    sveId: { stringValue: record.sveId },
    title: { stringValue: record.title },
    updatedAt: { timestampValue: record.updatedAt },
  };

  setOptionalString(fields, "branchName", record.branchName);
  setOptionalString(fields, "errorMessage", record.errorMessage);
  setOptionalString(fields, "executionName", record.executionName);
  setOptionalString(fields, "finishedAt", record.finishedAt, true);
  setOptionalString(fields, "llmModel", record.llmModel);
  setOptionalString(fields, "pullRequestUrl", record.pullRequestUrl);
  setOptionalInteger(fields, "pullRequestNumber", record.pullRequestNumber);

  return fields;
}

function toPartialFirestoreFields(record: Partial<FixPrRunRecord>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};

  setOptionalString(fields, "branchName", record.branchName);
  setOptionalString(fields, "errorMessage", record.errorMessage);
  setOptionalString(fields, "executionName", record.executionName);
  setOptionalString(fields, "finishedAt", record.finishedAt, true);
  setOptionalString(fields, "pullRequestUrl", record.pullRequestUrl);
  setOptionalString(fields, "status", record.status);
  setOptionalString(fields, "updatedAt", record.updatedAt, true);
  setOptionalInteger(fields, "pullRequestNumber", record.pullRequestNumber);

  return fields;
}

function fromFirestoreFields(fields: Record<string, FirestoreValue>): FixPrRunRecord {
  return {
    baseSha: readString(fields.baseSha),
    branchName: readOptionalString(fields.branchName),
    defaultBranch: readString(fields.defaultBranch),
    deliveryId: readString(fields.deliveryId),
    endLine: readInteger(fields.endLine),
    errorMessage: readOptionalString(fields.errorMessage),
    evidence: readString(fields.evidence),
    executionName: readOptionalString(fields.executionName),
    file: readString(fields.file),
    findingId: readString(fields.findingId),
    fixId: readString(fields.fixId),
    finishedAt: readOptionalString(fields.finishedAt),
    installationId: readInteger(fields.installationId),
    llmModel: readOptionalString(fields.llmModel),
    llmOutputObjectPath: readOptionalString(fields.llmOutputObjectPath),
    owner: readString(fields.owner),
    proposalBody: readOptionalString(fields.proposalBody),
    proposalTitle: readOptionalString(fields.proposalTitle),
    pullRequestNumber: readOptionalInteger(fields.pullRequestNumber),
    pullRequestUrl: readOptionalString(fields.pullRequestUrl),
    queuedAt: readString(fields.queuedAt),
    recommendation: readString(fields.recommendation),
    repo: readString(fields.repo),
    repositoryId: readInteger(fields.repositoryId),
    severity: readString(fields.severity) as FixPrRunRecord["severity"],
    startLine: readInteger(fields.startLine),
    status: readString(fields.status) as FixPrRunRecord["status"],
    streamChunkCount: readOptionalInteger(fields.streamChunkCount),
    sveId: readString(fields.sveId),
    title: readString(fields.title),
    updatedAt: readString(fields.updatedAt),
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

function normalizeFixPrRunErrorMessage(message: string): string {
  const isPermissionError = isGitHubFixPrPermissionErrorMessage(message);
  if (!isPermissionError) {
    return message;
  }

  return GITHUB_FIX_PR_PERMISSION_REQUIRED_MESSAGE;
}

function isGitHubFixPrPermissionErrorMessage(message: string): boolean {
  const hasForbiddenStatus = message.includes("GitHub request failed: 403");
  const hasIntegrationPermissionMessage = message.includes(
    "Resource not accessible by integration",
  );
  const hasInstallationTokenPermissionMessage =
    message.includes("Failed to create installation token: 403") ||
    message.includes("Failed to create installation token: 422");
  return (
    (hasForbiddenStatus && hasIntegrationPermissionMessage) || hasInstallationTokenPermissionMessage
  );
}

function readRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
