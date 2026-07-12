import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type {
  PullRequestScanRequest,
  RepositoryScanRequest,
  ScanRequest,
  SecurityFinding,
} from "@scanveil/core";

import { runScan, type ScanRunnerGithubClient } from "../src/scan-runner.js";

describe("runScan", () => {
  it("turns a pull request AI finding into a GitHub Check annotation", async () => {
    const github = new FakeGithubClient();
    const originalRegion = process.env.GOOGLE_CLOUD_REGION;
    process.env.GOOGLE_CLOUD_REGION = "us-central1";
    const succeeded: Array<{ findingCount: number; request: ScanRequest; usage: unknown }> = [];
    const streamedChunks: string[] = [];
    const writtenFindings: Array<{ findings: SecurityFinding[]; request: ScanRequest }> = [];
    const request: PullRequestScanRequest = {
      deliveryId: "delivery-1",
      headSha: "abc123",
      installationId: 123,
      llmEnabled: true,
      osvEnabled: true,
      owner: "kexi",
      pullNumber: 7,
      reason: "pull_request",
      repo: "example",
      target: "pull_request",
    };

    try {
      await runScan(request, {
        createGithubClient: async () => github,
        createLlmStreamWriter: () => ({
          finish: async (usage) => ({
            ...usage,
            llmOutputObjectPath: "gs://scanveil-artifacts/scan-runs/delivery-1/llm-output.txt",
            streamChunkCount: streamedChunks.length,
          }),
          writeText: async (text) => {
            streamedChunks.push(text);
          },
        }),
        embed: async () => [1, 0, 0],
        markScanSucceeded: async (scanRequest, findingCount, usage) => {
          succeeded.push({ findingCount, request: scanRequest, usage });
        },
        listScanPolicies: async () => [],
        reviewDiff: async (files, options) => {
          expect(files).toHaveLength(1);
          expect(files[0]?.path).toBe("src/app.ts");
          expect(options.excludePaths).toEqual(["dist/**"]);
          expect(options.reviewScope).toBe("pull_request");
          options.onUsage?.({
            estimatedCostUsd: 0.00004,
            inputTokens: 40,
            location: "global",
            model: "gemini-test",
            outputTokens: 20,
            provider: "vertex_ai",
            totalTokens: 60,
          });
          await options.onStreamChunk?.({ text: '[{"title":"DOM XSS"}]' });
          return [llmFinding()];
        },
        runOsv: async () => [],
        writeFindings: async (scanRequest, findings) => {
          writtenFindings.push({ findings, request: scanRequest });
        },
      });
    } finally {
      restoreOptionalEnv("GOOGLE_CLOUD_REGION", originalRegion);
    }

    expect(writtenFindings).toHaveLength(1);
    expect(writtenFindings[0]?.request).toEqual(request);
    expect(writtenFindings[0]?.findings[0]).toMatchObject(llmFinding());
    expect(writtenFindings[0]?.findings[0]?.sveId).toMatch(/^SVE-\d{6}-/);
    expect(succeeded).toEqual([
      {
        findingCount: 1,
        request,
        usage: {
          llmEstimatedCostUsd: 0.00004,
          llmInputTokens: 40,
          llmLocation: "global",
          llmModel: "gemini-test",
          llmOutputObjectPath: "gs://scanveil-artifacts/scan-runs/delivery-1/llm-output.txt",
          llmOutputTokens: 20,
          llmProvider: "vertex_ai",
          llmTotalTokens: 60,
          runnerRegion: "us-central1",
          streamChunkCount: 1,
        },
      },
    ]);
    expect(streamedChunks).toEqual(['[{"title":"DOM XSS"}]']);
    expect(github.checkRuns).toHaveLength(1);
    expect(github.checkRuns[0]).toMatchObject({
      owner: "kexi",
      repo: "example",
      payload: {
        conclusion: "failure",
        head_sha: "abc123",
        output: {
          annotations: [
            {
              annotation_level: "failure",
              end_line: 12,
              path: "src/app.ts",
              start_line: 12,
              title: "HIGH: DOM XSS",
            },
          ],
        },
      },
    });
  });

  it("turns a repository snapshot AI finding into a GitHub Check annotation", async () => {
    const github = new FakeGithubClient();
    github.repositoryFiles.push("src/server.ts", "dist/app.js", "README.md");
    github.repositoryFileContents.set(
      "src/server.ts",
      ["export function run(userInput: string) {", "  return eval(userInput);", "}"].join("\n"),
    );
    const succeeded: Array<{ findingCount: number; request: ScanRequest }> = [];
    const writtenFindings: Array<{ findings: SecurityFinding[]; request: ScanRequest }> = [];
    const request: RepositoryScanRequest = {
      defaultBranch: "main",
      deliveryId: "delivery-2",
      headSha: "def456",
      installationId: 123,
      llmEnabled: true,
      llmModel: "gemini-test-model",
      osvEnabled: true,
      owner: "kexi",
      reason: "manual",
      repo: "example",
      target: "repository",
    };

    await runScan(request, {
      createGithubClient: async () => github,
      embed: async () => [1, 0, 0],
      markScanSucceeded: async (scanRequest, findingCount) => {
        succeeded.push({ findingCount, request: scanRequest });
      },
      listScanPolicies: async () => [],
      reviewDiff: async (files, options) => {
        expect(files).toHaveLength(1);
        expect(files[0]?.path).toBe("src/server.ts");
        expect(files[0]?.addedLines).toEqual([1, 2, 3]);
        expect(files[0]?.raw).toContain("+  return eval(userInput);");
        expect(options.excludePaths).toEqual(["dist/**"]);
        expect(options.model).toBe("gemini-test-model");
        expect(options.reviewScope).toBe("repository");
        return [llmFinding("src/server.ts", 2)];
      },
      runOsv: async () => [],
      writeFindings: async (scanRequest, findings) => {
        writtenFindings.push({ findings, request: scanRequest });
      },
    });

    expect(writtenFindings).toHaveLength(1);
    expect(writtenFindings[0]?.request).toEqual(request);
    expect(writtenFindings[0]?.findings[0]).toMatchObject(llmFinding("src/server.ts", 2));
    expect(writtenFindings[0]?.findings[0]?.sveId).toMatch(/^SVE-\d{6}-/);
    expect(succeeded).toEqual([{ findingCount: 1, request }]);
    expect(github.checkRuns).toHaveLength(1);
    expect(github.checkRuns[0]).toMatchObject({
      owner: "kexi",
      repo: "example",
      payload: {
        conclusion: "failure",
        head_sha: "def456",
        output: {
          annotations: [
            {
              annotation_level: "failure",
              end_line: 2,
              path: "src/server.ts",
              start_line: 2,
              title: "HIGH: DOM XSS",
            },
          ],
        },
      },
    });
  });

  it("keeps root manifests in the repository snapshot when the file limit truncates candidates", async () => {
    const previousLimit = process.env.SECURITY_APP_REPOSITORY_LLM_FILE_LIMIT;
    process.env.SECURITY_APP_REPOSITORY_LLM_FILE_LIMIT = "2";
    try {
      const github = new FakeGithubClient();
      github.repositoryFiles.push(
        ".github/workflows/ci.yml",
        ".github/workflows/release.yml",
        "pnpm-workspace.yaml",
      );
      github.repositoryFileContents.set(".github/workflows/ci.yml", "name: CI");
      github.repositoryFileContents.set(".github/workflows/release.yml", "name: Release");
      github.repositoryFileContents.set("pnpm-workspace.yaml", "minimumReleaseAge: 1440");
      const reviewedPaths: string[][] = [];
      const request: RepositoryScanRequest = {
        defaultBranch: "main",
        deliveryId: "delivery-snapshot-priority",
        headSha: "def456",
        installationId: 123,
        llmEnabled: true,
        osvEnabled: false,
        owner: "kexi",
        reason: "manual",
        repo: "example",
        target: "repository",
      };

      await runScan(request, {
        createGithubClient: async () => github,
        embed: async () => [1, 0, 0],
        listScanPolicies: async () => [],
        markScanSucceeded: async () => {},
        reviewDiff: async (files) => {
          reviewedPaths.push(files.map((file) => file.path));
          return [];
        },
        runOsv: async () => [],
        writeFindings: async () => {},
      });

      expect(reviewedPaths).toEqual([["pnpm-workspace.yaml", ".github/workflows/ci.yml"]]);
    } finally {
      restoreOptionalEnv("SECURITY_APP_REPOSITORY_LLM_FILE_LIMIT", previousLimit);
    }
  });

  it("truncates oversized repository snapshots at a line boundary with an explicit marker", async () => {
    const github = new FakeGithubClient();
    github.repositoryFiles.push("src/big.ts", "src/small.ts");
    const completeLine = "const value = 1;";
    github.repositoryFileContents.set(
      "src/big.ts",
      [completeLine, completeLine, "const truncatedMidToken = 12345;"].join("\n"),
    );
    github.repositoryFileContents.set("src/small.ts", completeLine);
    const originalMaxBytes = process.env.SECURITY_APP_REPOSITORY_LLM_FILE_MAX_BYTES;
    process.env.SECURITY_APP_REPOSITORY_LLM_FILE_MAX_BYTES = String(
      completeLine.length * 2 + 1 + 10,
    );
    const reviewedFiles: Array<{ addedLines: number[]; path: string; raw: string }> = [];
    const request: RepositoryScanRequest = {
      defaultBranch: "main",
      deliveryId: "delivery-truncate",
      headSha: "def456",
      installationId: 123,
      llmEnabled: true,
      osvEnabled: false,
      owner: "kexi",
      reason: "manual",
      repo: "example",
      target: "repository",
    };

    try {
      await runScan(request, {
        createGithubClient: async () => github,
        embed: async () => [1, 0, 0],
        markScanSucceeded: async () => {},
        listScanPolicies: async () => [],
        reviewDiff: async (files) => {
          reviewedFiles.push(
            ...files.map((file) => ({
              addedLines: file.addedLines,
              path: file.path,
              raw: file.raw,
            })),
          );
          return [];
        },
        runOsv: async () => [],
        writeFindings: async () => {},
      });
    } finally {
      if (originalMaxBytes === undefined) {
        delete process.env.SECURITY_APP_REPOSITORY_LLM_FILE_MAX_BYTES;
      } else {
        process.env.SECURITY_APP_REPOSITORY_LLM_FILE_MAX_BYTES = originalMaxBytes;
      }
    }

    const bigFile = reviewedFiles.find((file) => file.path === "src/big.ts");
    expect(bigFile?.addedLines).toEqual([1, 2]);
    expect(bigFile?.raw).toContain(`+${completeLine}`);
    expect(bigFile?.raw).not.toContain("truncatedMidToken");
    expect(bigFile?.raw).toContain(
      "\\ scanveil: file truncated for review after line 2; the original file continues",
    );

    const smallFile = reviewedFiles.find((file) => file.path === "src/small.ts");
    expect(smallFile?.raw).not.toContain("scanveil: file truncated");
  });

  it("skips OSV when the scanner binary is missing", async () => {
    const github = new FakeGithubClient();
    github.configSource = `
version: 1
checks:
  conclusionMode: advisory
scan:
  llm:
    enabled: true
  osv:
    enabled: true
suppression:
  enabled: false
`;
    github.repositoryFiles.push("src/server.ts", "pnpm-lock.yaml");
    github.repositoryFileContents.set("src/server.ts", "export const value = 1;");
    github.repositoryFileContents.set("pnpm-lock.yaml", "lockfileVersion: '9.0'");
    const succeeded: Array<{ findingCount: number; request: ScanRequest }> = [];
    const writtenFindings: Array<{ findings: SecurityFinding[]; request: ScanRequest }> = [];
    const request: RepositoryScanRequest = {
      defaultBranch: "main",
      deliveryId: "delivery-3",
      headSha: "ghi789",
      installationId: 123,
      llmEnabled: true,
      osvEnabled: true,
      owner: "kexi",
      reason: "manual",
      repo: "example",
      target: "repository",
    };

    await runScan(request, {
      createGithubClient: async () => github,
      embed: async () => [1, 0, 0],
      markScanSucceeded: async (scanRequest, findingCount) => {
        succeeded.push({ findingCount, request: scanRequest });
      },
      listScanPolicies: async () => [],
      reviewDiff: async () => [],
      runOsv: async () => {
        throw Object.assign(new Error("spawn osv-scanner ENOENT"), { code: "ENOENT" });
      },
      writeFindings: async (scanRequest, findings) => {
        writtenFindings.push({ findings, request: scanRequest });
      },
    });

    expect(writtenFindings).toEqual([{ findings: [], request }]);
    expect(succeeded).toEqual([{ findingCount: 0, request }]);
    expect(github.checkRuns).toHaveLength(1);
    expect(github.checkRuns[0]).toMatchObject({
      owner: "kexi",
      repo: "example",
      payload: {
        conclusion: "success",
        head_sha: "ghi789",
      },
    });
  });

  it("passes nested lockfiles to OSV with repository relative paths", async () => {
    const github = new FakeGithubClient();
    github.configSource = `
version: 1
scan:
  llm:
    enabled: false
  osv:
    enabled: true
suppression:
  enabled: false
`;
    github.repositoryFiles.push("apps/web/pnpm-lock.yaml");
    github.repositoryFileContents.set("apps/web/pnpm-lock.yaml", "lockfileVersion: '9.0'");
    const request: RepositoryScanRequest = {
      defaultBranch: "main",
      deliveryId: "delivery-nested-lockfile",
      headSha: "nested123",
      installationId: 123,
      llmEnabled: false,
      osvEnabled: true,
      owner: "kexi",
      reason: "manual",
      repo: "example",
      target: "repository",
    };

    await runScan(request, {
      createGithubClient: async () => github,
      embed: async () => [1, 0, 0],
      markScanSucceeded: async () => {},
      runOsv: async (lockfilePaths, options) => {
        expect(lockfilePaths).toEqual(["apps/web/pnpm-lock.yaml"]);
        const cwd = options.cwd ?? "";
        const copiedLockfile = await readFile(join(cwd, "apps/web/pnpm-lock.yaml"), "utf8");
        expect(copiedLockfile).toBe("lockfileVersion: '9.0'");
        return [];
      },
      writeFindings: async () => {},
    });
  });

  it("removes the OSV work directory after scanning lockfiles", async () => {
    const github = new FakeGithubClient();
    github.configSource = `
version: 1
scan:
  llm:
    enabled: false
  osv:
    enabled: true
suppression:
  enabled: false
`;
    github.repositoryFiles.push("apps/web/pnpm-lock.yaml");
    github.repositoryFileContents.set("apps/web/pnpm-lock.yaml", "lockfileVersion: '9.0'");
    let copiedLockfilePath = "";
    const request: RepositoryScanRequest = {
      defaultBranch: "main",
      deliveryId: "delivery-cleanup-lockfile",
      headSha: "cleanup123",
      installationId: 123,
      llmEnabled: false,
      osvEnabled: true,
      owner: "kexi",
      reason: "manual",
      repo: "example",
      target: "repository",
    };

    await runScan(request, {
      createGithubClient: async () => github,
      embed: async () => [1, 0, 0],
      markScanSucceeded: async () => {},
      runOsv: async (_lockfilePaths, options) => {
        copiedLockfilePath = join(options.cwd ?? "", "apps/web/pnpm-lock.yaml");
        expect(await readFile(copiedLockfilePath, "utf8")).toBe("lockfileVersion: '9.0'");
        return [];
      },
      writeFindings: async () => {},
    });

    await expect(readFile(copiedLockfilePath, "utf8")).rejects.toThrow();
  });

  it("skips scheduled repository scans when the repository config disables schedules", async () => {
    const github = new FakeGithubClient();
    github.configSource = `
version: 1
schedule:
  enabled: false
scan:
  llm:
    enabled: true
  osv:
    enabled: true
suppression:
  enabled: false
`;
    const succeeded: Array<{ findingCount: number; request: ScanRequest }> = [];
    const request: RepositoryScanRequest = {
      defaultBranch: "main",
      deliveryId: "delivery-schedule-disabled",
      headSha: "schedule123",
      installationId: 123,
      llmEnabled: true,
      osvEnabled: true,
      owner: "kexi",
      reason: "scheduled",
      repo: "example",
      target: "repository",
    };

    await runScan(request, {
      createGithubClient: async () => github,
      markScanSucceeded: async (scanRequest, findingCount) => {
        succeeded.push({ findingCount, request: scanRequest });
      },
      listScanPolicies: async () => [],
      reviewDiff: async () => {
        throw new Error("scheduled scan should be skipped");
      },
      runOsv: async () => {
        throw new Error("scheduled scan should be skipped");
      },
      writeFindings: async () => {
        throw new Error("scheduled scan should be skipped");
      },
    });

    expect(succeeded).toEqual([{ findingCount: 0, request }]);
    expect(github.checkRuns).toEqual([]);
  });

  it("keeps persisted scan results when GitHub Check creation is forbidden", async () => {
    const github = new FakeGithubClient();
    github.createCheckRunError = new Error(
      'GitHub request failed: 403 {"message":"Resource not accessible by integration"}',
    );
    const succeeded: Array<{ findingCount: number; request: ScanRequest }> = [];
    const writtenFindings: Array<{ findings: SecurityFinding[]; request: ScanRequest }> = [];
    const request: PullRequestScanRequest = {
      deliveryId: "delivery-4",
      headSha: "jkl012",
      installationId: 123,
      llmEnabled: true,
      osvEnabled: true,
      owner: "kexi",
      pullNumber: 8,
      reason: "pull_request",
      repo: "example",
      target: "pull_request",
    };

    await runScan(request, {
      createGithubClient: async () => github,
      embed: async () => [1, 0, 0],
      markScanSucceeded: async (scanRequest, findingCount) => {
        succeeded.push({ findingCount, request: scanRequest });
      },
      listScanPolicies: async () => [],
      reviewDiff: async () => [llmFinding()],
      runOsv: async () => [],
      writeFindings: async (scanRequest, findings) => {
        writtenFindings.push({ findings, request: scanRequest });
      },
    });

    expect(github.checkRuns).toHaveLength(0);
    expect(writtenFindings).toHaveLength(1);
    expect(writtenFindings[0]?.request).toEqual(request);
    expect(writtenFindings[0]?.findings[0]).toMatchObject(llmFinding());
    expect(writtenFindings[0]?.findings[0]?.sveId).toMatch(/^SVE-\d{6}-/);
    expect(succeeded).toEqual([{ findingCount: 1, request }]);
  });

  it("relays Antigravity runner chunks through the scan stream writer", async () => {
    const github = new FakeGithubClient();
    github.repositoryFiles.push(".scanveil/skills/secure-js/SKILL.md");
    github.repositoryFileContents.set(
      ".scanveil/skills/secure-js/SKILL.md",
      "---\nname: secure-js\n---\nPrefer DOM sinks.",
    );
    github.configSource = `
version: 1
scan:
  llm:
    enabled: true
    agent:
      runner: antigravity_experimental
  osv:
    enabled: false
suppression:
  enabled: false
`;
    const streamedChunks: string[] = [];
    const writtenFindings: Array<{ findings: SecurityFinding[]; request: ScanRequest }> = [];
    const request: PullRequestScanRequest = {
      deliveryId: "delivery-5",
      headSha: "mno345",
      installationId: 123,
      llmEnabled: true,
      osvEnabled: true,
      owner: "kexi",
      pullNumber: 9,
      reason: "pull_request",
      repo: "example",
      target: "pull_request",
      llmModel: "gemini-3.5-flash",
    };

    await runScan(request, {
      createGithubClient: async () => github,
      createLlmStreamWriter: () => ({
        finish: async (usage) => ({
          ...usage,
          streamChunkCount: streamedChunks.length,
        }),
        writeText: async (text) => {
          streamedChunks.push(text);
        },
      }),
      embed: async () => [1, 0, 0],
      markScanSucceeded: async () => {},
      listScanPolicies: async () => [],
      reviewDiff: async () => {
        throw new Error("direct reviewer should not run");
      },
      reviewDiffWithAgy: async (files, options) => {
        expect(files).toHaveLength(1);
        expect(options.config.scan.llm.agent.runner).toBe("antigravity_experimental");
        expect(options.model).toBe("gemini-3.5-flash");
        expect(options.repositoryDir).toBeDefined();
        const skillText = await readFile(
          join(options.repositoryDir ?? "", ".scanveil/skills/secure-js/SKILL.md"),
          "utf8",
        );
        expect(skillText).toContain("Prefer DOM sinks.");
        await options.onStreamChunk?.({ text: "agent token" });
        return [llmFinding()];
      },
      runOsv: async () => [],
      writeFindings: async (scanRequest, findings) => {
        writtenFindings.push({ findings, request: scanRequest });
      },
    });

    expect(streamedChunks).toEqual(["agent token"]);
    expect(writtenFindings[0]?.findings[0]).toMatchObject(llmFinding());
  });

  it("prefers .scanveil/config.yml over legacy .scanveil.yml", async () => {
    const github = new FakeGithubClient();
    github.configSources.set(
      ".scanveil.yml",
      `
version: 1
scan:
  llm:
    enabled: false
  osv:
    enabled: false
`,
    );
    github.configSources.set(
      ".scanveil/config.yml",
      `
version: 1
scan:
  llm:
    enabled: true
    excludePaths:
      - "dist/**"
      - "generated/**"
  osv:
    enabled: false
suppression:
  enabled: false
`,
    );
    const request: PullRequestScanRequest = {
      deliveryId: "delivery-5",
      headSha: "mno345",
      installationId: 123,
      llmEnabled: true,
      osvEnabled: true,
      owner: "kexi",
      pullNumber: 9,
      reason: "pull_request",
      repo: "example",
      target: "pull_request",
    };

    await runScan(request, {
      createGithubClient: async () => github,
      embed: async () => [1, 0, 0],
      markScanSucceeded: async () => {},
      listScanPolicies: async () => [],
      reviewDiff: async (_files, options) => {
        expect(options.excludePaths).toEqual(["dist/**", "generated/**"]);
        return [];
      },
      runOsv: async () => [],
      writeFindings: async () => {},
    });

    expect(github.checkRuns[0]?.payload).toMatchObject({
      output: {
        summary: expect.stringContaining(".scanveil/config.yml takes precedence"),
      },
    });
  });

  it("passes enabled installation scan policies to the LLM reviewer", async () => {
    const github = new FakeGithubClient();
    github.configSources.set(
      ".scanveil/config.yml",
      `
version: 1
scan:
  llm:
    enabled: true
  osv:
    enabled: false
suppression:
  enabled: false
`,
    );
    const request: PullRequestScanRequest = {
      deliveryId: "delivery-policies",
      headSha: "stu901",
      installationId: 456,
      llmEnabled: true,
      osvEnabled: false,
      owner: "kexi",
      pullNumber: 11,
      reason: "pull_request",
      repo: "example",
      target: "pull_request",
    };
    const seenInstallationIds: number[] = [];
    const seenScanPolicies: unknown[] = [];

    await runScan(request, {
      createGithubClient: async () => github,
      embed: async () => [1, 0, 0],
      markScanSucceeded: async () => {},
      listScanPolicies: async (installationId) => {
        seenInstallationIds.push(installationId);
        return [
          {
            enabled: true,
            id: "policy-1",
            installationId,
            name: "pnpm minimumReleaseAge",
            rule: "minimumReleaseAge must be 1440 or higher.",
          },
        ];
      },
      reviewDiff: async (_files, options) => {
        seenScanPolicies.push(options.scanPolicies);
        return [];
      },
      runOsv: async () => [],
      writeFindings: async () => {},
    });

    expect(seenInstallationIds).toEqual([456]);
    expect(seenScanPolicies).toEqual([
      [{ name: "pnpm minimumReleaseAge", rule: "minimumReleaseAge must be 1440 or higher." }],
    ]);
  });

  it("uses a console config override instead of repository config files", async () => {
    const github = new FakeGithubClient();
    github.configSources.set(
      ".scanveil/config.yml",
      `
version: 1
scan:
  llm:
    enabled: false
  osv:
    enabled: false
`,
    );
    const request: RepositoryScanRequest = {
      configSourceOverride: `
version: 1
scan:
  llm:
    enabled: true
    excludePaths:
      - "generated/**"
  osv:
    enabled: false
suppression:
  enabled: false
`,
      defaultBranch: "main",
      deliveryId: "delivery-6",
      headSha: "pqr678",
      installationId: 123,
      llmEnabled: true,
      osvEnabled: true,
      owner: "kexi",
      reason: "manual",
      repo: "example",
      target: "repository",
    };
    github.repositoryFiles.push("src/server.ts", "generated/app.ts");
    github.repositoryFileContents.set("src/server.ts", "export const value = 1;");
    github.repositoryFileContents.set("generated/app.ts", "export const generated = 1;");

    await runScan(request, {
      createGithubClient: async () => github,
      embed: async () => [1, 0, 0],
      markScanSucceeded: async () => {},
      listScanPolicies: async () => [],
      reviewDiff: async (files, options) => {
        expect(files.map((file) => file.path)).toEqual(["src/server.ts"]);
        expect(options.excludePaths).toEqual(["generated/**"]);
        return [];
      },
      runOsv: async () => [],
      writeFindings: async () => {},
    });

    expect(github.checkRuns[0]?.payload).toMatchObject({
      output: {
        summary: expect.stringContaining("temporary configuration override"),
      },
    });
  });

  it("keeps scans running when default embedding configuration is unavailable", async () => {
    const github = new FakeGithubClient();
    const originalProject = process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    github.configSource = `
version: 1
scan:
  llm:
    enabled: true
  osv:
    enabled: false
suppression:
  enabled: true
`;
    const writtenFindings: SecurityFinding[] = [];
    const request: PullRequestScanRequest = {
      deliveryId: "delivery-7",
      headSha: "stu901",
      installationId: 123,
      llmEnabled: true,
      osvEnabled: true,
      owner: "kexi",
      pullNumber: 7,
      reason: "pull_request",
      repo: "example",
      target: "pull_request",
    };

    try {
      await runScan(request, {
        createGithubClient: async () => github,
        markScanSucceeded: async () => {},
        listScanPolicies: async () => [],
        reviewDiff: async () => [llmFinding()],
        runOsv: async () => [],
        writeFindings: async (_scanRequest, findings) => {
          writtenFindings.push(...findings);
        },
      });
    } finally {
      restoreOptionalEnv("GOOGLE_CLOUD_PROJECT", originalProject);
    }

    expect(writtenFindings).toHaveLength(1);
    expect(writtenFindings[0]?.sveId).toMatch(/^SVE-\d{6}-/);
    expect(writtenFindings[0]?.embedding).toBeUndefined();
  });
});

