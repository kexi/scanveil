import { z } from "zod";

import { severitySchema } from "./schemas.js";

export const scanFindingRecordSchema = z
  .object({
    aliases: z.array(z.string()).default([]),
    category: z.string().min(1),
    confidence: z.number().min(0).max(1),
    deliveryId: z.string().min(1),
    endLine: z.number().int().positive().optional(),
    evidence: z.string(),
    file: z.string().optional(),
    findingId: z.string().min(1),
    sveId: z.string().min(1).optional(),
    recommendation: z.string(),
    repoFullName: z.string().min(1),
    repositoryId: z.number().int().positive(),
    severity: severitySchema,
    source: z.enum(["llm", "osv"]),
    startLine: z.number().int().positive().optional(),
    suppressedById: z.string().optional(),
    title: z.string().min(1),
    writtenAt: z.string().datetime(),
    normalizedText: z.string().optional(),
    codeSpanFingerprint: z.string().optional(),
    sveFingerprint: z.string().optional(),
    embedding: z.array(z.number()).optional(),
  })
  .strict();

export type ScanFindingRecord = z.infer<typeof scanFindingRecordSchema>;
