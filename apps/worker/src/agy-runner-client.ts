import { spawn } from "node:child_process";

import {
  createAivulnId,
  normalizeSeverity,
  type DiffFile,
  type FixPrRequest,
  type SecurityAppConfig,
  type SecurityFinding,
  writeStructuredLog,
} from "@scanveil/core";
import type { LlmReviewerOptions } from "@scanveil/scanners";
import type { LlmUsage } from "@scanveil/scanners";

interface AgyRunnerOptions extends Pick<
  LlmReviewerOptions,
  "model" | "onStreamChunk" | "onUsage" | "repoFullName" | "scanPolicies"
> {
  config: SecurityAppConfig;
  repositoryDir?: string;
}

interface AgyRunnerCommand {
  args: string[];
  command: string;
}

export interface AgyFixProposal {
  body: string;
  files: Array<{ content: string; path: string }>;
  title: string;
}

export async function reviewDiffWithAgyRunner(
  files: DiffFile[],
  options: AgyRunnerOptions,
): Promise<SecurityFinding[]> {
  const command = readAgyRunnerCommand();
  const payload = {
    config: options.config,
    files: files.map((file) => ({
      addedLines: file.addedLines,
      path: file.path,
      raw: file.raw,
    })),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.scanPolicies === undefined || options.scanPolicies.length === 0
      ? {}
      : { scanPolicies: options.scanPolicies }),
  };
  const result = await executeAgyRunner(command, payload, options);
  return toSecurityFindings(result, options.repoFullName);
}

export async function proposeFixWithAgyRunner(
  request: FixPrRequest,
  sourceContent: string,
  options: AgyRunnerOptions,
): Promise<AgyFixProposal> {
  const command = readAgyRunnerCommand();
  const payload = {
    config: options.config,
    finding: {
      evidence: request.evidence,
      findingId: request.findingId,
      recommendation: request.recommendation,
      severity: request.severity,
      sveId: request.sveId,
      title: request.title,
    },
    mode: "fix_pr",
    source: {
      content: sourceContent,
      endLine: request.endLine,
      path: request.file,
      startLine: request.startLine,
    },
    ...(options.model === undefined ? {} : { model: options.model }),
  };
  const result = await executeAgyRunner(command, payload, options);
  return toAgyFixProposal(result, request.file);
}

function readAgyRunnerCommand(): AgyRunnerCommand {
  const command = process.env.SECURITY_APP_AGY_RUNNER_COMMAND;
  const hasCommand = typeof command === "string" && command.length > 0;
  if (!hasCommand) {
    throw new Error("SECURITY_APP_AGY_RUNNER_COMMAND is required for antigravity_experimental");
  }

  return {
    args: readAgyRunnerArgs(),
    command,
  };
}

function readAgyRunnerArgs(): string[] {
  const source = process.env.SECURITY_APP_AGY_RUNNER_ARGS_JSON;
  const hasSource = typeof source === "string" && source.length > 0;
  if (!hasSource) {
    return [];
  }

  const parsed = JSON.parse(source);
  const isStringArray = Array.isArray(parsed) && parsed.every((item) => typeof item === "string");
  if (!isStringArray) {
    throw new Error("SECURITY_APP_AGY_RUNNER_ARGS_JSON must be a JSON string array");
  }

  return parsed;
}

