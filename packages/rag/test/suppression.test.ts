import { describe, expect, it } from "vitest";

import { defaultSecurityAppConfig, type SecurityFinding } from "@scanveil/core";

import { InMemoryFindingStore } from "../src/finding-store.js";
import { suppressSimilarFindings } from "../src/suppression.js";

describe("suppressSimilarFindings", () => {
  it("suppresses a later finding for the same span", async () => {
    const store = new InMemoryFindingStore();
    const baseFinding: SecurityFinding = {
      aliases: [],
      category: "xss",
      confidence: 0.9,
      evidence: "unsafe render",
      file: "src/app.ts",
      id: "AIVULN-1",
      recommendation: "escape output",
      severity: "high",
      source: "llm",
      startLine: 10,
      title: "XSS",
    };

    const findings = await suppressSimilarFindings(
      [baseFinding, { ...baseFinding, id: "AIVULN-2" }],
      {
        config: defaultSecurityAppConfig,
        embed: async () => [1, 0, 0],
        repoFullName: "owner/repo",
        store,
      },
    );

    expect(findings[1]?.suppressedById).toBe("AIVULN-1");
    expect(findings[0]?.sveId).toMatch(/^SVE-\d{6}-/);
    expect(findings[1]?.sveId).toBe(findings[0]?.sveId);
  });

  it("suppresses an exact fingerprint match before vector similarity", async () => {
    const store = new InMemoryFindingStore();
    const baseFinding: SecurityFinding = {
      aliases: [],
      category: "command_injection",
      confidence: 0.9,
      evidence: "bash -uc executes a package binary",
      file: "apps/agy-runner/Dockerfile",
      id: "AIVULN-1",
      recommendation: "avoid executing package binaries during build",
      severity: "high",
      source: "llm",
      startLine: 14,
      endLine: 23,
      title: "Possible command injection in Dockerfile",
    };
    const embeddings = [
      [1, 0, 0],
      [0, 1, 0],
    ];

    const findings = await suppressSimilarFindings(
      [baseFinding, { ...baseFinding, id: "AIVULN-2" }],
      {
        config: defaultSecurityAppConfig,
        embed: async () => embeddings.shift() ?? [0, 0, 1],
        repoFullName: "owner/repo",
        store,
      },
    );

    expect(findings[1]?.suppressedById).toBe("AIVULN-1");
    expect(findings[1]?.sveId).toBe(findings[0]?.sveId);
    expect(findings[1]?.sveFingerprint).toBe(findings[0]?.sveFingerprint);
    expect(embeddings).toHaveLength(1);
  });
});
