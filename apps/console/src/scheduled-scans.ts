import { getGoogleAccessToken } from "./scan-history.js";

export interface ScheduledScanSettings {
  available: boolean;
  enabled: boolean;
  name?: string;
  schedule: string;
  state?: string;
  timeZone: string;
  updatedAt?: string;
}

export interface ScheduledScanUpdateInput {
  enabled: boolean;
  schedule: string;
  timeZone: string;
}

interface CloudSchedulerJob {
  name?: string;
  schedule?: string;
  state?: string;
  timeZone?: string;
  userUpdateTime?: string;
}

export async function readScheduledScanSettings(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ScheduledScanSettings> {
  const jobPath = readSchedulerJobPath(env);
  const token = await getGoogleAccessToken(env);
  const response = await fetch(`https://cloudscheduler.googleapis.com/v1/${jobPath}`, {
    headers: { authorization: `Bearer ${token}` },
    method: "GET",
  });
  const isNotFound = response.status === 404;
  if (isNotFound) {
    return {
      available: false,
      enabled: false,
      schedule: env.SCHEDULED_SCAN_CRON ?? "0 3 * * *",
      timeZone: env.SCHEDULED_SCAN_TIME_ZONE ?? "Asia/Tokyo",
    };
  }

  const isOk = response.ok;
  if (!isOk) {
    throw new Error(`Cloud Scheduler job read failed: ${response.status} ${await response.text()}`);
  }

  return toScheduledScanSettings((await response.json()) as CloudSchedulerJob);
}

export async function updateScheduledScanSettings(
  input: ScheduledScanUpdateInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ScheduledScanSettings> {
  const schedule = input.schedule.trim();
  const timeZone = input.timeZone.trim();
  const hasSchedule = schedule.length > 0;
  if (!hasSchedule) {
    throw new Error("Schedule is required");
  }

  const hasTimeZone = timeZone.length > 0;
  if (!hasTimeZone) {
    throw new Error("Time zone is required");
  }

  const jobPath = readSchedulerJobPath(env);
  const token = await getGoogleAccessToken(env);
  const patchResponse = await fetch(
    `https://cloudscheduler.googleapis.com/v1/${jobPath}?updateMask=schedule,timeZone`,
    {
      body: JSON.stringify({ name: jobPath, schedule, timeZone }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "PATCH",
    },
  );
  const isPatchOk = patchResponse.ok;
  if (!isPatchOk) {
    throw new Error(
      `Cloud Scheduler job update failed: ${patchResponse.status} ${await patchResponse.text()}`,
    );
  }

  const patchedJob = (await patchResponse.json()) as CloudSchedulerJob;
  const shouldResume = input.enabled && patchedJob.state === "PAUSED";
  if (shouldResume) {
    return mutateSchedulerState(jobPath, token, "resume");
  }

  const shouldPause = !input.enabled && patchedJob.state === "ENABLED";
  if (shouldPause) {
    return mutateSchedulerState(jobPath, token, "pause");
  }

  return toScheduledScanSettings(patchedJob);
}

async function mutateSchedulerState(
  jobPath: string,
  token: string,
  action: "pause" | "resume",
): Promise<ScheduledScanSettings> {
  const response = await fetch(`https://cloudscheduler.googleapis.com/v1/${jobPath}:${action}`, {
    body: JSON.stringify({}),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const isOk = response.ok;
  if (!isOk) {
    throw new Error(
      `Cloud Scheduler job ${action} failed: ${response.status} ${await response.text()}`,
    );
  }

  return toScheduledScanSettings((await response.json()) as CloudSchedulerJob);
}

function toScheduledScanSettings(job: CloudSchedulerJob): ScheduledScanSettings {
  const state = job.state ?? "STATE_UNSPECIFIED";
  const enabled = state !== "PAUSED";
  return {
    available: true,
    enabled,
    ...(job.name === undefined ? {} : { name: job.name }),
    schedule: job.schedule ?? "",
    state,
    timeZone: job.timeZone ?? "Asia/Tokyo",
    ...(job.userUpdateTime === undefined ? {} : { updatedAt: job.userUpdateTime }),
  };
}

function readSchedulerJobPath(env: NodeJS.ProcessEnv): string {
  const projectId = readRequiredEnv(env, "GOOGLE_CLOUD_PROJECT");
  const region = env.GOOGLE_CLOUD_REGION ?? env.FUNCTION_REGION ?? "us-central1";
  const jobId = env.SCAN_SCHEDULER_JOB_NAME ?? "scanveil-scheduled-scan";
  return `projects/${projectId}/locations/${region}/jobs/${jobId}`;
}

function readRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  const hasValue = typeof value === "string" && value.length > 0;
  if (!hasValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}
