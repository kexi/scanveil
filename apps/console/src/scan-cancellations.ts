import type { ScanRunRecord } from "@scanveil/core";

import { isCloudRunExecutionName } from "./cloud-run.js";
import { getGoogleAccessToken, patchScanRunRecord, readScanRunRecord } from "./scan-history.js";

export class ScanCancelError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ScanCancelError";
    this.statusCode = statusCode;
  }
}

export async function cancelScanRun(
  deliveryId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ScanRunRecord> {
  const run = await readScanRunRecord(deliveryId, env);
  const hasRun = run !== undefined;
  if (!hasRun) {
    throw new ScanCancelError("Scan not found", 404);
  }

  const isCancelable = run.status === "queued" || run.status === "running";
  if (!isCancelable) {
    throw new ScanCancelError("Scan is not cancelable", 409);
  }

  const executionName = run.executionName;
  const hasExecutionName = executionName !== undefined && executionName.length > 0;
  if (!hasExecutionName) {
    throw new ScanCancelError("Cloud Run execution is not recorded for this scan", 409);
  }

  const isCloudRunExecution = isCloudRunExecutionName(executionName);
  if (!isCloudRunExecution) {
    throw new ScanCancelError("Cloud Run execution is not recorded for this scan", 409);
  }

  await cancelCloudRunExecution(executionName, env);

  const now = new Date().toISOString();
  const errorMessage = "Cancelled by user";
  await patchScanRunRecord(
    deliveryId,
    {
      errorMessage,
      finishedAt: now,
      status: "cancelled",
      updatedAt: now,
    },
    env,
  );

  return {
    ...run,
    errorMessage,
    finishedAt: now,
    status: "cancelled",
    updatedAt: now,
  };
}

async function cancelCloudRunExecution(
  executionName: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const token = await getGoogleAccessToken(env);
  const response = await fetch(`https://run.googleapis.com/v2/${executionName}:cancel`, {
    body: JSON.stringify({}),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const isOk = response.ok;
  if (!isOk) {
    throw new ScanCancelError(
      `Cloud Run execution cancel failed: ${response.status} ${await response.text()}`,
      response.status,
    );
  }
}
