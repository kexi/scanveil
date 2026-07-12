import {
  isAtLeastSeverity,
  productMetadata,
  type CheckAnnotation,
  type CheckRunResult,
  type SecurityAppConfig,
  type SecurityFinding,
  type Severity,
} from "@scanveil/core";

const severityDisplayOrder: Array<{ emoji: string; label: string; severity: Severity }> = [
  { emoji: "🔴", label: "Critical", severity: "critical" },
  { emoji: "🟠", label: "High", severity: "high" },
  { emoji: "🟡", label: "Medium", severity: "medium" },
  { emoji: "🔵", label: "Low", severity: "low" },
  { emoji: "⚪", label: "Info", severity: "info" },
];

const maxSeverityBarBlocks = 12;

export function createCheckRunPayload(headSha: string, result: CheckRunResult): unknown {
  const annotations = result.annotations.slice(0, 50).map((annotation) => ({
    annotation_level: annotation.annotationLevel,
    end_line: annotation.endLine,
    message: annotation.message,
    path: annotation.path,
    raw_details: annotation.rawDetails,
    start_line: annotation.startLine,
    title: annotation.title,
  }));

  return {
    name: productMetadata.displayName,
    head_sha: headSha,
    status: "completed",
    conclusion: result.conclusion,
    completed_at: new Date().toISOString(),
    ...(result.detailsUrl === undefined ? {} : { details_url: result.detailsUrl }),
    output: {
      title: result.title,
      summary: result.summary,
      ...(result.text === undefined ? {} : { text: result.text }),
      annotations,
    },
  };
}

export function findingsToCheckResult(
  config: SecurityAppConfig,
  findings: SecurityFinding[],
  warnings: string[],
  detailsUrl?: string,
): CheckRunResult {
  const visibleFindings = sortBySeverity(
    findings.filter((finding) => finding.suppressedById === undefined),
  );
  const suppressedCount = findings.length - visibleFindings.length;
  const annotations = visibleFindings.flatMap(findingToAnnotation);
  const conclusion = selectConclusion(config, visibleFindings);
  return {
    annotations,
    conclusion,
    ...(detailsUrl === undefined ? {} : { detailsUrl }),
    summary: createSummaryMarkdown(visibleFindings, suppressedCount, warnings, detailsUrl),
    text: createFindingDetailsMarkdown(visibleFindings),
    title: createCheckTitle(visibleFindings),
  };
}

function createCheckTitle(findings: SecurityFinding[]): string {
  const hasFindings = findings.length > 0;
  if (!hasFindings) {
    return "No security findings";
  }

  const breakdown = severityDisplayOrder
    .map(({ severity }) => ({ count: countBySeverity(findings, severity), severity }))
    .filter(({ count }) => count > 0)
    .map(({ count, severity }) => `${count} ${severity}`)
    .join(", ");
  const noun = findings.length === 1 ? "finding" : "findings";
  return `${findings.length} ${noun} (${breakdown})`;
}

function createSummaryMarkdown(
  findings: SecurityFinding[],
  suppressedCount: number,
  warnings: string[],
  detailsUrl?: string,
): string {
  const sections: string[] = [];
  const hasFindings = findings.length > 0;
  if (!hasFindings) {
    sections.push("✅ **No security findings in this scan.**");
  } else {
    sections.push(createSeverityChart(findings));
    sections.push(createFindingsTable(findings));
  }

  const hasSuppressed = suppressedCount > 0;
  if (hasSuppressed) {
    sections.push(`🔕 Suppressed duplicate findings: **${suppressedCount}**`);
  }

  const hasWarnings = warnings.length > 0;
  if (hasWarnings) {
    sections.push(
      ["⚠️ **Configuration warnings**", ...warnings.map((warning) => `- ${warning}`)].join("\n"),
    );
  }

  const hasDetailsUrl = detailsUrl !== undefined && detailsUrl.length > 0;
  if (hasDetailsUrl) {
    sections.push(
      `📊 [Open this scan in the ${productMetadata.displayName} console](${detailsUrl})`,
    );
  }

  return sections.join("\n\n");
}

