import { z } from "zod";

import { defaultLockfileGlobs } from "./lockfiles.js";
import { severities } from "./severity.js";
import type { FixPrRequest, ScanRequest } from "./types.js";

export const severitySchema = z.enum(severities).describe("Scanveil severity.");

export const scanveilConfigSchema = z
  .object({
    version: z
      .literal(1)
      .default(1)
      .describe("Configuration format version. Version 1 is the only supported format."),
    checks: z
      .object({
        conclusionMode: z
          .enum(["advisory", "fail_on_threshold"])
          .default("advisory")
          .describe("How Scanveil maps findings to the GitHub Check conclusion."),
        failThreshold: z
          .object({
            osv: severitySchema.default("critical"),
            llm: severitySchema.default("critical"),
          })
          .strict()
          .optional()
          .describe("Severity thresholds used when conclusionMode is fail_on_threshold."),
      })
      .strict()
      .optional()
      .describe("GitHub Checks behavior."),
    scan: z
      .object({
        llm: z
          .object({
            enabled: z.boolean().default(true),
            scope: z
              .literal("pr_diff")
              .default("pr_diff")
              .describe(
                "LLM scan scope for pull request scans. Repository scans use default-branch source snapshots.",
              ),
            excludePaths: z
              .array(z.string().min(1))
              .default(["dist/**", "vendor/**"])
              .describe("Glob patterns excluded from LLM review."),
            agent: z
              .object({
                runner: z
                  .enum(["antigravity_experimental"])
                  .default("antigravity_experimental")
                  .describe("LLM agent runner implementation."),
                timeoutSeconds: z
                  .number()
                  .int()
                  .min(1)
                  .max(1800)
                  .default(900)
                  .describe("Maximum application-level LLM agent runtime in seconds."),
                skills: z
                  .object({
                    enabled: z.boolean().default(true),
                  })
                  .strict()
                  .optional()
                  .describe("Load audit-specific agent skills from .scanveil/skills."),
                plugins: z
                  .object({
                    enabled: z.boolean().default(false),
                  })
                  .strict()
                  .optional()
                  .describe(
                    "Load audit-specific experimental agent plugins from .scanveil/plugins.",
                  ),
                mcp: z
                  .object({
                    enabled: z.boolean().default(false),
                  })
                  .strict()
                  .optional()
                  .describe(
                    "Load audit-specific experimental MCP server definitions from .scanveil/mcp.",
                  ),
              })
              .strict()
              .optional()
              .describe("Experimental LLM agent runner settings."),
          })
          .strict()
          .optional()
          .describe("LLM pull request diff review settings."),
        osv: z
          .object({
            enabled: z.boolean().default(true),
            scope: z
              .literal("changed_lockfiles")
              .default("changed_lockfiles")
              .describe(
                "OSV scan scope. PR scans use changed lockfiles; repository-wide scans use default-branch lockfiles.",
              ),
            lockfileGlobs: z
              .array(z.string().min(1))
              .default(defaultLockfileGlobs)
              .describe("Glob patterns used to identify dependency lockfiles."),
          })
          .strict()
          .optional()
          .describe("OSV dependency scan settings."),
      })
      .strict()
      .optional()
      .describe("Scanner enablement and scope."),
    suppression: z
      .object({
        enabled: z.boolean().default(true),
        similarityThreshold: z
          .number()
          .min(0)
          .max(1)
          .default(0.7)
          .describe("Minimum similarity score required to suppress a duplicate finding."),
        maxNearestNeighbors: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Maximum number of nearest previous findings used for suppression."),
      })
      .strict()
      .optional()
      .describe("Duplicate finding suppression behavior."),
    schedule: z
      .object({
        enabled: z.boolean().default(true),
      })
      .strict()
      .optional()
      .describe("Scheduled scan settings."),
  })
  .strict()
  .describe("Scanveil .scanveil/config.yml repository configuration.");

export const pullRequestScanRequestSchema = z
  .object({
    configSourceOverride: z.string().max(100_000).optional(),
    deliveryId: z.string().min(1),
    headSha: z.string().min(1),
    installationId: z.number().int().positive(),
    llmEnabled: z.boolean(),
    llmModel: z.string().min(1).max(200).optional(),
    osvEnabled: z.boolean(),
    owner: z.string().min(1),
    pullNumber: z.number().int().positive(),
    reason: z.enum(["pull_request", "manual"]),
    repo: z.string().min(1),
    repositoryId: z.number().int().positive(),
    target: z.literal("pull_request"),
  })
  .strict();

export const repositoryScanRequestSchema = z
  .object({
    configSourceOverride: z.string().max(100_000).optional(),
    defaultBranch: z.string().min(1),
    deliveryId: z.string().min(1),
    headSha: z.string().min(1),
    installationId: z.number().int().positive(),
    llmEnabled: z.boolean(),
    llmModel: z.string().min(1).max(200).optional(),
    osvEnabled: z.boolean(),
    owner: z.string().min(1),
    reason: z.enum(["scheduled", "manual"]),
    repo: z.string().min(1),
    repositoryId: z.number().int().positive(),
    target: z.literal("repository"),
  })
  .strict();

export const scanRequestSchema = z.union([
  pullRequestScanRequestSchema,
  repositoryScanRequestSchema,
]);

export const fixPrRequestSchema = z
  .object({
    defaultBranch: z.string().min(1),
    deliveryId: z.string().min(1),
    endLine: z.number().int().positive(),
    evidence: z.string().min(1),
    file: z.string().min(1),
    findingId: z.string().min(1),
    fixId: z.string().min(1),
    headSha: z.string().min(1),
    installationId: z.number().int().positive(),
    llmModel: z.string().min(1).max(200).optional(),
    owner: z.string().min(1),
    recommendation: z.string().min(1),
    repo: z.string().min(1),
    repositoryId: z.number().int().positive(),
    severity: severitySchema,
    startLine: z.number().int().positive(),
    sveId: z.string().min(1),
    title: z.string().min(1),
  })
  .strict()
  .refine((request) => request.endLine >= request.startLine, {
    message: "endLine must be greater than or equal to startLine",
    path: ["endLine"],
  });

const rawScanveilConfigJsonSchema = z.toJSONSchema(scanveilConfigSchema, {
  target: "draft-2020-12",
}) as Record<string, unknown>;

export const scanveilConfigJsonSchema = {
  ...rawScanveilConfigJsonSchema,
  $id: "https://www.scanveil.kexi.dev/schema/scanveil.config.schema.json",
  title: "Scanveil repository configuration",
  description: "JSON Schema for .scanveil/config.yml repository configuration files.",
} as const;

export function parseScanRequestJson(source: string): ScanRequest {
  const parsed = JSON.parse(source) as unknown;
  const normalized = normalizeLegacyScanRequest(parsed);
  return scanRequestSchema.parse(normalized) as ScanRequest;
}

export function parseFixPrRequestJson(source: string): FixPrRequest {
  const parsed = JSON.parse(source) as unknown;
  return fixPrRequestSchema.parse(parsed) as FixPrRequest;
}

function normalizeLegacyScanRequest(value: unknown): unknown {
  const isRecord = typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isRecord) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const hasTarget = typeof record.target === "string";
  if (hasTarget) {
    return record;
  }

  const hasPullNumber = typeof record.pullNumber === "number";
  if (!hasPullNumber) {
    return record;
  }

  return {
    ...record,
    target: "pull_request",
  };
}
