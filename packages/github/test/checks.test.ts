import { describe, expect, it } from "vitest";

import type { SecurityAppConfig, SecurityFinding } from "@scanveil/core";

import { createCheckRunPayload, findingsToCheckResult } from "../src/checks.js";

describe("findingsToCheckResult", () => {
  it("summarizes findings as a severity chart and findings table", () => {
    const result = findingsToCheckResult(
      config("advisory"),
      [finding({ severity: "medium", title: "Weak hash" }), finding({})],
      [],
    );

    expect(result.title).toBe("2 findings (1 high, 1 medium)");
    expect(result.summary).toContain("| 🟠 High | 1 |");
    expect(result.summary).toContain("| 🟡 Medium | 1 |");
    expect(result.summary).toContain("█");
    expect(result.summary).toContain("| 🟠 high | DOM XSS | `src/app.ts:12` |");
  });

  it("orders findings by severity and renders per-finding details", () => {
    const result = findingsToCheckResult(
      config("advisory"),
      [finding({ severity: "low", title: "Low issue" }), finding({ severity: "critical" })],
      [],
    );

    expect(result.title).toBe("2 findings (1 critical, 1 low)");
    expect(result.annotations[0]?.title).toBe("CRITICAL: DOM XSS");
    expect(result.text).toContain("<details>");
    expect(result.text).toContain("**Evidence**");
    expect(result.text).toContain("Use textContent.");
  });

  it("reports a clean scan without tables", () => {
    const result = findingsToCheckResult(config("advisory"), [], []);

    expect(result.title).toBe("No security findings");
    expect(result.summary).toContain("No security findings in this scan");
    expect(result.summary).not.toContain("| Severity |");
  });

  it("counts suppressed duplicates and links the console scan page", () => {
    const result = findingsToCheckResult(
      config("advisory"),
      [finding({ suppressedById: "AIVULN-1" })],
      ["scan.llm.excludePaths ignored"],
      "https://console.example.dev/scans/delivery-1",
    );

    expect(result.title).toBe("No security findings");
    expect(result.summary).toContain("Suppressed duplicate findings: **1**");
    expect(result.summary).toContain("scan.llm.excludePaths ignored");
    expect(result.summary).toContain("https://console.example.dev/scans/delivery-1");
    expect(result.detailsUrl).toBe("https://console.example.dev/scans/delivery-1");
  });

  it("keeps the blocking conclusion for severities at or above the threshold", () => {
    const result = findingsToCheckResult(config("fail_on_threshold"), [finding({})], []);

    expect(result.conclusion).toBe("failure");
  });
});

describe("createCheckRunPayload", () => {
  it("exposes the rich output and details link to GitHub", () => {
    const result = findingsToCheckResult(
      config("advisory"),
      [finding({})],
      [],
      "https://console.example.dev/scans/delivery-1",
    );

    const payload = createCheckRunPayload("abc123", result) as {
      details_url?: string;
      output: { summary: string; text?: string; title: string };
    };

    expect(payload.details_url).toBe("https://console.example.dev/scans/delivery-1");
    expect(payload.output.title).toBe("1 finding (1 high)");
    expect(payload.output.summary).toContain("| Severity | Finding | Location |");
    expect(payload.output.text).toContain("<details>");
  });
});

function config(conclusionMode: "advisory" | "fail_on_threshold"): SecurityAppConfig {
  return {
    checks: {
      conclusionMode,
      failThreshold: {
        llm: "high",
        osv: "high",
      },
    },
    scan: {
      llm: {
        agent: {
          mcp: { enabled: false },
          plugins: { enabled: false },
          skills: { enabled: false },
          runner: "antigravity_experimental",
          timeoutSeconds: 300,
        },
        enabled: true,
        excludePaths: [],
        scope: "pr_diff",
      },
      osv: {
        enabled: true,
        lockfileGlobs: [],
        scope: "changed_lockfiles",
      },
    },
    schedule: { enabled: false },
    suppression: {
      enabled: false,
      maxNearestNeighbors: 10,
      similarityThreshold: 0.7,
    },
    version: 1,
  };
}

function finding(overrides: Partial<SecurityFinding>): SecurityFinding {
  return {
    aliases: [],
    category: "xss",
    confidence: 0.9,
    endLine: 12,
    evidence: "innerHTML receives user input.",
    file: "src/app.ts",
    id: "AIVULN-202607-TEST-0001",
    recommendation: "Use textContent.",
    severity: "high",
    source: "llm",
    startLine: 12,
    title: "DOM XSS",
    ...overrides,
  };
}