async function executeAgyRunner(
  command: AgyRunnerCommand,
  payload: unknown,
  options: AgyRunnerOptions,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      env: {
        ...process.env,
        SCANVEIL_AGY_PAYLOAD_JSON: JSON.stringify(payload),
        ...(options.repositoryDir === undefined
          ? {}
          : { SCANVEIL_REPOSITORY_DIR: options.repositoryDir }),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stderrLineBuffer = "";
    const streamWrites: StreamWriteTracker = { errors: [], pending: [] };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      stderrLineBuffer = readAgyRunnerLogLines(stderrLineBuffer + chunk, options, streamWrites);
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      const hasBufferedLine = stderrLineBuffer.trim().length > 0;
      if (hasBufferedLine) {
        readAgyRunnerLogLine(stderrLineBuffer, options, streamWrites);
      }

      // Why not await inside the reject branches only: stream writes are attached with
      // per-promise .catch so their rejections are already captured, but the writes must
      // still settle before we resolve/reject so late failures are not lost.
      await Promise.allSettled(streamWrites.pending);

      const didFail = code !== 0;
      if (didFail) {
        reject(new Error(`agy-runner failed with code ${code}: ${stderr}`));
        return;
      }

      const hasStreamWriteError = streamWrites.errors.length > 0;
      if (hasStreamWriteError) {
        reject(new Error(`agy-runner stream write failed: ${String(streamWrites.errors[0])}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`agy-runner returned invalid JSON: ${String(error)}`));
      }
    });
  });
}

interface StreamWriteTracker {
  errors: unknown[];
  pending: Array<Promise<void>>;
}

function readAgyRunnerLogLines(
  buffer: string,
  options: AgyRunnerOptions,
  streamWrites: StreamWriteTracker,
): string {
  const lines = buffer.split(/\r?\n/);
  const tail = lines.pop() ?? "";
  for (const line of lines) {
    readAgyRunnerLogLine(line, options, streamWrites);
  }

  return tail;
}

function readAgyRunnerLogLine(
  line: string,
  options: AgyRunnerOptions,
  streamWrites: StreamWriteTracker,
): void {
  const trimmed = line.trim();
  const hasLine = trimmed.length > 0;
  if (!hasLine) {
    return;
  }

  let record: unknown;
  try {
    record = JSON.parse(trimmed);
  } catch {
    writeStructuredLog({
      message: "agy_runner_stderr",
      severity: "INFO",
      text: trimmed,
    });
    return;
  }

  const isRecord = typeof record === "object" && record !== null && !Array.isArray(record);
  if (!isRecord) {
    return;
  }

  const logRecord = record as Record<string, unknown>;
  const isStreamChunk = logRecord.message === "agy_stream_chunk";
  const text = logRecord.text;
  if (isStreamChunk && typeof text === "string") {
    // Why not leave the promise bare: an unhandled rejection from onStreamChunk can crash
    // the worker, so capture it into errors and let close reject with a stream-write error.
    const streamWrite = Promise.resolve(options.onStreamChunk?.({ text })).catch(
      (error: unknown) => {
        streamWrites.errors.push(error);
      },
    );
    streamWrites.pending.push(streamWrite);
  }

  const isUsage = logRecord.message === "agy_usage";
  if (isUsage) {
    options.onUsage?.(toAgyUsage(logRecord));
  }

  writeStructuredLog({
    ...logRecord,
    message: readLogMessage(logRecord.message),
    severity: readLogSeverity(logRecord.severity),
  });
}

function toAgyUsage(record: Record<string, unknown>): LlmUsage {
  return {
    costCurrency: "USD",
    costStatus: readCostStatus(record.costStatus),
    location: readUsageString(record.location, "global"),
    model: readUsageString(record.model, "antigravity_default"),
    provider: "vertex_ai",
  };
}

function readCostStatus(value: unknown): LlmUsage["costStatus"] {
  const isKnownStatus = value === "estimated" || value === "unavailable";
  if (!isKnownStatus) {
    return "unavailable";
  }

  return value;
}

function readUsageString(value: unknown, fallback: string): string {
  const isString = typeof value === "string" && value.length > 0;
  if (!isString) {
    return fallback;
  }

  return value;
}

function readLogMessage(value: unknown): string {
  const isString = typeof value === "string" && value.length > 0;
  if (!isString) {
    return "agy_runner_log";
  }

  return value;
}

function readLogSeverity(value: unknown): "DEBUG" | "INFO" | "NOTICE" | "WARNING" | "ERROR" {
  const isKnownSeverity =
    value === "DEBUG" ||
    value === "INFO" ||
    value === "NOTICE" ||
    value === "WARNING" ||
    value === "ERROR";
  if (!isKnownSeverity) {
    return "INFO";
  }

  return value;
}

function toSecurityFindings(value: unknown, repoFullName: string): SecurityFinding[] {
  const items = Array.isArray(value) ? value : [];
  return items.flatMap((item, index) => toSecurityFinding(item, index, repoFullName));
}

function toAgyFixProposal(value: unknown, expectedPath: string): AgyFixProposal {
  const isRecord = typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isRecord) {
    throw new Error("agy-runner returned invalid fix proposal");
  }

  const record = value as Record<string, unknown>;
  const title = readRequiredString(record.title);
  const body = readRequiredString(record.body);
  const files = Array.isArray(record.files) ? record.files : [];
  const parsedFiles = files.flatMap((file) => toAgyFixProposalFile(file));
  const hasValidProposal = title !== undefined && body !== undefined && parsedFiles.length <= 1;
  if (!hasValidProposal) {
    throw new Error("agy-runner returned incomplete fix proposal");
  }

  const [file] = parsedFiles;
  const isUnexpectedFile = file !== undefined && file.path !== expectedPath;
  if (isUnexpectedFile) {
    throw new Error("agy-runner fix proposal changed an unexpected file");
  }

  return { body, files: parsedFiles, title };
}

function toAgyFixProposalFile(value: unknown): Array<{ content: string; path: string }> {
  const isRecord = typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isRecord) {
    return [];
  }

  const record = value as Record<string, unknown>;
  const path = readRequiredString(record.path);
  const content = typeof record.content === "string" ? record.content : undefined;
  const hasFile = path !== undefined && content !== undefined;
  if (!hasFile) {
    return [];
  }

  return [{ content, path }];
}

function toSecurityFinding(value: unknown, index: number, repoFullName: string): SecurityFinding[] {
  const isRecord = typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isRecord) {
    return [];
  }

  const record = value as Record<string, unknown>;
  const title = readRequiredString(record.title);
  const file = readRequiredString(record.file);
  const startLine = readRequiredInteger(record.startLine);
  const endLine = readRequiredInteger(record.endLine);
  const category = readRequiredString(record.category);
  const evidence = readRequiredString(record.evidence);
  const recommendation = readRequiredString(record.recommendation);
  const hasRequiredFields =
    title !== undefined &&
    file !== undefined &&
    startLine !== undefined &&
    endLine !== undefined &&
    category !== undefined &&
    evidence !== undefined &&
    recommendation !== undefined;
  if (!hasRequiredFields) {
    return [];
  }

  return [
    {
      aliases: [],
      category,
      confidence: readConfidence(record.confidence),
      endLine,
      evidence,
      file,
      id: createAivulnId(repoFullName, index + 1),
      recommendation,
      severity: normalizeSeverity(record.severity, "info"),
      source: "llm",
      startLine,
      title,
    },
  ];
}

function readRequiredString(value: unknown): string | undefined {
  const isString = typeof value === "string" && value.length > 0;
  if (!isString) {
    return undefined;
  }

  return value;
}

function readRequiredInteger(value: unknown): number | undefined {
  const isInteger = typeof value === "number" && Number.isInteger(value);
  if (!isInteger) {
    return undefined;
  }

  return value;
}

function readConfidence(value: unknown): number {
  const isNumber = typeof value === "number" && Number.isFinite(value);
  if (!isNumber) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}
