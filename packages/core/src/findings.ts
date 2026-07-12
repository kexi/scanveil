import { createHash } from "node:crypto";

import type { SecurityFinding } from "./types.js";

export function createAivulnId(repoFullName: string, sequence: number, now = new Date()): string {
  const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const repoHash = createHash("sha256")
    .update(repoFullName)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  const normalizedSequence = String(sequence).padStart(4, "0");
  return `AIVULN-${month}-${repoHash}-${normalizedSequence}`;
}

export function createSveId(
  repoFullName: string,
  normalizedText: string,
  codeSpanFingerprint: string,
  now = new Date(),
): string {
  const month = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const repoHash = createHash("sha256")
    .update(repoFullName)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  const findingHash = createHash("sha256")
    .update(`${normalizedText}\n${codeSpanFingerprint}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `SVE-${month}-${repoHash}-${findingHash}`;
}

export function createSveFingerprint(
  repoFullName: string,
  normalizedText: string,
  codeSpanFingerprint: string,
): string {
  return createHash("sha256")
    .update(`${repoFullName}\n${normalizedText}\n${codeSpanFingerprint}`)
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
}

export function normalizeFindingText(
  finding: Pick<SecurityFinding, "category" | "file" | "title" | "recommendation">,
): string {
  const parts = [
    finding.category,
    finding.file ?? "unknown-file",
    finding.title,
    finding.recommendation,
  ];

  return parts
    .join(" ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/._-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createCodeSpanFingerprint(
  file: string | undefined,
  startLine: number | undefined,
  endLine: number | undefined,
): string {
  const normalizedFile = file ?? "unknown-file";
  const normalizedStartLine = startLine ?? 0;
  const normalizedEndLine = endLine ?? normalizedStartLine;
  return `${normalizedFile}:${normalizedStartLine}-${normalizedEndLine}`;
}
