import type { IncomingMessage, ServerResponse } from "node:http";

import { writeStructuredLog, type ScanRequest, type ScanRunRecord } from "@scanveil/core";
import { readGitHubEvent, verifyGitHubWebhookSignature } from "@scanveil/github";

import { hasEnabledInstallationPolicy } from "./installation-policies.js";

export async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = request.url ?? "/";
  const path = url.split("?")[0] ?? "/";
  const isHealthCheck = method === "GET" && path === "/healthz";
  if (isHealthCheck) {
    writeJson(response, 200, { ok: true });
    return;
  }

  const isWebhookPath = path === "/webhooks/github";
  const isWebhook = method === "POST" && isWebhookPath;
  if (isWebhook) {
    await handleGitHubWebhook(request, response);
    return;
  }

  writeJson(response, 404, { error: "not_found" });
}

async function handleGitHubWebhook(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const payload = await readBody(request);
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const hasSecret = typeof secret === "string" && secret.length > 0;
  if (!hasSecret) {
    writeJson(response, 500, { error: "missing_webhook_secret" });
    return;
  }

  const signature = getHeader(request, "x-hub-signature-256");
  const isValidSignature = verifyGitHubWebhookSignature(payload, signature, secret);
  if (!isValidSignature) {
    writeJson(response, 401, { error: "invalid_signature" });
    return;
  }

  const githubHeaders = readRequiredGitHubWebhookHeaders(request);
  const hasGitHubHeaders = githubHeaders !== undefined;
  if (!hasGitHubHeaders) {
    writeJson(response, 400, { error: "missing_github_headers" });
    return;
  }

  const headers = toHeaders(request);
  const { event, deliveryId } = readGitHubEvent(headers);
  const body = parseJson(payload);
  const hasJson = body !== undefined;
  if (!hasJson) {
    writeJson(response, 400, { error: "invalid_json" });
    return;
  }

  const isPayload = isGitHubWebhookPayload(body);
  if (!isPayload) {
    writeJson(response, 400, { error: "invalid_payload" });
    return;
  }

  const scanRequest = toScanRequest(event, deliveryId, body);
  const hasScanRequest = scanRequest !== undefined;
  if (!hasScanRequest) {
    writeJson(response, 202, { accepted: true, queued: false });
    return;
  }

  const canScanInstallation = await hasEnabledInstallationPolicy(scanRequest.installationId);
  if (!canScanInstallation) {
    writeStructuredLog({
      deliveryId,
      installationId: scanRequest.installationId,
      message: "installation_policy_disabled",
      owner: scanRequest.owner,
      repo: scanRequest.repo,
      severity: "INFO",
    });
    writeJson(response, 202, { accepted: true, queued: false });
    return;
  }

  await enqueueScanRequest(scanRequest);
  writeJson(response, 202, { accepted: true, queued: true });
}

function toScanRequest(
  event: string,
  deliveryId: string,
  body: GitHubWebhookPayload,
): ScanRequest | undefined {
  const isPullRequestEvent = event === "pull_request";
  if (!isPullRequestEvent) {
    return undefined;
  }

  const action = body.action ?? "";
  const shouldScan =
    action === "opened" ||
    action === "synchronize" ||
    action === "reopened" ||
    action === "ready_for_review";
  if (!shouldScan) {
    return undefined;
  }

  const hasRequiredPayload = hasPullRequestScanPayload(body);
  if (!hasRequiredPayload) {
    return undefined;
  }

  const pullRequest = body.pull_request;
  const repository = body.repository;
  const installation = body.installation;
  const headRepositoryFullName = pullRequest.head.repo?.full_name;
  const baseRepositoryFullName =
    repository.full_name ?? `${repository.owner.login}/${repository.name}`;
  const hasHeadRepositoryFullName =
    typeof headRepositoryFullName === "string" && headRepositoryFullName.length > 0;
  if (!hasHeadRepositoryFullName) {
    writeStructuredLog({
      baseRepositoryFullName,
      deliveryId,
      message: "pull_request_head_repository_unavailable",
      severity: "INFO",
    });
    return undefined;
  }

  const isForkPullRequest =
    headRepositoryFullName.trim().toLowerCase() !== baseRepositoryFullName.trim().toLowerCase();
  if (isForkPullRequest) {
    writeStructuredLog({
      baseRepositoryFullName,
      deliveryId,
      headRepositoryFullName,
      message: "fork_pull_request_skipped",
      severity: "INFO",
    });
    return undefined;
  }

  return {
    deliveryId,
    headSha: pullRequest.head.sha,
    installationId: installation.id,
    llmEnabled: true,
    osvEnabled: true,
    owner: repository.owner.login,
    pullNumber: pullRequest.number,
    reason: "pull_request",
    repo: repository.name,
    repositoryId: repository.id,
    target: "pull_request",
  };
}

