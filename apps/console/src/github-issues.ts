import type { ScanFindingRecord, ScanRunRecord } from "@scanveil/core";

export interface FindingIssueRequest {
  body: string;
  labels: string[];
  title: string;
}

export function createFindingIssueRequest(
  run: ScanRunRecord,
  finding: ScanFindingRecord,
  baseUrl: string,
): FindingIssueRequest {
  const title = `[Scanveil] ${finding.severity.toUpperCase()}: ${finding.title}`;
  const labels = ["scanveil", `severity:${finding.severity}`, `source:${finding.source}`];
  const body = [
    "## Finding",
    "",
    `- Severity: ${finding.severity}`,
    `- Source: ${finding.source}`,
    `- SVE-ID: ${finding.sveId ?? finding.findingId}`,
    `- Finding ID: ${finding.findingId}`,
    `- Repository: ${run.owner}/${run.repo}`,
    `- Target: ${run.target}`,
    `- Scan: ${formatScanUrl(baseUrl, run.deliveryId)}`,
    "",
    "## Location",
    "",
    formatFindingLocation(finding),
    "",
    "## Evidence",
    "",
    finding.evidence,
    "",
    "## Recommendation",
    "",
    finding.recommendation,
  ];

  return {
    body: body.join("\n"),
    labels,
    title,
  };
}

function formatScanUrl(baseUrl: string, deliveryId: string): string {
  const hasBaseUrl = baseUrl.length > 0;
  if (!hasBaseUrl) {
    return deliveryId;
  }

  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBaseUrl}/scans/${encodeURIComponent(deliveryId)}`;
}

function formatFindingLocation(finding: ScanFindingRecord): string {
  const file = finding.file;
  const hasFile = file !== undefined && file.length > 0;
  if (!hasFile) {
    return "No source location was recorded.";
  }

  const hasStartLine = finding.startLine !== undefined;
  if (!hasStartLine) {
    return file;
  }

  const endLine = finding.endLine ?? finding.startLine;
  const isSingleLine = endLine === finding.startLine;
  if (isSingleLine) {
    return `${file}:${finding.startLine}`;
  }

  return `${file}:${finding.startLine}-${endLine}`;
}
