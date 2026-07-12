import { z } from "zod";

import { severitySchema } from "./schemas.js";

export const fixPrRunStatusSchema = z.enum(["failed", "queued", "running", "succeeded"]);

export const fixPrRunRecordSchema = z
  .object({
    baseSha: z.string().min(1),
    branchName: z.string().optional(),
    defaultBranch: z.string().min(1),
    deliveryId: z.string().min(1),
    endLine: z.number().int().positive(),
    errorMessage: z.string().optional(),
    evidence: z.string().min(1),
    executionName: z.string().optional(),
    file: z.string().min(1),
    findingId: z.string().min(1),
    fixId: z.string().min(1),
    finishedAt: z.string().datetime().optional(),
    installationId: z.number().int().positive(),
    llmModel: z.string().optional(),
    llmOutputObjectPath: z.string().optional(),
    owner: z.string().min(1),
    proposalBody: z.string().optional(),
    proposalTitle: z.string().optional(),
    pullRequestNumber: z.number().int().positive().optional(),
    pullRequestUrl: z.string().url().optional(),
    queuedAt: z.string().datetime(),
    recommendation: z.string().min(1),
    repo: z.string().min(1),
    repositoryId: z.number().int().positive(),
    severity: severitySchema,
    startLine: z.number().int().positive(),
    status: fixPrRunStatusSchema,
    streamChunkCount: z.number().int().nonnegative().optional(),
    sveId: z.string().min(1),
    title: z.string().min(1),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type FixPrRunRecord = z.infer<typeof fixPrRunRecordSchema>;
export type FixPrRunStatus = z.infer<typeof fixPrRunStatusSchema>;
