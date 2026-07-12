export const severities = ["info", "low", "medium", "high", "critical"] as const;

export type Severity = (typeof severities)[number];

const severityRank: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function normalizeSeverity(value: unknown, fallback: Severity = "info"): Severity {
  const isString = typeof value === "string";
  if (!isString) {
    return fallback;
  }

  const lowered = value.toLowerCase();
  // GHSA advisories (surfaced by OSV) grade severity as LOW/MODERATE/HIGH/CRITICAL, so "moderate"
  // is aliased to "medium" here rather than left to the caller's fallback (which would escalate it).
  const normalized = lowered === "moderate" ? "medium" : lowered;
  const isSeverity = severities.includes(normalized as Severity);
  if (!isSeverity) {
    return fallback;
  }

  return normalized as Severity;
}

export function isAtLeastSeverity(value: Severity, threshold: Severity): boolean {
  return severityRank[value] >= severityRank[threshold];
}
