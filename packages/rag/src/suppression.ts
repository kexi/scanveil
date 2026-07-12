import {
  createCodeSpanFingerprint,
  createSveFingerprint,
  createSveId,
  normalizeFindingText,
  type SecurityAppConfig,
  type SecurityFinding,
} from "@scanveil/core";

import type { FindingStore, StoredFinding } from "./finding-store.js";

export interface SuppressionOptions {
  config: SecurityAppConfig;
  repoFullName: string;
  store: FindingStore;
  embed(text: string): Promise<number[]>;
}

export async function suppressSimilarFindings(
  findings: SecurityFinding[],
  options: SuppressionOptions,
): Promise<SecurityFinding[]> {
  const isSuppressionEnabled = options.config.suppression.enabled;
  if (!isSuppressionEnabled) {
    return findings.map((finding) => enrichFindingWithSveId(finding, options.repoFullName));
  }

  const output: SecurityFinding[] = [];
  for (const finding of findings) {
    const suppressed = await maybeSuppressFinding(finding, options);
    output.push(suppressed);
  }

  return output;
}

function enrichFindingWithSveId(finding: SecurityFinding, repoFullName: string): SecurityFinding {
  const normalizedText = normalizeFindingText(finding);
  const codeSpanFingerprint = createCodeSpanFingerprint(
    finding.file,
    finding.startLine,
    finding.endLine,
  );
  const sveFingerprint = createSveFingerprint(repoFullName, normalizedText, codeSpanFingerprint);
  const sveId = finding.sveId ?? createSveId(repoFullName, normalizedText, codeSpanFingerprint);
  return {
    ...finding,
    codeSpanFingerprint,
    normalizedText,
    sveFingerprint,
    sveId,
  };
}

async function maybeSuppressFinding(
  finding: SecurityFinding,
  options: SuppressionOptions,
): Promise<SecurityFinding> {
  const normalizedText = normalizeFindingText(finding);
  const codeSpanFingerprint = createCodeSpanFingerprint(
    finding.file,
    finding.startLine,
    finding.endLine,
  );
  const sveFingerprint = createSveFingerprint(
    options.repoFullName,
    normalizedText,
    codeSpanFingerprint,
  );
  const exactMatch = await options.store.findByFingerprint(options.repoFullName, sveFingerprint);
  const hasExactMatch = exactMatch !== undefined;
  if (hasExactMatch) {
    return {
      ...finding,
      codeSpanFingerprint,
      normalizedText,
      suppressedById: exactMatch.findingId,
      sveFingerprint,
      sveId: exactMatch.sveId,
    };
  }

  const embedding = await options.embed(normalizedText);
  const nearest = await options.store.findNearest(
    options.repoFullName,
    embedding,
    options.config.suppression.maxNearestNeighbors,
  );

  const duplicate = nearest.find((candidate) => {
    const isSimilarEnough = candidate.similarity >= options.config.suppression.similarityThreshold;
    const isSameSpan = candidate.stored.codeSpanFingerprint === codeSpanFingerprint;
    const isSameFile =
      candidate.stored.finding.file !== undefined && candidate.stored.finding.file === finding.file;
    return isSimilarEnough && (isSameSpan || isSameFile);
  });

  const hasDuplicate = duplicate !== undefined;
  if (hasDuplicate) {
    const sveId = duplicate.stored.finding.sveId ?? duplicate.stored.finding.id;
    return {
      ...finding,
      codeSpanFingerprint,
      embedding,
      normalizedText,
      suppressedById: duplicate.stored.finding.id,
      sveFingerprint,
      sveId,
    };
  }

  const sveId =
    finding.sveId ?? createSveId(options.repoFullName, normalizedText, codeSpanFingerprint);
  const enrichedFinding = {
    ...finding,
    codeSpanFingerprint,
    embedding,
    normalizedText,
    sveFingerprint,
    sveId,
  };
  const record: StoredFinding = {
    codeSpanFingerprint,
    embedding,
    finding: enrichedFinding,
    normalizedText,
    repoFullName: options.repoFullName,
    sveFingerprint,
  };
  await options.store.saveFinding(record);
  return enrichedFinding;
}
