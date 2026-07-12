import { spawn } from "node:child_process";

import { normalizeSeverity, type SecurityFinding } from "@scanveil/core";

export interface OsvScannerOptions {
  cwd?: string;
  binary?: string;
}

export async function runOsvScanner(
  lockfilePaths: string[],
  options: OsvScannerOptions = {},
): Promise<SecurityFinding[]> {
  const hasLockfiles = lockfilePaths.length > 0;
  if (!hasLockfiles) {
    return [];
  }

  const binary = options.binary ?? "osv-scanner";
  const output = await runCommand(
    binary,
    ["scan", "--format", "json", ...lockfilePaths],
    options.cwd,
  );
  return parseOsvJson(output);
}

export function parseOsvJson(source: string): SecurityFinding[] {
  const parsed = JSON.parse(source) as OsvReport;
  const findings: SecurityFinding[] = [];
  const results = parsed.results ?? [];

  for (const result of results) {
    const packages = result.packages ?? [];
    for (const packageResult of packages) {
      const vulnerabilities = packageResult.vulnerabilities ?? [];
      for (const vulnerability of vulnerabilities) {
        findings.push(toFinding(result.source?.path, packageResult.package?.name, vulnerability));
      }
    }
  }

  return findings;
}

function toFinding(
  path: string | undefined,
  packageName: string | undefined,
  vulnerability: OsvVulnerability,
): SecurityFinding {
  const aliases = [vulnerability.id, ...(vulnerability.aliases ?? [])].filter(
    (value): value is string => typeof value === "string",
  );
  const primaryId = aliases[0] ?? "OSV-UNKNOWN";
  const summary = vulnerability.summary ?? "Vulnerable dependency detected";
  const severity = normalizeSeverity(vulnerability.database_specific?.severity, "high");
  const title =
    packageName === undefined
      ? `${severity.toUpperCase()}: vulnerable dependency reported by ${primaryId}`
      : `${severity.toUpperCase()}: upgrade vulnerable dependency ${packageName} (${primaryId})`;
  const aliasText = aliases.length > 0 ? aliases.join(", ") : primaryId;
  const pathText = path ?? "the scanned lockfile";
  const packageText = packageName ?? "an affected dependency";
  const evidence = [
    `${primaryId} was reported for ${packageText} in ${pathText}.`,
    "",
    `Summary: ${summary}`,
    `Severity: ${severity}`,
    `Aliases: ${aliasText}`,
    "",
    "Impact:",
    "The repository currently resolves a dependency version that is associated with a published vulnerability. If the affected package is reachable from production code, attackers may be able to exercise the vulnerable behavior through application inputs or dependency-controlled data.",
  ].join("\n");
  const recommendation =
    packageName === undefined
      ? [
          "Review the affected dependency and upgrade to a fixed version.",
          "Regenerate the lockfile, run the package test suite, and rerun Scanveil or OSV Scanner to verify that the advisory no longer appears.",
        ].join("\n")
      : [
          `Upgrade ${packageName} to a fixed version according to the advisory.`,
          "Regenerate the lockfile, run the package test suite, and rerun Scanveil or OSV Scanner to verify that the advisory no longer appears.",
          "If no fixed version is available, document the exposure analysis and add a temporary mitigation or dependency replacement plan.",
        ].join("\n");

  const finding: SecurityFinding = {
    aliases,
    category: "dependency_vulnerability",
    confidence: 1,
    evidence,
    id: primaryId,
    recommendation,
    severity,
    source: "osv",
    title,
  };

  const hasPath = path !== undefined;
  if (hasPath) {
    finding.file = path;
  }

  return finding;
}

function runCommand(binary: string, args: string[], cwd: string | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const isSuccess = code === 0;
      const isVulnerabilityExit = code === 1 && stdoutText.trim().length > 0;
      if (isSuccess || isVulnerabilityExit) {
        resolve(stdoutText);
        return;
      }

      reject(
        new Error(
          `osv-scanner failed with code ${code}: ${Buffer.concat(stderr).toString("utf8")}`,
        ),
      );
    });
  });
}

interface OsvReport {
  results?: Array<{
    source?: {
      path?: string;
    };
    packages?: Array<{
      package?: {
        name?: string;
      };
      vulnerabilities?: OsvVulnerability[];
    }>;
  }>;
}

interface OsvVulnerability {
  id?: string;
  aliases?: string[];
  summary?: string;
  database_specific?: {
    severity?: unknown;
  };
}
