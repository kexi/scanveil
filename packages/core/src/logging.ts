import { z } from "zod";

export const structuredLogSeveritySchema = z.enum([
  "DEBUG",
  "INFO",
  "NOTICE",
  "WARNING",
  "ERROR",
  "CRITICAL",
]);

export const structuredLogSchema = z
  .object({
    error: z
      .object({
        message: z.string(),
        name: z.string(),
        stack: z.string().optional(),
      })
      .optional(),
    message: z.string().min(1),
    severity: structuredLogSeveritySchema,
    time: z.string().datetime(),
  })
  .catchall(z.unknown());

export type StructuredLogEntry = Omit<z.input<typeof structuredLogSchema>, "time"> & {
  time?: string;
};

export function writeStructuredLog(entry: StructuredLogEntry): void {
  const parsed = structuredLogSchema.parse({
    time: new Date().toISOString(),
    ...entry,
  });
  const serialized = JSON.stringify(parsed);
  const shouldWriteToError = parsed.severity === "ERROR" || parsed.severity === "CRITICAL";
  if (shouldWriteToError) {
    console.error(serialized);
    return;
  }

  console.log(serialized);
}

export function toStructuredLogError(error: unknown): {
  message: string;
  name: string;
  stack?: string;
} {
  const isError = error instanceof Error;
  if (!isError) {
    return {
      message: String(error),
      name: "UnknownError",
    };
  }

  const structuredError = {
    message: error.message,
    name: error.name,
  };
  const stack = error.stack;
  const hasStack = typeof stack === "string";
  if (hasStack) {
    return {
      ...structuredError,
      stack,
    };
  }

  return structuredError;
}
