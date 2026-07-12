import type { ScanFindingRecord, ScanRunRecord } from "@scanveil/core";
import { describe, expect, it } from "vitest";

import { createFindingIssueRequest } from "../src/github-issues.js";

describe("createFindingIssueRequest", () => {
  it("builds a GitHub Issue payload from a scan finding", () => {
    const request = createFindingIssueRequest(
      scanRun(),
      scanFinding(),
      "https://admin.example.com/",
    );

    expect(request).toMatchObject({
      labels: ["scanveil", "severity:high", "source:llm"],
      title: "[Scanveil] HIGH: DOM XSS",
    });
    expect(request.body).toContain("- Repository: kexi/example");
    expect(request.body).toContain("- Scan: https://admin.example.com/scans/delivery-1");
    expect(request.body).toContain("src/app.ts:12");
    expect(request.body).toContain("innerHTML uses user input");
    expect(request.body).toContain("Use textContent.");
  });
});

function scanRun(): ScanRunRecord {
  return {
    deliveryId: "delivery-1",
    headSha: "abc123",
    installationId: 123,
    llmEnabled: true,
    osvEnabled: true,
    owner: "kexi",
    queuedAt: "2026-06-21T00:00:00.000Z",
    reason: "manual",
    repo: "example",
    repositoryId: 10001,
    status: "succeeded",
    target: "repository",
    updatedAt: "2026-06-21T00:01:00.000Z",
  };
}

function scanFinding(): ScanFindingRecord {
  return {
    aliases: ["CVE-2026-0001"],
    category: "xss",
    confidence: 0.95,
    deliveryId: "delivery-1",
    embedding: [],
    endLine: 12,
    evidence: "innerHTML uses user input",
    file: "src/app.ts",
    findingId: "AIVULN-1",
    recommendation: "Use textContent.",
    repoFullName: "kexi/example",
    repositoryId: 10001,
    severity: "high",
    source: "llm",
    startLine: 12,
    sveId: "SVE-202606-EXAMPLE-0001",
    title: "DOM XSS",
    writtenAt: "2026-06-21T00:00:00.000Z",
  };
}
