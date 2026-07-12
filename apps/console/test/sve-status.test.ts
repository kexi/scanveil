import { describe, expect, it } from "vitest";

import { createSveResolutionSummaries } from "../src/sve-status.js";
import type { ScanFindingRecord, ScanRunRecord } from "@scanveil/core";

describe("createSveResolutionSummaries", () => {
  it("marks an SVE active when the latest repository verification scan still finds it", () => {
    const finding = scanFinding({
      deliveryId: "scan-2",
      sveId: "SVE-1",
      writtenAt: "2026-06-22T00:10:00.000Z",
    });
    const summaries = createSveResolutionSummaries(
      [
        scanRun({
          deliveryId: "scan-2",
          status: "succeeded",
          target: "repository",
          updatedAt: "2026-06-22T00:11:00.000Z",
        }),
      ],
      { "scan-2": [finding] },
    );

    expect(summaries[0]).toMatchObject({
      latestVerificationRun: { deliveryId: "scan-2" },
      status: "active",
      sveId: "SVE-1",
    });
  });

  it("marks an SVE resolved when a newer repository scan no longer finds it", () => {
    const finding = scanFinding({
      deliveryId: "scan-1",
      sveId: "SVE-1",
      writtenAt: "2026-06-22T00:00:00.000Z",
    });
    const summaries = createSveResolutionSummaries(
      [
        scanRun({
          deliveryId: "scan-2",
          status: "succeeded",
          target: "repository",
          updatedAt: "2026-06-22T00:20:00.000Z",
        }),
        scanRun({
          deliveryId: "scan-1",
          status: "succeeded",
          target: "repository",
          updatedAt: "2026-06-22T00:01:00.000Z",
        }),
      ],
      { "scan-1": [finding], "scan-2": [] },
    );

    expect(summaries[0]).toMatchObject({
      latestVerificationRun: { deliveryId: "scan-2" },
      status: "resolved",
      sveId: "SVE-1",
    });
  });

  it("marks an SVE unverified when no newer repository verification scan exists", () => {
    const finding = scanFinding({
      deliveryId: "pull-1",
      sveId: "SVE-1",
      writtenAt: "2026-06-22T00:10:00.000Z",
    });
    const summaries = createSveResolutionSummaries(
      [
        scanRun({
          deliveryId: "repo-1",
          status: "succeeded",
          target: "repository",
          updatedAt: "2026-06-22T00:00:00.000Z",
        }),
        scanRun({
          deliveryId: "pull-1",
          status: "succeeded",
          target: "pull_request",
          updatedAt: "2026-06-22T00:11:00.000Z",
        }),
      ],
      { "pull-1": [finding], "repo-1": [] },
    );

    expect(summaries[0]).toMatchObject({
      latestVerificationRun: { deliveryId: "repo-1" },
      status: "unverified",
      sveId: "SVE-1",
    });
  });
});

function scanRun(overrides: Partial<ScanRunRecord>): ScanRunRecord {
  return {
    deliveryId: "scan-1",
    headSha: "sha-1",
    installationId: 123,
    llmEnabled: true,
    osvEnabled: true,
    owner: "kexi",
    queuedAt: "2026-06-22T00:00:00.000Z",
    reason: "manual",
    repo: "example",
    repositoryId: 10001,
    status: "succeeded",
    target: "repository",
    updatedAt: "2026-06-22T00:01:00.000Z",
    ...overrides,
  };
}

function scanFinding(overrides: Partial<ScanFindingRecord>): ScanFindingRecord {
  return {
    aliases: [],
    category: "xss",
    confidence: 0.95,
    deliveryId: "scan-1",
    evidence: "innerHTML uses user input",
    findingId: "AIVULN-1",
    recommendation: "Use textContent.",
    repoFullName: "kexi/example",
    repositoryId: 10001,
    severity: "high",
    source: "llm",
    sveId: "SVE-1",
    title: "DOM XSS",
    writtenAt: "2026-06-22T00:00:00.000Z",
    ...overrides,
  };
}
