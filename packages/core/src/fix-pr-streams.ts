import { z } from "zod";

import { scanStreamChunkKindSchema } from "./scan-streams.js";

export const fixPrStreamChunkRecordSchema = z
  .object({
    fixId: z.string().min(1),
    kind: scanStreamChunkKindSchema,
    repoFullName: z.string().min(1),
    repositoryId: z.number().int().positive(),
    sequence: z.number().int().nonnegative(),
    text: z.string(),
    timestamp: z.string().datetime(),
  })
  .strict();

export type FixPrStreamChunkRecord = z.infer<typeof fixPrStreamChunkRecordSchema>;
