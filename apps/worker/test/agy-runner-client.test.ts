import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultSecurityAppConfig, type DiffFile } from "@scanveil/core";
import type { LlmUsage } from "@scanveil/scanners";

import { reviewDiffWithAgyRunner } from "../src/agy-runner-client.js";

describe("reviewDiffWithAgyRunner", () => {
  const originalCommand = process.env.SECURITY_APP_AGY_RUNNER_COMMAND;
  const originalArgs = process.env.SECURITY_APP_AGY_RUNNER_ARGS_JSON;

  afterEach(() => {
    restoreOptionalEnv("SECURITY_APP_AGY_RUNNER_COMMAND", originalCommand);
    restoreOptionalEnv("SECURITY_APP_AGY_RUNNER_ARGS_JSON", originalArgs);
  });

  it("reports usage emitted by the Antigravity runner", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scanveil-agy-runner-test-"));
    const scriptPath = join(directory, "runner.cjs");
    await writeFile(
      scriptPath,
      [
        "console.error(JSON.stringify({",
        '  costStatus: "unavailable",',
        '  location: "global",',
        '  message: "agy_usage",',
        '  model: "gemini-test",',
        '  provider: "vertex_ai",',
        '  severity: "INFO"',
        "}));",
        "console.log(JSON.stringify([]));",
      ].join("\n"),
      "utf8",
    );
    process.env.SECURITY_APP_AGY_RUNNER_COMMAND = process.execPath;
    process.env.SECURITY_APP_AGY_RUNNER_ARGS_JSON = JSON.stringify([scriptPath]);
    const usages: LlmUsage[] = [];

    try {
      const findings = await reviewDiffWithAgyRunner([diffFile], {
        config: defaultSecurityAppConfig,
        model: "gemini-test",
        onUsage: (usage) => {
          usages.push(usage);
        },
        repoFullName: "kexi/example",
      });

      expect(findings).toEqual([]);
      expect(usages).toEqual([
        {
          costCurrency: "USD",
          costStatus: "unavailable",
          location: "global",
          model: "gemini-test",
          provider: "vertex_ai",
        },
      ]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("forwards scan policies to the runner payload", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scanveil-agy-runner-test-"));
    const scriptPath = join(directory, "runner.cjs");
    await writeFile(
      scriptPath,
      [
        "const payload = JSON.parse(process.env.SCANVEIL_AGY_PAYLOAD_JSON);",
        "const policies = payload.scanPolicies;",
        "const hasExpectedPolicy =",
        "  Array.isArray(policies) &&",
        "  policies.length === 1 &&",
        '  policies[0].name === "pnpm minimumReleaseAge" &&',
        '  policies[0].rule === "minimumReleaseAge must be 1440 or higher.";',
        "if (!hasExpectedPolicy) {",
        '  console.error("scanPolicies missing from payload");',
        "  process.exit(1);",
        "}",
        "console.log(JSON.stringify([]));",
      ].join("\n"),
      "utf8",
    );
    process.env.SECURITY_APP_AGY_RUNNER_COMMAND = process.execPath;
    process.env.SECURITY_APP_AGY_RUNNER_ARGS_JSON = JSON.stringify([scriptPath]);

    try {
      const findings = await reviewDiffWithAgyRunner([diffFile], {
        config: defaultSecurityAppConfig,
        repoFullName: "kexi/example",
        scanPolicies: [
          { name: "pnpm minimumReleaseAge", rule: "minimumReleaseAge must be 1440 or higher." },
        ],
      });

      expect(findings).toEqual([]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects with a stream write error when onStreamChunk fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scanveil-agy-runner-test-"));
    const scriptPath = join(directory, "runner.cjs");
    await writeFile(
      scriptPath,
      [
        "console.error(JSON.stringify({",
        '  message: "agy_stream_chunk",',
        '  severity: "INFO",',
        '  text: "partial output"',
        "}));",
        "console.log(JSON.stringify([]));",
      ].join("\n"),
      "utf8",
    );
    process.env.SECURITY_APP_AGY_RUNNER_COMMAND = process.execPath;
    process.env.SECURITY_APP_AGY_RUNNER_ARGS_JSON = JSON.stringify([scriptPath]);

    try {
      await expect(
        reviewDiffWithAgyRunner([diffFile], {
          config: defaultSecurityAppConfig,
          model: "gemini-test",
          onStreamChunk: async () => {
            throw new Error("stream sink unavailable");
          },
          repoFullName: "kexi/example",
        }),
      ).rejects.toThrow("agy-runner stream write failed: Error: stream sink unavailable");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

const diffFile: DiffFile = {
  addedLines: [1],
  path: "src/app.ts",
  raw: "+export const value = 1;",
};

function restoreOptionalEnv(name: string, value: string | undefined): void {
  const hasValue = value !== undefined;
  if (hasValue) {
    process.env[name] = value;
    return;
  }

  delete process.env[name];
}
