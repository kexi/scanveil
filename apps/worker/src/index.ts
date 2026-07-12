import { toStructuredLogError, writeStructuredLog } from "@scanveil/core";
import { runWorkerEntrypoint } from "./worker-entry.js";

await runWorkerEntrypoint().catch((error: unknown) => {
  writeStructuredLog({
    error: toStructuredLogError(error),
    message: "worker_failed",
    severity: "ERROR",
  });
  process.exitCode = 1;
});
