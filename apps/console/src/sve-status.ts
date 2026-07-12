import type { ScanFindingRecord, ScanRunRecord } from "@scanveil/core";

export type SveResolutionStatus = "active" | "resolved" | "unverified";

export interface SveResolutionSummary {
  firstDetectedAt: string;
  latestDetectedAt: string;
  latestFinding: ScanFindingRecord;
  latestVerificationRun?: ScanRunRecord;
  status: SveResolutionStatus;
  sveId: string;
}

export function createSveResolutionSummaries(
  history: ScanRunRecord[],
  findingsByRun: Record<string, ScanFindingRecord[]>,
): SveResolutionSummary[] {
  const findingsBySveId = new Map<string, ScanFindingRecord[]>();
  for (const finding of Object.values(findingsByRun).flat()) {
    const sveId = finding.sveId ?? finding.findingId;
    const hasSveId = sveId.length > 0;
    if (!hasSveId) {
      continue;
    }

    findingsBySveId.set(sveId, [...(findingsBySveId.get(sveId) ?? []), finding]);
  }

  return [...findingsBySveId.entries()]
    .map(([sveId, findings]) => createSveResolutionSummary(sveId, findings, history, findingsByRun))
    .sort((left, right) => right.latestDetectedAt.localeCompare(left.latestDetectedAt));
}

export function createSveResolutionSummary(
  sveId: string,
  findings: ScanFindingRecord[],
  history: ScanRunRecord[],
  findingsByRun: Record<string, ScanFindingRecord[]>,
): SveResolutionSummary {
  const sortedFindings = [...findings].sort((left, right) =>
    right.writtenAt.localeCompare(left.writtenAt),
  );
  const latestFinding = sortedFindings[0];
  const hasLatestFinding = latestFinding !== undefined;
  if (!hasLatestFinding) {
    throw new Error("SVE resolution summary requires at least one finding");
  }

  const verificationRuns = history
    .filter((run) => isRepositoryVerificationRun(run, latestFinding.repoFullName))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const latestVerificationRun = verificationRuns[0];
  const status =
    latestVerificationRun === undefined
      ? "unverified"
      : readResolutionStatus(sveId, latestFinding, latestVerificationRun, findingsByRun);

  return {
    firstDetectedAt:
      sortedFindings[sortedFindings.length - 1]?.writtenAt ?? latestFinding.writtenAt,
    latestDetectedAt: latestFinding.writtenAt,
    latestFinding,
    ...(latestVerificationRun === undefined ? {} : { latestVerificationRun }),
    status,
    sveId,
  };
}

function isRepositoryVerificationRun(run: ScanRunRecord, repoFullName: string): boolean {
  const runRepoFullName = `${run.owner}/${run.repo}`;
  const isSameRepository = runRepoFullName === repoFullName;
  const isSucceededRepositoryScan = run.status === "succeeded" && run.target === "repository";
  return isSameRepository && isSucceededRepositoryScan;
}

function readResolutionStatus(
  sveId: string,
  latestFinding: ScanFindingRecord,
  latestVerificationRun: ScanRunRecord,
  findingsByRun: Record<string, ScanFindingRecord[]>,
): SveResolutionStatus {
  const verificationFindings = findingsByRun[latestVerificationRun.deliveryId] ?? [];
  const isStillDetected = verificationFindings.some((finding) => {
    const findingSveId = finding.sveId ?? finding.findingId;
    return findingSveId === sveId;
  });
  if (isStillDetected) {
    return "active";
  }

  const wasVerifiedAfterDetection = latestVerificationRun.updatedAt > latestFinding.writtenAt;
  if (wasVerifiedAfterDetection) {
    return "resolved";
  }

  return "unverified";
}
