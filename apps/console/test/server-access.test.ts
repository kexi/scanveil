import type {
  FixPrRunRecord,
  InstallationPolicy,
  ScanFindingRecord,
  ScanRunRecord,
  ScanStreamChunkRecord,
} from "@scanveil/core";
import { describe, expect, it } from "vitest";

import type { ConsoleUserSession } from "../src/invites.js";
import {
  filterFixPrRunsByRepositoryAccess,
  filterInstallationPoliciesForRepositoryAccess,
  filterScanFindingsByScanRun,
  filterScanStreamChunksByScanRun,
  loadFindingsByRun,
} from "../src/server.js";

const session: ConsoleUserSession = {
  accessibleRepositoryFullNames: ["kexi/example"],
  accessibleRepositoryIds: [10001],
  githubLogin: "kexi",
  githubUserId: "1001",
};

describe("console repository access boundaries", () => {
  it("filters installation policy update responses to repositories visible to the user", () => {
    const policies = filterInstallationPoliciesForRepositoryAccess(
      [visiblePolicy, hiddenPolicy],
      session,
    );

    expect(policies.map((policy) => policy.accountLogin)).toEqual(["kexi"]);
    expect(policies.map((policy) => policy.repositoryCount)).toEqual([1]);
  });

  it("does not return findings or stream chunks that do not match the authorized scan run repository", () => {
    const findings = filterScanFindingsByScanRun([visibleFinding, hiddenFinding], visibleRun);
    const chunks = filterScanStreamChunksByScanRun([visibleChunk, hiddenChunk], visibleRun);

    expect(findings.map((finding) => finding.repoFullName)).toEqual(["kexi/example"]);
    expect(chunks.map((chunk) => chunk.repoFullName)).toEqual(["kexi/example"]);
  });

  it("filters fix PR runs to repositories visible to the user", () => {
    const fixPrRuns = filterFixPrRunsByRepositoryAccess([visibleFixPrRun, hiddenFixPrRun], session);

    expect(fixPrRuns.map((run) => run.fixId)).toEqual(["fix-visible"]);
  });

  it("does not group findings into history when the finding repository does not match the run", async () => {
    const findingsByRun = await loadFindingsByRun([visibleRun], {
      dependencies: {
        listScanFindingRecords: async () => [visibleFinding, hiddenFinding],
      },
    } as unknown as Parameters<typeof loadFindingsByRun>[1]);

    expect(findingsByRun).toEqual({ "delivery-1": [visibleFinding] });
  });
});

const visiblePolicy: InstallationPolicy = {
  accountLogin: "kexi",
  accountType: "User",
  enabled: true,
  installationId: 123,
  inviteCode: "VISIBLE",
  inviteName: "Visible",
  repositoryCount: 99,
  repositorySelection: "selected",
  updatedAt: "2026-06-25T00:00:00.000Z",
  updatedBy: "kexi",
};

const hiddenPolicy: InstallationPolicy = {
  accountLogin: "other-org",
  accountType: "Organization",
  enabled: true,
  installationId: 456,
  inviteCode: "HIDDEN",
  inviteName: "Hidden",
  repositoryCount: 1,
  repositorySelection: "selected",
  updatedAt: "2026-06-25T00:00:00.000Z",
  updatedBy: "other",
};

const visibleRun: ScanRunRecord = {
  deliveryId: "delivery-1",
  headSha: "sha-visible",
  installationId: 123,
  llmEnabled: true,
  osvEnabled: true,
  owner: "kexi",
  queuedAt: "2026-06-25T00:00:00.000Z",
  reason: "manual",
  repo: "example",
  repositoryId: 10001,
  status: "succeeded",
  target: "repository",
  updatedAt: "2026-06-25T00:01:00.000Z",
};

const visibleFinding: ScanFindingRecord = {
  aliases: [],
  category: "xss",
  confidence: 0.95,
  deliveryId: "delivery-1",
  evidence: "visible evidence",
  findingId: "AIVULN-visible",
  recommendation: "fix visible",
  repoFullName: "kexi/example",
  repositoryId: 10001,
  severity: "high",
  source: "llm",
  title: "Visible finding",
  writtenAt: "2026-06-25T00:00:00.000Z",
};

const hiddenFinding: ScanFindingRecord = {
  ...visibleFinding,
  evidence: "hidden evidence",
  findingId: "AIVULN-hidden",
  recommendation: "fix hidden",
  repoFullName: "other-org/private-repo",
  repositoryId: 20001,
  title: "Hidden finding",
};

const visibleFixPrRun: FixPrRunRecord = {
  baseSha: "sha-visible",
  defaultBranch: "main",
  deliveryId: "delivery-1",
  endLine: 1,
  evidence: "visible evidence",
  file: "src/app.ts",
  findingId: "AIVULN-visible",
  fixId: "fix-visible",
  installationId: 123,
  owner: "kexi",
  queuedAt: "2026-06-25T00:02:00.000Z",
  recommendation: "fix visible",
  repo: "example",
  repositoryId: 10001,
  severity: "high",
  startLine: 1,
  status: "queued",
  sveId: "SVE-visible",
  title: "Visible finding",
  updatedAt: "2026-06-25T00:02:00.000Z",
};

const hiddenFixPrRun: FixPrRunRecord = {
  ...visibleFixPrRun,
  fixId: "fix-hidden",
  owner: "other-org",
  repo: "private-repo",
  repositoryId: 20001,
  sveId: "SVE-hidden",
};

const visibleChunk: ScanStreamChunkRecord = {
  deliveryId: "delivery-1",
  kind: "llm_chunk",
  repoFullName: "kexi/example",
  repositoryId: 10001,
  sequence: 0,
  text: "visible chunk",
  timestamp: "2026-06-25T00:00:02.000Z",
};

const hiddenChunk: ScanStreamChunkRecord = {
  deliveryId: "delivery-1",
  kind: "llm_chunk",
  repoFullName: "other-org/private-repo",
  repositoryId: 20001,
  sequence: 1,
  text: "hidden chunk",
  timestamp: "2026-06-25T00:00:03.000Z",
};