async function enqueueScanRequest(scanRequest: ScanRequest): Promise<void> {
  const workerJobName = readRequiredEnv("SCAN_WORKER_JOB_NAME");
  const executionName = await runWorkerJob(scanRequest, workerJobName);
  await writeQueuedScanRun(scanRequest, executionName);
}

async function runWorkerJob(scanRequest: ScanRequest, jobName: string): Promise<string> {
  const projectId = readRequiredEnv("GOOGLE_CLOUD_PROJECT");
  const region = readRequiredEnv("GOOGLE_CLOUD_REGION");
  const token = await getGoogleAccessToken();
  const path = `projects/${projectId}/locations/${region}/jobs/${jobName}`;
  const response = await fetch(`https://run.googleapis.com/v2/${path}:run`, {
    body: JSON.stringify({
      overrides: {
        containerOverrides: [
          {
            env: [
              {
                name: "SCAN_REQUEST_JSON",
                value: JSON.stringify(scanRequest),
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

interface CloudRunRunOperation {
  metadata?: {
    target?: string;
  };
  name?: string;
  response?: {
    name?: string;
  };
}

function readCloudRunJobRunName(body: CloudRunRunOperation, jobPath: string): string {
  const metadataTarget = body.metadata?.target;
  const hasMetadataTarget = metadataTarget !== undefined && isCloudRunExecutionName(metadataTarget);
  if (hasMetadataTarget) {
    return metadataTarget;
  }

  const responseName = body.response?.name;
  const hasResponseName = responseName !== undefined && isCloudRunExecutionName(responseName);
  if (hasResponseName) {
    return responseName;
  }

  const operationName = body.name;
  const hasOperationName = operationName !== undefined && operationName.length > 0;
  if (hasOperationName) {
    return operationName;
  }

  return jobPath;
}

function isCloudRunExecutionName(name: string): boolean {
  return /^projects\/[^/]+\/locations\/[^/]+\/jobs\/[^/]+\/executions\/[^/]+$/.test(name);
}

async function writeQueuedScanRun(scanRequest: ScanRequest, executionName: string): Promise<void> {
  const now = new Date().toISOString();
  await writeScanRunRecord({
    ...scanRequest,
    executionName,
    queuedAt: now,
    status: "queued",
    updatedAt: now,
  });
}

async function writeScanRunRecord(record: ScanRunRecord): Promise<void> {
  const projectId = readRequiredEnv("GOOGLE_CLOUD_PROJECT");
  const token = await getGoogleAccessToken();
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

function toUpdateMask(fields: Record<string, FirestoreValue>): string {
  const params = new URLSearchParams();
  for (const fieldPath of Object.keys(fields)) {
    params.append("updateMask.fieldPaths", fieldPath);
  }

  return `?${params.toString()}`;
}

function toFirestoreFields(record: ScanRunRecord): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {
    deliveryId: { stringValue: record.deliveryId },
    findingCount: { integerValue: String(record.findingCount ?? 0) },
    headSha: { stringValue: record.headSha },
    owner: { stringValue: record.owner },
    queuedAt: { timestampValue: record.queuedAt },
    reason: { stringValue: record.reason },
    repo: { stringValue: record.repo },
    status: { stringValue: record.status },
    target: { stringValue: record.target },
    updatedAt: { timestampValue: record.updatedAt },
  };

  setOptionalString(fields, "executionName", record.executionName);
  setOptionalString(fields, "finishedAt", record.finishedAt);
  setOptionalString(fields, "defaultBranch", record.defaultBranch);
  setOptionalString(fields, "errorMessage", record.errorMessage);
  setRequiredBoolean(fields, "llmEnabled", record.llmEnabled);
  setRequiredBoolean(fields, "osvEnabled", record.osvEnabled);
  setOptionalInteger(fields, "installationId", record.installationId);
  setOptionalInteger(fields, "pullNumber", record.pullNumber);
  setOptionalInteger(fields, "repositoryId", record.repositoryId);

  return fields;
}

function setOptionalString(
  fields: Record<string, FirestoreValue>,
  key: string,
  value: string | undefined,
): void {
  const hasValue = value !== undefined && value.length > 0;
  if (!hasValue) {
    return;
  }

  fields[key] = { stringValue: value };
}

function setRequiredBoolean(
  fields: Record<string, FirestoreValue>,
  key: string,
  value: boolean,
): void {
  fields[key] = { booleanValue: value };
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

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
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

function toHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    const isArray = Array.isArray(value);
    if (isArray) {
      headers.set(key, value.join(","));
      continue;
    }

    const isString = typeof value === "string";
    if (isString) {
      headers.set(key, value);
    }
  }

  return headers;
}

function getHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  const isArray = Array.isArray(value);
  if (isArray) {
    return value[0];
  }

  return value;
}

function readRequiredGitHubWebhookHeaders(request: IncomingMessage):
  | {
      deliveryId: string;
      event: string;
    }
  | undefined {
  const deliveryId = getHeader(request, "x-github-delivery");
  const event = getHeader(request, "x-github-event");
  const hasDeliveryId = deliveryId !== undefined && deliveryId.length > 0;
  const hasEvent = event !== undefined && event.length > 0;
  if (!hasDeliveryId || !hasEvent) {
    return undefined;
  }

  return { deliveryId, event };
}

function parseJson(payload: string): unknown {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return undefined;
  }
}

function isGitHubWebhookPayload(value: unknown): value is GitHubWebhookPayload {
  return isRecord(value);
}

function hasPullRequestScanPayload(body: GitHubWebhookPayload): body is GitHubWebhookPayload & {
  installation: { id: number };
  pull_request: {
    head: {
      repo?: {
        full_name?: string;
      } | null;
      sha: string;
    };
    number: number;
  };
  repository: {
    full_name?: string;
    id: number;
    name: string;
    owner: {
      login: string;
    };
  };
} {
  const pullRequest = body.pull_request;
  const repository = body.repository;
  const installation = body.installation;
  const hasInstallation = installation !== undefined && typeof installation.id === "number";
  const hasRepository =
    repository !== undefined &&
    typeof repository.id === "number" &&
    typeof repository.name === "string" &&
    isRecord(repository.owner) &&
    typeof repository.owner.login === "string";
  const hasPullRequest =
    pullRequest !== undefined &&
    typeof pullRequest.number === "number" &&
    isRecord(pullRequest.head) &&
    typeof pullRequest.head.sha === "string";
  return hasInstallation && hasRepository && hasPullRequest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBody(request: IncomingMessage): Promise<string> {
  const rawBody = (request as RequestWithRawBody).rawBody;
  const hasRawBody = Buffer.isBuffer(rawBody);
  if (hasRawBody) {
    return Promise.resolve(rawBody.toString("utf8"));
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

interface RequestWithRawBody extends IncomingMessage {
  rawBody?: Buffer;
}

type FirestoreValue =
  | { booleanValue: boolean }
  | { integerValue: string }
  | { stringValue: string }
  | { timestampValue: string };

interface GitHubWebhookPayload {
  action?: string;
  installation?: {
    id: number;
  };
  pull_request?: {
    number: number;
    head: {
      repo?: {
        full_name?: string;
      } | null;
      sha: string;
    };
  };
  repository?: {
    full_name?: string;
    id: number;
    name: string;
    owner: {
      login: string;
    };
  };
}