class FakeGithubClient implements ScanRunnerGithubClient {
  readonly checkRuns: Array<{ owner: string; payload: unknown; repo: string }> = [];
  createCheckRunError: Error | undefined;
  readonly configSources = new Map<string, string>();
  configSource = `
version: 1
checks:
  conclusionMode: fail_on_threshold
  failThreshold:
    llm: medium
scan:
  llm:
    enabled: true
    excludePaths:
      - "dist/**"
  osv:
    enabled: false
suppression:
  enabled: false
`;
  readonly repositoryFileContents = new Map<string, string>();
  readonly repositoryFiles: string[] = [];

  async createCheckRun(owner: string, repo: string, payload: unknown): Promise<void> {
    const hasError = this.createCheckRunError !== undefined;
    if (hasError) {
      throw this.createCheckRunError;
    }

    this.checkRuns.push({ owner, payload, repo });
  }

  async getPullRequestDiff(): Promise<string> {
    return `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -11,2 +11,3 @@ export function render(userInput: string) {
 const target = document.querySelector("#app");
+target.innerHTML = userInput;
 }`;
  }

  async getRepositoryFile(
    _owner: string,
    _repo: string,
    path: string,
    _ref: string,
  ): Promise<string | undefined> {
    const isScanveilConfig = path === ".scanveil.yml" || path === ".scanveil/config.yml";
    if (isScanveilConfig) {
      const configuredSource = this.configSources.get(path);
      const hasConfiguredSource = configuredSource !== undefined;
      if (hasConfiguredSource) {
        return configuredSource;
      }

      const isLegacyConfig = path === ".scanveil.yml";
      if (isLegacyConfig) {
        return this.configSource;
      }

      return undefined;
    }

    return this.repositoryFileContents.get(path);
  }

  async listRepositoryFiles(): Promise<string[]> {
    return this.repositoryFiles;
  }
}

function llmFinding(file = "src/app.ts", line = 12): SecurityFinding {
  return {
    aliases: [],
    category: "xss",
    confidence: 0.95,
    endLine: line,
    evidence: "The PR writes userInput into innerHTML.",
    file,
    id: "AIVULN-202606-EXAMPLE-0001",
    recommendation: "Use textContent or sanitize the HTML before assignment.",
    severity: "high",
    source: "llm",
    startLine: line,
    title: "DOM XSS",
  };
}

function restoreOptionalEnv(name: string, value: string | undefined): void {
  const hasValue = value !== undefined;
  if (hasValue) {
    process.env[name] = value;
    return;
  }

  delete process.env[name];
}