function createSeverityChart(findings: SecurityFinding[]): string {
  const rows = severityDisplayOrder
    .map(({ emoji, label, severity }) => ({
      count: countBySeverity(findings, severity),
      emoji,
      label,
    }))
    .filter(({ count }) => count > 0);
  const maxCount = Math.max(...rows.map(({ count }) => count));
  const body = rows
    .map(({ count, emoji, label }) => {
      const blocks = Math.max(1, Math.round((count / maxCount) * maxSeverityBarBlocks));
      return `| ${emoji} ${label} | ${count} | ${"█".repeat(blocks)} |`;
    })
    .join("\n");
  return ["| Severity | Count | |", "| --- | ---: | :--- |", body].join("\n");
}

function createFindingsTable(findings: SecurityFinding[]): string {
  const rows = findings
    .map((finding) => {
      const emoji = severityEmoji(finding.severity);
      const location = formatLocation(finding);
      return `| ${emoji} ${finding.severity} | ${escapeTableCell(finding.title)} | ${location} |`;
    })
    .join("\n");
  return ["| Severity | Finding | Location |", "| --- | --- | --- |", rows].join("\n");
}

function createFindingDetailsMarkdown(findings: SecurityFinding[]): string {
  const hasFindings = findings.length > 0;
  if (!hasFindings) {
    return "Nothing to review. 🎉";
  }

  return findings
    .map((finding) => {
      const emoji = severityEmoji(finding.severity);
      const location = formatLocation(finding);
      const sveSuffix = finding.sveId === undefined ? "" : ` · SVE: ${finding.sveId}`;
      return [
        "<details>",
        `<summary>${emoji} <b>${escapeHtml(finding.title)}</b> — ${location}</summary>`,
        "",
        "**Evidence**",
        "",
        "```",
        finding.evidence,
        "```",
        "",
        "**Recommendation**",
        "",
        finding.recommendation,
        "",
        `<sub>ID: ${finding.id}${sveSuffix} · source: ${finding.source} · confidence: ${finding.confidence}</sub>`,
        "</details>",
      ].join("\n");
    })
    .join("\n\n");
}

function formatLocation(finding: SecurityFinding): string {
  const file = finding.file;
  const hasFile = file !== undefined && file.length > 0;
  if (!hasFile) {
    return "—";
  }

  const hasLine = finding.startLine !== undefined;
  return hasLine ? `\`${file}:${finding.startLine}\`` : `\`${file}\``;
}

function countBySeverity(findings: SecurityFinding[], severity: Severity): number {
  return findings.filter((finding) => finding.severity === severity).length;
}

function severityEmoji(severity: Severity): string {
  return severityDisplayOrder.find((entry) => entry.severity === severity)?.emoji ?? "⚪";
}

function sortBySeverity(findings: SecurityFinding[]): SecurityFinding[] {
  const rank = new Map(severityDisplayOrder.map((entry, index) => [entry.severity, index]));
  return [...findings].sort(
    (left, right) => (rank.get(left.severity) ?? 99) - (rank.get(right.severity) ?? 99),
  );
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function selectConclusion(
  config: SecurityAppConfig,
  findings: SecurityFinding[],
): CheckRunResult["conclusion"] {
  const isAdvisory = config.checks.conclusionMode === "advisory";
  if (isAdvisory) {
    return "success";
  }

  const hasBlockingFinding = findings.some((finding) => {
    const threshold =
      finding.source === "osv" ? config.checks.failThreshold.osv : config.checks.failThreshold.llm;
    return isAtLeastSeverity(finding.severity, threshold);
  });
  if (!hasBlockingFinding) {
    return "success";
  }

  return "failure";
}

function findingToAnnotation(finding: SecurityFinding): CheckAnnotation[] {
  const file = finding.file;
  const startLine = finding.startLine;
  const hasLocation = file !== undefined && startLine !== undefined;
  if (!hasLocation) {
    return [];
  }

  const annotationLevel =
    finding.severity === "critical" || finding.severity === "high" ? "failure" : "warning";
  return [
    {
      annotationLevel,
      endLine: finding.endLine ?? startLine,
      message: `${finding.id}: ${finding.recommendation}`,
      path: file,
      rawDetails: finding.evidence,
      startLine,
      title: `${finding.severity.toUpperCase()}: ${finding.title}`,
    },
  ];
}
