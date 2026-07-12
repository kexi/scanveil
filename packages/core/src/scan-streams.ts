import { z } from "zod";

export const scanStreamChunkKindSchema = z.enum(["llm_chunk", "event"]);

export const scanStreamChunkRecordSchema = z
  .object({
    deliveryId: z.string().min(1),
    kind: scanStreamChunkKindSchema,
    repoFullName: z.string().min(1),
    repositoryId: z.number().int().positive(),
    sequence: z.number().int().nonnegative(),
    text: z.string(),
    timestamp: z.string().datetime(),
  })
  .strict();

export type ScanStreamChunkKind = z.infer<typeof scanStreamChunkKindSchema>;
export type ScanStreamChunkRecord = z.infer<typeof scanStreamChunkRecordSchema>;
