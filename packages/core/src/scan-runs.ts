import { z } from "zod";

export const scanRunStatusSchema = z.enum([
  "cancelled",
  "failed",
  "queued",
  "running",
  "succeeded",
]);

export const scanRunRecordSchema = z
  .object({
    defaultBranch: z.string().optional(),
    deliveryId: z.string().min(1),
    errorMessage: z.string().optional(),
    executionName: z.string().optional(),
    findingCount: z.number().int().nonnegative().optional(),
    finishedAt: z.string().datetime().optional(),
    headSha: z.string().min(1),
    installationId: z.number().int().positive(),
    llmCostCurrency: z.string().optional(),
    llmCostStatus: z.enum(["estimated", "unavailable"]).optional(),
    llmEstimatedCostUsd: z.number().nonnegative().optional(),
    llmEnabled: z.boolean(),
    llmInputTokens: z.number().int().nonnegative().optional(),
    llmInputUsdPerMillionTokens: z.number().nonnegative().optional(),
    llmLocation: z.string().optional(),
    llmModel: z.string().optional(),
    llmOutputObjectPath: z.string().optional(),
    llmOutputTokens: z.number().int().nonnegative().optional(),
    llmOutputUsdPerMillionTokens: z.number().nonnegative().optional(),
    llmProvider: z.string().optional(),
    llmTotalTokens: z.number().int().nonnegative().optional(),
    osvEnabled: z.boolean(),
    owner: z.string().min(1),
    pullNumber: z.number().int().positive().optional(),
    queuedAt: z.string().datetime(),
    reason: z.enum(["manual", "pull_request", "scheduled"]),
    repo: z.string().min(1),
    repositoryId: z.number().int().positive(),
    runnerRegion: z.string().optional(),
    startedAt: z.string().datetime().optional(),
    status: scanRunStatusSchema,
    streamChunkCount: z.number().int().nonnegative().optional(),
    target: z.enum(["pull_request", "repository"]),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type ScanRunRecord = z.infer<typeof scanRunRecordSchema>;
export type ScanRunStatus = z.infer<typeof scanRunStatusSchema>;
